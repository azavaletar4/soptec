# SmartRayco — habilita SNMP en el MikroTik para que LibreNMS pueda
# monitorearlo (CPU, interfaces, sesiones PPPoE activas, etc).
#
# NO instala ni configura LibreNMS (es un servidor aparte) — solo prepara
# el lado del router. Ver deploy/librenms-alertas.md para el resto.
#
# Uso: copia este archivo al router (Files, vía WinBox/WebFig o scp) y
# corre en la terminal de RouterOS:  /import file=mikrotik-snmp.rsc
#
# Antes de correrlo, EDITA:
#   - $snmpCommunity: cambia "smartrayco-ro" por un valor propio (no lo
#     dejes con el default).
#   - $librenmsIp: la IP del servidor donde vive (o vivirá) LibreNMS.
#     Si todavia no lo tienes, deja 0.0.0.0/0 (sin restringir) y ajustalo
#     despues con /snmp community set [find name=$snmpCommunity] addresses=...

:local snmpCommunity "smartrayco-ro"
:local librenmsIp "0.0.0.0/0"

# --- Comunidad SNMP v2c, solo lectura, restringida a la IP de LibreNMS ---
/snmp community
add name=$snmpCommunity addresses=$librenmsIp read-access=yes write-access=no
:log info "SmartRayco/SNMP: comunidad '$snmpCommunity' creada (restringida a $librenmsIp)"

# --- Habilita el servicio SNMP (v2c; para v3 usar /snmp community add ...
#     security=private/authpriv en vez de lo de arriba, mas complejo de
#     armar a mano — v2c alcanza si LibreNMS solo lo alcanza desde tu LAN/VPN,
#     nunca expuesto directo a Internet) ---
/snmp set enabled=yes contact="SmartRayco NOC" location="Ver mikrotik_devices en el panel"

:log info "SmartRayco/SNMP: listo. Prueba desde el servidor de LibreNMS:"
:log info "  snmpwalk -v2c -c $snmpCommunity <IP-del-mikrotik> system"
