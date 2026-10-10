# SmartRayco — Estado de desarrollo

Última actualización: 2026-10-10, sesión de identidad visual (fin de sesión).
Este documento es la
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

## 12. Identidad visual unificada (sesión 2026-10-10b) — IMPLEMENTADO

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

## 13. Próximo paso recomendado

1. Instalar `C:\Users\USER\Desktop\SmartRayco.apk` en un equipo real y
   confirmar que el ícono/splash se ven bien (máscara circular, modo
   oscuro, pantalla de inicio) — validación de campo pendiente de esta
   sesión.
2. Probar en campo real (con un técnico) el wizard de 5 pasos y el nuevo
   flujo de Drop prefabricado/bobina antes de seguir iterando sobre esa
   pantalla — son los cambios más grandes de la sesión anterior sobre una
   herramienta en uso diario.
3. Decidir si vale la pena una revisión de seguridad más amplia sobre los
   grants por defecto de Supabase (sección 11) — es un hallazgo real pero
   no urgente (la autorización real ya vive dentro de cada función).
4. Empezar a registrar en `docs/ERRORES-CAMPO.md` los bugs reales que
   reporten los técnicos, para no perder ese historial.
