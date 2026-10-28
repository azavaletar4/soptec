# TR-069 WiFi: cambio de contraseña preparado (candidato local, sin desplegar) — 28/10/2026

## Resultado confirmado por el propietario (punto de partida de esta sesión)

El cambio de SSID real sobre `HWTC1D3691B7` (contrato `CTR-2026-00214`) **funcionó**:
el Huawei sigue navegando normalmente y la conexión TR-069/GenieACS está operativa.
Confirmado en producción por lectura directa (solo lectura, sin tareas nuevas):
el backend `smartrayco-backend-wifitrial:fabc13672cd3` y el frontend
`smartrayco-frontend-consolidado:fabc13672cd3` de la corrección `fabc136` ya
están corriendo (`deploy` se ejecutó entre sesiones), con
`TR069_WIFI_TRIAL_ENABLED=HWTC1D3691B7:CTR-2026-00214` activo.

## Hallazgo: el firmware sí admite cambiar la contraseña, con el mismo mecanismo que el SSID

Consulta real a GenieACS (solo lectura, proyección exacta, sin exponer el valor —
ver método abajo) sobre `InternetGatewayDevice.LANDevice.1.WLANConfiguration.5`:

| Parámetro | Resultado confirmado |
|---|---|
| `KeyPassphrase` (contraseña, escalar directo) | `_writable: true`, `_type: xsd:string`, con una lectura puntual real del 27/10 (19:45:10 UTC) |
| `PreSharedKey` (tabla multi-instancia alternativa) | `_object: true`, sin ninguna instancia poblada — no se usa |
| `WPAEncryptionModes`, `BeaconType`, `Enable`, etc. | Sin valor cacheado (el equipo no los reporta en el Inform periódico) — ya documentado antes, no es nuevo |

Conclusión: `KeyPassphrase` es un escalar directo en la misma instancia que el SSID,
con la misma forma (`xsd:string`, `_writable=true`) que ya demostró funcionar para
el nombre de red. No hay evidencia de que se necesite tocar ningún otro parámetro
(modo de seguridad, beacon, etc.) para este firmware — pero, igual que ocurrió con
el SSID antes de su primera prueba real, **esto no sustituye una prueba real**.

Método usado para leerlo sin exponer la contraseña real en ningún momento: `docker
exec` al backend en producción (contenedor ya autorizado, mismo mecanismo que para
OLT/MikroTik) ejecutando `fetch` contra GenieACS con proyección exacta sobre el
path; el código que imprimió evidencia reemplazó cualquier campo que pareciera
sensible (`key|passphrase|psk|secret|password`) por `[REDACTED]` antes de mostrarlo.
La contraseña real nunca llegó a esta conversación ni a ningún archivo.

## Qué se implementó (candidato local, sin desplegar)

Mismo mecanismo ya probado para el SSID (`server/src/services/tr069WifiTrial.ts`),
extendido para aceptar una contraseña nueva **opcional** en el mismo formulario:

- **Un solo envío atómico**: si se piden nombre y contraseña juntos, van en la
  misma tarea `setParameterValues` (TR-069 garantiza que se aplican todas o
  ninguna). Si solo se pide contraseña, el SSID no se toca.
- **Nunca texto plano**: la contraseña nunca se guarda en el respaldo persistente
  (`/var/lib/smartrayco-olt/tr069-wifi-trial.json`), nunca se registra en logs, y
  nunca viaja de vuelta al navegador. Solo se guarda su huella SHA-256
  (`afterPasswordHash`), igual que se haría con cualquier credencial —
  sirve para confirmar que lo aplicado coincide con lo enviado, sin poder
  reconstruir el valor.
- **Validación**: 8 a 63 caracteres imprimibles en inglés (estándar WPA-PSK); se
  restringe a ese alfabeto porque no hay evidencia de que este firmware acepte
  tildes/eñes/emoji en la contraseña (con el SSID sí se probó UTF-8 porque ya
  se confirmó en vivo; con la contraseña, no todavía).
- **Capacidad de escritura exigida en vivo**: si GenieACS no confirma
  `_writable=true` para `KeyPassphrase` en el momento del envío, se bloquea con
  un mensaje claro en vez de mandar una tarea con destino incierto.
- **Verificación por huella, no por valor**: tras enviar, se lee de vuelta
  `KeyPassphrase` (proyección exacta) y se compara su huella SHA-256 contra la
  enviada — nunca se compara ni se muestra el texto.
- **Protección contra tareas duplicadas y permisos**: reutiliza exactamente el
  mismo candado de una sola operación pendiente, reintento idempotente por
  `requestId`, chequeo de tareas/`faults` previos y restricción ADMIN/SUPERADMIN
  que ya tenía el cambio de SSID — nada de esto se relajó.
- **Sin restauración automática de contraseña**: a diferencia del SSID (que sí
  guarda el nombre anterior para poder revertirlo con un clic), la contraseña
  anterior **no se guarda en ningún lado** — ver procedimiento de recuperación
  abajo. El botón "Restaurar nombre anterior" sigue existiendo pero solo
  revierte el SSID; si la última operación incluyó una contraseña nueva, el
  panel lo advierte explícitamente.

## Qué NO se hizo todavía (requiere la prueba real del propietario)

- No se envió ningún cambio real de contraseña a `HWTC1D3691B7`.
- No se desplegó nada de esto a producción.
- No se tocó PPPoE, WAN, VLAN, OLT ni ningún otro módulo.

## Procedimiento para la prueba controlada (cuando el propietario autorice el despliegue)

1. Desplegar el candidato (mismo procedimiento ya usado para el SSID:
   `prepare` → `build` → `deploy` con respaldo/rollback verificado, o el
   mecanismo de despliegue vigente en ese momento).
2. En el panel: TR-069 → fila de `HWTC1D3691B7` → **Configurar**.
3. Elegir la red de prueba (`WLAN 5`, se precarga su nombre actual).
4. Escribir una contraseña nueva en el campo opcional (dejar el nombre tal
   como quedó precargado si no se quiere cambiar también el SSID).
5. **Aplicar cambios** → confirmar en el cuadro de diálogo (advierte que los
   dispositivos ya conectados perderán la conexión hasta reescribir la
   contraseña nueva, y que SmartRayco no guarda la anterior).
6. Pulsar **Comprobar estado** cada pocos minutos hasta ver "Confirmado".
7. Verificar en el propio equipo (o reconectando un dispositivo de prueba)
   que la contraseña nueva funciona y que internet/PPPoE del cliente sigue
   intacto.

## Procedimiento de recuperación ante un cambio fallido

- **Si el envío queda "Resultado incierto" o "Con error"**: no reintentar a
  ciegas. Revisar el estado con "Comprobar estado"; el candado de una sola
  operación pendiente impide enviar un segundo cambio hasta resolver esto.
- **Si se confirmó pero el admin quiere deshacerlo**: no hay botón automático
  (no se guarda la contraseña anterior, por diseño — regla 7). Volver a abrir
  "Configurar" y escribir la contraseña anterior conocida como si fuera un
  cambio nuevo, igual que se hizo el cambio original.
- **Si se perdió la contraseña anterior y el equipo quedó inaccesible por
  WiFi**: el equipo sigue gestionable por TR-069 (igual que ahora) y por LAN
  cableada; no depende de la contraseña WiFi. Como último recurso, un reinicio
  de fábrica del WiFi (WPS/reset) es responsabilidad de personal técnico en
  sitio, fuera del alcance de este panel.

## Archivos modificados

- `src/lib/tr069WifiPlan.ts` — nuevos campos `passwordWritable`/`passwordTimestamp` (metadatos, nunca el valor).
- `server/src/services/tr069WifiPreparation.ts` — `readWifiInventory` expone esos metadatos.
- `src/lib/tr069WifiTrial.ts` — tipo `WifiTrialOperation` con `passwordChanged`/`afterPasswordHash`; nuevos mensajes en el diccionario de lenguaje sencillo.
- `server/src/services/tr069WifiTrial.ts` — lógica real: validación, envío atómico, verificación por huella, huella SHA-256 nunca el valor.
- `src/views/tr069/Tr069View.vue` — campo de contraseña habilitado (antes bloqueado), precarga del nombre actual al elegir red, advertencias y evidencia de huella.
- Pruebas: `server/src/services/__tests__/tr069WifiTrial.test.ts`, `server/src/services/__tests__/tr069WifiPreparation.test.ts`, `src/lib/__tests__/tr069WifiTrial.test.ts`.

## Pruebas ejecutadas (todas en verde, nada contra producción)

- `node --import tsx --test server/src/services/__tests__/tr069WifiTrial.test.ts` — 12/12 (8 nuevas de contraseña).
- `npm run test:provisioning` — 278/278 (suite completa de servicios, sin regresión).
- `npm run test:fetch-timeout` — 481/481 (suite completa de `src/lib`, sin regresión).
- `npx vue-tsc -p tsconfig.app.json --noEmit` y `npx tsc -p tsconfig.server.json --noEmit` — ambos limpios.
