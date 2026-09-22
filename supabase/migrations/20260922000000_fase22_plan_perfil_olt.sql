-- Fase 22: vincula cada Plan (catalogo de negocio) con su par de perfiles de
-- ancho de banda REALES de la OLT (tcont = subida, traffic = bajada), y deja
-- constancia en cada ONT de que plan tiene aplicado actualmente.
--
-- El ancho de banda real del cliente siempre lo aplica la OLT via estos
-- perfiles (ver zteCommands.ts / registerOntCommands, cambio real ya en
-- produccion); esto solo permite elegirlos por nombre de plan en vez de
-- perfil suelto, y saber que plan quedo aplicado en cada ONT.

alter table public.plans
  add column if not exists olt_tcont_profile text,
  add column if not exists olt_traffic_profile text;

alter table public.olt_onts
  add column if not exists plan_id uuid references public.plans (id);
