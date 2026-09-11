-- SmartRayco — cache del estado TR-069 de cada ONT, para mostrarlo en el
-- panel sin tener que reconsultar la OLT por Telnet. Se actualiza en
-- server/src/routes/olt.ts al asignar/quitar el ACS (POST/DELETE
-- /:id/onts/:ontDbId/tr069, ver zteCommands.ts setTr069AcsCommands()).

alter table public.olt_onts add column if not exists tr069_enabled boolean not null default false;
alter table public.olt_onts add column if not exists tr069_acs_url text;
