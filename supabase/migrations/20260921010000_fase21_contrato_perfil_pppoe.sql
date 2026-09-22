-- Fase 21: el perfil PPPoE de MikroTik se elige por contrato, no por plan.
--
-- Antes "plans.mikrotik_profile" fijaba un unico profile para todos los
-- clientes de ese plan. En la practica el profile puede variar por cliente
-- (distinto router, excepciones, etc.), asi que se mueve a service_contracts.
-- El ancho de banda real sigue controlandose desde la OLT; esto solo es el
-- profile que se aplica al secreto PPPoE en MikroTik.

alter table public.service_contracts
  add column if not exists mikrotik_profile text;

-- Conserva la configuracion ya existente (ej. plan "CORTE POR DEUDA" con
-- mikrotik_profile "Profile_Morosos") copiandola a los contratos que usan
-- ese plan y que aun no tengan un profile propio.
update public.service_contracts sc
set mikrotik_profile = p.mikrotik_profile
from public.plans p
where sc.plan_id = p.id
  and p.mikrotik_profile is not null
  and sc.mikrotik_profile is null;
