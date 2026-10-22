set role postgres;
-- CANDIDATE ONLY. Expand first; no retirement/data reconciliation in this migration.
begin;
set transaction isolation level repeatable read;
set local lock_timeout='2s';
set local statement_timeout='30s';

-- Execution guards only; the approved migration DDL below remains unchanged.
select 1/(case when current_user='postgres' then 1 else 0 end) as expected_owner;
lock table public.olt_onts in access exclusive mode;
lock table supabase_migrations.schema_migrations in share row exclusive mode;
select 1/(case when not exists(select 1 from supabase_migrations.schema_migrations where version in ('20261021170000','20261021171000')) then 1 else 0 end) as no_version_conflict;
\o /out/catalog-on-entry.json
select jsonb_build_object('schema',(s::jsonb->'schema')-'read_only','functions',(s::jsonb->'functions')-'read_only','preflight',(s::jsonb->'preflight')-'captured_at'-'onts'-'read_only') from (select json_build_object('schema',(
select json_build_object(
 'read_only',current_setting('transaction_read_only'),
 'columns',(select json_agg(x) from (select column_name,data_type,is_nullable,column_default,udt_name from information_schema.columns where table_schema='public' and table_name='olt_onts' order by ordinal_position)x),
 'constraints',(select json_agg(x) from (select conname,conrelid::regclass::text as table_name,confrelid::regclass::text as reference_table,pg_get_constraintdef(oid) as definition from pg_constraint where conrelid='public.olt_onts'::regclass or confrelid='public.olt_onts'::regclass order by conname)x),
 'triggers',(select json_agg(x) from (select tgname,pg_get_triggerdef(oid) as definition,pg_get_functiondef(tgfoid) as function from pg_trigger where tgrelid='public.olt_onts'::regclass and not tgisinternal order by tgname)x),
 'status_values',(select json_agg(enumlabel order by enumsortorder) from pg_enum where enumtypid='public.ont_status'::regtype)
)),'functions',(
select json_build_object('read_only',current_setting('transaction_read_only'),
 'functions',(select json_agg(x) from (select p.proname,pg_get_function_identity_arguments(p.oid) as arguments,
 p.prosrc,p.prosecdef,p.proconfig,p.proacl::text as grants,pg_get_userbyid(p.proowner) as owner,
 md5(replace(p.prosrc,E'\r\n',E'\n')) as body_lf_md5
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('crear_descuento_compensacion_masivo','assign_contract_nap_sync_ont_zone') order by p.proname)x))),'preflight',(select json_build_object('captured_at',transaction_timestamp(),'read_only',current_setting('transaction_read_only'),
'indexes',(select json_agg(x) from (select indexname,indexdef from pg_indexes where schemaname='public' and tablename='olt_onts' order by indexname)x),
'policies',(select json_agg(x) from (select * from pg_policies where schemaname='public' and tablename='olt_onts' order by policyname)x),
'owner',(select pg_get_userbyid(relowner) from pg_class where oid='public.olt_onts'::regclass),
'rls',(select json_build_object('enabled',relrowsecurity,'forced',relforcerowsecurity,'acl',relacl::text) from pg_class where oid='public.olt_onts'::regclass),
'related_constraints',(select json_agg(x) from (select conname,conrelid::regclass::text as table_name,confrelid::regclass::text as reference_table,pg_get_constraintdef(oid) as definition from pg_constraint where conrelid in ('public.inventory_units'::regclass,'public.service_contracts'::regclass,'public.olt_alert_log'::regclass,'public.olt_provisioning_operations'::regclass) order by conrelid::regclass::text,conname)x),
'contract_triggers',(select json_agg(x) from (select tgname,pg_get_triggerdef(oid) as definition,pg_get_functiondef(tgfoid) as function from pg_trigger where tgrelid='public.service_contracts'::regclass and not tgisinternal order by tgname)x),
'duplicate_serials',(select json_agg(x) from (select olt_device_id,upper(btrim(serial)) as serial,count(*) from public.olt_onts group by olt_device_id,upper(btrim(serial)) having count(*)>1)x),
'duplicate_positions',(select json_agg(x) from (select olt_device_id,frame,slot,port,ont_id,count(*) from public.olt_onts group by olt_device_id,frame,slot,port,ont_id having count(*)>1)x),
'name_collisions',json_build_object('guard',to_regprocedure('public.guard_olt_ont_retirement()')::text,'serial_index',to_regclass('public.olt_onts_active_serial_key')::text,'position_index',to_regclass('public.olt_onts_active_position_key')::text),
'onts',(select json_agg(o order by id) from public.olt_onts o where id in ('a1f0b671-a1e2-482c-b24e-7e584bf0e4ed','74d586e3-3a0a-40c2-aba3-46294adcf095','76701eb5-405e-462f-862d-384a469cadac') or upper(btrim(serial)) in ('MSTC8CCE647E','HWTCDEB847B6','HWTCE5C94DB6','HWTC5C94DB6')))))) q(s);
\o
select 1/(case when (select jsonb_build_object('schema',(s::jsonb->'schema')-'read_only','functions',(s::jsonb->'functions')-'read_only','preflight',(s::jsonb->'preflight')-'captured_at'-'onts'-'read_only') from (select json_build_object('schema',(
select json_build_object(
 'read_only',current_setting('transaction_read_only'),
 'columns',(select json_agg(x) from (select column_name,data_type,is_nullable,column_default,udt_name from information_schema.columns where table_schema='public' and table_name='olt_onts' order by ordinal_position)x),
 'constraints',(select json_agg(x) from (select conname,conrelid::regclass::text as table_name,confrelid::regclass::text as reference_table,pg_get_constraintdef(oid) as definition from pg_constraint where conrelid='public.olt_onts'::regclass or confrelid='public.olt_onts'::regclass order by conname)x),
 'triggers',(select json_agg(x) from (select tgname,pg_get_triggerdef(oid) as definition,pg_get_functiondef(tgfoid) as function from pg_trigger where tgrelid='public.olt_onts'::regclass and not tgisinternal order by tgname)x),
 'status_values',(select json_agg(enumlabel order by enumsortorder) from pg_enum where enumtypid='public.ont_status'::regtype)
)),'functions',(
select json_build_object('read_only',current_setting('transaction_read_only'),
 'functions',(select json_agg(x) from (select p.proname,pg_get_function_identity_arguments(p.oid) as arguments,
 p.prosrc,p.prosecdef,p.proconfig,p.proacl::text as grants,pg_get_userbyid(p.proowner) as owner,
 md5(replace(p.prosrc,E'\r\n',E'\n')) as body_lf_md5
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('crear_descuento_compensacion_masivo','assign_contract_nap_sync_ont_zone') order by p.proname)x))),'preflight',(select json_build_object('captured_at',transaction_timestamp(),'read_only',current_setting('transaction_read_only'),
'indexes',(select json_agg(x) from (select indexname,indexdef from pg_indexes where schemaname='public' and tablename='olt_onts' order by indexname)x),
'policies',(select json_agg(x) from (select * from pg_policies where schemaname='public' and tablename='olt_onts' order by policyname)x),
'owner',(select pg_get_userbyid(relowner) from pg_class where oid='public.olt_onts'::regclass),
'rls',(select json_build_object('enabled',relrowsecurity,'forced',relforcerowsecurity,'acl',relacl::text) from pg_class where oid='public.olt_onts'::regclass),
'related_constraints',(select json_agg(x) from (select conname,conrelid::regclass::text as table_name,confrelid::regclass::text as reference_table,pg_get_constraintdef(oid) as definition from pg_constraint where conrelid in ('public.inventory_units'::regclass,'public.service_contracts'::regclass,'public.olt_alert_log'::regclass,'public.olt_provisioning_operations'::regclass) order by conrelid::regclass::text,conname)x),
'contract_triggers',(select json_agg(x) from (select tgname,pg_get_triggerdef(oid) as definition,pg_get_functiondef(tgfoid) as function from pg_trigger where tgrelid='public.service_contracts'::regclass and not tgisinternal order by tgname)x),
'duplicate_serials',(select json_agg(x) from (select olt_device_id,upper(btrim(serial)) as serial,count(*) from public.olt_onts group by olt_device_id,upper(btrim(serial)) having count(*)>1)x),
'duplicate_positions',(select json_agg(x) from (select olt_device_id,frame,slot,port,ont_id,count(*) from public.olt_onts group by olt_device_id,frame,slot,port,ont_id having count(*)>1)x),
'name_collisions',json_build_object('guard',to_regprocedure('public.guard_olt_ont_retirement()')::text,'serial_index',to_regclass('public.olt_onts_active_serial_key')::text,'position_index',to_regclass('public.olt_onts_active_position_key')::text),
'onts',(select json_agg(o order by id) from public.olt_onts o where id in ('a1f0b671-a1e2-482c-b24e-7e584bf0e4ed','74d586e3-3a0a-40c2-aba3-46294adcf095','76701eb5-405e-462f-862d-384a469cadac') or upper(btrim(serial)) in ('MSTC8CCE647E','HWTCDEB847B6','HWTCE5C94DB6','HWTC5C94DB6')))))) q(s))=$expected_603be2a24dde${"schema":{"columns":[{"udt_name":"uuid","data_type":"uuid","column_name":"id","is_nullable":"NO","column_default":"gen_random_uuid()"},{"udt_name":"uuid","data_type":"uuid","column_name":"olt_device_id","is_nullable":"NO","column_default":null},{"udt_name":"uuid","data_type":"uuid","column_name":"client_id","is_nullable":"YES","column_default":null},{"udt_name":"int4","data_type":"integer","column_name":"frame","is_nullable":"NO","column_default":"1"},{"udt_name":"int4","data_type":"integer","column_name":"slot","is_nullable":"NO","column_default":null},{"udt_name":"int4","data_type":"integer","column_name":"port","is_nullable":"NO","column_default":null},{"udt_name":"int4","data_type":"integer","column_name":"ont_id","is_nullable":"NO","column_default":null},{"udt_name":"text","data_type":"text","column_name":"serial","is_nullable":"NO","column_default":null},{"udt_name":"text","data_type":"text","column_name":"description","is_nullable":"YES","column_default":null},{"udt_name":"text","data_type":"text","column_name":"onu_type","is_nullable":"YES","column_default":null},{"udt_name":"int4","data_type":"integer","column_name":"vlan","is_nullable":"YES","column_default":null},{"udt_name":"ont_status","data_type":"USER-DEFINED","column_name":"status","is_nullable":"NO","column_default":"'unknown'::ont_status"},{"udt_name":"numeric","data_type":"numeric","column_name":"rx_power","is_nullable":"YES","column_default":null},{"udt_name":"numeric","data_type":"numeric","column_name":"tx_power","is_nullable":"YES","column_default":null},{"udt_name":"timestamptz","data_type":"timestamp with time zone","column_name":"last_synced_at","is_nullable":"YES","column_default":null},{"udt_name":"timestamptz","data_type":"timestamp with time zone","column_name":"created_at","is_nullable":"NO","column_default":"now()"},{"udt_name":"timestamptz","data_type":"timestamp with time zone","column_name":"updated_at","is_nullable":"NO","column_default":"now()"},{"udt_name":"text","data_type":"text","column_name":"wan_mac","is_nullable":"YES","column_default":null},{"udt_name":"text","data_type":"text","column_name":"tcont_profile","is_nullable":"YES","column_default":null},{"udt_name":"text","data_type":"text","column_name":"traffic_profile","is_nullable":"YES","column_default":null},{"udt_name":"bool","data_type":"boolean","column_name":"tr069_enabled","is_nullable":"NO","column_default":"false"},{"udt_name":"text","data_type":"text","column_name":"tr069_acs_url","is_nullable":"YES","column_default":null},{"udt_name":"uuid","data_type":"uuid","column_name":"zone_id","is_nullable":"YES","column_default":null},{"udt_name":"text","data_type":"text","column_name":"splitter","is_nullable":"YES","column_default":null},{"udt_name":"text","data_type":"text","column_name":"splitter_port","is_nullable":"YES","column_default":null},{"udt_name":"text","data_type":"text","column_name":"address_comment","is_nullable":"YES","column_default":null},{"udt_name":"text","data_type":"text","column_name":"contact","is_nullable":"YES","column_default":null},{"udt_name":"numeric","data_type":"numeric","column_name":"latitude","is_nullable":"YES","column_default":null},{"udt_name":"numeric","data_type":"numeric","column_name":"longitude","is_nullable":"YES","column_default":null},{"udt_name":"uuid","data_type":"uuid","column_name":"plan_id","is_nullable":"YES","column_default":null},{"udt_name":"uuid","data_type":"uuid","column_name":"contract_id","is_nullable":"YES","column_default":null},{"udt_name":"text","data_type":"text","column_name":"admin_state","is_nullable":"NO","column_default":"'enable'::text"}],"triggers":[{"tgname":"trg_olt_onts_activate_client","function":"CREATE OR REPLACE FUNCTION public.activate_client_on_ont_link()\n RETURNS trigger\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'public'\nAS $function$\r\nbegin\r\n  if new.client_id is not null and (tg_op = 'INSERT' or old.client_id is distinct from new.client_id) then\r\n    update public.clients\r\n    set status = 'active'\r\n    where id = new.client_id and status = 'prospect';\r\n  end if;\r\n  return new;\r\nend;\r\n$function$\n","definition":"CREATE TRIGGER trg_olt_onts_activate_client AFTER INSERT OR UPDATE OF client_id ON public.olt_onts FOR EACH ROW EXECUTE FUNCTION activate_client_on_ont_link()"},{"tgname":"trg_olt_onts_updated_at","function":"CREATE OR REPLACE FUNCTION public.set_updated_at()\n RETURNS trigger\n LANGUAGE plpgsql\nAS $function$\r\nbegin\r\n  new.updated_at = now();\r\n  return new;\r\nend;\r\n$function$\n","definition":"CREATE TRIGGER trg_olt_onts_updated_at BEFORE UPDATE ON public.olt_onts FOR EACH ROW EXECUTE FUNCTION set_updated_at()"}],"constraints":[{"conname":"olt_alert_log_olt_ont_id_fkey","definition":"FOREIGN KEY (olt_ont_id) REFERENCES olt_onts(id) ON DELETE SET NULL","table_name":"olt_alert_log","reference_table":"olt_onts"},{"conname":"olt_onts_admin_state_check","definition":"CHECK ((admin_state = ANY (ARRAY['enable'::text, 'disable'::text])))","table_name":"olt_onts","reference_table":"-"},{"conname":"olt_onts_client_id_fkey","definition":"FOREIGN KEY (client_id) REFERENCES clients(id)","table_name":"olt_onts","reference_table":"clients"},{"conname":"olt_onts_contract_id_fkey","definition":"FOREIGN KEY (contract_id) REFERENCES service_contracts(id) ON DELETE SET NULL","table_name":"olt_onts","reference_table":"service_contracts"},{"conname":"olt_onts_olt_device_id_fkey","definition":"FOREIGN KEY (olt_device_id) REFERENCES olt_devices(id) ON DELETE CASCADE","table_name":"olt_onts","reference_table":"olt_devices"},{"conname":"olt_onts_olt_device_id_frame_slot_port_ont_id_key","definition":"UNIQUE (olt_device_id, frame, slot, port, ont_id)","table_name":"olt_onts","reference_table":"-"},{"conname":"olt_onts_pkey","definition":"PRIMARY KEY (id)","table_name":"olt_onts","reference_table":"-"},{"conname":"olt_onts_plan_id_fkey","definition":"FOREIGN KEY (plan_id) REFERENCES plans(id)","table_name":"olt_onts","reference_table":"plans"},{"conname":"olt_onts_zone_id_fkey","definition":"FOREIGN KEY (zone_id) REFERENCES zones(id) ON DELETE SET NULL","table_name":"olt_onts","reference_table":"zones"},{"conname":"olt_provisioning_operations_ont_db_id_fkey","definition":"FOREIGN KEY (ont_db_id) REFERENCES olt_onts(id) ON DELETE SET NULL","table_name":"olt_provisioning_operations","reference_table":"olt_onts"}],"status_values":["online","offline","unknown"]},"functions":{"functions":[{"owner":"postgres","grants":"{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}","prosrc":"\ndeclare\n  v_role text;\n  v_nap_result uuid;\n  v_zone_id uuid;\n  v_ont_count int;\n  v_ont_id uuid;\n  v_ont_zone_id uuid;\n  v_synced boolean := false;\n  v_skip_reason text := null;\nbegin\n  v_role := public.current_user_role()::text;\n  if v_role is null or v_role not in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED') then\n    raise exception 'No tienes permisos para esta accion' using errcode = '42501';\n  end if;\n\n  v_nap_result := public.assign_provisioning_nap(p_nap_id, p_contract_id, p_client_id);\n\n  select zone_id into v_zone_id from public.service_contracts where id = p_contract_id;\n\n  select count(*), (array_agg(id))[1] into v_ont_count, v_ont_id\n    from public.olt_onts where contract_id = p_contract_id;\n\n  if v_ont_count = 0 then\n    v_skip_reason := 'sin_ont_vinculada';\n  elsif v_ont_count > 1 then\n    v_skip_reason := 'ambiguo:' || v_ont_count::text;\n  else\n    select zone_id into v_ont_zone_id from public.olt_onts where id = v_ont_id;\n    if v_ont_zone_id is distinct from v_zone_id then\n      update public.olt_onts set zone_id = v_zone_id where id = v_ont_id;\n    end if;\n    v_synced := true;\n  end if;\n\n  return query select v_nap_result, v_synced, v_skip_reason;\nend;\n","proname":"assign_contract_nap_sync_ont_zone","arguments":"p_nap_id uuid, p_contract_id uuid, p_client_id uuid","proconfig":["search_path=public, pg_temp"],"prosecdef":true,"body_lf_md5":"61dc572f18d1101144b49d8bef3af38a"},{"owner":"postgres","grants":"{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}","prosrc":"\r\ndeclare\r\n  v_lote_id uuid;\r\n  v_client_id uuid;\r\n  v_contract_id uuid;\r\n  v_ont_count int;\r\n  v_monthly numeric(10, 2);\r\n  v_monto_cliente numeric(10, 2);\r\n  v_count int := 0;\r\nbegin\r\n  if public.current_user_role() not in ('SUPERADMIN', 'ADMIN') then\r\n    raise exception 'Solo ADMIN/SUPERADMIN pueden aplicar descuentos por averia masiva';\r\n  end if;\r\n  if p_criterio not in ('zona', 'olt', 'nap') then\r\n    raise exception 'Criterio invalido: %', p_criterio;\r\n  end if;\r\n  if (p_monto is null) = (p_porcentaje is null) then\r\n    raise exception 'Indica exactamente uno: monto fijo o porcentaje';\r\n  end if;\r\n\r\n  insert into public.descuentos_compensacion_lotes (criterio, criterio_id, motivo, monto, porcentaje)\r\n  values (p_criterio, p_criterio_id, p_motivo, p_monto, p_porcentaje)\r\n  returning id into v_lote_id;\r\n\r\n  for v_client_id in\r\n    select distinct c.id\r\n      from public.clients c\r\n     where (p_criterio = 'zona' and c.zone_id = p_criterio_id)\r\n        or (p_criterio = 'olt' and exists (\r\n              select 1 from public.olt_onts o where o.client_id = c.id and o.olt_device_id = p_criterio_id\r\n            ))\r\n        or (p_criterio = 'nap' and exists (\r\n              select 1 from public.fo_nap_puertos n where n.client_id = c.id and n.infra_elemento_id = p_criterio_id\r\n            ))\r\n  loop\r\n    v_contract_id := null;\r\n\r\n    if p_criterio = 'olt' then\r\n      -- Solo se resuelve el contrato si hay exactamente UN ont de este\r\n      -- cliente en esta OLT (y ese ont ya tiene contract_id, Fase 37).\r\n      select count(*) into v_ont_count\r\n        from public.olt_onts o\r\n       where o.client_id = v_client_id and o.olt_device_id = p_criterio_id;\r\n\r\n      if v_ont_count = 1 then\r\n        select o.contract_id into v_contract_id\r\n          from public.olt_onts o\r\n         where o.client_id = v_client_id and o.olt_device_id = p_criterio_id;\r\n      end if;\r\n    end if;\r\n\r\n    if p_porcentaje is not null then\r\n      if v_contract_id is not null then\r\n        select monthly_fee into v_monthly from public.service_contracts where id = v_contract_id;\r\n      end if;\r\n      if v_monthly is null then\r\n        select monthly_fee into v_monthly\r\n          from public.service_contracts\r\n         where client_id = v_client_id and status = 'active'\r\n         order by created_at desc\r\n         limit 1;\r\n      end if;\r\n      if v_monthly is null then\r\n        continue; -- sin contrato activo, no hay mensualidad de la que sacar el %\r\n      end if;\r\n      v_monto_cliente := round(v_monthly * p_porcentaje / 100, 2);\r\n    else\r\n      v_monto_cliente := p_monto;\r\n    end if;\r\n\r\n    if v_monto_cliente > 0 then\r\n      insert into public.descuentos_compensacion (client_id, contract_id, monto, motivo, lote_id)\r\n      values (v_client_id, v_contract_id, v_monto_cliente, p_motivo, v_lote_id);\r\n      v_count := v_count + 1;\r\n    end if;\r\n\r\n    v_monthly := null;\r\n  end loop;\r\n\r\n  update public.descuentos_compensacion_lotes set clientes_afectados = v_count where id = v_lote_id;\r\n\r\n  return query select v_lote_id, v_count;\r\nend;\r\n","proname":"crear_descuento_compensacion_masivo","arguments":"p_criterio text, p_criterio_id uuid, p_motivo text, p_monto numeric, p_porcentaje numeric","proconfig":["search_path=public"],"prosecdef":true,"body_lf_md5":"41fd2a9b59106c76898dfac0bebc7501"}]},"preflight":{"rls":{"acl":"{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}","forced":false,"enabled":true},"owner":"postgres","indexes":[{"indexdef":"CREATE INDEX idx_olt_onts_client ON public.olt_onts USING btree (client_id)","indexname":"idx_olt_onts_client"},{"indexdef":"CREATE INDEX idx_olt_onts_contract ON public.olt_onts USING btree (contract_id) WHERE (contract_id IS NOT NULL)","indexname":"idx_olt_onts_contract"},{"indexdef":"CREATE INDEX idx_olt_onts_device ON public.olt_onts USING btree (olt_device_id)","indexname":"idx_olt_onts_device"},{"indexdef":"CREATE INDEX idx_olt_onts_zone ON public.olt_onts USING btree (zone_id) WHERE (zone_id IS NOT NULL)","indexname":"idx_olt_onts_zone"},{"indexdef":"CREATE UNIQUE INDEX olt_onts_olt_device_id_frame_slot_port_ont_id_key ON public.olt_onts USING btree (olt_device_id, frame, slot, port, ont_id)","indexname":"olt_onts_olt_device_id_frame_slot_port_ont_id_key"},{"indexdef":"CREATE UNIQUE INDEX olt_onts_pkey ON public.olt_onts USING btree (id)","indexname":"olt_onts_pkey"}],"policies":null,"name_collisions":{"guard":null,"serial_index":null,"position_index":null},"contract_triggers":[{"tgname":"trg_service_contracts_free_nap_puerto","function":"CREATE OR REPLACE FUNCTION public.free_nap_puerto_on_contract_delete()\n RETURNS trigger\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'public'\nAS $function$\nbegin\n  update public.fo_nap_puertos\n  set\n    estado = 'libre',\n    client_id = null,\n    contract_id = null,\n    notes = trim(both ' | ' from coalesce(notes || ' | ', '')\n      || 'Fase 156: liberado automaticamente al eliminar el contrato '\n      || old.id::text || ' (' || to_char(now(), 'YYYY-MM-DD HH24:MI') || ')')\n  where contract_id = old.id\n    and estado = 'ocupado';\n  return old;\nend;\n$function$\n","definition":"CREATE TRIGGER trg_service_contracts_free_nap_puerto BEFORE DELETE ON public.service_contracts FOR EACH ROW EXECUTE FUNCTION free_nap_puerto_on_contract_delete()"},{"tgname":"trg_service_contracts_number","function":"CREATE OR REPLACE FUNCTION public.set_contract_number()\n RETURNS trigger\n LANGUAGE plpgsql\nAS $function$\r\nbegin\r\n  if new.contract_number is null then\r\n    new.contract_number := public.generate_contract_number();\r\n  end if;\r\n  return new;\r\nend;\r\n$function$\n","definition":"CREATE TRIGGER trg_service_contracts_number BEFORE INSERT ON public.service_contracts FOR EACH ROW EXECUTE FUNCTION set_contract_number()"},{"tgname":"trg_service_contracts_updated_at","function":"CREATE OR REPLACE FUNCTION public.set_updated_at()\n RETURNS trigger\n LANGUAGE plpgsql\nAS $function$\r\nbegin\r\n  new.updated_at = now();\r\n  return new;\r\nend;\r\n$function$\n","definition":"CREATE TRIGGER trg_service_contracts_updated_at BEFORE UPDATE ON public.service_contracts FOR EACH ROW EXECUTE FUNCTION set_updated_at()"}],"duplicate_serials":null,"duplicate_positions":null,"related_constraints":[{"conname":"inventory_units_client_id_fkey","definition":"FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL","table_name":"inventory_units","reference_table":"clients"},{"conname":"inventory_units_contract_id_fkey","definition":"FOREIGN KEY (contract_id) REFERENCES service_contracts(id) ON DELETE SET NULL","table_name":"inventory_units","reference_table":"service_contracts"},{"conname":"inventory_units_created_by_fkey","definition":"FOREIGN KEY (created_by) REFERENCES profiles(id)","table_name":"inventory_units","reference_table":"profiles"},{"conname":"inventory_units_custody_technician_id_fkey","definition":"FOREIGN KEY (custody_technician_id) REFERENCES profiles(id)","table_name":"inventory_units","reference_table":"profiles"},{"conname":"inventory_units_identifier_chk","definition":"CHECK (((serial_number IS NOT NULL) OR (mac_address IS NOT NULL)))","table_name":"inventory_units","reference_table":"-"},{"conname":"inventory_units_installation_id_fkey","definition":"FOREIGN KEY (installation_id) REFERENCES installations(id) ON DELETE SET NULL","table_name":"inventory_units","reference_table":"installations"},{"conname":"inventory_units_pending_pickup_by_fkey","definition":"FOREIGN KEY (pending_pickup_by) REFERENCES profiles(id)","table_name":"inventory_units","reference_table":"profiles"},{"conname":"inventory_units_pkey","definition":"PRIMARY KEY (id)","table_name":"inventory_units","reference_table":"-"},{"conname":"inventory_units_product_id_fkey","definition":"FOREIGN KEY (product_id) REFERENCES inventory_products(id) ON DELETE CASCADE","table_name":"inventory_units","reference_table":"inventory_products"},{"conname":"inventory_units_routine_id_fkey","definition":"FOREIGN KEY (routine_id) REFERENCES routines(id) ON DELETE RESTRICT","table_name":"inventory_units","reference_table":"routines"},{"conname":"inventory_units_ticket_id_fkey","definition":"FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE SET NULL","table_name":"inventory_units","reference_table":"tickets"},{"conname":"olt_alert_log_client_id_fkey","definition":"FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL","table_name":"olt_alert_log","reference_table":"clients"},{"conname":"olt_alert_log_contract_id_fkey","definition":"FOREIGN KEY (contract_id) REFERENCES service_contracts(id) ON DELETE SET NULL","table_name":"olt_alert_log","reference_table":"service_contracts"},{"conname":"olt_alert_log_kind_check","definition":"CHECK ((kind = ANY (ARRAY['offline'::text, 'recovered'::text, 'lowSignal'::text, 'signalRecovered'::text])))","table_name":"olt_alert_log","reference_table":"-"},{"conname":"olt_alert_log_olt_device_id_fkey","definition":"FOREIGN KEY (olt_device_id) REFERENCES olt_devices(id) ON DELETE CASCADE","table_name":"olt_alert_log","reference_table":"olt_devices"},{"conname":"olt_alert_log_olt_ont_id_fkey","definition":"FOREIGN KEY (olt_ont_id) REFERENCES olt_onts(id) ON DELETE SET NULL","table_name":"olt_alert_log","reference_table":"olt_onts"},{"conname":"olt_alert_log_pkey","definition":"PRIMARY KEY (id)","table_name":"olt_alert_log","reference_table":"-"},{"conname":"olt_provisioning_operations_client_id_fkey","definition":"FOREIGN KEY (client_id) REFERENCES clients(id)","table_name":"olt_provisioning_operations","reference_table":"clients"},{"conname":"olt_provisioning_operations_contract_id_fkey","definition":"FOREIGN KEY (contract_id) REFERENCES service_contracts(id)","table_name":"olt_provisioning_operations","reference_table":"service_contracts"},{"conname":"olt_provisioning_operations_olt_device_id_fkey","definition":"FOREIGN KEY (olt_device_id) REFERENCES olt_devices(id) ON DELETE CASCADE","table_name":"olt_provisioning_operations","reference_table":"olt_devices"},{"conname":"olt_provisioning_operations_olt_device_id_idempotency_key_key","definition":"UNIQUE (olt_device_id, idempotency_key)","table_name":"olt_provisioning_operations","reference_table":"-"},{"conname":"olt_provisioning_operations_ont_db_id_fkey","definition":"FOREIGN KEY (ont_db_id) REFERENCES olt_onts(id) ON DELETE SET NULL","table_name":"olt_provisioning_operations","reference_table":"olt_onts"},{"conname":"olt_provisioning_operations_pkey","definition":"PRIMARY KEY (id)","table_name":"olt_provisioning_operations","reference_table":"-"},{"conname":"olt_provisioning_operations_status_check","definition":"CHECK ((status = ANY (ARRAY['pending'::text, 'olt_uncertain'::text, 'olt_verify_failed'::text, 'olt_registered'::text, 'linking'::text, 'mikrotik_pending'::text, 'completed'::text, 'failed'::text])))","table_name":"olt_provisioning_operations","reference_table":"-"},{"conname":"service_contracts_billing_day_check","definition":"CHECK (((billing_day >= 1) AND (billing_day <= 31)))","table_name":"service_contracts","reference_table":"-"},{"conname":"service_contracts_client_id_fkey","definition":"FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE","table_name":"service_contracts","reference_table":"clients"},{"conname":"service_contracts_contract_number_key","definition":"UNIQUE (contract_number)","table_name":"service_contracts","reference_table":"-"},{"conname":"service_contracts_debt_hold_invoice_id_fkey","definition":"FOREIGN KEY (debt_hold_invoice_id) REFERENCES invoices(id) ON DELETE SET NULL","table_name":"service_contracts","reference_table":"invoices"},{"conname":"service_contracts_mikrotik_device_id_fkey","definition":"FOREIGN KEY (mikrotik_device_id) REFERENCES mikrotik_devices(id)","table_name":"service_contracts","reference_table":"mikrotik_devices"},{"conname":"service_contracts_pkey","definition":"PRIMARY KEY (id)","table_name":"service_contracts","reference_table":"-"},{"conname":"service_contracts_plan_id_fkey","definition":"FOREIGN KEY (plan_id) REFERENCES plans(id)","table_name":"service_contracts","reference_table":"plans"},{"conname":"service_contracts_priority_check","definition":"CHECK ((priority = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text])))","table_name":"service_contracts","reference_table":"-"},{"conname":"service_contracts_zone_id_fkey","definition":"FOREIGN KEY (zone_id) REFERENCES zones(id)","table_name":"service_contracts","reference_table":"zones"}]}}$expected_603be2a24dde$::jsonb then 1 else 0 end) as schema_unchanged;
select (select coalesce(jsonb_agg(to_jsonb(o)-'retired_at' order by id),'[]'::jsonb) from public.olt_onts o)::text as before_onts \gset
select (select jsonb_build_object('clients',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text) from public.clients t),'contracts',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text) from public.service_contracts t),'inventory',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text) from public.inventory_units t),'invoices',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text) from public.invoices t)))::text as before_protected \gset
select md5(coalesce(jsonb_agg(to_jsonb(m) order by version),'[]'::jsonb)::text) as before_ledger from supabase_migrations.schema_migrations m \gset
\o /out/onts-before.private.json
select coalesce(jsonb_agg(to_jsonb(o)-'retired_at' order by id),'[]'::jsonb) from public.olt_onts o;
\o /out/protected-before.json
select jsonb_build_object('clients',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text) from public.clients t),'contracts',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text) from public.service_contracts t),'inventory',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text) from public.inventory_units t),'invoices',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text) from public.invoices t));
\o /out/catalog-transaction-before.json
select jsonb_build_object('schema',(s::jsonb->'schema')-'read_only','functions',(s::jsonb->'functions')-'read_only','preflight',(s::jsonb->'preflight')-'captured_at'-'onts'-'read_only') from (select json_build_object('schema',(
select json_build_object(
 'read_only',current_setting('transaction_read_only'),
 'columns',(select json_agg(x) from (select column_name,data_type,is_nullable,column_default,udt_name from information_schema.columns where table_schema='public' and table_name='olt_onts' order by ordinal_position)x),
 'constraints',(select json_agg(x) from (select conname,conrelid::regclass::text as table_name,confrelid::regclass::text as reference_table,pg_get_constraintdef(oid) as definition from pg_constraint where conrelid='public.olt_onts'::regclass or confrelid='public.olt_onts'::regclass order by conname)x),
 'triggers',(select json_agg(x) from (select tgname,pg_get_triggerdef(oid) as definition,pg_get_functiondef(tgfoid) as function from pg_trigger where tgrelid='public.olt_onts'::regclass and not tgisinternal order by tgname)x),
 'status_values',(select json_agg(enumlabel order by enumsortorder) from pg_enum where enumtypid='public.ont_status'::regtype)
)),'functions',(
select json_build_object('read_only',current_setting('transaction_read_only'),
 'functions',(select json_agg(x) from (select p.proname,pg_get_function_identity_arguments(p.oid) as arguments,
 p.prosrc,p.prosecdef,p.proconfig,p.proacl::text as grants,pg_get_userbyid(p.proowner) as owner,
 md5(replace(p.prosrc,E'\r\n',E'\n')) as body_lf_md5
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('crear_descuento_compensacion_masivo','assign_contract_nap_sync_ont_zone') order by p.proname)x))),'preflight',(select json_build_object('captured_at',transaction_timestamp(),'read_only',current_setting('transaction_read_only'),
'indexes',(select json_agg(x) from (select indexname,indexdef from pg_indexes where schemaname='public' and tablename='olt_onts' order by indexname)x),
'policies',(select json_agg(x) from (select * from pg_policies where schemaname='public' and tablename='olt_onts' order by policyname)x),
'owner',(select pg_get_userbyid(relowner) from pg_class where oid='public.olt_onts'::regclass),
'rls',(select json_build_object('enabled',relrowsecurity,'forced',relforcerowsecurity,'acl',relacl::text) from pg_class where oid='public.olt_onts'::regclass),
'related_constraints',(select json_agg(x) from (select conname,conrelid::regclass::text as table_name,confrelid::regclass::text as reference_table,pg_get_constraintdef(oid) as definition from pg_constraint where conrelid in ('public.inventory_units'::regclass,'public.service_contracts'::regclass,'public.olt_alert_log'::regclass,'public.olt_provisioning_operations'::regclass) order by conrelid::regclass::text,conname)x),
'contract_triggers',(select json_agg(x) from (select tgname,pg_get_triggerdef(oid) as definition,pg_get_functiondef(tgfoid) as function from pg_trigger where tgrelid='public.service_contracts'::regclass and not tgisinternal order by tgname)x),
'duplicate_serials',(select json_agg(x) from (select olt_device_id,upper(btrim(serial)) as serial,count(*) from public.olt_onts group by olt_device_id,upper(btrim(serial)) having count(*)>1)x),
'duplicate_positions',(select json_agg(x) from (select olt_device_id,frame,slot,port,ont_id,count(*) from public.olt_onts group by olt_device_id,frame,slot,port,ont_id having count(*)>1)x),
'name_collisions',json_build_object('guard',to_regprocedure('public.guard_olt_ont_retirement()')::text,'serial_index',to_regclass('public.olt_onts_active_serial_key')::text,'position_index',to_regclass('public.olt_onts_active_position_key')::text),
'onts',(select json_agg(o order by id) from public.olt_onts o where id in ('a1f0b671-a1e2-482c-b24e-7e584bf0e4ed','74d586e3-3a0a-40c2-aba3-46294adcf095','76701eb5-405e-462f-862d-384a469cadac') or upper(btrim(serial)) in ('MSTC8CCE647E','HWTCDEB847B6','HWTCE5C94DB6','HWTC5C94DB6')))))) q(s);
\o

do $$ begin
 if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('public.assign_contract_nap_sync_ont_zone(uuid,uuid,uuid)')) is distinct from '61dc572f18d1101144b49d8bef3af38a'
 or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('public.crear_descuento_compensacion_masivo(text,uuid,text,numeric,numeric)')) is distinct from '41fd2a9b59106c76898dfac0bebc7501' then
  raise exception 'SQL reader definitions differ from verified baseline; do not overwrite';
 end if;
end $$;
alter table public.olt_onts add column retired_at timestamptz;
comment on column public.olt_onts.retired_at is 'Historical ONT, not an active position. Coordinates and client/contract references retain historical identity; never operate on this position through a retired identity.';

create function public.guard_olt_ont_retirement() returns trigger
language plpgsql set search_path=pg_catalog,public,pg_temp as $$
begin
 if tg_op='DELETE' then
  if old.retired_at is not null then raise exception 'Retired ONT history cannot be deleted' using errcode='55000'; end if;
  return old;
 end if;
 if tg_op='UPDATE' and (old.retired_at is not null or new.retired_at is not null) then
  if (to_jsonb(new)-'retired_at'-'updated_at') is distinct from (to_jsonb(old)-'retired_at'-'updated_at') then
   raise exception 'Retirement cannot rewrite historical identity, metadata or telemetry' using errcode='55000';
  end if;
 end if;
 return new;
end $$;
revoke all on function public.guard_olt_ont_retirement() from public;
create trigger trg_olt_onts_retirement before insert or update or delete on public.olt_onts
for each row execute function public.guard_olt_ont_retirement();
-- Old unconditional UNIQUE stays intact until all readers/writers support retirement.
create or replace function public.crear_descuento_compensacion_masivo(
  p_criterio text,
  p_criterio_id uuid,
  p_motivo text,
  p_monto numeric default null,
  p_porcentaje numeric default null
)
returns table (lote_id uuid, clientes_afectados int)
language plpgsql
security definer set search_path = public
as $$
declare
  v_lote_id uuid;
  v_client_id uuid;
  v_contract_id uuid;
  v_ont_count int;
  v_monthly numeric(10, 2);
  v_monto_cliente numeric(10, 2);
  v_count int := 0;
begin
  if public.current_user_role() not in ('SUPERADMIN', 'ADMIN') then
    raise exception 'Solo ADMIN/SUPERADMIN pueden aplicar descuentos por averia masiva';
  end if;
  if p_criterio not in ('zona', 'olt', 'nap') then
    raise exception 'Criterio invalido: %', p_criterio;
  end if;
  if (p_monto is null) = (p_porcentaje is null) then
    raise exception 'Indica exactamente uno: monto fijo o porcentaje';
  end if;

  insert into public.descuentos_compensacion_lotes (criterio, criterio_id, motivo, monto, porcentaje)
  values (p_criterio, p_criterio_id, p_motivo, p_monto, p_porcentaje)
  returning id into v_lote_id;

  for v_client_id in
    select distinct c.id
      from public.clients c
     where (p_criterio = 'zona' and c.zone_id = p_criterio_id)
        or (p_criterio = 'olt' and exists (
              select 1 from public.olt_onts o where o.retired_at is null and o.client_id = c.id and o.olt_device_id = p_criterio_id
            ))
        or (p_criterio = 'nap' and exists (
              select 1 from public.fo_nap_puertos n where n.client_id = c.id and n.infra_elemento_id = p_criterio_id
            ))
  loop
    v_contract_id := null;

    if p_criterio = 'olt' then
      -- Solo se resuelve el contrato si hay exactamente UN ont de este
      -- cliente en esta OLT (y ese ont ya tiene contract_id, Fase 37).
      select count(*) into v_ont_count
        from public.olt_onts o
       where o.retired_at is null and o.client_id = v_client_id and o.olt_device_id = p_criterio_id;

      if v_ont_count = 1 then
        select o.contract_id into v_contract_id
          from public.olt_onts o
         where o.retired_at is null and o.client_id = v_client_id and o.olt_device_id = p_criterio_id;
      end if;
    end if;

    if p_porcentaje is not null then
      if v_contract_id is not null then
        select monthly_fee into v_monthly from public.service_contracts where id = v_contract_id;
      end if;
      if v_monthly is null then
        select monthly_fee into v_monthly
          from public.service_contracts
         where client_id = v_client_id and status = 'active'
         order by created_at desc
         limit 1;
      end if;
      if v_monthly is null then
        continue; -- sin contrato activo, no hay mensualidad de la que sacar el %
      end if;
      v_monto_cliente := round(v_monthly * p_porcentaje / 100, 2);
    else
      v_monto_cliente := p_monto;
    end if;

    if v_monto_cliente > 0 then
      insert into public.descuentos_compensacion (client_id, contract_id, monto, motivo, lote_id)
      values (v_client_id, v_contract_id, v_monto_cliente, p_motivo, v_lote_id);
      v_count := v_count + 1;
    end if;

    v_monthly := null;
  end loop;

  update public.descuentos_compensacion_lotes set clientes_afectados = v_count where id = v_lote_id;

  return query select v_lote_id, v_count;
end;
$$;

create or replace function public.assign_contract_nap_sync_ont_zone(
  p_nap_id uuid, p_contract_id uuid, p_client_id uuid
) returns table (nap_port_id uuid, ont_zone_synced boolean, ont_zone_skip_reason text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_nap_result uuid;
  v_zone_id uuid;
  v_ont_count int;
  v_ont_id uuid;
  v_ont_zone_id uuid;
  v_synced boolean := false;
  v_skip_reason text := null;
begin
  v_role := public.current_user_role()::text;
  if v_role is null or v_role not in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED') then
    raise exception 'No tienes permisos para esta accion' using errcode = '42501';
  end if;

  v_nap_result := public.assign_provisioning_nap(p_nap_id, p_contract_id, p_client_id);

  select zone_id into v_zone_id from public.service_contracts where id = p_contract_id;

  select count(*), (array_agg(id))[1] into v_ont_count, v_ont_id
    from public.olt_onts where retired_at is null and contract_id = p_contract_id;

  if v_ont_count = 0 then
    v_skip_reason := 'sin_ont_vinculada';
  elsif v_ont_count > 1 then
    v_skip_reason := 'ambiguo:' || v_ont_count::text;
  else
    select zone_id into v_ont_zone_id from public.olt_onts where retired_at is null and id = v_ont_id;
    if v_ont_zone_id is distinct from v_zone_id then
      update public.olt_onts set zone_id = v_zone_id where retired_at is null and id = v_ont_id;
    end if;
    v_synced := true;
  end if;

  return query select v_nap_result, v_synced, v_skip_reason;
end;
$$;

-- Prove unchanged rows and guarded metadata BEFORE the sole COMMIT.
select 1/(case when not exists(select 1 from public.olt_onts where retired_at is not null) then 1 else 0 end) as all_retirements_null;
select 1/(case when (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='public.assign_contract_nap_sync_ont_zone(uuid,uuid,uuid)'::regprocedure)='24ceab68fa6e491605b4058995362177'
and (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='public.crear_descuento_compensacion_masivo(text,uuid,text,numeric,numeric)'::regprocedure)='f7be06d3bea298ff396c9a6f3bc30a29' then 1 else 0 end) as expected_reader_bodies;
select 1/(case when to_regclass('public.olt_onts_active_serial_key') is null and to_regclass('public.olt_onts_active_position_key') is null
and exists(select 1 from pg_constraint where conrelid='public.olt_onts'::regclass and conname='olt_onts_olt_device_id_frame_slot_port_ont_id_key' and contype='u') then 1 else 0 end) as original_uniqueness_kept;
select 1/(case when (select coalesce(jsonb_agg(to_jsonb(o)-'retired_at' order by id),'[]'::jsonb) from public.olt_onts o)=:'before_onts'::jsonb then 1 else 0 end) as exact_ont_rows_preserved;
select 1/(case when (select jsonb_build_object('clients',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text) from public.clients t),'contracts',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text) from public.service_contracts t),'inventory',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text) from public.inventory_units t),'invoices',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text) from public.invoices t)))=:'before_protected'::jsonb then 1 else 0 end) as protected_business_rows_preserved;
select 1/(case when (select md5(coalesce(jsonb_agg(to_jsonb(m) order by version),'[]'::jsonb)::text) from supabase_migrations.schema_migrations m)=:'before_ledger' then 1 else 0 end) as existing_ledger_preserved;
insert into supabase_migrations.schema_migrations(version,name,statements) values('20261021170000','olt_retirement_expand',ARRAY[$expected_75fcdafd8574$"-- CANDIDATE ONLY. Expand first; no retirement/data reconciliation in this migration.\nbegin;\nset local lock_timeout='2s';\nset local statement_timeout='30s';\ndo $$ begin\n if (select md5(replace(prosrc,E'\\r\\n',E'\\n')) from pg_proc where oid=to_regprocedure('public.assign_contract_nap_sync_ont_zone(uuid,uuid,uuid)')) is distinct from '61dc572f18d1101144b49d8bef3af38a'\n or (select md5(replace(prosrc,E'\\r\\n',E'\\n')) from pg_proc where oid=to_regprocedure('public.crear_descuento_compensacion_masivo(text,uuid,text,numeric,numeric)')) is distinct from '41fd2a9b59106c76898dfac0bebc7501' then\n  raise exception 'SQL reader definitions differ from verified baseline; do not overwrite';\n end if;\nend $$;\nalter table public.olt_onts add column retired_at timestamptz;\ncomment on column public.olt_onts.retired_at is 'Historical ONT, not an active position. Coordinates and client/contract references retain historical identity; never operate on this position through a retired identity.';\n\ncreate function public.guard_olt_ont_retirement() returns trigger\nlanguage plpgsql set search_path=pg_catalog,public,pg_temp as $$\nbegin\n if tg_op='DELETE' then\n  if old.retired_at is not null then raise exception 'Retired ONT history cannot be deleted' using errcode='55000'; end if;\n  return old;\n end if;\n if tg_op='UPDATE' and (old.retired_at is not null or new.retired_at is not null) then\n  if (to_jsonb(new)-'retired_at'-'updated_at') is distinct from (to_jsonb(old)-'retired_at'-'updated_at') then\n   raise exception 'Retirement cannot rewrite historical identity, metadata or telemetry' using errcode='55000';\n  end if;\n end if;\n return new;\nend $$;\nrevoke all on function public.guard_olt_ont_retirement() from public;\ncreate trigger trg_olt_onts_retirement before insert or update or delete on public.olt_onts\nfor each row execute function public.guard_olt_ont_retirement();\n-- Old unconditional UNIQUE stays intact until all readers/writers support retirement.\ncreate or replace function public.crear_descuento_compensacion_masivo(\n  p_criterio text,\n  p_criterio_id uuid,\n  p_motivo text,\n  p_monto numeric default null,\n  p_porcentaje numeric default null\n)\nreturns table (lote_id uuid, clientes_afectados int)\nlanguage plpgsql\nsecurity definer set search_path = public\nas $$\ndeclare\n  v_lote_id uuid;\n  v_client_id uuid;\n  v_contract_id uuid;\n  v_ont_count int;\n  v_monthly numeric(10, 2);\n  v_monto_cliente numeric(10, 2);\n  v_count int := 0;\nbegin\n  if public.current_user_role() not in ('SUPERADMIN', 'ADMIN') then\n    raise exception 'Solo ADMIN/SUPERADMIN pueden aplicar descuentos por averia masiva';\n  end if;\n  if p_criterio not in ('zona', 'olt', 'nap') then\n    raise exception 'Criterio invalido: %', p_criterio;\n  end if;\n  if (p_monto is null) = (p_porcentaje is null) then\n    raise exception 'Indica exactamente uno: monto fijo o porcentaje';\n  end if;\n\n  insert into public.descuentos_compensacion_lotes (criterio, criterio_id, motivo, monto, porcentaje)\n  values (p_criterio, p_criterio_id, p_motivo, p_monto, p_porcentaje)\n  returning id into v_lote_id;\n\n  for v_client_id in\n    select distinct c.id\n      from public.clients c\n     where (p_criterio = 'zona' and c.zone_id = p_criterio_id)\n        or (p_criterio = 'olt' and exists (\n              select 1 from public.olt_onts o where o.retired_at is null and o.client_id = c.id and o.olt_device_id = p_criterio_id\n            ))\n        or (p_criterio = 'nap' and exists (\n              select 1 from public.fo_nap_puertos n where n.client_id = c.id and n.infra_elemento_id = p_criterio_id\n            ))\n  loop\n    v_contract_id := null;\n\n    if p_criterio = 'olt' then\n      -- Solo se resuelve el contrato si hay exactamente UN ont de este\n      -- cliente en esta OLT (y ese ont ya tiene contract_id, Fase 37).\n      select count(*) into v_ont_count\n        from public.olt_onts o\n       where o.retired_at is null and o.client_id = v_client_id and o.olt_device_id = p_criterio_id;\n\n      if v_ont_count = 1 then\n        select o.contract_id into v_contract_id\n          from public.olt_onts o\n         where o.retired_at is null and o.client_id = v_client_id and o.olt_device_id = p_criterio_id;\n      end if;\n    end if;\n\n    if p_porcentaje is not null then\n      if v_contract_id is not null then\n        select monthly_fee into v_monthly from public.service_contracts where id = v_contract_id;\n      end if;\n      if v_monthly is null then\n        select monthly_fee into v_monthly\n          from public.service_contracts\n         where client_id = v_client_id and status = 'active'\n         order by created_at desc\n         limit 1;\n      end if;\n      if v_monthly is null then\n        continue; -- sin contrato activo, no hay mensualidad de la que sacar el %\n      end if;\n      v_monto_cliente := round(v_monthly * p_porcentaje / 100, 2);\n    else\n      v_monto_cliente := p_monto;\n    end if;\n\n    if v_monto_cliente > 0 then\n      insert into public.descuentos_compensacion (client_id, contract_id, monto, motivo, lote_id)\n      values (v_client_id, v_contract_id, v_monto_cliente, p_motivo, v_lote_id);\n      v_count := v_count + 1;\n    end if;\n\n    v_monthly := null;\n  end loop;\n\n  update public.descuentos_compensacion_lotes set clientes_afectados = v_count where id = v_lote_id;\n\n  return query select v_lote_id, v_count;\nend;\n$$;\n\ncreate or replace function public.assign_contract_nap_sync_ont_zone(\n  p_nap_id uuid, p_contract_id uuid, p_client_id uuid\n) returns table (nap_port_id uuid, ont_zone_synced boolean, ont_zone_skip_reason text)\nlanguage plpgsql\nsecurity definer\nset search_path = public, pg_temp\nas $$\ndeclare\n  v_role text;\n  v_nap_result uuid;\n  v_zone_id uuid;\n  v_ont_count int;\n  v_ont_id uuid;\n  v_ont_zone_id uuid;\n  v_synced boolean := false;\n  v_skip_reason text := null;\nbegin\n  v_role := public.current_user_role()::text;\n  if v_role is null or v_role not in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED') then\n    raise exception 'No tienes permisos para esta accion' using errcode = '42501';\n  end if;\n\n  v_nap_result := public.assign_provisioning_nap(p_nap_id, p_contract_id, p_client_id);\n\n  select zone_id into v_zone_id from public.service_contracts where id = p_contract_id;\n\n  select count(*), (array_agg(id))[1] into v_ont_count, v_ont_id\n    from public.olt_onts where retired_at is null and contract_id = p_contract_id;\n\n  if v_ont_count = 0 then\n    v_skip_reason := 'sin_ont_vinculada';\n  elsif v_ont_count > 1 then\n    v_skip_reason := 'ambiguo:' || v_ont_count::text;\n  else\n    select zone_id into v_ont_zone_id from public.olt_onts where retired_at is null and id = v_ont_id;\n    if v_ont_zone_id is distinct from v_zone_id then\n      update public.olt_onts set zone_id = v_zone_id where retired_at is null and id = v_ont_id;\n    end if;\n    v_synced := true;\n  end if;\n\n  return query select v_nap_result, v_synced, v_skip_reason;\nend;\n$$;\ncommit;\n"$expected_75fcdafd8574$::jsonb#>>'{}']);
\o /out/catalog-transaction-after.json
select jsonb_build_object('schema',(s::jsonb->'schema')-'read_only','functions',(s::jsonb->'functions')-'read_only','preflight',(s::jsonb->'preflight')-'captured_at'-'onts'-'read_only') from (select json_build_object('schema',(
select json_build_object(
 'read_only',current_setting('transaction_read_only'),
 'columns',(select json_agg(x) from (select column_name,data_type,is_nullable,column_default,udt_name from information_schema.columns where table_schema='public' and table_name='olt_onts' order by ordinal_position)x),
 'constraints',(select json_agg(x) from (select conname,conrelid::regclass::text as table_name,confrelid::regclass::text as reference_table,pg_get_constraintdef(oid) as definition from pg_constraint where conrelid='public.olt_onts'::regclass or confrelid='public.olt_onts'::regclass order by conname)x),
 'triggers',(select json_agg(x) from (select tgname,pg_get_triggerdef(oid) as definition,pg_get_functiondef(tgfoid) as function from pg_trigger where tgrelid='public.olt_onts'::regclass and not tgisinternal order by tgname)x),
 'status_values',(select json_agg(enumlabel order by enumsortorder) from pg_enum where enumtypid='public.ont_status'::regtype)
)),'functions',(
select json_build_object('read_only',current_setting('transaction_read_only'),
 'functions',(select json_agg(x) from (select p.proname,pg_get_function_identity_arguments(p.oid) as arguments,
 p.prosrc,p.prosecdef,p.proconfig,p.proacl::text as grants,pg_get_userbyid(p.proowner) as owner,
 md5(replace(p.prosrc,E'\r\n',E'\n')) as body_lf_md5
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('crear_descuento_compensacion_masivo','assign_contract_nap_sync_ont_zone') order by p.proname)x))),'preflight',(select json_build_object('captured_at',transaction_timestamp(),'read_only',current_setting('transaction_read_only'),
'indexes',(select json_agg(x) from (select indexname,indexdef from pg_indexes where schemaname='public' and tablename='olt_onts' order by indexname)x),
'policies',(select json_agg(x) from (select * from pg_policies where schemaname='public' and tablename='olt_onts' order by policyname)x),
'owner',(select pg_get_userbyid(relowner) from pg_class where oid='public.olt_onts'::regclass),
'rls',(select json_build_object('enabled',relrowsecurity,'forced',relforcerowsecurity,'acl',relacl::text) from pg_class where oid='public.olt_onts'::regclass),
'related_constraints',(select json_agg(x) from (select conname,conrelid::regclass::text as table_name,confrelid::regclass::text as reference_table,pg_get_constraintdef(oid) as definition from pg_constraint where conrelid in ('public.inventory_units'::regclass,'public.service_contracts'::regclass,'public.olt_alert_log'::regclass,'public.olt_provisioning_operations'::regclass) order by conrelid::regclass::text,conname)x),
'contract_triggers',(select json_agg(x) from (select tgname,pg_get_triggerdef(oid) as definition,pg_get_functiondef(tgfoid) as function from pg_trigger where tgrelid='public.service_contracts'::regclass and not tgisinternal order by tgname)x),
'duplicate_serials',(select json_agg(x) from (select olt_device_id,upper(btrim(serial)) as serial,count(*) from public.olt_onts group by olt_device_id,upper(btrim(serial)) having count(*)>1)x),
'duplicate_positions',(select json_agg(x) from (select olt_device_id,frame,slot,port,ont_id,count(*) from public.olt_onts group by olt_device_id,frame,slot,port,ont_id having count(*)>1)x),
'name_collisions',json_build_object('guard',to_regprocedure('public.guard_olt_ont_retirement()')::text,'serial_index',to_regclass('public.olt_onts_active_serial_key')::text,'position_index',to_regclass('public.olt_onts_active_position_key')::text),
'onts',(select json_agg(o order by id) from public.olt_onts o where id in ('a1f0b671-a1e2-482c-b24e-7e584bf0e4ed','74d586e3-3a0a-40c2-aba3-46294adcf095','76701eb5-405e-462f-862d-384a469cadac') or upper(btrim(serial)) in ('MSTC8CCE647E','HWTCDEB847B6','HWTCE5C94DB6','HWTC5C94DB6')))))) q(s);
\o /out/extra-transaction-after.json
\i /scripts/extra-catalog.sql
\o /out/onts-after.private.json
select coalesce(jsonb_agg(to_jsonb(o)-'retired_at' order by id),'[]'::jsonb) from public.olt_onts o;
\o /out/protected-after.json
select jsonb_build_object('clients',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text) from public.clients t),'contracts',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text) from public.service_contracts t),'inventory',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text) from public.inventory_units t),'invoices',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text) from public.invoices t));
\o /out/ledger-transaction-after.json
\i /scripts/ledger-read.sql
\o

-- Local expected-state capture.
commit;
