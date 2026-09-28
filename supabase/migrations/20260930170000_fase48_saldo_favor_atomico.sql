-- SmartRayco — Fase 48: saldo a favor atomico al marcar una factura pagada
--
-- routes/invoices.ts (mark-paid) hacia un select + update en dos pasos para
-- sumar el sobrepago a clients.saldo_a_favor: si dos peticiones casi
-- simultaneas (doble clic, reintento de red) leian el mismo saldo de
-- partida, la segunda pisaba el resultado de la primera (se perdia un
-- sobrepago). Esta funcion hace la suma en UN SOLO UPDATE en la base
-- (atomico por diseno de Postgres), igual criterio que apply_invoice_credits
-- (Fase 33) para los descuentos de referido/saldo previo.

create or replace function public.increment_client_saldo(p_client_id uuid, p_monto numeric)
returns numeric
language plpgsql
security definer set search_path = public
as $$
declare
  v_nuevo_saldo numeric(10, 2);
begin
  update public.clients
     set saldo_a_favor = saldo_a_favor + p_monto
   where id = p_client_id
  returning saldo_a_favor into v_nuevo_saldo;

  return v_nuevo_saldo;
end;
$$;
