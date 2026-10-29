# SmartRayco — guía para Claude Code

## Antes de empezar

**Procedimiento único de continuidad (Claude Code y Codex, 28/10/2026):**
antes de tocar código, leer la sección **"ESTADO DE CONTINUIDAD"** al
inicio de `ESTADO_DESARROLLO.md` — es la única fuente de qué está
desplegado, qué se probó, qué queda pendiente, qué rama/commit usar y qué
tarea está autorizada. Reemplaza cualquier nota de cierre de sesión
anterior para ese propósito; esas notas (incluida la bitácora detallada
justo debajo) quedan como antecedente/detalle, nunca como fuente de verdad
si contradicen ese bloque. Al terminar una sesión con cambios relevantes:
**editar ese mismo bloque in-place**, no agregar una nota nueva aquí ni
allá. Esa misma sección de `ESTADO_DESARROLLO.md` define además el
procedimiento de despliegue en 5 fases separadas (`prepare`/`build`/
`deploy`/`verify`/`rollback`) y cómo Claude Code y Codex comparten avances
sin merge/push/despliegue automático.

**TR-069 HABILITADO REALMENTE en `HWTC1D3691B7` (29/10/2026, 23:24:51 UTC,
autorizado expresamente):** identidad reverificada en vivo (735
posiciones, match exacto) antes de escribir. Único comando real (Telnet
OLT): `tr069-mgmt 1 acs http://192.168.55.201:7547` + `state unlock` en
`pon-onu-mng gpon-onu_1/2/2:24`. Releído después: ambas líneas presentes,
`service 1 gemport 1 vlan 120` (Internet) intacto. `admin_state=enable`/
`run_state=working` sin cambios — servicio confirmado sin interrupción.
`olt_onts.tr069_enabled=true` ahora. **GenieACS: 0 dispositivos, sin
Inform nuevo** 2-3 min después — no se declara recuperado, no se forzó
nada; pendiente de observar. Cola de tareas GenieACS vacía (ya lo estaba
antes, esta tarea no tocó GenieACS). Cero cambios a WAN/VLAN/PPPoE/WiFi.
Hallazgo corregido en la misma sesión: credencial de OLT expuesta
brevemente por un `select('*')` propio — no se repitió. Detalle:
`docs/TR069-HABILITACION-REAL-HWTC1D3691B7-20261029.md`.

**Ficha OLT atascada en "Esperando conexión" — corregido, SIN publicar ni
desplegar (29/10/2026, misma noche):** distinto del problema de
comunicación TR-069 ya diagnosticado (no repetido). `deriveTr069EnableStatus`
mezclaba "nunca contactó" con "contactó antes, ahora viejo" en la misma
etiqueta. Agregados `configurado` (habilitado, sin match, <10 min) y
`sin_comunicacion_reciente` (hubo match real, ahora >30 min viejo, nunca
se confunde con "nunca contactó"); `conectado` ahora dice "Conectado a
GenieACS". `canManageTr069` sigue exigiendo exactamente `'conectado'`.
Confirmado por código: "Administrar TR-069" solo hace
`tr069-mgmt acs <url>` + `state unlock` (OMCI separado de wan-ip/PPPoE/
VLAN 120, nunca los toca) — sin ejecutarlo. Frontend-lib 510/510 PASS
(+9), backend sin cambios. Commit local, sin publicar. Detalle:
`docs/TR069-ENABLE-STATUS-ESTANCADO-20261029.md`.

**Hosts bloqueado por tareas ajenas atascadas — corregido, SIN publicar ni
desplegar (29/10/2026, misma noche):** 8 tareas `refreshObject` (botón
general "Actualizar" de la tarjeta TR-069, no Hosts) seguían creciendo sin
resolverse porque la Huawei no se comunica (diagnóstico TR-069 previo, no
repetido). El código de Hosts bloqueaba por la sola existencia de
*cualquier* tarea. Corregido en `tr069HostsOnDemand.ts`:
`FOREIGN_TASK_STALE_AFTER_MS = 5 min` — una tarea ajena de esa antigüedad o
más ya no bloquea; una reciente (<5 min) sigue bloqueando igual que antes;
sin fecha utilizable se trata como posiblemente activa. **Nunca se cancela
ni se borra ninguna tarea** (probado, cero `DELETE`). Backend 336/336 PASS
(+6). Commit local, sin publicar. Las 8 tareas reales quedan intactas en
GenieACS. Detalle: `docs/TR069-HOSTS-BLOQUEO-TAREAS-PENDIENTES-20261029.md`.

**Señal WiFi + mensajes de error de Hosts — PUBLICADO y DESPLEGADO
(29/10/2026, 20:46:23 UTC, autorizado expresamente):** commit `cee686b`
(incluye `ddcf083`+`0b0fc28`+`cee686b`) en producción — backend/frontend
`...cee686b673c1`, 126 artefactos, 11 rutas PASS, `401`, `ssidTasksSent:0`.
RSSI solo con identidad verificada (`00259E`/`HG8145X6-13`/
`V5R023C00S342`, confirmado leyendo el código real del contenedor);
mensaje 409 en lenguaje sencillo mostrado tal cual. `main` local y
`origin/main` sincronizados en `cee686b`. Rollback a `...eb96f77b7dca`
preparado y probado, no ejecutado. Diagnóstico TR-069 de la misma sesión
(solo lectura, sin intervenir): la Huawei de prueba no envía Inform desde
`2026-10-29T20:11:52.625Z` (36+ min); GenieACS sano; una tarea
`refreshObject` ajena a Hosts (botón general, no nuestro código) quedó
pendiente sin respuesta — consistente con pérdida real de comunicación
con el equipo, posiblemente relacionada con la desactivación de TR-069 en
SmartOLT que reportó el propietario (hipótesis, no verificable desde este
código). Detalle completo:
`docs/TR069-HOSTS-DESPLIEGUE-SENAL-Y-DIAGNOSTICO-20261029.md`
(antecedentes de diseño: `docs/TR069-HOSTS-FALLO-CONSULTA-20261029.md`,
`docs/TR069-HOSTS-SENAL-WIFI-CALIDAD-20261029.md`).

**Antecedente (superado arriba) — Señal WiFi de Hosts, investigada SIN
implementar (29/10/2026, turno anterior):** `X_HW_RSSI` tenía valor real
para `S26-Ultra-de-Warner` (`-40`, activo WiFi) pero sin ninguna unidad
verificable en el árbol TR-069 ni en investigación pública en ese momento.
Detalle: `docs/TR069-HOSTS-SENAL-WIFI-INVESTIGACION-20261029.md`.

**Corrección "solo 2 de 5 Hosts visibles" — PUBLICADA y DESPLEGADA
(29/10/2026, misma noche, autorizada expresamente):** causa real confirmada
por lectura directa de la caché de GenieACS (solo lectura, cero tareas
nuevas): el propio CPE Huawei dejó de anunciar 3 de 5 instancias
`Hosts.Host.{i}` en su árbol TR-069 (DHCP/ARP caducado, normal del router)
— backend/frontend ya mostraban el 100% de la caché, sin filtro oculto.
Corregido con `server/src/services/tr069HostsHistory.ts`: conserva visibles
los hosts ausentes con su última lectura real (nunca inventa un valor);
`hostStatusLabel` ya resolvía solo a "Sin confirmar" para datos viejos, así
que nunca se declaran "Desconectado" sin evidencia nueva. Vista
"Todos"/"Conectados" agregada. Backend 325/325 PASS, frontend-lib 498/498
PASS. Commits `4cf4ae8` (corrección) + `eb96f77` (ajuste de clases Tailwind
tras un `HISTORICAL_ASSETS_CHANGED:assets/index.css` real por clases nuevas
sin uso previo — corregido reutilizando el patrón de `MikrotikDetailView.vue`,
cero CSS nuevo). `main` local y `origin/main` sincronizados. Desplegado:
backend/frontend `...eb96f77b7dca`, 126 artefactos, 11 rutas PASS, `401`
sin autenticación, `ssidTasksSent:0`, rollback a `...ac511d7c70c8` probado.
Detalle causa/diseño: `docs/TR069-HOSTS-HISTORIAL-20261029.md`; despliegue
real: `docs/TR069-HOSTS-HISTORIAL-DESPLEGADO-20261029.md`.

**Hosts bajo demanda `ac511d7` YA DESPLEGADO y verificado (29/10/2026,
18:45 UTC), autorizado expresamente por el propietario** — supera al
párrafo siguiente (`d6ce2c2`), que queda como antecedente. Backend y
frontend: `...wifitrial:ac511d7c70c8` / `...consolidado:ac511d7c70c8`,
**build completo** (no selectivo) del commit, `reproducible:true`,
126 artefactos, 11 rutas PASS, `401` sin autenticación, `ssidTasksSent:0`.
Gate `TR069_HOSTS_ON_DEMAND_ENABLED=true` confirmado en vivo, serial único
`HWTC1D3691B7` (sin wildcard). Cola GenieACS vacía tras el deploy. Hosts
solo consulta al abrir su sección o pulsar Actualizar — sin polling,
confirmado por prueba (497/497 PASS incluye ese caso). Rollback preparado
(`prepare` fresco, no reutilizó el `prepare` de la sesión anterior porque
un reinicio de la VM cambió `Id`/`StartedAt` del contenedor — `build`
detectó `SERVICE_DRIFT_frontend` correctamente y se corrigió repitiendo
`prepare`, sin tocar el script). Validación visual del panel queda para
el propietario. Detalle completo: `docs/TR069-HOSTS-DESPLIEGUE-20261029.md`.

**Sincronización GitHub completada (29/10/2026, repositorio):** `main`
local y `origin/main` coinciden en `9e90c94` tras publicar 58 commits con
`git push origin main` normal (sin force/merge/rebase); el commit
documental de este despliegue se publica también, manteniendo ambas
puntas sincronizadas. Se crearon y publicaron 2 tags anotados sobre las
imágenes productivas previas a esta release:
`desplegado-tr069-hosts-backend-d6ce2c2` (backend que corrió hasta este
despliegue; el tag documenta que era un overlay de 1 solo archivo sobre
la imagen de `5d48a10`, no un build completo) y
`desplegado-tr069-hosts-frontend-5d48a10` (build completo del frontend).
Ver la nueva sección permanente "Disciplina de sincronización GitHub y
despliegues" más abajo.

La corrección Hosts `d6ce2c2` fue desplegada y verificada (28/10,
21:30 UTC): backend `smartrayco-backend-wifitrial:d6ce2c2f578f`; frontend
intacto en `5d48a10ea497` (misma imagen y arranque). Una Huawei única,
`found:true`, cinco Hosts reales por GET; serial hexadecimal/canónico y
serial inexistente verificados. La banda sigue sin confirmar; el estado debe
evaluarse con la fecha del propio valor, no solo con el Inform.
El bloqueo backend-only quedó resuelto en `d844ac6`: alcance explícito en
`deploy/consolidation-release-scope.json`, fuentes inmutables del commit,
servicios seleccionados y verificaciones de igualdad para el lado intacto.
12 pruebas del contrato cubren backend-only/frontend-only/ambos y rechazos
de cambios ajenos. `prepare`/`build`/`deploy`/`verify` PASS, doble build backend,
125 assets HTTP PASS, rollback a imágenes previas conservando configuración.
No repetir el diagnóstico de `HISTORICAL_ASSETS_NO_EXPECTED_CHANGE`: solo
se exige cambio de assets cuando el alcance declara frontend. El manifiesto
frontend NO identifica por sí solo una release backend-only.
Leer ESTADO DE CONTINUIDAD para evidencia, staging y rollback exactos.
Lectura activa Hosts autorizada y cerrada (28/10): GPV de 15 hojas completado
en Inform 22:03:39 UTC: cuatro WiFi, portátil Cable; Active=true solo S26-Ultra,
false en los otros cuatro, muestra con fecha propia. Segundo/último lote de
radio + subárboles falló en GenieACS: `script.Error / Invalid parameter path`
(no prueba limitación del firmware). Fue error agrupar subárboles terminados
en punto como GPV en vez del refreshObject acotado del plan. Tarea fallida
retirada, cero pendientes, retries:0, sin más lecturas ni reintentos.
Banda/asociaciones aún sin confirmar. Inform final 22:08:39.189 UTC.
Detalle y evidencia: `docs/TR069-HOSTS-ACTIVE-READ-20261028.md` y JSON.
**Prueba real Hosts bajo demanda PASS; despliegue DETENIDO (28/10):** código
exacto `e2c7bf7` ejecutado aislado en /tmp, una sola tarea GPV de 35 hojas,
HTTP 200, Inform 23:07:06.891 UTC, cinco Hosts con fechas propias renovadas.
S26-Ultra y Z2359 conectados; los demás desconectados en esa muestra.
X_HW_RSSI devuelve 0/-43/0/-57/0, sin unidad verificada: no inventar dBm/%.
Cola/faults vacíos al terminar; gate productivo seguía apagado.
Guard local `ac511d7` limita la habilitación a serial permitido (solo Huawei
planeada), sin cambiar el GPV probado; contrato solo permite dos ajustes de
entorno Hosts y compara el resto completo. 67 pruebas + 14 de release PASS.
Colisión de assets resuelta en `32e64ee`: dos workers QR legítimos, distintos
y sin cambios; se conservan por nombre físico, bytes y referencias exactas.
Extracción GPON comprobada y aceptada en `dce97e7`: AST del helper y OLT
equivalentes con bindings; index idéntico al deshacer únicamente las precargas
de OLT/TR-069. Fuente gponSerial intacta. Transición específica fijada por
hashes, commit, fuentes e importadores; ningún permiso general para otros chunks.
Metadatos Vite: corrección local `8b9f89d` valida estructura, referencias,
imports compilados, grafo, entradas HTML y hashes de artefactos; solo exime
`.vite/manifest.json` de igualdad binaria después de validarlo. CSS sintético
normalizado; los demás archivos siguen estrictos.
**Regla de unicidad corregida en `91e9ff1` — build real ya PASA, sigue SIN
DESPLEGAR:** la regla `INVALID_VITE_LIST:...AsistenciaPanel...:dynamicImports`
(bloqueo anterior) exigía listas sin repetidos también en `imports`/
`dynamicImports`, pero Vite nativamente repite una misma clave ahí cuando el
código fuente tiene varias llamadas `import()`/import estático al mismo
módulo (AsistenciaPanel→index.html ×4, ApexCharts SSR ×2, igual en activo y
candidato) — no era colisión ni corrupción. La unicidad ahora solo se exige
en `css`/`assets` (rutas físicas); el resto de controles del grafo, hashes e
identidad protegida no cambió. Suite: **31 PASS** (antes 30 PASS + 1 FAIL).
`prepare`+`build` reales sobre el candidato `ac511d7` (mismo alcance Hosts
backend+frontend, serial único): `{"built":true,"reproducible":true,
"contractGuardValidatedReadOnly":true,"frontendChangedAssets":
["assets/Tr069View.js","assets/tr069.js"]}` — pasó el punto exacto donde
antes fallaba. `deploy`/`verify`, doble build completo, nginx del candidato
y HTTP de todas las rutas **no ejecutados**; no afirmar que pasarían.
Detalle, evidencia y pendientes:
`docs/TR069-HOSTS-VITE-VERIFICADOR-CORREGIDO-20261028.md`
(antecedente del bloqueo: `docs/TR069-HOSTS-VITE-VERIFICADOR-20261028.md`).
**Despliegue de Hosts sigue sin autorización expresa del propietario.**
No repetir prueba activa ni reintentar release sin nueva indicación.

### Bitácora detallada de sesiones anteriores (antecedente — no es el punto de partida)

**Nota de cierre (despliegue de Hosts, sesión posterior):** Hosts
(`3670edc`) **ya se desplegó** (commit `5d48a10`), autorizado
expresamente. En el camino, `build` falló una vez con
`HISTORICAL_ASSETS_CHANGED:assets/tr069.js` (el store `tr069.ts` compila
en un chunk compartido con `OltDetailView.vue`/`campo.ts`, no solo con
`Tr069View.vue`) y se encontró que el script de release no empaquetaba el
archivo de backend nuevo (`tr069Hosts.ts`) — ambos corregidos en el propio
script (`d323d0e`, sin tocar código de la app) y verificados con evidencia
real antes de reintentar. `deploy`/`verify` en verde, `401` confirmado en
vivo específicamente para la ruta nueva, `ssidTasksSent:0`. No repetir
este diagnóstico — detalle completo: sección "Hosts / Dispositivos
conectados — DESPLEGADO" al inicio de `ESTADO_DESARROLLO.md`.

**Nota de cierre (Fase 1 + Fase 2, sesión posterior a la investigación):**
la corrección del botón WiFi (`16e2bd2`, SSID habilitado + contraseña
bloqueada a propósito + estados `unconfirmed`/`stuck`) **ya se desplegó**,
autorizado condicionalmente por el propietario tras verificar
respaldos/compatibilidad — `deploy`/`verify` en verde,
`ssidTasksSent:0` confirmado antes y después. Por separado, se implementó
"Dispositivos conectados" (Hosts) en el detalle TR-069 — commit `3670edc`,
**a propósito sin desplegar**. Detalle completo: secciones "TR-069 WiFi —
corrección final DESPLEGADA" y "Hosts / Dispositivos conectados" al inicio
de `ESTADO_DESARROLLO.md`.

**Nota de cierre (investigación solo lectura, sesión posterior al
incidente):** búsqueda pública (foro oficial de GenieACS) confirma que
`KeyPassphrase` directo es un problema ya conocido en Huawei (error 9007
reportado por otros); el parámetro que sí funcionó para varios, incluido
explícitamente en un Huawei HG8145V5, es
`WLANConfiguration.{i}.PreSharedKey.{j}.KeyPassphrase` — pero localmente no
hay ninguna instancia `PreSharedKey.1` descubierta todavía en
`HWTC1D3691B7` (confirmarlo requeriría una tarea nueva a GenieACS, no
autorizada en esa sesión). Nadie en esa comunidad reportó tampoco un método
de verificación por lectura — la validación siempre fue manual, igual que
nuestra propia conclusión. Sin evidencia local de que SmartOLT use un
método distinto para este modelo exacto. El bloqueo de contraseña
(`b51c161`) sigue siendo correcto y sin desplegar. No repetir este
diagnóstico — detalle completo: sección "Huawei: método correcto de
contraseña WiFi" al inicio de `ESTADO_DESARROLLO.md`.

**Nota de cierre (incidente real, misma noche, sesión posterior):** con
`508b75e` ya en producción, el propietario probó el cambio de contraseña
real: el SSID cambió pero la contraseña no funcionó al conectarse y el
panel quedó indefinidamente en "Guardando cambios". Causa raíz real,
confirmada solo con huellas SHA-256 (nunca el valor): este firmware Huawei
reporta `KeyPassphrase` como cadena vacía al leerlo de vuelta — un
parámetro de solo escritura para el ACS — así que SmartRayco no puede
verificar por esta vía si la contraseña se aplicó. El cambio de contraseña
queda **bloqueado en el código** hasta resolver esto (commit `b51c161`,
candidato local, sin desplegar); se agregaron los estados `unconfirmed`
(lectura concluyente pero vacía — nunca se declara éxito ni fallo falso) y
`stuck` (tarea sin respuesta por más de 20 min — nunca se reenvía sola) para
que el panel deje de quedarse en "Guardando cambios" sin explicación. No
repetir este diagnóstico — detalle completo: sección "TR-069: SSID cambia,
contraseña falla y panel queda 'Guardando cambios'..." al inicio de
`ESTADO_DESARROLLO.md`.

**Nota de cierre, 28/10/2026 19:09 UTC:** la corrección del botón
deshabilitado (nota siguiente) **ya se desplegó**, autorizado expresamente
por el propietario — commit `508b75e` en producción, `deploy` y `verify`
aparte en verde, cero tareas a GenieACS confirmado antes y después. Detalle:
sección "TR-069 WiFi — corrección del botón deshabilitado — DESPLEGADA" al
inicio de `ESTADO_DESARROLLO.md`. La mención de "sin desplegar" en la nota
siguiente queda desactualizada; se conserva tal cual por ser antecedente.

**Nota de cierre, 28/10/2026 (misma noche, sesión posterior):** el
propietario reportó el botón «Aplicar cambios» del formulario WiFi
deshabilitado para siempre en producción. Causa raíz: NO era una
validación de seguridad — el frontend y el backend bloqueaban cualquier
cambio nuevo por la sola existencia de un registro anterior (diseño de
"prueba piloto de un solo uso" que ya no aplica, la función es permanente).
Corregido en frontend y backend sin quitar ninguna protección real (commit
`33658df`, candidato local, sin desplegar). No repetir este diagnóstico —
detalle completo: sección "TR-069 WiFi — botón «Aplicar cambios»
deshabilitado..." al inicio de `ESTADO_DESARROLLO.md`.

**Nota de cierre, 28/10/2026 18:25 UTC:** el `deploy` que las notas de abajo
daban como "pendiente de autorización" **ya se ejecutó** (autorizado
expresamente por el propietario) — commit `f87aeef` (SSID + contraseña
WiFi) está en producción, `verify` posterior en verde, cero tareas enviadas
a GenieACS. Detalle completo: sección "TR-069 WiFi contraseña —
DESPLEGADO" al inicio de `ESTADO_DESARROLLO.md`. Las menciones de "sin
desplegar"/"pendiente autorización" en los párrafos siguientes quedan
desactualizadas; se conservan tal cual por ser antecedente, no se
reescriben.

**ACTUALIZACIÓN 28/10/2026 (tarde, misma sesión) — leer primero la sección
"TR-069 WiFi contraseña: `prepare`/`build` reales contra la VM..." al
inicio de `ESTADO_DESARROLLO.md`.** `prepare` y `build` del commit `f87aeef`
(contraseña WiFi, sobre `de683e4`) ya se ejecutaron REALES contra la VM —
`rollbackTested:true`, `reproducible:true`, nada desplegado todavía. En el
camino se encontró y corrigió un defecto estructural real en
`scripts/frontend-consolidation-release.py`: `prepare` dependía de una
release vieja fija para el respaldo/rollback, lo que haría fallar con
`BACKUP_BASE_DRIFT` cualquier `prepare` posterior al primer `deploy` real de
esta cadena (ya ocurrido con `fabc136`) — corregido para que cada `prepare`
respalde la imagen EN VIVO en ese momento, sin esa dependencia. No repetir
ese diagnóstico. **Pendiente: autorización expresa del propietario para
`deploy`** (comando exacto en `ESTADO_DESARROLLO.md`).

**ACTUALIZACIÓN 28/10/2026 (continuación del cierre de anoche) — antecedente,
ver arriba.** El `deploy` de `fabc136` **ya se ejecutó** (confirmado en vivo,
backend/frontend `fabc13672cd3` corriendo) y **el propietario confirmó que
la prueba real de cambio de SSID en `HWTC1D3691B7` funcionó** sin afectar su
navegación. A partir de esto se preparó la capacidad de cambiar también la
contraseña WiFi desde el mismo formulario — confirmada técnicamente viable
(mismo mecanismo que el SSID). Detalle: `docs/TR069-WIFI-CONTRASENA-PREPARADA-20261028.md`.

**CIERRE DE JORNADA 28/10/2026 (noche Perú) — antecedente, ver actualización
arriba.** Resumen (ya superado: el `deploy` que aquí figuraba pendiente se
ejecutó después, fuera de esta conversación): `build` de `fabc136` terminó
`"built":true` tras corregir el verificador dos veces (ambas correcciones
documentadas con evidencia real, no repetir ese diagnóstico). Comando
exacto usado y procedimiento completo (respaldo/rollback): sección "CIERRE
DE JORNADA" de `ESTADO_DESARROLLO.md`. El resto de la "Base vigente" de
abajo (frontend consolidado 288f2d8, Asistencia, Puntos, Campo, inventario)
sigue intacto y no cambia con este cierre.

**Base vigente — frontend consolidado y WiFi desplegados (27/10, 17:08 Perú).**
Usar `integration/frontend-productivo-tr069-20261027`, worktree
`scripts/inventory-auth-lab/runtime/frontend-productivo-tr069-worktree`.
Código publicado: **`288f2d8ac3c4ed0d2279b9a01618885bcfb02b9f`**. No compilar un
checkout raíz/VM atrasado: el estado real está en `/release-manifest.json` del panel.
Integrados Asistencia A0–A3/pestañas, Puntos noviembre, Campo dirección/GPS,
inventario ACS actual/histórico y WiFi posterior. 93 unitarias (incluidas las 42
TR-069), navegadores focalizados, doble build reproducible y rollback aislado PASS.
Frontend `smartrayco-frontend-consolidado:288f2d8ac3c4`, backend selectivo
`smartrayco-backend-wifitrial:288f2d8ac3c4`; otros servicios intactos. «Configurar»
habilita solo WLAN 5.SSID de HWTC1D3691B7/CTR-2026-00214 para ADMIN/SUPERADMIN,
con respaldo/confirmación/verificación/restauración. **Prueba manual real pendiente;
Codex envió cero tareas.** Se preservó la configuración efectiva de custodia nula,
sin activar la fecha de Compose que no estaba compilada. Main remoto `88dec40`
conservado; la rama integra sus 4 commits pendientes sin forzar historial.
Continuidad técnica/futuros builds: `docs/FRONTEND-CONSOLIDACION-CONTINUIDAD-20261027.md`.
Este estado prevalece sobre la parada anterior, conservada abajo como antecedente.
Git: rama de integración publicada con push normal; main local alineado por
fast-forward, 21 archivos pendientes previos respaldados/conservados. Main remoto
sigue `88dec40`; incorporarlo por PR revisada, sin force ni nuevos merges amplios.

Lee primero `ESTADO_DESARROLLO.md` (raíz del repo) — tiene el estado real
(implementado/desplegado/pendiente), la arquitectura, el último commit
desplegado y los riesgos/trabajos pendientes conocidos. Evita repetir
análisis ya hecho. Mantenlo actualizado al final de cada sesión relevante
(qué cambió, qué quedó pendiente, próximo paso recomendado) — es la
referencia compartida entre Claude Code y ChatGPT para este proyecto.

Después consulta `docs/REGISTRO-VERSIONES-PRODUCTIVAS.md` para las versiones
reales por servicio y `docs/FASE175-CONTADORES-ACTIVADOS-20261026.md` para la
evidencia de Fase 175. **Fase 175 está desplegada y operativa:** backend
`16831c6`, muestreo automático recuperado con 360 registros nuevos del
Administrador. El HTTP 400 por URL excesiva está corregido con lotes de 100;
los errores y rollbacks anteriores son antecedentes, no incidentes activos.
Seguimiento de ciclos y certificación integral de 3.000 clientes siguen
pendientes, pero no invalidan la recuperación real ya confirmada.

**`verify` antes de `deploy` SIEMPRE falla con `CANDIDATE_NOT_DEPLOYED_*` — no
es un bloqueo (28/10/2026):** `verify` reutiliza `probe()`, la misma función
que valida DESPUÉS de desplegar; compara la imagen corriendo contra la
candidata construida, así que correrlo antes de `deploy` fallará siempre por
diseño. Antes daba `reason:""` (assert sin mensaje); corregido para que
diga la causa real (`scripts/frontend-consolidation-release.py`, función
`probe()`). No reabrir este diagnóstico — ver sección al inicio de
`ESTADO_DESARROLLO.md`.

## TR-069 Huawei (HWTC1D3691B7) — gestión independiente operativa, corrección de identificación DESPLEGADA (27/10/2026)

**`build` de `fabc136` terminó `"built":true` — segundo bloqueo diagnosticado
y corregido con evidencia real, nada desplegado (28/10/2026):** al reintentar
`build` con la primera corrección, `HISTORICAL_ASSETS_CHANGED` volvió a
fallar, ahora señalando `OltDetailView.js`, `RankingTecnicosView.js`,
`RoutineDetailView.js`, `equipmentPhotoType.js`, `foFibra.js`, `index.js` y
`release-manifest.json` — ninguno tocado por `fabc136`
(`git diff --stat 288f2d8 fabc136` confirma 0 cambios ahí). Se reprodujo el
fallo real (PowerShell SÍ ejecuta el verificador corregido: solo aparecían
estos 7, no los ~120 que marcaría la versión vieja) y se extrajeron ambas
imágenes reales (la que corre ahora y la candidata recién construida) por
SSH, solo lectura, para comparar. **Causa real:** el frontend en producción
ya acarrea archivos huérfanos de builds incrementales anteriores — del
contenedor activo, 779 archivos en total pero solo 122 realmente alcanzables
desde `index.html`; el resto (657) es historial nunca limpiado de fases
previas (Asistencia, Puntos, Campo...). El `Dockerfile` generado para esta
release copia el `dist/` nuevo ENCIMA de esa imagen sin vaciarla primero, así
que la imagen candidata hereda ese mismo historial. Comparar el árbol crudo
completo (aun sin el hash, la primera corrección) mezclaba huérfanos de
distintas generaciones con la pieza real, dando falsos positivos. **Corregido
sin relajar el control:** la comparación ahora solo recorre el grafo
REALMENTE ALCANZABLE desde `index.html` (igual que lo cargaría el navegador,
siguiendo imports de verdad) en ambas imágenes — confirmado real: 122
alcanzables en cada lado, estructura idéntica, y el único archivo con
contenido distinto es `assets/Tr069View.js` (el declarado). Validado con las
imágenes reales antes de tocar el script, y después **ejecutado el `build`
completo, que terminó `{"built":true,"reproducible":true,
"contractGuardValidatedReadOnly":true,"servicesChanged":false}`** — sin
desplegar, sin tocar producción, sin tareas GenieACS. El acarreo de archivos
huérfanos en la imagen en vivo es una condición preexistente (no causada por
esta release ni por esta corrección), inofensiva para la operación (archivos
sin referenciar, no se sirven) pero pendiente de una limpieza futura del
Dockerfile de consolidación — no se tocó en esta sesión por estar fuera de
alcance. Siguiente paso: `deploy` desde la terminal del propietario.

**`build` de `fabc136` corregido tras `HISTORICAL_ASSETS_CHANGED` — candidato
local, nada desplegado (28/10/2026, recuperación tras corte de luz):** el
propietario ejecutó `node scripts/frontend-consolidation-release.cjs build`
desde su propia terminal (continuación del `prepare` ya verificado) y obtuvo
`{"ok":false,"reason":"HISTORICAL_ASSETS_CHANGED"}`. Causa real identificada y
confirmada con una comparación de builds reales (commit `288f2d8` en
producción vs `fabc136`, mismo entorno, dos worktrees descartables): Vite
nombra cada chunk con un hash de su propio contenido e incluye ese nombre en
todo chunk que lo importa, incluido el mapa de prefetch del entry común
(`__vite__mapDeps`); como `fabc136` sí modifica frontend (`Tr069View.vue` +
`src/lib/tr069WifiTrial.ts`, formulario simplificado), el chunk de esa vista
cambia de nombre, y ese cambio de nombre se propaga en cascada a los ~120
demás archivos compilados sin que su lógica cambie en absoluto — confirmado
byte a byte: el único archivo con contenido realmente distinto, una vez
neutralizadas las referencias con hash, es el chunk de `Tr069View`. La
comparación anterior (`scripts/frontend-consolidation-release.py`) exigía
hash exacto igual para todo archivo salvo `index.html`, un supuesto válido
solo para parches 100% backend (como `5104253` antes) pero incompatible con
cualquier cambio de frontend, por mínimo que sea. **Corrección aplicada** (sin
relajar el control): la comparación ahora se hace por nombre sin el sufijo
hash y con las referencias internas a otros archivos neutralizadas — detecta
igual cualquier cambio real fuera de alcance, pero ya no confunde el
reetiquetado de Vite con una regresión. El alcance permitido para esta
release (`assets/Tr069View.js`, el único) queda declarado explícitamente en
`scripts/frontend-consolidation-release.cjs` (`frontAllow`), inyectado al
script remoto — no es un bypass genérico, una release futura con otro alcance
de frontend debe actualizar esa lista. Validado con los dos builds reales
(estructura idéntica, único archivo cambiado = el declarado) antes de tocar
el script; sin ejecutar `deploy` ni tocar producción. Pendiente: que el
propietario reintente `build` desde su terminal — ver comando exacto y
siguientes pasos en `ESTADO_DESARROLLO.md` (sección al inicio del archivo).

**Despliegue de la corrección `fabc136` — PAUSADO en `prepare`, nada en vivo
tocado (27/10/2026, misma sesión posterior):** autorizado por el propietario.
VM verificada por SSH: sigue corriendo `288f2d8` (frontend y backend),
coincide con lo documentado. `prepare` (respaldo fresco de las imágenes que
corren ahora + rollback verificado) se ejecutó con éxito: nada en producción
cambió. `build` quedó bloqueado por el clasificador de seguridad de Claude
Code ("Credential Materialization") al intentar validar en vivo contra
Supabase real con el entorno del backend — mismo tipo de restricción ya
conocida para OLT/MikroTik. **No se ejecutó `build`, `deploy` ni ninguna otra
acción.** Cero tareas a GenieACS. Detalle, comandos exactos y las dos opciones
para continuar: `ESTADO_DESARROLLO.md` (sección al inicio del archivo).

**Resultado WiFi anterior — prevalece (continuación con Claude Code, 27/10/2026):**
la primera prueba manual real del propietario quedó bloqueada con
«La identidad, instancia o SSID actual cambió; vuelve a consultar». Causa
encontrada y corregida en candidato local: GenieACS refresca `_timestamp` en
cada Inform que reporta el parámetro (incluido el periódico de 300s ya
confirmado real en esta ONT) aunque el valor no cambie; exigir que ese
timestamp coincidiera byte a byte con el que vio el panel bloqueaba casi
cualquier envío real con solo el paso normal del tiempo. Se quitó esa
comparación en `server/src/services/tr069WifiTrial.ts`; la comparación real
de seguridad —el SSID vigente contra el esperado— sigue intacta y se
revalida en vivo justo antes de escribir. También se simplificó el
formulario (estilo SmartOLT): seleccionar red, nuevo nombre, nueva
contraseña (opcional, **bloqueada** hasta validar compatibilidad real — el
backend tampoco acepta ese campo) y «Aplicar cambios»; rutas TR-069,
deviceId, serial largo y mensajes con jerga se movieron a "Detalles
técnicos" (plegado), nunca se eliminaron. 6/6 + 19/19 + 3/3 pruebas
focalizadas PASS, 272/272 y 480/480 de las suites completas de servidor/lib
sin regresión, TypeScript limpio. **Candidato local únicamente: sin push, sin
despliegue, cero tareas enviadas a GenieACS durante la corrección.** Detalle
completo: `ESTADO_DESARROLLO.md` (sección al inicio del archivo).

**Resultado WiFi anterior (27/10, 16:26 Perú):** el propietario
autorizó implementar/desplegar, reservando el cambio SSID para su clic manual.
Candidato de escritura/restauración de solo WLAN 5.SSID implementado local,
42/42 pruebas y TypeScript PASS; 6 capturas con stores ficticios. **Despliegue
DETENIDO, botón real NO disponible:** la base frontend reconstruida no reproduce
el HTML activo (`BASELINE_FRONTEND_NOT_REPRODUCIBLE`). No forzar promoción ni
mezclar fases. Imágenes/configuración respaldadas; 5 contenedores verificados
sin cambios y `deployAttempted=false`. Cero tareas reales enviadas por Codex.
No reabrir diagnóstico de conexión. Detalle, rollback y siguiente paso:
`docs/TR069-WIFI-DESPLIEGUE-DETENIDO-20261027.md`.

**Comunicación TR-069 real CONFIRMADA.** La interfaz de gestión OMCI
independiente (VLAN 200, IP `10.15.15.200`, patrón tomado de 6 Huawei
GPT-2741GNAC reales ya configuradas en la OLT) quedó aplicada y
operativa en la ONT de prueba `HWTC1D3691B7` (1/2/2:24): GenieACS recibió
**3 Informs reales**. Internet (VLAN 120) y PPPoE del cliente se
conservaron durante toda la prueba — hubo un incidente de navegación
reportado por el propietario que se recuperó al reconectar el cable de
red del equipo de prueba; no se atribuye causa definitiva a TR-069 (ni
la sesión PPPoE ni los Informs mostraron ninguna interrupción durante la
ventana del incidente).

**Hallazgo e identificación:** GenieACS reporta el serial de esta Huawei
como `485754431D3691B7` (16 hex, vendor ID también hex-codificado),
mientras la OLT usa `HWTC1D3691B7` (ASCII + hex) — es el mismo serial
GPON de 8 bytes (ITU-T G.984.3), otra representación. La comparación
literal que ya existía nunca encontraba la coincidencia. **Corregido en
local, commit `5104253`**: nuevo `src/lib/gponSerial.ts`
(`normalizeGponSerial`/`matchTr069Device`, comparación exacta completa,
nunca parcial; inválido/ambiguo nunca vincula solo), aplicado a los 2
consumidores reales (`GET .../tr069/status` y `GET /onts/status` en
`server/src/routes/olt.ts`). 26 pruebas nuevas + 452 frontend + 247
backend, todas en verde; verificado con datos reales de Supabase
(solo lectura) que el panel ya derivaría "Conectado" en vez de
"Esperando conexión" con esta corrección.

**Estado preciso: corrección de identificación DESPLEGADA en
producción** (2026-10-27 ~20:18 UTC, autorización expresa). Backend
`smartrayco-backend-tr069fix:5104253-20261027T201808Z` (sobre
`...tr069enable:516faba-...`, solo `olt.ts`/`gponVendorId.ts`/
`gponSerial.ts` nuevo); frontend sin cambios (el commit no lo requiere).
Verificado con el código REAL desplegado y datos reales de Supabase:
`matchTr069Device` ya resuelve `HWTC1D3691B7` ↔ `485754431D3691B7`.
Rollback preparado, no usado (imagen anterior respaldada con SHA256).
Publicado en GitHub en rama propia (no `main`, ver nota de
sincronización en el doc consolidado) y en
`diagnostico/tr069-genieacs-readonly` (commits `7105679`/`8968e69`, ya
en producción). Commits en `main`: `516faba` (botón guiado), `5a1cfc0`
(gestión independiente OMCI), `f61f771` (sintaxis de reversión más
segura), `877bec6` (preparación final), `94d447e` (incidente y
recuperación), `5104253` (corrección de identificación de serial),
`83f06b4` (sincronización de continuidad).

**Confirmación visual completada por el propietario**, comunicada al retomar
desde Claude: `HWTC1D3691B7` muestra «TR-069: Conectado», el botón
«Administrar TR-069» está habilitado y GenieACS muestra el equipo en línea.
Esta evidencia no implica que se haya probado modificar WiFi.
**Pendiente**: autorizar una prueba controlada aparte de cambio de WiFi desde
SmartRayco sobre esta ONT, acordar el cambio y su reversión, y comprobar su
aplicación real y la continuidad de internet/PPPoE. No intentada todavía.
La retoma de confirmación visual (`1ae1603`) fue solo documental.
**Diagnóstico posterior de administración, solo lectura (27/10):** GET de caché
GenieACS confirma raíz `InternetGatewayDevice`, SSID/KeyPassphrase en WLAN 1 y
5; `_writable=true` no acredita escritura probada. Enable, banda y seguridad
sin valores; WANPPPConnection anunciado sin instancia/usuario legible. La lectura
WiFi actual exige Enable=true y oculta estas redes. Antes de probar: identidad
normalizada en administración, path validado, contrato exacto, solo ADMIN/SUPERADMIN
(incluido proxy) y operación WiFi separada de PPPoE. «Administrar TR-069» aún abre
asignación de ACS en OLT. Sin cambios productivos ni tareas de GenieACS.
Detalle y preparación reversible: `docs/TR069-ADMINISTRACION-HUAWEI-SOLO-LECTURA-20261027.md`.
**Preparación WiFi posterior implementada SOLO LOCAL:** formulario reutilizado
para un SSID, serial normalizado único, Enable desconocido visible, preparación
solo ADMIN/SUPERADMIN y Huawei HWTC1D3691B7/deviceId exacto. Respaldo descargable
del SSID y comparación GET de caché; sin contraseñas ni PPPoE. Escrituras WiFi,
PPPoE, provisionado combinado y proxy NBI bloqueados en este candidato. No está
desplegado, no escribió nada y aún no tiene vía habilitada de aplicar/revertir.
Prueba física requiere autorización independiente y contrato exacto verificado.
Procedimiento: `docs/TR069-WIFI-PREPARACION-SEGURA-20261027.md`.
**Validación visual local posterior completada:** Chrome con stores ficticios,
9 capturas etiquetadas como simulación, escritorio/móvil, respaldo descargado,
confirmación cancelable y mensajes pendiente/error. Banda explícita o «Banda
desconocida» por red; no inferir 5 GHz por SSID. Comparación exige nuevo Inform
y fecha nueva de SSID; Inform solo no confirma. 37/37 pruebas y TypeScript PASS.
Sin tareas, producción ni habilitación de escritura. Evidencia/procedimiento:
`docs/TR069-WIFI-VALIDACION-VISUAL-20261027.md`.
**Preflight puntual real posterior (27/10 16:05 Perú, solo GET):** serial único
confirmado, ONT→cliente prueba zava→contrato activo CTR-2026-00214 concordantes;
registro TR-069 único pero service_contract_id sigue null. Cero tareas pendientes.
SSID RAYCO 18 (WLAN 1) y WirelessNet-5G (WLAN 5), ambos banda/Enable desconocidos,
writable anunciado true; valores de 15:37 Perú, no renovados por el Inform 16:02.
Propuesta no autorizada: WLAN 5.SSID → WirelessNet-5G-PRUEBA. **Todavía no lista:**
confirmar selección/SSID efectivo, tratamiento del vínculo nulo sin cambiarlo y
vía de ejecución/reversión aún bloqueada. Plan, respaldo y autorización puntual:
`docs/TR069-WIFI-PRIMERA-PRUEBA-PREFLIGHT-20261027.md`. Sin cambios productivos.
Detalle completo y consolidado:
[TR069-CONTINUIDAD-HUAWEI-20261028.md](docs/TR069-CONTINUIDAD-HUAWEI-20261028.md).
Equipos seriados, custodia, devoluciones, Asistencia y Puntos permanecen
cerrados tal como están documentados abajo — esta sección no los reabre.

## Devoluciones de App de Campo — estado vigente (26/10/2026)

Acceso implementado y desplegado en `/campo/mi-custodia`: «Solicitar devolución»
para materiales y equipos bajo custodia. El artefacto anterior conservaba una
vista de solo consulta; se incorporó selectivamente el código ya aprobado
`fb56057`, con publicación `c11f6a8`. Frontend `smartrayco-campo-returns:c11f6a8-20261026T171151Z`;
backend `16831c6` conservado sin reinicio. Sin SQL ni permisos nuevos.
Pruebas de navegador del candidato/publicado con datos ficticios PASS;
25/25 SQL/unitarias previas conservadas. **Devoluciones de materiales y
equipos seriados implementadas, desplegadas y validadas funcionalmente**.
El propietario confirmó expresamente el **26/10/2026** que probó
satisfactoriamente la devolución desde App de Campo en Android y su recepción
administrativa. **Ambas pruebas COMPLETADAS; flujo probado y cerrado.**
No volver a registrarlas como pendientes ni repetir pruebas anteriores.
Frontend `c11f6a8`, backend `16831c6` sin cambios; antecedentes publicados:
`c11f6a8` y documentación `6a8dadd`. Este cierre prevalece sobre las notas
de aceptación pendiente de informes anteriores, conservadas como antecedentes.
Sin pruebas nuevas ni operaciones productivas en esta actualización.
Detalle/rollback: `docs/CUSTODIA-DEVOLUCIONES-CORRECCION-LOCAL.md`;
versiones exactas en `docs/REGISTRO-VERSIONES-PRODUCTIVAS.md`.

## Equipos seriados, custodia e instalación — fase cerrada operativamente

El propietario confirma que el **25/10/2026** se realizaron **tres instalaciones
reales exitosas** con instalación de equipos desde App de Campo. El circuito
está implementado y desplegado: **entrega al técnico → custodia → instalación
y devolución**, operativo y **sin defectos reportados**. Devolución y recepción
administrativa ya fueron validadas y cerradas por el propietario el 26/10/2026.
No volver a tratar esta fase como desarrollo pendiente ni exigir repetir las
pruebas anteriores para reconocer su cierre operativo.

Alcance de la evidencia: es la confirmación expresa del propietario sobre las
tres instalaciones. No acredita por separado cada categoría ONT, Mesh y TV Box,
ni verificaciones individuales de serie/MAC, contrato o movimientos de custodia.
No inventar esos detalles ni confundir cierre operativo con certificación
individual por categoría. Versiones productivas documentadas conservadas:
frontend `c11f6a8`, backend `16831c6`. La meta permanente de estabilidad y
rendimiento para al menos **3.000 clientes** se mantiene como requisito
transversal; no reabre esta fase operativa.

Esta actualización es solo documental: sin pruebas, auditorías, código,
consultas productivas, migraciones ni cambios de inventario/contratos.

## Capacidad mínima (requisito permanente)

SmartRayco debe soportar al menos **3.000 clientes** con estabilidad y
rendimiento. Distinguir pruebas simuladas de escalabilidad y certificación
integral con carga real; no declarar una como sustituto de la otra.

## Contexto

SmartRayco está en fase de pruebas operativas reales (octubre 2026). Técnicos y
administradores lo usan en campo. Clientes, servicios y datos son reales —
protegerlos siempre (ver regla 13).

## Usabilidad para personal administrativo (regla permanente)

SmartRayco lo usa a diario personal administrativo **sin conocimientos
técnicos de redes** — toda interfaz debe ser intuitiva, clara y
comprensible para ese usuario, no solo correcta para quien conoce el
dominio técnico. Aplica a corrección y desarrollo en **Clientes,
Contratos, OLT, Soporte, Rutinas, Altas, Inventario, Facturación y App
Campo** — no solo al módulo en que se trabaje puntualmente.

Requisitos obligatorios:

1. Mostrar nombre del cliente, código y contrato cuando estén
   vinculados y **verificados** — nunca inferidos por nombre,
   descripción o posición física (ver regla 6 de la migración OLT).
2. Mostrar fecha y hora **real** del evento (nunca la hora de
   renderizado) en horario de Perú (`America/Lima`, sin asumir la zona
   horaria del dispositivo de quien mira la pantalla).
3. Ofrecer acceso directo a la ficha del cliente o del servicio/contrato
   correspondiente — no obligar a buscarlo aparte.
4. Mensajes de error y alertas en lenguaje sencillo: qué ocurrió y qué
   debe hacer el usuario — no un mensaje técnico crudo (código, log,
   jerga de red) como única explicación.
5. Los datos técnicos (serial, slot/puerto, señal, mensajes crudos)
   siguen disponibles, pero como información **secundaria** — nunca lo
   primero que se lee.
6. No obligar al personal a buscar manualmente un dato que el sistema
   ya tiene y puede resolver solo (mismo cliente, mismo contrato, misma
   zona ya cargados en otra parte del mismo panel).
7. Sin vínculo verificable, mostrar **"Pendiente de vincular"** — nunca
   inventar ni asumir un dato para rellenar el hueco.
8. Respetar siempre los 3 roles operativos reales (regla 9 de la
   migración OLT: SUPERADMIN, ADMIN, TECNICO_RED).

Precedente ya implementado siguiendo esta regla (referencia de patrón,
no repetir su investigación): Fase B de discrepancias PON↔zona↔contrato
(`src/lib/ontZoneDiscrepancy.ts`, `OntZoneDiscrepancyModal.vue`), las
alertas operativas de OLT (`src/lib/oltAlertPresentation.ts`,
`ESTADO_DESARROLLO.md` 13as) y su historial (`GET /:id/alert-log`,
sección "Historial de alertas" dentro de la misma tarjeta en
`OltDetailView.vue`, 13at/13au — tabla `olt_alert_log` ya **aplicada y
desplegada en producción**, migración `20261014150451`) — mismo
criterio de vínculo verificable (en el historial, un *snapshot* al
momento del evento, nunca el vínculo de hoy), hora real en horario de
Perú con la distinción explícita entre "hora de detección" y hora real
del evento, acceso directo a la ficha, datos técnicos como secundarios.

Fase 5 (`src/lib/oltConnectionStatus.ts`, pestañas "Estado
actual"/"Historial de alertas" en la misma tarjeta de
`OltDetailView.vue`, `ESTADO_DESARROLLO.md` 13aw, DESPLEGADA) es el
ejemplo más reciente de esta regla aplicada **sin ningún backend
nuevo**: todos los conteos/listas/avisos se derivan de datos ya
cargados en el panel (`oltStore.onts`, `summary`, el propio
`GET /:id/alert-log`) — útil como referencia de que mejorar la
visualización para personal administrativo no siempre requiere
tabla/endpoint/servicio nuevo, solo agregación pura y bien probada
sobre lo que ya existe.

**Admin-disabled ≠ desconectado, y admin-disabled ≠ deuda (13ax, ver
`ESTADO_DESARROLLO.md`)**: una ONU con `admin_state='disable'` (mismo
dato que SmartOLT reporta como "admin-disabled mode") NUNCA debe
contarse ni mostrarse como "sin conexión" — `admin_state` manda
SIEMPRE sobre `status`, incluso si `status` quedó en `'online'` de
antes de suspenderse. Caso real confirmado (Danner Ávalos Ventura,
CTR-2026-00356): admin-disabled con `debt_hold_status='none'` en su
contrato — pese a que el operador afirmaba que era "por deuda", el
propio sistema no lo corrobora. Por eso el motivo "por deuda/mora"
**solo** se muestra si hay evidencia confiable
(`service_contracts.debt_hold_status='suspended'`, ya cruzado por
`GET /:id/onts/disabled`/`suspensionReasonLabel` en
`oltConnectionStatus.ts`) — nunca inferido del admin-state solo.

**El cruce de mora es SIEMPRE por `contract_id` exacto, nunca por
`client_id` (13ay)**: un cliente con 2+ contratos, donde solo uno está
en mora, no debe "contagiar" ese motivo a sus demás servicios al día.
Ver `server/src/services/oltDisabledReason.ts`
(`resolveDisabledReason`, puro) — si se vuelve a tocar
`GET /:id/onts/disabled`, mantener el cruce por `contract_id`, no
retroceder a `client_id`.

## Modo de desarrollo y validación eficiente

Objetivo: detectar, corregir y validar problemas sin auditorías completas en
cada modificación — reducir trabajo/tokens redundantes, no bajar el estándar
de calidad.

1. Antes de modificar código, identifica únicamente el módulo y los archivos
   relacionados (usa Grep/Glob dirigido, no una exploración amplia).
2. No leas todo el repositorio si el problema está localizado.
3. No repitas análisis que ya estén documentados — revisa primero
   `docs/ERRORES-CAMPO.md` y la memoria de proyecto.
4. Usa primero las pruebas automatizadas existentes (`npm pkg get scripts`
   para ver las disponibles: `test:telnet`, `test:provisioning`,
   `test:fetch-timeout`, `test:nap-sql`, `test:single-active-job-sql`, etc.)
   antes de escribir pruebas nuevas desde cero.
5. Al corregir un error funcional, crea una prueba de regresión pequeña y
   reutilizable — para RPCs/triggers de Supabase, sigue el patrón de
   `server/tests/*.sql.test.ts` (Postgres real en Docker, aislado, con el
   archivo de migración real cargado tal cual).
6. Usa mocks y datos sintéticos para pruebas que puedan modificar
   información real. Nunca ejecutes escrituras de prueba contra Supabase de
   producción, la OLT real ni MikroTik real.
7. Evita generar documentación HTML o informes extensos para correcciones
   menores — un resumen de texto alcanza.
8. No repitas compilaciones (`vue-tsc`, `tsc`, `npm run build`) si los
   archivos relevantes no cambiaron desde la última corrida.
9. No ejecutes suites completas salvo que el alcance o el riesgo lo
   justifique — corre primero solo el/los scripts de prueba del módulo
   tocado.
10. Resume resultados en un máximo de 10 líneas, salvo errores importantes.
11. No muestres logs completos si basta con indicar el resultado y las
    líneas relevantes del error.
12. No hagas preguntas cuando el problema se pueda resolver con la
    arquitectura existente — pregunta solo ante una decisión que de verdad
    requiera al usuario (dato ambiguo, cambio que afecte datos/equipos
    reales, alcance fuera de lo pedido).
13. Datos reales protegidos siempre: nunca un `UPDATE`/`DELETE` de prueba
    contra Supabase de producción, la OLT real (10.15.15.2) ni MikroTik
    real. Confirmar el destino antes de cualquier escritura en vivo.
14. Revisar primero si una funcionalidad ya existe (y cómo) antes de
    implementarla — buscar en el código, no asumir desde memoria ni desde
    un prompt anterior. No duplicar funciones/componentes ya existentes.
15. Comentarios/commits en español, consistente con el resto del proyecto.
    Commit solo después de pasar las pruebas correspondientes al cambio.
16. **Nunca aplicar una migración en Supabase de producción ni ejecutar
    `bash deploy/update.sh` en la VM sin que el usuario lo pida
    explícitamente en ese mismo turno** — "implementa esto" o "corrige
    esto" NO es autorización para migrar/desplegar; esperar un pedido
    explícito tipo "aplica la migración y despliega". Esto aplica incluso
    si ya se desplegó algo similar antes en la misma sesión.

## Validación por niveles

- **Nivel 1** (cambio cosmético/UI acotado): prueba localizada + comprobación
  visual.
- **Nivel 2** (cambio funcional de un módulo): pruebas del módulo + validación
  backend + comprobación en campo (pedir al usuario que lo pruebe si aplica).
- **Nivel 3** (cambio estructural/BD/multi-módulo): pruebas de integración +
  respaldo + revisión de riesgos + reversión preparada antes de aplicar.

Elige el nivel según el riesgo real del cambio, no automáticamente el más alto.

## Disciplina de sincronización GitHub y despliegues (permanente, 29/10/2026)

Establecida tras la sincronización de 58 commits y el despliegue de Hosts
del 29/10/2026 — reutiliza siempre
`scripts/frontend-consolidation-release.cjs` (`prepare`/`build`/`deploy`/
`verify`/`rollback`) y `deploy/consolidation-release-scope.json`; **no crear
un sistema paralelo** ni una auditoría general para cumplir esto.

1. Antes de cualquier `deploy`, confirmar que el código autorizado ya está
   respaldado en GitHub (`git fetch origin` + comparar `main` local contra
   `origin/main`; nunca asumir desde memoria de una sesión anterior).
2. Si hay commits locales sin publicar, distinguir cuáles pertenecen a la
   fase que se va a desplegar de los pendientes de otras fases (ver punto 3
   de "ESTADO DE CONTINUIDAD" en `ESTADO_DESARROLLO.md`); sincronizar solo
   con operaciones Git seguras (`push` normal) — nunca `force`, `merge` ni
   `rebase` para "resolver" una divergencia sin antes detenerse a revisarla.
3. Cada despliegue real registra: commit fuente, archivos exactos incluidos
   (backend/frontend), imagen Docker anterior y nueva (con su sha256), y su
   estado de verificación (`prepare`/`build`/`deploy`/`verify` PASS/FAIL).
4. Si la compilación es selectiva (overlay de archivos declarados sobre una
   imagen base, no un build completo del commit), **documentarlo
   explícitamente** — qué archivos vinieron de qué commit y sobre qué
   imagen base — y **nunca** crear un tag o nota que le atribuya
   falsamente un commit completo. Si es un build completo reproducible,
   puede documentarse como tal (ver `build.reproducible`/`artifactCount`).
5. Después de un `deploy`, ejecutar `verify` y las comprobaciones
   funcionales que correspondan (rutas, salud, autenticación, cola
   GenieACS si aplica) antes de darlo por bueno; registrar el resultado
   real, no solo "parece que funcionó".
6. Tras desplegar, actualizar `CLAUDE.md` y `ESTADO_DESARROLLO.md` **in
   situ** (nunca apilar notas sueltas), publicar ese commit documental en
   GitHub si no arrastra archivos de otras fases, y verificar que `main`
   local y `origin/main` vuelven a coincidir exactamente.
7. Distinguir siempre y por separado: **IMPLEMENTADO** (código existe y
   pasa sus pruebas), **RESPALDADO EN GITHUB** (publicado, `main` y
   `origin/main` coinciden), **DESPLEGADO** (corriendo en la VM de
   producción, confirmado leyendo el sistema en vivo) y **PROBADO
   FUNCIONALMENTE** (verificación real, no solo compilación). Una fase no
   está "cerrada" si falta cualquiera de los cuatro.
8. No declarar una fase cerrada ante el propietario mientras falte alguno
   de esos cuatro estados — decir expresamente cuál falta.
9. No incluir en un despliegue cambios de otras fases aunque ya estén en
   `main` (ver regla de alcance explícito del punto 4 y
   `deploy/consolidation-release-scope.json`).
10. Si GitHub, `main` local y lo que corre en la VM no coinciden entre sí,
    **detener el siguiente despliegue** hasta identificar la causa exacta
    de la diferencia — nunca asumir cuál de las tres fuentes tiene razón
    (mismo principio que la regla 8 de "Migración OLT" para OLT vs
    Supabase, aplicado aquí a código/imagen en vez de datos de cliente).

## Migración OLT — vínculo cliente/contrato/ONT (permanente)

SmartRayco está migrando gradualmente la administración desde SmartOLT y
registros anteriores — faltan ~400 abonados por registrar (2026-10-13).
Mientras dure esa migración, **toda sesión debe consultar esto antes de
tocar flujos de OLT, clientes o aprovisionamiento** — ver el caso real
documentado en `ESTADO_DESARROLLO.md` (Violeta García Silva / Clara
Caballero Valderrama / Mayco Paredes Rodríguez) para el precedente
completo.

**Tres situaciones posibles, permanentes mientras dure la migración:**

- **A — ONT online sin cliente/contrato en SmartRayco**: el abonado puede
  ser real y estar navegando normalmente; su info administrativa
  simplemente no se migró todavía. **Nunca asumir** que es una ONT
  abandonada, duplicada o disponible para eliminar.
- **B — Cliente y contrato registrados, pero sin ONT vinculada**: el
  abonado existe en SmartRayco, falta relacionar su ONT física. No
  implica necesariamente que esté sin servicio — verificar serial,
  posición, contrato y PPPoE antes de vincular.
- **C — Cliente, contrato y ONT correctamente vinculados**: igual hay que
  distinguir el estado real de la OLT del último `last_synced_at` de
  SmartRayco — no son lo mismo.

**Reglas permanentes:**

1. La OLT real es la referencia para serial, posición y estado físico
   — siempre que la consulta sea actual y verificable (no asumir desde
   una lectura vieja).
2. Supabase es la referencia para clientes, contratos y sus relaciones
   administrativas.
3. Nunca eliminar ni desautorizar una ONT solo porque aparece sin
   cliente vinculado (Situación A) — eliminar su fila en `olt_onts`
   también manda `no onu` a la OLT real y corta el servicio.
4. No duplicar clientes, contratos, usuarios PPPoE ni equipos durante
   la migración — buscar primero si ya existe (por nombre, documento,
   serial) antes de crear algo nuevo.
5. No reprovisionar una ONT que ya navega solo para completar
   información administrativa — vincular `client_id`/`contract_id` es
   una escritura de metadatos en Supabase, nunca requiere volver a
   autorizar/registrar en la OLT.
6. No sobrescribir nombres o descripciones administrativas sin
   comprobar su procedencia — un `description` puede venir de la OLT
   (texto libre, no confiable) o de una edición administrativa real.
   **Ya implementado**: "Importar ONTs desde la OLT" deja de pisar
   `description` en cuanto una ONT queda vinculada a un cliente **y el
   serial sigue siendo el mismo** — si el serial cambia en una posición
   ya vinculada (ONT reemplazada/trasladada), esa fila no se toca en
   absoluto y se reporta como conflicto para revisión manual, nunca se
   resuelve sola (ver `oltImportDescriptionGuard.ts` y 13ai/13aj en
   `ESTADO_DESARROLLO.md`) — si se toca ese import, mantener esa
   protección de 3 vías (sin vincular / vinculada mismo serial /
   conflicto), no volver a la versión que solo miraba la posición.
7. Mantener intactos los servicios existentes durante toda la
   migración — cualquier corrección se valida de solo lectura primero.
8. Si hay discrepancia entre lo que dice la OLT y lo que dice
   Supabase, **detener la operación y pedir verificación** — no
   adivinar cuál de las dos fuentes tiene razón.
9. Solo usamos 3 roles operativos reales: **SUPERADMIN, ADMIN y
   TECNICO_RED** — SOPORTE/FACTURACION no se usan; no desarrollar
   funcionalidades nuevas para ellos ni tocar sus políticas existentes.
10. **Ingresar un dato una sola vez, reutilizarlo en todos los módulos**
    — nunca pedir el mismo dato dos veces en formularios distintos si ya
    existe una fuente confiable (ver Fase 3 OLT, PON↔zona↔contrato↔App
    Campo, `ESTADO_DESARROLLO.md` 13ak-13am): `zones.name` codifica el
    número de PON oficial (`src/lib/ponZoneMapping.ts`); cada ONT se
    compara contra su cliente/contrato real por `contract_id`, nunca por
    nombre/posición (`src/lib/ontZoneDiscrepancy.ts`); al cerrar un
    traslado desde App Campo, la zona se deriva de la caja NAP que el
    técnico ya eligió en vez de pedírsela de nuevo, y la sincronización
    de NAP+zona de la ONT reutiliza SIEMPRE la transacción de Fase 158
    (`assign_contract_nap_sync_ont_zone`, ver `src/lib/ontZoneSync.ts`
    `canSyncOltZone`/`resolveClosureTargetZoneId`) — nunca una escritura
    paralela nueva. Ante una discrepancia entre fuentes, se informa (nunca
    se calla ni se adivina) y se deja para revisión humana — regla 8.

**"Traslado de servicio" en Rutinas (2026-10-13, ver `ESTADO_DESARROLLO.md`
13an-13ap)**: `routines.contract_id` (Fase 159) ya está aplicada en
Supabase producción — `routines` ahora identifica el contrato/servicio
EXACTO que se traslada (nunca por `client_id` solo). El selector de
contrato (`RutinasView.vue`), la sección de traslado en App Campo
(`CampoTrabajoDetailView.vue`) y el cierre vía Fase 158
(`campo.ts`/`ontZoneSync.ts`) están implementados y probados con pruebas
unitarias (`routineTraslado.ts`). El historial "anterior→nuevo" se
congela con el mismo mecanismo de borradores que `closureForm`
(`resolveTrasladoAnteriorSnapshot`) — **nunca recalcularlo desde
`activeContract` directo**, un reintento podría ya tener el contrato
mutado. **Todavía no se probó con un traslado real de punta a punta** ni
se desplegó — no declarar esta funcionalidad "terminada" ante el usuario
sin esa verificación real.

## Registro de errores de campo

Todo bug reportado desde campo (técnicos/administradores usando el sistema
real) se registra en `docs/ERRORES-CAMPO.md` — ver ese archivo por el
formato. Revisarlo antes de investigar un problema nuevo: puede que ya esté
documentado.
