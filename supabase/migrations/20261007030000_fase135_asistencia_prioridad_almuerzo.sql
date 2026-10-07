-- Fase 135: "Técnicos Activos" (TechnicianStatusBar.vue, OperacionesHoyView)
-- ahora valida primero asistencia_registros para que "En Almuerzo" mande
-- sobre cualquier orden activa ("en camino"/"en atención"). Dos ajustes:
--
-- 1) La policy de SELECT de asistencia_registros (Fase 117) solo dejaba ver
--    filas ajenas a SUPERADMIN/ADMIN — SOPORTE (quien realmente usa
--    "Operaciones de Hoy" como pantalla de despacho) se quedaba sin ver el
--    tablero de hoy de los demas, asi que esta tarjeta le habria quedado
--    rota en la practica. Se amplia a SOPORTE; TECNICO_RED sigue sin ver la
--    marcacion ajena (tardanza/exceso de almuerzo/GPS de otros son datos
--    sensibles que no necesita ver un par).
-- 2) Sin la tabla en la publicacion supabase_realtime, la suscripcion de
--    OperacionesHoyView.vue se conecta pero nunca recibe eventos — mismo
--    gap que tickets/installations/routines antes de la Fase 132.

drop policy if exists "asistencia_registros_select_propio_o_admin" on public.asistencia_registros;
create policy "asistencia_registros_select_propio_o_staff_despacho"
  on public.asistencia_registros for select to authenticated
  using (user_id = auth.uid() or public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'SOPORTE'));

alter publication supabase_realtime add table public.asistencia_registros;
