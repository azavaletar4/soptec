# SmartRayco — Estado de desarrollo

Última actualización: 2026-10-10, sesión de identidad visual (fin de sesión),
mas los fixes 13c-13h, todos el mismo día — **13e es la versión final y
vigente del isotipo web, 13f la aplicó también al ícono/splash de la APK,
13h es la cabecera móvil vigente (reemplazó la franja nativa de 13g, que
quedó supersedida) y ya está desplegada en producción (VM en commit
`d59759a`)** (12 y 13d quedaron supersedidas en cuanto al diseño del
isotipo, ver nota en 12). Este documento es la
referencia compartida para retomar el trabajo con Claude Code o ChatGPT sin
repetir análisis. Verificar siempre contra el código/Supabase real antes de
asumir que algo sigue igual — esto es una fotografía de un momento dado.

Leyenda: **IMPLEMENTADO** (código existe) · **DESPLEGADO** (corriendo en la
VM de producción) · **PENDIENTE** (falta codificar) · **PROPUESTO** (solo
mencionado/pedido, sin código).

## 1. Arquitectura

- **Frontend**: Vue 3 + Vite + Pinia + TypeScript. Vistas en `src/views/`,
  stores en `src/stores/`, helpers en `src/lib/`, rutas en `src/router/index.ts`.
- **Backend**: Hono (Node, vía `tsx`) en `server/src/`. Alcance limitado a
  protocolos externos: Telnet/OLT ZTE, MikroTik REST, GenieACS/TR-069,
  Proxmox. **No hay API REST propia para CRUD de dominio** (clientes,
  contratos, tickets, inventario, etc.) — el frontend habla directo con
  Supabase y la autorización real vive en RLS + funciones `SECURITY
  DEFINER`, no en un backend intermedio.
- **Base de datos**: Supabase Postgres. Migraciones en `supabase/migrations/`
  (nomenclatura `YYYYMMDDHHMMSS_faseNNN_descripcion.sql`). Rol efectivo vía
  `current_user_role()` (SUPERADMIN/ADMIN/TECNICO_RED/SOPORTE/FACTURACION/CLIENTE).
- **Infraestructura**: VM Proxmox `smartrayco-prod` (nodo `edgue`,
  `192.168.55.201`), Docker Compose (`docker-compose.onprem.yml`): Caddy +
  frontend (nginx) + backend (Hono) + GenieACS + MongoDB. Deploy con
  `bash deploy/update.sh` (`git pull --ff-only` + `docker compose up -d --build`).
  Acceso SSH: `root@192.168.55.201`, key en `~/.ssh/smartrayco-deploy` (en la
  máquina de desarrollo, no en este repo).
- **App móvil**: Flutter WebView en `mobile_app/` (APK `com.smartrayco.app`).
  **Versionada en este mismo repo desde 2026-10-10b** (antes vivía solo en
  el working tree, sin trackear — ver sección 13b). `.gitignore` propio
  (estándar Flutter) excluye `build/`, `.dart_tool/`, `.idea/`,
  `local.properties`, `key.properties`, keystores y las capturas
  `screenshot_*.png` de prueba (siguen en disco, fuera de git).
- **Pruebas**: sin framework de componentes Vue. Los cambios de triggers/RPC
  de Supabase se validan con Postgres real en Docker, aislado — ver
  `server/tests/*.sql.test.ts` (patrón: `napAssignment.sql.test.ts`,
  `singleActiveJob.sql.test.ts`, `workOrderPhotoApproval.sql.test.ts`). Ver
  todos los scripts con `npm pkg get scripts`.

## 2. Estado real de producción (verificado hoy, sin volver a desplegar)

- **Commit desplegado en la VM**: `463720b` ("Fase 143: separar
  equipos/materiales y corregir Kit base de Alta"). `git status` en la VM
  limpio (sin cambios locales pendientes).
- **Build/servicios**: los 5 contenedores (`backend`, `frontend`, `caddy`,
  `genieacs`, `mongo`) están `Up`/`healthy`. Backend reinició limpio con
  todos sus schedulers activos (`tr069-scheduler`, `debt-hold-scheduler`,
  `mikrotik-reconcile`, `traffic-analytics-scheduler`, `olt-sync-scheduler`,
  `schedule-alert-scheduler`) y ya completó ciclos reales sin error
  (ej. `olt-sync-scheduler: online=635 offline=76`). Frontend responde
  HTTP 200.
- **Migraciones en Supabase (proyecto `mzupdnjegfwmpajywckd`)**: la tabla de
  tracking de Supabase (`list_migrations`) registra hasta `fase132` y luego
  `fase137`, `fase137b`, `fase137c`, `fase140`, `fase141` (aplicadas esta
  sesión vía herramienta de migración).
  - **Hueco conocido de tracking** (no de funcionalidad): `fase135`
    (asistencia, prioridad almuerzo) y toda la serie `fase136*` (Fase 2
    comercial: contratos/NAP/aprovisionamiento OLT confiable) **no aparecen**
    en `list_migrations`, pero sus tablas/funciones SÍ existen y están en
    uso real en producción (se aplicaron por otra vía, en una sesión previa
    con ChatGPT/Codex, antes de esta sesión). Los archivos `.sql` de esas
    fases SÍ están en el repo (`supabase/migrations/`). No se ha intentado
    "reparar" el registro de tracking — sería tocar infraestructura de
    migraciones sin que se haya pedido.
  - **Corrección de dato en vivo** (no es migración): el campo `unit` del
    producto `inventory_products` "drop de 100 metros" se corrigió de
    `'rollo (100m)'` a `'unidad'` directamente en Supabase (ver punto 8).
    Stock, precio y el resto de productos quedaron intactos.

## 3. Funcionalidades completadas — IMPLEMENTADO y DESPLEGADO

Resumen de lo confirmado funcionando hoy (lista no exhaustiva de fases
anteriores a esta sesión — ver memoria/`git log` para el historial completo):

- Gestión de clientes/contratos/planes/zonas, facturación, caja chica,
  activos fijos, flota.
- Soporte: tickets (averías), instalaciones (altas), rutinas — ciclo
  completo con cuadrilla/apoyo, auto-asignación de órdenes libres, devolver
  ticket, Cliente Ausente, causa raíz, agendamiento directo, Cronograma,
  Operaciones de Hoy unificado, prioridad.
- OLT ZTE: lectura de señal, aprovisionamiento confiable con contrato
  obligatorio y reserva NAP transaccional (Fase 2 comercial / `fase136*`).
- Inventario: productos + Kardex (`inventory_movements`, insert-only,
  trigger `apply_inventory_movement` valida stock suficiente/cantidad
  positiva/atomicidad), equipos serializados por serie/MAC, álbumes.
- Asistencia/marcación de jornada con confirmación previa (evita
  marcaciones accidentales) y aviso anticipado consciente de cuadrilla.
- **Fase 137/137b/137c** — un técnico solo puede tener **un** ticket/alta/
  rutina `in_progress` a la vez, global a los 3 tipos: trigger en
  `tickets`/`installations`/`routines` (al entrar a `in_progress`) +
  trigger en `job_assignees` (al sumar a alguien a un trabajo YA en curso),
  ambos con el mismo `pg_advisory_xact_lock` para evitar condiciones de
  carrera. Aviso anticipado + "Ver ticket activo" en Panel Web y App de
  Campo. Archivos: `supabase/migrations/20261010140000_fase137_*.sql`,
  `..._150000_fase137b_*.sql`, `..._160000_fase137c_*.sql`,
  `src/lib/singleActiveJob.ts`, `src/stores/campo.ts`,
  `src/views/campo/CampoDashboardView.vue`,
  `src/views/soporte/OperacionesHoyView.vue`.
- **Fase 139/139b/139c** — código de cliente / cintillo Drop en el cierre
  de Alta (obligatorio) y Avería (opcional, se conserva en reconexión),
  sincronizado con `service_contracts.client_code` (reutiliza Fase 39, sin
  columna nueva). Consulta de clientes por caja NAP (nombre + contrato +
  código, **sin mostrar puertos**), mismo criterio que `ZonasView.vue`.
  Contador de ocupación de caja NAP corregido (cuenta clientes reales con
  `client_id`, no cualquier fila "ocupado"). Archivo:
  `src/views/campo/CampoTrabajoDetailView.vue`.
- **Fase 140 — módulo Prospectos** (ver sección 7).
- **Fase 141** — Diagnóstico Express excluido de Altas (ver sección 6) +
  aprobación de fotos validada en backend (ver sección 6).
- **Fase 142** — wizard de 5 pasos en Alta (ver sección 9).
- **Fase 143** — separación equipos/materiales + Kit base corregido (ver
  sección 5).

## 4. App de Campo → Alta: cambios recientes (esta sesión)

Archivo principal: `src/views/campo/CampoTrabajoDetailView.vue` (vista
monolítica grande, reorganizada con un wizard — ver sección 9). Lógica de
cierre/consumo en `src/stores/campo.ts`.

## 5. Separación de equipos serializados y materiales — IMPLEMENTADO/DESPLEGADO

- **Paso 2 (Instalación y red)**: ONT/Módem, Mesh, TV Box — asignados por
  serie/MAC (`inventory_products.is_serialized = true`), sin cambios de
  esta sesión salvo reubicación visual al wizard.
- **Paso 3 (Materiales)**: el selector de "Materiales usados" ahora excluye
  explícitamente (`materialSelectableProducts` en `CampoTrabajoDetailView.vue`):
  - Productos `is_serialized` (ya tienen su lugar en el Paso 2).
  - Productos ya cubiertos por el Kit base (ver sección siguiente) — evita
    doble consumo por dos caminos distintos. Esta exclusión **solo aplica a
    Alta**; en Avería el mismo selector sigue permitiendo Patchcord/Roseta
    porque no existe un panel de Kit base para tickets.

## 6. Kit base de instalación — Drop prefabricado vs bobina — IMPLEMENTADO/DESPLEGADO

- **Conector Óptico**: el patrón de coincidencia ahora exige `conector` +
  `ptic` en el nombre — ya no se mezcla con "CONECTOR RJ45" (bug real
  corregido: el regex anterior `/conector/i` los confundía).
- **Cable Drop — dos modalidades, nunca ambas a la vez** (estado
  `dropMode: 'prefab' | 'bobina'`):
  - **A) Prefabricado** (habitual, modo por defecto): elegir el largo
    (50/100/150/220/300 m, detectado por patrón `\d+\s*metros` en el
    nombre — los nombres reales en Inventario son inconsistentes, ej.
    "drop 50 metros" vs "drop de 100 metros", por eso no se usa una
    subcadena fija) y cantidad de **tramos** → descuenta esa cantidad de
    **unidades** del producto elegido.
  - **B) Bobina suelta** (excepcional, se revela con un botón secundario
    "¿Usaste bobina suelta...?"): descuenta **metros reales** de "bobina
    drop" (ej. stock 3000 m, uso 85 m → queda 2915 m), nunca una bobina
    completa.
  - Ambas respetan "Cliente vuelve / Reconexión" (no consumen Drop).
- **Cable UTP**: seleccionable desde "Materiales usados" (no es
  serializado ni está en el Kit base), se registra por metros.
- **CONECTOR RJ45**: seleccionable desde "Materiales usados", nunca se
  mezcla con Conector Óptico (son productos distintos en Inventario).
- **Unidades de medida reales en Supabase** (confirmado y, donde hacía
  falta, corregido):
  - `bobina drop` → `metros` (ya estaba correcto).
  - `cable UTP` → `metros` (ya estaba correcto).
  - Drop prefabricado 50/150/220/300 m → `unidad` (ya estaba correcto).
  - Drop prefabricado 100 m ("drop de 100 metros") → **corregido hoy** de
    `'rollo (100m)'` a `'unidad'` (solo ese campo; stock/precio intactos).
- **Sin migraciones nuevas**: todo reutiliza el pipeline existente de
  `inventory_movements` (Kardex insert-only) + trigger
  `apply_inventory_movement` (Fase 11), que ya validaba stock suficiente,
  cantidad positiva y atomicidad desde antes de esta sesión.
- **No duplicar consumo**: resuelto a nivel de UI (ver sección 5) — no hay
  un candado de backend nuevo contra doble-registro entre Kit base y
  Materiales usados más allá de la exclusión visual; **riesgo residual
  bajo pero real** si alguien edita el DOM o usa la API directo.

## 7. Módulo Prospectos — IMPLEMENTADO y DESPLEGADO (alcance "sencillo")

- Tablas nuevas y separadas de `clients`: `prospects` + `prospect_followups`
  (migración `fase140_prospectos.sql`). RLS: mismo criterio que clientes
  (SUPERADMIN/ADMIN/SOPORTE/FACTURACION, sin TECNICO_RED).
- Vista `src/views/clientes/ProspectosView.vue`, store
  `src/stores/prospects.ts`, ruta `/clientes/prospectos`, botón
  "🙋 Prospectos" junto a "+ Nuevo cliente" en `ClientesView.vue`.
- Estados: Interesado / Por contactar / En negociación / No interesado /
  Convertido. Contadores (interesados, pendientes de seguimiento,
  convertidos), seguimiento vencido/hoy resaltado, historial de
  seguimientos (fecha/autor/notas, nunca se borra), enlace `wa.me`.
- **Conversión a cliente**: reutiliza el modal "+ Nuevo cliente" existente
  vía `?prospect_id=..&name=..&phone=..&address=..`; el prospecto se marca
  `convertido` **solo después** de confirmar que el cliente se creó
  realmente (nunca antes, nunca si falla el alta).
- **PENDIENTE/fuera de alcance** (no pedido, no implementado): reportes o
  analítica de conversión, edición masiva, notificaciones automáticas.

## 8. Diagnóstico Express — exclusivo de Avería/Rutina — IMPLEMENTADO/DESPLEGADO

- `CampoTrabajoDetailView.vue`: `runDiagnostico()` ya no se ejecuta en
  `onMounted` para `jobType === 'installation'`, y la sección ya no se
  renderiza para Altas (antes se mostraba para los 3 tipos).
- No afecta "Provisionar en OLT" (aprovisionamiento real de la ONU, sigue
  intacto y exclusivo de Altas) ni ninguna validación de cierre existente.

## 9. Flujo de fotografías — qué está REALMENTE implementado

- **Altas**: las fotos de las 5 categorías (Fachada, Hoja de servicio, Caja
  NAP, Posición del módem, Potencia óptica) se aplican **directo** a
  `client_photos` (ficha del contrato), sin aprobación — esto **ya existía**
  antes de esta sesión en el frontend.
- **Hallazgo corregido esta sesión**: el campo `work_order_photos.status`
  no tenía **ningún candado de backend** — un técnico podía, con una
  llamada directa a la API, mandar `status='approved'` en una foto de
  Avería (evadiendo el censo fotográfico) o mentir el `job_type`. Nuevo
  trigger `enforce_work_order_photo_status` (`fase141_aprobacion_fotos_backend.sql`,
  **DESPLEGADO**) recalcula el status en el servidor, ignorando lo que
  mande el navegador:
  - `installation` → siempre `approved` (y valida que el `job_id` exista
    de verdad como instalación).
  - `ticket` → `pending_approval`, excepto `evidencia_1`/`evidencia_2`
    (actas de cierre, siempre `approved`, nunca se copian a
    `client_photos`).
  - `routine` → `approved` (las Rutinas **no tienen hoy** ningún flujo de
    censo fotográfico pendiente — es el comportamiento real preexistente,
    no una tarea pendiente; solo tienen `evidencia_1`/`evidencia_2`).
- **Averías**: censo fotográfico (5 categorías) queda `pending_approval`,
  un admin lo aprueba desde `TicketDetailView.vue` (copia a
  `client_photos`, marca `approved`) — sin cambios de esta sesión.
- **Rutinas**: sin censo fotográfico propio (ver arriba) — si se quiere
  agregar aprobación real para Rutinas, es trabajo **PROPUESTO**, no
  pedido todavía.

## 10. Reorganización de Alta en 5 etapas (wizard) — IMPLEMENTADO/DESPLEGADO

- Solo para `jobType === 'installation'`; Avería y Rutina **no cambian**
  (siguen viendo todo en una sola pantalla, sin paginar).
- Reorganiza secciones **ya existentes** con `v-show` (ningún `v-if` de
  contenido se tocó): 1) Cliente y orden, 2) Instalación y red (Zona/Caja
  NAP, clientes de la caja, código de cliente, equipos por serie/MAC,
  Provisionar en OLT), 3) Materiales (Kit base + Materiales usados),
  4) Evidencias (fotos anteriores, fotos de serie de equipos, fotos de
  instalación, GPS), 5) Cierre (resumen de datos pendientes, notas, firma,
  botón de completar).
- `v-show` (no `v-if`) conserva fotos/firma/materiales al cambiar de paso
  — nada se desmonta. Resumen de "datos pendientes" en el Paso 5 reusa las
  mismas validaciones que ya exigía `handleCloseSubmit` (zona/NAP, código
  de cliente, firma), con salto directo al paso correspondiente.
- Estado: `installStep` (ref), helper `showStep(n)` en
  `CampoTrabajoDetailView.vue`.

## 11. Errores conocidos, riesgos y trabajos pendientes

- **Preexistente, no corregido** (fuera de alcance de las tareas pedidas):
  `npx tsc -p tsconfig.server.json --noEmit` reporta 2 errores de tipos en
  `server/src/services/oltProvisioningService.ts` ("serviceGemport"/
  "serviceVlan" no asignables). No bloquea en runtime (`tsx` no
  type-checka al ejecutar), pero alguien debería revisarlo.
- **Hallazgo de seguridad general** (Fase 137c): Supabase concede `EXECUTE`
  a `anon`/`authenticated` por defecto en **toda** función nueva (`ALTER
  DEFAULT PRIVILEGES` del propio proyecto) — confirmado también en
  `self_assign_ticket`, ya existente. La autorización real de este
  proyecto vive dentro de cada función (`current_user_role()`), no en el
  grant de ejecución. Se corrigió puntualmente para las funciones nuevas
  de Fase 137, pero **el patrón aplica a todo el proyecto** y no se ha
  auditado exhaustivamente — **PROPUESTO**, no iniciado, requiere decisión
  explícita antes de tocar nada (tocar grants de RPCs ya en uso es
  riesgoso sin revisión caso por caso).
- `docs/ERRORES-CAMPO.md` existe (plantilla) pero está vacío — todavía no
  se ha registrado ningún bug real de campo ahí.
- Archivos sueltos sin trackear en la máquina de desarrollo (NO están en
  la VM): `SmartRayco_config.zip`, `revision-fase2/`. No tocar sin pedido
  explícito — el motivo original (zip + carpetas de revisión externa) no se
  ha verificado a fondo. **`mobile_app/` ya NO está en esta lista**: se
  versionó el 2026-10-10b (ver sección 13b) — dejó de ser un caso de
  "archivo suelto sin trackear".
- Reasignar cuadrilla cambiando de líder (`setLeader`, UPDATE) o quitando a
  alguien (`removeAssignee`, DELETE) en `job_assignees` no pasa por el
  candado de "un trabajo a la vez" — es una decisión de diseño documentada
  (UPDATE no crea vínculo nuevo; DELETE libera al técnico, no es bypass),
  no un bug, pero vale tenerlo presente.

## 12. Identidad visual unificada (sesión 2026-10-10b) — SUPERSEDIDA POR 13e

**El isotipo descrito en esta sección (derivado de "Ícono SmartRayco con R
Neón.png" por recorte/cutout) ya NO es el que está en producción.** El
usuario lo rechazo dos veces (caja de fondo visible, "trazos borrosos") y
entrego un archivo distinto e independiente que es el vigente desde 13e —
ver esa sección para el estado real de `src/assets/logo-icon.png`. Esta
sección 12 queda como registro histórico de cómo se llegó ahí, no como
descripción del estado actual. El ícono/splash de la APK Android (ver 13d)
**sí siguen usando** el diseño descrito aquí (no se actualizaron a 13e,
ver sección 13 "Próximo paso").

- Referencia usada: `C:\Users\USER\Downloads\Ícono SmartRayco con R Neón.png`
  (isotipo R azul + efecto fibra óptica, provisto por el usuario cuando el
  path inicial `D:\SmartRayco\assets\smartRayco-icon.png` no existía).
- Isotipo (sin texto) derivado con `sharp` (recorte + cutout por
  luminancia, sin ImageMagick/Python disponibles en el entorno) y
  centralizado en `D:\SmartRayco\assets\` (`smartrayco-icon-master.png`,
  `smartrayco-symbol.png` con fondo navy, `smartrayco-logo.png` completo).
- **Panel web**: único archivo real en uso, `src/assets/logo-icon.png`
  (PNG transparente), referenciado por favicon (`index.html`), Login,
  Cambiar contraseña, `AppLayout.vue` (sidebar/header) y
  `CampoLayout.vue` — los 4 puntos se actualizan con un solo swap de
  binario, sin tocar lógica. `src/assets/logo-full.png` (no usado por
  ningún componente) también actualizado por consistencia. Símbolo del
  Login agrandado (`w-16`→`w-24`) y Cambiar contraseña (`w-14`→`w-20`).
  Sin PWA/manifest en el proyecto (no se inventó uno, fuera de alcance).
- **APK (`mobile_app/`, WebView)**: launcher icon reemplazado (legacy +
  adaptive icon nuevo con foreground/monochrome por densidad,
  `mipmap-anydpi-v26/ic_launcher.xml`, `values/colors.xml`) — antes era el
  logo default de Flutter, nunca se había personalizado. Splash nativo
  (`drawable*/launch_background.xml`) antes en blanco sin imagen, ahora
  fondo navy de marca (`#030714`) + isotipo centrado
  (`drawable-*dpi/launch_image.png`). `android:label/icon`, package ID,
  firma y permisos intactos. APK compilada (`flutter build apk --release`)
  y copiada a `C:\Users\USER\Desktop\SmartRayco.apk`.
- `mobile_app/` sigue sin trackear en git (ver sección 11) — estos cambios
  existen en disco pero no se commitearon vía el repo principal; el build
  de Flutter los toma igual porque lee del working tree, no de git.
- **Pendiente/no pedido en esta sesión**: separar el PNG maestro en capas
  reales (symbol/background) con una herramienta de diseño si se quiere
  una adaptive-icon/monochrome más prolija — el cutout actual usa un
  umbral de luminancia automático (buen resultado visual, no un recorte
  manual de capas). Probar el ícono/splash en un dispositivo real (solo se
  validó compilando y revisando los PNG generados).

## 13b. Investigación: versionar `mobile_app/` en git — PENDIENTE DE AUTORIZACIÓN

Investigado 2026-10-10b a pedido del usuario, tras la sesión de identidad
visual, para no perder los cambios de ícono/splash de la APK (viven solo en
el working tree).

- **Por qué no está en git hoy**: no hay ninguna regla en `.gitignore` (raíz
  ni dentro de `mobile_app/`) que la excluya, ni carpeta `.git` propia
  anidada. `git check-ignore mobile_app` no devuelve nada. Es decir, nunca
  se decidió técnicamente excluirla — simplemente nadie corrió
  `git add mobile_app/`. La nota previa en este documento ("fuera de git a
  propósito, contienen posibles secretos") no se sostiene para esta carpeta
  puntual; corregida en sección 11.
- **Secretos verificados — ninguno encontrado**: sin `*.jks`/`*.keystore`,
  sin `key.properties`, sin `google-services.json`, sin `.env`. El build de
  release firma hoy con el **keystore de debug** de Android
  (`android/app/build.gradle.kts:39`, `signingConfig =
  signingConfigs.getByName("debug")`, con el TODO original de Flutter sin
  resolver) — no es un release firmado de producción real, así que no hay
  una clave de firma real que proteger todavía. **No se tocó** (regla de no
  cambiar firma/config funcional), solo se deja documentado.
- **`.gitignore` ya existente es el estándar de Flutter y es suficiente**:
  `mobile_app/.gitignore` excluye `.dart_tool/`, `/build/`, `.idea/`,
  `*.iml`; `mobile_app/android/.gitignore` excluye `/local.properties`,
  `/.gradle`, `key.properties`, `**/*.keystore`, `**/*.jks`, `gradlew`/
  `gradlew.bat`. `android/local.properties` (el único archivo "sensible" en
  disco) solo tiene rutas locales del SDK (`sdk.dir`, `flutter.sdk`), nada
  secreto, y ya queda excluido por esa regla.
- **Simulación (`git add --dry-run mobile_app`) desde la raíz del repo**:
  51 archivos quedarían versionados — código Dart (`lib/main.dart`,
  `pubspec.yaml`, `pubspec.lock`, `test/widget_test.dart`), el proyecto
  Android completo (`android/app/build.gradle.kts`, manifests, `MainActivity.kt`,
  `styles.xml`, `colors.xml`, gradle wrapper/properties) y los recursos de
  marca nuevos (`mipmap-*/ic_launcher*.png`, `drawable*/launch_*`). **Cero**
  coincidencias de `.apk`, `build/`, `.idea`, `keystore`, `.jks`,
  `local.properties`, `key.properties` o `.env` en esa simulación.
- **Hallazgo aparte, resuelto**: las 7 capturas de prueba
  (`screenshot_now.png`, `screenshot_test.png` a `test6.png`, ~1.5 MB) se
  excluyeron agregando `/screenshot_*.png` a `mobile_app/.gitignore` —
  siguen en disco, solo quedan fuera de git.
- **Resultado — autorizado e incorporado 2026-10-10b**: usuario autorizó
  explícitamente. `git add mobile_app` quedó en 44 archivos en staging
  (código Dart + proyecto Android + recursos de marca nuevos), verificado
  sin `.apk`/`build/`/`.idea`/keystore/`.env`/screenshots. Commit
  `5563332` ("Versionar mobile_app/ (Flutter/Android) con icono y splash
  de SmartRayco") empujado a `origin/main` y confirmado sincronizado
  (`git rev-parse main` == `git rev-parse origin/main` ==
  `556333282142b0b76c9829f975c6b60c0fd7413e`).
- **Pendiente futuro registrado**: configurar una firma de release de
  producción real (keystore propio + `key.properties`, hoy gitignorado
  para cuando exista) — el release sigue firmando con el keystore de debug
  de Android (`android/app/build.gradle.kts:39`), sin tocar en esta
  sesión.

## 13c. Fix: Login/cabecera seguían con el logo Rayco HD — RESUELTO

Reportado por el usuario tras instalar el APK (sección 12) en su celular e
instalar/probar: el ícono de la APK sí se veía nuevo, pero Login y la
cabecera del panel (cargados por la APK vía WebView, no empaquetados —
`mobile_app/lib/main.dart` carga siempre `https://panel.rayconetworks.com/`)
seguían mostrando el logo "Rayco HD" viejo.

- **Causa raíz confirmada**: los cambios de logo web (sección 12) se
  habían generado en la sesión anterior pero **nunca se commitearon** — la
  autorización de esa sesión cubrió solo `mobile_app/` (sección 13b), no
  el fix de logo web, que quedó en el working tree. La VM seguía en el
  commit `463720b` (anterior a cualquier cambio de logo), confirmado con
  `git log` por SSH antes de tocar nada.
- **No era un problema de caché**: `deploy/nginx.conf` sirve `/assets/`
  con `Cache-Control: public, immutable`, pero Vite fingerprinted el
  nombre del archivo por contenido (`logo-icon-BpUCWDs3.png` el viejo →
  `logo-icon-C8NG61wu.png` el nuevo) — un build nuevo nunca choca con el
  caché del anterior, el navegador/WebView simplemente pide una URL que
  nunca vio. No hizo falta ninguna lógica de invalidación de caché ni se
  tocaron sesiones/`localStorage` de los técnicos.
- **Fix**: se commiteó exactamente lo que ya estaba verificado
  (`src/assets/logo-icon.png`, `logo-full.png`, el agrandado de símbolo en
  `LoginView.vue`/`CambiarPasswordView.vue`, `smartray.md`) — confirmado
  sin archivos ajenos antes de `git add` — commit `1c427fd` ("Reemplazar
  logo Rayco HD por el isotipo SmartRayco en Login/cabecera"), push a
  `origin/main`, y `bash deploy/update.sh` en la VM. **No se tocó
  Supabase** (`update.sh` solo hace `git pull` + `docker compose up -d
  --build`, sin ningún paso de base de datos).
- **Verificado en vivo** (sin entrar al celular): VM en `1c427fd`
  (`git rev-parse HEAD` por SSH == local). `curl
  https://panel.rayconetworks.com/` devuelve
  `<link rel="icon" ... href="/assets/logo-icon-C8NG61wu.png">`; se
  descargó ese asset real desde el dominio público y pesa exactamente
  277674 bytes, igual que `src/assets/logo-icon.png` en el repo — es el
  isotipo nuevo, no el logo viejo.
- **AppLayout.vue y CampoLayout.vue no tenían ningún cambio pendiente** —
  ya importaban `@/assets/logo-icon.png` desde la sesión anterior, solo
  heredan el binario corregido sin tocar su código.
- **Cómo lo confirma el usuario desde el celular**: cerrar del todo la app
  SmartRayco (quitarla de recientes, no solo minimizarla) y volver a
  abrirla — al cargar `panel.rayconetworks.com` de nuevo en el WebView
  debería traer el HTML/assets nuevos. Si por algún motivo seguía viendo
  el logo viejo, probar "Borrar caché" de la app desde Ajustes de Android
  (no borra sesión, solo el caché HTTP del WebView) — no debería hacer
  falta según el análisis de caché de arriba, pero es la vía si persiste.
- **No se recompiló la APK** — no hacía falta: el ícono/splash ya estaban
  bien (confirmado por el propio usuario) y Login/cabecera los sirve la
  VM vía WebView, no el binario.

## 13d. Fix: isotipo con fondo cuadrado + FAB nativos visibles en Login

Reportado por el usuario tras el fix 13c: el logo se veía con una caja
azul marino/blanca detrás, y en el celular aparecían dos botones flotantes
nativos (Inicio/Recargar) encima del Login.

- **Isotipo**: el recorte de la sesión de identidad visual (12) usaba un
  umbral de luminancia global para generar transparencia — el fondo del
  PNG original no es uniformemente oscuro (tiene un degradado/glow real),
  así que gran parte quedó semi-opaca, visible como una caja. Confirmado
  componiendo el PNG sobre magenta sólido antes de tocar nada. Corregido
  con flood-fill (sigue el degradado real desde los bordes, se detiene en
  los bordes duros del símbolo) — verificado sobre blanco y magenta, sin
  caja ni restos. Mismo archivo (`src/assets/logo-icon.png`), ningún `.vue`
  cambió. Validado en vivo en `localhost:5173/login` (Chrome) antes de
  commitear.
- **FAB nativos**: `mobile_app/lib/main.dart` — `floatingActionButton`
  del `Scaffold` es global, sin noción de auth. Se ocultan ahora según la
  ruta real del WebView (`onUrlChange`, no solo `onPageFinished` —
  necesario porque el panel es una SPA con Vue Router en modo `history`:
  login→dashboard es `router.push`, no recarga de página, así que
  `onPageFinished` no se entera). `/cambiar-password` siempre exige sesión
  en el router (`requiresAuth: true`), así que "cambio de contraseña sin
  sesión" no es un estado alcanzable en este app — no se le aplicó
  lógica aparte. `flutter analyze` limpio.
- **Commit** `7727484` ("Corregir isotipo con fondo cuadrado y ocultar FAB
  nativos en Login"), pusheado a `origin/main`. **APK recompilada**
  (necesario, el fix de FAB es código Dart) y copiada a
  `C:\Users\USER\Desktop\SmartRayco.apk`.
- Desplegado a la VM el mismo día (autorización explícita del usuario en
  turno siguiente) — en ese momento se dio por resuelto. **El FAB nativo
  sigue correcto y vigente.** El isotipo (flood-fill) resultó rechazado
  por el usuario poco después al verlo en el celular — ver 13e para el
  reemplazo definitivo.

## 13e. Reemplazo definitivo del isotipo (archivo entregado por el usuario) — RESUELTO

El usuario vio el fix de 13d desplegado y lo rechazo: "sigues utilizando
una version anterior de la R, con trazos borrosos y un recorte que no
corresponde al nuevo diseño de referencia". Pidió explícitamente **no**
seguir reconstruyendo/recortando/aplicando flood-fill sobre ningún archivo
existente, y que esperara un archivo nuevo e independiente.

- **Primero, un rediseño de Login pedido aparte** (no relacionado al
  isotipo): el usuario mandó un mockup
  (`Panel de Gestión SmartRayco.png`) con el Login completo — logo más
  grande, wordmark "SmartRayco" en dos tonos, iconos dentro de los campos
  (usuario/candado), boton mostrar/ocultar contraseña, botón "Ingresar"
  con degradado azul→cian y flecha, fondo con degradado suave. Implementado
  en `LoginView.vue` sin tocar `.field-input`/`.btn-primary`/`.modal-panel`
  (clases compartidas con el resto del panel) — todo el estilo nuevo es
  local a esa vista. Commit `47d3cc7`. Verificado en `localhost:5173` antes
  y después de desplegar.
- **Intento 1 de archivo nuevo** (`Ícono SmartRayco con R Neón.png`
  reenviado): resultó ser **el mismo archivo byte a byte** (mismo MD5) que
  el usado desde la sesión 12 — no era un archivo nuevo. Se le informó esto
  al usuario antes de tocar nada (regla: nunca asumir, verificar hash).
- **Intento 2** (`Kit de Marca SmartRayco_ Logos y Mockups.png`): resultó
  ser un mockup/moodboard compuesto (imagen plana con varios paneles de
  ejemplo), no un archivo de isotipo independiente — tampoco se uso.
- **Archivos reales entregados** (3 PNG independientes,
  `C:\Users\USER\Downloads\`):
  - `smartrayco-logo.png` (1254x1254) — **NO tenia transparencia real**
    pese a estar etiquetado como tal: el "cuadriculado transparente" del
    editor quedo horneado como pixeles grises reales (verificado leyendo
    los pixeles de esquina, `~(198,197,198)`). Se informo al usuario en
    vez de intentar "arreglarlo" con un filtro. El usuario autorizo usar en
    su lugar el isotipo de `smartrayco-favicon.png` (mismo diseño, con
    alfa real) para este proposito.
  - `smartrayco-logo-horizontal.png` (2172x724, alfa real confirmado) —
    isotipo + texto en un solo lockup. Guardado como referencia en
    `assets/smartrayco-logo-horizontal.png` pero **no se uso** en ningun
    componente (el usuario pidio mantener el nombre como texto HTML, no
    incrustado en la imagen).
  - `smartrayco-favicon.png` (1261x1247, alfa real confirmado) — isotipo
    solo, diseño nuevo (cinta/listón con la R, distinto del anillo
    completo de las versiones 12/13d). **Este es el archivo vigente.**
- **Uso**: copiado **tal cual, sin ningún procesamiento** (sin recorte, sin
  flood-fill, sin resize) a `src/assets/logo-icon.png` — confirmado
  idéntico byte a byte (mismo MD5) contra el original entregado, tanto en
  el repo como luego en el archivo servido en vivo por la VM. Un solo
  archivo sigue alimentando Login, sidebar, cabecera móvil y favicon — cero
  cambios de `.vue`. Copia de referencia también en
  `assets/smartrayco-favicon.png`.
- Verificado visualmente contra el archivo fuente en `localhost:5173/login`
  (zoom del logo renderizado) **antes** de pedir confirmación al usuario, y
  de nuevo en producción tras desplegar (`cmp` byte a byte entre el PNG
  descargado de `panel.rayconetworks.com` y el archivo del repo — idéntico).
- Commits: `db1188b` (reemplazo del logo). Desplegado a la VM
  (commit `db1188b` confirmado via SSH) tras autorización explícita.
- **`mobile_app/android/` actualizado en 13f** (ícono de launcher y
  splash) — ya no aplica la inconsistencia descrita antes; ver esa
  sección.

## 13f. Ícono de launcher y splash de la APK con el isotipo definitivo — RESUELTO

Pedido explícito del usuario tras 13e. Regenerados los 20 PNG
(`mipmap-*/ic_launcher.png` legacy, `ic_launcher_foreground.png` +
`ic_launcher_monochrome.png` del adaptive icon por densidad,
`drawable-*dpi/launch_image.png` del splash) a partir de
`assets/smartrayco-favicon.png` (el archivo que entregó el usuario, alfa
real, sin procesar) — mismo pipeline de composición que ya existía desde
la sesión 12 (recorte al bounding box real sin alterar contenido, centrado
al ~66% de zona segura sobre lienzo transparente para el foreground,
compuesto sobre el navy de marca `#030714` ya definido en `colors.xml`
para el ícono legacy, silueta blanca con el mismo alfa para el ícono
temático). **Ningún flood-fill ni filtro sobre el isotipo en sí** — el
origen ya tenía transparencia real, solo se reescaló/compuso. Sin cambios
de XML/código: `colors.xml` e `ic_launcher.xml` ya apuntaban a estos
mismos archivos desde la sesión 12.

- Commit `c1185dc`, pusheado a `origin/main`.
- **APK recompilada** (imprescindible — ícono/splash están embebidos en el
  binario) y copiada a `C:\Users\USER\Desktop\SmartRayco.apk`, pisando la
  build anterior (la de 13d, que ya traía el fix de FAB). Esta build nueva
  tiene **ambos** fixes: FAB oculto en Login + ícono/splash definitivos.
- **No desplegado a técnicos ni distribuido** — solo en el Desktop de la
  máquina de desarrollo, pendiente de que el usuario la instale/pruebe.
- Ahora el ícono del teléfono, el splash y el logo dentro del WebView
  (Login/sidebar) usan **el mismo isotipo** — ya no hay inconsistencia.

## 13g. FAB flotantes reemplazados por franja superior compacta — RESUELTO

Pedido del usuario: los FAB de Inicio/Recargar (bottom-left) tapaban el
perfil del técnico y los botones "Marcar asistencia"/"Cambiar contraseña"
del sidebar (`AppLayout.vue`) cuando estaba abierto en el celular.

- **Alternativa evaluada y descartada**: integrar los controles en la
  cabecera web existente. `AppLayout.vue` ya tiene un logo clicable
  ("Ir al inicio"), pero `CampoLayout.vue` — la cabecera de las pantallas
  de trabajo de campo, donde más molestaban los FAB (tapaban el recuadro
  de firma, motivo original de moverlos a la izquierda en una sesión
  previa) — no tiene ningún enlace de inicio, y "Recargar" (
  `WebViewController.reload()`) no es algo que el JS del panel pueda
  disparar sin un puente nuevo Flutter↔JS. Se descartó por introducir un
  segundo sistema de navegación solo para una de las dos funciones.
- **Solución implementada**: `mobile_app/lib/main.dart` — franja nativa
  propia de 36dp arriba del WebView (dentro de un `Column`, no flotando
  sobre el contenido como los FAB) con solo 2 iconos chicos (sin logo ni
  texto, evita duplicar la cabecera del panel). Al no flotar, nunca se
  superpone a nada del panel sin importar el estado del sidebar — no hizo
  falta detectar si está abierto/cerrado. Reusa `_goHome`/`_reload`
  (mismas funciones de antes) y `_isPublicRoute` (oculta en Login, misma
  lógica de la sesión 13d). Sin `AppBar`/`FloatingActionButton` de
  Material.
- `flutter analyze` limpio. **Sin dispositivo/emulador Android en este
  entorno** (`flutter devices` solo lista Windows desktop y navegadores)
  — no se pudo probar en vivo abrir/cerrar sidebar, navegar entre
  módulos ni refrescar. Queda como validación de campo pendiente.
- Commit `7f4de75`, pusheado a `origin/main`. APK recompilada y copiada a
  `C:\Users\USER\Desktop\SmartRayco.apk` (pisa la build de 13f — esta
  tiene FAB→franja + ícono/splash definitivos + todo lo anterior). No
  instalada ni distribuida.
- **Superseded por 13h**: la franja descrita acá se reemplazó por una
  cabecera unificada en el propio Vue — ver esa sección.

## 13h. Cabecera única (Vue) en vez de franja Flutter — RESUELTO Y DESPLEGADO

Pedido del usuario tras probar 13g en su Samsung: seguía viendo **dos**
cabeceras apiladas (la franja nativa de Flutter + la cabecera blanca del
panel). Se unificaron en una sola.

- **Detección WebView vs. navegador — mecanismo explícito, no screen-width**:
  `mobile_app/lib/main.dart` le agrega el sufijo `SmartRaycoApp/1.0` al
  User-Agent **real** del dispositivo (lee el actual con `getUserAgent()`
  y lo reusa, no lo reemplaza por uno inventado) antes de la primera
  carga. `src/lib/nativeApp.ts` (nuevo) expone `isNativeApp` leyendo
  `navigator.userAgent.includes('SmartRaycoApp')`. En un navegador normal
  (celular o escritorio) esto da `false` siempre — la cabecera web **no
  cambia en absoluto** para esos usuarios.
- **`AppLayout.vue`**: la cabecera móvil (`md:hidden`, la única que existía
  en celular) ahora es azul (`bg-sky-600`) con Inicio + Recargar + Menú en
  blanco **solo cuando `isNativeApp`** — en navegador sigue el diseño
  blanco de siempre (campana + menú), sin tocar una línea de esa rama.
  "Inicio" reusa `:to="homeTo"` (el mismo que ya tenía el logo — rutas y
  permisos de siempre, cero lógica nueva). "Menú" es el mismo
  `sidebarOpen = true` de siempre — **ningún sistema de apertura/cierre
  aparte**. "Recargar" pide confirmación con `useConfirm` (el mismo
  composable que ya usa el resto del panel) antes de
  `window.location.reload()`, para no perder formularios sin guardar.
- **`mobile_app/lib/main.dart`**: se eliminó toda la franja nativa
  (`_buildNavBar`, `_NavBarButton`, `_isPublicRoute`/`_updatePublicRoute`/
  `onUrlChange`, `_goHome`) — Flutter ya no necesita saber en qué ruta
  está, el Vue decide todo solo. Vuelve a ser solo el host del WebView +
  el overlay de "sin conexión".
- **`CampoLayout.vue` sin cambios a propósito** — conserva su propia
  navegación (volver atrás, cambiar contraseña, cerrar sesión), tal como
  se pidió explícitamente ("conservar la navegación correspondiente al
  técnico"). Las pantallas de trabajo de campo ya **no tienen ningún** FAB
  ni franja flotando encima (mejora neta ahí, sin agregar nada nuevo).
- `flutter analyze` y `vue-tsc` limpios. Verificado el diseño de la
  cabecera azul (colores, iconos, alineación) en un mockup HTML aislado
  con los mismos estilos exactos — **no se pudo** verificar dentro de la
  APK real (sin emulador Android disponible) ni iniciando sesión real
  para verla autenticada en vivo (se evitó deliberadamente usar la
  sesión/contraseña real guardada en el navegador solo para una prueba
  visual). Validación de campo pendiente.
- Commit `785b8fd`, pusheado a `origin/main`. APK recompilada y copiada a
  `C:\Users\USER\Desktop\SmartRayco.apk` (pisa 13g). No instalada ni
  distribuida.
- **Desplegado 2026-10-10, autorizado explícitamente con condiciones**:
  - Verificado antes de desplegar: `CampoLayout.vue` sin diff alguno desde
    su último cambio real (`633f053`, ajeno a esto); `/soporte` (home de
    TECNICO_RED) usa `AppLayout` (cabecera azul nueva), `/campo` y
    `/campo/:tipo/:id` usan `CampoLayout` (sin cambios) — confirmado en
    `src/router/index.ts` y el comentario de `App.vue` sobre que un
    técnico pasa por ambos layouts en la misma sesión. Sin duplicación,
    sin función perdida. Orden `_applyUserAgent()` → `loadRequest()`
    confirmado por lectura de código (el `await` garantiza que el UA
    quede puesto antes de la primera petición).
  - **Respaldo antes de desplegar**: se etiquetaron las imágenes Docker
    en uso (`smartrayco-frontend:latest` y `smartrayco-backend:latest`,
    ambas en commit `db1188b`) como `rollback-20261010220751` — mismo
    patrón de tags manuales que ya existía en la VM de sesiones previas
    (`antes-fase1-telnet`, `respaldo-20261009-185510`, etc.). `docker
    image prune` del propio `update.sh` no las toca (solo borra imágenes
    sin tag).
  - `bash deploy/update.sh` — git pull trajo `7f4de75`→`6386ad1`→
    `785b8fd`→`d59759a` (los primeros dos son Dart/docs, no tocan el
    build del frontend; el cambio real de UI es `785b8fd`). Sin
    migraciones, sin tocar Supabase/OLT/MikroTik — `update.sh` nunca lo
    hace.
  - **Verificado tras desplegar**: VM en `d59759a` (`git rev-parse HEAD`).
    `/login` y `/` responden 200. Bundle nuevo confirmado
    (`index-BxFqjSMd.js`, hash distinto al anterior). Logs de
    `smartrayco-backend-1` — los 6 schedulers reiniciaron limpios, sin
    error. Logs de `smartrayco-frontend-1` — sirviendo `/login`,
    `/dashboard` (redirige a login sin sesión, confirma que el guard de
    auth sigue intacto) y los assets nuevos con 200. Revisado visualmente
    en el navegador: Login carga bien, logo correcto, sin cabecera
    duplicada (Login no usa `AppLayout`). No se inició sesión real para
    ver la cabecera azul autenticada en vivo (se evitó deliberadamente
    usar una contraseña real guardada solo para una prueba visual) — la
    confirmación de la cabecera azul en sí fue vía el mockup HTML
    aislado de 13h, no contra la VM.
  - **Rollback disponible** (dos formas):
    1. Rápido (sin rebuild): en la VM,
       `docker tag smartrayco-frontend:rollback-20261010220751
       smartrayco-frontend:latest && docker tag
       smartrayco-backend:rollback-20261010220751
       smartrayco-backend:latest && docker compose -f
       docker-compose.onprem.yml up -d` (recrea los contenedores con las
       imágenes de antes, ~segundos).
    2. Por git (si hiciera falta volver también el código fuente):
       `git checkout db1188b && bash deploy/update.sh` — vuelve al
       commit que estaba desplegado antes de esta sesión.

## 13i. Fix: faltaba "Inicio" en App de Campo (CampoLayout) — RESUELTO Y DESPLEGADO

Bug real reportado tras probar 13h en el Samsung: en "Mis trabajos" (y en
el detalle de un trabajo) ya no había forma de ir al inicio — 13h agregó
Inicio/Recargar/Menú solo en `AppLayout.vue`, `CampoLayout.vue` quedó
intacto a propósito mientras tanto, perdiendo sin querer la función que
antes daba la franja nativa de Flutter (ya eliminada).

- `src/components/campo/CampoLayout.vue`: ícono de Inicio nuevo (casa),
  visible solo con `isNativeApp` (mismo mecanismo de 13h), reusa
  `homePath(auth.role)` de `src/lib/navigation.ts` — la misma función que
  ya usa `AppLayout.vue`, que ya resuelve el rol correctamente
  (TECNICO_RED no tiene Dashboard, su pantalla propia es `/soporte`). Sin
  rutas nuevas, sin lógica duplicada. No depende de `showBack`, así que
  aparece igual en "Mis trabajos" y en el detalle de un trabajo. Resto de
  la cabecera (back/logo, badge de sincronización, cambiar contraseña,
  cerrar sesión) intacto.
- `vue-tsc` limpio. Verificado visualmente con un mockup HTML aislado
  (mismos estilos/iconos) en 3 escenarios — cabe sin reorganizar nada.
- **No se tocó `mobile_app/` — no hace falta recompilar la APK.** El
  mecanismo de detección por User-Agent ya está en el binario instalado
  desde 13h; este fix es 100% frontend web y toma efecto con un deploy.
- Commits `76c2cfb` (código) y `5e6c0ff` (docs), pusheados a
  `origin/main`. **Desplegado** — respaldo de imágenes
  `rollback-20261010221710` (mismo mecanismo de 13h) antes de
  reconstruir. VM confirmada en `5e6c0ff` tras el deploy, `/login` y `/`
  responden 200, bundle nuevo (`index--dAi1_qt.js`), backend con los 6
  schedulers reiniciados sin error. Sin migraciones, sin tocar
  Supabase/OLT/MikroTik.

## 13j. Fix: "Convertir en cliente" de Prospectos no creaba nada — RESUELTO, pendiente de desplegar

Reportado por el usuario con un caso real: el prospecto "prueba2" (id
`3f3ec843-c8bf-43c6-a59b-6e0314d461fe`) quedó `en_negociacion`,
`converted_client_id` null, sin cliente ni orden de Alta — confirmado por
SQL de **solo lectura** contra Supabase (sin tocar el registro). Detalle
completo en `docs/ERRORES-CAMPO.md` (primera entrada real del archivo).

- **Causa raíz**: "Convertir en cliente" (`ProspectosView.vue`) solo hace
  `router.push` a `/clientes?prospect_id=..` para preabrir el modal "+
  Nuevo cliente" — no escribe nada por sí solo. Ese modal exige documento
  (`clients.document_number` es `NOT NULL`; el prospecto no lo captura,
  solo nombre/teléfono/zona/plan de interés) sin ningún aviso de que ese
  paso todavía falta completar. Si se cierra o no se envía, no queda
  rastro — flujo de dos pasos sin confirmación visible del segundo.
- **Corrección** (`src/views/clientes/ClientesView.vue`, único archivo
  tocado): aviso ámbar visible en el modal mientras se convierte un
  prospecto; aviso de posible duplicado por teléfono (`clients.phone`
  nunca es `unique`, igual que `prospects.phone` — antes "sin
  validación", ahora al menos avisa) vía `confirmDialog` antes de crear;
  además del cliente, genera la orden de Alta reusando el mismo
  store/flujo que "Nueva instalación" en Soporte
  (`installationsStore.createInstallation({ client_id })`, mismos
  defaults reales de la tabla — `status: 'pending'`, `priority: 'medium'`
  — sin agendar fecha ni asignar técnico); toasts de éxito/error en vez
  de `alert()`; navega a la ficha del cliente al terminar. El prospecto
  se sigue marcando `convertido` en el mismo punto que ya hacía (recién
  con el cliente creado de verdad) — no se cambió ese criterio, solo se
  agregó el paso de instalación antes, con el mismo patrón de "falla sin
  bloquear ni revertir" que ya tenía el paso de referido.
- **Sin tabla ni estado inventado, sin migración**: `clients.status`
  default `'prospect'` e `installations.status` default `'pending'` ya
  eran los valores reales existentes para "pendiente de instalación".
- **Sin prueba end-to-end contra Supabase real** — hacerlo habría creado
  un cliente/instalación reales de prueba, que el pedido explícitamente
  prohibía. Validado por lectura de código + `vue-tsc` limpio únicamente;
  queda pendiente que el usuario lo pruebe con un prospecto real.
- Commit `0c2ba8a`, pusheado a `origin/main`. **No desplegado** — no
  autorizado en este turno.

## 13k. Plan/tarifa/zona/dirección del prospecto hasta la orden de Alta — RESUELTO, pendiente de desplegar

Seguimiento de 13j, mismo día: el cliente y la Alta ya se creaban al
convertir, pero sin contrato — sin plan ni tarifa, y el prospecto perdía
el plan de interés y la zona/PON que sí había capturado. Pedido:
replicar lo que antes el administrador mandaba a mano por WhatsApp al
técnico (nombre, DNI, teléfonos, dirección, plan, tarifa — PPPoE solo si
ya existe, sin tocarlo).

- Revisado primero (solo lectura): columnas reales de
  `clients`/`installations`/`service_contracts` vía
  `information_schema`, el flujo real de "+ Nuevo servicio" en
  `ClientDetailView.vue` (de ahí sale el patrón reusado: `monthly_fee`
  del plan elegido, `installation_address` = dirección del cliente), y
  cómo `CampoTrabajoDetailView.vue` arma `clientDetail`/`activeContract`
  — confirmando que el técnico ya veía DNI/teléfonos (fetch directo por
  `client_id`, no dependía de esto) pero NO plan/zona (sí dependía de un
  contrato real, que faltaba).
- `ProspectosView.vue`: `convertToClient()` ahora también pasa `zone_id`
  y `plan_interes_id` del prospecto (antes se perdían en el redirect).
- `ClientesView.vue`: al convertir, además del cliente se crea el
  contrato (`plan_id`, `monthly_fee` del plan, `zone_id`,
  `installation_address`) **antes** de la instalación, y se la vincula
  (`contract_id`). Dirección pasa a ser obligatoria solo durante la
  conversión. El aviso del modal ahora también pide el teléfono
  alternativo si existe y muestra qué plan/zona se van a precargar antes
  de guardar. `pppoe_username`/`mikrotik_*` sin tocar — esa vinculación
  sigue siendo manual, vía el flujo de provisión existente.
- Sin tabla, estado ni migración nueva — se reutilizan columnas reales ya
  existentes. `vue-tsc` limpio. Sin prueba end-to-end contra Supabase
  real (crearía un cliente/contrato/instalación reales) — validado por
  lectura de código, siguiendo el patrón ya probado de "+ Nuevo
  servicio".
- Commit `ba49334`, pusheado a `origin/main`. **No desplegado** — no
  autorizado en este turno.

## 13. Próximo paso recomendado

1. **Frontend ya desplegado** (VM en `d59759a`, ver 13h) — falta instalar
   `C:\Users\USER\Desktop\SmartRayco.apk` (cabecera única + ícono/splash
   definitivos) en un equipo real y confirmar: una sola cabecera azul
   visible con sesión iniciada, Login sin ella, menú lateral abre/cierra
   sin superposiciones, Inicio/Recargar funcionan, App de Campo conserva
   su propia navegación — validación de campo pendiente, no hecha
   todavía (sin emulador Android en este entorno).
2. Probar en campo real (con un técnico) el wizard de 5 pasos y el nuevo
   flujo de Drop prefabricado/bobina (fase anterior a la de identidad
   visual) antes de seguir iterando sobre esa pantalla.
3. Decidir si vale la pena una revisión de seguridad más amplia sobre los
   grants por defecto de Supabase (sección 11) — es un hallazgo real pero
   no urgente (la autorización real ya vive dentro de cada función).
4. Empezar a registrar en `docs/ERRORES-CAMPO.md` los bugs reales que
   reporten los técnicos, para no perder ese historial.
