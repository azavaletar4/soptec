-- SmartRayco — Fase 4 (correccion): la OLT ZTE C300 real solo tiene Telnet
-- habilitado (SSH resetea la conexion, confirmado con multiples clientes SSH
-- incluido el nativo de Windows). Se agrega telnet_port; ssh_port se deja
-- para una futura marca que si use SSH (ej. Huawei).

alter table public.olt_devices add column telnet_port int not null default 23;
