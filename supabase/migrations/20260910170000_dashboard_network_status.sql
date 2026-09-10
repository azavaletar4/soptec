-- SmartRayco — Dashboard: estado de red persistido
--
-- El Dashboard necesita saber si cada OLT/MikroTik respondio la ultima vez
-- que se probo, sin tener que volver a conectarse a todos en cada carga
-- (igual criterio que el dashboard de referencia: "no es un ping en vivo").
-- Se actualiza cada vez que se usa el boton "Probar conexion" en /olt o /mikrotik.

alter table public.olt_devices add column last_test_ok boolean;
alter table public.olt_devices add column last_tested_at timestamptz;

alter table public.mikrotik_devices add column last_test_ok boolean;
alter table public.mikrotik_devices add column last_tested_at timestamptz;
