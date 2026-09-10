-- SmartRayco — Fase 3: clientes y contratos
-- - address en clients (direccion simple; la version con GPS llega en Fase 10)
-- - numeracion automatica de contratos (CTR-YYYY-NNNNN) via funcion + trigger

alter table public.clients add column address text;

-- Contador por año para la numeracion de contratos. Tabla interna: RLS habilitado
-- sin policies, solo se toca desde funciones SECURITY DEFINER (bypasean RLS).
create table public.contract_number_counters (
  year       int primary key,
  last_value int not null default 0
);
alter table public.contract_number_counters enable row level security;

create or replace function public.generate_contract_number()
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  current_year int := extract(year from now())::int;
  seq_value    int;
begin
  insert into public.contract_number_counters (year, last_value)
  values (current_year, 1)
  on conflict (year) do update
    set last_value = public.contract_number_counters.last_value + 1
  returning last_value into seq_value;

  return 'CTR-' || current_year::text || '-' || lpad(seq_value::text, 5, '0');
end;
$$;

create or replace function public.set_contract_number()
returns trigger
language plpgsql
as $$
begin
  if new.contract_number is null then
    new.contract_number := public.generate_contract_number();
  end if;
  return new;
end;
$$;

create trigger trg_service_contracts_number
  before insert on public.service_contracts
  for each row execute procedure public.set_contract_number();
