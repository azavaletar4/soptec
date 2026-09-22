-- Fase 25: corte y reactivacion por deuda (automatizado, semi-supervisado).
--
-- Flujo:
--  1. Un scheduler (debtHoldScheduler, mismo patron que tr069Scheduler.ts)
--     corre periodicamente y marca (debt_hold_status='pending') los
--     contratos activos con una factura vencida hace >= DEBT_HOLD_GRACE_DAYS
--     dias (env var, default 7). Solo marca — no toca MikroTik ni OLT.
--  2. Un humano (Facturacion/Admin) revisa la lista de "Cortes pendientes"
--     (debt_hold_status='pending') y confirma el corte con un click. Recien
--     ahi se aplica de verdad: cambia el plan real en la OLT al plan
--     marcado como "corte por deuda" (plans.is_debt_suspension_plan) y el
--     profile PPPoE en MikroTik (igual mecanismo que ya usa "Cambiar plan"
--     y "Cambiar perfil PPPoE" desde la ficha del cliente).
--  3. Al marcar una factura como pagada (si el contrato no tiene otras
--     facturas vencidas), se reactiva solo: vuelve el plan CONTRATADO
--     original — service_contracts.plan_id nunca se toca durante el corte,
--     asi que reactivar es solo reaplicar ese plan — y el profile PPPoE que
--     tenia antes (guardado en mikrotik_profile_before_hold).

-- Un solo plan puede marcarse como "el plan de corte por deuda" a la vez
-- (el ya existente "CORTE POR DEUDA" / "Profile_Morosos", ver Fase 21).
alter table public.plans add column if not exists is_debt_suspension_plan boolean not null default false;

create unique index if not exists idx_plans_single_debt_suspension_plan
  on public.plans (is_debt_suspension_plan)
  where is_debt_suspension_plan;

do $$ begin
  create type public.debt_hold_status as enum ('none', 'pending', 'suspended');
exception when duplicate_object then null;
end $$;

alter table public.service_contracts
  add column if not exists debt_hold_status public.debt_hold_status not null default 'none',
  add column if not exists debt_hold_flagged_at timestamptz,
  add column if not exists debt_hold_applied_at timestamptz,
  add column if not exists debt_hold_invoice_id uuid references public.invoices (id) on delete set null,
  add column if not exists mikrotik_profile_before_hold text;

-- Auditoria de cada evento (marcado/aplicado/reactivado/error). Insert-only,
-- nunca se edita ni se borra — mismo criterio que inventory_unit_events.
create table if not exists public.debt_hold_events (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.service_contracts (id) on delete cascade,
  event_type text not null check (event_type in ('flagged', 'applied', 'reactivated', 'error')),
  invoice_id uuid references public.invoices (id) on delete set null,
  detail text,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists idx_debt_hold_events_contract on public.debt_hold_events (contract_id, created_at desc);

alter table public.debt_hold_events enable row level security;

drop policy if exists "debt_hold_events_billing_staff_select" on public.debt_hold_events;
create policy "debt_hold_events_billing_staff_select"
  on public.debt_hold_events for select to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'FACTURACION'));

-- Los inserts reales los hace el backend con supabaseAdmin (service role,
-- bypassea RLS) — esta policy es solo defensa en profundidad si algun dia
-- se inserta directo desde el cliente.
drop policy if exists "debt_hold_events_billing_staff_insert" on public.debt_hold_events;
create policy "debt_hold_events_billing_staff_insert"
  on public.debt_hold_events for insert to authenticated
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'FACTURACION'));
