begin read only;
select json_build_object(
 'read_only',current_setting('transaction_read_only'),
 'checked_at',now(),
 'tables',(select json_agg(json_build_object('name',n,'exists',to_regclass('public.'||n) is not null)) from unnest(array['profiles','company_settings','feriados','asistencia_registros','asistencia_solicitudes','asistencia_novedades','asistencia_horarios_personales','asistencia_config_eventos']) n),
 'a3_absent',to_regclass('public.asistencia_intercambios') is null,
 'functions',(select json_agg(json_build_object('name',p.oid::regprocedure::text,'body_md5',md5(regexp_replace(p.prosrc,'\s','','g')),'security_definer',p.prosecdef,'config',p.proconfig,'authenticated_execute',has_function_privilege('authenticated',p.oid,'execute'),'anon_execute',has_function_privilege('anon',p.oid,'execute'))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('current_user_role','asistencia_config_auditar','asistencia_guardar_historial','mark_attendance_ingreso','mark_attendance_inicio_almuerzo','mark_attendance_fin_almuerzo','mark_attendance_salida','asistencia_novedad_crear','asistencia_novedad_cancelar')),
 'horarios',(select json_agg(json_build_object('name',p.full_name,'weekday',h.dia_semana,'turno',h.turno,'ingreso',h.hora_ingreso,'salida',h.hora_salida)) from public.asistencia_horarios_personales h join public.profiles p on p.id=h.user_id where p.full_name ilike '%Alhely%' or p.full_name ilike '%Angie%'),
 'policies',(select json_agg(json_build_object('table',tablename,'name',policyname,'command',cmd,'using',qual,'check',with_check)) from pg_policies where schemaname='public' and tablename in ('asistencia_horarios_personales','asistencia_novedades')),
 'rls',(select json_agg(json_build_object('table',relname,'enabled',relrowsecurity)) from pg_class where relnamespace='public'::regnamespace and relname in ('asistencia_registros','asistencia_solicitudes','asistencia_novedades','asistencia_horarios_personales','asistencia_config_eventos'))
);
rollback;
