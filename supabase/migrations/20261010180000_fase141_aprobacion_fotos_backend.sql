-- SmartRayco — Fase 141: valida en backend si una foto de cierre necesita
-- aprobacion, en vez de confiar en el valor que manda el navegador.
--
-- HALLAZGO (Fase 1 de este pedido): work_order_photos.status existe desde la
-- Fase 95b ('pending_approval'/'approved'/'rejected') pero SOLO como check
-- constraint — ninguna RLS ni trigger ataba ese valor al job_type/categoria
-- real. El propio comentario de la Fase 95b ya lo reconocia: "el status en
-- BD es el marcador de que falta revisar" (confiando en que el frontend
-- mande el valor correcto). Un tecnico podia, con una llamada directa a la
-- API, insertar una foto de AVERIA con status='approved' (evadiendo la
-- revision del censo fotografico) o con job_type='installation' para la
-- misma foto de un ticket.
--
-- CORRECCION: trigger BEFORE INSERT que IGNORA el status/job_type que venga
-- del cliente y los recalcula/valida el mismo:
--   - Confirma que job_id existe de verdad en la tabla de ese job_type
--     (tickets/installations/routines) — cierra el "mentir el job_type".
--   - installation -> siempre 'approved' (incorporacion automatica a
--     client_photos, Fase 3-A del pedido — CampoTrabajoDetailView.vue ya
--     hacia la copia a client_photos para estas categorias, pero el status
--     en work_order_photos no estaba garantizado).
--   - ticket -> 'pending_approval', EXCEPTO evidencia_1/evidencia_2 (actas
--     de cierre, nunca se copian a client_photos, siempre fueron directas)
--     -> 'approved'. Mismo criterio que ya aplicaba el frontend (Fase 95),
--     ahora impuesto en BD.
--   - routine -> 'approved' (las rutinas no tienen hoy ninguna categoria de
--     censo fotografico pendiente — CENSO_CATEGORIES solo se muestra para
--     jobType==='ticket' en CampoTrabajoDetailView.vue; esto preserva ese
--     comportamiento real, no se inventa aprobacion donde no existia).
--
-- No se tocan reglas de aprobacion de Averias/Rutinas (punto explicito del
-- pedido) — este trigger solo IMPONE en BD la misma logica que ya regia en
-- el frontend, nunca la cambia.

create or replace function public.enforce_work_order_photo_status()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.job_type = 'installation' then
    if not exists (select 1 from public.installations where id = new.job_id) then
      raise exception 'La instalación % no existe', new.job_id;
    end if;
    new.status := 'approved';
  elsif new.job_type = 'ticket' then
    if not exists (select 1 from public.tickets where id = new.job_id) then
      raise exception 'El ticket % no existe', new.job_id;
    end if;
    new.status := case when new.category in ('evidencia_1', 'evidencia_2') then 'approved' else 'pending_approval' end;
  elsif new.job_type = 'routine' then
    if not exists (select 1 from public.routines where id = new.job_id) then
      raise exception 'La rutina % no existe', new.job_id;
    end if;
    new.status := 'approved';
  else
    raise exception 'job_type inválido: %', new.job_type;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_work_order_photos_status on public.work_order_photos;
create trigger trg_work_order_photos_status
  before insert on public.work_order_photos
  for each row execute function public.enforce_work_order_photo_status();
