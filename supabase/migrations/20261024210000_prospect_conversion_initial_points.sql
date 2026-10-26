-- CANDIDATA: depende de 180000 -> 190000 -> 200000. No aplicar sin autorización.
-- Solo conversiones NUEVAS; no backfill, cambios de históricos ni reglas de facturación.
begin;

create table public.prospect_conversion_receipts (
  prospect_id uuid primary key references public.prospects(id),
  client_id uuid not null unique references public.clients(id),
  contract_id uuid not null unique references public.service_contracts(id),
  installation_id uuid not null unique references public.installations(id) deferrable initially deferred,
  requested_by uuid not null references public.profiles(id),
  request_hash text not null,
  created_at timestamptz not null default clock_timestamp()
);
alter table public.prospect_conversion_receipts enable row level security;
revoke all on public.prospect_conversion_receipts from public,anon,authenticated,service_role;

-- El recibo solo lo escribe la RPC propietaria, nunca un flag enviado por el cliente.
create function public.is_prospect_conversion_installation(p_id uuid,p_client_id uuid,p_contract_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.prospect_conversion_receipts r
    where r.installation_id=p_id and r.client_id=p_client_id and r.contract_id=p_contract_id);
$$;
revoke all on function public.is_prospect_conversion_installation(uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- La restricción admite 0 a nivel de tipo; el trigger exige el origen privado exacto.
alter table public.installations drop constraint installations_points_check;
alter table public.installations add constraint installations_points_check
  check(points>=0 and points<'Infinity'::numeric);

create or replace function public.guard_work_order_points() returns trigger
language plpgsql security definer set search_path=public as $$
declare v_reason text; v_role text; kind text; done timestamptz; prospect_zero boolean:=false;
begin
  if tg_table_name='installations' then
    prospect_zero:=public.is_prospect_conversion_installation(new.id,new.client_id,new.contract_id);
    if new.points=0 then
      if not prospect_zero then raise exception 'Cero puntos solo para un Alta creada por conversión atómica de Prospecto'; end if;
      if tg_op='UPDATE' and old.points is distinct from new.points then
        raise exception 'Los puntos solo pueden ser cero al crear el Alta de Prospecto';
      end if;
      if tg_op='INSERT' then return new; end if;
    end if;
  end if;
  if tg_op='INSERT' then
    if new.points is null or not(new.points>0 and new.points<'Infinity'::numeric) then raise exception 'La orden requiere puntos mayores a 0'; end if;
    return new;
  end if;
  if new.points is not distinct from old.points then return new; end if;
  select role::text into v_role from public.profiles where id=auth.uid() and active;
  if v_role is null or v_role not in ('ADMIN','SUPERADMIN') then raise exception 'Solo ADMIN/SUPERADMIN puede ajustar puntos'; end if;
  kind:=case tg_table_name when 'tickets' then 'ticket' when 'installations' then 'installation' else 'routine' end;
  if old.status::text='cancelled' or new.status::text='cancelled' then raise exception 'La orden está cancelada'; end if;
  if exists(select 1 from public.work_order_point_confirmations c where c.job_type=kind and c.job_id=old.id) then
    raise exception 'Los puntos ya están confirmados';
  end if;
  done:=case when kind='ticket' then coalesce((to_jsonb(old)->>'resolved_at')::timestamptz,(to_jsonb(old)->>'closed_at')::timestamptz)
    else (to_jsonb(old)->>'completed_at')::timestamptz end;
  -- Única transición adicional: un cero NUEVO acreditado por recibo -> positivo.
  if done is not null and (done<timestamptz '2026-11-01 00:00:00 America/Lima' or (to_jsonb(old)->>'created_at')::timestamptz<timestamptz '2026-11-01 00:00:00 America/Lima')
     and not(kind='installation' and prospect_zero and old.points=0) then
    raise exception 'No se modifican puntos históricos de octubre';
  end if;
  if new.points is null or not(new.points>0 and new.points<'Infinity'::numeric) then raise exception 'La orden requiere puntos mayores a 0'; end if;
  v_reason:=nullif(btrim(current_setting('smartrayco.points_reason',true)),'');
  if v_reason is null or length(v_reason)>1000 then raise exception 'Utiliza el ajuste administrativo con motivo obligatorio'; end if;
  insert into public.work_order_point_changes(job_type,job_id,old_points,new_points,changed_by,reason)
  values(kind,old.id,old.points,new.points,auth.uid(),v_reason);
  return new;
end;
$$;

create function public.convert_prospect_with_installation(p_prospect_id uuid,p_client jsonb,p_referrer_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  actor uuid:=auth.uid(); prospect public.prospects; receipt public.prospect_conversion_receipts;
  normalized jsonb; fingerprint text; new_client uuid:=gen_random_uuid();
  new_contract uuid:=gen_random_uuid(); new_installation uuid:=gen_random_uuid(); fee numeric:=0;
begin
  if actor is null or not exists(select 1 from public.profiles where id=actor and active
      and role::text in ('ADMIN','SUPERADMIN','SOPORTE','FACTURACION')) then
    raise exception 'Conversión exclusiva del personal comercial activo' using errcode='42501';
  end if;
  if p_client is null or jsonb_typeof(p_client)<>'object' then raise exception 'Datos de cliente inválidos' using errcode='22023'; end if;
  if exists(select 1 from jsonb_each(p_client) e where e.key not in
      ('document_type','document_number','first_name','last_name','phone','phone_2','email','address','status')
      or jsonb_typeof(e.value) not in ('string','null')) then
    raise exception 'Campos no permitidos en la conversión' using errcode='22023';
  end if;
  normalized:=jsonb_build_object(
    'document_type',coalesce(nullif(btrim(p_client->>'document_type'),''),'cedula'),
    'document_number',nullif(btrim(p_client->>'document_number'),''),
    'first_name',nullif(btrim(p_client->>'first_name'),''),'last_name',coalesce(btrim(p_client->>'last_name'),''),
    'phone',nullif(btrim(p_client->>'phone'),''),'phone_2',nullif(btrim(p_client->>'phone_2'),''),
    'email',nullif(btrim(p_client->>'email'),''),'address',nullif(btrim(p_client->>'address'),''),
    'status',coalesce(nullif(btrim(p_client->>'status'),''),'prospect'));
  if normalized->>'document_number' is null or normalized->>'first_name' is null
     or normalized->>'status' not in ('prospect','active','suspended') then
    raise exception 'Documento, nombre o estado inválido' using errcode='22023';
  end if;
  fingerprint:=encode(sha256(convert_to(normalized::text||coalesce(p_referrer_id::text,''),'UTF8')),'hex');
  select * into prospect from public.prospects where id=p_prospect_id for update;
  if not found then raise exception 'Prospecto no encontrado' using errcode='P0002'; end if;
  select * into receipt from public.prospect_conversion_receipts where prospect_id=p_prospect_id;
  if found then
    if receipt.request_hash<>fingerprint then raise exception 'La conversión ya existe con otros datos; consulta la ficha' using errcode='40001'; end if;
    if prospect.estado::text<>'convertido' or prospect.converted_client_id is distinct from receipt.client_id then
      raise exception 'El Prospecto convertido cambió; revisa su ficha' using errcode='40001';
    end if;
    return jsonb_build_object('prospect_id',p_prospect_id,'client_id',receipt.client_id,'contract_id',receipt.contract_id,
      'installation_id',receipt.installation_id,'initial_points',0,'replayed',true);
  end if;
  if prospect.estado::text='convertido' or prospect.converted_client_id is not null then
    raise exception 'Prospecto ya convertido por otro flujo; utiliza la ficha existente' using errcode='23505';
  end if;
  -- Igualar el criterio existente de la pantalla (trim/case), también entre
  -- conversiones concurrentes de distintos Prospectos. No cambiar documentos históricos.
  if current_setting('transaction_isolation') not in ('read committed','read uncommitted') then
    raise exception 'La conversión requiere una transacción READ COMMITTED; reintenta' using errcode='40001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('prospect-document:'||lower(normalized->>'document_number'),0));
  if exists(select 1 from public.clients where lower(btrim(document_number))=lower(normalized->>'document_number')) then
    raise exception 'Ya existe un cliente con ese documento; no se creó la conversión' using errcode='23505';
  end if;
  if prospect.plan_interes_id is not null then
    select price into fee from public.plans where id=prospect.plan_interes_id and is_active and deleted_at is null for share;
    if not found then raise exception 'El plan del Prospecto ya no está disponible' using errcode='22023'; end if;
  end if;
  insert into public.clients(id,document_type,document_number,first_name,last_name,phone,phone_2,email,address,status)
  values(new_client,(normalized->>'document_type')::public.document_type,normalized->>'document_number',normalized->>'first_name',
    normalized->>'last_name',normalized->>'phone',normalized->>'phone_2',normalized->>'email',normalized->>'address',
    (normalized->>'status')::public.client_status);
  insert into public.service_contracts(id,client_id,plan_id,monthly_fee,installation_address,zone_id)
  values(new_contract,new_client,prospect.plan_interes_id,fee,normalized->>'address',prospect.zone_id);
  update public.prospects set estado='convertido',converted_client_id=new_client,updated_by=actor where id=p_prospect_id;
  insert into public.prospect_conversion_receipts(prospect_id,client_id,contract_id,installation_id,requested_by,request_hash)
  values(p_prospect_id,new_client,new_contract,new_installation,actor,fingerprint);
  insert into public.installations(id,client_id,contract_id,points) values(new_installation,new_client,new_contract,0);
  if p_referrer_id is not null then
    insert into public.referidos(referente_client_id,referido_client_id) values(p_referrer_id,new_client);
  end if;
  return jsonb_build_object('prospect_id',p_prospect_id,'client_id',new_client,'contract_id',new_contract,
    'installation_id',new_installation,'initial_points',0,'replayed',false);
end;
$$;
revoke all on function public.convert_prospect_with_installation(uuid,jsonb,uuid) from public,anon,service_role;
grant execute on function public.convert_prospect_with_installation(uuid,jsonb,uuid) to authenticated;

-- Mantener el contrato y la autorización de revisión; solo añadir la señal de origen.
do $$
declare definition text;
begin
  select pg_get_functiondef('public.work_order_point_review(text,uuid)'::regprocedure) into definition;
  execute replace(definition,'public.work_order_point_review(', 'public.work_order_point_review_before_prospect_zero(');
end $$;
revoke all on function public.work_order_point_review_before_prospect_zero(text,uuid) from public,anon,authenticated,service_role;
create or replace function public.work_order_point_review(p_job_type text,p_job_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare review jsonb; pending boolean:=false;
begin
  review:=public.work_order_point_review_before_prospect_zero(p_job_type,p_job_id);
  if p_job_type='installation' then
    select points=0 and public.is_prospect_conversion_installation(id,client_id,contract_id) into pending
    from public.installations where id=p_job_id;
  end if;
  return review||jsonb_build_object('prospectPointsPending',coalesce(pending,false));
end;
$$;
commit;
