-- Fase 14: login por usuario en vez de correo.
--
-- Supabase Auth solo loguea por email/telefono — no hay "username" nativo.
-- Se agrega profiles.username (unico, insensible a mayusculas) y una
-- funcion publica que resuelve username -> email SIN exponer nada mas de
-- la fila, para que el frontend pueda armar el email real y recien ahi
-- llamar signInWithPassword. La pantalla de login nunca vuelve a pedir
-- correo.

alter table public.profiles add column username text;

-- Backfill de las cuentas existentes: la parte local del correo como
-- username inicial (el SUPERADMIN puede cambiarlo despues desde /usuarios).
update public.profiles set username = lower(split_part(email, '@', 1)) where username is null;

alter table public.profiles alter column username set not null;
create unique index idx_profiles_username_unique on public.profiles (lower(username));

-- El trigger de alta (Fase 2) tambien debe asignar un username por
-- defecto, o el INSERT fallaria por el NOT NULL de arriba. Si el candidato
-- (parte local del correo) ya esta tomado, le agrega un sufijo numerico.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  base_username text := lower(split_part(new.email, '@', 1));
  candidate text := base_username;
  suffix int := 0;
begin
  while exists (select 1 from public.profiles where lower(username) = lower(candidate)) loop
    suffix := suffix + 1;
    candidate := base_username || suffix::text;
  end loop;

  insert into public.profiles (id, email, username)
  values (new.id, new.email, candidate)
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Resuelve username -> email para el login, antes de tener sesion (por
-- eso se ejecuta como anon). Solo cuentas activas resuelven — una cuenta
-- desactivada da el mismo error generico "usuario o contraseña
-- incorrectos" en vez de dejarla arrancar el login para despues quedar
-- bloqueada en todas partes.
create or replace function public.get_email_by_username(p_username text)
returns text
language sql
stable
security definer set search_path = public
as $$
  select email from public.profiles where lower(username) = lower(p_username) and active limit 1;
$$;

revoke all on function public.get_email_by_username(text) from public;
grant execute on function public.get_email_by_username(text) to anon, authenticated;
