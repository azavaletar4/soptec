-- Fase 168: clasificacion de routers MikroTik por funcion (RouterOS v7)
--
-- Hasta ahora todo router registrado en mikrotik_devices se trataba igual
-- (administrador PPPoE de clientes). Esta columna permite registrar tambien
-- routers de borde que reciben la(s) linea(s) de internet del proveedor:
--   - 'pppoe_admin'        -> router administrador existente (sin cambios).
--   - 'borde_dedicado'     -> recibe UNA sola linea de internet.
--   - 'borde_balanceador'  -> recibe VARIAS lineas y balancea entre ellas.
--
-- default 'pppoe_admin' para que el/los routers YA registrados sigan
-- funcionando exactamente igual que hoy (reconciliacion PPPoE, corte por
-- deuda y cambio de perfil) sin que nadie tenga que reclasificarlos a mano.
-- Un router de borde se consulta SOLO de lectura (recurso, interfaces) y
-- queda excluido de esas 3 operaciones — ver mikrotikReconcileService.ts y
-- debtHoldService.ts (server/src/mikrotik/deviceRole.ts centraliza el rol).
alter table public.mikrotik_devices
  add column device_role text not null default 'pppoe_admin';

alter table public.mikrotik_devices
  add constraint mikrotik_devices_device_role_check
  check (device_role in ('pppoe_admin', 'borde_dedicado', 'borde_balanceador'));

comment on column public.mikrotik_devices.device_role is
  'pppoe_admin: administra PPPoE de clientes (unico rol reconciliado/cortado por deuda). borde_dedicado: una sola linea de internet. borde_balanceador: varias lineas balanceadas entre si. Los 2 tipos de borde son solo lectura (CPU/memoria/interfaces).';
