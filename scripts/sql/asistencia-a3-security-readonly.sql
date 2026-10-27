begin read only;
select json_build_object(
 'read_only',current_setting('transaction_read_only'),
 'intercambios', (select count(*) from public.asistencia_intercambios),
 'rls', (select relrowsecurity from pg_class where oid='public.asistencia_intercambios'::regclass),
 'policies',(select json_agg(json_build_object('name',policyname,'command',cmd,'roles',roles,'using',qual)) from pg_policies where schemaname='public' and tablename='asistencia_intercambios'),
 'direct_select_authenticated',has_table_privilege('authenticated','public.asistencia_intercambios','select'),
 'direct_insert_authenticated',has_table_privilege('authenticated','public.asistencia_intercambios','insert'),
 'direct_update_authenticated',has_table_privilege('authenticated','public.asistencia_intercambios','update'),
 'direct_delete_authenticated',has_table_privilege('authenticated','public.asistencia_intercambios','delete'),
 'direct_select_anon',has_table_privilege('anon','public.asistencia_intercambios','select'),
 'rpc',(select json_agg(json_build_object('name',p.oid::regprocedure::text,'definer',prosecdef,'path',proconfig,'authenticated',has_function_privilege('authenticated',p.oid,'execute'),'anon',has_function_privilege('anon',p.oid,'execute'))) from pg_proc p where pronamespace='public'::regnamespace and proname in ('asistencia_intercambio_crear','asistencia_intercambio_cancelar','asistencia_intercambios_resumen','mark_attendance_ingreso','mark_attendance_inicio_almuerzo','mark_attendance_fin_almuerzo','mark_attendance_salida')),
 'horarios',(select json_agg(json_build_object('nombre',p.full_name,'dia',h.dia_semana,'ingreso',h.hora_ingreso,'salida',h.hora_salida)) from public.asistencia_horarios_personales h join public.profiles p on p.id=h.user_id where p.full_name ilike '%Alhely%' or p.full_name ilike '%Angie%')
);
rollback;
