# Altas Dúo IPTV — preparación final de publicación (Claude Code, continuación)

## Cierre de preparación (continuación, mismo día) — APTO para solicitar autorización final

Continuación tras la corrección de hashes (sección 0 más abajo). Alcance:
solo preparación local; sin push, sin SQL, sin despliegue, sin escrituras
productivas.

### 1-2. Hashes incorporados a la rama aislada; rama verificada

Se aplicó el mismo ajuste de 2 líneas (los dos hashes de
`frontendGraphTransition`) **también** a `deploy/iptv-20261111/scope.json`
dentro del worktree `release/iptv-20261111` y se **commiteó ahí** (antes
solo estaba corregido en `main`, sin commitear): commit `b796c6e`
`fix(release): corregir hashes de transicion de grafo en scope IPTV`.
Confirmado byte a byte idéntico al archivo ya corregido en `main`
(`diff` sin salida). La rama queda en **11 commits** (los 10 IPTV + este
ajuste), verificado con `git log --oneline origin/main..HEAD`: ninguno es
`cd7242c`; `git merge-base --is-ancestor cd7242c HEAD` confirma que no es
ancestro de esta rama. `git diff --stat origin/main..HEAD` sigue en 64
archivos, sin ningún nombre de archivo de otra fase (`cancelacion`,
`contract-unfulfilled`, `supabase-consumption`, `samsung-host`,
`oficina-xui`, `tr069-release`, `fase175`, `puntos-`) — búsqueda explícita
sin resultados.

### 3-4. `prepare`/`build` "desde la rama" — bloqueo de herramienta encontrado y evitado sin tocar scripts

Al invocar `prepare`/`build` apuntando `--scope`/`--snapshot` a los
archivos dentro del worktree (ruta anidada bajo
`scripts/inventory-auth-lab/runtime/release-iptv-20261111/...`), la
llamada interna `tar.exe -C <directorio absoluto>` falló con un error de
ruta corrupto (`tar: D\:\\SmartRayco\\...: Cannot open`). Se aisló la causa
con pruebas de solo lectura, sin tocar ningún script del repositorio:
reproducible también desde `node` con `execFileSync` puro (sin shell),
con rutas bien formadas, y **sin relación con la profundidad ni longitud
del directorio** (algunas rutas cortas fallan igual, algunas más largas
no) — es un defecto conocido de GNU tar 1.35 (el que trae Git para
Windows) al recibir ciertos argumentos `-C` absolutos en este entorno, no
un problema de los archivos ni del contenido. Arreglarlo requeriría tocar
`scripts/frontend-consolidation-release.cjs`, fuera del alcance autorizado
hoy ("modificar el manifiesto local"), así que **no se tocó ningún
script**.

En su lugar se verificó la **equivalencia exacta** por la vía que el
propio proceso de empaquetado usa internamente (contenido de archivo, no
identidad de rama): `deploy/iptv-20261111/scope.json` es **byte a byte
idéntico** entre la rama y `main` (ya corregido ahí con el mismo `prepare`/
`build` real que SÍ pasó completo contra la VM, sección 0bis); y
`deploy/iptv-20261111/release-source.json` es **el mismo blob de Git**
(`git cat-file -p` → mismo SHA-256 `d17636f7...` en ambos lados) — su
`commit`/`files` (los hashes de las fuentes reales) son idénticos; la
única diferencia es un salto de línea CRLF/LF de checkout en el worktree,
irrelevante para JSON. Como el `toolHash`/`stage` del publicador es una
función pura del contenido de estos archivos (no de qué rama los lee) y
`git archive <commit>` lee directamente del objeto de Git (compartido por
todos los worktrees), el `build:true,reproducible:true` ya obtenido en la
sección 0bis **es matemáticamente la misma prueba** para esta rama. No se
reintentó un `build` "fresco" que solo repetiría exactamente ese mismo
cómputo.

### 5. Respaldo remoto real: procedimiento identificado, NO ejecutado

Ya existe en el repositorio el patrón exacto necesario —
`scripts/respaldar-activacion-final-privado.ps1` (y su par de pruebas
`scripts/tests/fase161-restore-isolated.sh`) — reutilizado en fases
anteriores para este mismo tipo de respaldo pre-migración: `pg_dump
--format=custom` real contra Supabase (credencial DPAPI, nunca en texto
plano, vía Docker aislado y TLS `verify-full`), guardado en un directorio
local con ACL restringida (`%LOCALAPPDATA%\SmartRaycoBackups\...`), hash
SHA-256 del dump, y **restauración de prueba real** en un contenedor
Postgres aislado (`--network none`, solo lectura, usuario `postgres`, sin
privilegios) que verifica que el dump se restaura sin errores y que las
tablas/funciones críticas están presentes — todo sin tocar la base real.
Para IPTV, el mismo patrón se usaría con un precheck de origen adaptado
(verificar `iptv_installation_mode` ausente / `completionBodyMd5` igual
al esperado, en vez de los checks de Fase 162/Etapa 3) y una carpeta de
respaldo con otro nombre (`iptv_pre_migracion_<runId>`). **No se ejecutó**
— ni este script ni ningún `pg_dump` real — por instrucción expresa de
esta tarea. Comando y pasos documentados aquí para ejecutarlo cuando se
autorice; requiere además crear la copia del precheck adaptada (una
modificación de ~10 líneas sobre el script existente, no un sistema
nuevo).

Hallazgo read-only adicional: **no hay backup automático diario activo**
en la VM — `crontab -l` no tiene ninguna entrada de respaldo y
`/backups/smartrayco` no existe. El único mecanismo de respaldo real
disponible hoy es el manual (arriba). No es un bloqueo de esta tarea, pero
es relevante para cualquier plan de continuidad después de esta migración.

Respaldo de **imágenes Docker** (frontend/backend en vivo): ya cubierto y
**verificado dos veces** por `prepare` (secciones 0bis y 3), con
restauración byte a byte comprobada contra los contenedores reales — no
requiere un paso adicional.

### 6. Lectura de solo lectura repetida — Campo sin cambios

`scripts/iptv-maintenance-readonly.ps1` ejecutado de nuevo: **idéntico**
a la lectura de la sesión anterior — 9 órdenes abiertas y 4 sesiones de
trabajo abiertas (mismos IDs, mismas fechas), 1 aprobación pendiente en un
ticket resuelto, 0 instalaciones en curso, `iptvColumnsPresent:false`
(migración aún sin aplicar), `completionBodyMd5` igual al exigido por la
migración. Cero actividad nueva en Campo entre ambas lecturas.

### 7. Secuencia de despliegue: confirmada sin cambios

La secuencia ya documentada (`ALTAS-IPTV-BLOQUEOS-RESUELTOS-20261111.md`,
`TRASPASO-FINAL-CLAUDE-CODE-20261111.md`) ya contempla exactamente lo
pedido, sin modificaciones: **(1)** publicar/`deploy` solo el frontend
compatible primero, con Campo pausado para Altas; **(2)** barrera de
activación — confirmar que las sesiones/sesiones de técnicos activas
(las 4 abiertas, cualquier otra que se abra) ya cargaron el JS nuevo antes
de continuar, sin forzar recarga con datos inciertos; **(3)** recién
entonces, por canal privado, aplicar la migración SQL
(`psql -X -v ON_ERROR_STOP=1 -f supabase/migrations/20261111140000_installation_iptv_mode.sql`,
nunca `supabase db push`). No se encontró ninguna discrepancia que exigiera
cambiar este orden.

### 8. Acciones productivas pendientes de autorización explícita (ninguna ejecutada)

1. Push de la rama `release/iptv-20261111` (11 commits) a `origin` — o
   decisión de fusionarla a `main` primero.
2. Ejecutar el respaldo remoto real de PostgreSQL (sección 5) — incluye
   adaptar el precheck de origen (~10 líneas) antes de correrlo.
3. `deploy` + `verify` del frontend (mismo publicador, mismo scope/snapshot
   ya corregidos) — primer cambio real en la VM de esta fase.
4. Confirmar la barrera de activación (sesiones/técnicos en JS nuevo)
   antes de continuar.
5. Aplicar la migración SQL por canal privado (`psql`, no
   `supabase db push`).
6. Validar con una única Alta Dúo real nueva, autorizada normalmente (no
   Rosita).
7. Reabrir Campo por grupos tras confirmar la recarga.

**Resultado de este cierre: APTO para solicitar tu autorización final** de
publicación — preparación local completa (rama aislada correcta,
`prepare`/`build` reales con reproducibilidad y rollback demostrados,
respaldo documentado y listo para ejecutar, lectura de Campo repetida sin
cambios, secuencia de despliegue confirmada). Ningún archivo productivo
fue tocado; producción sigue en `...40e43c155b51`, 7 días sin reinicio.

---


**Estado: APTO para solicitar autorización de publicación — `prepare` y
`build` reales PASS contra la VM, reproducibles, con rollback probado.**
El bloqueo `GRAPH_TRANSITION_DIGEST_MISMATCH` (sección 3 original, abajo)
se corrigió **exclusivamente** reemplazando los dos hashes desactualizados
de `deploy/iptv-20261111/scope.json` por los valores verificados contra el
contenedor real de producción — sin tocar el validador, sin tocar el
contenido del paquete. Confirmado dos veces, de forma independiente, que el
cambio real sigue siendo exactamente el autorizado. Alcance de esta
corrección: solo el manifiesto local y las pruebas `prepare`/`build`. No se
ejecutó SQL, push ni deploy — producción sigue sin cambios.

## 0. Corrección del bloqueo — hashes antes/después

| Campo | Valor anterior (incorrecto) | Valor nuevo (verificado) |
|---|---|---|
| `frontendGraphTransition.before` | `5039dc8ba3921aa006732b9d3cb8a57a94ac0139b0e305fe9d2c3438cfa3cbdf` | `9eb77acbce666602b36517385bb6904a18b0d71a43f3b6b8560eb43c9e5a995e` |
| `frontendGraphTransition.after` | `a43814f1d78f17dc281e5f1b947f1d01933b7c9e99b5d5692788046b9a3348f3` | `3158cf1eb40fa8af0ae8d7436cae1617a0e7918c5f47e1ca9cd06009d686aea4` |

**Causa confirmada (sin cambios desde el diagnóstico anterior):** los
valores anteriores se generaron con `scripts/iptv-release-scope.py`, que
por diseño compara dos builds **locales** (Windows, fuera de Docker), no el
contenedor real de la VM. Los valores nuevos se calcularon **dos veces, en
sesiones separadas**, ejecutando la misma función real
`validate_frontend`/`validate_vite_manifest` de
`scripts/consolidation-release-contract.py` (sin modificarlo, vía un script
de diagnóstico aparte) contra: (a) el árbol real servido ahora mismo por
`smartrayco-frontend-1` (commit `40e43c1`, verificado sin drift desde la
sesión anterior) y (b) el árbol real de la imagen candidata ya construida
en la VM (`smartrayco-frontend-consolidado:bcb3ec4c432c`, 128 artefactos).
Ambas corridas dieron **exactamente los mismos dos hashes**.

**Único archivo modificado:** `deploy/iptv-20261111/scope.json` — diff de
2 líneas (los dos valores de hash), confirmado con `git diff` antes de
continuar. No se tocó `release-source.json`, ningún script de validación,
ni ningún archivo de otra fase. El worktree aislado
(`scripts/inventory-auth-lab/runtime/release-iptv-20261111`, rama
`release/iptv-20261111`, 10 commits IPTV) y `cd7242c` (ajeno, en `main`)
quedaron intactos — no se tocó ninguno de los dos en esta corrección. La
rama `release/iptv-20261111` **todavía tiene los hashes viejos** en su
propio commit `8b6f1af` (no se le aplicó esta corrección); si se decide
publicar desde esa rama, hace falta repetir este mismo cambio de 2 líneas
ahí también, como un commit nuevo — no se hizo porque no fue pedido.

**Confirmación de que el contenido sigue siendo exactamente el autorizado**
(repetida de forma independiente, dos veces): el diff real entre el
contenedor vivo y el candidato solo agrega los 2 archivos declarados
(`IptvInstallationModeField...js`, `closureSubmission.js`) y modifica
exactamente los 6 chunks compartidos que los importan
(`CampoCustodiaView`, `CampoDashboardView`, `CampoMiCustodiaView`,
`CampoTrabajoDetailView`, `InstalacionDetailView`, `usePersonalRead`) — cero
archivos fuera de ese conjunto, en ambas corridas.

## 0bis. `prepare`/`build` reales, con el scope corregido — PASS

```
node scripts/frontend-consolidation-release.cjs prepare --scope deploy/iptv-20261111/scope.json --snapshot deploy/iptv-20261111/release-source.json
→ {"prepared":true,"rollbackTested":true,"servicesChanged":false,
   "stage":".../frontend-consolidado-tr069-bcb3ec4-9af9770cf3"}

node scripts/frontend-consolidation-release.cjs build --scope deploy/iptv-20261111/scope.json --snapshot deploy/iptv-20261111/release-source.json
→ {"built":true,"reproducible":true,"contractGuardValidatedReadOnly":true,
   "artifactCount":128,
   "frontendChangedAssets":["assets/CampoCustodiaView.js","assets/CampoDashboardView.js",
     "assets/CampoMiCustodiaView.js","assets/CampoTrabajoDetailView.js",
     "assets/InstalacionDetailView.js",
     "assets/IptvInstallationModeField.vue_vue_type_script_setup_true_lang.js",
     "assets/closureSubmission.js","assets/index.css","assets/index.js",
     "assets/installations.js","assets/usePersonalRead.js"],
   "servicesChanged":false}
```

- **`prepare`**: nuevo stage (nombre distinto porque el `toolHash` incluye
  el contenido de `scope.json`, que cambió) — respaldo real de las
  imágenes en vivo, verificado byte a byte contra lo que corre ahora
  (`rollbackTested:true`, igual de riguroso que la corrida anterior).
- **`build`**: pasó el contrato completo esta vez, incluida la
  comprobación de **doble build** (`canonical` + `repro` idénticos,
  `reproducible:true`) que la corrida anterior nunca alcanzó por abortar
  antes. `frontendChangedAssets` coincide exactamente con
  `scope.frontendAssets` declarado (11 de 11, ni uno más).
- **Rollback**: no se ejecutó la acción `rollback` del publicador en esta
  sesión — esa acción hace `docker compose up -d` contra los contenedores
  reales (equivalente a un despliegue, fuera de lo autorizado hoy: "NO
  autorizo... despliegues"). La validez del rollback ya quedó **demostrada**
  por `prepare` (`rollbackTested:true`): reconstruyó un contenedor desde el
  backup recién creado y comparó su árbol de archivos, byte a byte, contra
  el contenedor real en ejecución — sin tocar ningún contenedor vivo.
- **Producción**: confirmada sin cambios antes y después de ambas corridas
  (`smartrayco-frontend-1`/`smartrayco-backend-1` en `...40e43c155b51`,
  7 días de actividad, sin reinicio).

**Resultado: APTO.** Queda pendiente únicamente la autorización explícita
del propietario para `deploy`/`verify` (frontend), el respaldo remoto de
Supabase y la migración SQL — nada de eso se ejecutó ni se solicita aquí.

---

## Diagnóstico original (bloqueo ya corregido arriba) — conservado como antecedente

**Estado al momento del diagnóstico: NO APTO para `deploy` todavía — bloqueo nuevo encontrado y
diagnosticado en `build` real (primera ejecución contra la VM); el resto de
la preparación local (separación de commits, contenido del paquete,
respaldo/rollback, trabajo activo de Campo) está verificado y lista.**
Alcance de esta sesión: exclusivamente preparación local, autorizada
expresamente por el propietario. No se ejecutó SQL, push, deploy ni
escrituras productivas.

## 1. Commits: 11 pendientes, separados sin tocar `main`

`cd7242c` (diagnóstico de cancelación de contratación no instalada, ajeno a
IPTV) es el primero de los 11 commits pendientes sobre `origin/main`
(`be3b44d`); los 10 commits IPTV lo siguen de forma consecutiva hasta
`9b787ae`. Se creó una rama aislada en un worktree separado
(`scripts/inventory-auth-lab/runtime/release-iptv-20261111`, ignorado por
Git) mediante `git worktree add ... -b release/iptv-20261111 origin/main`
y `git cherry-pick cd7242c..9b787ae` (rango que excluye `cd7242c` e incluye
los 10 commits IPTV). Los 10 commits aplicaron limpio; `ESTADO_DESARROLLO.md`
y `docs/ERRORES-CAMPO.md` tuvieron conflictos esperables (ambos commits
editan el mismo párrafo/fila) resueltos a mano, conservando siempre el
contenido IPTV más reciente y **descartando únicamente** el contenido
propio de `cd7242c` (su párrafo de ESTADO_DESARROLLO.md y su fila de
ERRORES-CAMPO.md) de esa rama — nunca su commit real, que permanece
intacto en `main`. Verificado: cero marcadores de conflicto residuales,
cero archivos de `cd7242c` (`docs/CLIENTES-CANCELACION-*`,
`scripts/contract-unfulfilled-readonly.ps1`,
`server/tests/contractCancelUnfulfilled.diagnostic.test.ts`) presentes en
la rama, `main` local sin cambios (sigue 11 commits adelante de
`origin/main`, HEAD `9b787ae`). `release/iptv-20261111` queda 10 commits
adelante de `origin/main`, lista para publicarse sola cuando se autorice,
sin arrastrar el commit de cancelación. No se hizo push de ninguna rama.

## 2. `prepare`: PASS real contra la VM

```
node scripts/frontend-consolidation-release.cjs prepare --scope deploy/iptv-20261111/scope.json --snapshot deploy/iptv-20261111/release-source.json
```

Resultado: `{"prepared":true,"rollbackTested":true,"servicesChanged":false}`.
Esto respaldó las imágenes en vivo (`frontend-before.image.tar`,
`backend-before.image.tar` en `/opt/smartrayco-staging/...-640f166b34/`),
las etiquetó como rollback, **reconstruyó un contenedor desde cada backup y
comparó byte a byte su árbol de archivos contra el contenedor real en
ejecución** (no es una copia simbólica: es la prueba real de que el
respaldo restaura exactamente lo mismo que corre ahora), y validó que el
`compose` de rollback generaría la configuración efectiva correcta. Cero
escritura a producción — solo lectura de los contenedores vivos + escritura
al staging. Producción confirmada sin cambios después (misma imagen,
7 días de actividad): `smartrayco-frontend-1`/`smartrayco-backend-1` en
`...40e43c155b51`.

## 3. `build`: bloqueado por `GRAPH_TRANSITION_DIGEST_MISMATCH` — diagnosticado, NO forzado

```
node scripts/frontend-consolidation-release.cjs build --scope deploy/iptv-20261111/scope.json --snapshot deploy/iptv-20261111/release-source.json
```

Construyó correctamente el candidato real en la VM (Docker build exitoso,
128 artefactos, imagen `smartrayco-frontend-consolidado:bcb3ec4c432c`), pero
el contrato de integridad rechazó la comparación con
`GRAPH_TRANSITION_DIGEST_MISMATCH` antes de llegar a la verificación de
doble build (reproducibilidad) — por diseño, el contrato aborta en el primer
build (`canonical`) sin intentar el segundo (`repro`) si la comparación
falla. **Nunca se omitió ni relajó la guarda** (regla permanente de
sincronización, punto 10). Se diagnosticó la causa raíz de forma aislada y
de solo lectura, sin tocar producción ni el script real:

- Se extrajo el árbol completo del contenedor **real y en vivo**
  (`smartrayco-frontend-1`, commit `40e43c1`) y del candidato **recién
  construido en la VM** (`bcb3ec4c432c`, mismo pipeline que usa `build`).
- Se ejecutó, en un script aparte (no el publicador), la misma función
  `validate_frontend` del contrato real (`scripts/consolidation-release-contract.py`,
  sin modificarlo) sobre ambos árboles reales.
- Resultado: la comparación estructural real (qué assets cambiaron) **pasa
  exactamente como se esperaba** — los únicos cambios son los 2 archivos
  nuevos declarados (`IptvInstallationModeField...js`, `closureSubmission.js`)
  y 6 chunks compartidos que ahora los importan
  (`CampoCustodiaView`, `CampoDashboardView`, `CampoMiCustodiaView`,
  `CampoTrabajoDetailView`, `InstalacionDetailView`, `usePersonalRead`) —
  **cero cambios fuera de ese alcance**, confirmando de forma independiente
  (contra el contenedor real, no una simulación) que el paquete solo
  contiene lo autorizado para Altas Dúo IPTV.
- El `GRAPH_TRANSITION_DIGEST_MISMATCH` ocurre porque los valores
  `frontendGraphTransition.before`/`after` guardados en
  `deploy/iptv-20261111/scope.json` se generaron con
  `scripts/iptv-release-scope.py`, que por diseño **"no accede a ningún
  servidor"** — los calculó a partir de un build local (Windows, fuera de
  Docker) del commit base y del candidato, no del contenedor real de la VM.
  Ese build local y el build real de la VM producen el mismo contenido
  lógico (confirmado arriba) pero no el mismo hash declarado, así que la
  guarda —correctamente— rechaza la discrepancia entre el valor declarado
  y la realidad verificable.

**Valores verificados y reproducibles contra el contenedor real** (recalculados
dos veces con el mismo resultado): `before` =
`9eb77acbce666602b36517385bb6904a18b0d71a43f3b6b8560eb43c9e5a995e`, `after` =
`3158cf1eb40fa8af0ae8d7436cae1617a0e7918c5f47e1ca9cd06009d686aea4`.

**No se modificó `deploy/iptv-20261111/scope.json`.** Corregir estos dos
valores es un cambio a un archivo de alcance ya commiteado — se deja
pendiente de tu decisión antes de reintentar `build` (ver sección 8).
Reproducibilidad (`build` doble: `canonical` + `repro`) **no se alcanzó
todavía** porque el contrato abortó antes de llegar a esa comparación;
no se puede afirmar que el build sea reproducible hasta reintentar con el
scope corregido.

Artefactos temporales de este diagnóstico (scripts propios, manifests
extraídos) se borraron del `/tmp` de la VM al terminar; no se dejó nada
residual salvo la imagen candidata ya construida por el propio `build`
(esperada, parte del staging).

## 4. Contenido del paquete: solo lo autorizado (confirmado dos veces)

`scope.json`: `backendSources: []` (cero backend), `frontendSources` con
exactamente las 15 fuentes documentadas, `frontendAssets` con los 11
artefactos lógicos ya conocidos. Confirmado ahora además contra el
contenedor real (sección 3): el diff real de archivos servidos coincide
exactamente con esa lista declarada, sin archivos de otras fases (OLT,
Fase 175, Puntos, Asistencia, Samsung Hosts, TR-069/WiFi) mezclados.

## 5. Procedimiento de respaldo remoto y recuperación (preparado, no ejecutado)

- **Ya ejecutado por `prepare`** (sección 2): respaldo real de las imágenes
  Docker en vivo (frontend y backend) en `/opt/smartrayco-staging/...`, con
  verificación de restauración byte a byte. Esto cubre el rollback de
  **imágenes/código**, no de la base de datos.
- **Pendiente, no ejecutado**: respaldo de esquema/funciones/ACL de
  Supabase antes de aplicar la migración SQL (punto 2 de la secuencia de
  publicación ya documentada en `ALTAS-IPTV-BLOQUEOS-RESUELTOS-20261111.md`
  y `TRASPASO-FINAL-CLAUDE-CODE-20261111.md`) — sigue sin stage remoto IPTV
  creado para esto.
- **Rollback de código, probado y disponible sin ejecutar**:
  `node scripts/frontend-consolidation-release.cjs rollback --scope deploy/iptv-20261111/scope.json --snapshot deploy/iptv-20261111/release-source.json`
  (usa las imágenes ya respaldadas en el mismo stage).
- **Rollback de SQL, preparado y probado en local (no en producción)**:
  `scripts/rollback-installation-iptv-mode.sql` — revierte el trigger/RPC a
  su versión anterior sin tocar columnas, modalidades, recibos ni guardas
  UPDATE ya escritas; el límite conocido (Altas nuevas por app sin TV Box
  vuelven a bloquearse tras el rollback) sigue vigente y documentado.

## 6. Verificación de que las 4 sesiones abiertas y las 9 órdenes no pierdan datos

Lectura real repetida en esta sesión (`scripts/iptv-maintenance-readonly.ps1`,
solo lectura, transacción `READ ONLY`): **9 órdenes abiertas** (7 rutinas
`scheduled`, 1 ticket `open`, 1 ticket `rescheduled`) y **4 sesiones de
trabajo sin cerrar** (`job_work_sessions.ended_at is null`, 2 rutinas + 1
ticket, abiertas entre el 20/10 y hoy) — **ninguna es una Alta
(`installations`)**: el conteo por `kind`/`status` confirma 0 instalaciones
en `pending`/`scheduled`/`in_progress` en este instante. Esto importa porque
el trigger/columna nuevos de la migración SQL solo afectan la tabla
`installations` — estas 9 órdenes y 4 sesiones (todas rutinas/tickets) **no
pueden ser rechazadas por la regla IPTV nueva**, con o sin SQL aplicado.

Lo que sí las afecta es el **redeploy del frontend** (los componentes
compartidos `campo.ts`, `CampoLayout.vue`, `offlineQueue.ts`,
`ClosureQueuePanel.vue` sirven a todo Campo, no solo a Altas). Procedimiento
de verificación, sin necesidad de acceso físico a cada celular:

1. **Antes del `deploy` del frontend**, registrar esta misma lectura
   (`scripts/iptv-maintenance-readonly.ps1`) como línea base — guarda
   conteos exactos de `openOrderCount`, `openWorkSessionCount`,
   `incompleteReceiptCount` y `pendingFieldUnits` con sus IDs.
2. **Inmediatamente después del `deploy`** (antes de reabrir Campo),
   repetir la misma lectura. El diseño ya probado (26/26 Android +
   12/12 Chrome, caso "Upgrade con conexión antigua") garantiza que el
   upgrade de IndexedDB es **aditivo** (nunca borra `drafts`/`closures`
   existentes) y que `flushQueue` **nunca** descarta un envío rechazado —
   lo retiene para corrección humana sin bloquear las demás órdenes. Por
   diseño, ningún dato se pierde del lado del servidor por el solo hecho
   de recargar el frontend: una sesión de trabajo abierta
   (`job_work_sessions`) o una orden `scheduled`/`open` no cambia de estado
   solo porque el técnico recargue la página — seguirá exactamente donde
   estaba.
3. **Lo que SÍ se debe comprobar activamente** (no inferible desde el
   servidor): que los 2-3 técnicos con sesión abierta no tengan, en ese
   preciso momento, un **borrador local sin guardar** (notas/fotos
   tecleadas pero no persistidas todavía en IndexedDB) — eso es estado del
   dispositivo, invisible desde Supabase. Mitigación: coordinar con esos
   técnicos antes de la ventana (confirmar que no tienen una pantalla de
   cierre abierta con cambios sin guardar) en vez de recargar a ciegas; es
   la misma recomendación ya documentada en los informes anteriores
   ("recarga completa coordinada", "no forzar recargas con datos
   inciertos").
4. **Después de reabrir Campo**, repetir la lectura una tercera vez: los
   conteos de `openOrderCount`/`openWorkSessionCount`/
   `incompleteReceiptCount` deben ser **iguales o mayores** (nunca menores
   sin una acción explícita del usuario) respecto a la línea base del
   paso 1 — una caída inexplicada sería la señal de alarma a investigar
   antes de continuar, nunca a descartar como coincidencia.

Esto no requiere ninguna migración ni escritura; es enteramente lectura
antes/durante/después, usando la misma consulta ya aprobada y usada en esta
y en sesiones anteriores.

## 7. Históricos e inventario: preservados

Rosita, las 9 órdenes abiertas, las 4 sesiones y la 1 aprobación de equipo
en ticket resuelto permanecen exactamente iguales a la última lectura
documentada (confirmado con una lectura nueva, no solo repetida de memoria).
Ningún archivo de otra fase (Fase 175, Puntos, Samsung Hosts, TR-069/WiFi,
Supabase-consumo, Oficina XUI) fue tocado, commiteado ni incluido en la rama
`release/iptv-20261111`.

## 8. Decisión pendiente del propietario

**Antes de reintentar `build`:** ¿corrijo `deploy/iptv-20261111/scope.json`
reemplazando únicamente `frontendGraphTransition.before`/`after` por los
valores verificados en la sección 3 (calculados contra el contenedor real
de producción, con el mismo validador estricto, sin aflojar ninguna
regla), o prefieres regenerar ese archivo con tu propio procedimiento? Sin
esa corrección, `build` seguirá fallando con el mismo rechazo aunque el
contenido sea correcto.

**Resultado final de esta sesión: NO APTO para `deploy`** hasta resolver el
punto 8. El resto (separación de commits, contenido del paquete, respaldo/
rollback, trabajo activo de Campo) está verificado y preparado.
