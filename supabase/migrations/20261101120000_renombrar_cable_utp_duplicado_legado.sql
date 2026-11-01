-- CANDIDATA LOCAL, SIN APLICAR. Requiere autorizacion expresa del
-- propietario (auditoria operativa 2026-11-01, caso Jadir Zavaleta / 25 m
-- de "cable UTP"). NO es la causa de ese caso (verificado por SQL de solo
-- lectura: el Kardex/custodia de "cable UTP" activo esta integro) --
-- corrige un hallazgo preexistente, documentado desde el 19-20/10/2026 y
-- nunca resuelto, que SI representa un riesgo real de confusion futura.
--
-- SITUACION REAL (confirmada, solo lectura, 2026-11-01):
-- Existen 2 filas en inventory_products para el mismo material fisico:
--  - "Cable UTP"  (unit='unidad', is_active=false) -- historica, sin
--    custodia/consumo desde que quedo inactiva; invisible para tecnicos
--    (los selectores de Campo filtran por is_active).
--  - "cable UTP"  (unit='metros', is_active=true)  -- la que SI usan los
--    tecnicos hoy; su Kardex/custodia esta reconciliado sin discrepancias.
--
-- RIESGO: un reporte o listado administrativo que agrupe/busque por nombre
-- ("Cable UTP") puede mezclar 2 productos distintos con unidades distintas
-- (unidad vs metros) sin que la pantalla lo distinga -- fuente de errores
-- de lectura para personal administrativo (regla de usabilidad, CLAUDE.md).
--
-- CORRECCION PROPUESTA (minima, no destructiva, reversible):
-- renombrar UNICAMENTE la fila inactiva para que sea inconfundible en
-- cualquier listado -- no se fusiona, no se mueve historial, no se cambia
-- unidad/precio/stock, no se reactiva. Guardado exacto por id (visto por
-- esta auditoria) + condicion de seguridad (nombre/unidad/estado actuales)
-- para que la migracion ABORTE si algo no coincide exactamente -- nunca
-- renombra "a ciegas" otra fila.
begin;
do $$
declare v_id uuid; v_name text; v_unit text; v_active boolean;
begin
  select id,name,unit,is_active into v_id,v_name,v_unit,v_active
    from public.inventory_products
    where name='Cable UTP' and unit='unidad' and is_active=false;
  if not found then
    raise exception 'La fila esperada (Cable UTP / unidad / inactivo) no existe o ya cambio; detener y revisar antes de continuar';
  end if;
  if exists(
    select 1 from public.inventory_products
    where name='Cable UTP' and unit='unidad' and is_active=false
    having count(*) > 1
  ) then
    raise exception 'Mas de una fila coincide; detener, esto requiere revision manual';
  end if;
  update public.inventory_products
    set name = 'Cable UTP (legado, descontinuado — no usar; ver cable UTP en metros)'
    where id = v_id and name='Cable UTP' and unit='unidad' and is_active=false;
end $$;
commit;

-- Reversion: UPDATE public.inventory_products SET name='Cable UTP'
-- WHERE name LIKE 'Cable UTP (legado%' AND unit='unidad' AND is_active=false;
