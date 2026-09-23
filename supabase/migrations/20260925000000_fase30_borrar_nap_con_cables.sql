-- SmartRayco — Fase 30: permite eliminar una caja NAP (u otro elemento
-- pasivo) aunque tenga cables de fibra conectados como origen/destino.
--
-- Antes: fo_cables.origen_infra_id/destino_infra_id no tenian "on delete"
-- (default NO ACTION en Postgres), asi que borrar una caja NAP que fuera
-- extremo de algun cable fallaba con una violacion de FK. Los puertos NAP
-- (fo_nap_puertos) y las fusiones (fo_fusiones) YA se borraban en cascada
-- (ver fase8) — el cable era el unico obstaculo.
--
-- Ahora: al borrar el elemento pasivo, el cable NO se borra (sigue
-- existiendo con su trazado/hilos), solo pierde ese extremo (queda en
-- null) para reconectarlo despues desde el editor de cables.

do $$
declare
  origen_fk text;
  destino_fk text;
begin
  select conname into origen_fk
    from pg_constraint
    where conrelid = 'public.fo_cables'::regclass
      and contype = 'f'
      and conkey = (select array_agg(attnum) from pg_attribute
                    where attrelid = 'public.fo_cables'::regclass and attname = 'origen_infra_id');
  if origen_fk is not null then
    execute format('alter table public.fo_cables drop constraint %I', origen_fk);
  end if;

  select conname into destino_fk
    from pg_constraint
    where conrelid = 'public.fo_cables'::regclass
      and contype = 'f'
      and conkey = (select array_agg(attnum) from pg_attribute
                    where attrelid = 'public.fo_cables'::regclass and attname = 'destino_infra_id');
  if destino_fk is not null then
    execute format('alter table public.fo_cables drop constraint %I', destino_fk);
  end if;
end $$;

alter table public.fo_cables
  add constraint fo_cables_origen_infra_id_fkey
  foreign key (origen_infra_id) references public.infra_elementos (id) on delete set null;

alter table public.fo_cables
  add constraint fo_cables_destino_infra_id_fkey
  foreign key (destino_infra_id) references public.infra_elementos (id) on delete set null;
