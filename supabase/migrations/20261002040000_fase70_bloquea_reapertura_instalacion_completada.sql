-- SmartRayco — Fase 70: cierra el hueco que dejaba la app de campo
-- (CampoTrabajoDetailView.vue) para re-tocar una instalacion ya completada.
--
-- La Fase 69 bloqueo materiales/equipo nuevos contra una instalacion
-- 'completed', pero esa correccion vivia en los triggers de
-- inventory_movements/inventory_unit_events — no tocaba nada de esto:
--   1. Un tecnico asignado podia volver a llamar updateStatus(..., 'completed')
--      sobre una instalacion YA completada (la RLS de Fase 16 solo mira
--      rol+assigned_to, nunca el estado actual de la fila).
--   2. client_photos tiene upsert por (contract_id, category) — un tecnico
--      podia re-subir cualquier foto (fachada, caja NAP, etc.) de una
--      instalacion ya cerrada, pisando la que ya se habia guardado, sin
--      ningun candado.
-- (El frontend ya deja de mostrar el formulario en ese caso — esto es la
-- proteccion real del lado de la BD, por si se llama a la API directo.)

-- ---- 1) installations: un tecnico no puede actualizar una fila que YA
-- este 'completed' (si hace falta corregir algo, un admin la regresa a
-- 'scheduled' primero). SUPERADMIN/ADMIN sin cambios.
drop policy if exists "installations_update_staff" on public.installations;
create policy "installations_update_staff"
  on public.installations for update to authenticated
  using (
    public.current_user_role() in ('SUPERADMIN', 'ADMIN')
    or (public.current_user_role() = 'TECNICO_RED' and assigned_to = auth.uid() and status <> 'completed')
  )
  with check (
    public.current_user_role() in ('SUPERADMIN', 'ADMIN')
    or (public.current_user_role() = 'TECNICO_RED' and assigned_to = auth.uid())
  );

-- ---- 2) client_photos: no se puede insertar/reemplazar una foto de un
-- contrato cuya instalacion mas reciente ya este 'completed', salvo
-- SUPERADMIN/ADMIN.
create or replace function public.guard_client_photos_completed_installation()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_status public.installation_status;
begin
  if new.contract_id is not null then
    select status into v_status
    from public.installations
    where contract_id = new.contract_id
    order by created_at desc
    limit 1;
    if v_status = 'completed' and public.current_user_role() not in ('SUPERADMIN', 'ADMIN') then
      raise exception 'La instalación ya fue completada; solo un administrador puede reemplazar sus fotos';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_client_photos_guard_completed on public.client_photos;
create trigger trg_client_photos_guard_completed
  before insert or update on public.client_photos
  for each row execute procedure public.guard_client_photos_completed_installation();
