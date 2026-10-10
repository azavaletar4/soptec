-- Fase 136 (Fase 2 del plan de confiabilidad OLT, ver docs/auditoria/
-- fase-2-aprovisionamiento.html): registro de operaciones de aprovisionamiento
-- ("Autorizar y Activar") para que la Fase 2 pueda ser idempotente y
-- reconciliable en vez de "todo o nada" como hasta ahora.
--
-- Por que hace falta una tabla nueva en vez de solo mas columnas en olt_onts:
-- una operacion de aprovisionamiento abarca VARIAS etapas que no viven todas
-- en esa tabla (OLT, vinculo a cliente/contrato, MikroTik) y puede fallar a
-- mitad de camino — se necesita un registro propio, independiente de si la
-- fila de olt_onts llego a crearse, para:
--   1) Detectar un reintento/doble-clic de la MISMA solicitud (idempotency_key)
--      sin volver a ejecutar comandos de escritura ya aplicados.
--   2) Saber EXACTAMENTE que etapa quedo pendiente si algo fallo a mitad de
--      camino, para reconciliar/reintentar solo eso (nunca repetir desde cero).
--   3) Dejar constancia de un resultado INCIERTO (timeout de escritura o
--      conexion perdida) como su propio estado, distinto de "fallo" y de
--      "exito" — nunca se asume ninguna de las dos sin verificar.
--
-- Mismo criterio de acceso que olt_onts/olt_devices (Fase 4): RLS activado,
-- SIN policies — acceso exclusivo via supabaseAdmin (service role) desde el
-- backend Hono, nunca directo desde el cliente.

create table public.olt_provisioning_operations (
  id uuid primary key default gen_random_uuid(),

  -- Identifica una solicitud LOGICA (no una fila): el frontend genera esta
  -- clave una sola vez por intento de "Autorizar y Activar" y la reenvia tal
  -- cual en cualquier reintento/doble-clic sobre la MISMA solicitud. Unica
  -- por OLT (dos OLTs distintas nunca comparten una operacion).
  idempotency_key text not null,
  olt_device_id uuid not null references public.olt_devices(id) on delete cascade,

  serial text not null,
  frame integer not null default 1,
  slot integer not null,
  port integer not null,
  -- NULL mientras no se resolvio un onu-id libre todavia (ver etapa
  -- "resolve_id" en steps). Se fija apenas se elige, antes de escribir nada.
  onu_id integer,

  client_id uuid references public.clients(id),
  contract_id uuid references public.service_contracts(id),

  -- Snapshot de los datos de la solicitud (onuType/vlan/perfiles/zona/etc) —
  -- a proposito NUNCA incluye credenciales (clave PPPoE): eso se pide de
  -- nuevo si hace falta reintentar el paso de WAN/PPPoE, nunca se persiste.
  requested jsonb not null,

  -- Maquina de estados de la operacion completa (ver oltProvisioningService.ts):
  --   pending            -> creada, todavia no se tocó la OLT
  --   olt_uncertain      -> el comando de escritura tuvo timeout/conexion
  --                         perdida: NO se sabe si se aplico o no, pendiente
  --                         de verificar antes de reintentar o seguir
  --   olt_verify_failed  -> la OLT respondio pero la lectura posterior NO
  --                         coincide con lo solicitado (serial/posicion/vlan/
  --                         perfiles) — nunca se reporta como éxito
  --   olt_registered     -> OLT escrita y VERIFICADA correcta
  --   linking            -> vinculando cliente/contrato/zona/NAP en Supabase
  --   mikrotik_pending   -> falta MikroTik (secreto PPPoE)
  --   completed          -> todas las etapas con las que se pidio avanzar
  --                         quedaron hechas y verificadas
  --   failed             -> una etapa fallo de forma definitiva (ej. la OLT
  --                         rechazo el comando con un error CLI real)
  status text not null default 'pending' check (status in (
    'pending', 'olt_uncertain', 'olt_verify_failed', 'olt_registered',
    'linking', 'mikrotik_pending', 'completed', 'failed'
  )),

  -- Historial de etapas, en orden: [{ stage, status, at, detail? }, ...].
  -- "detail" es texto para humanos (ya pasado por redactSensitive si viene
  -- de la OLT) — nunca un objeto con credenciales.
  steps jsonb not null default '[]'::jsonb,

  -- Fila resultante en olt_onts, apenas se sabe (puede quedar NULL si la
  -- operacion nunca llego a escribir nada en la OLT).
  ont_db_id uuid references public.olt_onts(id) on delete set null,

  error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (olt_device_id, idempotency_key)
);

comment on table public.olt_provisioning_operations is
  'Seguimiento idempotente y reconciliable de "Autorizar y Activar" (Fase 2 OLT) — ver oltProvisioningService.ts.';

create index olt_provisioning_operations_serial_idx
  on public.olt_provisioning_operations (olt_device_id, serial);

create index olt_provisioning_operations_status_idx
  on public.olt_provisioning_operations (status)
  where status not in ('completed', 'failed');

alter table public.olt_provisioning_operations enable row level security;
-- A proposito sin policies (ver comentario de arriba) — mismo patron que
-- olt_onts/olt_devices desde la Fase 4.

create trigger olt_provisioning_operations_set_updated_at
  before update on public.olt_provisioning_operations
  for each row execute function public.set_updated_at();
