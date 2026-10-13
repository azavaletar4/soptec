# SmartRayco — Estado de desarrollo

**✅ INCIDENCIA CERRADA (2026-10-12): los técnicos no podían cerrar
Rutinas ni Altas desde App de Campo** — error
`invalid input value for enum routine_status/installation_status`.
Causa raíz encontrada y corregida, migración aplicada en Supabase y
**confirmada en campo por el usuario** (ver **13w/13w.1**). Sin
pendientes.

Última actualización: 2026-10-12, sesión de verificación visual de la
conversión de prospectos (13m), de separación admin/técnico en
Instalaciones (13n, corregida por 13o), de proteger órdenes de
Instalación cerradas (13p), de sesiones de trabajo / "Tiempo de trabajo"
en el Histórico (13q), de resumen de coordinación + "Copiar datos de
instalación" (13r), de mejoras en la ventana Clientes (13s), de ajustes
puntuales a esa misma ventana (13t), de corregir el conteo de ocupación
de cajas NAP (13u, confirmado por el administrador: los 4 clientes de
NAP - 01 son reales), de prevenir puertos NAP fantasma a futuro con 2
triggers `BEFORE DELETE` (13v), del hotfix de la incidencia crítica de
cierre de Rutinas/Altas (13w, ver aviso arriba) y de simplificar el
control NAP en Zonas contando servicios en vez de puertos (13x) —
**todas aplicadas/desplegadas**. **VM de producción en commit
`a5c67c4`**, migraciones de Fase 151 y Fase 150 aplicadas en Supabase
(13r/13s/13t/13u no requirieron migración; 13v —
`20261012191318_fase156_...` — y 13w —
`20261012192807_fase150b_fix_track_job_work_session_enum` — sí, ambas
aplicadas y verificadas; 13x no requiere migración). 12 y 13d/13g
quedaron supersedidas, ver notas en cada una. Este documento es la
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

## 2. Estado real de producción (verificado 2026-10-13, sin volver a desplegar)

- **Commit desplegado en la VM**: `a5c67c4` ("Fase 157: simplificación
  mínima del control NAP en Zonas"), verificado por SSH. Local y remoto
  (`origin/main`) están en `1779fa8` (commit de documentación posterior,
  no toca código). `git status` en la VM limpio (solo `.last_rollback_tag`
  sin trackear, artefacto del script de deploy).
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
- Commit `ba49334`, pusheado a `origin/main`.

## 13l. Verificación final del flujo + fix real encontrado + despliegue — RESUELTO Y DESPLEGADO

Pedido explícito: verificar punto por punto el flujo completo antes de
autorizar el despliegue. Se encontró y corrigió un problema real
releyendo el código (sin tocar Supabase):

- **Hallazgo**: `markConverted()` se llamaba siempre que el cliente se
  hubiera creado, sin importar si el contrato y la instalación habían
  fallado — el prospecto podía quedar "convertido" sin ninguna orden de
  Alta real. Corregido: solo se marca convertido si las TRES escrituras
  (cliente, contrato, instalación) terminaron bien. Si algo falla, el
  cliente (y el contrato, si llegó a crearse) quedan en pie — no se
  revierten — pero el prospecto sigue "por convertir"; un reintento
  vuelve a pasar por el chequeo de documento/teléfono ya existente (avisa,
  no es garantía de unicidad a nivel de BD — así quedó documentado en el
  mensaje al usuario, sin prometer de más).
- Guard `if (saving.value) return` agregado al inicio de `handleSubmit`
  contra reenvíos mientras una llamada anterior sigue en vuelo.
- Verificado leyendo código (cero consultas a Supabase esta vez): la Alta
  aparece en Soporte (`installation.status: 'pending'` está en
  `ACTIVE_STATUS` de `useUnifiedJobs.ts`); App de Campo recibe nombre/
  DNI/teléfono principal y alternativo/dirección/plan, confirmado campo
  por campo en `CampoTrabajoDetailView.vue` + `campo.ts` — **corrección a
  13k: la tarifa NO se le muestra al técnico en ningún lado de esa vista**
  (diseño existente, el rol técnico no ve montos — 13k afirmaba de más);
  la instalación nunca asigna técnico automáticamente.
- Commit `718e4c1`, pusheado a `origin/main`.
- **Desplegado** (autorización condicionada a que las verificaciones
  pasaran): respaldo `rollback-20261010231717` (mismo mecanismo de 13h/
  13i) antes de reconstruir. VM confirmada en `718e4c1`, `/login`
  responde 200.
- **Sesión cortada por límite de uso justo después del deploy** — no se
  alcanzó a hacer la verificación visual en navegador (solo HTTP
  200 + lectura de código). Sin cambios pendientes sin commitear.

## 13m. Verificación visual encontró bug real: modal de conversión nunca se mostraba — RESUELTO Y DESPLEGADO

Sesión 2026-10-12: se hizo la verificación visual en navegador que 13l había
dejado pendiente, con un prospecto ficticio nuevo ("DIAGNOSTICO CLAUDE
TEST", distinto de "prueba2"). Resultado: **0 clientes/contratos/
instalaciones creados** pese a "ejecutar" la conversión — el bug era
invisible por lectura de código, solo se vio probando en vivo.

- **Causa raíz**: `App.vue:16` monta la vista con `:key="route.fullPath"`.
  `ClientesView.vue` abre el modal de conversión en `onMounted` al leer
  `route.query.prospect_id`, pero la misma función terminaba con
  `router.replace('/clientes')` para limpiar la URL — ese cambio de
  `fullPath` disparaba el `:key`, destruyendo la instancia recién montada
  (con el modal ya abierto) y montando una instancia nueva sin query, que
  ya no abre el modal. Abría y se cerraba en el mismo tick, sin errores de
  consola — por eso pasó 13j/13k/13l sin detectarse.
- **Corrección**: `ClientesView.vue` ahora limpia la URL con
  `window.history.replaceState(...)` en vez de `router.replace()` — cambia
  la URL visible sin tocar la ruta reactiva de Vue Router, así no dispara
  el `:key` y el componente no se remonta.
- **Validado end-to-end** en local (`smartrayco-web` + `smartrayco-api` vía
  PM2, misma Supabase de producción, **sin desplegar**): conversión
  completa confirmada por SQL de solo lectura — cliente, contrato
  (plan/tarifa/zona/dirección correctos), instalación `pending`, prospecto
  `convertido`. `vue-tsc -p tsconfig.app.json` limpio.
- Detalle completo en `docs/ERRORES-CAMPO.md` (fila 2026-10-12).
- **Dato de prueba que quedó en Supabase de producción** (pendiente de que
  el usuario decida si lo borra): prospecto/cliente/contrato/instalación
  "DIAGNOSTICO CLAUDE TEST" (doc. `88776655`, tel. `999111222`) — no hay
  botón "Eliminar" para prospectos en el panel, requeriría un `DELETE`
  directo en Supabase.
- **Desplegado** (pedido explícito del usuario en el mismo turno):
  respaldo `rollback-20261012123157` (mismo mecanismo de 13h/13i/13l)
  antes de reconstruir. `bash deploy/update.sh` — git pull trajo
  `718e4c1`→`61da3a1` (incluye también la actualización de
  `ESTADO_DESARROLLO.md`/`docs/ERRORES-CAMPO.md` de esta sesión, sin
  impacto en runtime). Sin migraciones, sin tocar Supabase/OLT/MikroTik.
  **Verificado tras desplegar**: VM en `61da3a1` (`git rev-parse HEAD`),
  los 5 contenedores `Up`/`healthy`, backend con los 6 schedulers
  reiniciados limpios. `https://panel.rayconetworks.com/login` responde
  200, bundle nuevo confirmado (`index-_Z8LLB7-.js`, hash distinto) y se
  verificó que el bundle de `ClientesView` contiene el fix
  (`replaceState`). No se repitió la prueba visual completa de conversión
  contra la VM (ya validada end-to-end en local antes de desplegar, mismo
  código).

## 13n. Fase 148 — separar gestión administrativa de ejecución técnica en Instalaciones — IMPLEMENTADO Y DESPLEGADO

Pedido explícito del usuario, mismo día: en `InstalacionDetailView.vue`
(detalle admin de una orden de Alta) las notas quedaban de solo lectura
tras crear la orden, y los formularios de "Materiales usados"/"Plantilla
de materiales"/"Otro material" aparecían incluso en órdenes `pending`
recién creadas, sin técnico, generando confusión administrativa.

- **Notas editables**: nuevo bloque "Editar notas"/"+ Agregar notas"
  (textarea + Cancelar/Guardar) para `canEdit` (SUPERADMIN/ADMIN),
  reutilizando `installationsStore.updateInstallation()` — la misma
  función y columna (`installations.notes`) que ya usa el formulario de
  creación (`InstalacionesView.vue:436`) y que la App de Campo ya leía de
  solo lectura (`CampoTrabajoDetailView.vue:116`, `trabajoDescripcion` —
  computed, nunca un `v-model`, confirmado que el técnico nunca escribe
  ahí). Sin migración: RLS ya permitía a SUPERADMIN/ADMIN actualizar
  cualquier columna de `installations` en cualquier estado
  (`installations_update_staff`, fase70) — no hubo que abrir nada nuevo.
- **Materiales ocultos antes del despacho**: nuevo computed `isPreDispatch`
  (`status === 'pending'`) oculta para admin el formulario de "Plantilla
  de materiales" y "Otro material" (deja el listado de lo ya registrado,
  si hubiera, y un aviso de que se registra desde la App de Campo). Es
  puramente de UX — no es un límite de permisos nuevo: el admin sigue
  teniendo el mismo acceso real de siempre (RLS sin cambios).
- **Equipos asignados (serie/MAC) — NO se ocultó**: tras revisar el
  propósito (`inventoryUnitsStore.assignUnit`, misma función que usa la
  App de Campo), se dejó intacto porque sirve para que administración
  reserve/pre-asigne una serie específica antes de despachar al técnico —
  un flujo administrativo legítimo y separado, no una duplicación de la
  ejecución técnica. Solo se agregó una nota aclaratoria cuando
  `isPreDispatch`.
- **Validado**: `vue-tsc -p tsconfig.app.json` limpio. Visual en local
  (`smartrayco-web`/`smartrayco-api`, misma Supabase, sin escrituras)
  contra una orden `scheduled` real: "Editar notas" precarga el texto,
  Cancelar no escribe nada (no se probó Guardar para no tocar una orden
  real), materiales siguen igual que antes (no es `pending`, sin
  regresión). **No se pudo probar visualmente el caso `pending`** — no
  existe ninguna instalación `pending` en producción ahora mismo y no se
  creó una real para la prueba (instrucción explícita); cubierto por
  lectura de código + type-check únicamente (condición de una sola línea,
  bajo riesgo).
- Archivo tocado: solo `src/views/instalaciones/InstalacionDetailView.vue`.
  Sin cambios en `CampoTrabajoDetailView.vue`, stores, RLS ni migraciones.
- **Desplegado** (pedido explícito del usuario): respaldo
  `rollback-20261012125437` antes de reconstruir. `bash deploy/update.sh`
  — git pull trajo `61da3a1`→`d2462d1`. Sin migraciones, sin tocar
  Supabase/OLT/MikroTik/PPPoE/inventario. VM confirmada en `d2462d1`, 5
  contenedores `Up`/healthy, schedulers reiniciados limpios,
  `https://panel.rayconetworks.com/login` responde 200, bundle nuevo
  (`index-qsOP1Xc4.js`).
  - **Verificado de verdad contra producción** (solo lectura, sin tocar
    ninguna orden real): se abrió `/soporte/instalaciones/187e8cbc-...`
    (orden real `scheduled`, no `pending`) — carga bien, "Editar notas"
    visible, nota existente se muestra correcta, "Materiales usados" +
    "Equipos asignados" siguen apareciendo igual que siempre (comportamiento
    esperado: esta orden no es `pending`, no debía ocultarse nada).
  - **Pendiente de verificar en producción** (no se pudo): el ocultamiento
    del formulario de materiales en una orden `pending` real — sigue sin
    existir ninguna instalación `pending` en producción y no se creó una
    para la prueba (instrucción explícita del usuario). Cubierto solo por
    `vue-tsc` limpio y lectura de código (condición de una línea,
    `status === 'pending'`, bajo riesgo). Validar visualmente la próxima
    vez que exista una orden `pending` real.

## 13o. Fase 149 — correción a 13n: ocultar materiales en TODOS los estados, no solo pending — IMPLEMENTADO Y DESPLEGADO

El usuario revisó una orden real `scheduled` ("Programada") en producción
tras desplegar 13n y encontró que "Plantilla de materiales"/"Otro
material"/"Registrar plantilla" seguían apareciendo — la condición de 13n
(`isPreDispatch`, solo `status === 'pending'`) no cubría `scheduled`,
`in_progress` ni `completed`.

- **Corrección real, no un parche de la condición**: en vez de agregar más
  estados a la condición, se sacó el formulario de registro de materiales
  **por completo** de `InstalacionDetailView.vue` — para
  SUPERADMIN/ADMIN, en cualquier estado, solo queda la consulta de solo
  lectura de lo ya registrado + un aviso de que se registra desde la App
  de Campo. Se eliminó también el código ahora muerto que quedaba sin
  ningún `v-if` que lo alcanzara (`MATERIAL_TEMPLATE`, `templateRows`,
  `handleRegisterTemplate`, `handleAddMaterial`, `materialForm` y
  variables asociadas) — `tsconfig.app.json` tiene `noUnusedLocals: true`,
  así que dejarlo sin usar no hubiera pasado el type-check.
- **Equipos asignados (serie/MAC) sigue intacto**, sin tocar — confirma lo
  ya decidido en 13n (reserva administrativa, propósito distinto).
- **App de Campo sin cambios** — `CampoTrabajoDetailView.vue` tiene su
  propio registro de materiales/equipos independiente, nunca se tocó.
- Validado: `vue-tsc -p tsconfig.app.json` limpio (confirma que no quedó
  código muerto). Visual en local contra la misma orden real `scheduled`
  (187e8cbc...): "Materiales usados" ahora solo muestra la consulta + el
  aviso, sin ningún formulario; "Equipos asignados" sigue con su
  formulario de asignación intacto; "Editar notas" sigue funcionando (no
  se tocó esa parte). Sin editar ninguna orden real.
- Archivo tocado: solo `src/views/instalaciones/InstalacionDetailView.vue`.
- **Desplegado** (pedido explícito del usuario): respaldo
  `rollback-20261012130400` antes de reconstruir. `bash deploy/update.sh`
  — git pull trajo `d2462d1`→`8069b4f`. Sin migraciones, sin tocar
  Supabase/OLT/MikroTik/PPPoE/inventario. VM confirmada en `8069b4f`, 5
  contenedores `Up`/healthy, schedulers reiniciados limpios, `/login`
  responde 200, bundle nuevo (`index-yEzfw67_.js`).
  - **Verificado de verdad contra producción, como SUPERADMIN** (sesión
    reiniciada — el primer intento quedó logueado con una sesión de
    TECNICO_RED guardada en el navegador, se cerró sesión y se volvió a
    entrar con la cuenta admin antes de verificar): sobre la misma orden
    real `187e8cbc...` (`scheduled`) — "Materiales usados" muestra
    únicamente la consulta de solo lectura + el aviso de que se registra
    desde la App de Campo, sin ningún formulario; "Equipos asignados
    (serie/MAC)" sigue con su formulario de asignación intacto; "Editar
    notas" visible. Sin editar ninguna orden real.
  - De paso, se confirmó el comportamiento correcto para TECNICO_RED (vista
    previa con la sesión equivocada): banner "🔒 Vista de solo lectura" +
    "Gestiona materiales desde la App de Campo" — sin cambios, como ya
    estaba.

## 13p. Fase 151 — proteger órdenes de Instalación cerradas (solo lectura real) — APLICADA Y DESPLEGADA

Pedido explícito del usuario: las órdenes `completed`/`cancelled` mostraban
controles editables incluso para ADMIN (y "Quitar" equipos) — confirmó la
sospecha de que ocultar botones en el frontend no alcanza, el backend
tenía que cerrarlo de verdad.

- **Backend investigado primero** (antes de tocar nada): confirmó que
  equipos/materiales de una instalación `completed` YA estaban protegidos
  de verdad por triggers reales (Fase 46/69 — `apply_inventory_unit_event`/
  `apply_inventory_movement`, solo SUPERADMIN/ADMIN pueden tocarlos). Lo
  que faltaba:
  1. `installations` (estado/prioridad/notas): RLS sin ninguna distinción
     ADMIN/SUPERADMIN en ningún estado.
  2. `job_assignees` (cuadrilla): mismo hueco.
  3. Los triggers de Fase 46/69 solo miraban `'completed'` — `'cancelled'`
     nunca quedó cubierto.
  4. Asimetría real en el trigger de equipos: el candado de `ticket_id`
     (Fase 95b) solo se evaluaba al ASIGNAR equipo nuevo a una avería
     resuelta/cerrada, nunca al QUITAR uno ya ligado.
  5. Materiales de una avería (`inventory_movements.ticket_id`): CERO
     protección, a cualquier estado.
- **Alcance deliberadamente acotado a Instalaciones** (no a Averías/
  Rutinas): confirmado que `tickets_update_staff` ya incluye SOPORTE sin
  restricción y que `'resolved'` NO es un estado terminal real para un
  ticket (admin/soporte sigue necesitando editarlo para pasarlo a
  `'closed'`) — mezclar esa decisión aquí habría roto ese flujo. Queda
  para una fase separada, con su propio diseño.
- **Migración** (`supabase/migrations/20261012150000_fase151_proteger_ordenes_cerradas.sql`,
  idempotente, **NO aplicada**): `installations_update_staff` y
  `job_assignees_write_dispatch` (solo `job_type='installation'`)
  restringen ADMIN/SOPORTE cuando la instalación está cerrada — la
  restricción nueva va SOLO en `USING` (fila ANTES del update), nunca en
  `WITH CHECK`, para que completar/cancelar una orden abierta siga
  funcionando con normalidad; SUPERADMIN sin cambios (ya tenía paso
  libre). Los dos triggers de inventario se extienden con `'cancelled'` +
  el chequeo de `ticket_id` que faltaba, reusando el mismo grupo de roles
  que Fase 95b ya estableció (SUPERADMIN/ADMIN/SOPORTE) para no romper el
  flujo de aprobación de averías ya en uso.
- **Validado con Postgres real en Docker, aislado** — 17/17 pruebas
  (`npm run test:closed-orders-sql`), más las 14 de Fase 137 corridas de
  nuevo para confirmar que no se rompió nada ahí (31/31 en total).
- **Frontend** (`InstalacionDetailView.vue`): `closedReadOnly` nuevo
  (cerrada AND no es SUPERADMIN-con-edición-activada) aplicado a
  `canEdit`/`canEditMaterials`/`canEditStatus`/`canEditPriority`/
  `canEditCrew`/`canRemoveUnit`. Botón "🔓 Habilitar edición" (solo
  SUPERADMIN) con `confirm()` explícito, banner ámbar mientras el modo
  excepcional está activo, "🔒 Salir del modo edición". Cada acción
  conserva su propia confirmación (quitar equipo, cancelar, eliminar) —
  habilitar edición no ejecuta ningún cambio por sí solo ni reabre nada.
  `canDelete`/el formulario de "Completar instalación" quedaron sin tocar
  a propósito (fuera del pedido, ya tenían su propio candado de estado).
- **Validado visualmente** contra 2 órdenes reales de producción (lectura
  únicamente, sin guardar nada), como SUPERADMIN: una `completed`
  (`fa380e18...`) y una `cancelled` (`187e8cbc...`, la misma que se usó en
  13n/13o — el usuario la canceló de verdad entre sesiones). Ambas
  muestran el banner correcto + "Habilitar edición"; Estado/Prioridad como
  badges fijos; sin "Editar notas"; materiales con el aviso "Solo lectura
  — orden cerrada"; equipos sin formulario de asignación ni botón
  "Quitar". **No se probó el clic real en "Habilitar edición"** — dispara
  un `confirm()` nativo del navegador, que la automatización tiene
  prohibido disparar; queda cubierto por lectura de código + type-check
  únicamente (lógica de una línea: `editModeForClosed.value = true`).
- Archivos: `supabase/migrations/20261012150000_fase151_proteger_ordenes_cerradas.sql`,
  `server/tests/closedOrdersSchema.sql`, `server/tests/closedOrders.sql.test.ts`,
  `package.json` (script `test:closed-orders-sql`),
  `src/views/instalaciones/InstalacionDetailView.vue`.
- **Commiteado y pusheado, NO aplicada la migración, NO desplegado** —
  pendiente de autorización explícita para ambas cosas por separado
  (aplicar en Supabase y desplegar el frontend).

### 13p.1 — Validación final puntual pedida antes de autorizar producción

Sin repetir las 17 pruebas ya hechas — se agregaron 3 pruebas nuevas al
mismo archivo (`npm run test:closed-orders-sql`, ahora **20/20**):

1. **ADMIN completa/cancela una orden abierta, pero no toca una cerrada**:
   ya cubierto por las pruebas originales (3 y 4 de la lista).
2. **El técnico cierra normalmente desde App de Campo** (asignar equipo →
   registrar material → completar su propia orden → intenta seguir
   tocándola después de cerrada): prueba nueva de punta a punta, las 4
   partes pasan — la política nueva no toca la rama de `TECNICO_RED`.
3. **SUPERADMIN hace la corrección excepcional**: cubierto en backend
   (prueba original); en frontend, verificado por lectura de código (el
   clic real en "Habilitar edición" no se puede probar por automatización
   — dispara un `confirm()` nativo, prohibido).
4. **La protección es RLS real, no solo frontend**: las 20 pruebas corren
   contra SQL puro (`psql` como `role authenticated` con distintos JWT),
   sin pasar por el frontend en ningún momento.
5. **No altera históricos ni toca Averías/Rutinas/OLT/MikroTik/PPPoE/
   facturación**: confirmado por `grep` directo sobre el archivo — cero
   referencias a esas tablas (solo en comentarios explicando por qué se
   excluyen a propósito) y cero sentencias `UPDATE`/`DELETE`/`INSERT`
   fuera de los cuerpos de los triggers (que solo actúan sobre escrituras
   nuevas, nunca sobre filas existentes).
6. **Rollback probado, no solo redactado**: `supabase/rollback/
   fase151_rollback.sql` (fuera de `supabase/migrations/` a propósito,
   para que ninguna herramienta lo aplique por error junto a las demás) —
   restaura el texto literal de las 4 definiciones previas (Fase 70/94/
   95b/69). Prueba nueva: aplica Fase 151 → aplica el rollback → confirma
   que ADMIN vuelve a poder editar una instalación `completed` y que
   `'cancelled'` vuelve a quedar sin protección en `inventory_unit_events`
   (reproduce el hueco original exacto) → re-aplica Fase 151 para dejar la
   base de pruebas consistente para lo que sigue.

**Riesgos residuales** (ninguno bloqueante, documentados para que quede
explícito):
- ~~El clic real en "Habilitar edición" no se probó en navegador~~ —
  **cerrado**: el usuario lo probó a mano como SUPERADMIN directo en
  producción (2026-10-12, después del despliegue) y confirmó que funciona
  bien (botón → confirmación → modo excepcional se activa → controles se
  habilitan). Era la única parte que la automatización no podía ejercitar
  (dispara un `confirm()` nativo).
- El rollback se probó contra Postgres aislado en Docker, no contra la
  copia real de producción — mismo nivel de confianza que toda la
  validación de esta sesión (no se iba a escribir en producción para
  probarlo).
- Tickets/Rutinas quedan con el mismo nivel de protección de antes (sin
  cambios) — ya documentado como alcance deliberado, no es un olvido.

### 13p.2 — Aplicada y desplegada (pedido explícito del usuario)

- **Destino verificado antes de tocar nada**: Supabase proyecto
  `mzupdnjegfwmpajywckd` (`SMARTRAYCO`, el único real) y VM
  `192.168.55.201` en `8069b4f` (limpia, contenedores sanos) — mismos de
  siempre, sin cambios desde la última sesión.
- **Migración aplicada** vía herramienta de migración (texto idéntico al
  archivo versionado) — verificado leyendo las policies/funciones reales
  después: `installations_update_staff` y `job_assignees_write_dispatch`
  con el texto exacto esperado; `apply_inventory_unit_event`/
  `apply_inventory_movement` contienen `'cancelled'` y el chequeo de
  `current_ticket_id` nuevo.
- **Respaldo**: `rollback-20261012151259` (imágenes Docker) antes de
  reconstruir — mismo mecanismo de siempre. Rollback completo también
  disponible en `supabase/rollback/fase151_rollback.sql` (ya probado de
  punta a punta, ver 13p.1).
- **Desplegado**: `bash deploy/update.sh` — git pull `8069b4f`→`bc5c09c`.
  VM confirmada en `bc5c09c`, 5 contenedores `Up`/healthy, los 6
  schedulers del backend reiniciados limpios, `/login` responde 200. Sin
  migraciones de Supabase adicionales en el deploy (la única migración de
  esta fase ya se aplicó por separado, arriba).
- No se tocó ningún otro módulo ni dato operativo — solo la migración y el
  build de frontend/backend de siempre.

## 13q. Fase 150 — implementación completa: "Tiempo de trabajo" en Histórico — APLICADA Y DESPLEGADA

Implementa el diseño ya aprobado (13n sección original de Fase 150,
`job_work_sessions`) — la migración en sí no cambió respecto a lo ya
commiteado y validado; esta sesión agrega el **frontend** y refuerza las
**pruebas de permisos RLS** que el pedido explícito exigía.

- **Frontend** (`HistoricoAtendidosView.vue`): nueva columna "Tiempo de
  trabajo" (tabla de escritorio + tarjeta móvil) y columna nueva en el CSV
  — "Tiempo de respuesta" queda intacto, sin cambiar su cálculo ni su
  significado. `fetchWorkDurations()` suma por orden las sesiones
  **cerradas** de `job_work_sessions` (una consulta por tipo de job, mismo
  patrón que `fetchEvidenceCounts` ya existente) — una orden sin ninguna
  sesión cerrada (histórica, o cerrada sin pasar nunca por `in_progress`)
  queda en `null` → se muestra **"No registrado"**, nunca se inventa un
  tiempo. **Ningún botón nuevo en App de Campo** — todo se deriva de los
  cambios de estado que ya existen (Iniciar Orden, completar, Cliente
  Ausente, etc.), tal como pedía el diseño original.
- **Permisos RLS reforzados y probados de verdad** (antes la prueba de
  Fase 150 usaba un `current_user_role()` fijo en `'SUPERADMIN'`, no
  probaba RLS por rol): `jobWorkSessionsSchema.sql` ahora es consciente de
  roles reales (mismo patrón que `closedOrdersSchema.sql`/
  `napSchema.sql`) y `jobWorkSessions.sql.test.ts` agrega 4 pruebas
  nuevas: todo el staff interno (SUPERADMIN/ADMIN/TECNICO_RED/SOPORTE/
  FACTURACION) puede leer; CLIENTE no puede; **ningún rol, ni siquiera
  SUPERADMIN, puede insertar/actualizar/borrar una sesión a mano** — solo
  el trigger (`security definer`) escribe ahí, confirmado en vivo.
- **Validado con Postgres real en Docker, aislado**: **14/14** pruebas
  (`npm run test:job-work-sessions-sql`) — las 9 originales del trigger
  (sin cambios de comportamiento) + las 4 de RLS nuevas.
- `vue-tsc -p tsconfig.app.json` limpio.
- **Validado visualmente en local** (dev server contra la misma Supabase
  de producción, solo lectura): como `job_work_sessions` **todavía no
  existe en producción** (migración sin aplicar), se confirmó que la
  vista no se rompe — la columna nueva muestra "No registrado" en todas
  las filas, sin errores en consola, y "Tiempo de respuesta" sigue
  funcionando igual que siempre. Se probó también "Exportar a CSV" sin
  errores.
- Archivos: `src/views/soporte/HistoricoAtendidosView.vue`,
  `server/tests/jobWorkSessionsSchema.sql`,
  `server/tests/jobWorkSessions.sql.test.ts`. La migración
  (`supabase/migrations/20261012140000_fase150_sesiones_trabajo.sql`) no
  cambió — sigue siendo la misma ya commiteada y aprobada.
- **Commiteado y pusheado, NO aplicada la migración, NO desplegado** —
  pendiente de autorización explícita para ambas cosas por separado,
  igual que se hizo con Fase 151.

### 13q.1 — Aplicada y desplegada (pedido explícito del usuario)

- **Destino verificado antes de tocar nada**: Supabase proyecto
  `mzupdnjegfwmpajywckd` (`SMARTRAYCO`) y VM `192.168.55.201` en `bc5c09c`
  (limpia, contenedores sanos) — mismos de siempre.
- **Respaldo**: `rollback-20261012152322` (imágenes Docker) antes de
  reconstruir.
- **Migración aplicada** (texto idéntico al archivo versionado, sin
  cambios respecto a lo ya aprobado) — verificada leyendo el catálogo real
  después: tabla `job_work_sessions` (1), 3 índices (PK + job/tipo + único
  de sesión abierta), 1 sola policy (`select`, sin ninguna de escritura —
  confirma que nadie puede insertar/editar a mano, ni siquiera SUPERADMIN,
  solo el trigger), 3 triggers (`tickets`/`installations`/`routines`). El
  cuerpo de `track_job_work_session()` contiene `'paused'` y
  `'cancelled_order'` tal como se diseñó.
- **Desplegado**: `bash deploy/update.sh` — git pull `bc5c09c`→`72b2f1f`.
  VM confirmada en `72b2f1f`, 5 contenedores `Up`/healthy, los 6
  schedulers del backend reiniciados limpios, `/login` responde 200.
- **Verificado en producción, solo lectura, sin tocar ninguna orden
  real**: `/soporte/historico` carga bien, columna "Tiempo de trabajo"
  muestra "No registrado" (ninguna orden existente pasó nunca por el
  trigger nuevo, es el comportamiento esperado — recién a partir de ahora
  se empiezan a registrar sesiones), "Tiempo de respuesta" sin cambios.
  Confirmado por red: la consulta real a `job_work_sessions` responde 200.
  Cero errores en consola. `/soporte` (Operaciones de Hoy/Dispatch, mismo
  flujo de estados que usa App de Campo) carga sin errores — no se probó
  el cierre real de un trabajo desde la App de Campo para no tocar una
  orden real, cubierto por las 14 pruebas aisladas ya validadas.
- No se tocó ningún otro módulo ni dato operativo.

## 13r. Fase 152 — resumen de coordinación + "Copiar datos de instalación" en Instalaciones — APLICADA Y DESPLEGADA

Pedido explícito: reemplazar el mensaje de WhatsApp que antes se armaba a
mano (admin copiaba nombre/DNI/teléfono/dirección/plan de la ficha del
cliente y del prospecto) por un resumen automático + botón de copiar en
`InstalacionDetailView.vue`. Sin tablas nuevas, sin tocar OLT/MikroTik/
PPPoE/inventario/facturación.

- **Punto 1 (verificar que los datos llegan)**: no se repitió la
  auditoría — ya está confirmado en 13j/13k/13l (misma sesión) que
  nombre/DNI/teléfonos/dirección/plan/tarifa/zona-PON llegan correctamente
  del prospecto convertido hasta el contrato y la instalación. Esta fase
  solo necesitó **un dato que faltaba**: `phone_2` (teléfono alterno) no
  estaba en el `select` de `installationsStore` — se agregó (1 línea,
  `src/stores/installations.ts` + el tipo `Installation` en
  `src/types/domain.ts`). Todo lo demás (DNI, plan, tarifa real
  `monthly_fee`, zona/PON, dirección de la instalación) ya estaba cargado
  en `contractsStore.contracts`, reusando el mismo patrón de búsqueda que
  ya existía en `initCompleteForm()` (`contractsStore.contracts.find(c =>
  c.id === installation.value?.contract_id)`) — **cero fetches nuevos**.
- **Punto 2 (resumen visible)**: tarjeta "📋 Resumen de instalación" en la
  columna izquierda (después de Notas) — Cliente, DNI, Teléfono (+
  alterno si existe), Dirección, Plan — Tarifa, Zona/PON, Orden. Oculta
  para `TECNICO_RED` (ya ve lo mismo, menos la tarifa, en su propia App de
  Campo — no se le duplica). La tarifa sigue sin mostrársele al técnico en
  ningún lado (eso no cambió, es la regla de 13l).
- **Punto 3 (botón de copiar, sin envío automático)**: "📋 Copiar datos de
  instalación" arma el mismo texto en formato lista (como el mensaje de
  WhatsApp de antes) y lo copia con `navigator.clipboard.writeText()` —
  el usuario decide dónde pegarlo, nada se envía solo. Toast de
  confirmación/error.
- **Punto 4 (reusar, no duplicar)**: ninguna tabla nueva, ninguna columna
  nueva salvo el `phone_2` que ya existía en `clients` y solo faltaba
  seleccionarlo aquí. El cálculo de tarifa (`S/ ${monthly_fee.toFixed(2)}`)
  sigue el mismo patrón inline que ya usa `ClientDetailView.vue` — no se
  creó un helper de moneda nuevo.
- **Punto 5**: no se tocó ningún archivo de OLT/MikroTik/PPPoE/inventario/
  facturación.
- **Validado**: `vue-tsc -p tsconfig.app.json` limpio. Visual en local
  (dev server contra la misma Supabase de producción, **solo lectura**)
  contra una orden real completada (`fa380e18...`, Luis Romero León): el
  resumen muestra DNI, teléfono, dirección, plan+tarifa y zona/PON reales
  y correctos; "Copiar datos de instalación" funcionó — toast de éxito
  confirmó que `clipboard.writeText()` resolvió sin error (no se pudo
  releer el portapapeles vía automatización para confirmar el texto
  exacto — un intento de `navigator.clipboard.readText()` vía DevTools
  quedó colgado por el prompt de permiso del navegador; el toast de éxito
  real de la app ya es evidencia suficiente de que la escritura
  funcionó). No se guardó ni modificó ningún dato real.
- Archivos: `src/views/instalaciones/InstalacionDetailView.vue`,
  `src/stores/installations.ts`, `src/types/domain.ts`.
- **Commiteado y pusheado, NO desplegado** — pendiente de autorización
  explícita. No requiere migración (no se tocó Supabase).

### 13r.1 — Desplegada (pedido explícito del usuario)

- **Destino verificado**: VM `192.168.55.201` en `72b2f1f` (limpia, sana)
  — mismo de siempre. Sin migración que aplicar (esta fase no toca
  Supabase).
- **Respaldo**: `rollback-20261012171128` antes de reconstruir.
- **Desplegado**: `bash deploy/update.sh` — git pull `72b2f1f`→`e2254ce`.
  VM confirmada en `e2254ce`, 5 contenedores `Up`/healthy, los 6
  schedulers reiniciados limpios, `/login` responde 200.
- **Verificado en producción, solo lectura**: `/soporte/instalaciones/
  fa380e18...` (Luis Romero León, real) carga bien; "Resumen de
  instalación" muestra DNI, teléfono, dirección, plan+tarifa y zona/PON
  correctos; clic real en "Copiar datos de instalación" → toast
  "✓ Datos copiados — pégalos en WhatsApp para coordinar con el técnico".
  Sin tocar ninguna orden real.
- No se tocó ningún otro módulo.

## 13s. Fase 153 — mejoras de la ventana Clientes (filtros, estado real, acciones rápidas) — APLICADA Y DESPLEGADA

Pedido explícito: filtros rápidos, distinguir Prospectos CRM de "pendiente
de instalación", mejorar la tabla (servicios, abrir ficha desde el
nombre, menos exposición del botón Eliminar), accesos rápidos a
servicio/Alta. Solo se tocó `ClientesView.vue` — sin tablas, columnas,
estados ni rutas nuevas.

- **Hallazgo real antes de implementar** (confirmado en producción, solo
  lectura): `clients.status` es un campo editado a mano por el staff, sin
  ninguna transición automática — existen clientes reales con
  `status='prospect'` cuya instalación ya está `completed` (ej. Luis
  Romero León, el mismo cliente real usado para verificar 13r) u otros
  con `status='active'` que además tienen una segunda Alta `scheduled`
  abierta (ej. Miler Sanchez Cesias — cliente activo pidiendo una segunda
  línea). Confiar solo en `clients.status` para "pendiente de
  instalación" habría mostrado a Luis Romero como pendiente estando
  realmente activo. Por eso el filtro y la etiqueta de estado se calculan
  cruzando `clients.status` con sus `installations` reales, no solo
  leyendo el campo tal cual.
- **Punto 1 (filtros rápidos)**: Todos / Activos / Pendientes de
  instalación / Suspendidos / Con múltiples servicios — mismo patrón de
  botones ya usado en `HistoricoAtendidosView.vue` (`QUICK_FILTER_TABS`).
  Se combinan con la búsqueda de texto existente (el filtro acota la
  lista primero, la búsqueda filtra ese subconjunto).
  - Activos: `clients.status === 'active'`.
  - Pendientes de instalación: tiene al menos una `installations` con
    status `pending`/`scheduled`/`in_progress` — **no** se basa en
    `clients.status` (ver hallazgo arriba).
  - Suspendidos: `clients.status === 'suspended'`.
  - Con múltiples servicios: `contractsByClient.get(id).length >= 2`
    (índice ya existente en el archivo, reusado tal cual).
- **Punto 2 (diferenciar Prospectos CRM / pendiente de instalación /
  activos)**: la tabla de Prospectos CRM (`prospects`) no se tocó, sigue
  totalmente aparte. Nueva función `clientDisplayStatus(c)`: si
  `status==='prospect'` Y tiene una Alta abierta, la etiqueta mostrada es
  "Pendiente de instalación" (en vez de "Prospecto", que confundía con el
  CRM) — **no se inventa un estado nuevo**, `clients.status` en la base
  sigue siendo literalmente `'prospect'`, esto solo cambia la etiqueta
  visible. Si no tiene Alta abierta, se muestra la etiqueta real tal cual
  (`Prospecto`/`Activo`/`Suspendido`/`Baja`) — no se oculta ni se inventa
  nada para los casos ambiguos (ej. Jhojania Mantilla, `status='prospect'`
  sin ninguna instalación, sigue mostrando "Prospecto").
- **Punto 3 (tabla)**: "Nombre" ya abría la ficha (sin cambios, ya
  cumplía). Columna "Servicios" ahora resalta con badge cuando son 2+
  (antes solo mostraba el número). "Eliminar" se des-enfatizó
  visualmente (gris, se resalta en rojo solo al pasar el mouse) — sigue
  pidiendo confirmación nativa igual que antes (`handleDelete`, sin
  tocar), solo cambia qué tan expuesto se ve en la fila.
- **Punto 4 (accesos rápidos, rutas reales existentes, ninguna
  inventada)**: "📋 Alta" → `/soporte/instalaciones/:id` (la instalación
  abierta si hay una, si no la más reciente — así también sirve para
  revisar una Alta ya cerrada). "🛠 Servicio" → `/clientes/:id/servicios/
  :contractId`, solo cuando el cliente tiene exactamente 1 contrato (con
  2+ es ambiguo cuál mostrar, se deja que entre por la ficha general).
  Ambos usan rutas que ya existían en `router/index.ts`, sin crear
  ninguna.
- **Restricciones respetadas**: no se tocó Supabase/RLS/contratos/
  facturación/inventario (archivo único modificado:
  `src/views/clientes/ClientesView.vue`, el único store tocado fue
  agregar `installationsStore.fetchInstallations()` — ya importado,
  ahora también se lee, no solo se usa para crear). El flujo de
  conversión de prospecto (`handleSubmit`/`openCreate`/`openEdit`) no se
  tocó ni una línea.
- **Validado**: `vue-tsc -p tsconfig.app.json` limpio. Sin pruebas SQL
  nuevas — no se tocó Supabase/RLS/triggers, es una vista derivada 100%
  de datos ya cargados en el frontend. Visual en local (misma Supabase de
  producción, solo lectura) — confirmado con datos reales: "Pendientes de
  instalación" muestra exactamente 3 (Cesar Valverde, Angel Chávez,
  Miler Sanchez) y **excluye correctamente a Luis Romero León**
  (`status='prospect'` pero instalación `completed`); "Con múltiples
  servicios" + búsqueda combinados muestran exactamente a Jessica Aurora
  Cardoso (3 servicios); accesos rápidos "Alta"/"Servicio" aparecen solo
  cuando corresponde. Sin escrituras de prueba.
- Archivo: `src/views/clientes/ClientesView.vue` (único).
- **Commiteado y pusheado, NO desplegado** — pendiente de autorización
  explícita. No requiere migración (no se tocó Supabase).

### 13s.1 — Desplegada (pedido explícito del usuario)

- **Destino verificado**: VM `192.168.55.201` en `e2254ce` (limpia, sana).
  Sin migración (esta fase no toca Supabase).
- **Respaldo**: `rollback-20261012175424` antes de reconstruir.
- **Desplegado**: `bash deploy/update.sh` — git pull `e2254ce`→`38e553f`.
  VM confirmada en `38e553f`, 5 contenedores `Up`/healthy, `/login`
  responde 200.
- **Verificado en producción, solo lectura, con datos reales**:
  - "Pendientes de instalación": **3 de 305** — Cesar Valverde Reyes,
    Angel Chávez Velasquez, Miler Sanchez Cesias — excluye correctamente
    a Luis Romero León (mismo resultado que en local).
  - "Con múltiples servicios" + búsqueda "Jessica" combinados: **1 de
    305** — Jessica Aurora Cardoso (3 servicios).
  - Clic real en "📋 Alta" de Cesar Valverde Reyes → navegó
    correctamente a `/soporte/instalaciones/4c308c56-...` (su orden real,
    "Programada").
  - Sin modificar ningún dato real ni otro módulo.

## 13t. Fase 154 — ajustes puntuales de Clientes (estado vs. instalación, PPPoE plegado) — RESUELTO, pendiente de desplegar

Pedido del usuario: distinguir visualmente el estado del cliente del
estado de instalación (sin tocar Supabase), mantener los filtros de 13s
intactos, plegar "Usuarios PPPoE sin contrato" por defecto, conservar
acciones y compatibilidad móvil. Alcance acotado a
`src/views/clientes/ClientesView.vue`, sin migración.

- **Punto 1 — estado del cliente vs. estado de instalación**:
  `clientDisplayStatus()` (13s) reemplazaba la etiqueta de `clients.status`
  por "Pendiente de instalación" cuando era `'prospect'` + Alta abierta —
  eso ocultaba el estado real del cliente. Ahora `clientDisplayStatus()`
  siempre devuelve la etiqueta real (`STATUS_LABEL[c.status]`) y se agregó
  `pendingInstallLabel()`, un badge independiente "📋 Alta pendiente" que
  aparece junto al de estado (no lo reemplaza) cuando
  `hasOpenInstallation(c.id)` es verdadero — sin importar si
  `c.status` es `'prospect'` o ya quedó en `'active'` sin actualizar a
  mano. Verificado en datos reales (ver abajo): Cesar Valverde Reyes y
  Angel Chávez Velasquez muestran "Prospecto" + "📋 Alta pendiente"; Miler
  Sanchez Cesias muestra "Activo" + "📋 Alta pendiente" — los tres casos
  reales que motivaron este cambio. Ningún estado se escribe en Supabase,
  es solo presentación.
- **Punto 2 — filtros**: sin cambios en `quickFilter` ni en
  `filteredClientsList` (siguen usando `hasOpenInstallation` como en 13s).
  Verificado que "Pendientes de instalación" sigue devolviendo los mismos
  3 clientes.
- **Punto 3 — "Usuarios PPPoE sin contrato" plegado**: nuevo
  `showUnlinkedSection = ref(false)` con botón "Mostrar ▼"/"Ocultar ▲" en
  la cabecera de la tarjeta; el contenido (selector de router, tabla,
  nota) queda dentro de un `<template v-if="showUnlinkedSection">`. No se
  tocó `loadUnlinked()` ni el auto-select del primer router en
  `onMounted` — la sección sigue cargando los mismos datos una vez
  expandida, solo cambia la visibilidad inicial.
- **Punto 4 — acciones y móvil**: `handleDelete`, `openEdit`, `openCreate`,
  los accesos rápidos "📋 Alta"/"🛠 Servicio" y el layout
  `table-shell`/`min-w-[720px]` con scroll horizontal quedaron intactos —
  no se tocó compatibilidad móvil ni ninguna acción existente.

**Pruebas**:
- `npx vue-tsc -p tsconfig.app.json --noEmit` → limpio, sin errores.
- Verificación visual local (`pm2 start smartrayco-web smartrayco-api`,
  contra Supabase de producción, solo lectura): filtro "Pendientes de
  instalación" (3 de 306) muestra los badges dobles correctos para los 3
  clientes reales mencionados arriba; "Usuarios PPPoE sin contrato" carga
  colapsado con "Mostrar ▼"; al expandir, el selector de router y la
  tabla aparecen igual que antes (13s). `pm2 stop` después de verificar.

**Commit**: `b76034c` (pusheado a `origin/main`). Sin migración.

### 13t.1 — Desplegada (pedido explícito del usuario)

- **Destino verificado**: VM `192.168.55.201` en `38e553f` (limpia, sana).
  Sin migración (esta fase no toca Supabase).
- **Respaldo**: `rollback-20261012180651` antes de reconstruir.
- **Desplegado**: `bash deploy/update.sh` — git pull `38e553f`→`2967782`.
  VM confirmada en `2967782`, contenedores `frontend`/`backend` `Up`,
  `/login` responde 200.
- **Verificado en producción, solo lectura, con datos reales**:
  - "Pendientes de instalación": **3 de 306**, mismos tres clientes de
    13s — ahora cada uno muestra dos badges independientes: Cesar
    Valverde Reyes y Angel Chávez Velasquez → "Prospecto" + "📋 Alta
    pendiente"; Miler Sanchez Cesias → "Activo" + "📋 Alta pendiente".
  - "Usuarios PPPoE sin contrato" carga colapsado con "Mostrar ▼" en la
    carga inicial de la vista.
  - Sin modificar ningún dato real ni otro módulo.

## 13u. Fase 155 — corregir conteo de ocupación de cajas NAP — RESUELTO, pendiente de desplegar

Reporte del usuario: la caja **NAP - 01** (zona **PON 2 - SM**) mostraba
**8/16** en Clientes → Detalle de servicio → Ubicación, pero físicamente
solo había **3 clientes conectados**.

**Causa raíz confirmada con SQL de solo lectura contra producción**:
`fo_nap_puertos.client_id` y `.contract_id` tienen FK `ON DELETE SET
NULL` hacia `clients`/`service_contracts` (confirmado en
`information_schema`). Cuando se elimina un cliente o un contrato, la fila
del puerto NAP se queda con `client_id`/`contract_id = null`, pero **nada
resetea `estado` de vuelta a `'libre'`** — no hay trigger de `DELETE` en
`clients` ni en `service_contracts` que lo haga (confirmado:
`information_schema.triggers` solo tiene triggers de `UPDATE`/`INSERT` en
esas tablas). El puerto queda "fantasma": `estado='ocupado'` para
siempre, sin dueño.

**Los 8 registros contados en NAP - 01** (consulta real, antes de la
corrección): puerto 1 → cliente "oficina ofi" (CTR-2026-00073, activo);
puertos 2 a 6 → **5 filas fantasma**, `estado='ocupado'` pero
`client_id`/`contract_id = null` (creadas 2026-10-01 a 2026-10-06, antes
de que existiera el asignador transaccional de Fase 2/`fase136*` del
2026-10-09 — residuo de pruebas o asignaciones manuales anteriores cuyo
cliente fue borrado después); puerto 7 → "prueba zava" (CTR-2026-00214,
activo); puerto 8 → "gloria rayco villarreal" (CTR-2026-00295, activo). Un
9no puerto ("sala sala", CTR-2026-00296) se asignó el 2026-10-10 23:15,
probablemente después de la captura del reporte (8 coincide exacto con
1+5+1+1, sin ese 9no). Sin duplicados de `contract_id` ni contratos
cancelados/suspendidos con puerto `ocupado` en todo el sistema
(verificado con SQL agregado).

**Los 3 clientes realmente conectados — NO se pudo confirmar con certeza
solo con la base de datos**: los únicos 3 puertos con `client_id` +
`contract_id` reales al momento del reporte (oficina ofi, prueba zava,
gloria rayco villarreal) coinciden en cantidad (3) con lo que el
administrador vio en campo, pero **sus nombres no parecen clientes
reales** — "oficina ofi", "prueba zava" y el DNI de "gloria rayco
villarreal" es `00000032` (correlativo, no un documento real) con plan
"DE SANDRO O MICHEL" — todo sugiere datos de prueba o internos nunca
limpiados, no necesariamente los 3 clientes físicos reales. **Dato que
debe confirmar el administrador**: (1) si esos 3 registros son clientes
reales facturables o cuentas de prueba/oficina que deberían eliminarse
(y si se eliminan, sus puertos quedarán fantasma igual que los 5
anteriores — ver corrección aplicada abajo, que sí los libera); (2) qué
es el 4to registro "sala sala" (CTR-2026-00296, agregado el 2026-10-10)
— una instalación reciente aún no visitada, u otra prueba.

**Corrección aplicada (solo código, sin migración, sin tocar clientes/
contratos/puertos)**: el cálculo de ocupación en
`src/views/clientes/ClientServiceDetailView.vue`,
`src/views/instalaciones/InstalacionDetailView.vue`,
`src/views/olt/AuthorizeOnuModal.vue` y `src/views/mapa/ClientesMapView.vue`
contaba **cualquier** fila `estado='ocupado'`, incluyendo las fantasma.
Las Fase 139/139b ya habían corregido este mismo cálculo en
`CampoTrabajoDetailView.vue`/`ZonasView.vue` (exigiendo también
`client_id`), pero la corrección nunca se replicó a las otras 4 vistas —
inconsistencia real confirmada entre pantallas. Se extrajo el criterio a
una función compartida `countOcupadosReales()` en nuevo archivo
`src/lib/napOccupancy.ts` (cuenta solo `estado==='ocupado' && client_id`)
y las 6 vistas (las 4 con el bug + las 2 que ya lo tenían bien) ahora la
usan, para que no se repita esta misma inconsistencia a futuro. La
corrección es **autocurativa**: no requiere limpiar las filas fantasma
existentes en la base — ignora cualquier puerto `ocupado` sin
`client_id`, pasado o futuro, sin escribir nada en Supabase.

**Impacto verificado en TODA la base de producción (solo lectura)**: de
~95 cajas NAP, solo 3 tenían filas fantasma — NAP - 01 (9→4), NAP - SM -
02 (2→1) y "nap 8"/PON 7-SS (3→2). Las ~92 cajas restantes no cambian
(diferencia 0), confirmado con SQL agregado comparando conteo
anterior/nuevo por caja.

**Pruebas**:
- Nuevo `src/lib/__tests__/napOccupancy.test.ts` (4 casos, incluye el
  caso real de NAP - 01: 9 filas ocupado → 4 reales) — `npm run
  test:fetch-timeout` (corre todo `src/lib/__tests__/*.test.ts`): **31/31
  pasan**, incluidas las pruebas ya existentes de `napAssignment.test.ts`
  (RPC de reserva, sin relación con este cambio, sin regresión).
- `npx vue-tsc -p tsconfig.app.json --noEmit` → limpio.
- Verificación visual local (solo lectura, contra Supabase de
  producción): `ClientServiceDetailView.vue` → servicio de "gloria rayco
  villarreal" (CTR-2026-00295) muestra "Caja NAP: NAP - 01 — **4/16**"
  (antes mostraba el valor inflado). `ZonasView.vue` (ya corregido desde
  13n/Fase 139) muestra exactamente los mismos 4 clientes para NAP - 01
  y coincide con NAP - SM - 02 en 1/16 — confirma coherencia entre
  pantallas. No se guardó ningún cambio (no se tocó "Guardar cambios").

**Archivos modificados**: `src/lib/napOccupancy.ts` (nuevo),
`src/lib/__tests__/napOccupancy.test.ts` (nuevo),
`src/views/clientes/ClientServiceDetailView.vue`,
`src/views/instalaciones/InstalacionDetailView.vue`,
`src/views/olt/AuthorizeOnuModal.vue`, `src/views/mapa/ClientesMapView.vue`,
`src/views/campo/CampoTrabajoDetailView.vue` (refactor sin cambio de
comportamiento, usa la misma función compartida).

**Riesgos residuales**: si el administrador confirma que "oficina ofi" /
"prueba zava" / "gloria rayco villarreal" / "sala sala" son cuentas de
prueba y las elimina, sus puertos NAP quedarán libres automáticamente en
el conteo (sin acción adicional) — pero **no quedan libres físicamente**
en la caja real hasta que un técnico confirme que no hay un
ONT/equipo conectado en ese puerto. Este fix corrige el **conteo**, no
reemplaza la verificación física.

**Pendiente para una fase separada (no incluido en 13u)**: prevenir que
se vuelvan a crear puertos NAP fantasma cuando se elimine un cliente o un
contrato — por ejemplo un trigger de `DELETE` en `clients`/
`service_contracts` que, además de la FK `ON DELETE SET NULL` ya
existente, resetee `estado='libre'` en `fo_nap_puertos` cuando
`client_id`/`contract_id` queden en null. Hoy el conteo ya los ignora
(13u), pero la fila fantasma sigue existiendo en la base con
`estado='ocupado'` — correcto para lo pedido (no liberar nada sin
autorización), pero deja la causa raíz sin cerrar del todo. Evaluar en
una fase propia, con su propia migración y aprobación explícita.

### 13u.1 — Desplegada (pedido explícito del usuario, solo este commit)

- **Destino verificado**: VM `192.168.55.201` en `2967782` (limpia, sana).
  Sin migración (esta fase no toca Supabase).
- **Respaldo**: `rollback-20261012182252` antes de reconstruir.
- **Desplegado**: `bash deploy/update.sh` — git pull `2967782`→`6bfdc42`.
  VM confirmada en `6bfdc42`, contenedores `frontend`/`backend` `Up`,
  `/login` responde 200.
- **Verificado en producción, solo lectura**: NAP - 01 (PON 2 - SM)
  muestra **4/16**, no 3/16 — `Operaciones → Zonas` y `Clientes →
  Detalle de servicio ("gloria rayco villarreal") → Ubicación` coinciden
  exactos, mismos 4 clientes (oficina ofi, prueba zava, gloria rayco
  villarreal, sala sala). El fix funciona correctamente: ya **no** cuenta
  las 5 filas fantasma (puertos 2–6, antes incluidas en el 8/9 original).
  La diferencia frente a los "3 clientes físicos" reportados por el
  usuario es el registro "sala sala" (CTR-2026-00296), asignado el
  2026-10-10 23:15 — posterior, según todo indica, a la captura del
  reporte original de 8/16 — **sigue pendiente de confirmar con el
  administrador** (ver "Dato que debe confirmar el administrador" en
  13u): si es una instalación real reciente o si también debe tratarse
  como prueba. No se liberaron los puertos 2–6, no se eliminó ningún
  cliente/contrato/equipo, no se guardó ningún formulario durante la
  verificación.

## 13v. Fase 156 — prevenir puertos NAP fantasma a futuro — APLICADA EN SUPABASE (sin cambios de frontend que desplegar)

Confirmado por el administrador (cierre de Fase 155): los 4 clientes de
NAP - 01 (oficina ofi, prueba zava, gloria rayco villarreal, sala sala)
son reales — el contador 4/16 es correcto. **No se vuelve a investigar
eso aquí.**

**Causa raíz** (ya confirmada en Fase 155, no se repite la auditoría):
`fo_nap_puertos.client_id`/`.contract_id` tienen FK `ON DELETE SET NULL`
hacia `clients`/`service_contracts`, pero ningún trigger de `DELETE`
existía en esas tablas para resetear `estado` a `'libre'` — el puerto
queda `'ocupado'` sin dueño para siempre.

**Corrección preparada (migración `20261012190000_fase156_prevenir_puertos_nap_fantasma.sql`,
NO aplicada)** — dos triggers `BEFORE DELETE`, mínimos, sin tocar ninguna
definición previa:
1. `trg_service_contracts_free_nap_puerto` (en `service_contracts`):
   libera (`estado='libre'`, `client_id`/`contract_id=null`) el puerto
   cuyo `contract_id` coincide con el contrato que se borra. Cubre tanto
   borrar un solo contrato de un cliente con varios servicios (conserva
   el puerto de los OTROS) como el borrado en cascada de todos los
   contratos al eliminar el cliente (`service_contracts.client_id` es
   `ON DELETE CASCADE`, dispara este trigger una vez por cada contrato
   cascadeado).
2. `trg_clients_free_nap_puerto` (en `clients`): libera el puerto ligado
   solo al `client_id` (sin `contract_id` — caso ambiguo de cliente
   multi-servicio, ver comentario de `FoNapPuerto.contract_id` en
   `src/types/domain.ts`), que el trigger de contratos no alcanzaría.
   Corre antes de que el cliente se borre y antes de la cascada hacia sus
   contratos, sin solaparse con el otro trigger.

`BEFORE DELETE` (no `AFTER`) a propósito: la FK `ON DELETE SET NULL` de
Postgres es un trigger de sistema `AFTER DELETE`; si el nuestro también
fuera `AFTER`, el orden de ejecución frente al de sistema no está
garantizado. Con `BEFORE DELETE` nuestro código siempre corre primero,
mientras `client_id`/`contract_id` en `fo_nap_puertos` todavía coinciden
con el id que se está borrando. Solo se tocan puertos `estado='ocupado'`
(uno `'reservado'`/`'dañado'` con la misma referencia no se toca). Deja
rastro en `notes` (se agrega, nunca se borra una nota manual existente)
con qué cliente/contrato lo liberó y cuándo — para que no vuelva a pasar
la confusión de Fase 155.

**Restricción 3 cumplida explícitamente**: esta migración **no toca** los
5 puertos fantasma 2–6 de NAP - 01 identificados en Fase 155 (ni ningún
otro ya existente) — es puramente preventiva hacia adelante, sin
backfill ni UPDATE sobre datos existentes. Verificado con un test
dedicado (ver abajo) que un puerto fantasma ya existente permanece
intacto ante cualquier DELETE.

**Pruebas (aisladas, Postgres real en Docker, sin tocar producción)**:
nuevo `server/tests/napPhantomPorts.sql.test.ts` (`npm run
test:nap-phantom-sql`), mismo patrón que `napAssignment.sql.test.ts` —
carga el fixture `napSchema.sql` existente, alinea sus reglas de borrado
con las REALES de producción (`ON DELETE CASCADE`/`SET NULL`,
confirmadas en Fase 155) y aplica la migración nueva. **8/8 pasan**:
- Borrar un contrato libera solo su puerto; el de otro contrato/cliente
  queda intacto.
- Borrar un cliente cascadea a sus contratos y libera cada puerto
  propio, sin tocar el de otro cliente.
- Un puerto ligado solo al cliente (sin contrato) también se libera al
  borrar el cliente.
- Cliente con 2 servicios: borrar solo uno conserva el puerto del otro
  (requisito explícito de esta fase).
- Un puerto `'reservado'`/`'dañado'` con la misma referencia no se toca.
- Una nota manual existente se conserva, no se sobreescribe.
- Un puerto fantasma YA existente (client_id/contract_id ya null, estilo
  Fase 155) no se toca con ningún DELETE — confirma la restricción 3.
Se confirmó además que `napAssignment.sql.test.ts` (10/10) sigue
pasando sin cambios — el fixture compartido `napSchema.sql` no se tocó.

**Rollback preparado**: `supabase/rollback/fase156_rollback.sql` — quita
los 2 triggers y las 2 funciones (Fase 156 solo agrega objetos nuevos, no
modifica ninguno existente; revertir no borra ni toca ningún dato).

**Archivos**: `supabase/migrations/20261012190000_fase156_prevenir_puertos_nap_fantasma.sql`
(nuevo, no aplicado), `supabase/rollback/fase156_rollback.sql` (nuevo),
`server/tests/napPhantomPorts.sql.test.ts` (nuevo), `package.json`
(nuevo script `test:nap-phantom-sql`). Sin cambios de frontend.

**Riesgos residuales**:
- Los 5 puertos fantasma 2–6 de NAP - 01 (y cualquier otro ya existente
  de antes de esta fase) siguen `'ocupado'` sin dueño en la base — esta
  fase deliberadamente no los toca (restricción 3). Limpiarlos requiere
  una decisión aparte del administrador (fase separada, con su propia
  autorización).
- Si en el futuro se agrega otra tabla con FK hacia `clients`/
  `service_contracts` que también pueda dejar un puerto NAP "fantasma"
  por una vía distinta a estas dos tablas, estos triggers no la cubren
  (hoy `fo_nap_puertos` solo referencia `client_id`/`contract_id`
  directamente, no hay vía indirecta conocida).

### 13v.1 — Migración aplicada a Supabase de producción (pedido explícito del usuario, solo esta migración)

Antes de aplicar se verificó: commit `bbf9dda` (migración) +
`db12261` (2 pruebas adicionales pedidas) igual a `origin/main`, archivo
de migración sin diferencias respecto al commit aprobado (`git diff`
vacío); rollback preparado y revisado
(`supabase/rollback/fase156_rollback.sql`, solo quita objetos nuevos, no
toca datos); migración puramente aditiva (`CREATE OR REPLACE FUNCTION`
+ `CREATE TRIGGER`, ninguna sentencia `ALTER`/`DROP` sobre objetos
existentes ni `UPDATE`/`DELETE` de datos) — riesgo de reversión bajo.

Se agregaron 2 pruebas pedidas antes de aplicar (ahora 10/10 en
`napPhantomPorts.sql.test.ts`): una eliminación que falla por otra
restricción (simulada) después de que el trigger ya corrió, y un
`ROLLBACK` explícito de transacción — ambas confirman que el puerto
**no** queda liberado a medias; todo se deshace junto.

- **Aplicada** vía `apply_migration` (Supabase), registrada como
  `20261012191318_fase156_prevenir_puertos_nap_fantasma` en
  `supabase_migrations.schema_migrations`.
- **Verificado con SQL de solo lectura**: ambos triggers instalados
  (`trg_service_contracts_free_nap_puerto` BEFORE DELETE en
  `service_contracts`, `trg_clients_free_nap_puerto` BEFORE DELETE en
  `clients`, confirmado contra `information_schema.triggers`).
  NAP - 01 (`8c5a7d1f-5574-4e34-b897-81fe3c8296c6`) comparado byte a
  byte antes/después: **idéntico** — los 4 puertos reales (1, 7, 8, 9,
  con su `client_id`/`contract_id` intactos) y los 5 puertos fantasma
  2–6 (`estado='ocupado'`, `client_id`/`contract_id = null`) sin ningún
  cambio. No se ejecutó ninguna eliminación de prueba en producción.
- **No se desplegó frontend** (esta fase no tiene cambios de frontend) —
  nada que desplegar. Ningún otro módulo tocado.
- **Pendiente** (sin cambios desde 13v): limpiar los 5 puertos fantasma
  2–6 de NAP - 01, decisión aparte del administrador en una fase
  separada.

## 13w. Fase 150b — INCIDENCIA CRÍTICA: técnicos no podían cerrar Rutinas ni Altas — RESUELTO Y APLICADO EN SUPABASE

Reporte del usuario (captura de App de Campo): al pulsar "Completar
rutina", error visible en pantalla `invalid input value for enum
routine_status: "resolved"`. Pidió suspender Fase 157 y tratar esto como
prioridad absoluta — investigar Rutinas y Altas, sin tocar OLT/MikroTik/
PPPoE/facturación, sin cerrar órdenes reales para probar, sin aplicar
nada sin autorización.

**Causa raíz — UNA SOLA, cubre Rutinas Y Altas a la vez** (confirmada,
no es una suposición): `public.track_job_work_session()` (Fase 150,
`20261012140000_fase150_sesiones_trabajo.sql`) es la MISMA función
registrada en 3 triggers — `tickets`, `installations`, `routines`. Su
lógica para cerrar una sesión de trabajo tiene:

```sql
when new.status in ('completed', 'resolved', 'closed') then 'finished'
```

`new.status` es de un **enum distinto según la tabla** que dispare el
trigger. Confirmado contra `pg_enum` en Supabase de producción:
- `ticket_status`: open, in_progress, rescheduled, **resolved**,
  **closed**.
- `installation_status`: pending, scheduled, in_progress, completed,
  cancelled — **sin resolved/closed**.
- `routine_status`: pending, scheduled, in_progress, completed,
  cancelled — **sin resolved/closed**.

Para evaluar el `IN`, Postgres necesita castear CADA literal al tipo de
`new.status`. En `installations`/`routines` eso falla de inmediato
porque `'resolved'`/`'closed'` no existen en esos dos enums — el error
salta apenas una orden sale de `'in_progress'` hacia **cualquier**
estado (no solo `'completed'`), rompiendo tanto "Completar rutina"
(Rutinas) como "Completar instalación" (Altas) por igual, desde que se
aplicó Fase 150. `tickets` nunca mostró el error porque `ticket_status`
sí tiene esos dos valores.

**Rutinas**: `CampoTrabajoDetailView.vue`/`stores/campo.ts` ya enviaban
el estado correcto (`'completed'`, válido para `routine_status`) — el
frontend NO tiene el bug. El error ocurre dentro del trigger de Supabase
al procesar ese UPDATE, antes de que exista ninguna fila nueva — por
eso la rutina queda intacta en `'in_progress'` (el UPDATE completo se
revierte), fotos/firma/observaciones YA se habían guardado en pasos
previos (ver abajo), y el botón se puede reintentar sin duplicar nada
una vez aplicado el fix.

**Altas**: mismo diagnóstico — `installationsStore.updateStatus(id,
'completed')` ya era correcto, mismo trigger compartido, mismo error
("invalid input value for enum installation_status..."), mismo arreglo.
No se encontró ningún bloqueo adicional ni distinto en el flujo de
Completar instalación (materiales, equipos serie/MAC, evidencias,
firma) — no era necesario investigar más, un solo trigger explica
ambos casos.

**Por qué las pruebas aisladas de Fase 150 no lo detectaron antes de
desplegar**: `server/tests/jobWorkSessionsSchema.sql` (el fixture de
`jobWorkSessions.sql.test.ts`) declaraba `tickets/installations/
routines.status` como `text` + `CHECK`, no como los ENUM reales de
producción — una comparación `text in (...)` nunca intenta castear
nada, así que la suite pasaba en verde aunque el código real rompiera.
Corregido como parte de este fix (ver Archivos) para que sea un
fixture fiel a producción — confirmado que, sin el fix de la función,
la suite corregida SÍ reproduce el error real exacto
(`invalid input value for enum ticket_status/installation_status:
"completed"`, reproducido en esta sesión antes de aplicar el parche).

**Corrección mínima** (migración nueva
`20261012200000_fase150b_fix_track_job_work_session_enum.sql`, **no
aplicada**): `CREATE OR REPLACE` de la misma función, cambiando
`new.status in (...)` por `new.status::text in (...)` — compara como
texto plano, sin intentar castear ningún literal al enum de la tabla.
No cambia ninguna otra lógica (misma detección de entrada/salida de
`in_progress`, mismo `cancelled_order`/`paused`), no toca los triggers
(siguen apuntando a la misma función), no toca ningún enum ni ninguna
tabla de datos.

**Duplicados/cierres parciales al reintentar** (verificado, sin
cambios necesarios): `performClosureSubmit()` en `stores/campo.ts` ya
es idempotente para fotos (`alreadyUploaded`, comentario explícito de
un fix anterior) y usa `upsert` para `work_order_closures` — un
reintento tras este error no duplica evidencia ni firma. El cambio de
estado final es atómico (el `UPDATE` que falla se revierte entero), así
que la orden nunca queda "a medias". Única observación preexistente,
NO introducida por este bug ni corregida en esta fase (fuera del
alcance de "corrección mínima urgente"): las fotos de equipo
(`equipmentPhotos`, Fase 105) no tienen el mismo chequeo de
`alreadyUploaded` — un reintento podría agregar una entrada de galería
duplicada. Se deja documentado como pendiente menor, no bloquea el
cierre.

**Pruebas (aisladas, Postgres real en Docker, sin tocar producción)**:
- `server/tests/jobWorkSessionsSchema.sql` corregido a enums reales.
- `server/tests/jobWorkSessions.sql.test.ts`: **16/16 en verde** con el
  fix cargado (antes: reproducido el error exacto sin el fix, con el
  fixture ya corregido). Incluye 2 pruebas nuevas que exercitan
  exactamente el escenario del incidente: "rutina completada cierra con
  end_reason=finished" y "rutina cancelada cierra con
  cancelled_order" — ambas sobre `routine_status`, el enum del
  reporte original.
- Confirmado que Averías (tickets) sigue funcionando: "terminar con
  éxito cierra la sesión con end_reason=finished" (usa `'resolved'`,
  válido en `ticket_status`) sigue en verde, sin cambios de
  comportamiento.
- Verificado que Fase 137 (`test:single-active-job-sql`, 14/14) y Fase
  151 (`test:closed-orders-sql`, 20/20) siguen pasando sin ningún
  cambio — este fix no los toca, se corrieron para descartar
  regresión cruzada antes de entregar.

**Archivos modificados**:
`supabase/migrations/20261012200000_fase150b_fix_track_job_work_session_enum.sql`
(nuevo, no aplicado), `supabase/rollback/fase150b_rollback.sql` (nuevo,
restaura el texto literal de Fase 150 — esa versión SI tiene el bug,
solo para revertir si este fix causara algo inesperado),
`server/tests/jobWorkSessionsSchema.sql` (enums reales en vez de
text+check), `server/tests/jobWorkSessions.sql.test.ts` (carga la
migración del fix + 2 pruebas nuevas). **Sin cambios de frontend** — el
bug estaba enteramente en Supabase, nada que desplegar en la VM.

**¿Requiere migración o despliegue?** Requiere **únicamente aplicar la
migración en Supabase** (`CREATE OR REPLACE FUNCTION`, aditiva, no
toca datos ni otros objetos). **No requiere desplegar frontend** — cero
archivos de `src/` cambiaron.

### 13w.1 — Migración aplicada a Supabase de producción (pedido explícito del usuario, incidencia crítica)

- **Verificado antes de aplicar**: commit `d9e4211` = `origin/main`,
  sin diferencias locales.
- **Aplicada** vía `apply_migration`, registrada como
  `20261012192807_fase150b_fix_track_job_work_session_enum` en
  `supabase_migrations.schema_migrations`.
- **Verificado con SQL de solo lectura**: código fuente de
  `public.track_job_work_session()` confirmado con `new.status::text
  in (...)` (el cast correcto) vía `pg_proc.prosrc`. Los 3 triggers
  (`trg_track_work_session` en `tickets`/`installations`/`routines`)
  siguen intactos — la migración solo reemplazó la función, no tocó
  ningún trigger.
- **No se tocó ningún dato real**: no se insertó, actualizó ni cerró
  ninguna orden (ticket/instalación/rutina) real para probar — la
  verificación se hizo enteramente con la suite aislada en Docker
  (16/16) antes de aplicar, más la lectura del código ya instalado
  después.
- **CONFIRMADO EN CAMPO por el usuario** (2026-10-12, mismo día): un
  técnico cerró una Rutina/Alta real sin el error. **Incidencia
  cerrada.**
- **Sin despliegue de frontend** — no había cambios de `src/`.

## 13x. Fase 157 — simplificación mínima del control NAP (Operaciones → Zonas) — APLICADA Y DESPLEGADA

Aclaración del propietario: `Operaciones → Zonas` ya muestra caja NAP +
abonados + capacidad, no crear otra pantalla. El "código Drop" es el
código de cliente del cintillo (no un inventario aparte). No hace falta
controlar el puerto individual — solo caja, abonados y capacidad.

**Investigación dirigida (sin repetir auditorías ya hechas en 155/156/
150b)**:

1. **¿El conteo depende de `fo_nap_puertos` o de contratos?** De
   `fo_nap_puertos` — `ZonasView.vue`/`buildNap()` filtra filas
   `estado='ocupado' && client_id` y las cuenta/lista una por una (por
   fila de puerto, no por contrato).
2. **¿Puede haber duplicados?** El asignador transaccional
   (`assign_provisioning_nap`, Fase 2/136) nunca deja 2 puertos
   `ocupado` para el mismo `contract_id` — libera el anterior en la
   misma transacción. Pero `SpliceDiagramModal.vue` (Mapa de Red >
   Puertos de cliente) permite asignar un cliente/contrato a un puerto
   a mano, vía `upsertNapPuerto()`, **sin** esa misma protección — en
   teoría podría dejar al mismo contrato en 2 puertos de una vez.
   Verificado contra producción (solo lectura): **hoy no existe ningún
   caso así** (`contract_id` repetido con `estado='ocupado'` → 0
   filas). Es un riesgo teórico, no un bug visible actualmente.
3. **Cómo se guarda y conserva la asociación NAP de un servicio**:
   siempre vía `fo_nap_puertos` (client_id + contract_id en la fila del
   puerto), escrita por `assign_contract_nap`/`assign_provisioning_nap`.
   Al completar una Alta, `performClosureSubmit()` en `stores/campo.ts`
   llama `fibra.assignContractToNap(...)` **antes** de marcar la
   instalación `completed` — la asociación queda persistida en la
   misma caja/contrato de forma durable, no se pierde ni se
   recalcula luego.
4. **¿Se exige elegir un puerto individual en una Alta nueva?** No, en
   ningún flujo (Panel Web `InstalacionDetailView.vue`, App de Campo
   `CampoTrabajoDetailView.vue`, OLT `AuthorizeOnuModal.vue`): el
   selector siempre es por CAJA (`<select v-model="napId">`), nunca por
   número de puerto — el puerto se asigna automático dentro de
   `assign_provisioning_nap` (primer puerto libre). El número de puerto
   tampoco se muestra en ningún lado de `ZonasView.vue`. **No hacía
   falta ningún cambio para este punto** — ya cumplía la restricción.

**Corrección mínima aplicada** (un solo archivo de pantalla + helper
compartido, sin crear pantallas nuevas, sin tocar diseño ni enlaces):
`ZonasView.vue`/`buildNap()` ahora cuenta y lista **servicios**
(deduplicados por `contract_id`, o por `client_id` cuando el puerto no
tiene contrato ligado — caso ambiguo de cliente multi-servicio), no
filas de puerto sueltas. Nueva función compartida
`serviciosOcupados()` en `src/lib/napOccupancy.ts` (junto a
`countOcupadosReales()`, de Fase 155) — devuelve un puerto
representativo por servicio (el de menor `puerto_numero`, que sigue sin
mostrarse en la UI). Es una corrección **preventiva**: con los datos
reales de hoy el resultado es idéntico al anterior (no hay duplicados
en producción), pero blinda el conteo si `SpliceDiagramModal.vue`
llegara a crear uno. No se tocó ningún otro archivo ni pantalla (Mapa
de Red, Detalle de servicio, Instalaciones, OLT) — siguen usando
`countOcupadosReales()` tal cual, sin cambios, porque hoy producen el
mismo número (no hay nada que corregir ahí) y no eran parte de lo
pedido.

**Archivos modificados**: `src/lib/napOccupancy.ts` (nueva función
`serviciosOcupados()`), `src/lib/__tests__/napOccupancy.test.ts` (4
pruebas nuevas), `src/views/zonas/ZonasView.vue` (usa la función nueva
en `buildNap()`, mismo diseño/enlaces, sin cambios visuales). Ningún
cambio de Supabase — no hay migración en esta fase.

**Pruebas**:
- `src/lib/__tests__/napOccupancy.test.ts` (`npm run test:fetch-timeout`):
  **35/35 en verde** (31 ya existentes + 4 nuevas de
  `serviciosOcupados`: sin duplicados, mismo contrato en 2 puertos
  cuenta una vez, caso ambiguo sin contrato, puertos fantasma/inactivos
  excluidos igual que antes).
- `npx vue-tsc -p tsconfig.app.json --noEmit` → limpio.
- Verificación visual local (solo lectura, contra Supabase de
  producción): `Operaciones → Zonas` → NAP - 01 sigue en **4/16** con
  los mismos 4 clientes (oficina ofi, prueba zava, Gloria Rayco
  Villarreal, sala sala) — idéntico a antes del cambio, como se
  esperaba sin duplicados reales. `Clientes → Detalle de servicio
  (Gloria Rayco Villarreal) → Ubicación` muestra el mismo "NAP - 01 —
  4/16" — **coincide exacto con Zonas**, confirmando el requisito de
  la prueba.
- "Alta nueva conserva su asociación NAP": verificado por revisión de
  código (`performClosureSubmit` llama `assignContractToNap` antes de
  marcar `completed`, vía el mismo RPC transaccional probado en
  `napAssignment.sql.test.ts`, 10/10 — no se repitió esa suite porque
  no se tocó ningún archivo que la afecte) — **no se creó ni cerró
  ninguna Alta real para probar**, por restricción explícita.

**Riesgos**: ninguno nuevo — cambio puramente de lectura/presentación,
no escribe nada en `fo_nap_puertos` ni en ninguna otra tabla. El riesgo
teórico de duplicado vía `SpliceDiagramModal.vue` sigue existiendo en
el ORIGEN (no se tocó esa pantalla, fuera de alcance de "cambios
mínimos") — esta fase solo blinda el CONTEO/listado contra esa
posibilidad, no la previene en la fuente. Si se quisiera cerrar eso
también, sería una fase aparte (agregar la misma protección
transaccional de `assign_provisioning_nap` a la edición manual de
puertos).

**¿Requiere migración o despliegue?** Sin migración (no se tocó
Supabase). Requiere únicamente **desplegar frontend**.

### 13x.1 — Desplegada (pedido explícito del usuario)

- **Destino verificado**: VM `192.168.55.201` en `6bfdc42` (limpia,
  sana). Sin migración (esta fase no toca Supabase).
- **Respaldo**: `rollback-20261012194208` antes de reconstruir.
- **Desplegado**: `bash deploy/update.sh` — git pull `6bfdc42`→`a5c67c4`.
  VM confirmada en `a5c67c4`, contenedores `frontend`/`backend` `Up`,
  `/login` responde 200.
- **Verificado en producción, solo lectura**:
  - `Operaciones → Zonas` → NAP - 01 muestra **4/16** con los 4
    abonados (oficina ofi, prueba zava, Gloria Rayco Villarreal, sala
    sala).
  - Clic en "Gloria Rayco Villarreal" desde Zonas → navegó
    correctamente a su Detalle de servicio (`CTR-2026-00295`) — el
    enlace funciona.
  - `Detalle de servicio → Ubicación` muestra "Caja NAP: NAP - 01 —
    **4/16**" — **coincide exacto con Zonas**.
  - No se modificó ningún puerto, cliente, contrato, inventario, OLT
    ni MikroTik — ningún formulario se guardó durante la
    verificación.

## 13y. Certificación Fase 2 OLT (`fase136*`) — JWT por rol, MikroTik antes/después, modelos ONT — ESTADO ACTUALIZADO (2026-10-13)

Continuación del cierre de certificación de Fase 2 comercial OLT, sin
tocar equipos/clientes reales. Resultado de esta sesión:

- **JWT por rol — CERRADO a nivel de guard de roles**: se agregó un test
  (`server/src/services/__tests__/oltProvisioningRoutes.test.ts`, caso
  "HTTP: read-only endpoints enforce the broader readRole guard...")
  que cubre los endpoints `GET /onts/operations/:opId` y
  `GET /onts/provisioning-operation` con los 6 roles (incluye
  `TECNICO_RED`/`SOPORTE`, que `readRole` admite y `provisionRole` no —
  antes sin cobertura). `npm run test:provisioning`: 58/58 ok. No se
  modificó código funcional (no se encontró defecto; el guard ya
  funcionaba, solo faltaba la prueba).
  - **Sigue pendiente, requiere autorización**: la verificación
    criptográfica real del JWT contra el JWKS de Supabase
    (`requireAuth`) no tiene prueba aislada — necesita usuarios de
    prueba reales por rol, que **no existen hoy** en el proyecto y no
    se crearon (no autorizado). `requireAuth` es genérico y ya corre a
    diario en producción en todas las rutas, por lo que el riesgo
    residual es bajo, no nulo.
- **Comparación MikroTik antes/después — queda documentada como
  PENDIENTE**, condicionada a una instalación de prueba controlada
  (contrato/ONU de prueba, autorización explícita antes de ejecutar).
  La preservación de atributos (perfil, `disabled`, no sobrescritura)
  sigue cubierta solo por simulación (`provisioningMikrotik.test.ts`),
  sin captura real independiente de un MikroTik real.
- **Modelos ONT certificados con hardware real**: únicamente el perfil
  OMCI `GPT-2741GNAC` (seriales `HWTCABD21CB4`, `HWTCE5AFB8B6`, prueba
  de Fase 2 del 2026-10-10). El código no distingue modelos — `onuType`
  es un string opaco que se pasa tal cual a la OLT — por lo que
  cualquier otro perfil queda **pendiente de validación orgánica**: se
  certifica la primera vez que un técnico lo use en una instalación
  real normal (no se fuerza una prueba dedicada). Los 4 escritores NAP
  (`assign_contract_nap`, `assign_provisioning_nap`,
  `free_nap_puerto_on_contract_delete`/`client_delete`) ya están
  cubiertos por `napAssignment.sql.test.ts`/`napPhantomPorts.sql.test.ts`
  — sin cambios aquí.

**Siguiente paso seguro**: ninguno de los dos pendientes (JWT con
usuario de prueba real, comparación MikroTik real) se puede cerrar sin
intervención del usuario. No hay tarea de código pendiente. Fase 2 se
puede considerar **operacionalmente cerrada** con estos dos límites
documentados y aceptados; no iniciar Fase 3 sin indicación.

## 13z. Fase 3 comercial OLT — independencia progresiva de SmartOLT (INICIADA, 2026-10-13)

SmartOLT **sigue en uso**, no se desconectó nada. Primera sesión de Fase 3:
revisión de la integración OLT existente (sin repetir la auditoría de
Fase 2) + matriz de independencia + primera mejora pequeña implementada
y probada de forma aislada (sin tocar OLT/MikroTik/Supabase real).

### Matriz de independencia respecto a SmartOLT

| Función | Estado en SmartRayco | Dependencia de SmartOLT | Riesgo | Acción necesaria |
|---|---|---|---|---|
| Detección/registro de ONU | Completo (Telnet real, Fase 1/4), probado con 676 ONTs reales | Ninguna | Bajo | Ninguna |
| Aprovisionamiento (contrato+NAP+GEM/VLAN) | Completo (Fase 2/`fase136*`), probado con ONTs reales navegando | Ninguna | Bajo (quedan 2 certificaciones pendientes, ver 13y) | Ninguna nueva |
| Potencia óptica (RX/TX) | Completo, lectura bulk por puerto + por ONT | Ninguna | Bajo | Ninguna |
| PON (ocupación por puerto) | Existía solo puerto-por-puerto (al registrar); **hoy se agregó vista agregada** (ver abajo) | Ninguna | Bajo | Hecha esta sesión |
| Clientes/contrato ↔ ONU | Completo (Fase 2) | Ninguna | Bajo | Ninguna |
| Diagnóstico por ONT | Completo (Fase 97, running-config, señal) | Ninguna | Bajo | Ninguna |
| Salud de chasis (uptime/temp/CPU) | Completo, vía caché del sync (Fase 40) | Ninguna | Bajo | Ninguna |
| **Alertas proactivas** (offline/señal baja sin que un admin entre a mirar) | **No existe** — hoy solo se ve pasivamente al abrir el detalle de esa OLT y filtrar | **Uso operativo** de SmartOLT para esto, no técnica (los datos ya están en `olt_sync_cache`/`olt_onts`) | Medio — es la brecha funcional real más visible | Diseñar notificación (push/email/lo que ya use el resto del sistema), en una etapa propia — no se tocó esta sesión |
| Migración histórica SmartOLT→SmartRayco | Scripts de solo-lectura/backfill ya existen (`audit-smartolt.ts`, `backfill-smartolt.ts`), uso puntual ya hecho | N/A (herramienta de migración, no dependencia activa) | Bajo | Ninguna |

**Conclusión de la matriz**: no hay dependencia **técnica** real pendiente — todo lo que SmartOLT hace hoy, SmartRayco ya puede hacerlo también. Lo único que falta para independencia **operativa** completa son alertas proactivas (brecha de uso, no de capacidad) y las 2 certificaciones ya documentadas en 13y (JWT con usuario de prueba real, comparación MikroTik real).

### Priorización (según lo pedido: detección, registro, aprovisionamiento, potencia, PON, clientes, alertas, diagnóstico)

1. ~~PON — ocupación agregada~~ → hecho esta sesión (abajo).
2. Alertas proactivas → siguiente candidato, requiere decidir canal (fuera del alcance de "mejora pequeña aislada").
3. Resto de la lista: ya completo, sin acción.

### Primera mejora implementada: ocupación por puerto PON (vista agregada)

Antes, la ocupación de un puerto PON (cuántos de los 128 onu-id posibles
están en uso) solo se veía abriendo "Registrar ONT" para ESE puerto
puntual. Se agregó una tabla de ocupación de TODOS los puertos
conocidos de la OLT, visible de un vistazo en el detalle de la OLT.

- **Archivos**:
  - `src/lib/oltCapacity.ts` (nuevo) — `PON_PORT_MAX_ONUS` (antes
    duplicado en `AuthorizeOnuModal.vue`, ahora fuente única) +
    `computePonOccupancy()`, función pura.
  - `src/lib/__tests__/oltCapacity.test.ts` (nuevo) — 4 casos
    (agrupación, orden, límite/100%, lista vacía).
  - `src/views/olt/AuthorizeOnuModal.vue` — importa la constante en vez
    de redeclararla (sin cambio de comportamiento).
  - `src/views/olt/OltDetailView.vue` — nueva tabla "Ocupación por
    puerto PON", derivada 100% de `oltStore.onts` ya cargado (cero
    llamadas nuevas al backend, cero contacto con la OLT/MikroTik real).
- **Pruebas**: `npm run test:fetch-timeout` → 39/39 ok (incluye los 4
  casos nuevos). `npx vue-tsc -p tsconfig.app.json --noEmit` → sin
  errores.
- **No probado**: verificación visual en navegador — intentada en esta
  sesión y descartada: no hay usuario de prueba documentado para iniciar
  sesión en el panel y no se van a adivinar/crear credenciales sin
  autorización. Pendiente de que alguien con sesión real abra el panel
  OLT y confirme que la tabla se ve bien con datos reales.
- **Commits/despliegue**: commit local autorizado por el usuario (sin
  push/deploy) — ver commit en el historial de git.

**Siguiente paso concreto**: (1) tu autorización para commit (sin
push/deploy todavía) de este cambio; (2) que alguien abra el panel OLT
en el entorno real una vez desplegado y confirme visualmente la nueva
tabla; (3) cuando quieras seguir con Fase 3, decidir el canal de
alertas proactivas (único hueco funcional real que queda) como
siguiente mejora aislada.

## 13aa. Fase 3 OLT — alertas proactivas v1 (en memoria, exclusivas del panel) — IMPLEMENTADO, sin desplegar (2026-10-13)

Primera versión de alertas proactivas pedida como siguiente paso de Fase
3. Reutiliza 100% infraestructura existente: `olt_sync_cache`/`olt_onts`
(ya persistidos por el scheduler), el propio `oltSyncScheduler.ts` (sin
scheduler nuevo) y el canal SSE `oltEvents`/`GET /:id/events` ya tendido
para `ontChanged`/`summaryChanged`. **Sin tabla ni columna nueva.**

- **Archivos nuevos**:
  - `server/src/services/oltAlerts.ts` — lógica pura de detección:
    `detectStatusAlert` (transición online↔offline, nunca si
    `admin_state='disable'`) y `detectSignalAlert` (cruce del umbral de
    RX, nunca sin lectura previa ni sin lectura este ciclo).
  - `server/src/services/__tests__/oltAlerts.test.ts` — 11 casos con
    datos simulados: caída, recuperación, repetición de ciclos (no
    duplica), primer ciclo sin referencia, ONU deshabilitada
    administrativamente, potencia baja, recuperación de señal, error de
    lectura (nunca se confunde con caída), sin cambio real.
- **Archivos editados**:
  - `oltSyncService.ts` — llama la detección dentro de `performFullSync`
    usando `row` (lo YA persistido) como "antes" vs. lo recién leído
    como "después"; emite por `oltEvents.emitOltAlert()` solo tras
    confirmar que el bulk update se persistió.
  - `oltEvents.ts` — nuevo evento `OltAlertEvent`/`emitOltAlert`.
  - `routes/olt.ts` — `GET /:id/events` reenvía `oltAlert` por el mismo
    SSE ya protegido por `requireRole(...STAFF_READ)` (SUPERADMIN/ADMIN/
    TECNICO_RED/SOPORTE) — ningún rol fuera de esa lista puede recibir
    alertas, sin código de autorización nuevo.
  - `src/stores/olt.ts` — nuevo estado `alerts` (tope 20, en memoria del
    navegador, se vacía en cada `connectOltEvents`) + `dismissAlert`.
  - `src/views/olt/OltDetailView.vue` — banner de alertas descartables
    arriba del panel.
- **Pruebas**: `npm run test:provisioning` → **69/69 ok** (58 previos +
  11 nuevos). `vue-tsc -p tsconfig.app.json` y
  `tsc -p tsconfig.server.json` sin errores nuevos (los 2 errores de
  `oltProvisioningService.ts` ya existían antes de esta sesión, no
  tocado, confirmado con `git stash`).
- **No probado**: verificación visual del banner en navegador (mismo
  límite que 13z — sin usuario de prueba real); tampoco contra la OLT
  real (nada de esto se desplegó ni se ejecutó contra equipos reales).

### Por qué NO hace falta un "snapshot en memoria" para la detección

El "antes" de cada comparación es el valor que YA estaba persistido en
`olt_onts` (sobrevive un reinicio del backend) — no uno guardado aparte
en memoria. Por diseño, una transición real solo se reporta una vez:
tras persistirse, el siguiente ciclo compara contra el valor ya
actualizado y no hay cambio que reportar. El timeout/error de un puerto
puntual nunca se confunde con "se cayó" porque esa fila simplemente no
recibe una lectura nueva ese ciclo (lectura `undefined`, no `offline`).

### Limitaciones reales de esta v1 (documentadas, no resueltas)

1. **Alcance exclusivo del panel, sin persistencia**: si nadie tiene el
   panel de esa OLT abierto en el momento exacto del evento SSE, la
   alerta se pierde — no hay cola ni historial que la reenvíe después.
   Un refresco de página también vacía la lista ya mostrada.
2. **Reinicio del backend a mitad de una caída ya en curso**: no genera
   una alerta falsa (el estado "antes" en BD ya era `offline`, sin
   cambio), pero tampoco "recupera" la notificación de la caída
   original si nadie la vio antes del reinicio.
3. **Intervalo real de detección**: atado al scheduler ya existente —
   hasta `OLT_SYNC_INTERVAL_MINUTES` (20 min por defecto) para
   online/offline; para señal, además depende de
   `OLT_SYNC_SIGNAL_EVERY_N_RUNS` (si es >1, la lectura de RX se saltea
   algunos ciclos — la alerta de señal puede tardar varios ciclos en
   aparecer). No es tiempo real, es "tan rápido como el próximo sync".
4. **No hay canal externo** (a propósito, pedido explícito): solo
   in-app/SSE, nada de email/SMS/WhatsApp.
5. Un `full sync` manual ("Actualizar ahora") también puede disparar
   estas alertas si el usuario que lo ejecuta no es el mismo que las
   ve — es el mismo SSE compartido por OLT, no por usuario que lo
   disparó.

**Siguiente paso**: tu autorización para el commit local (sin push).
Luego, si se quiere ir más allá de esta v1, evaluar si vale la pena
persistir un historial corto de alertas (implicaría una tabla/columna
nueva, fuera del alcance de hoy) antes de considerar un canal externo.

## 13ab. Fase 3 OLT — ocupación PON + alertas v1 DESPLEGADAS (2026-10-13)

Despliegue controlado autorizado por el usuario de los 2 commits de
Fase 3 (13z/13aa). **VM confirmada en `b485f07`**.

- **Respaldo**: tag `rollback-20261013151328` → `a5c67c4` (commit previo
  en la VM), creado y verificado antes del `git pull`.
- **Despliegue**: `bash deploy/update.sh` — build y recreación de
  `backend`/`frontend` sin errores. `caddy`/`genieacs`/`mongo` no se
  tocaron (sin cambios).
- **Verificado, solo lectura, sin tocar OLT/MikroTik/Supabase**:
  - Los 5 contenedores `Up` (backend/frontend recreados, estables
    >1 min sin reinicios).
  - Backend arrancó limpio con **todos** los schedulers activos,
    incluido `olt-sync-scheduler` (el que ahora detecta alertas).
  - Un ciclo real de `olt-sync-scheduler` ya corrió tras el despliegue
    (`online=645 offline=69 sin-autorizar=12 senal-baja=1
    actualizadas=1`) **sin excepciones** en el código nuevo de alertas.
  - `GET /api/olt-devices` y `GET /api/olt-devices/:id/events` (el SSE
    de alertas) responden **401 sin token** — el guard de autenticación
    sigue intacto, nadie no autorizado puede recibir alertas.
  - Frontend (`/login`) responde 200 vía Caddy.
- **No verificado** (mismo límite de las últimas 2 sesiones): la vista
  real del panel (tabla "Ocupación por puerto PON" y el banner de
  alertas) — no hay usuario de prueba documentado para iniciar sesión y
  no se va a adivinar/crear credenciales. Pendiente de que un
  admin/técnico real abra el panel OLT y confirme visualmente.
- **No se provocaron desconexiones de ONU** ni se tocó OLT/MikroTik/
  PPPoE/Supabase para esta verificación — todo fue lectura de logs y
  respuestas HTTP de auth.

**Pendientes**: verificación visual real (arriba); las 2 certificaciones
de Fase 2 (13y) y el canal de alertas más allá de esta v1 siguen
abiertos, sin acción nueva pedida todavía.

## 13ac. Fase 3 OLT — reorganización visual del detalle OLT + numeración PON y zona (2026-10-13, IMPLEMENTADO, sin desplegar)

Rediseño únicamente de presentación de `OltDetailView.vue` (1343→~1400
líneas) para eliminar duplicación y mostrar PON con numeración
operativa + zona existente. **Ninguna acción de registrar/autorizar/
desactivar/eliminar/importar/consultar señal cambió de comportamiento**
— solo se reordenó dónde vive cada bloque y se agregó data derivada.

### Hallazgo real verificado (Supabase producción, solo lectura) — IMPORTANTE

Se confirmó con el usuario antes de construir nada: las 20 zonas ya
tienen su número PON codificado en el nombre (`"PON 1 - AO"` →
descripción "ANTENOR ORREGO", `"PON 2 - SM"` → "SANTA MARIA", etc.).
**Pero el vínculo real puerto↔zona (via `olt_onts.zone_id`, ya
existente) NO es 1 a 1**: ej. Slot 2/Puerto 1 tiene ONTs de "PON 1 - AO"
Y "PON 2 - SM" mezcladas; "PON 4 - B6" aparece en los puertos 4, 5 y 12
a la vez. Decisión del usuario: mostrar la **zona predominante** (más
ONTs vinculadas en ese puerto) + aviso/desglose si hay más de una,
**nunca** asumir que la zona predominante es "la" zona comercial del
PON, y marcar "pendiente de vincular" cuando ningún ONT del puerto
tiene zona. No se creó tabla ni columna nueva — se reutiliza
`olt_onts.zone_id`/`zones` (ya traído por `GET /:id/onts`).

### Numeración PON operativa

Correlativa (PON 01, 02...) calculada SOLO sobre los puertos
slot/puerto ya conocidos (los que tienen al menos una ONT sincronizada
alguna vez) — hoy coincide exacto con el ejemplo pedido (Slot 2 tiene
sus 16 puertos completos → PON 01-16; Slot 3 empieza en PON 17) porque
así está la topología real hoy. **Limitación documentada**: si más
adelante aparece la primera ONT de un puerto de un slot anterior que
hoy no tiene ninguna, los números posteriores se corren — no es un ID
fijo de la OLT, no hay forma de leer "puertos físicos totales por
tarjeta" sin un comando Telnet nuevo contra el equipo real (fuera de
alcance de hoy). El identificador físico (Slot/Puerto) nunca se oculta
ni se altera — se muestra siempre junto al número PON.

### Archivos modificados

- `src/lib/oltCapacity.ts`: `computePonOccupancy()` ahora también
  calcula `ponNumber`, `dominantZone`, `otherZonesCount` y
  `zoneBreakdown` por puerto (puramente derivado de `onts` ya cargados,
  misma firma de siempre, campos nuevos opcionales).
- `src/lib/__tests__/oltCapacity.test.ts`: +5 casos (numeración
  correlativa, zona predominante con empate, puerto sin zona vinculada,
  mezcla con/sin zona). **43/43 ok** (`npm run test:fetch-timeout`).
- `src/views/olt/OltDetailView.vue`: reordenado a 5 secciones (Resumen
  general → Ocupación PON → Gestión de ONTs → Telemetría desplegable →
  Alertas y sincronización), sin tocar ningún handler/llamada al
  backend. Cambios de presentación:
  - "Ocupación por puerto PON": ahora muestra `PON ##` + Slot/Puerto +
    zona predominante (o "pendiente de vincular") + botón "+N zonas
    más" con desglose expandible.
  - "Gestión de ONTs": se unificó la tabla completa (antes siempre
    visible, separada) como una 4ª pestaña "Todas", junto a las 3
    pestañas existentes (Nuevas/Reconectar/Deshabilitadas) — elimina la
    duplicación de ver el mismo listado en 2 lugares. Pestaña por
    defecto: "Todas" (antes la tabla ya estaba siempre visible, así que
    la visibilidad inicial no cambia).
  - "Telemetría": pasó a `<details>` (plegada por defecto); mismos
    datos/gauges, mismo botón "Actualizar".
  - "Alertas y sincronización": sección nueva al final que agrupa el
    banner de alertas (antes arriba de todo), "Consultar puerto GPON"
    y "Importar ONTs desde la OLT" (antes sueltos entre medio).

### Distinción de conceptos (requisito 6, ya así en los datos — no se mezcló nada)

ONTs sincronizadas (`olt_onts`, Telnet) / clientes-contratos asociados
(`olt_onts.client_id`/`contract_id`) / abonados por caja NAP
(`fo_nap_puertos`, vía `infra_elementos.zone_id`, módulo de fibra —
ver `ZonasView.vue`) **ya eran 3 fuentes y 3 conteos distintos** en el
código existente; esta sesión no agregó ni mezcló ningún contador
nuevo entre ellos.

### Pruebas y validación

- `npx vue-tsc -p tsconfig.app.json --noEmit` → sin errores.
- `npm run test:fetch-timeout` → 43/43 (incluye los 5 casos nuevos).
- **No verificado**: visual en navegador real (mismo límite de
  sesiones anteriores — sin usuario de prueba). Tampoco se desplegó ni
  se tocó la OLT/MikroTik/Supabase real (las consultas a Supabase de
  esta sesión fueron 100% `select`, de solo lectura, para verificar
  zonas y el vínculo zona↔puerto antes de construir la UI).

**Siguiente paso**: autorización para commit local (sin push/deploy).
Después, verificación visual real cuando alguien abra el panel.

## 13af. Incidencia real: cierre de Alta (App de Campo) no transaccional — causa raíz + corrección preparada, sin desplegar (2026-10-13)

Ver `docs/ERRORES-CAMPO.md` (fila 2026-10-13) para el detalle completo —
caso real: Alta de Violeta García Silva (`installations.id`
`43e138bd-...a062`), confirmado por SQL de solo lectura contra
producción. Resumen:

- **Causa raíz**: `performClosureSubmit` (`src/stores/campo.ts`) hace
  ~8 escrituras independientes sin transacción; el `UPDATE` de
  `service_contracts.client_code` corría **al final**, así que un
  choque con el UNIQUE (Fase 39, intacto) dejaba fotos/firma/cierre ya
  guardados pero la instalación nunca se marcaba `completed`. Cada
  reintento (el borrador local conserva las mismas fotos) repetía la
  subida de la foto de equipo y la firma — las 5 fotos de categoría NO
  se duplicaban porque ya tenían un fix de idempotencia anterior.
- **Estado real de los datos afectados** (sin modificar, sin
  autorización para tocarlos): instalación sigue `in_progress`,
  `client_code` sigue `null`, 4 fotos "modem" en
  `client_equipment_photos` (debería haber 1), 2 archivos de firma en
  Storage (solo el más reciente referenciado). Materiales/equipos de
  inventario (6 movimientos, 2 unidades serializadas) — **sin
  duplicar**, se registran en un paso anterior y separado.
- **Corrección preparada** (commit local, sin push/deploy): nuevo
  `src/lib/jobClosureIdempotency.ts` (puro, testeado: detección de
  violación UNIQUE, idempotencia de fotos/equipo, guardia
  anti-concurrencia) + `campo.ts` reordenado (código de cliente
  primero, falla rápido y claro) + idempotencia en fotos de equipo y
  firma + guardia en memoria contra 2 cierres simultáneos del mismo
  trabajo. **No se tocó la restricción UNIQUE, no se tocó Rutinas, no
  se tocó OLT/MikroTik/Fase 158.**
- **Pruebas**: `npm run test:fetch-timeout` → 52/52 (43 previos en esta
  rama de despliegue + 9 casos nuevos). `vue-tsc` limpio.
- **Pendiente de decisión del usuario** (no resuelto aquí, por
  instrucción explícita de no modificar datos reales sin autorización):
  (1) qué código de cliente correcto usar para destrabar la instalación
  de Violeta García Silva; (2) si limpiar las 4 fotos "modem"
  duplicadas y el archivo de firma huérfano en Storage, o dejarlas; (3)
  autorización para desplegar esta corrección.

## 13ag. Cierre de Alta — corrección DESPLEGADA; Fase 158/zona-ONT reprogramadas aparte (2026-10-13)

Despliegue autorizado del fix de 13af. **VM confirmada en `7c52535`.**

- **Secuenciación de commits**: `3af9986` (fix original) estaba commiteado
  LOCALMENTE encima de `4c8b47e`/`bb15922` (sincronización zona-ONT y
  Fase 158, ninguno autorizado para desplegar todavía). Para desplegar
  SOLO el fix sin arrastrar esos 2, se creó la rama de respaldo
  `backup-fase3-olt-fase158-pendiente` (preserva los 3 commits intactos,
  nada se perdió) y se aplicó el fix por separado (cherry-pick) encima
  de `origin/main` (`85fc4ef`), dando el commit `7c52535` realmente
  publicado y desplegado. `4c8b47e`/`bb15922` quedan pendientes de
  reaplicar en una sesión futura cuando se autorice esa fase.
- **Consecuencia inevitable**: `85fc4ef` (reorganización visual del
  detalle OLT, Fase 3 — push ya autorizado antes, despliegue no) quedó
  desplegado también, al ser el padre directo del fix — no había forma
  de desplegar el fix sin él. No incluye Fase 158 ni la sincronización
  zona-ONT (esos 2 siguen sin desplegar, solo en la rama de respaldo).
- **Punto 1 (código en conflicto)**: **no se pudo identificar el valor
  exacto** por vías de solo lectura disponibles. `postgres_logs` solo
  registra `duplicate key value violates unique constraint
  "idx_service_contracts_client_code_unique"` (sin el DETAIL con el
  valor); la consulta real usa el parámetro vinculado de PostgREST
  (`$1`/`$2`), no inlineado en el log. `edge_logs` confirma 2 intentos
  reales (`PATCH .../service_contracts?id=eq.40d7958f-...` → `409` a las
  16:32:34 y 16:34:36 UTC) pero solo registra URL/método/status, no el
  cuerpo JSON. **No se adivinó ni se inventó ningún código** — el único
  camino real es que el técnico vuelva a leer el cintillo/código físico
  e ingrese uno que no choque; el sistema seguirá rechazándolo con el
  mensaje claro nuevo si vuelve a coincidir con otro contrato.
- **Puntos 2-4 verificados por revisión de código** (commit `7c52535`):
  el `UPDATE` de `client_code` es literalmente la primera operación de
  `performClosureSubmitInner`, antes de GPS/fotos/firma/cierre. La
  restricción UNIQUE (`idx_service_contracts_client_code_unique`,
  Fase 39) no se tocó — sigue siendo la única autoridad real; el código
  nuevo solo traduce el error 23505 ya lanzado por Postgres a un mensaje
  claro, nunca lo evita ni lo reemplaza. El guard en memoria
  (`createJobClosureGuard`) protege contra 2 cierres del MISMO proceso
  de la app (botón + auto-sync de la cola offline) — **no** contra 2
  dispositivos distintos a la vez, para eso la restricción UNIQUE sigue
  siendo la protección definitiva, tal como se pidió confirmar.
- **Punto 3 (duplicados en reintento)**: cubierto por pruebas aisladas
  de la lógica pura (`photosAlreadyUploaded`/`equipmentTypesAlreadyUploaded`/
  `createJobClosureGuard`, 9 casos) — no hay un harness de componentes
  Vue/Pinia en este proyecto para una prueba de integración real contra
  Supabase; la verificación de la orquestación completa es por revisión
  de código, no por ejecución automatizada.
- **Pruebas en la rama real de despliegue**: `npm run test:fetch-timeout`
  → **52/52** (43 ya existentes en `85fc4ef` + 9 nuevos). `vue-tsc`
  limpio.
- **Respaldo**: tag `rollback-20261013165758` → `b485f07` (estado previo
  de la VM), creado antes del `git pull`.
- **Verificado post-deploy**: 5 contenedores `Up`, backend arrancó
  limpio con todos los schedulers, frontend (`/login`) responde 200.

**No autorizado ni ejecutado** (confirmado): no se borraron fotos/firma
duplicadas, no se cambió el `client_code` de Violeta García Silva, no
se tocó inventario/contratos/equipos reales, no se desplegó Fase 158 ni
la sincronización zona-ONT.

**Pendiente para cerrar el Alta de Violeta García Silva**: que el
técnico/administrador ingrese un código de cliente que no choque (no
hay forma de saber cuál es el que chocó, ver arriba) y reintente
"Completar instalación" desde la App de Campo — con la corrección ya
desplegada, ese reintento ya no debería duplicar la foto de equipo ni
la firma.
## 13ad. Fase 3 OLT — corrección mínima: sincronizar olt_onts.zone_id al cambiar zona/NAP del contrato (2026-10-13, IMPLEMENTADO, sin desplegar)

Corrección puntual del gap confirmado en 13ac (contexto: traslados de
servicio por Rutinas no existen como flujo estructurado — ver
investigación previa; el único lugar real donde cambia zona/NAP es
`ClientServiceDetailView.vue`, `syncNap()`).

### Qué se corrigió

Al guardar el contrato con zona/NAP distinta, `syncNap()` ahora también
llama `syncOltZone(c)`, que sincroniza `olt_onts.zone_id` — **solo**
para la ONT inequívocamente vinculada por `contract_id` (nunca por
`client_id`, un cliente puede tener varios servicios/ONTs). Reglas:

- 0 ONTs con ese `contract_id` → no toca nada, `console.info` (caso
  normal: contrato aún sin instalar).
- 2+ ONTs con ese `contract_id` (dato ambiguo) → no toca nada,
  `console.warn` con el conteo, para revisión manual.
- Zona ya coincide → no hace un `PUT` innecesario.
- Falla la consulta o el `PUT` → **alerta explícita y distinta** de la
  del guardado del contrato/NAP — nunca se presenta como "todo
  sincronizado" si este paso quedó parcial.

### No transaccional (documentado, no resuelto hoy)

El guardado del contrato/NAP (Supabase directo) y la sincronización de
`olt_onts.zone_id` (backend Hono propio) son 2 sistemas distintos sin
una transacción de BD común disponible hoy — por diseño, nunca se
revierte lo ya guardado si este último paso falla; se avisa aparte.
**Alternativa transaccional real** (propuesta, no implementada):
plegar este update dentro de la misma función SQL
`assign_provisioning_nap` (mismo Postgres) — requeriría una migración
nueva, fuera de alcance de esta corrección mínima.

### Limitación de permisos conocida (no es un defecto nuevo)

`PUT /:id/onts/:ontDbId/meta` exige `ONT_WRITE` (SUPERADMIN/ADMIN/
TECNICO_RED) — pero `assign_contract_nap` permite además SOPORTE/
FACTURACION. Un usuario SOPORTE/FACTURACION que cambie zona/NAP **va a
ver siempre** la alerta de "no se pudo actualizar la zona en la ONT"
(403), de forma consistente y esperada — no se amplió `ONT_WRITE`
porque es una decisión de política ya existente (Fase 65: escritura en
OLT solo para admin/red), no parte de esta corrección.

### Archivos

- `src/lib/ontZoneSync.ts` (nuevo): `resolveOntForZoneSync()` (decisión
  pura) + `syncOltZoneForContract()` (orquestación con I/O inyectado,
  mismo patrón que `reserveContractNap`/napAssignment.ts — nunca lanza,
  todo fallo vuelve como parte del resultado).
- `src/lib/__tests__/ontZoneSync.test.ts` (nuevo): 15 casos — decisión
  pura (8: cambio de zona, multi-servicio, sin vínculo, ambiguo, zona
  sin cambio, legado sin contract_id) + orquestación (7: caso feliz,
  fallo de consulta, fallo de actualización/403, sin vínculo, ambiguo,
  sin cambio, regresión de un segundo llamado).
- `src/views/clientes/ClientServiceDetailView.vue`: `syncNap()` ahora
  también llama `syncOltZone()` (nueva), que delega en el orquestador y
  traduce cada resultado a log/alerta según corresponda.

### Pruebas

`npm run test:fetch-timeout` → **58/58** (43 previos + 15 nuevos).
`npx vue-tsc -p tsconfig.app.json --noEmit` → sin errores. No se tocó
Rutinas, reprovisionamiento, Telnet ni configuración física de la OLT
— solo metadato (`zone_id`) en `olt_onts`, vía el endpoint ya existente
`PUT /:id/onts/:ontDbId/meta`.

**Siguiente paso**: autorización para commit local (sin push/deploy).
El commit `85fc4ef` (reorganización visual) ya está en `origin/main`
desde esta sesión; sigue sin desplegarse.

## 13ae. Fase 158 — NAP + zona de ONT transaccional, acotado a 3 roles reales (2026-10-13, PREPARADO, SQL sin aplicar, sin desplegar)

Aclaración del usuario: SmartRayco solo usa 3 roles operativos —
**SUPERADMIN, ADMIN, TÉCNICO** (nombre técnico exacto en código:
**`TECNICO_RED`**, confirmado en `server/src/types.ts`/`src/types/domain.ts`).
SOPORTE/FACTURACION no se usan — no se les desarrolla nada nuevo ni se
tocan sus políticas existentes. Esta fase reemplaza el enfoque best-effort
de 13ad por uno transaccional real para esos 3 roles.

### Qué se preparó (nada aplicado todavía)

- **Migración** `supabase/migrations/20261013160000_fase158_assign_contract_nap_sync_ont_zone.sql`:
  función nueva `assign_contract_nap_sync_ont_zone(p_nap_id, p_contract_id, p_client_id)`
  — reusa `assign_provisioning_nap` (Fase 2, sin tocar) para la NAP, y en
  la MISMA transacción sincroniza `olt_onts.zone_id` de la ONT vinculada
  por `contract_id` (lee la zona de `service_contracts.zone_id`, ya
  guardado antes por el frontend — no es un parámetro nuevo). Si
  cualquiera de las 2 partes falla, **ambas se revierten**. Restringida
  en el propio SQL a `SUPERADMIN`/`ADMIN`/`TECNICO_RED` — **no modifica
  `assign_contract_nap`** (la función vieja, que SOPORTE/FACTURACION
  sigue usando exactamente igual, sin sincronizar zona).
- **Rollback** `supabase/rollback/fase158_rollback.sql`: solo
  `drop function` (la fase únicamente agregó, no modificó nada
  existente).
- **Frontend**: `src/lib/napAssignment.ts` (+`reserveContractNapSyncOntZone`),
  `src/stores/foFibra.ts` (+`assignContractToNapAndSyncOntZone`),
  `src/views/clientes/ClientServiceDetailView.vue` (`syncNap` ahora
  decide por rol: los 3 roles permitidos usan la vía transaccional
  nueva; cualquier otro rol —si llegara a usar esta pantalla— sigue
  llamando `assignContractToNap`/`unassignContract` exactamente como
  antes de 13ad, sin ningún cambio).
- `src/lib/ontZoneSync.ts`/`syncOltZone()` (de 13ad) **se conserva**,
  pero ahora solo se usa para el caso sin NAP de por medio (quitar la
  caja NAP) — ahí no hay nada que combinar transaccionalmente, sigue
  siendo best-effort, y también acotado a los 3 roles.

### Pruebas (todas con datos simulados, sin tocar Supabase real)

- **`npm run test:ont-zone-nap-sql`** (nuevo, Postgres real en Docker
  aislado, migración real cargada tal cual) → **9/9**: caso feliz,
  sin ONT vinculada, cliente con 2 servicios (no toca la ONT del otro
  contrato), ambiguo (2 ONTs), zona ya coincide, **rollback
  transaccional real** (un trigger forzado en `olt_onts` revierte
  también la reserva NAP ya aplicada en la misma función), permisos
  (SUPERADMIN/ADMIN/TECNICO_RED sí, SOPORTE/FACTURACION/CLIENTE/
  inactivo/anónimo no), y regresión (`assign_contract_nap` vieja sigue
  intacta para SOPORTE).
  - Encontrada y corregida en el camino: `min(uuid)` no existe en
    Postgres (se cambió a `(array_agg(id))[1]`) — exactamente el tipo
    de error que esta prueba aislada existe para atrapar antes de
    aplicar nada.
- `npm run test:fetch-timeout` → **62/62** (+4 casos de
  `reserveContractNapSyncOntZone` en `napAssignment.test.ts`).
- `npm run test:nap-sql` (regresión) → **10/10**, sin cambios.
- `npx vue-tsc -p tsconfig.app.json --noEmit` → sin errores.

### Riesgos / pendientes

- La migración **no está aplicada** en Supabase ni en ninguna VM —
  pendiente de autorización explícita.
- Mientras no se aplique, `ClientServiceDetailView.vue` llamaría a una
  función que no existe todavía — **no se puede desplegar el frontend
  de esta fase antes de aplicar la migración** (orden obligatorio:
  SQL primero, frontend después).
- El guardado del contrato en sí (zona) sigue siendo un paso previo
  separado (vía `updateContract`, Supabase PostgREST) — la
  transaccionalidad nueva cubre NAP+zona-de-ONT, no el contrato mismo
  (ampliarlo requeriría meter el guardado completo del contrato dentro
  de la misma función, fuera de alcance de "corrección mínima").

**Siguiente paso**: autorización explícita y por separado para (1)
aplicar la migración `fase158` en Supabase, (2) desplegar el frontend
junto con ella, y (3) el despliegue ya pendiente de `85fc4ef`/commit de
13ad. Nada de esto se ejecuta sin que lo pidas en el mismo turno.

## 13ah. Reconciliación Clara y Mayco — diagnóstico, sin escrituras todavía (2026-10-13)

Continuación directa de 13ag (ver ahí la causa raíz completa y el patrón
ya validado con Violeta — no se repite aquí). Reglas permanentes de esta
migración: ver sección nueva en `CLAUDE.md` ("Migración OLT —
vínculo cliente/contrato/ONT").

**Clara Caballero Valderrama — ya resuelto, nada que hacer.** Fue dada de
alta manualmente (`CTR-2026-00347`, `client_code 001429`, zona Revolución
— coincide con su posición real 1/2/13:33). Verificado: su fila
`olt_onts` (`037413b0...`) **ya tiene `client_id`/`contract_id`
vinculados correctamente** — alguien lo hizo entre la sesión anterior y
esta. Sin duplicados, sin conflictos. Pendiente opcional (no urgente): su
`olt_onts.zone_id` sigue en `null` (su contrato sí tiene zona) — no
bloquea nada.

**Mayco Paredes Rodríguez — Situación B, listo para vincular.** Cliente
real activo, contrato único y activo (`CTR-2026-00071`, zona Barrio 6,
`client_code 001350`, `pppoe_username MAYCO_PAREDES_B6`). Su ONT real
(`08e05bd9...`, serial `ZTEGDC5C139E`, posición 1/2/4:19, zona Barrio 6
— coincide) sigue con `client_id`/`contract_id` en `null`. Sin
duplicados (ninguna otra fila de `olt_onts` apunta a su cliente/contrato,
ninguna otra fila tiene su serial). Sin `olt_provisioning_operations`
(su ONT es de importación legacy, nunca pasó por el flujo Fase 2 — no
hay operación que reconciliar, solo falta el vínculo).

**Corrección propuesta para Mayco (sin ejecutar, igual patrón que
Violeta — transacción con `FOR UPDATE` + validación de posición/serial/
estado previo antes de escribir):**

```sql
UPDATE public.olt_onts
SET client_id = 'fa6384d8-1de5-48fd-b253-247366e90284',
    contract_id = '12874463-fe52-4436-91a7-e33d64098d53'
WHERE id = '08e05bd9-beb9-46a4-9928-f189d74820fa';
```

(`description` ya dice "Mayco Paredes Rodriguez" correctamente — no hace
falta tocarla.)

**Pendiente**: autorización explícita para ejecutar esta única escritura
(solo Mayco — Clara no requiere nada). No se tocó la OLT ni MikroTik en
esta sesión, todo fue `SELECT`.

## 13ai. Edición administrativa de ONTs — "Editar información" + protección del import (2026-10-13, IMPLEMENTADO, sin desplegar)

Continuación de 13ag/13ah. Diagnóstico confirmado (sesión anterior): el
formulario de edición administrativa **ya existía casi completo**
(`OntZoneEditModal.vue` / `PUT /:id/onts/:ontDbId/meta`,
`ONT_META_FIELDS` = zona/splitter/splitter_port/nombre/dirección/
contacto/lat/long/cliente/contrato, rol `ONT_WRITE` = SUPERADMIN/ADMIN/
TECNICO_RED) — no hacía falta reconstruirlo. Dos ajustes puntuales:

### 1. Botón renombrado
`OntDetailModal.vue`: "Editar zona" → **"Editar información"** (el
formulario ya cubre más que zona). Solo el texto visible — el evento
interno (`editZone`) y el resto del flujo quedan iguales a propósito,
para no tocar más de lo pedido.

### 2. Protección del import (gap real encontrado en 13-anterior)
`POST /:id/onts/import-existing` pisaba `description` en CADA corrida,
incluso en ONTs ya vinculadas a un cliente — confirmado en código antes
de tocar nada. Corregido: una vez que `olt_onts.client_id` no es nulo,
el import deja esa columna intacta (el resto — serial/tipo/VLAN/
perfiles/señal/estado — se sigue sincronizando siempre desde la OLT,
que es su fuente de verdad). Una ONT sin vincular (Situación A) sigue
tomando el nombre de la OLT en cada import, sin cambios — la mayoría de
las ~400 pendientes de migrar están en ese caso y necesitan seguir así
hasta que alguien las vincule.

**Decisión de diseño**: la señal usada es `client_id IS NOT NULL`
(reutilizado, no un dato nuevo) — no se creó ninguna columna para
marcar "editado a mano". Justificación: no era imprescindible (regla
del proyecto) — el momento en que una ONT pasa a estar administrada por
esta app coincide exactamente con el momento en que se vincula a un
cliente real (ver 13ah: Violeta/Mayco).

### 3. Aclaración en el formulario
`OntZoneEditModal.vue`: nota de una línea bajo Splitter/Puerto del
splitter aclarando que es texto libre heredado de la OLT/SmartOLT, no
la asignación NAP real del contrato (esa sigue gestionándose desde la
ficha del cliente, Fase 2/158 — sin tocar nada de eso aquí).

### Archivos modificados
- `server/src/routes/olt.ts` (`import-existing`: separa el upsert en 2
  lotes según vínculo, usando el helper nuevo).
- `server/src/services/oltImportDescriptionGuard.ts` (nuevo, puro):
  `positionKey()` + `splitByLinkStatus()`.
- `server/src/services/__tests__/oltImportDescriptionGuard.test.ts`
  (nuevo): 6 casos (sin vincular, vinculada, lote mixto real
  Violeta/Clara/Mayco, no confunde por serial/nombre solo posición,
  lista vacía).
- `src/views/olt/OntDetailModal.vue` (botón renombrado).
- `src/views/olt/OltDetailView.vue` (comentario actualizado, sin
  cambio de código).
- `src/views/olt/OntZoneEditModal.vue` (nota aclaratoria splitter/NAP).

### Pruebas
`npm run test:provisioning` → **75/75** (69 previos + 6 nuevos).
`npx tsc -p tsconfig.server.json --noEmit` → solo los 2 errores
preexistentes de `oltProvisioningService.ts` (no tocado, ya
confirmados ajenos en sesiones anteriores). `npx vue-tsc -p
tsconfig.app.json --noEmit` → sin errores.

### No se tocó (confirmado)
Serial/posición/ONU-ID/VLAN/perfiles/aprovisionamiento — el endpoint de
metadatos (`ONT_META_FIELDS`) nunca los incluyó, sin cambios aquí
tampoco. Sin comandos de escritura a OLT/MikroTik. Sin cambio de
vínculo cliente/contrato desde este formulario (eso sigue siendo
decisión aparte, vía Fase 2/158). Sin migraciones — la protección usa
una columna ya existente (`client_id`). Sincronización de
estado/señal/equipos sin alterar.

### Riesgos
- La protección es posicional (`frame/slot/port/ont_id`), no por
  serial — si una ONT física se reemplaza en la MISMA posición de una
  fila ya vinculada, el import seguirá sin tocar `description` aunque
  el equipo haya cambiado (comportamiento ya existente para
  tipo/VLAN/perfiles también se actualiza igual, pero el nombre
  quedaría del cliente anterior hasta que alguien lo corrija a mano).
  Caso raro, no bloqueante, documentado para la próxima sesión.

**Siguiente paso**: autorización para commit local (sin push/deploy).

## 13aj. Corrección de riesgo en 13ai — ONT reemplazada/trasladada ya no hereda identidad ajena (2026-10-13, IMPLEMENTADO, sin desplegar)

Riesgo señalado por el usuario sobre 13ai, confirmado real en código antes
de tocar nada: la protección de `description` solo miraba la **posición**
(`frame/slot/port/ont_id`), nunca el **serial** — si una ONT vinculada se
reemplazaba físicamente (mismo slot/puerto/onu-id, otro equipo), el import
seguía protegiendo esa fila por posición aunque el serial real ya fuera
otro, dejando `client_id`/`contract_id`/`description` del cliente VIEJO
pegados a un equipo que ya no es suyo.

### Corrección
`oltImportDescriptionGuard.ts`: `splitByLinkStatus` (2 vías, solo
posición) → **`classifyImportCandidates`** (3 vías, posición **y**
serial, comparación case-insensitive — mismo criterio que
`upsertOnt`/`oltProvisioningStore.ts`):

- **`fullRefresh`** — posición sin vincular (Situación A): todo se
  actualiza como siempre, sin cambios.
- **`keepDescription`** — posición vinculada **y mismo serial**: es la
  misma ONT de siempre, se actualiza todo salvo `description`.
- **`conflicts`** — posición vinculada pero **serial distinto**
  (reemplazo/traslado): **esa fila no se toca en absoluto** (ni
  `description`, ni los campos técnicos, ni `client_id`/`contract_id`) —
  se excluye de ambos `upsert`, se registra en logs del backend
  (`console.warn`) y se devuelve en la respuesta del endpoint
  (`conflicts: [...]`) con posición, serial anterior, cliente anterior y
  serial nuevo encontrado. El panel (`OltDetailView.vue`) ya lo muestra en
  el mensaje de resultado del import, con aviso ⚠ explícito.

### Archivos modificados
- `server/src/services/oltImportDescriptionGuard.ts` (reescrito:
  `classifyImportCandidates` reemplaza `splitByLinkStatus`).
- `server/src/services/__tests__/oltImportDescriptionGuard.test.ts`
  (reescrito, 12 casos: sin vincular, mismo serial, case-insensitive,
  **reemplazo** [conflicto, nada se toca], **traslado** [posición vieja
  no se visita, posición nueva sin vincular = refresco normal],
  **reimportación idempotente** ×3 [sin vínculo, con vínculo, conflicto
  que persiste sin auto-resolverse], caso mixto real Violeta/Clara/Mayco
  + 1 reemplazo simulado, lista vacía).
- `server/src/routes/olt.ts` (`import-existing`): usa la clasificación
  de 3 vías, devuelve `conflicts` en la respuesta.
- `src/stores/olt.ts` / `src/views/olt/OltDetailView.vue`: el resultado
  del import ahora muestra los conflictos con posición/seriales, para
  revisión administrativa clara (requisito explícito del usuario).

### Pruebas
`npm run test:provisioning` → **81/81** (75 previos + 6 netos nuevos —
el archivo se reescribió completo, de 6 a 12 casos). `npx tsc -p
tsconfig.server.json --noEmit` → solo los 2 errores preexistentes de
`oltProvisioningService.ts` (ajenos, confirmado con `git stash` en
sesiones anteriores). `npx vue-tsc -p tsconfig.app.json --noEmit` → sin
errores.

### Qué sigue sin resolver (documentado, no bloqueante)
- Un conflicto reportado **nunca se autoresuelve** — queda así hasta
  que un administrador lo revise y decida a mano (desvincular la fila
  vieja, o confirmar que el `client_id` debe pasar al nuevo serial).
  Es la decisión correcta por diseño (regla 3 de la migración:
  "no sobrescribir ni borrar automáticamente ante discrepancias") — no
  es un pendiente de código, es un paso humano necesario.
- No se creó ninguna tabla/columna de "historial de reemplazos" — el
  conflicto solo vive en la respuesta del import y en logs del backend
  mientras no se resuelva; no hay un lugar persistente en Supabase para
  consultarlo después sin volver a correr el import. Si esto se vuelve
  un problema real (conflictos que nadie nota a tiempo), evaluarlo en
  una sesión futura — no se justificaba una tabla nueva solo para esto
  todavía.

**Siguiente objetivo ya anunciado por el usuario (NO implementado
todavía)**: automatizar la relación PON–zona–contrato–App Campo–Gestión
de ONTs.

## 13. Próximo paso recomendado

1. Decidir sobre el dato de prueba "DIAGNOSTICO CLAUDE TEST" en Supabase
   (borrar o dejar) — ver 13m.
2. **Frontend ya desplegado** (VM en `61da3a1`) — falta instalar
   `C:\Users\USER\Desktop\SmartRayco.apk` (cabecera única + ícono/splash
   definitivos) en un equipo real y confirmar: una sola cabecera azul
   visible con sesión iniciada, Login sin ella, menú lateral abre/cierra
   sin superposiciones, Inicio/Recargar funcionan, App de Campo conserva
   su propia navegación — validación de campo pendiente, no hecha
   todavía (sin emulador Android en este entorno).
3. Probar en campo real (con un técnico) el wizard de 5 pasos y el nuevo
   flujo de Drop prefabricado/bobina (fase anterior a la de identidad
   visual) antes de seguir iterando sobre esa pantalla.
4. Decidir si vale la pena una revisión de seguridad más amplia sobre los
   grants por defecto de Supabase (sección 11) — es un hallazgo real pero
   no urgente (la autorización real ya vive dentro de cada función).
5. Seguir registrando en `docs/ERRORES-CAMPO.md` los bugs reales que
   reporten los técnicos, para no perder ese historial.
6. **Resuelto por el administrador** (confirmado al cerrar 13u/abrir
   13v): "oficina ofi", "prueba zava", "gloria rayco villarreal" y "sala
   sala" (caja NAP - 01) son los 4 clientes reales — el contador 4/16 es
   correcto, no son pruebas. No requiere acción.
7. **Resuelto** (ver 13v.1): trigger de `DELETE` en
   `clients`/`service_contracts` que libera (`estado='libre'`) el puerto
   NAP correspondiente ya está **aplicado en Supabase de producción**
   (migración `20261012191318_fase156_prevenir_puertos_nap_fantasma`,
   10/10 pruebas aisladas en verde) y verificado con SQL de solo
   lectura. No requiere más acción.
8. **Pendiente (ver 13v)**: los 5 puertos fantasma 2–6 de NAP - 01 (y
   cualquier otro ya existente) siguen `'ocupado'` sin dueño en la base —
   13v es deliberadamente preventiva hacia adelante, no los toca.
   Limpiarlos (si se decide hacerlo) requiere una fase separada con su
   propia autorización explícita.
