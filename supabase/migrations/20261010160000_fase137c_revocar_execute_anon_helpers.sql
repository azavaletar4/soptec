-- Fase 137c: endurecimiento puntual — Supabase otorga EXECUTE a anon/
-- authenticated por defecto en toda funcion nueva (ALTER DEFAULT PRIVILEGES
-- del propio proyecto, confirmado tambien en self_assign_ticket ya
-- existente: "revoke ... from public" no alcanza a un grant directo a esos
-- roles). find_other_active_job() no tiene ningun chequeo de rol interno
-- (es un helper de solo lectura para los triggers, no una ruta de negocio) —
-- se le quita el acceso directo via RPC a anon/authenticated; los triggers
-- (SECURITY DEFINER, corren como el dueño) lo siguen pudiendo invocar
-- igual, sin cambio de comportamiento. Los 2 triggers no son invocables
-- via RPC de todos modos (retornan "trigger", Postgres lo rechaza fuera de
-- un trigger real) pero se revocan tambien por consistencia.
--
-- Hallazgo mas amplio (fuera de alcance de esta fase, no se toca aqui): el
-- mismo patron de privilegios por defecto aplica a TODAS las funciones del
-- proyecto, incluidas RPCs ya existentes (confirmado en self_assign_ticket).
-- La autorizacion real de este proyecto vive DENTRO de cada funcion
-- (current_user_role(), etc.), no en el grant de ejecucion — es el patron
-- establecido en todo el codebase, consistente aqui.
revoke execute on function public.find_other_active_job(uuid, text, uuid) from anon, authenticated;
revoke execute on function public.enforce_single_active_job() from anon, authenticated;
revoke execute on function public.enforce_single_active_job_assignees() from anon, authenticated;
