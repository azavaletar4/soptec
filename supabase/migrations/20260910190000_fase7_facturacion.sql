-- SmartRayco — Fase 7: facturacion (control interno de cobros)
--
-- Alcance: registrar y cobrar facturas de los contratos de servicio ya
-- existentes. Es control interno para la gestion del ISP (saber quien debe,
-- quien pago, cuanto se cobro en el mes) — no reemplaza ni interactua con
-- ningun sistema de facturacion electronica/tributario; eso queda fuera de
-- este modulo.
--
-- Numeracion automatica (FAC-YYYY-NNNNN), igual criterio que contratos/tickets.
-- No hay estado 'overdue' persistido: una factura vencida se calcula en la
-- UI (due_date pasada y status='pending'), no requiere un job en background.

-- =========================================================
-- Tipos
-- =========================================================

create type public.invoice_status as enum ('pending', 'paid', 'cancelled');

-- =========================================================
-- invoices
-- =========================================================

create table public.invoices (
  id             uuid primary key default gen_random_uuid(),
  invoice_number text unique,
  contract_id    uuid not null references public.service_contracts (id),
  client_id      uuid not null references public.clients (id),
  period_start   date not null,
  period_end     date not null,
  amount         numeric(10, 2) not null,
  due_date       date not null,
  status         public.invoice_status not null default 'pending',
  paid_at        timestamptz,
  payment_method text,
  notes          text,
  created_by     uuid references public.profiles (id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Contador por año para la numeracion de facturas (mismo patron que contratos/tickets).
create table public.invoice_number_counters (
  year       int primary key,
  last_value int not null default 0
);
alter table public.invoice_number_counters enable row level security;

create or replace function public.generate_invoice_number()
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  current_year int := extract(year from now())::int;
  seq_value    int;
begin
  insert into public.invoice_number_counters (year, last_value)
  values (current_year, 1)
  on conflict (year) do update
    set last_value = public.invoice_number_counters.last_value + 1
  returning last_value into seq_value;

  return 'FAC-' || current_year::text || '-' || lpad(seq_value::text, 5, '0');
end;
$$;

create or replace function public.set_invoice_number()
returns trigger
language plpgsql
as $$
begin
  if new.invoice_number is null then
    new.invoice_number := public.generate_invoice_number();
  end if;
  return new;
end;
$$;

create trigger trg_invoices_number
  before insert on public.invoices
  for each row execute procedure public.set_invoice_number();

create trigger trg_invoices_updated_at
  before update on public.invoices
  for each row execute procedure public.set_updated_at();

-- =========================================================
-- Indices
-- =========================================================

create index idx_invoices_client_id on public.invoices (client_id);
create index idx_invoices_contract_id on public.invoices (contract_id);
create index idx_invoices_status on public.invoices (status);
create index idx_invoices_due_date on public.invoices (due_date);

-- =========================================================
-- Row Level Security
-- =========================================================

alter table public.invoices enable row level security;

-- invoices: personal de facturacion (mismo criterio que plans_write_admin_billing
-- en la Fase 2). No TECNICO_RED/SOPORTE — no necesitan ver datos de cobros.
create policy "invoices_billing_staff"
  on public.invoices for all to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'FACTURACION'))
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'FACTURACION'));
