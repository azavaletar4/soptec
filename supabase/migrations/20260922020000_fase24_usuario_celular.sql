-- Fase 24: numero de celular en los usuarios de staff (profiles), igual
-- criterio que clients.phone — dato de contacto simple, sin validacion de
-- formato (distintos operadores/paises).

alter table public.profiles add column if not exists phone text;
