-- Fase 136b (correccion de revision externa sobre la Fase 2 OLT, ver
-- docs/auditoria/fase-2-aprovisionamiento.html): el historial de una
-- operacion de aprovisionamiento (olt_provisioning_operations.steps) se
-- actualizaba con un SELECT + mutacion en memoria + UPDATE desde el backend
-- (ver appendProvisioningStep() en routes/olt.ts antes de esta correccion) —
-- una carrera clasica de "lost update": si dos etapas se registran casi al
-- mismo tiempo (ej. el escaneo y, en paralelo, otra operacion sobre la
-- MISMA fila), cada UPDATE podia pisar por completo el array que el otro
-- ya habia escrito, perdiendo esa etapa del historial en silencio.
--
-- Esta funcion hace el append DENTRO de un solo UPDATE — Postgres bloquea
-- la fila mientras dura esa sentencia, asi que una segunda llamada
-- concurrente espera, vuelve a leer el valor YA actualizado por la primera,
-- y le agrega la suya encima: ninguna etapa se pierde, sin necesidad de
-- ningun SELECT previo desde el backend.

create or replace function public.append_provisioning_step(
  p_operation_id uuid,
  p_stage text,
  p_status text,
  p_detail text default null
)
returns public.olt_provisioning_operations
language plpgsql
as $$
declare
  v_result public.olt_provisioning_operations;
begin
  update public.olt_provisioning_operations
  set steps = steps || jsonb_build_array(
    jsonb_build_object('stage', p_stage, 'status', p_status, 'at', now(), 'detail', p_detail)
  )
  where id = p_operation_id
  returning * into v_result;

  if v_result.id is null then
    raise exception 'olt_provisioning_operations % no existe', p_operation_id;
  end if;

  return v_result;
end;
$$;

comment on function public.append_provisioning_step is
  'Agrega una etapa al historial de una operacion de aprovisionamiento de forma atomica (un solo UPDATE, sin SELECT previo desde el backend) — ver oltProvisioningService.ts / routes/olt.ts, Fase 2.';
