# TR-069 Hosts — solo 2 de 5 dispositivos visibles: causa real y corrección (2026-10-29)

Investigación solo lectura sobre la Huawei de prueba `HWTC1D3691B7`
(`CTR-2026-00214`), sin enviar ninguna tarea nueva a GenieACS, sin tocar su
configuración, WiFi, PPPoE, OLT ni MikroTik. Candidato local, sin publicar.

## Causa exacta (confirmada por lectura directa de la caché de GenieACS)

El propio CPE **dejó de anunciar 3 de las 5 instancias `Hosts.Host.{i}`** en
su árbol TR-069 — no es que reportaran `Active=false`, es que las claves `3`,
`4` y `5` **ya no existen** en el documento. Verificado leyendo la caché real
(solo lectura, dentro del contenedor GenieACS):

```json
"Hosts": { "Host": { "1": { "HostName": {"_value":"Z2359", ...} },
                      "2": { "HostName": {"_value":"LAPTOP-996NPL7I", ...} } } }
```

Solo 2 claves. Esto es un comportamiento normal de routers Huawei: la tabla
de Hosts suele reflejar el DHCP/ARP interno del equipo, y una entrada se
retira cuando el cliente lleva suficiente tiempo sin renovar su concesión —
**no es un fallo de SmartRayco ni del backend/frontend**.

`server/src/services/tr069Hosts.ts` (`hostsInventoryFromDevice`) y la
plantilla de `src/views/tr069/Tr069View.vue` (`v-for` sin filtro) ya
mostraban el 100% de lo que la caché trae — se confirmó leyendo ambos: no
existe ningún filtro oculto por antigüedad/conexión. El punto 2 de la tarea
(¿la lectura activa devuelve todos, solo los recientes o un subconjunto?)
queda resuelto: **devuelve exactamente lo que el equipo anuncia en ese
momento** — ni más ni menos — y cuando el propio equipo anuncia menos
instancias, la lista se reduce aunque nada en nuestro código lo "filtre".

El administrador pulsó "Actualizar" (rol ADMIN/SUPERADMIN → lectura bajo
demanda `readHostsOnDemand`). `buildHostsReadPlan`
(`server/src/services/tr069HostsOnDemand.ts`) construye el plan de lectura
**a partir del árbol ya cacheado en ese momento** — si el árbol solo tiene 2
Hosts, el GPV solo puede confirmar esos 2; no puede "descubrir" instancias
que el propio equipo ya no anuncia. El resultado (2 confirmados, frescos)
era correcto para lo que el equipo reportó — el problema real era que **no
existía ninguna memoria de los 3 anteriores**, así que desaparecían del
panel sin más explicación.

## Riesgo identificado (punto 4 de la tarea)

Antes de esta corrección, ausencia en la última respuesta del equipo
**se presentaba igual que si nunca hubieran existido** — ni "Desconectado"
ni "Sin confirmar": simplemente no aparecían. Esto sí es confuso para el
administrador (vio 5, ahora ve 2) y es la causa real que correspondía
corregir.

## Solución aplicada (local, no desplegada)

Nuevo módulo `server/src/services/tr069HostsHistory.ts`
(`applyHostsHistory`): mantiene un pequeño historial local por equipo (un
archivo JSON en el mismo directorio ya usado por la lectura bajo demanda,
`TR069_HOSTS_READS_DIR`, por MAC normalizada) que:

- Cuando un host aparece en la lectura en vivo, actualiza su entrada
  (conservando tal cual los valores reales que el equipo reportó — nunca
  inventa ninguno).
- Cuando un host **desaparece** de la lectura en vivo, lo conserva visible
  con su **última lectura real** (nunca se le asigna un valor nuevo).
  `hostStatusLabel`/`hostConnectionLabel`
  (`src/lib/tr069Hosts.ts`, sin cambios) ya resuelven solos a **"Sin
  confirmar"** en cuanto esos datos superan los 10 minutos de vigencia —
  por eso un ausente nunca se presenta como "Desconectado" confirmado
  (punto 4), y a la vez sigue **visible** (punto 5).
- Si un host reaparece, adopta su lectura nueva (deja de ser fantasma).
- Retención de 30 días y tope de 64 fantasmas (`HOSTS_HISTORY_RETENTION_MS`,
  `HOSTS_HISTORY_MAX_GHOSTS`) para que el historial no crezca sin límite.
- Un host sin MAC no se puede identificar entre lecturas: se muestra tal
  cual en esa respuesta, pero no se "revive" si luego desaparece — no se
  inventa una identidad.

Conectado en los dos puntos donde se construye la respuesta externa (nunca
en la comparación interna de "lectura confirmada", que sigue siendo
exclusivamente sobre datos en vivo — ver comentario en el código):

- `GET /api/genieacs-sync/hosts/:serial` (lectura pasiva de caché,
  `server/src/routes/genieacsSync.ts`).
- `POST /api/genieacs-sync/hosts/:serial/read` (lectura bajo demanda,
  `server/src/services/tr069HostsOnDemand.ts`, función `result()`).

Vista simple "Todos"/"Conectados" (punto 6) en
`src/views/tr069/Tr069View.vue`: dos botones sobre la misma tabla, sin
estado nuevo persistido — "Todos" (predeterminado) muestra conocidos +
en vivo, "Conectados" filtra solo los que `hostStatusLabel` resuelve como
"Conectado" ahora mismo. Nunca oculta datos de forma permanente, solo
cambia qué se muestra.

Nada cambia en el comportamiento ya verificado: Hosts sigue consultando
**solo** al abrir la sección o pulsar "Actualizar" — sin polling, cron ni
timers (punto 7; confirmado por las pruebas existentes y nuevas, ver
abajo). Ninguna tarea TR-069 nueva se envió durante esta investigación.

## Pruebas (punto 8)

- `server/src/services/__tests__/tr069HostsHistory.test.ts` (nuevo, 6
  pruebas): 5 históricos → 2 recientes (los 3 ausentes quedan "Sin
  confirmar", nunca "Desconectado"); host que reaparece deja de ser
  fantasma; host sin MAC no se revive; retención de 30 días; tope de 64
  fantasmas; equipo no identificado no toca el historial.
- `server/src/services/__tests__/tr069HostsOnDemand.test.ts` (+1 prueba):
  reproduce el escenario real completo (lab con 5 Hosts reales de la
  evidencia del 28/10) — el CPE deja de anunciar 3, se pulsa "Actualizar",
  la lectura sigue mostrando los 5 pero solo los 2 vigentes quedan
  confirmados; los 3 ausentes nunca se declaran "Desconectado".
- `src/lib/__tests__/tr069HostsView.test.ts` (+1 prueba, 1 ajustada): la
  vista real "Todos" conserva un histórico sin confirmar; "Conectados" lo
  oculta sin perderlo (se sigue pudiendo volver a verlo con "Todos").

Resultado: backend `npm run test:provisioning` **325/325 PASS** (antes
318); frontend `npm run test:fetch-timeout` **498/498 PASS** (antes 497);
`npx tsc --noEmit -p tsconfig.server.json` y
`npx vue-tsc -p tsconfig.app.json --noEmit` limpios. Ninguna prueba
existente se modificó en su intención, solo se ajustó una aserción de
texto (`Conectado` vs el nuevo botón `Conectados`) y se actualizó el
mock de `setup()` del test de render real para incluir los dos bindings
nuevos (`hostsFilter`, `visibleHosts`) que la plantilla real ahora usa.

## Alcance y restricciones respetadas

Solo lectura de la caché de GenieACS durante la investigación (confirmado:
ninguna llamada `POST`/tarea se ejecutó manualmente); el único tráfico
TR-069 real en esta sesión fue el que ya hacía la VM en producción por su
cuenta (Informs periódicos). No se modificó la Huawei, WiFi, PPPoE, OLT ni
MikroTik. Sin migraciones. Sin despliegue — candidato local únicamente,
commit sin publicar a la espera de autorización aparte.

## Archivos tocados

- Nuevo: `server/src/services/tr069HostsHistory.ts`,
  `server/src/services/__tests__/tr069HostsHistory.test.ts`.
- Modificados: `server/src/routes/genieacsSync.ts`,
  `server/src/services/tr069HostsOnDemand.ts`,
  `server/src/services/__tests__/tr069HostsOnDemand.test.ts`,
  `src/views/tr069/Tr069View.vue`, `src/lib/__tests__/tr069HostsView.test.ts`.

Ningún archivo de Asistencia, Puntos, Campo, OLT, Rutinas, WiFi, PPPoE,
MikroTik ni de otras fases pendientes (Fase 175, etc.) se tocó.
