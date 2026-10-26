-- CANDIDATA: depende de las cuatro migraciones de puntos ya aplicadas.
-- No backfill ni escrituras de órdenes/confirmaciones. No aplicar sin autorización.
begin;

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
  -- Fin de la ventana productiva documentada: antes de ella son terminaciones
  -- históricas protegidas; después, órdenes pendientes de revisión del piloto.
  -- El corte de acreditación oficial de noviembre NO se usa como cierre.
  if ((done is not null and done<timestamptz '2026-10-26 04:22:51+00')
      or (done is null and old.status::text in ('resolved','closed','completed')))
     and not(kind='installation' and prospect_zero and old.points=0) then
    raise exception 'No se modifican puntos históricos anteriores a la activación';
  end if;
  if new.points is null or not(new.points>0 and new.points<'Infinity'::numeric) then raise exception 'La orden requiere puntos mayores a 0'; end if;
  v_reason:=nullif(btrim(current_setting('smartrayco.points_reason',true)),'');
  if v_reason is null or length(v_reason)>1000 then raise exception 'Utiliza el ajuste administrativo con motivo obligatorio'; end if;
  insert into public.work_order_point_changes(job_type,job_id,old_points,new_points,changed_by,reason)
  values(kind,old.id,old.points,new.points,auth.uid(),v_reason);
  return new;
end;
$$;

-- Mantener autorización, token concurrente, reparto y consulta histórica de la
-- revisión original. Solo exponer si la guarda permite el ajuste pendiente.
create or replace function public.work_order_point_review(p_job_type text,p_job_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare review jsonb; pending boolean:=false; done timestamptz; can_adjust boolean;
begin
  review:=public.work_order_point_review_before_prospect_zero(p_job_type,p_job_id);
  if p_job_type='installation' then
    select points=0 and public.is_prospect_conversion_installation(id,client_id,contract_id) into pending
    from public.installations where id=p_job_id;
  end if;
  done:=(review->>'technicalCompletedAt')::timestamptz;
  can_adjust:=review->>'status'<>'cancelled'
    and coalesce(review->'confirmation','null'::jsonb)='null'::jsonb
    and ((done is null and not coalesce((review->>'finished')::boolean,false))
      or done>=timestamptz '2026-10-26 04:22:51+00' or coalesce(pending,false));
  return review||jsonb_build_object('prospectPointsPending',coalesce(pending,false),'canAdjustPoints',coalesce(can_adjust,false));
end;
$$;

-- CREATE OR REPLACE conserva las ACL ya aplicadas. No se modifican RPC de
-- confirmación/ajuste, guardas finales, RLS, origen de Prospectos ni ranking.
commit;
