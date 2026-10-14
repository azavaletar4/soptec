-- Fase 160 (Fase 4 OLT — historial de desconexiones/reconexiones).
--
-- NO APLICADA TODAVIA — requiere autorizacion explicita del usuario antes
-- de correr contra Supabase de produccion (CLAUDE.md, regla 16).
--
-- Diagnostico previo (ver ESTADO_DESARROLLO.md 13at, Paso 1): las alertas
-- de oltSyncService.ts/oltAlerts.ts/oltEvents.ts ya tienen una fecha/hora
-- REAL del evento (`at`, capturada al inicio del ciclo de sync que detecto
-- la transicion) y ya distinguen una caida real de una falla de consulta
-- (si el escaneo global de la OLT falla, `scanComplete` queda false y NO
-- se evalua ninguna transicion ese ciclo — nunca se alerta por error de
-- lectura). Lo que falta es PERSISTENCIA: hoy la alerta solo vive en
-- memoria del proceso backend (EventEmitter) y del navegador (Pinia) — se
-- pierde si nadie tiene el panel abierto en el momento exacto, o si el
-- backend se reinicia entre la deteccion y la entrega por SSE.
--
-- Diseño (insert-only, igual filosofia que el Kardex/debt_hold_events —
-- ver esta ultima como precedente directo de esta migracion, misma forma):
-- una fila por evento (nunca un UPDATE posterior) — la duracion de una
-- interrupcion se calcula en lectura (correlacionando el 'offline' mas
-- reciente con su 'recovered' por olt_ont_id), no se guarda como columna
-- mutable aparte.
--
-- client_id/contract_id son un SNAPSHOT verificado al momento del evento
-- (mismo criterio que Fase B, ontZoneDiscrepancy.ts: solo se llena si la
-- ONT YA tenia AMBOS client_id y contract_id en ese instante, nunca un
-- vinculo a medias) — no se actualiza retroactivamente si la ONT se
-- traslada o desvincula despues (Fase 159): un historial no se reescribe.
--
-- Retencion: sin DELETE automatico en esta fase (insert-only, igual que el
-- Kardex) — si el volumen llega a justificarlo, evaluar un job de limpieza
-- aparte (ej. purgar filas de mas de 180 dias) en una fase futura, con
-- autorizacion explicita; no se implementa aqui.

create table if not exists public.olt_alert_log (
  id uuid primary key default gen_random_uuid(),
  olt_device_id uuid not null references public.olt_devices (id) on delete cascade,
  -- ON DELETE SET NULL (nunca cascade): borrar una ONT no debe borrar su
  -- historial — ver regla 3 de la migracion OLT (CLAUDE.md): una ONT
  -- jamas deberia eliminarse salvo baja real confirmada, y aun asi el
  -- historial de lo que le paso mientras existio sigue siendo valido.
  olt_ont_id uuid references public.olt_onts (id) on delete set null,
  kind text not null check (kind in ('offline', 'recovered', 'lowSignal', 'signalRecovered')),
  at timestamptz not null,
  client_id uuid references public.clients (id) on delete set null,
  contract_id uuid references public.service_contracts (id) on delete set null,
  detail text,
  created_at timestamptz not null default now()
);

comment on table public.olt_alert_log is
  'Fase 160: historial insert-only de desconexiones/reconexiones (y cruces de umbral de senal) detectadas por oltSyncService.ts. client_id/contract_id son un snapshot verificado al momento del evento, nunca un vinculo vivo ni inferido.';

-- Dedupe a nivel de BD (ademas del dedupe de la UI, Fase 3/13as, y de
-- runningDeviceIds que ya impide 2 syncs paralelos de la misma OLT): el
-- mismo evento exacto (misma ONT, mismo tipo, mismo instante al
-- milisegundo) nunca se inserta dos veces.
create unique index if not exists idx_olt_alert_log_dedupe on public.olt_alert_log (olt_ont_id, kind, at);

-- Filtros pedidos (fecha, cliente, zona via contract_id -> service_contracts.zone_id, estado=kind).
create index if not exists idx_olt_alert_log_device_at on public.olt_alert_log (olt_device_id, at desc);
create index if not exists idx_olt_alert_log_client on public.olt_alert_log (client_id) where client_id is not null;
create index if not exists idx_olt_alert_log_contract on public.olt_alert_log (contract_id) where contract_id is not null;
create index if not exists idx_olt_alert_log_kind on public.olt_alert_log (kind);

alter table public.olt_alert_log enable row level security;

-- Mismos 3 roles operativos reales que el resto del modulo OLT (regla 9
-- de la migracion OLT, CLAUDE.md) — nunca SOPORTE/FACTURACION.
drop policy if exists "olt_alert_log_staff_select" on public.olt_alert_log;
create policy "olt_alert_log_staff_select"
  on public.olt_alert_log for select to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED'));

-- Los inserts reales los hace oltSyncService.ts con supabaseAdmin (service
-- role, bypassea RLS) — esta policy es solo defensa en profundidad si algun
-- dia se inserta directo desde el cliente (mismo patron que debt_hold_events,
-- Fase 25).
drop policy if exists "olt_alert_log_staff_insert" on public.olt_alert_log;
create policy "olt_alert_log_staff_insert"
  on public.olt_alert_log for insert to authenticated
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED'));

-- Sin policy de UPDATE/DELETE a proposito: insert-only, ni siquiera el
-- staff autenticado puede editar o borrar un registro historico via API.
