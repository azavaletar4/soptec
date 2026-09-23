# LibreNMS + alertas — guía de configuración

LibreNMS **no vive dentro de `d:/smartrayco`** — es un servidor/aplicación
aparte (típicamente su propio Docker o VM, con su propia base de datos).
Esta guía asume que ya tienes (o vas a instalar) un LibreNMS en algún
servidor accesible desde tu MikroTik — SmartRayco no lo instala por ti.

Si no tienes LibreNMS todavía, la forma más simple es su instalador Docker
oficial: https://docs.librenms.org/Installation/Docker/

## 1. SNMP en el MikroTik

Corre `deploy/mikrotik-snmp.rsc` en el router (edita `$snmpCommunity` y
`$librenmsIp` antes — ver comentarios del archivo).

## 2. Agregar el dispositivo en LibreNMS

Desde la UI de LibreNMS: **Devices → Add Device** → IP del MikroTik,
comunidad SNMP = la que pusiste en el paso 1, versión v2c.

## 3. Reglas de alerta

En **Alerts → Alert Rules → Add Rule**, crea estas 4 (LibreNMS trae
plantillas parecidas ya armadas — busca en "Rule Templates" antes de
escribirlas a mano):

| Evento | Regla LibreNMS (aprox.) |
|---|---|
| Caída de interfaz/enlace principal | `ports.ifOperStatus = "down" AND ports.ifAdminStatus = "up"`, filtrado a la interfaz WAN del MikroTik |
| CPU > 85% por más de 5 min | `devices.status = "1" AND processors.processor_usage > 85`, con "Alert if this remains true for" = 5 min |
| Caída masiva de sesiones PPPoE | Requiere una app SNMP personalizada o el poller de LibreNMS para `/ppp/active` (LibreNMS no trae esto de fábrica para MikroTik) — alternativa más simple: usa la reconciliación de SmartRayco (`/mikrotik` en el panel) como fuente de esa métrica en vez de LibreNMS, ya que el panel SÍ sabe cuántas sesiones activas hay por router |
| Ping ICMP a equipos críticos | Regla de tipo "Device Down" (`devices.status = "0"`) sobre los dispositivos marcados como críticos |

**Nota honesta:** LibreNMS monitorea SNMP nativamente muy bien (CPU,
interfaces, disponibilidad), pero **no tiene una métrica lista para
"sesiones PPPoE activas"** de MikroTik sin trabajo adicional (un script
personalizado de LibreNMS, fuera del alcance de este cambio). Para eso, el
propio SmartRayco ya es una mejor fuente — ver el panel de reconciliación
en `/mikrotik`.

## 4. Transporte de alertas → SmartRayco

En **Alerts → Alert Transports → Add Transport → API**:

- URL: `https://TU-DOMINIO/api/alerts/librenms?secret=EL_MISMO_VALOR_DE_ALERTS_WEBHOOK_SECRET`
- Método: `POST`

`ALERTS_WEBHOOK_SECRET` se configura en el `.env` de SmartRayco (ver
`.env.example`) — genera un valor random (`openssl rand -hex 20`) y ponlo
igual en ambos lados.

El endpoint ya arma el mensaje con el formato pedido:

```
🚨 *ALERTA DE RED - SMARTRAYCO* 🚨
• *Evento:* {título}
• *Dispositivo:* {host} ({ip})
• *Estado:* {severidad}
• *Hora:* {fecha}
• *Detalle:* {mensaje}
```

Y para recuperación (`state=1` en el payload de LibreNMS) cambia el
encabezado a "✅ *RECUPERADO*".

## 5. Envío a WhatsApp — PENDIENTE (decisión tuya)

El endpoint `/api/alerts/librenms` ya recibe y formatea la alerta, pero
**el envío real a WhatsApp está sin conectar a propósito** (se dejó
pendiente el 2026-09-25 hasta elegir el gateway). Por ahora solo queda
logueado en el backend (`pm2 logs smartrayco-api`).

Cuando decidas, hay un único lugar a tocar:
`server/src/routes/alerts.ts`, función `sendWhatsAppAlert()`.

- **API paga (UltraMsg, Twilio, etc.)** — la más simple: un `fetch`/`undici`
  con tu API key, sin mantener infraestructura propia.
- **Autoalojado (Evolution API / Baileys)** — gratis, pero corre su propio
  servicio y necesitas escanear un código QR con el número real
  (+51 960587002) la primera vez, y cada vez que se desvincule la sesión.

Avísame cuál eliges y termino de conectar esa función.
