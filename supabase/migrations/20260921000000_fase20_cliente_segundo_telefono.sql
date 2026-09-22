-- Fase 20: segundo número de teléfono por cliente
alter table public.clients
  add column if not exists phone_2 text;
