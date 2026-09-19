-- Fase 13: gestion de usuarios de staff (crear/editar/eliminar), exclusiva
-- para SUPERADMIN.
--
-- El campo profiles.active ya existia (Fase 2) pero no se aplicaba en
-- ningun lado: ni el backend ni las policies RLS lo revisaban, asi que
-- "desactivar" a alguien no le quitaba acceso real. current_user_role() es
-- la funcion que TODAS las policies de staff usan (clients_staff_only,
-- tickets, installations, etc.) para decidir acceso — se ajusta aqui mismo
-- para que null-ee el rol de una cuenta inactiva, y asi todas esas policies
-- quedan protegidas de una sola vez sin tocar cada una.

create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and active;
$$;
