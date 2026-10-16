-- EXPERIMENTO EXCLUSIVO DEL LABORATORIO. No aplicar en Cloud.
-- La policy controla JOIN; no garantiza revocación de sockets ya abiertos.
begin;
drop policy if exists lab_campo_inventory_receive on realtime.messages;
create policy lab_campo_inventory_receive on realtime.messages
for select to authenticated using (
 extension = 'broadcast' and (
  exists(select 1 from public.profiles p
    where p.id=auth.uid() and p.active and p.role in ('ADMIN','SUPERADMIN'))
  or exists (
   select 1 from public.profiles p
   join public.job_assignees a on a.technician_id=p.id
   where p.id=auth.uid() and p.active and p.role='TECNICO_RED'
    and a.role in ('leader','support')
    and realtime.topic()='campo-inventory:v1:'||a.job_type||':'||a.job_id::text
    and (
     (a.job_type='installation' and exists(select 1 from public.installations i
       where i.id=a.job_id and i.status in ('pending','scheduled','in_progress')))
     or (a.job_type='ticket' and exists(select 1 from public.tickets t
       where t.id=a.job_id and t.status in ('open','in_progress','rescheduled')))
    )
  )
 )
);
-- Los GRANT de tabla permiten evaluar la policy; sin policy INSERT no hay emisión.
grant usage on schema realtime to authenticated;
grant select,insert on realtime.messages to authenticated;
commit;
