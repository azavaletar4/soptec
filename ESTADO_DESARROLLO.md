# SmartRayco — Estado de desarrollo

## Inventario de Campo — etapas 1 y 2 locales (2026-10-15)

Endpoint GET contextual para Altas/Averías con JWT real, perfil activo y
job_assignees vigente (líder/apoyo); DTO sin precios, valores ni equipos ajenos.
Retirada/desvinculación propagan contexto y delegan una sola escritura existente,
sin modificar su payload. Históricos sin contrato se limitan al vínculo de orden
con aviso. 24/24 pruebas y navegador local Alta/Avería correctos; build y tipos
backend correctos. Ver `docs/INVENTARIO-ETAPAS-1-2.md` para archivos y riesgos.
Sin Cloud, migraciones, RLS, cambios de escrituras, push o despliegue. Rutinas,
Realtime, offline y Fase 162 sin cambios. REST directo amplio sigue pendiente;
no se implementaron etapas 3–6 ni se certifican sesiones reales/concurrencia SQL.

## Seguridad de Inventario — detención controlada (2026-10-15)

**BLOQUEADO antes de crear/aplicar migración RLS.** El cierre de lecturas
compartidas requiere adaptar RETURNING, escrituras sin contexto de orden y
Realtime por filas; también coordinar Rutinas sin incorporar Fase 162.
Se conserva y guarda la corrección frontend ADMIN/SUPERADMIN ya probada:
11/11 autorizaciones, 30 combinaciones ruta/rol y build correctos, sin cambios
de código desde esa validación. No se certifican concurrencia ni nuevas RLS.
Ver `docs/INVENTARIO-SEGURIDAD-BLOQUEO.md`: dependencias, alcance y rollback.
Cloud no modificado; sin migraciones, datos operativos, push ni despliegue.

## Inventario — búsqueda unificada local (2026-10-15)

Búsqueda paginada por nombre/modelo registrado, serie y MAC en Inventario y álbumes,
con detalle de unidad y regreso al contexto. Reutiliza Supabase de sesión/RLS;
sin migraciones ni cambios de existencias/asignaciones. Fase 162 queda separada.
15/15 pruebas simuladas y navegador local correctos; compilación correcta.
Pendientes: PostgREST real de pruebas, identidades por rol y rendimiento con volumen.
Ver `docs/BUSQUEDA-INVENTARIO.md`. Solo local: sin push ni despliegue.

Validación Cloud de solo lectura 2026-10-15: búsquedas reales, MAC, álbumes,
FK y paginación correctas con identidad privilegiada de diagnóstico; acceso
anónimo sin filas. 32 productos/124 unidades; 82 GET/HEAD sin mutaciones.
15/15 regresiones, navegador sintético y build correctos. **BLOQUEADO**:
faltan sesiones reales SUPERADMIN/ADMIN/TECNICO_RED para certificar RLS;
service_role no se usó para simularlas. Evidencia y riesgos en
`docs/VALIDACION-FINAL-BUSQUEDA-INVENTARIO.md`. Sin cambios de código funcional,
permisos, datos ni migraciones; sin push/despliegue; Fase 162 separada.

Aclaración de permisos 2026-10-15: Inventario administrativo es exclusivo de
ADMIN/SUPERADMIN; TECNICO_RED debe quedar denegado. Revisión localizada:
router también admite SOPORTE/FACTURACION y RLS versionada admite SELECT amplio
para técnicos; Campo comparte servicios/tablas y debe preservarse. Sin sesiones
reales disponibles: **BLOQUEADO**, sin certificar políticas desplegadas.
Pruebas manuales exactas: `docs/VALIDACION-PERMISOS-BUSQUEDA-INVENTARIO.md`.
No se repitieron pruebas funcionales ni se cambiaron código, permisos o datos.

Corrección controlada de acceso 2026-10-15: catálogo Cloud confirmado por
SELECT de metadatos con TLS/READ ONLY (5 tablas, 24 policies, 4 funciones).
Persisten SELECT amplios para técnicos/SOPORTE/FACTURACION y EXECUTE público
del agregado SECURITY DEFINER. Frontend local ahora restringe las cinco rutas,
menú y llamada administrativa a ADMIN/SUPERADMIN; no se tocaron stores de Campo.
11/11 pruebas de autorización, 30 combinaciones ruta/rol y compilación correctas.
Propuesta de separación contextual por orden y riesgos de RETURNING/Realtime/
offline en `docs/INVENTARIO-ACCESO-CONTROLADO.md`; evidencia instalada en
`docs/INVENTARIO-PERMISOS-CLOUD-METADATOS.json`. Sin permisos/DDL/DML remotos,
migraciones, push o despliegue. Fase 162 separada; capa de datos aún pendiente.

## Cierre de sesión 2026-10-14 — Fase 161 y respaldo completo (sin desplegar)

- Implementación local: commit `ccdf94f` (devolución segura de rutinas).
  Último commit confirmado en producción: `b128e42`. No hubo push ni deploy.
- Migración `20261014180000_fase161_devolver_rutinas.sql` pendiente de aplicar.
  Última migración informada visualmente por el usuario: Fase 160.
  `routine_returns` y `return_routine` aún no existen en producción.
- Supabase Cloud: proyecto `mzupdnjegfwmpajywckd`. El usuario confirmó
  «Last Backup: No backups». La conexión Session Pooler con CA y TLS
  `verify-full` fue verificada por el usuario. Credenciales NO guardadas.
- Respaldo completo (esquema + datos), fuera de Git, carpeta privada:
  `C:\Users\USER\AppData\Local\SmartRaycoBackups\fase161_completo_20261014_205657_893d42d4\completo.dump`.
  Tamaño: **36.618.871 bytes**. SHA-256:
  `9287C005D4309FC0E03282936790C61B966BD66FD2640F6466D63E27D7B4FD66`.
- En esa misma carpeta: `completo.sha256`, `inventario.txt`, `origen.json`,
  `revision-independiente.json` y `RECUPERACION.txt`. No confundir con el
  respaldo anterior `fase161_20261014_204444_b8c1e7f4/esquema.dump`, que
  solo contiene estructura (802.571 bytes).
- Aprobado: proyecto/base/usuario correctos en metadatos; archivo legible
  completo mediante `pg_restore --file=/dev/null` (exit 0); inventario con
  datos de clients, profiles, service_contracts, tickets, installations,
  routines, job_assignees y job_work_sessions; funciones, permisos y RLS;
  SHA-256 calculado; ACL sin herencia, solo usuario actual y SYSTEM.
- **No declarar recuperable todavía**: no quedó registrada la salida
  original exit 0 de `pg_dump`. No hay manifiesto final exitoso del script.
  Restauración aislada NO ejecutada: la imagen local `postgres:17` carece
  de `supabase_vault`, presente en el inventario del respaldo.
- Pruebas previas del código: 23/23 SQL aislado y Vue sin errores. No hubo
  devoluciones de prueba en rutinas reales. Scripts privados y diagnósticos
  adicionales están en disco, sin commit; no contienen credenciales.

### Retomar sin repetir investigaciones

1. Leer `docs/DEVOLVER-RUTINAS.md`, `revision-independiente.json` y
   `RECUPERACION.txt` de la carpeta privada. No repetir Docker/TLS ni
   búsquedas de credenciales: usar el procedimiento privado validado.
2. Identificar la categoría final de error de la consola anterior y confirmar
   el resultado original de `pg_dump`; si no puede acreditarse, preparar
   una nueva ejecución privada que registre códigos de salida seguros.
   El archivo actual se conserva; no sobrescribirlo ni borrarlo.
3. Preparar PostgreSQL/Supabase compatible con `supabase_vault` y roles
   necesarios. Ensayar restauración completa sin red, puertos publicados
   ni servicios externos, con montaje del respaldo de solo lectura. No
   excluir extensiones ni usar clientes reales para pruebas funcionales.
4. Documentar resultado de restauración y limitaciones: roles globales,
   archivos Storage y claves externas Vault no van en `pg_dump`.
5. Solo después de validar recuperación y recibir **nueva autorización**:
   aplicar exclusivamente Fase 161; verificar RPC/RLS/PostgREST; luego
   push y frontend `ccdf94f`. No requiere cambios Hono ni APK.

Sesión cerrada sin migraciones, restauraciones de producción ni despliegues.

## Actualización 2026-10-14 — devolución de rutinas (Fase 161, SOLO LOCAL)

Incidencia de campo: una rutina iniciada no ofrecía «Devolver orden».
El formulario y RPC existentes solo cubrían Averías. Preparada migración
`20261014180000_fase161_devolver_rutinas.sql`: tabla `routine_returns`
con historial, RLS de lectura y sin escritura directa para usuarios; RPC
`return_routine` para técnico activo asignado, solo `in_progress`, motivo
obligatorio, registro y liberación completa de cuadrilla en una transacción.
Vuelve a `pending`, estado real de oficina; no toca `closure_notes`.
App Campo reutiliza el formulario; oficina ve marca e historial con fecha
de Perú y puede reasignar mediante el editor existente. Averías/Altas intactas.

Validado: 22 casos SQL más prueba principal (23/23) en PostgreSQL 17 Docker
sin red, con datos sintéticos y policies relevantes reales; `vue-tsc` limpio.
Incluye rollback, concurrencia, RLS, trazabilidad y regresión de Averías/Altas.
No se ejecutó SQL en Supabase, ni push ni deploy. Pendiente validación visual
y operativa. Aplicar SQL antes del frontend: su SELECT incorpora la relación
nueva. FK restrictivas preservan auditoría e impiden borrar rutinas/perfiles
con devoluciones. Procedimiento y rollback: `docs/DEVOLVER-RUTINAS.md`.

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
control NAP en Zonas contando servicios en vez de puertos (13x), de la
edición administrativa de ONTs y su protección del import (13ai/13aj,
desplegadas en `6b8e6a1`) y de la Fase A de automatización PON-zona
(13ak, **commit local, sin push todavía**) —
las anteriores a 13ak **aplicadas/desplegadas**. **VM de producción en
commit `6b8e6a1`**, migraciones de Fase 151 y Fase 150 aplicadas en Supabase
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

## 13ai. Edición administrativa de ONTs — "Editar información" + protección del import (2026-10-13, DESPLEGADO — commit `6b8e6a1`)

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

## 13aj. Corrección de riesgo en 13ai — ONT reemplazada/trasladada ya no hereda identidad ajena (2026-10-13, DESPLEGADO — commit `6b8e6a1`)

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

## 13ak. Fase 3 OLT — Automatización PON–zona–contrato–App Campo: Fase A (2026-10-13, IMPLEMENTADO, commit local sin push)

Objetivo del pedido: integrar los módulos ya existentes (PON↔zona,
Altas/Rutinas de traslado, contratos/NAP, import de ONTs — 13ac/13ad/
13ai/13aj) sin duplicar tablas/relaciones/lógica, determinando primero
la fuente de verdad por tipo de dato, e implementando **solo** la Fase A:
relación automática y VERIFICABLE (no de escritura) entre puerto PON
físico y zona comercial. Fases B/C/D quedan diseñadas, no implementadas
(pedido explícito del usuario).

### Fuente de verdad por tipo de dato (determinado, no inventado)
- **OLT**: serial, slot/puerto, ONU-ID, estado, señal — ya es la fuente
  en `olt_onts`/`fullRunningConfigCommand` (sin cambios).
- **SmartRayco**: equivalencia PON↔zona, cliente, contrato, NAP — vive
  en 2 lugares que **no siempre coinciden**: el nombre de `zones` (p.
  ej. "PON 4 - B6", convención humana) y `olt_onts.zone_id` por ONT
  (editable desde "Editar información", 13ai). El nombre de zona es la
  convención OFICIAL del equipo; `zone_id` por ONT es observación, no
  autoridad — puede quedar desactualizado sin que nadie lo note
  (confirmado con datos reales en 13ac/13ad: un mismo puerto con ONTs
  de 2-3 zonas distintas vinculadas).
- **App Campo**: confirmación de instalación/traslado y evidencias —
  sin cambios, no tocado en esta fase.

### Implementación (pura, sin escritura, sin cambios de esquema)
- **`src/lib/ponZoneMapping.ts`** (nuevo): `parsePonNumberFromZoneName`
  (extrae el número de "PON N - CODE" del nombre de zona, tolerante al
  espaciado real e inconsistente del catálogo — "PON 12  - B4", "PON 20
  -CB"), `buildOfficialPonZoneCatalog` (zona oficial por número de PON,
  detecta números duplicados en el propio catálogo sin elegir al azar),
  `comparePonZone` (zona oficial vs. zona observada —`dominantZone` de
  `computePonOccupancy`, ya existente — nunca decide cuál tiene razón,
  solo clasifica: `match` / `mismatch` / `no_official` / `no_observed` /
  `ambiguous_catalog`).
- **`src/views/olt/OltDetailView.vue`**: la tarjeta "Ocupación por
  puerto PON" (ya existente) ahora muestra, bajo la zona predominante,
  un aviso ⚠ cuando `comparePonZone` da `mismatch` (nombre de la zona
  oficial del catálogo) o `ambiguous_catalog` (cantidad de zonas en
  conflicto), y una nota neutra para `no_official`. Solo lectura — no
  se agregó ningún botón de "corregir" ni escritura.

Cero migraciones, cero columnas nuevas, cero escrituras a OLT/MikroTik/
Supabase. `zones`/`olt_onts` no se tocan.

### Archivos modificados
- `src/lib/ponZoneMapping.ts` (nuevo).
- `src/lib/__tests__/ponZoneMapping.test.ts` (nuevo, 14 casos).
- `src/views/olt/OltDetailView.vue` (import + `ponZoneCatalog` +
  `ponZoneStatus`/`ponZoneMismatchOfficialName`/`ponZoneAmbiguousCount`
  + aviso en la plantilla de "Ocupación por puerto PON").

### Pruebas
- `ponZoneMapping.test.ts` (14 casos nuevos): espaciado real del
  catálogo, ignora nombres no conformes, detecta número de PON
  duplicado en el catálogo, y los 5 resultados de `comparePonZone`
  incl. el caso real confirmado en producción (Barrio 6 = PON 4,
  Violeta/Mayco) y un mismatch con datos reales (slot2/puerto1 = PON 1
  con ONTs de "PON 2 - SM" predominando).
- `npm run test:fetch-timeout` → **84/84** (70 previos + 14 nuevos).
- `npx vue-tsc -p tsconfig.app.json --noEmit` → sin errores.
- Resto de la matriz pedida por el usuario — **ya cubierta por pruebas
  existentes, no duplicada**:
  - ONTs sin contrato / con vínculo correcto / contratos
    multi-servicio → `ontZoneSync.test.ts`, Fase 158
    (`ontZoneNapSync.sql.test.ts`), `jobClosureIdempotency.test.ts`.
  - ONT trasladada / serial reemplazado → casos REEMPLAZO/TRASLADO de
    `oltImportDescriptionGuard.test.ts` (13aj).

### Riesgos y casos que requieren confirmación humana (nunca auto-resueltos)
- **`mismatch`**: el puerto tiene ONTs vinculadas a una zona distinta
  de la oficial del catálogo para ese número de PON. No se puede saber
  desde `comparePonZone` solo (nivel de puerto) cuál cliente/contrato
  específico está mal — para eso haría falta cruzar por ONT individual,
  no por puerto agregado (ver Fase B). Acción recomendada: un
  administrador revisa las ONTs de ese puerto en la tabla de gestión y
  decide si corregir la zona de las ONTs o el nombre de la zona en el
  catálogo.
- **`ambiguous_catalog`**: 2+ zonas declaran el mismo número de PON en
  su nombre — dato sucio del propio catálogo `zones`, no de `olt_onts`.
  Bloquea cualquier comparación confiable para ese número hasta que se
  corrija el nombre de una de las zonas.
- **`no_official`**: el número de PON no tiene ninguna zona en el
  catálogo — puede ser un puerto nuevo sin zona asignada aún, o una
  zona con nombre que no sigue la convención "PON N - ...".
- Las ~400 ONTs de Situación A (heredadas de SmartOLT, sin cliente/
  contrato vinculado) no tienen `dominantZone` individual — siguen
  fuera del alcance de esta fase hasta que se vinculen (13ai).

### Plan de Fases B/C/D (DISEÑO, no implementado — autorización aparte)

**Fase B — discrepancia a nivel de ONT individual, no solo de puerto.**
Hoy `comparePonZone` compara por puerto agregado (`dominantZone`). Fase
B bajaría la comparación a cada `olt_onts` vinculada (tiene
`client_id`/`contract_id`): para cada ONT, calcular su PON físico real
(slot/puerto → `computePonOccupancy`) y comparar contra la zona oficial
de ese PON y contra la zona del contrato/cliente en Supabase. Permite
cumplir el requisito 6 completo (cliente y contrato afectados, serial
de ONT, PON físico, zona esperada, zona registrada, motivo). Sigue
siendo de SOLO LECTURA — una vista o alerta nueva, reutilizando
`olt_onts`/`contracts`/`clients` ya existentes, sin tabla nueva.

**Fase C — cierre de Altas/Rutinas de traslado actualiza PON↔zona sin
doble registro.** Hoy Fase 158 (`assign_contract_nap_sync_ont_zone`) ya
sincroniza `olt_onts.zone_id` cuando se reasigna NAP desde el
contrato — esa transacción es el patrón a extender, no a duplicar. Fase
C extendería esa misma función (o una hermana que la reutilice) para
que, al cerrar una Rutina de traslado desde App Campo (`campo.ts`), si
el traslado implica un NAP/zona nuevo, se dispare la misma
sincronización transaccional en vez de requerir que un admin la
replique a mano después. Requiere decidir: ¿el cierre de la rutina en
campo.ts llama directamente a la función SQL existente (reuso directo,
preferido) o publica un evento que un trigger existente ya consume?
Diseño preferido: llamada directa reusando `assign_contract_nap_sync_ont_zone`
con el `ont_id` ya conocido por la rutina — evita inventar un mecanismo
nuevo de sincronización.

**Fase D — alerta proactiva de discrepancias (no banner pasivo).** Una
vez Fase B exista, un job de solo lectura (similar al ya existente para
alertas OLT) podría listar periódicamente todos los `mismatch`/
`ambiguous_catalog`/casos de Situación A con señal online y mostrarlos
en un panel de "Discrepancias PON-zona-contrato" para revisión
administrativa — nunca auto-corrige. Reutilizaría la infraestructura de
alertas ya existente en el panel OLT (sección "Alertas y
sincronización" de `OltDetailView.vue`) en vez de crear una pantalla
aparte.

Ninguna de B/C/D se implementa en esta sesión — quedan documentadas
para pedir autorización por separado, cada una con su propio nivel de
riesgo (B es solo lectura/bajo riesgo; C toca escritura transaccional
real y necesita las mismas salvaguardas que Fase 158; D depende de B).

### Qué NO se tocó (confirmado)
Sin escrituras a OLT/MikroTik/equipos reales. Sin cambios masivos en
Supabase. Sin cambios automáticos de zonas/contratos/vínculos
existentes — `comparePonZone` nunca escribe. Sin migraciones. Sin
tocar inventario/facturación. Sin push ni despliegue — **commit local
únicamente**, pendiente de autorización para push/deploy.

## 13al. Fase 3 OLT — Fase B: discrepancia PON–zona a nivel de ONT individual (2026-10-13, IMPLEMENTADO, commit local sin push)

Continuación directa de 13ak (Fase A). Pedido explícito del usuario:
identificar, ONT por ONT (no a nivel de puerto agregado), cuáles están
en una zona distinta de la oficial de su PON, mostrando cliente y
contrato reales cuando existan — sin tocar nada, sin tabla nueva.

### Por qué hacía falta además de la Fase A
`comparePonZone` (Fase A) compara la zona OFICIAL del PON contra la
zona **predominante** del puerto (`dominantZone`, agregada sobre todas
las ONTs de ese puerto) — útil como alerta de puerto, pero no dice cuál
cliente específico está mal, y puede generar una lectura equivocada en
un puerto que mezcla zonas por traslados/herencia SmartOLT (un ONT que
sí coincide queda "contaminado" visualmente por el mismatch del
puerto). Fase B evalúa cada ONT por su propio vínculo real.

### Fuente de verdad (ampliada respecto a 13ak)
Se confirmó que el contrato (`service_contracts`) tiene su **propia**
`zone_id` (Fase 38, independiente de `clients.zone_id` que quedó como
dato heredado) — esa es la zona comercial real de la instalación, más
autoritativa que `olt_onts.zone_id` (editable, Fase A). Por eso cada
ONT se compara contra **dos** zonas observadas por separado: la de la
propia ONT y la del contrato vinculado — sin fusionarlas, para que el
administrador vea exactamente dónde está el desalineamiento.

### Implementación (pura, sin escritura, sin cambios de esquema salvo el `select`)
- **`server/src/routes/olt.ts`** (`GET /:id/onts`): el `select` ya
  embebía `clients`/`zones`; se agregó
  `service_contracts(id, contract_number, client_code, status, zones(id, name))`
  — mismo patrón de embed ya usado en el resto del archivo, ninguna
  consulta nueva (PostgREST resuelve el `contract_id` ya existente).
- **`src/stores/olt.ts`**: `OltOnt.service_contracts?` agregado al
  tipo, mismas columnas.
- **`src/lib/ontZoneDiscrepancy.ts`** (nuevo, puro): reutiliza el
  catálogo oficial PON→zona de `ponZoneMapping.ts`
  (`buildOfficialPonZoneCatalog`); `evaluateOntZoneDiscrepancies`
  clasifica cada ONT en `match` / `zone_mismatch` / `unlinked` /
  `no_official` / `ambiguous_catalog`, comparando zona de la ONT y zona
  del contrato por separado contra la oficial. **Nunca llena
  cliente/contrato si `client_id`/`contract_id` no están AMBOS
  presentes** (regla explícita del pedido: no asumir vínculo desde el
  nombre de la OLT) — ni siquiera si `description` sugiere un nombre.
- **`src/views/olt/OntZoneDiscrepancyModal.vue`** (nuevo): tabla de
  solo lectura por puerto — estado, cliente (con link a
  `/clientes/:id/servicios/:contractId`, ruta ya existente), código de
  cliente/contrato, serial, slot/puerto/ONU-ID, zona oficial, zona de
  la ONT, zona del contrato, motivo en texto, y botón "Ver ONT" que
  reutiliza el `OntDetailModal` ya existente (ningún detalle nuevo).
- **`src/views/olt/OltDetailView.vue`**: en cada tarjeta de "Ocupación
  por puerto PON" (Fase A), nuevo botón — "Ver N ONTs con revisión
  pendiente" (rojo, si `ponPortIssueCount > 0`) o "Ver detalle de ONTs
  de este puerto" (gris, si todo coincide) — abre el modal filtrado a
  ese puerto.

### Archivos modificados
- `server/src/routes/olt.ts` (embed de `service_contracts` en
  `GET /:id/onts`).
- `src/stores/olt.ts` (tipo `OltOnt.service_contracts`).
- `src/lib/ontZoneDiscrepancy.ts` (nuevo).
- `src/lib/__tests__/ontZoneDiscrepancy.test.ts` (nuevo, 10 casos).
- `src/views/olt/OntZoneDiscrepancyModal.vue` (nuevo).
- `src/views/olt/OltDetailView.vue` (computed `ontZoneDiscrepancies`,
  `ponPortIssueCount`, `openDiscrepancyModal`,
  `handleViewOntFromDiscrepancy`, botón en la tarjeta de puerto, modal
  montado al final).

### Pruebas
- `ontZoneDiscrepancy.test.ts` (10 casos nuevos): vinculada con todo
  coincidiendo (`match`, con cliente/contrato visibles); vinculada con
  zona de ONT Y de contrato distintas de la oficial (`zone_mismatch`,
  caso real tipo "puerto con varias zonas"); **mismo puerto con 2 ONTs,
  una correcta y otra no** — confirma que no hay falso positivo a nivel
  de puerto; sin `client_id` (Situación A) → `unlinked`, cliente/
  contrato siempre `null`; `contract_id` presente pero `client_id` null
  (dato inconsistente) → sigue `unlinked`, nunca expone medio vínculo;
  **contrato con múltiples servicios** → cada ONT evalúa su propio
  `contract_id`/zona sin mezclarse con el otro servicio del mismo
  cliente; **traslado en curso** → zona de la ONT vieja vs. zona del
  contrato ya actualizada, `zone_mismatch` mostrando ambas sin
  resolver; `no_official`; `ambiguous_catalog` con prioridad sobre
  cualquier otra clasificación; puerto nunca sincronizado → `no_official`
  sin explotar.
- `npm run test:fetch-timeout` → **94/94** (84 previos + 10 nuevos).
- `npx vue-tsc -p tsconfig.app.json --noEmit` → sin errores.
- `npx tsc -p tsconfig.server.json --noEmit` → solo los 2 errores
  preexistentes de `oltProvisioningService.ts` (confirmado con `git
  stash`/`git stash pop` en esta misma sesión — no tocado, ajenos).
- Resto de la matriz pedida — **ya cubierta, no duplicada**: ONT
  trasladada/serial reemplazado por `oltImportDescriptionGuard.test.ts`
  (13aj); sincronización NAP↔zona↔contrato por `ontZoneSync.test.ts` y
  Fase 158 (`ontZoneNapSync.sql.test.ts`).

### Riesgos y casos que requieren confirmación humana (nunca auto-resueltos)
- **`zone_mismatch`**: puede deberse a un traslado real cuyo cierre en
  App Campo todavía no sincronizó `olt_onts.zone_id` (ver Fase C,
  13ak) — el modal muestra ambas zonas sin asumir cuál es la correcta.
- **`unlinked`**: ONT de Situación A o con vínculo parcial
  (contract_id sin client_id, dato inconsistente que no debería
  ocurrir con el flujo actual de Fase 2/37 pero se maneja igual sin
  romper) — requiere que un administrador complete el vínculo desde el
  flujo ya existente, no desde este modal (solo lectura).
- **`ambiguous_catalog`**: idéntico a Fase A, bloquea cualquier
  comparación confiable para ese número de PON hasta corregir el
  nombre de una de las zonas duplicadas en el catálogo.
- El embed `service_contracts` en `GET /:id/onts` agrega una tabla más
  al `select` existente — con ~700+ ONTs ya en producción, vigilar que
  el tiempo de respuesta del listado no se degrade perceptiblemente
  (no se midió formalmente en esta sesión; es un `select` adicional de
  PostgREST, no una subconsulta N+1 — riesgo bajo, pero no confirmado
  con datos reales de producción).

### Qué NO se tocó (confirmado)
Mismas garantías que 13ak: sin escrituras a OLT/MikroTik/equipos
reales, sin cambios en Supabase salvo la consulta de lectura ampliada,
sin migraciones, sin modificar zonas/contratos/vínculos existentes, sin
inventario/facturación, sin push ni despliegue — **commit local
únicamente**.

**Siguiente paso ya anunciado por el usuario**: Fase C — sincronización
automática de traslados desde App Campo mediante la lógica
transaccional existente de Fase 158 (`assign_contract_nap_sync_ont_zone`).

## 13am. Fase 3 OLT — Fase C: automatización de traslados desde App Campo (2026-10-13, IMPLEMENTADO, commit local sin push)

Continuación de 13ak/13al. Objetivo: que al cerrar un traslado desde App
Campo, SmartRayco reutilice los datos ya confirmados por el técnico para
mantener coherentes contrato/zona/NAP/ONT, sin que un administrador tenga
que reingresarlos a mano en otro módulo después.

### PASO 1 — Verificación dirigida (hecha antes de escribir código)

**¿Fase 158 está realmente aplicada en producción?** Confirmado por SQL de
solo lectura contra Supabase (`information_schema.routines` +
`pg_get_functiondef`), no asumido por la existencia del archivo en Git:
`assign_contract_nap_sync_ont_zone` y `assign_provisioning_nap` existen y
están desplegadas tal cual en el repo. El VM de producción sigue en
`6b8e6a1` (sin cambios desde 13al) — Fase A/B siguen en commit local, sin
desplegar.

**Hallazgo clave (gap real, no asumido):** "Rutina por traslado" no existe
como tal en el esquema — `RoutineCategory` no tiene ningún valor de
traslado, y la plantilla de cierre de App Campo
(`CampoTrabajoDetailView.vue`) **nunca envía `zoneId` ni `napElementoId`
para `jobType === 'routine'`** (siempre `null`, confirmado en código). El
traslado real de un servicio hoy se cierra como **ticket** de categoría
`reconnection_relocation` ("Reconexión / Traslado"), cuyo formulario de
cierre SÍ permite elegir una caja NAP distinta (`napElementoId`, opcional,
"si recableaste") pero **nunca pide una zona nueva** (`zoneId` solo se
envía para instalaciones). Por eso, hasta ahora, un traslado cerrado en
campo actualizaba el puerto NAP pero dejaba tanto `service_contracts.zone_id`
como `olt_onts.zone_id` desactualizados — exactamente el gap descrito por
el usuario.

**Dato suficiente para automatizar de forma segura, sin pedir nada nuevo al
técnico:** cada caja NAP ya tiene su propia `zone_id` (`infra_elementos`,
misma fuente que usa ZonasView/el selector de Altas). Cuando el técnico
elige una caja NAP distinta al cerrar un traslado, esa elección física YA
es la confirmación de la zona real — pedirle que además elija una zona en
un segundo campo sería duplicar el mismo dato dos veces (y, si se
contradicen entre sí, generaría exactamente el tipo de `mismatch` que
detecta la Fase B). Por eso la solución mínima deriva la zona de la caja
NAP elegida en vez de agregar un selector de zona nuevo al formulario de
ticket — no hacía falta ninguna validación/confirmación adicional en la UI.

### PASO 2 — Implementación mínima

- **`src/lib/ontZoneSync.ts`** (puro, ampliado): `OLT_ZONE_SYNC_ROLES` +
  `canSyncOltZone(role)` (antes vivía duplicado como constante local en
  `ClientServiceDetailView.vue`, ahora centralizado — ese archivo solo
  importa); `resolveClosureTargetZoneId({explicitZoneId, napElementoId,
  napZoneId})` (zona explícita gana siempre —instalaciones—; si no hay,
  usa la zona de la caja NAP elegida —tickets/traslados—; sin ninguna de
  las 2, `null`, no inventa nada); `describeOntZoneSyncOutcome(result)`
  traduce el resultado crudo de la RPC de Fase 158 a un mensaje para
  humanos (`null` = nada que avisar; "ambiguo:N" y cualquier motivo no
  reconocido SÍ se avisan siempre, nunca se callan).
- **`src/stores/campo.ts`** (`performClosureSubmitInner`): la zona a
  aplicar ahora es `resolveClosureTargetZoneId(...)` en vez de solo
  `input.zoneId` — sin cambio de comportamiento para instalaciones
  (siempre traen `zoneId` explícito). Para el bloque de NAP: si
  `jobType !== 'installation'` (deliberado — Altas quedan intactas, ver
  "Qué NO se tocó") y el rol de quien cierra es uno de los 3 permitidos
  (`canSyncOltZone`), usa `fibra.assignContractToNapAndSyncOntZone`
  (Fase 158, transaccional, por `contract_id` exacto — nunca por
  `client_id` solo) en vez de `fibra.assignContractToNap` (la versión
  que solo asigna NAP); si el rol no alcanza, sigue el camino de
  siempre, sin cambios. El resultado (`ontZoneSynced`/`ontZoneSkipReason`)
  se traduce con `describeOntZoneSyncOutcome` y se devuelve como
  `ontZoneWarning` hasta `submitClosure` — `submitFromQueued` (reintentos
  en segundo plano, sin técnico mirando la pantalla) solo lo deja en
  `console.warn`, igual que el resto de avisos best-effort ya existentes
  en este store.
- **`src/views/clientes/ClientServiceDetailView.vue`**: importa
  `OLT_ZONE_SYNC_ROLES` compartida en vez de su copia local — mismo
  comportamiento, una sola fuente.
- **`src/views/campo/CampoTrabajoDetailView.vue`**: nuevo
  `closeOntZoneWarning`, mostrado como aviso ámbar junto al resultado del
  cierre; si hay aviso, la redirección automática a `/campo` espera 5s en
  vez de 1.2s para que el técnico llegue a leerlo.

### Por qué esto ya cumple los requisitos de integridad pedidos
- **`contract_id` exacto, nunca `client_id` solo**: `assign_contract_nap_sync_ont_zone`
  busca la ONT por `contract_id` (confirmado leyendo su definición real en
  Supabase, ver PASO 1) — un cliente con 2 servicios nunca mezcla sus ONTs.
- **Dobles asignaciones de NAP**: `assign_provisioning_nap` ya bloquea con
  `FOR UPDATE` la fila del puerto antes de ocuparlo y libera el puerto
  anterior del mismo contrato dentro de la misma transacción — sin cambios
  aquí, se reutiliza tal cual.
- **Idempotencia ante reintentos**: la RPC no reescribe si la zona ya
  coincide (`IS DISTINCT FROM`) y `assign_provisioning_nap` devuelve el
  mismo puerto si ya estaba ocupado por ese mismo contrato — un reintento
  del cierre completo (patrón ya existente, `jobClosureIdempotency.ts`)
  no duplica ni corrompe nada.
- **ONT reemplazada o que cambió de PON — nunca se asume**: esta fase
  JAMÁS lee ni escribe serial/posición/PON físico — solo actúa sobre la
  ONT que *ya* tiene ese `contract_id` en `olt_onts` (vínculo que establece
  el flujo de aprovisionamiento/import existente, con sus propias
  validaciones — Fase 2/13aj). Si el contrato tiene 0 o 2+ ONTs
  vinculadas, la RPC devuelve `sin_ont_vinculada`/`ambiguo:N` y **no toca
  ninguna** — nunca adivina cuál es "la" ONT nueva.
- **Discrepancias informadas, no asumidas**: `describeOntZoneSyncOutcome`
  nunca se calla un caso `ambiguo` — queda en el mensaje devuelto al
  técnico (`ontZoneWarning`) y en consola para los reintentos en segundo
  plano.
- **No se marca como sincronizado si algo obligatorio falla**: si la RPC
  (o la versión sin Fase 158) lanza una excepción real (NAP llena,
  contrato/cliente no coinciden, rol sin permiso), la excepción sigue
  propagándose igual que antes de esta fase — el ticket/rutina **no** se
  marca `resolved`/`completed` (ese paso ocurre después, en el mismo
  `performClosureSubmitInner`). Comportamiento sin cambios, solo se
  reutiliza.

### Archivos modificados
- `src/lib/ontZoneSync.ts` (`OLT_ZONE_SYNC_ROLES`, `canSyncOltZone`,
  `describeOntZoneSyncOutcome`, `resolveClosureTargetZoneId`).
- `src/lib/__tests__/ontZoneSync.test.ts` (12 casos nuevos).
- `src/stores/campo.ts` (`performClosureSubmitInner`/
  `performClosureSubmit`/`submitClosure`/`submitFromQueued`).
- `src/views/clientes/ClientServiceDetailView.vue` (reusa la constante
  compartida, sin cambio de comportamiento).
- `src/views/campo/CampoTrabajoDetailView.vue` (`closeOntZoneWarning`).

### Pruebas
- `ontZoneSync.test.ts` (12 casos nuevos): `canSyncOltZone` para los 3
  roles + roles no permitidos + null/undefined; `describeOntZoneSyncOutcome`
  para sincronizado/`sin_ont_vinculada`/`null`/`ambiguo:N`/motivo
  desconocido; `resolveClosureTargetZoneId` para **zona explícita gana**
  (Alta), **traslado sin selector de zona propio → deriva de la caja NAP**,
  **traslado DENTRO de la misma zona** (caso explícitamente pedido:
  devuelve la misma zona, nunca `null`), **caja NAP sin zona propia →
  `null`, nunca inventa una**, **avería normal sin recableado → `null`**,
  y **reintento → mismo resultado** (idempotente por ser función pura).
- `npm run test:fetch-timeout` → **106/106** (94 previos + 12 nuevos).
- `npx vue-tsc -p tsconfig.app.json --noEmit` → sin errores.
- `npx tsc -p tsconfig.server.json --noEmit` → solo los 2 errores
  preexistentes de `oltProvisioningService.ts` (confirmado otra vez con
  `git stash`/`git stash pop` en 13ak — ningún archivo de `server/` se
  tocó en esta fase, backend sin cambios).
- Resto de la matriz pedida — **ya cubierta por pruebas existentes al
  nivel correcto (RPC real de Postgres, no lógica de UI), citada sin
  duplicar**:
  - **Traslado a otra zona, múltiples servicios, fallo parcial
    (transaccional)**: `server/tests/ontZoneNapSync.sql.test.ts` — casos
    "caso feliz", "cliente con 2 servicios", "TRANSACCIONAL: si falla la
    actualización de la ONT, la reserva NAP también se revierte".
  - **Reemplazo de ONT / ambigüedad**: mismo archivo, caso "ambiguo: 2
    ONTs con el mismo contract_id — ninguna se toca" — es la protección
    real contra actuar sobre la ONT equivocada; a nivel de import/
    posición física, además cubierto por `oltImportDescriptionGuard.test.ts`
    (13aj, REEMPLAZO/TRASLADO).
  - **Permisos (SUPERADMIN/ADMIN/TECNICO_RED sí, SOPORTE/FACTURACION/
    anónimo no)**: mismo archivo, caso "permisos".
  - **Reintento/idempotencia de la reserva NAP**: `src/lib/__tests__/napAssignment.test.ts`
    ("successful and repeated requests rely on the transaction and
    return its port") + `jobClosureIdempotency.test.ts` (idempotencia del
    cierre completo, fotos/firma).
  - **Concurrencia**: `server/tests/napAssignment.sql.test.ts`, caso real
    con 2 conexiones Postgres simultáneas, "two connections compete for
    last slot: loser preserves its old assignment" — misma función
    (`assign_provisioning_nap`) que envuelve Fase 158, sin cambios.

### Riesgos y limitaciones (documentadas, no bloqueantes)
- **Las "Rutinas" (jobType `routine`) no se benefician todavía** — la UI
  de cierre de una rutina nunca envía `zoneId`/`napElementoId` hoy
  (confirmado en código, no es un supuesto). El código de `campo.ts` ya
  está preparado para ese caso (no distingue por `jobType` salvo excluir
  explícitamente `installation`), pero es código inerte hasta que la
  pantalla de cierre de Rutinas agregue un selector de caja NAP — **no se
  tocó esa UI en esta fase** (no estaba roto, sería ampliar alcance sin
  pedido explícito). El traslado real automatizable HOY es el ticket de
  categoría `reconnection_relocation`.
- **Altas (instalaciones) deliberadamente NO usan la vía Fase 158
  todavía** — restricción explícita del usuario ("no afectar altas").
  Técnicamente sería seguro extenderlo (Altas siempre traen `zoneId`
  explícito y ya validado, Fase 2 está cerrada y probada) pero se dejó
  fuera de alcance a propósito; evaluar en una fase futura si el usuario
  lo autoriza.
- **El aviso de discrepancia (`ontZoneWarning`) solo llega al técnico que
  cierra interactivamente** — un reintento en segundo plano
  (`submitFromQueued`, cierre offline que sincroniza después) solo lo
  deja en `console.warn`, nadie en campo lo ve en ese momento. Igual que
  el resto de avisos best-effort de este store (ningún cambio de
  política, mismo criterio ya aceptado).
- Un caso `ambiguo:N` o cualquier motivo no reconocido sigue necesitando
  revisión manual de un administrador en el panel OLT — por diseño
  (regla 8 de la migración OLT, CLAUDE.md: ante discrepancia, detener y
  pedir verificación, nunca adivinar).

### Qué NO se tocó (confirmado)
Sin escrituras a OLT/MikroTik/PPPoE. Sin borrar información anterior ni
perder trazabilidad (los puertos NAP liberados quedan como fila `estado=
'libre'`, nunca se eliminan — mismo comportamiento ya existente). Sin
afectar averías normales (ningún cambio de comportamiento cuando no se
elige una caja NAP nueva, que es la inmensa mayoría de los tickets). Sin
afectar Altas (excluidas a propósito del nuevo camino, ver riesgos). Sin
inventar relaciones por nombre de cliente ni por posición física — todo
pasa por `contract_id`/`client_id` reales. Sin migraciones (ninguna tabla
ni columna nueva). Sin push, sin despliegue — **commit local únicamente**.

**Siguiente paso recomendado**: validar en campo con un traslado real de
categoría `reconnection_relocation` (técnico elige una caja NAP en otra
zona al cerrar) antes de autorizar push/deploy; luego decidir si se
amplía a Rutinas (requiere UI nueva) y/o a Altas (requiere autorización
explícita, hoy fuera de alcance).

## 13an. Fase 3 OLT — Fase C (continuación): "Traslado de servicio" en Rutinas — DETENIDO, falta autorizar migración mínima (2026-10-13, ver 13ao — migración ya autorizada y aplicada)

Continuación de 13am, a pedido explícito del usuario: completar el flujo
"Traslado de servicio" de punta a punta (creación de la rutina → cierre en
App Campo), reutilizando el subtipo/catálogo de Rutinas ya existente
(Fase 129) en vez de crear un módulo nuevo.

### Verificación dirigida (antes de escribir nada más)
Confirmado por SQL de solo lectura contra Supabase
(`information_schema.columns`), no asumido: la tabla `routines` **no
tiene ninguna columna que identifique un contrato/servicio específico**
(no hay `contract_id`). Sí existen y son reutilizables sin ningún cambio
de esquema: `zone_id`, `nap_elemento_id`, `direccion_destino` (ya usados
como "destino" en rutinas de visita comercial, Fase 129 — misma idea para
el destino de un traslado) y `client_id`. `work_order_closures.ont_serial`
también ya existe y nunca se usa para rutinas hoy — sirve tal cual para
que el técnico registre el serial nuevo si marca "ONT reemplazada", sin
columna nueva.

El único dato que un traslado necesita y que **no existe en ningún lado
de `routines`** es el contrato específico a trasladar — imprescindible
(requisito 2 del usuario) porque un cliente puede tener más de un
servicio (Fase 37) y nunca se debe elegir "el" contrato por `client_id`
solo (regla permanente 10 de CLAUDE.md, agregada en 13am).

### Decisión: DETENER la implementación de escritura, presentar la modificación mínima

Por instrucción explícita del usuario ("si la estructura actual de
Rutinas no permite guardar estos datos... detener la implementación de
escrituras y presentar primero la modificación mínima necesaria") — no se
implementó el selector de contrato, los campos nuevos de App Campo ni la
lógica de cierre, porque no tienen dónde persistir el contrato sin esa
columna (sería código a medio terminar, sin un destino real en la BD).

**Migración mínima propuesta** (escrita en el repo, **NO aplicada en
Supabase todavía** — requiere pedido explícito del usuario en un turno,
regla 16 de CLAUDE.md):
`supabase/migrations/20261013170000_fase159_routines_contract_id.sql`

```sql
alter table public.routines
  add column if not exists contract_id uuid references public.service_contracts (id) on delete set null;
create index if not exists idx_routines_contract on public.routines (contract_id) where contract_id is not null;
```

Columna nullable, mismo patrón FK ya usado para esta misma necesidad en
`olt_onts`/`inventory_units`/`descuentos_compensacion` (Fase 37) — no
afecta ninguna rutina ni subtipo existente. Las políticas RLS de
`routines` son por fila (no por columna), así que no necesitan cambios:
`routines_update_staff` ya permite que el técnico asignado edite
cualquier columna de su propia rutina no completada.

### Lo que SÍ se implementó ya (sin riesgo, sin cambio de esquema)
- **`src/views/soporte/RutinasView.vue`**: nuevo subtipo
  `traslado_servicio` ("Traslado de servicio") dentro del grupo ya
  existente `servicio_cliente` (junto a `tv_box`/`mesh`/`inspeccion`) —
  cumple el requisito 1 ("incorporar en los tipos/subtipos existentes,
  sin crear un módulo nuevo") sin tocar la tabla. Visible en el selector
  de Subtipo del modal de creación/edición ya existente.
- `npx vue-tsc -p tsconfig.app.json --noEmit` → sin errores.

### Lo que queda pendiente de la columna (diseñado, no implementado)
Una vez autorizada y aplicada la migración:
1. **`src/types/domain.ts`**: `Routine.contract_id: string | null` +
   embed `service_contracts` en `ROUTINE_SELECT` (routines.ts) para traer
   contrato/zona/dirección actuales — mismo patrón que el embed de Fase B
   en `olt_onts`.
2. **`RutinasView.vue`**: selector de contrato (no solo cliente) cuando
   `subtipo === 'traslado_servicio'` — listar los `service_contracts`
   activos del cliente elegido, obligatorio si tiene más de uno (cumple
   requisito 2). `zone_id`/`nap_elemento_id`/`direccion_destino` del
   formulario pasan a representar el DESTINO del traslado (reutilizando
   los mismos campos que ya usa una visita comercial, sin duplicarlos).
3. **App Campo (`CampoTrabajoDetailView.vue`), solo para esta rutina**:
   sección "Traslado de servicio" que muestra en solo lectura la
   dirección/zona/NAP/puerto/ONT ACTUALES (consultados en vivo por
   `contract_id`, mismo cruce que `ontZoneDiscrepancy.ts` de la Fase B —
   reutilizar, no duplicar) junto al formulario YA existente de
   zona/NAP de cierre (reutilizando `closureForm.zoneId`/`napElementoId`,
   sin pedir el dato dos veces) + radio "Conservar ONT" / "ONT
   reemplazada" (si reemplazada, reusa el campo `ontSerial` que
   `ClosureInput`/`work_order_closures` ya tienen, sin columna nueva).
4. **`src/stores/campo.ts`**: extender `resolveClosureTargetZoneId`
   (Fase C) para que, cuando `jobType === 'routine'` y la rutina es un
   traslado, la sincronización de Fase 158 use `routine.contract_id` en
   vez de `input.contractId` generico (hoy las rutinas nunca traen
   `contractId`, ver `fromRoutine` en campo.ts) — **sin modificar
   vínculos si el técnico marcó "ONT reemplazada"**: en ese caso se
   omite la llamada a `assignContractToNapAndSyncOntZone` y se deja un
   aviso explícito para revisión administrativa (cumple requisito 6: no
   asumir que es el mismo equipo, no aprovisionar, no tocar la OLT).
5. Pruebas nuevas: selección de contrato obligatoria con 2+ servicios,
   cierre con "Conservar ONT" (sincroniza) vs "ONT reemplazada" (no
   sincroniza, solo avisa), reintento idempotente, verificación de que
   rutinas normales/averías/altas no cambian en nada (mismo criterio que
   13am).

### Riesgos si se continuara sin la migración
Guardar el contrato en un campo de texto libre existente
(`description`/`closure_notes`) para evitar la migración fue considerado
y descartado: rompería la regla "no inventar relaciones" (sería
re-parsear texto para encontrar un UUID) y el cruce con Fase 158
necesita un `contract_id` real y confiable, no una convención informal.

**Estado real: Fase C sigue INCOMPLETA de punta a punta** — el camino ya
automatizado (ticket `reconnection_relocation`, 13am) funciona; el camino
"Rutina de traslado de servicio" pedido en este turno está diseñado pero
bloqueado en el primer paso de escritura (falta la columna). No se
declara terminado, según lo pedido explícitamente por el usuario.

## 13ao. Fase 3 OLT — Fase C: migración Fase 159 aplicada + flujo "Traslado de servicio" completado localmente (2026-10-13, IMPLEMENTADO, commit local sin push)

Continuación de 13an, autorizado explícitamente por el usuario: aplicar
**solo** la migración Fase 159 en Supabase producción, verificar, y
continuar localmente con el selector de contrato y el formulario de
traslado en App Campo.

### Migración aplicada y verificada
1. **Verificación previa** (SQL de solo lectura): `contract_id` NO
   existía en `routines`; `list_migrations` confirmó que `fase159` no
   estaba en la lista (última aplicada: `fase158`).
2. **Respaldo/rollback**: tabla de 27 filas — cambio aditivo (columna
   nullable, sin default); rollback trivial si hiciera falta:
   `alter table public.routines drop column if exists contract_id;`
   (arrastra la FK y el índice).
3. **Aplicada** con `apply_migration` — versión registrada:
   `20261013203239`. Archivo local renombrado a
   `supabase/migrations/20261013203239_fase159_routines_contract_id.sql`
   para que el repo quede igual a lo realmente aplicado.
4. **Validación posterior** (todos los puntos pedidos, confirmados por
   SQL de solo lectura):
   - `contract_id` existe, `uuid`, `is_nullable = YES`. ✅
   - FK `routines_contract_id_fkey` → `service_contracts(id) ON DELETE
     SET NULL`. ✅
   - Índice `idx_routines_contract` (parcial, `WHERE contract_id IS NOT
     NULL`) existe. ✅
   - Las 27 rutinas existentes siguen intactas (`count(*) = 27`,
     `count(contract_id) = 0` — ninguna la usa todavía, como se
     esperaba). ✅
   - Creación/cierre de rutinas normales: código no tocado para esos
     casos (ver "Qué NO se tocó" más abajo) — sin cambio de
     comportamiento. ✅
5. **Solo esa migración** — no se aplicó ninguna otra pendiente.

### Implementación local (sin push/deploy, sin traslados reales ejecutados)

**1. Catálogo de Rutinas** (ya hecho en 13an, sin cambios): subtipo
`traslado_servicio` dentro de `tipo_rutina = 'servicio_cliente'`.

**2. Selección de contrato obligatoria** (`src/views/soporte/RutinasView.vue`):
al elegir cliente + subtipo "Traslado de servicio", se cargan sus
`service_contracts` (`contractsStore.fetchContractsByClient`, ya
existente) y se exige elegir uno exacto antes de guardar — nunca se
asume "el primero" ni se eligen por `client_id` solo. La zona/NAP/
dirección **nuevas** NO se piden aquí — se confirman al cerrar en App
Campo (mismo criterio que un traslado de ticket, 13am), evitando pedir
el mismo dato dos veces.

**3-4. App Campo, solo para esta rutina** (`CampoTrabajoDetailView.vue`,
`isTrasladoRoutine` computado — nunca se infiere por título/descripción,
solo por `tipo_rutina`+`subtipo` exactos vía
`isTrasladoServicioRoutine`):
- **Estado actual, solo lectura**: dirección/zona vía `activeContract`
  (mecanismo YA existente que resuelve el contrato correcto por
  `trabajo.contractId`, sin código nuevo — solo se corrigió
  `fromRoutine` en `campo.ts` para que `contractId = r.contract_id` en
  vez de `null` fijo); caja NAP/puerto vía `findContractNapId` (ya
  existente) + `fibra.napPuertosPorElemento`; ONT vía
  `resolveCurrentOntForContract` (nuevo, puro, mismo criterio de "nunca
  elegir al azar" que `resolveOntForZoneSync`) sobre
  `oltStore.fetchOntsByClient` (ya existente).
- **Confirmar destino nuevo**: reutiliza los selects de Zona/Caja NAP
  que ya existían para instalaciones (`catalogs.zones`,
  `installNapOptions`, `onInstallZoneChange`) — ningún componente
  nuevo. El puerto se asigna automáticamente al primero libre de la
  caja elegida, igual que en toda Alta (nunca se elige manualmente, es
  consistente con el resto del sistema). Dirección nueva: campo de
  texto libre opcional, reutiliza `service_contracts.installation_address`.
- **"Conservar ONT" / "ONT reemplazada"**: radio nuevo; si "reemplazada",
  pide el serial nuevo (reutiliza `ClosureInput.ontSerial`/
  `work_order_closures.ont_serial`, columnas ya existentes — **cero
  columnas nuevas** para esto). Nunca vincula ni aprovisiona nada en la
  OLT — solo queda registrado para revisión administrativa.

**5. Cierre reutiliza Fase 158** (`src/stores/campo.ts`): como ya
corrige `fromRoutine`, el `contractId` que llega a
`performClosureSubmitInner` ya es el `contract_id` exacto de la rutina
— la lógica de Fase C existente (13am) se activa SOLA, sin
"sabor especial" por `jobType === 'routine'`. Único agregado real:
`input.ontReplaced` — si es `true`, **se omite** la llamada a
`assignContractToNapAndSyncOntZone` (se usa la versión que solo asigna
NAP) y se devuelve un aviso explícito (`ontZoneWarning`) en vez de
intentar sincronizar la zona de una ONT que puede ya no ser la misma —
cumple el requisito 6 ("no asumir que es el mismo equipo... no
aprovisionar, no tocar la OLT") sin añadir ninguna lógica de
reasignación real. El puerto NAP SÍ se reasigna igual en ambos casos
(hecho físico independiente de cuál ONT hay del otro lado).

**7. Historial, sin tabla nueva**: `buildTrasladoHistorialNote` (puro,
`src/lib/routineTraslado.ts`) construye una línea de texto ("Traslado de
servicio: dirección anterior (zona anterior) → dirección nueva (zona
nueva). ONT conservada/reemplazada.") que se antepone a las notas del
técnico y queda en `closure_notes` (tanto en `routines` como en
`work_order_closures`, columnas ya existentes) — decisión consciente de
NO crear una tabla de auditoría aparte (ver riesgos).

### Archivos modificados
- `supabase/migrations/20261013203239_fase159_routines_contract_id.sql`
  (aplicada; renombrada desde el nombre propuesto en 13an).
- `src/types/domain.ts` (`Routine.contract_id` + embed
  `service_contracts`).
- `src/stores/routines.ts` (`ROUTINE_SELECT` con el embed).
- `src/views/soporte/RutinasView.vue` (selector de contrato +
  validación).
- `src/lib/routineTraslado.ts` (nuevo, puro):
  `isTrasladoServicioRoutine`, `resolveCurrentOntForContract`,
  `buildTrasladoHistorialNote`.
- `src/lib/__tests__/routineTraslado.test.ts` (nuevo, 12 casos).
- `src/stores/campo.ts` (`fromRoutine` corregido; `ClosureInput.ontReplaced`/
  `installationAddress`; gating de la vía Fase 158; combinación de la
  escritura zona+dirección en un solo `updateContract`).
- `src/lib/offlineQueue.ts` (`QueuedClosure.ontReplaced`/
  `installationAddress`, mismo patrón que el resto de campos).
- `src/views/campo/CampoTrabajoDetailView.vue` (`isTrasladoRoutine`,
  carga de ONTs/infra para el traslado, sección de template completa,
  validaciones, nota de historial, payload de cierre).

### Pruebas
- `routineTraslado.test.ts` (12 casos nuevos): `isTrasladoServicioRoutine`
  (combinación exacta tipo+subtipo, nunca por subtipo solo);
  `resolveCurrentOntForContract` (ninguna/una/ambigua — nunca elige al
  azar); `buildTrasladoHistorialNote` (conservada, reemplazada con/sin
  serial, sin datos previos registrados).
- `npm run test:fetch-timeout` → **118/118** (106 previos + 12 nuevos).
- `npx vue-tsc -p tsconfig.app.json --noEmit` → sin errores.
- Resto de la matriz pedida — **cubierta por diseño + pruebas ya
  existentes, citada sin duplicar**:
  - **Fallo parcial/transaccional, permisos, concurrencia, zona ya
    coincide**: `server/tests/ontZoneNapSync.sql.test.ts` /
    `napAssignment.sql.test.ts` (13am) — la vía que usa el cierre de
    traslado es EXACTAMENTE la misma función SQL, sin variante nueva.
  - **Reintento/idempotencia del cierre (fotos/firma/no duplicar
    movimientos)**: `jobClosureIdempotency.test.ts` (ya existente, sin
    cambios en esa parte del flujo).
- **No probado todavía de punta a punta con datos reales** (explícitamente
  no autorizado en este turno: "no ejecutar todavía traslados reales"):
  crear una rutina de traslado real, abrirla en App Campo en un
  dispositivo/navegador real, y cerrarla — queda como siguiente paso
  antes de autorizar push/deploy. **No se declara el flujo "funcionando
  de punta a punta" sin esa verificación real**, tal como pidió el
  usuario explícitamente.

### Riesgos (documentados, no bloqueantes)
- **Nota de historial con dato "anterior" potencialmente desactualizado
  en un reintento dentro de la misma sesión**: `activeContract` se carga
  una sola vez al abrir la pantalla; si un primer intento de cierre ya
  actualizó la zona del contrato pero falló en un paso posterior, un
  reintento SIN recargar la página seguiría mostrando la zona vieja como
  "anterior" en la nota (cosmético — no afecta qué zona queda
  finalmente guardada, que sigue siendo correcta e idempotente). Se
  documenta en vez de resolverse ahora (requeriría refrescar el
  contrato en cada intento, complejidad no justificada para este caso
  límite).
- **"ONT reemplazada" nunca vincula el nuevo serial a ningún lado** — a
  propósito (requisito 6). El `ont_serial` queda únicamente en
  `work_order_closures`/`closure_notes` como registro; el re-vínculo
  real (actualizar `olt_onts` con el serial correcto) sigue siendo un
  paso manual de un administrador vía el panel OLT o el import
  existente — no se automatizó ni se planea automatizar sin una fase
  aparte con su propia validación.
- **Sin tabla de auditoría de traslados** — la única "memoria" del
  traslado es la nota de texto en `closure_notes` y el propio cambio de
  `zone_id`/`installation_address` del contrato. Si en el futuro se
  necesita reportar "cuántos traslados hubo este mes" de forma
  estructurada, esto no lo permite directamente (habría que buscar por
  texto) — evaluar una tabla dedicada en una fase futura si se vuelve
  una necesidad real, no se justificaba crearla solo para esto ahora.
- **Rutinas que no son traslado**: cero cambios de comportamiento
  (verificado línea por línea — todas las ramas nuevas están
  condicionadas por `isTrasladoRoutine`/`jobType==='ticket'`/
  `jobType==='installation'`, los mismos gates que ya existían).

### Qué NO se tocó (confirmado)
Sin escrituras a OLT/MikroTik/PPPoE. Sin aprovisionamiento. Sin
modificar vínculos `contract_id`→`olt_onts` automáticamente ante "ONT
reemplazada". Sin traslados reales ejecutados contra producción (solo
pruebas unitarias con datos sintéticos). Sin otra migración aplicada
además de Fase 159. Sin afectar rutinas/averías/altas normales. Sin
push ni despliegue — **commit local únicamente**.

**Siguiente paso recomendado**: probar el flujo completo con una rutina
de traslado real (crear → asignar a un técnico → abrir en App Campo →
confirmar destino → cerrar) en un entorno de prueba antes de pedir
autorización de push/deploy — recién ahí se puede declarar Fase C
terminada de punta a punta, tal como exigió el usuario.

## 13ap. Fase 3 OLT — Fase C: revisión puntual de 3 riesgos antes de push/deploy (2026-10-13, IMPLEMENTADO, commit local sin push)

Revisión puntual pedida por el usuario sobre el commit `ea58293` (Fase
159), antes de autorizar push/deploy — 3 puntos exactos, sin auditoría
general.

### 1. Historial: "anterior" desactualizado en un reintento
**Causa real confirmada** (no asumida): `activeContract` se carga una
sola vez al abrir la pantalla y nunca se refresca durante la sesión —
dentro de la MISMA sesión, un reintento ya era seguro. El riesgo real
era un reintento vía una **página nueva** (técnico cierra y reabre la
rutina) después de un fallo parcial donde el primer intento ya alcanzó
a escribir la zona/NAP nueva en el contrato: ahí `activeContract`
reflejaría esa zona YA actualizada como si fuera "la actual", y una nota
nueva diría "sin cambio" — pisando (por `upsert`, no `append`) la nota
correcta del primer intento.

**Corrección**: `resolveTrasladoAnteriorSnapshot` (nueva, pura,
`routineTraslado.ts`) — el estado "anterior" (dirección, zona **y NAP**,
el pedido mencionaba ambas) se congela la primera vez que se abre la
pantalla para esa rutina y se persiste con el mismo mecanismo de
borradores ya usado para `closureForm` (`formDrafts.ts`, IndexedDB,
sobrevive a cerrar la app). Cualquier apertura posterior — misma sesión
o una nueva — reutiliza ese snapshot congelado, nunca lo recalcula. Se
borra recién cuando el cierre termina con éxito
(`clearDraft(trasladoSnapshotKey)`, junto al borrador normal).
"No duplicar notas de cierre" ya estaba garantizado (la nota se
`upsert`ea, nunca se concatena) — se agregó una prueba explícita que lo
confirma.

### 2. ONT reemplazada: que quede claro que NO vincula ni aprovisiona
**Verificado**: ningún código de este flujo llama a una función que
escriba en la OLT real o en MikroTik — solo `fibra.assignContractToNap`/
`assignContractToNapAndSyncOntZone` (RPCs de Supabase sobre
`fo_nap_puertos`/`service_contracts`/`olt_onts.zone_id`) y
`contractsStore.updateContract` (Supabase). La garantía de "nunca
sincroniza automáticamente si la ONT fue reemplazada" se extrajo a una
función pura y TESTEADA: `shouldUseTransactionalNapSync`
(`ontZoneSync.ts`) — devuelve `false` siempre que `ontReplaced` es
`true`, sin importar rol ni tipo de trabajo (antes era una condición
inline en `campo.ts`, ahora es verificable con pruebas).

**UI reforzada**: el aviso bajo el campo de serial nuevo ahora es
explícito y en rojo: "Registrar este serial aquí NO vincula la ONT
nueva ni la aprovisiona en la OLT... No se realiza ninguna escritura
automática en la OLT ni en MikroTik." (antes era una nota ámbar más
genérica).

### 3. Contratos múltiples: la sincronización nunca toca otro servicio
**Ya estaba garantizado** a nivel de datos — `assign_contract_nap_sync_ont_zone`
actúa por `p_contract_id` exacto (probado en `ontZoneNapSync.sql.test.ts`,
caso "cliente con 2 servicios"), `resolveCurrentOntForContract` filtra
por `contract_id` exacto, `contractsStore.updateContract` escribe con
`.eq('id', id)`. Lo que faltaba era una **guarda defensiva en la
pantalla**: `loadClientInfo` (ya existente, compartida con tickets/
instalaciones) tiene *fallbacks* genéricos ("el contrato activo", "el
primero") para cuando un trabajo no trae un `contractId` puntual — un
traslado SIEMPRE lo trae, así que si esos fallbacks llegaran a activarse
(el contrato exacto no apareció en la consulta), `activeContract`
mostraría y *sincronizaría* un servicio distinto al que dice la rutina.

**Corrección**: `trasladoContractMismatch` (computado nuevo) detecta esa
discrepancia (`activeContract.id !== trabajo.contractId`) y: oculta toda
la sección de confirmación/estado actual, muestra un aviso rojo
explícito, y bloquea el cierre con un `closeError` claro — nunca
sincroniza "a ciegas". No se tocó `loadClientInfo` en sí (lo comparten
tickets/instalaciones, fuera de alcance de esta revisión puntual).

### Archivos modificados
- `src/lib/routineTraslado.ts` (`TrasladoAnteriorSnapshot`,
  `resolveTrasladoAnteriorSnapshot`; `buildTrasladoHistorialNote`/
  `TrasladoHistorialInput` ampliados con NAP anterior/nueva).
- `src/lib/ontZoneSync.ts` (`shouldUseTransactionalNapSync`, nueva,
  pura).
- `src/stores/campo.ts` (usa `shouldUseTransactionalNapSync` en vez de
  la condición inline).
- `src/views/campo/CampoTrabajoDetailView.vue`
  (`trasladoAnteriorSnapshot`/`ensureTrasladoAnteriorSnapshot`,
  `trasladoContractMismatch`, nota reforzada de "ONT reemplazada",
  banner de discrepancia de contrato, limpieza del snapshot al cerrar
  con éxito).
- `src/lib/__tests__/routineTraslado.test.ts` (+6 casos: snapshot
  primera vez/reintento/valores null, multi-servicio explícito, no
  duplica la nota).
- `src/lib/__tests__/ontZoneSync.test.ts` (+4 casos:
  `shouldUseTransactionalNapSync` — reemplazada siempre `false`,
  conservada+rol válido `true`, instalación `false`, rol sin permiso
  `false`).

### Pruebas
- `npm run test:fetch-timeout` → **127/127** (118 previos + 9 nuevos
  netos — 2 pruebas de `buildTrasladoHistorialNote` se reescribieron
  para incluir NAP, no se duplicaron).
- `npx vue-tsc -p tsconfig.app.json --noEmit` → sin errores.
- Casos específicos cubiertos (pedido explícito del usuario, "agregar
  pruebas específicas... reutilizando lógica y pruebas existentes"):
  reintento con snapshot ya guardado (ignora el estado ya mutado),
  snapshot con valores `null` se respeta igual, nota idéntica en 2
  llamadas con el mismo input (no duplica), `ontReplaced` bloquea la vía
  transaccional en cualquier combinación de rol/tipo de trabajo, cliente
  con 2 servicios resuelve cada ONT solo por su propio `contract_id`.

### Riesgos pendientes (sin cambios respecto a 13ao, reconfirmados)
- No probado todavía con un traslado real de punta a punta (sigue sin
  autorizarse en este turno).
- Sin tabla de auditoría estructurada — el historial sigue viviendo como
  texto en `closure_notes`.
- `trasladoContractMismatch` es una guarda defensiva para un caso que
  **no debería ocurrir nunca** en la práctica (no se reprodujo, no se
  forzó) — queda ahí por si acaso, no como corrección de un bug
  observado.

### Qué NO se tocó (confirmado)
Sin escrituras a OLT/MikroTik/PPPoE (verificado explícitamente para el
punto 2). Sin cambios en `loadClientInfo` (compartida con tickets/
instalaciones). Sin otra migración. Sin traslados reales ejecutados.
Sin push ni despliegue — **commit local únicamente**, pendiente de
autorización.

## 13aq. Fase 3 OLT — Fase B: corrección de falsas alarmas por migración SmartOLT (2026-10-13, IMPLEMENTADO, commit local sin push)

Reportado desde capturas de producción (commit `8bd441b`, ya desplegado):
el botón de "Ocupación por puerto PON" mostraba "N ONTs con revisión
pendiente" contando TODAS las ONTs con `caseStatus !== 'match'` — como la
migración desde SmartOLT deja ~400 ONTs sin `client_id`/`contract_id`
todavía (Situación A, CLAUDE.md), casi todas esas ONTs caían en
`unlinked` y se mostraban como si fueran 60 discrepancias de zona reales.
Corrección puntual pedida: no repetir la Fase A/B, solo arreglar la
**agregación y presentación** — la clasificación por ONT (`evaluateOntZoneDiscrepancies`,
13al) ya era correcta, el problema era contar todo junto.

### Corrección
- **`src/lib/ontZoneDiscrepancy.ts`**: nueva función pura
  `countPonPortIssues(rows)` — separa `OntZoneCaseStatus` en 3 grupos
  reales en vez de un solo total:
  - `pendienteVinculacion` (`unlinked`) — normal durante la migración,
    **nunca** se cuenta como discrepancia.
  - `discrepanciaReal` (`zone_mismatch`) — ONT vinculada con zona real
    distinta de la oficial. Esto sí es un problema.
  - `datosAmbiguos` (`ambiguous_catalog` + `no_official`) — catálogo
    sucio o sin zona oficial para ese PON; requiere revisión del
    catálogo, pero no es una discrepancia confirmada sobre un cliente.
  `match` no se cuenta en ningún grupo.
- **`src/views/olt/OltDetailView.vue`**: la tarjeta de cada puerto PON
  reemplaza el único botón "N con revisión pendiente" por hasta 3
  indicadores independientes, cada uno abre el modal de detalle
  **filtrado a su propia categoría** (`openDiscrepancyModal(p,
  filterStatus)`, nuevo parámetro opcional): "⚠ N discrepancia(s) de
  zona" (rojo), "❔ N dato(s) ambiguo(s) (catálogo)" (rojo), "N ONT(s)
  pendiente(s) de vincular (migración)" (gris, tono neutro — no es una
  alarma). Si no hay ninguna de las 3, queda el link neutro "Ver detalle
  de ONTs de este puerto" de siempre.
- **`OntZoneDiscrepancyModal.vue`**: **sin cambios** — ya mostraba cada
  fila con su propio badge/motivo y el acceso a cliente/contrato solo
  cuando hay vínculo real; recibir `rows` ya pre-filtrados por categoría
  alcanza, no hacía falta tocarlo (requisito explícito: conservarlo).

### Fuente oficial de zonas PON — confirmado, sin cambios
El catálogo de `zones` (nombre "PON N - CODE") sigue siendo la única
fuente oficial — `ponZoneMapping.ts` (Fase A, 13ak) ya lo usa así, no se
tocó. Slot/Puerto sigue siendo la identidad física real de la OLT, sin
alterar.

### Archivos modificados
- `src/lib/ontZoneDiscrepancy.ts` (`countPonPortIssues` + `PonPortIssueCounts`, nuevas).
- `src/lib/__tests__/ontZoneDiscrepancy.test.ts` (+5 casos).
- `src/views/olt/OltDetailView.vue` (`ponPortIssues`, `openDiscrepancyModal` con filtro, template de 3 indicadores).

### Pruebas
- `countPonPortIssues` (5 casos nuevos): todo en `match` → los 3 en
  cero; **caso real de la migración** — 9 ONTs sin vincular + 1
  vinculada correcta → `pendienteVinculacion: 9, discrepanciaReal: 0`
  (nunca se cuentan como discrepancia); 1 sin vincular + 1 vinculada con
  zona real distinta → `pendienteVinculacion: 1, discrepanciaReal: 1`
  (separados, no se mezclan); catálogo ambiguo + PON sin zona oficial →
  ambos van a `datosAmbiguos`, nunca a `discrepanciaReal`; lista vacía →
  los 3 en cero.
- `npm run test:fetch-timeout` → **132/132** (127 previos + 5 nuevos).
- `npx vue-tsc -p tsconfig.app.json --noEmit` → sin errores.
- `git status` confirma el alcance: solo los 3 archivos de Fase B — sin
  tocar `campo.ts`, `routines.ts`, rutas de `server/`, ni ningún archivo
  de Fase 158/159.

### Riesgos
- Los contadores siguen siendo por puerto (no hay un total global en la
  cabecera de la sección) — con ~20 puertos y ~400 ONTs sin vincular
  repartidas, un administrador que quiera "el total de pendientes de
  vincular en toda la OLT" todavía tiene que sumarlos puerto por puerto.
  No se pidió ese total en este turno; evaluar si hace falta en una
  futura revisión puntual.
- `datosAmbiguos` sigue agrupando 2 causas distintas (catálogo
  duplicado vs. sin zona oficial) bajo un mismo contador — suficiente
  para esta corrección (ambas requieren la misma acción: revisar el
  catálogo de Zonas), el modal de detalle ya distingue cuál es cuál con
  su propio motivo.

### Qué NO se tocó (confirmado)
Sin reingeniería ni auditoría general — se reutilizó
`evaluateOntZoneDiscrepancies`/`OntZoneDiscrepancy` de Fase B tal cual
(13al), sin tocar su lógica de clasificación. Sin tocar Fase 158/159,
Rutinas, App Campo, OLT, MikroTik, inventario ni contratos. Sin
inferencia de vínculos por nombre. Sin actualizaciones automáticas de
datos — sigue siendo 100% de solo lectura/presentación. Sin push ni
despliegue — **commit local únicamente**, pendiente de autorización.

## 13ar. Fase 3 OLT — Fase B: desglose PON clicable + "Sin zona identificada" (2026-10-13, IMPLEMENTADO, commit local sin push)

Caso real reportado (PON 01, Slot 2/Puerto 1): 61 total, desglose mostraba
57 (PON 1 - AO) + 2 (PON 2 - SM) = 59, 2 ONTs sin ninguna fila que las
explicara. Causa verificada: `computePonOccupancy` (oltCapacity.ts, sin
tocar) solo suma a `zoneBreakdown` las ONTs con `zone_id` propio asignado
— las sin zona cuentan en el total del puerto pero no en ninguna fila.

- **`ontZoneDiscrepancy.ts`**: nueva `ontsInZone(rows, zoneId)` — filtra
  por la zona PROPIA de la ONT (`ontZone`, la misma que cuenta el
  desglose, no la "zona oficial" de Fase A) o por `null` ("sin zona"),
  sin restar ni inventar cantidades. Se agregó `description` a
  `OntZoneDiscrepancy`/`OntZoneDiscrepancyOnt` (pedido explícito, solo
  para mostrar, nunca para inferir vínculos).
- **`OltDetailView.vue`**: la zona dominante y cada fila del desglose
  ahora son clicables (`openPonZoneDetail`) y abren el modal YA
  existente filtrado a esa zona exacta; nueva línea "Sin zona
  identificada (N)" cuando corresponde, con el mismo criterio exacto
  que usa `computePonOccupancy` para excluirlas del desglose.
- **`OntZoneDiscrepancyModal.vue`**: columna "Descripción" agregada
  (única modificación al modal — se reutiliza tal cual, sin tocar su
  lógica de badges/motivo/acceso a cliente).

### Pruebas
7 casos nuevos (incl. el caso real 57+2+2=61, suma exacta sin duplicar;
"description" pasa tal cual). `npm run test:fetch-timeout` → **136/136**.
`vue-tsc` → sin errores. Alcance: 4 archivos, todos de Fase B — sin
tocar Fase 158/159, Rutinas, App Campo, MikroTik ni facturación.

### Limitaciones
- No se agregó un total global de "sin zona identificada" por OLT
  (sigue siendo por puerto) — no se pidió.
- Reusa `evaluateOntZoneDiscrepancies` ya cargado en memoria — sin
  ninguna consulta adicional.

## 13as. Fase 3 OLT — alertas operativas para administración (2026-10-14, IMPLEMENTADO, commit local sin push)

### Causa actual (verificada antes de tocar nada)
La sección "Alertas y sincronización" (`OltDetailView.vue`) solo
mostraba `OltAlert.message` — texto técnico tipo "ONT slot 2/puerto
1/onu-id 5 se desconectó" — sin fecha/hora, cliente ni acceso a su
ficha. Al revisar `server/src/services/oltSyncService.ts` se confirmó
que **sí existe una fecha/hora real del evento** (`at: new
Date().toISOString()`, capturada al inicio del ciclo de sync que
detectó la transición — no la hora de renderizado del navegador): el
dato ya estaba ahí, solo nunca se mostraba. Lo que sí es una limitación
real (ver "Qué queda pendiente"): la alerta **solo vive en memoria del
proceso backend + del navegador** — se pierde si nadie tiene el panel
abierto en el momento exacto, o si el backend se reinicia entre medio
(comentario explícito en `oltEvents.ts`, sin cambios).

### Implementado
- **`src/lib/oltAlertPresentation.ts`** (nuevo, puro): `formatPeruDateTime`
  (`Intl.DateTimeFormat` con `timeZone: 'America/Lima'` explícito — no
  depende de la zona horaria del dispositivo del técnico/admin);
  `ALERT_KIND_LABEL`/`ALERT_KIND_SEVERITY` ("Internet desconectado" /
  "Internet reconectado" / señal óptica, diferenciados por color);
  `buildOltAlertView(alert, ont, ponNumber)` — resuelve cliente/contrato
  con el MISMO criterio exacto que Fase B (`client_id` Y `contract_id`
  Y contrato resuelto, nunca por nombre/descripción/posición), zona
  preferida del contrato (más autoritativa, lección de Fase A/B) con
  fallback a la zona propia de la ONT, y expone serial/descripción/
  posición técnica como datos secundarios.
- **`src/views/olt/OltDetailView.vue`**: `alertViews` (computado) resuelve
  cada `oltStore.alerts` contra `oltStore.onts` YA cargado (sin consulta
  nueva) + el mapa de números de PON ya existente (`ponNumberMap`,
  extraído de donde ya se calculaba inline para Fase B — mismo cálculo,
  ahora compartido). Tarjeta de alerta rediseñada: tipo de evento
  diferenciado visualmente (punto rojo/verde), fecha/hora en horario de
  Perú, nombre del cliente con link directo a
  `/clientes/:id/servicios/:contractId` (reutilizando la misma ruta que
  Fase B) o "⬜ Pendiente de vincular" + botón "Ver ONT" (reutiliza
  `openOntDetail`, modal ya existente), código de cliente, y los datos
  técnicos (zona, PON, slot/puerto/ONU, serial) como línea secundaria
  pequeña.
- **`src/stores/olt.ts`**: dedupe mínimo en el handler del SSE `oltAlert`
  — si ya existe una alerta con el mismo `id` (`ontDbId+at+kind`,
  milisegundo exacto) se ignora la nueva entrega, para que una
  reconexión del SSE no duplique la tarjeta (requisito 7). No cambia
  nada de la detección en el backend (sin tocar `oltSyncService.ts`).

### Archivos modificados
`src/lib/oltAlertPresentation.ts` (nuevo), `src/lib/__tests__/oltAlertPresentation.test.ts`
(nuevo, 9 casos), `src/stores/olt.ts` (dedupe), `src/views/olt/OltDetailView.vue`
(`ponNumberMap` compartido, `alertViews`, `openOntFromAlert`, template).

### Pruebas
9 casos nuevos: `formatPeruDateTime` (ISO real → hora de Perú correcta,
ISO inválido → "Fecha no disponible", nunca inventa); `buildOltAlertView`
— vinculada (zona del contrato gana), sin vincular (con `description`
con nombre real, NUNCA lo usa para inferir cliente), vínculo parcial
inconsistente (`contract_id` sin `client_id` → sigue sin vincular),
**cliente con múltiples servicios** (usa el contrato de ESA ont exacta),
ONT no encontrada en el panel (no revienta), zona ausente en ambas
fuentes (null, no inventa), reconexión vs. desconexión, señal
baja/recuperada (etiquetas y severidad propias, no se confunden con
conexión). `npm run test:fetch-timeout` → **145/145** (136 previos + 9
nuevos). `vue-tsc` → sin errores.

### Riesgos
- El dedupe del SSE es defensivo (no se confirmó un caso real de
  duplicación en producción, solo se identificó la ausencia de la
  guarda) — bajo riesgo, no cambia ningún otro comportamiento.
- `zoneName` prioriza la zona del contrato sobre la de la ONT — si
  alguna vez difieren (el mismo caso que detecta Fase B como
  `zone_mismatch`), la alerta muestra la del contrato; el detalle
  completo sigue disponible vía el modal de Fase B, no se duplicó esa
  lógica aquí.

### Qué queda pendiente (requisito 8 — identificado, NO implementado)
Las alertas siguen sin historial persistente: se pierden al recargar la
página, al cerrar el panel, o si el backend se reinicia entre el evento
y que alguien lo vea. **Solución mínima propuesta** (no implementada,
requeriría migración — fuera de alcance de este turno): una tabla
`olt_alert_log` (`olt_device_id`, `ont_db_id`, `kind`, `at`, insert-only,
sin índice de borrado) poblada por el mismo `pushAlert`/`emitOltAlert`
ya existente en `oltSyncService.ts` (un `insert` adicional junto al
`emitOltAlert` actual, reutilizando la detección ya hecha — no se
duplicaría lógica), con una consulta de solo lectura en el panel para
mostrar alertas de antes de abrir la página. Evaluar si se autoriza en
una fase aparte.

### Qué NO se tocó (confirmado)
Solo lectura de datos ya cargados — sin comandos a OLT/MikroTik, sin
consultas nuevas, sin modificar clientes/contratos/zonas/vínculos, sin
migraciones, sin tocar `oltSyncService.ts`/`oltAlerts.ts`/`oltEvents.ts`
(backend de detección, intacto). Sin push ni despliegue — **commit
local únicamente**, pendiente de autorización.

## 13at. Fase 4 OLT — historial de desconexiones/reconexiones (2026-10-14, IMPLEMENTADO localmente — migración NO aplicada, sin push/deploy)

### Paso 1 — Diagnóstico específico (solo `oltSyncService.ts`/`oltAlerts.ts`/`oltEvents.ts`, sin auditoría general)
- **Origen/precisión de la fecha**: `at = new Date().toISOString()` se
  captura **una sola vez al inicio de todo el ciclo de sync**
  (`performFullSync`) — todas las alertas de esa misma corrida comparten
  el mismo instante. Es la hora de **detección**, no necesariamente el
  segundo exacto en que la ONT se cayó (puede haber pasado en cualquier
  momento desde el ciclo anterior — hasta ~30 min según
  `oltSyncScheduler.ts`). Dato real del backend, nunca la hora de
  renderizado del navegador (ya confirmado en 13as).
- **Reinicio del backend**: no corrompe nada — `before` (el estado
  comparado) siempre se lee fresco de Supabase al iniciar cada ciclo,
  nunca de una caché en memoria. Lo único que se pierde es la
  **notificación en vivo** (SSE) de lo que pasó mientras no había
  proceso corriendo o nadie con el panel abierto — exactamente la
  limitación que motiva esta fase.
- **OLT no responde**: `scanComplete` queda `false` si el escaneo
  global (`show gpon onu state`) falla — en ese caso el bloque entero de
  `detectStatusAlert` se **salta por completo** (confirmado leyendo el
  código, no asumido). Una falla de consulta **nunca** genera una
  alerta de desconexión falsa.
- **Eventos repetidos**: `detectStatusAlert` solo dispara en una
  transición real (`before` ≠ `after`) — un ciclo sin cambio real nunca
  re-alerta (ya probado en `oltAlerts.test.ts`). El historial nuevo
  agrega una segunda capa de defensa a nivel de BD (índice único), ver
  Paso 2.
- **Relacionar ONT/cliente/contrato sin asociaciones incorrectas**: la
  fila de `olt_onts` ya cargada en memoria por el sync (`known`) tiene
  `client_id`/`contract_id` — alcanza con **ampliar el mismo `select`
  que ya se hacía** (2 columnas más), sin ninguna consulta nueva.
- **Desconexión real vs. falla de consulta**: ya resuelto (ver arriba,
  `scanComplete`) — no hacía falta ningún cambio.

### Paso 2 — Diseño mínimo (no existía almacenamiento persistente reutilizable)
Tabla **insert-only** `olt_alert_log` (mismo patrón que el precedente
directo ya en el esquema, `debt_hold_events`, Fase 25 — mismas
columnas/índices/RLS adaptadas):
- `olt_device_id` (FK cascade), `olt_ont_id` (FK **set null**, nunca
  cascade — borrar una ONT no debe borrar su historial, regla 3 de la
  migración OLT), `kind`, `at`, `client_id`/`contract_id` (**snapshot**
  verificado al momento del evento, mismo criterio exacto de Fase B:
  solo se llena si ambos existían — nunca un vínculo a medias, nunca
  recalculado después si la ONT se traslada), `detail`, `created_at`.
- **Índice único** `(olt_ont_id, kind, at)` — dedupe a nivel de BD,
  además del `runningDeviceIds` que ya impide 2 syncs paralelos de la
  misma OLT y del dedupe de la UI (13as).
- Índices para los filtros pedidos: `(olt_device_id, at desc)`,
  `client_id` parcial, `contract_id` parcial, `kind`. **Zona**: NO se
  guarda como columna propia (evita otro snapshot que pueda
  desalinearse) — se filtra vía join `contract_id → service_contracts.zone_id`,
  igual patrón que ya usa Fase B al leer.
- **RLS**: SELECT/INSERT solo SUPERADMIN/ADMIN/TECNICO_RED (regla 9)
  — sin policy de UPDATE/DELETE, ni para esos 3 roles (insert-only real,
  verificado: un UPDATE corre pero no afecta ninguna fila).
- **Duración de la interrupción**: **no se guarda como columna** — se
  calcula en lectura correlacionando el `offline` más reciente con su
  `recovered` por `olt_ont_id` (probado en el test SQL). Decisión
  consciente: un historial insert-only no debería tener una columna que
  se reescribe después.
- **Retención**: sin DELETE automático en esta fase (mismo principio
  que el Kardex, "insert-only, no borrar") — evaluar un job de limpieza
  aparte si el volumen lo justifica, en una fase futura con autorización
  explícita.
- **"Pendiente de vincular"**: ya cubierto — `client_id`/`contract_id`
  null en la fila.

### Paso 3 — Implementación controlada (local, nada aplicado)
- **`supabase/migrations/20261014150451_fase160_olt_alert_log.sql`**
  (nueva, **NO aplicada**): tabla + índices + RLS, tal como el diseño.
- **`server/src/services/oltAlertLog.ts`** (nuevo, puro):
  `buildOltAlertLogRows(alerts, ontsById)` — construye las filas a
  insertar reutilizando las alertas YA detectadas (`oltAlerts.ts`, sin
  tocar su lógica) y el mismo snapshot de vínculo que Fase B.
- **`server/src/services/oltSyncService.ts`**: el `select` de `known`
  ONTs ahora trae también `client_id, contract_id` (2 columnas más en
  la MISMA consulta); justo donde ya se emitía `emitOltAlert` (solo si
  el bulk update de estado se confirmó), ahora también hace un
  `upsert(..., { onConflict: 'olt_ont_id,kind,at', ignoreDuplicates: true })`
  contra `olt_alert_log` — best-effort, nunca bloquea ni retrasa la
  alerta en vivo si el insert del historial falla.
- **`server/tests/oltAlertLogSchema.sql`** + **`server/tests/oltAlertLog.sql.test.ts`**
  (nuevos, Postgres aislado en Docker — mismo patrón que
  `ontZoneNapSync.sql.test.ts`): valida el esquema completo antes de
  pensar en aplicarlo.
- **`server/src/services/__tests__/oltAlertLog.test.ts`** (nuevo,
  puro): el constructor de filas en aislamiento.
- **`package.json`**: script `test:olt-alert-log-sql`.

### Pruebas
- **Unitarias puras** (9 casos, `oltAlertLog.test.ts`): vinculada,
  sin vincular (migración SmartOLT), vínculo parcial en ambos sentidos
  (nunca a medias), ONT no encontrada, cliente con múltiples servicios
  (cada evento con su propio `contract_id`, nunca mezclados),
  reconexión/desconexión, señal baja/recuperada, lista vacía. `npm run
  test:provisioning` → **90/90** (81 previos + 9 nuevos).
- **SQL aislado** (11 casos, `oltAlertLog.sql.test.ts`, Postgres 17 real
  en Docker, efímero): caso feliz, ONT sin vincular, **dedupe real**
  (mismo evento exacto rechazado por el índice único; mismo ONT con
  otro instante u otro `kind` sí se inserta), **cliente con múltiples
  servicios** (filtrar por `contract_id` nunca mezcla el otro servicio
  del mismo cliente), **duración calculable** (correlación
  offline→recovered por SQL), FK inválida rechazada, **RLS por rol**
  (SUPERADMIN/ADMIN/TECNICO_RED ven, SOPORTE/FACTURACION/CLIENTE/admin
  inactivo/anónimo no ven ninguna fila — sin error, 0 filas), **insert-only
  verificado** (un UPDATE corre pero no cambia nada, ni para
  SUPERADMIN). `npm run test:olt-alert-log-sql` → **11/11**.
- `npx tsc -p tsconfig.server.json --noEmit` → solo los 2 errores
  preexistentes de `oltProvisioningService.ts` (ajenos, ya confirmados
  en sesiones anteriores). Frontend sin cambios esta vez — `npm run
  test:fetch-timeout` (145/145) y `vue-tsc` (sin errores) reconfirmados
  igual, sin regresión.

### Riesgos
- El `upsert` del historial puede fallar silenciosamente (solo
  `console.error`, no bloquea el sync) — si Supabase estuviera caído
  justo en ese instante, ese evento puntual no quedaría en el
  historial (pero SÍ se siguió emitiendo la alerta en vivo normalmente,
  no se pierde la notificación inmediata).
- Sin columna de zona propia: una consulta que filtre por zona necesita
  el join a `service_contracts` — una query mal escrita podría
  olvidarlo; documentado explícitamente para quien implemente el
  endpoint de lectura.
- **No existen eventos históricos anteriores a esta tabla** — al
  aplicarse, el historial arranca vacío desde ese momento. **No se
  inventa ni se reconstruye retroactivamente ninguna fecha pasada** (
  requisito explícito del usuario) — es una limitación real, no un
  defecto: no hay ningún dato de antes para recuperar.

### Qué NO se tocó / NO se hizo (confirmado, por restricción explícita)
Ninguna migración aplicada en Supabase. Ningún comando a OLT/MikroTik.
Ninguna ONT desconectada para generar un evento de prueba (todo
probado con datos sintéticos en Postgres aislado). Sin modificar
contratos/zonas/inventario/facturación. Sin tocar la lógica de
detección (`oltAlerts.ts`) ni la de distribución en vivo (`oltEvents.ts`).
Sin push ni despliegue.

### Qué quedó pendiente al cerrar esta sección (completado en 13au)
Endpoint de lectura y vista en el panel — ver 13au. Siguen pendientes:
autorización para aplicar la migración y, si el volumen lo justifica,
un job de retención.

## 13au. Fase 4 OLT — endpoint de lectura + vista "Historial de alertas" (2026-10-14, IMPLEMENTADO localmente — migración sigue SIN aplicar, sin push/deploy)

Completa 13at: endpoint de consulta + integración en el panel, sin
repetir el diagnóstico ni el diseño de la tabla (ya cerrados ahí).

### Implementado
- **`GET /:id/alert-log`** (`server/src/routes/olt.ts`): mismos 3 roles
  reales que la RLS de `olt_alert_log` (`ONT_WRITE`, ya existente —
  reutilizado, no se duplicó la lista). Filtros `from`/`to` (rango de
  `at`), `clientId`, `zoneId` (resuelto primero a `contract_id`s de esa
  zona vía `service_contracts.zone_id` — la tabla no guarda zona
  propia, por diseño de 13at), `kind`; paginado `limit`/`offset`
  (máx. 200). `client_id`/`contract_id` que devuelve cada fila son el
  **snapshot** de 13at, nunca el vínculo de hoy. Duración: una consulta
  extra acotada a los `olt_ont_id` de la página actual (nunca masiva),
  resuelta con `computeRecoveryDurations` (nuevo, puro, en
  `oltAlertLog.ts` junto a `buildOltAlertLogRows` — ver Pruebas).
- **`src/lib/oltAlertPresentation.ts`**: `buildOltAlertLogEntryView`
  (nueva) — reutiliza `ALERT_KIND_LABEL`/`ALERT_KIND_SEVERITY`/
  `formatPeruDateTime` ya construidos en 13as; a diferencia de
  `buildOltAlertView` (alertas en vivo, resuelve contra el vínculo
  ACTUAL de `oltStore.onts`), esta NO vuelve a resolver cliente/contrato
  — la fila ya llega resuelta desde el backend contra el snapshot
  histórico correcto.
- **`src/stores/olt.ts`**: `fetchAlertLog(deviceId, filtros)`.
- **`src/views/olt/OltDetailView.vue`**: sección **"Historial de
  alertas" dentro de la misma tarjeta** "Alertas y sincronización" (sin
  módulo/vista aparte) — colapsada por defecto. Filtros: fecha
  desde/hasta, cliente (derivado de `oltStore.onts` de este
  dispositivo, sin buscador nuevo), zona (`catalogsStore.zones`, ya
  cargado), tipo de evento. Cada fila: evento diferenciado
  visualmente, hora en Perú, cliente con link directo o "⬜ Pendiente de
  vincular" + "Ver ONT" (reutiliza `openOntFromAlert`, 13as), zona,
  duración aproximada, estado actual de la ONT, datos técnicos como
  secundarios. Paginación simple anterior/siguiente.
- **Distinción hora de detección vs. hora real** (requisito explícito):
  nota aclaratoria agregada en la cabecera de la sección —cubre tanto
  las alertas en vivo como el historial— "la hora mostrada es de
  detección... el instante exacto puede haber sido antes, no se conoce
  con precisión".
- **Revisión del `upsert` best-effort** (`oltSyncService.ts`): el log de
  error ahora usa un prefijo propio `[olt-alert-log]` (antes
  `[olt-sync]`, se confundía con errores de sincronización) e incluye
  `device.id`, cantidad de filas y el `code` del error de Postgres —
  identificable sin ambigüedad, sigue sin bloquear el sync ni la alerta
  en vivo, y confirmado que no puede generar una alerta falsa (la
  detección ya ocurrió antes e independiente de este insert).

### Archivos modificados
- `server/src/routes/olt.ts` (`GET /:id/alert-log`).
- `server/src/services/oltAlertLog.ts` (`computeRecoveryDurations`,
  nueva).
- `server/src/services/oltSyncService.ts` (mensaje de error mejorado).
- `server/src/services/__tests__/oltAlertLog.test.ts` (+6 casos).
- `src/lib/oltAlertPresentation.ts` (`buildOltAlertLogEntryView` +
  tipos).
- `src/lib/__tests__/oltAlertPresentation.test.ts` (+4 casos).
- `src/stores/olt.ts` (`fetchAlertLog`).
- `src/views/olt/OltDetailView.vue` (sección "Historial de alertas").

### Pruebas
- Backend puro (+6, `oltAlertLog.test.ts`): par normal
  offline→recovered, recovered sin offline previo (no calculable, no
  inventa), 2 ciclos completos sin mezclarse, 2 offline seguidos (usa
  el más reciente), 2 ONTs distintas sin mezclarse, lista vacía. `npm
  run test:provisioning` → **96/96** (90 previos + 6 nuevos).
- Frontend puro (+4, `oltAlertPresentation.test.ts`): fila resuelta
  (vinculada), fila sin vínculo (nunca inventa), duración `null` se
  conserva tal cual (nunca se reemplaza por 0), datos técnicos intactos.
  `npm run test:fetch-timeout` → **149/149** (145 previos + 4 nuevos).
- `npx tsc -p tsconfig.server.json --noEmit` → solo los 2 errores
  preexistentes ajenos. `npx vue-tsc -p tsconfig.app.json --noEmit` →
  sin errores.
- `test:olt-alert-log-sql` (11/11, sin cambios desde 13at — la
  migración no se tocó en esta sección) no se repitió sin necesidad
  (regla de eficiencia, CLAUDE.md).

### Nota técnica (encontrada al compilar, corregida)
El `select()` de Supabase con embeds (`clients(...)`, `service_contracts(...)`)
debe ir en **un solo literal de string** — concatenarlo con `+` degrada
el tipo a `GenericStringError` (confirmado al compilar, nada que ver
con el esquema real). Documentado inline en el código para no repetir
el error.

### Riesgos
- El filtro de zona hace una consulta extra a `service_contracts` antes
  de la principal — trivial en volumen, pero son 2 round-trips en vez
  de 1 cuando se filtra por zona.
- La paginación es offset/limit simple (no cursor) — con inserciones
  nuevas durante la navegación, el usuario podría ver una fila
  repetida o saltarse una al cambiar de página; aceptable para un panel
  administrativo de consulta, no se justificaba cursor-based para esta
  entrega.
- Sigue sin tabla de retención/limpieza — mismo riesgo ya documentado
  en 13at.

### Qué NO se tocó (confirmado)
Sin aplicar la migración de 13at todavía. Sin comandos a OLT/MikroTik.
Sin modificar contratos/zonas/inventario/facturación. Sin tocar
`oltAlerts.ts` (lógica de detección) ni la emisión SSE en vivo. Sin
push ni despliegue — **commit local únicamente**.

### ¿Lista Fase 4 para pedir autorización de despliegue?
Ver 13av — verificación final, único paso pendiente antes de pedir
autorización es la migración en sí.

## 13av. Fase 4 OLT — verificación final (2026-10-14, correcciones puntuales — migración sigue SIN aplicar, sin push/deploy)

Verificación de 5 puntos específicos sobre el commit `55c38b0`, sin
repetir diagnóstico ni diseño ya cerrados en 13at/13au.

1. **Orden del historial**: confirmado correcto, ya estaba
   `.order('at', { ascending: false })` en `GET /:id/alert-log` — sin
   cambios.
2. **Tiempo relativo + hora exacta**: **gap real encontrado** — solo se
   mostraba la hora exacta. Corregido: `formatRelativeTime(iso, nowMs)`
   nueva (`oltAlertPresentation.ts`, mismo patrón ya usado en
   `formatElapsedTime`/`elapsedTime.ts` — `nowMs` como parámetro, no
   `Date.now()` interno, para que sea comprobable) — "hace un
   momento"/"hace N min"/"hace N h"/"hace N d", mostrado **junto a** la
   hora exacta en Perú (nunca en su lugar), tanto en las alertas en
   vivo como en el historial.
3. **Migración (RLS/índices/idempotencia/respaldo/rollback)**: RLS e
   índices ya estaban correctos y probados (11/11 en 13at). **Reforzado**:
   se agregó una prueba explícita de **re-aplicar la migración dos
   veces** sin error y sin duplicar índices/policies (ahora 12/12), y
   un comentario explícito en el archivo de migración con el rollback
   seguro (`drop table if exists public.olt_alert_log;` — la tabla
   nace vacía, nunca hay datos reales que perder) y la confirmación de
   que es puramente aditiva (no toca columnas/datos de
   `olt_devices`/`olt_onts`/`clients`/`service_contracts`, solo las
   referencia).
4. **Persistencia best-effort no bloquea el sync de ~723 ONTs**:
   **verificado correcto, sin cambios necesarios** — el `select`
   ampliado sigue siendo UNA sola consulta sobre las mismas ~723 filas
   (2 columnas más, no más filas); el `upsert` del historial es UNA
   sola llamada bulk (nunca un loop por ONT), gated por
   `if (alerts.length)` (cero costo en la inmensa mayoría de ciclos sin
   transiciones reales); best-effort real (nunca lanza, el
   `emitOltAlert` en vivo sigue corriendo igual si el insert del
   historial falla). Mismo patrón ya usado y probado en producción para
   `bulk_update_ont_status_power` — no se introdujo un riesgo nuevo.
5. **Eventos administrativos no deben aparecer como reales**:
   **verificado correcto, sin cambios necesarios** — `detectStatusAlert`
   ya descarta cualquier transición cuando `admin_state` termina en
   `'disable'` (ya probado: "ONU deshabilitada administrativamente:
   nunca se confunde con una caída", `oltAlerts.test.ts`), y
   `olt_alert_log` solo recibe lo que ya pasó ese mismo filtro — ninguna
   otra ruta (`toggle`, `import-existing`, edición de metadatos) llama a
   `detectStatusAlert`/`pushAlert`/`emitOltAlert` (confirmado por
   búsqueda dirigida en `routes/olt.ts`).

### Archivos modificados
- `src/lib/oltAlertPresentation.ts` (`formatRelativeTime`, nueva).
- `src/lib/__tests__/oltAlertPresentation.test.ts` (+6 casos).
- `src/views/olt/OltDetailView.vue` (tiempo relativo en ambas listas).
- `supabase/migrations/20261014150451_fase160_olt_alert_log.sql`
  (comentario de rollback/respaldo — sin cambios de esquema).
- `server/tests/oltAlertLog.sql.test.ts` (+1 caso, re-aplicación).

### Pruebas
`npm run test:fetch-timeout` → **155/155** (149 previos + 6 nuevos).
`npm run test:olt-alert-log-sql` → **12/12** (11 previos + 1 nuevo).
`npm run test:provisioning` → **96/96**, sin cambios (puntos 4 y 5 no
requirieron código nuevo). `tsc`/`vue-tsc` → sin errores nuevos.

### Riesgos reales (reconfirmados, sin cambios)
Paginación offset/limit simple (no cursor); sin job de retención;
filtro de zona hace 1 consulta extra — todos ya documentados en 13au,
ninguno es bloqueante.

### ¿Lista Fase 4 para pedir autorización de despliegue?
**Sí, a nivel de código** — los 5 puntos de esta verificación están
correctos o corregidos, con pruebas pasando. Sigue pendiente, como
siempre, la **autorización explícita del usuario para aplicar la
migración** `olt_alert_log` en Supabase producción (nada de esto
funciona sin la tabla real) y, una vez desplegado, su validación visual
en el panel.

**Actualización — DESPLEGADA (2026-10-14)**: el usuario autorizó
explícitamente ("SMART RAYCO — FASE 4: DESPLIEGUE CONTROLADO") aplicar
la migración `olt_alert_log` (versión real `20261014150451`, commit
`56d0aaf`) en Supabase producción y desplegar los commits de Fase 4
hasta `1a549e9`. Confirmado por `git status`: `main` está sincronizado
con `origin/main`, sin commits pendientes de push. Fase 5 (13aw, abajo)
parte de este estado ya desplegado.

## 13aw. Fase 5 OLT — Centro de monitoreo visual (2026-10-14, IMPLEMENTADO localmente, commit local sin push/deploy)

**Objetivo**: mejorar únicamente la visualización de "Alertas y
sincronización" (misma tarjeta de Fase 3/13as/13at/13au) para que el
personal administrativo identifique fácilmente qué clientes están sin
conexión y consulte su historial — fase **visual y de solo lectura**,
sin tablas/migraciones/endpoints/servicios nuevos, sin tocar la
sincronización, sin ejecutar nada contra OLT/MikroTik/PPPoE.

### Diagnóstico — por qué no hizo falta backend nuevo
Todo lo pedido (conteos conectado/desconectado/sin vincular, lista de
clientes desconectados, frescura de la sincronización) se puede derivar
100% de datos YA cargados en este panel:
- `oltStore.onts` (Fase B, con `clients`/`service_contracts.zones`
  embebidos) — ya trae todo lo necesario para contar y listar.
- `summary` (`GET /:id/summary`, ya existente desde Fase 40) — ya trae
  `checkedAt`/`scanComplete` del último ciclo de `olt_sync_cache`.
- `GET /:id/alert-log` (Fase 4, 13at/13au) — reusado tal cual (consulta
  acotada `kind:'offline', limit:200`) para el "tiempo transcurrido
  desde la detección", sin crear un endpoint nuevo.

Punto crítico verificado en `oltSyncService.ts`: `olt_sync_cache.checked_at`
se actualiza en **cada** intento de sync (éxito o no), mientras que
`scan_complete` solo es `true` si ese ciclo realmente pudo leer la OLT.
Por eso el aviso de frescura distingue 3 casos SIN mezclarlos nunca:
sin ningún dato todavía, la OLT no respondió en el último intento
(`scanComplete=false`), o pasó demasiado tiempo desde el último intento
real (`stale`, >60 min) — ninguno de los tres se interpreta como
"clientes desconectados".

### Implementación
- **`src/lib/oltConnectionStatus.ts`** (nuevo, puro, sin I/O):
  - `computeConnectionStatusCounts`: mismo criterio de vínculo
    verificado que Fase B (`client_id` Y `contract_id` Y
    `service_contracts` resuelto — un vínculo a medias cuenta como "sin
    vincular", nunca a medias). Devuelve `linkedOnline`/`linkedOffline`
    /`linkedUnknown`/`unlinked`, siempre por separado.
  - `listDisconnectedLinkedClients`: solo ONTs vinculadas Y `offline`
    (nunca una sin vincular, nunca online/unknown), con nombre,
    contrato, zona y posición física, ordenado por nombre.
  - `filterDisconnectedClients`: filtro por zona (id exacto) y búsqueda
    de texto por nombre — sobre la lista ya resuelta, sin consulta
    nueva.
  - `evaluateSyncFreshness(summary, nowMs, staleAfterMinutes=60)`:
    "última sincronización válida" + los 3 avisos descritos arriba,
    nunca inventa una fecha si no hay ninguna todavía.
- **`src/views/olt/OltDetailView.vue`**: la tarjeta "Alertas y
  sincronización" ahora tiene 2 pestañas:
  - **Estado actual** (nueva): aviso de frescura, línea de última
    sincronización (relativo + hora exacta en Perú), 4 tarjetas de
    conteo, y la lista filtrable de "Clientes sin conexión" (nombre con
    enlace directo a `/clientes/:id/servicios/:contractId`, badge "Sin
    conexión", contrato/zona, "Detectado hace X · hora Perú" **solo si**
    existe un evento `offline` verificable en el historial, y un botón
    "Ver ONT" que reusa `openOntFromAlert` ya existente).
  - **Historial de alertas** (Fase 4): exactamente el mismo
    comportamiento de antes (filtros, paginación, tiempo relativo,
    enlaces) — el único cambio fue envolver su `<div>` raíz en
    `v-show="alertsTab === 'historial'"`, sin tocar nada interno.
  - Las "Notificaciones en vivo (esta sesión)" (Fase 3) quedaron dentro
    de la pestaña "Estado actual" (es la alerta más inmediata/en vivo,
    tiene más sentido ahí que en el historial).
  - "Consultar puerto GPON" e "Importar ONTs desde la OLT"
    (herramientas de escritura real contra la OLT) quedan **fuera de
    ambas pestañas**, siempre visibles — fuera de alcance de esta fase.
- **`src/lib/__tests__/oltConnectionStatus.test.ts`** (nuevo, 17 casos).

### Pruebas
`npm run test:fetch-timeout` → **172/172** (155 previos + 17 nuevos),
cubriendo exactamente la matriz pedida: conectado, desconectado,
desconocido (nunca cuenta como desconectado), sin vincular (incluso si
está offline, siempre separado), vínculo parcial (sigue siendo "sin
vincular"), cliente con múltiples servicios (cada ONT/contrato cuenta
por separado), sincronización reciente/completa, OLT sin responder en
el último intento, datos desactualizados por tiempo (`stale`), y sin
ningún dato todavía ("No disponible", nunca una fecha inventada).
`npx vue-tsc -p tsconfig.app.json --noEmit` → sin errores. Las pestañas
y el comportamiento de Fase 4 se verificaron por lectura de código
(balance de `<div>`, que "Consultar puerto GPON"/"Importar ONTs" quedan
fuera de ambos `v-show`) — sin servidor de desarrollo levantado en esta
corrida (ver limitación abajo).

### Limitaciones documentadas (pedido explícito: "No disponible" en vez de inventar)
- "Tiempo transcurrido desde la detección" solo aparece si existe un
  evento `offline` para esa ONT dentro de la consulta `limit:200` más
  reciente del historial — si no hay ninguno (ONT nunca registrada en
  `olt_alert_log`, o su único evento quedó fuera de esas 200 filas), no
  se muestra ninguna fecha, nunca se infiere una.
- La hora de "detección" (igual que en Fase 3/13as) es cuándo el
  sistema lo notó, no necesariamente el instante exacto de la caída
  real — misma limitación ya documentada, no nueva de esta fase.
- Esta corrida no incluyó una verificación visual en navegador (sin
  servidor de desarrollo levantado) — recomendado antes de pedir
  despliegue: abrir el panel de una OLT real, cambiar de pestaña,
  probar el filtro de zona y la búsqueda por nombre.

### Riesgos
Ninguno nuevo de escritura (fase 100% de lectura). El único riesgo es
de presentación: si `oltStore.onts` todavía no terminó de cargar al
montar la vista, los conteos/lista parten en cero un instante (mismo
comportamiento que el resto del panel, no es nuevo de esta fase).

### ¿Lista Fase 5 para pedir autorización de despliegue?
**Sí, a nivel de código** — implementación local completa, pruebas en
verde, `vue-tsc` limpio. Pendiente: verificación visual en navegador
(ver limitación arriba) y, como siempre, la autorización explícita del
usuario para hacer push/deploy — esta fase no requiere ninguna
migración (no toca la base de datos).

**Actualización — DESPLEGADA (2026-10-14)**: el usuario autorizó
explícitamente ("SMART RAYCO — FASE 5: VALIDACIÓN Y DESPLIEGUE") el
push y despliegue del commit `de1a3c0` tras confirmar que las ONTs con
sincronización desactualizada/fallida nunca se muestran como "sin
conexión" confirmada (ver `evaluateSyncFreshness` + el aviso ámbar) y
que `oltSyncService.ts` nunca actualiza `status`/`last_synced_at` en un
ciclo con `scanComplete=false`. Desplegado en la VM
(`192.168.55.201`/`/opt/smartrayco`, `docker compose -f
docker-compose.onprem.yml up -d --build`) con `git log -1` confirmando
`de1a3c0`, backend y frontend reconstruidos y arriba, `panel.
rayconetworks.com` y `/api/health` respondiendo 200. Rollback
registrado (`PREV_COMMIT=56d0aaf`), sin necesidad de usarlo. Sin
migración de por medio.

**Hallazgo real post-despliegue, de uso en campo (mismo día)**: un
cliente real (Danner Ávalos Ventura, CTR-2026-00356) suspendido por
corte administrativo (`admin_state='disable'` real en la OLT, mismo
dato que reporta SmartOLT como "admin-disabled mode") aparecía en
"Clientes sin conexión" junto con caídas reales — esta pestaña nueva
nunca miraba `admin_state`. Diagnosticado y corregido en 13ax, abajo.

## 13ax. Fase 5 OLT — separar "Suspendidos" de "Clientes sin conexión" (2026-10-14, IMPLEMENTADO localmente, commit local sin push/deploy)

### Causa raíz
`src/lib/oltConnectionStatus.ts` (13aw) clasificaba solo por `status`,
ignorando `admin_state`. Una ONU admin-disabled (suspendida/cortada)
queda con `status='offline'` **y** `admin_state='disable'` a la vez —
sin distinguir, se contaba y listaba igual que una caída real.

Verificado contra Supabase producción (solo lectura, sin escritura):
Danner Ávalos Ventura / CTR-2026-00356 / MSTC8CCE7991 (1/2/3:41) tenía
`status='offline'`, `admin_state='disable'`, `debt_hold_status='none'`
— es decir, suspendido administrativamente pero **sin evidencia de
deuda** en el propio sistema de facturación, pese a que el operador
afirmaba que fue por mora. A nivel de todo el dispositivo (sync activo,
`scan_complete=true`): de las ONTs vinculadas offline, 3 eran caídas
reales y **3 eran suspensiones administrativas** mezcladas en el mismo
conteo — la mitad del número mostrado era incorrecto.

### Campos/comandos ya disponibles (nada nuevo)
- La OLT expone `admin-state` directamente en `show gpon onu state`
  (columna 2) — misma fuente que SmartOLT. Parseado y **validado contra
  el equipo real** en `server/src/ssh/zteParsers.ts` (`parseOntList`/
  `parseGlobalOntState`).
- Persistido cada ciclo exitoso en `olt_onts.admin_state`, con la misma
  garantía de fiabilidad que `status` (`oltSyncService.ts`, gateado por
  `scanComplete`) — ya cargado en el panel vía `OltOnt.admin_state`
  (`src/stores/olt.ts`), sin fetch nuevo.
- El motivo (deuda vs. manual) ya existe, separado correctamente:
  `GET /:id/onts/disabled` cruza `admin_state='disable'` con
  `service_contracts.debt_hold_status='suspended'` (nunca infiere
  "deuda" del admin-state solo) y devuelve `reason:
  'manual'|'billing'|'both'` — ya usado por `DisabledOntsTab.vue`/
  `oltStore.fetchDisabledOnts`. Esta fase lo reutiliza tal cual, sin
  tocar `debtHoldService.ts` ni ningún cálculo de facturación.

### Implementación
- **`src/lib/oltConnectionStatus.ts`**: `ConnectionStatusOnt` ahora
  incluye `admin_state`. Nueva `classifyLinked(o)` interna —
  `admin_state='disable'` manda SIEMPRE, antes de mirar `status`
  (incluso sobre un `status` viejo de antes de suspenderse, o sobre
  `'unknown'`). `ConnectionStatusCounts` gana `linkedSuspended`, restado
  de `linkedOffline`/`linkedOnline`/`linkedUnknown` — cada ONT cae en
  EXACTAMENTE un conteo, nunca dos. Nueva `listSuspendedLinkedClients`
  (mismo patrón que `listDisconnectedLinkedClients`, nunca el mismo
  listado) y nueva `suspensionReasonLabel(reason)` — "Suspendido — por
  deuda / mora" SOLO si `reason` incluye `'billing'`, si no
  "Suspendido administrativamente" genérico (nunca inventa "deuda" sin
  evidencia — caso real de Danner).
- **`src/views/olt/OltDetailView.vue`**: tarjeta "Suspendidos" (ámbar)
  en el grid de conteos de "Estado actual", y sub-lista "Suspendidos"
  (mismo patrón que "Clientes sin conexión": filtro de zona/búsqueda,
  nombre con enlace a la ficha del servicio, "Ver cliente" y "Ver ONT"
  — reusando `openOntFromAlert` ya existente). El motivo mostrado
  reusa `disabledOnts` (ya cargado por `loadDisabled()`, SIN una
  llamada nueva) vía un `computed` que indexa por `ont.id`. La fecha
  mostrada es `last_synced_at` de la propia ONT, etiquetada
  honestamente como "último cambio registrado" (no "fecha de
  suspensión" exacta, porque `detectStatusAlert` nunca registra una
  alerta para una transición a admin-disabled — es una acción
  administrativa, no una caída que alertar).
- **`src/lib/__tests__/oltConnectionStatus.test.ts`**: 14 casos nuevos
  (31 en total) cubriendo exactamente la matriz pedida: suspensión con
  `status='online'` antiguo, suspensión offline, reconexión
  (`admin_state` vuelve a `'enable'`), `status` desconocido con
  `admin_state='disable'`, ONT sin vincular con `admin_state='disable'`
  (sigue "sin vincular", nunca "suspendida"), cliente con 2 contratos
  (uno suspendido y otro no, sin mezclarse), y una prueba explícita de
  que cada ONT cae en un solo conteo (suma = total, sin doble conteo).

### Pruebas
`npm run test:fetch-timeout` → **186/186** (172 previos + 14 nuevos).
`npx vue-tsc -p tsconfig.app.json --noEmit` → sin errores.

### Limitaciones (sin cambios, heredadas de la lógica ya existente que se reutiliza)
- El cruce con facturación en `GET /:id/onts/disabled` es por
  `client_id`, no por `contract_id` exacto — si un cliente tiene 2
  contratos y solo uno está en mora, sus demás ONTs también saldrían
  con motivo "por deuda/mora" aunque esa ONT en particular no sea la
  del contrato suspendido. Limitación ya aceptada antes de esta fase
  (`debtHoldService.ts`), no se resuelve aquí — "No cambios de
  facturación" fue una restricción explícita de esta tarea.
- "Último cambio registrado" (no hay un evento verificable de "se
  suspendió a las X" en `olt_alert_log`, a propósito — admin-disabled
  nunca genera una alerta ahí).
- Los cientos de ONTs sin vincular por la migración no se tocaron —
  siguen en `unlinked`, sin alterar su clasificación.

### Riesgos
Ninguno de escritura (100% lectura, sin tocar OLT/MikroTik/PPPoE/
facturación/contratos). Riesgo de presentación: si `disabledOnts`
todavía no cargó, el motivo se muestra genérico ("Suspendido
administrativamente") hasta que la petición existente complete — nunca
bloquea el panel ni inventa un motivo.

### ¿Lista para pedir autorización de despliegue?
**Sí, a nivel de código** — implementación local completa, pruebas en
verde (186/186), `vue-tsc` limpio. Pendiente, como siempre, la
autorización explícita del usuario para push/deploy — esta fase
tampoco requiere ninguna migración.

**Actualización — bloqueada antes de desplegar (2026-10-14)**: al
pedir autorización de despliegue del commit `3069da1`, el usuario
exigió verificar explícitamente que una deuda del cliente no se
atribuyera automáticamente a todos sus contratos. Se confirmó que
**no** estaba verificado a nivel de servicio exacto — ver 13ay, abajo,
corrección aplicada antes de desplegar nada.

## 13ay. Corrección: motivo de suspensión por `contract_id` exacto, nunca por `client_id` (2026-10-14, IMPLEMENTADO localmente, commit local sin push/deploy)

### Causa corregida
`GET /:id/onts/disabled` (endpoint preexistente, reutilizado sin
cambios por 13ax) cruzaba `service_contracts.debt_hold_status=
'suspended'` por `client_id`, no por `contract_id`. Si un cliente
tenía 2+ contratos y solo uno estaba en mora, **todas** sus ONTs en
este dispositivo recibían `reason: 'billing'`, incluyendo las de
contratos al día — exactamente lo que el usuario pidió confirmar antes
de autorizar el despliegue. Verificado con SQL de solo lectura que hoy
no hay ningún cliente real en ese escenario (0 filas), pero el
mecanismo no lo garantizaba — era un riesgo latente, no un hecho
consumado.

### Corrección
- **`server/src/services/oltDisabledReason.ts`** (nuevo, puro, sin
  I/O): `resolveDisabledReason(ont, suspendedContractIds)` decide el
  motivo (`'manual'|'billing'|'both'|null`) mirando el `contract_id`
  EXACTO de esa ONT contra el conjunto de contratos realmente
  suspendidos — nunca el `client_id`. Sin `contract_id` (sin vincular
  o vínculo parcial) nunca puede calificar como `'billing'` — motivo
  genérico (`'manual'` si corresponde, o `null`).
- **`server/src/routes/olt.ts`** (`GET /:id/onts/disabled`): en vez de
  2 consultas filtradas por `client_id` y mezcladas a mano, ahora hace
  1 consulta de todas las ONTs del dispositivo y aplica
  `resolveDisabledReason` fila por fila — misma forma de respuesta
  (`{items, checkedAt}`, cada item con `reason`), compatible con
  `DisabledOntsTab.vue`/`oltStore.fetchDisabledOnts` y con la nueva
  lista "Suspendidos" de Fase 5 (13ax), sin cambios en ninguno de los
  dos consumidores.
- **`server/src/services/__tests__/oltDisabledReason.test.ts`**
  (nuevo, 9 casos): admin-disabled sin mora → `'manual'`; contrato
  exacto en mora sin admin-disable → `'billing'`; ambos → `'both'`;
  **cliente con 2 contratos, uno en mora y otro al día → cada uno con
  su propio motivo, sin contagio**; ONT sin contrato (con o sin
  admin-disable) → nunca `'billing'`; sin ningún contrato suspendido en
  el sistema → `null`; contrato de la ONT que no coincide con ninguno
  suspendido → `null`.

### Pruebas
`npm run test:provisioning` (incluye `server/src/services/__tests__/*`)
→ **105/105** (96 previos + 9 nuevos). `npx tsc -p tsconfig.server.json
--noEmit` → sin errores nuevos (2 errores preexistentes en
`oltProvisioningService.ts`, no relacionados, confirmados iguales
antes y después de este cambio con `git stash`). No se repitió
`vue-tsc`/`test:fetch-timeout` — ningún archivo frontend cambió en
esta corrección (regla de "modo de desarrollo eficiente").

### Verificación del punto 5 (pantalla "ONUs deshabilitadas/cortadas" sigue funcionando)
Misma forma de respuesta, mismo tipo `DisabledOnt.reason`, mismo
`checkedAt` — `DisabledOntsTab.vue` no se modificó y no necesita
cambios. El único efecto visible es que deja de mostrar `'billing'`
para servicios de un cliente que NO están realmente en mora (la
corrección en sí) — comportamiento estrictamente más correcto, nunca
menos.

### Limitación (documentada, no corregida — fuera de alcance explícito)
Si en el futuro una ONT tiene `contract_id` pero ese contrato fue
borrado/cambiado sin resincronizar `olt_onts.contract_id` (desync entre
tablas), `resolveDisabledReason` simplemente no encontrará coincidencia
y mostrará el motivo genérico — nunca inventa una relación. No se tocó
`debtHoldService.ts` ni ningún cálculo de `debt_hold_status`.

### ¿Lista para pedir autorización de despliegue (3069da1 + esta corrección)?
**Sí, a nivel de código** — implementación local completa, pruebas en
verde (186 frontend + 105 backend), sin errores nuevos de compilación.
Pendiente la autorización explícita del usuario para push/deploy —
tampoco requiere ninguna migración.

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

Validación de Inventario etapas 1/2 (15/10/2026, commit 3d6a68a): BLOQUEADO para aprobación operativa por falta de sesiones reales y muestras de órdenes sin contrato. SELECT Cloud acotados compatibles; sin escrituras ni cambios RLS. Evidencia y pasos pendientes: docs/VALIDACION-INVENTARIO-ETAPAS-1-2.md. No se repitieron las 24 pruebas locales ni se avanzó a etapas 3-6.

Equipos históricos (15/10/2026): lectura Cloud de 8 unidades sin contrato; 6 con contrato explícito verificable en último evento (2 también con instalación completada), 2 sin prueba de servicio. Las 3 Averías relacionadas están cerradas/resueltas. Sin corrección operativa segura solo de lectura: discrepancia evento/unidad y candados de escritura requieren revisión administrativa. Ver docs/INVENTARIO-EQUIPOS-HISTORICOS.md. Sesiones reales pendientes; sin cambios remotos, etapas 3-6 ni Fase 162.

Clasificación de las 8 unidades (15/10/2026): INDETERMINADAS las ocho; 22 eventos leídos, sin coincidencias exactas en documentación/scripts de pruebas ni prueba independiente de operación real. No se atribuye la discrepancia a pruebas, antigüedad o fallo. Ver docs/INVENTARIO-OCHO-CLASIFICACION-PRUEBAS.md y evidencia sanitizada. Se detiene cualquier propuesta de corrección; sin cambios remotos ni ampliación de retiros.

Etapa 3 de seguridad de inventario (15/10/2026): BLOQUEADO antes de implementar esquema/permisos según condición del usuario. Revisión acotada de escrituras Altas/Averías y RETURNING; corrección de cantidad usa dos peticiones y falta intención durable general. Propuesta transaccional, DTO mínimo y reintentos en docs/INVENTARIO-ETAPA-3-PROPUESTA.md; sin código funcional, Cloud, migraciones ni RLS. Ocho unidades indeterminadas congeladas; sin nueva investigación. Rutinas/Fase 162 separadas.

Etapa 3 implementada LOCALMENTE (15/10/2026): RPC transaccional Altas/Averías con recibos durables, autorización por orden/asignación, kit/corrección atómicos, retiro por contrato exacto y respuesta mínima. Campo usa RPC y conserva intención ante respuesta incierta. Migración 20261016010000 preparada, NO aplicada. 17/17 SQL aisladas, 30/30 TS, 4 escenarios navegador y build correctos. Ver docs/INVENTARIO-ETAPA-3-IMPLEMENTACION.md para riesgos, archivos y rollback. Cloud intacto; permisos directos amplios y sesiones reales pendientes; ocho equipos congelados; Rutinas/Fase 162 separadas.

Preflight Cloud etapa 3 (15/10/2026, 6326203): solo SQL READ ONLY. Columnas y triggers Fase 151 compatibles; Fase 161 efectiva sin entrada en ledger consultado; Fase 162 ausente. BLOQUEADO para aprobar aplicación hasta integración con helpers/triggers reales de cierre/cuadrillas, ausentes de fixture etapa 3, y sesiones reales. 267 movimientos, 2 grupos de reversión repetida; sin corrección ni investigación nueva de las 8 unidades. Ver docs/INVENTARIO-ETAPA-3-PREFLIGHT-CLOUD.md y metadatos. Sin migraciones, escrituras, RLS, push ni despliegue; no se repitieron pruebas locales.

PAUSA SOLICITADA 15/10/2026: trabajo detenido; ver docs/INVENTARIO-ETAPA-3-PAUSA.md. Deadlock 40P01 reproducido con triggers reales de cuadrilla; NOWAIT local corrigió los escenarios, suite nueva 9/9 aprobada. As 9/9 se añadió una aserción de replay tras revocación, AÚN SIN EJECUTAR; último intento interrumpido. Cambios guardados SIN commit; migración solo local, Cloud intacto. Reanudar verificando nueva suite antes de commit; sin push/despliegue, ocho unidades congeladas y Fase 162 separada.

Etapa 3 retomada 16/10/2026: prueba pendiente de técnico revocado aprobada para Altas/Averías; recibo previo no sustituye autorización. NOWAIT probado en UPDATE/DELETE legacy: 55P03 con rollback íntegro, reintento sin duplicar. Mensaje español y dos pruebas TS 55P03 correctos; build correcto. Ver docs/INVENTARIO-ETAPA-3-CORRECCION-NOWAIT.md. Sin Cloud, migraciones aplicadas, push ni despliegue; sesiones reales pendientes. Commit exclusivo de corrección/pruebas, excluyendo cambios ajenos de Fases 161/162.

Laboratorio aislado Auth/inventario preparado 16/10/2026: scripts/inventory-auth-lab, Supabase mínimo local con PostgreSQL/Auth/PostgREST y red/volumen independientes, sin datos ni configuración de producción. JWT reales ES256 de cuatro usuarios ficticios: 49 comprobaciones API y 8 escenarios de navegador correctos; líder/apoyo 200, ajeno/retirado 403, inventario invariable. UI http://127.0.0.1:54384/. Ver docs/INVENTARIO-LAB-AUTH-VALIDACION.md y README de laboratorio para arranque/parada y límites. No certifica mutaciones ni toda App de Campo/RLS administrativa; sin Cloud, push/despliegue, datos reales ni Fase 162. Runtime ignorado por Git; cambios locales sin commit.

Laboratorio transaccional 16/10/2026: APROBADO local con JWT reales. 14 grupos API y 10 escenarios navegador; stock final/Kardex 20, 34 movimientos, 40 recibos completos, cero duplicados. Filas previas del laboratorio intactas; fixture aditiva conservada. Se corrigió timeout del harness visual y se revirtió su checkpoint mediante RPC/JWT del líder, sin editar saldos. Ver docs/INVENTARIO-LAB-TRANSACCIONES.md. No se repitieron 49 lecturas. Sin Cloud, producción, migraciones remotas, push/despliegue ni Fase 162; RLS administrativa amplia y validación integral de Campo/dispositivos pendientes.

Etapa 4 Realtime (16/10/2026, base eaa4510): parada según condición explícita del usuario. Campo suscribe filas de movimientos/unidades; administración no tiene suscripciones propias de inventario. Compose local leído: db/auth/rest/edge, sin Realtime. Invalidaciones privadas exigen transporte y autorización nuevos; propuesta en docs/INVENTARIO-ETAPA-4-REALTIME-PROPUESTA.md. Sin implementación ni pruebas Realtime; no se repitieron pruebas de etapa 3. Ningún cambio a infraestructura, políticas, publicaciones, datos ni Cloud. Nota fuera del commit para conservar cambios previos; Rutinas/Fase 162 y ocho equipos separados.

Etapa 4 laboratorio Realtime (16/10/2026, base d8bfab6): BLOQUEADO por fallo real de revocación de socket abierto. Realtime v2.143.3 instalado solo en red interna local, puerto loopback 54385, WAL lógico en DB local y policy experimental por orden. JWT reales: 10 comprobaciones PASS y 1 FAIL; técnico retirado recibe segundo aviso mínimo aun con GET contextual 403. Se detuvo integración Campo según condición explícita. Hashes inventario/recibos intactos. Ver docs/INVENTARIO-LAB-REALTIME-VALIDACION.md y resultados JSON. No repetir ensayo con journal final; sin Cloud, producción, push, despliegue, Rutinas/Fase 162 ni ocho históricos. Nota fuera del commit para preservar cambios previos.

Revocación Realtime (16/10/2026, base 0aa40d3): causa confirmada en fuente oficial v2.143.3: policies en socket/fastlane y mismo JWT ignorado, sin API pública de revocación selectiva atómica por cuadrilla. BLOQUEADO Broadcast; parada según usuario. Alternativa concreta SSE backend con autorización fresca por entrega y locks compartidos con revocación, aún NO implementada/validada. Distinguir nuevo encolado después de commit de bytes previamente en tránsito. docs/INVENTARIO-REALTIME-REVOCACION-ALTERNATIVA.md; no se repitieron pruebas previas ni se ejecutaron nuevos JWT. Sin cambios de runtime, datos, aplicación, Cloud, Rutinas/Fase 162 ni históricos.

SSE etapa 4 (16/10/2026, base d30a331): prototipo local implementado y BLOQUEADO. 8 escenarios PASS con JWT reales (roles, retirada normal, reasignación, cierre, reconexión), 1 FAIL: pausa event loop 1800ms supera idle timeout SQL 500ms, libera locks, revocación confirma y backend encola/cliente recibe señal posterior antes de procesar FATAL. Parada según condición del usuario, sin cambiar barrera tras fallo. Puerto SSE 54387 detenido; inventario/recibos íntegros, rol sin SELECT administrativo, cero transacciones pendientes. docs/INVENTARIO-LAB-SSE-VALIDACION.md, -RESULTADOS.json y -AUDITORIA.json. Fixture/journals conservados, no repetir suites. Sin Cloud, producción, push, despliegue, Rutinas/Fase 162 ni históricos.

Avisos genéricos etapa 4 (16/10/2026, base 8eeed0b/evaluación posterior): APROBADO exclusivamente en laboratorio. Reloj separado sin SQL/Auth/órdenes, frame fijo 33 bytes cada 10s; consumidor generic.html con JWT real, contexto visible, caché por generación y limpieza/pausa 401/403. 6 unitarias, 8 grupos UI/API, cabeceras y reconexión real PASS; build local correcto. 24 frames idénticos, intervalos 10006-10014ms; RSS 57,34MiB en tramo medido, cero peticiones externas. Se preservaron 5 PASS al corregir cancelación CDP; caída real requirió retry acotado por HTTP500, comprobado. Inventario/recibos íntegros; reloj de ensayo parado. Ver docs/INVENTARIO-LAB-GENERICOS-VALIDACION.md y cuatro JSON. Pendientes App Campo real, volumen/dispositivos y cierre RLS administrativo; sin Cloud, producción, push, despliegue, Rutinas/Fase 162 ni históricos. Nota fuera del commit por cambios previos.

Etapa 4 integrada localmente (16/10/2026, base 030043f): LISTO PARA REVISION. Campo Altas/Averias usa reloj generico /api/inventory-signals, snapshot contextual coalescido y limpieza/pausa 401/403; retirados solo listeners de filas de inventario de Campo. 5 unitarias + 1 HTTP SSE (10.000 ms) + 2 escenarios Vue compuestos + 4 regresiones de equipos + 11 HTTP PASS; vue-tsc/Vite PASS. Ver docs/INVENTARIO-ETAPA-4-INTEGRACION.md. Flutter fisico pendiente (sin dispositivo ADB); pruebas de cierre con persistencia sustituida, no Storage real. Cierre RLS administrativo separado en docs/INVENTARIO-RLS-ADMIN-PENDIENTE.md, pendiente por compatibilidad Rutinas/Fase 162; no iniciar fase automaticamente. Sin Cloud, produccion, datos reales, migraciones remotas, push ni despliegue. Estado global fuera del commit por cambios previos ajenos.

Cierre RLS administrativo (16/10/2026, base 7c03c2b): BLOQUEADO y detenido. Revision focalizada de consumidores: RPC Fase 162 routine_inventory_operation devuelve recibo antes de autorizar asignacion/estado vigente; cambiar RLS de tablas no corrige su SECURITY DEFINER. Corregir esa frontera exige modificar seguridad efectiva de Fase 162, prohibido en este alcance. Rutinas, Soporte/Clientes y lecturas backend con JWT aun dependen de accesos directos. Ver docs/INVENTARIO-CIERRE-RLS-BLOQUEO.md. Solo documentacion; sin migracion preparada/aplicada, pruebas repetidas, cambios de codigo, laboratorio, Cloud, produccion, datos, push o despliegue. No se afirma explotacion real ni nuevos movimientos por recuperar recibo. Estado global fuera del commit por cambios previos.

Correccion puntual de recibos Rutinas (16/10/2026, base 88adc3d): APROBADO EN LABORATORIO. Migracion local 20261016020000 sustituye solo routine_inventory_operation; verifica rol/asignacion antes de recuperar recibos. Conserva reintento tras cierre para asignado activo y exige in_progress para escrituras nuevas. 11/11 grupos JWT reales en DB ficticia separada inventory_routine_receipt_lab/PostgREST 54389: fallo original reproducido, retirado/ajeno/inactivo denegados, lider/apoyo/reintento concurrente correctos, return_routine deniega, oficina conserva roles. Saldo=Kardex=86, cuatro consumos, cinco recibos (uno fixture oficina), cero eventos; inventario laboratorio previo intacto, otras funciones/ACL intactas. Ver docs/INVENTARIO-RUTINAS-RECIBOS-CORRECCION.md. Cierre RLS global sigue pendiente; sin Cloud, produccion, datos reales, historicos, push ni despliegue. No iniciar otra fase. Estado global fuera del commit por cambios previos.

Propuesta consolidada Inventario (16/10/2026, base 7e6abd5): Cloud contrastado solo con catalogos READ ONLY/TLS. routine_inventory_operation ausente (todas las sobrecargas), tabla de recibos y columnas Fase 162 ausentes; parche de recibos no aplicable de forma independiente. Busqueda serie/MAC + guardas UI listas localmente sin migracion; cierre RLS administrativo sigue BLOQUEADO por consumidores/lecturas compartidas y agregado. Propuesta en docs/INVENTARIO-ENTREGA-CONSOLIDADA-PROPUESTA.md y evidencia docs/INVENTARIO-RUTINAS-RECIBOS-CLOUD.json. Sin nuevas funcionalidades, suites repetidas, migraciones, RLS/datos remotos, push ni despliegue. Detenido tras propuesta; sin nuevo commit ni adaptacion de otros modulos.

Entrega independiente de busqueda (16/10/2026): BLOQUEADO por punto 5 del pedido. Evidencia RLS existente permite SELECT amplio a TECNICO_RED/SOPORTE/FACTURACION; guardas 2a5e24c no protegen REST directo de busqueda 2595c77. Detenido antes de rama funcional/commit de entrega o pruebas repetidas. Cambio minimo documentado en docs/INVENTARIO-BUSQUEDA-INDEPENDIENTE-BLOQUEO.md: SELECT administrativo restringido y guard de inventory_get_albums, conservando antes lecturas contextuales/RETURNING de consumidores. No se verifico imagen actualmente desplegada ni se asume ccdf94f vigente por documento historico. Sin codigo, Cloud, datos reales, migraciones, push ni despliegue. No abrir otra fase.

Preparacion instalacion Fase 162 (16/10/2026): BLOQUEADO. Preflight Cloud READ ONLY: compatibilidad estructural OK (87 controles + resumen), fuentes de politicas/triggers/helpers recuperadas acotadamente. Ensayo nuevo PG17 sin red: instalacion atomica 162+parche7e6abd5 PASS, snapshots diez tablas/ocho historicos ficticios y politicas intactos, postcheck combinado PASS, consumo/replay PASS. FAIL carrera recibo vs DELETE job_assignees: deadlock entre Rutina FOR UPDATE y fila de cuadrilla retenida por trigger real lock_job_crew_parent; A aborto, B confirmo. Sin correccion funcional nueva ni autorizacion de aplicar. Ver docs/FASE162-INSTALACION-PREPARADA.md y tres JSON nuevos. Respaldo actualizado pendiente (script privado existente preparado), postchecks y plan de rollback/orden atomico documentados. Sin Cloud DDL/DML, datos reales, push ni despliegue. Detener tras resultado.

Correccion deadlock Fase 162 (16/10/2026): LISTO PARA REVISION LOCAL. RPC de segunda migracion toma asignacion propia FOR SHARE NOWAIT; no se alteran triggers/cuadrillas. 9/9 grupos PG17 sin red: baseline 7e6abd5 reproduce 40P01, candidato 55P03 sin movimiento y revocacion confirma; recibo/nueva operacion denegados despues de retirada, ambos ordenes de concurrencia y reintentos validos. Final stock=Kardex=97, tres consumos/recibos, unidades/eventos intactos. 2/2 instalacion atomica y postchecks, 3/3 helper UUID con respuesta perdida/55P03/revocacion; vue-tsc PASS. Helper conserva UUID pendiente y mensaje espanol. Ver docs/FASE162-DEADLOCK-CORREGIDO.md y JSON. Orden: Fase162 original y parche actualizado juntos en una transaccion; respaldo actual/ventana/autorizacion pendientes. Sin Cloud, datos reales, historicos, push ni despliegue. Estado global fuera del commit por cambios previos.

Preparacion operativa final Fase162 (16/10/2026, codigo f50914c): LISTO PARA AUTORIZAR SQL, sin ejecutar migraciones. Respaldo privado nuevo fase162_completo_20261016_202712_1abe24f6, 38.350.028 bytes, SHA256 CB8B62949BF59A23556C7A69D9516CB1614D5EDDB5490B3488001662AD9A6C94; DPAPI/TLS verify-full, pg_dump/list/read/restore=0, ACL usuario+SYSTEM, dos respaldos anteriores conservados. Timeout cliente60s: dump completo confirmado y verificacion retomada solo local, sin repetir dump. Prechecks15:32 Lima PASS: 37 funciones,14 tablas/triggers,31 policies,enums sin deriva, F162 ausente, ocho historicos conteoigual. Artefactos exactos de f50914c y bundle898c34ab verificados, no ejecutados. Ventana propuesta10min tras autorizacion, locks2s/sentencia60s/transaccion120s, baseline/postchecks y contencion documentados en docs/FASE162-LISTA-PARA-AUTORIZAR.md. Sin pruebas funcionales repetidas, Cloud DDL/DML, push ni despliegue. Autorizar/confirmar pausa y responsables antes de actuar. Estado global fuera de commit por cambios previos.

## Retomado por Claude Code (16/10/2026) — cierre de permisos de Inventario y busqueda

Sesion de transferencia Codex -> Claude Code. Fase 162 (hilo separado, arriba) ya
esta confirmada en Cloud por los commits `f50914c..9ba461c`; esta entrada es sobre
el hilo distinto y aun abierto de cierre RLS administrativo + busqueda por
nombre/modelo/serie/MAC (`INVENTARIO-ENTREGA-CONSOLIDADA-PROPUESTA.md`).

- Busqueda por nombre/modelo (registrado en el nombre)/serie/MAC: ya implementada
  en `src/lib/inventorySearch.ts`, reutilizada en busqueda general y dentro de
  cada album (`InventorySearchResults.vue` vía `InventarioAlbumView.vue`). 26/26
  pruebas (`inventorySearch.test.ts`, `inventoryAuthorization.test.ts`) PASS hoy
  sin modificar esos archivos. No requiere migracion. Solo quedaba un ajuste
  pendiente sin probar en `InventorySearchResults.vue` (reactividad a
  `auth.user?.id`, no solo `auth.role`, con `flush:'sync'`) — se deja tal cual lo
  dejo Codex, sin tocar.
- Migracion local sin aplicar `supabase/migrations/20261016220000_inventario_contextual_rls_admin.sql`
  (cierre RLS admin-only + RPC `inventory_order_read`/`inventory_ticket_review`):
  revisados sus consumidores reales. `RoutineInventory.vue`, `CampoTrabajoDetailView.vue`
  (`/campo/:tipo/:id`, Altas/Averias/Rutinas del tecnico) y `TicketDetailView.vue`
  (`/soporte/:id`) ya estaban migrados a la lectura por RPC antes de esta sesion.
  Se encontro y elimino un resto muerto: `CampoTrabajoDetailView.vue` todavia
  llamaba a `inventoryStore.fetchProducts()` (tabla directa) para `jobType==='routine'`,
  una llamada ya innecesaria desde que `RoutineInventory.vue` se autoabastece por
  RPC — quedaba silenciada por un `.catch(()=>{})` pero siempre fallaria para
  TECNICO_RED bajo el guard interno nuevo de `stores/inventory.ts`. Eliminada la
  llamada, el store y su import (3 lineas). `vue-tsc -p tsconfig.app.json` limpio.
- **Bloqueo real identificado, no documentado antes con este detalle**:
  `InstalacionDetailView.vue` (ruta `/soporte/instalaciones/:id`, SIN restriccion
  de rol en el router — alcanzable por TECNICO_RED) sigue usando
  `useInventoryUnitsStore` con acceso directo a tablas (`fetchUnitsByInstallation`,
  `fetchUnitsByProduct`, `assignUnit`, `markRepaired`) sin ningun guard de rol a
  nivel de datos. Es alcanzable en el uso real: el home movil del tecnico es
  `/soporte` (ver memoria), `OperacionesHoyView.vue` enruta ahi los trabajos de
  tipo `installation` (linea ~408), a diferencia de los tickets que ya van a la
  vista migrada. Esta es la pieza concreta que bloquea aplicar la migracion de
  cierre RLS: si se aplicara el `enable row level security`/policy admin-only de
  `20261016220000` tal cual, esta pantalla (activamente usada por tecnicos para
  Altas) perderia acceso a su inventario. No se modifico esta vista en esta
  sesion — requiere el mismo patron de migracion a `inventory_order_read` que
  `CampoTrabajoDetailView.vue`/`RoutineInventory.vue` ya tienen, es un cambio
  grande (982 lineas) y de riesgo real para operacion de campo en curso; se deja
  pendiente de decision expresa antes de tocarla.
- Sin migraciones aplicadas (ni local Docker ni Cloud), sin push, sin despliegue,
  sin nueva fase iniciada. Archivos ya modificados por Codex (ticketApprovals.ts,
  stores/inventory.ts, fieldInventoryOperation.ts, fieldInventory.ts + test,
  types/fieldInventory.ts, RoutineInventory.vue, ClientServiceDetailView.vue,
  TicketDetailView.vue, InventorySearchResults.vue) se conservan intactos, sin
  commit todavia.

## Validacion final de cierre RLS de Inventario (17/10/2026, base c2f34b9)

**LISTO PARA AUTORIZAR** la migracion
`20261016220000_inventario_contextual_rls_admin.sql` — con respaldo y captura
de politicas vigentes antes de aplicar en cualquier entorno real (ver detalle
y condiciones en `docs/INVENTARIO-CIERRE-RLS-VALIDACION-FINAL.md`). Validada
en PostgreSQL 17 aislado (laboratorio `scripts/inventory-auth-lab/security-*`,
reconstruido desde cero en esta sesion) con JWT reales firmados por GoTrue:
ADMIN, SUPERADMIN, SOPORTE, FACTURACION, tecnico asignado (leader/support),
retirado y ajeno. 25/25 PASS: ADMIN/SUPERADMIN conservan catalogo/albumes
generales; tecnicos solo su inventario contextual por orden; Altas/Averias/
Rutinas conservan RETURNING/reintentos/movimientos
(`campo_inventory_operation` concurrente, correccion/reversion,
`routine_inventory_operation` con reintento exacto); Fase 162
(`routine_inventory_operation`) confirmada **byte-identica** antes/despues de
la migracion. Sin Cloud, sin push, sin despliegue.

Dos hallazgos corregidos antes de validar: (1) la version anterior de la
migracion exponia `notes` de equipo a tecnico/oficina en
`inventory_order_read` — el propio laboratorio lo detecto (su prueba de fuga
ya cubria price/balance_after/total_value/notes/document_number); corregido
omitiendo la clave completa (no solo el valor en null) salvo ADMIN/SUPERADMIN,
via `jsonb_build_object(...) || case when rol admin then ... else '{}' end`.
(2) el laboratorio de la sesion anterior no podia obtener JWT reales en una
corrida nueva (GoTrue detras de Caddy sin prefijo `/auth/v1`, que
`createClient(...).auth.signIn/signUp` siempre antepone) — corregido pidiendo
el token/cuenta por la ruta real de GoTrue (`fetch` directo a `/token`,
`/signup`), mismo JWT real, solo cambia como se obtiene; tambien se alineo
`common.mjs`/`config.json` al puerto que el laboratorio realmente publica
(54382, ya correcto en `compose.json` desde el origen).

Instalaciones canceladas: el 403 esperado del RPC (a proposito, no es un bug)
ya no se muestra como error en `InstalacionDetailView.vue` — nuevo helper
`src/lib/installationInventoryError.ts`
(`presentInstallationInventoryError`), 5/5 pruebas nuevas. Ningun otro caso de
error cambia su mensaje; no se afloja ninguna autorizacion.

Pruebas nuevas de esta sesion (no se repitieron las 51 ya aprobadas en
`c2f34b9`): 25/25 laboratorio real + 5/5 `installationInventoryError.test.ts`;
`vue-tsc -p tsconfig.app.json` limpio. Commit local pendiente de crear en este
mismo turno. Falta, antes de autorizar la aplicacion real: decidir entorno
(Cloud es el unico real en este proyecto), respaldo fresco y captura de
politicas/grants vigentes, y pedido explicito en el turno en que se vaya a
aplicar — regla permanente del proyecto, no se ejecuta aqui.

## Preflight Cloud de activacion final (17/10/2026, base 5e9626b)

**BLOQUEADO para la activacion conjunta** — no por el archivo de migracion en
si (confirmado compatible punto por punto con el esquema real de Cloud via
consultas de solo lectura a `mzupdnjegfwmpajywckd`), sino por dos hallazgos
externos nuevos. Detalle completo en
`docs/INVENTARIO-ACTIVACION-FINAL-PREFLIGHT.md`.

1. **Dependencia dura no resuelta**: el frontend ya migrado localmente
   (`CampoTrabajoDetailView.vue`, `ticketApprovals.ts`) llama a la RPC
   `campo_inventory_operation` (Etapa 3, migracion `20261016010000_campo_
   inventory_operations.sql`) para TODAS las escrituras de Altas/Averias.
   Confirmado por consulta directa: ni esa funcion ni su tabla de recibos
   `campo_inventory_operations` existen en Cloud. Etapa 3 seguia "LISTO en
   laboratorio; BLOQUEADO para activacion independiente" de sesiones
   anteriores — no se reabre ni se vuelve a probar aqui, solo se confirma que
   sigue pendiente y ahora es obligatoria, no opcional, para desplegar el
   frontend actual.
2. **Respaldo desactualizado**: el mas reciente
   (`fase162_completo_20261016_202712_1abe24f6`) es anterior a que Fase 162
   se confirmara en Cloud y a datos reales escritos desde entonces (128
   unidades hoy vs ~124 el 15/10). No se creo un respaldo nuevo en esta
   sesion (requiere credencial de BD que no se trae a este contexto). Estado
   del respaldo administrado propio de Supabase sin reconfirmar (ultimo
   reporte del usuario, "No backups", es del 14/10).

Confirmado en la misma revision: `inventory_get_albums()` es ejecutable hoy
por `anon`/PUBLIC en Cloud (tambien senalado por `get_advisors`) — hallazgo
real y vigente que la migracion corrige. 10 politicas amplias reales
confirmadas por nombre en las 5 tablas (todas permiten TECNICO_RED/SOPORTE/
FACTURACION salvo DELETE). Hash del archivo de migracion igual en disco, en
HEAD de git y en lo ya validado con JWT reales (sin deriva). Busqueda por
nombre/modelo/serie/MAC sigue LISTA e independiente, sin bloqueo.

Nada pushed/desplegado (`origin/main` sigue en `b128e42`). Sin Cloud DDL/DML,
sin nueva fase, sin repetir las 25 pruebas del laboratorio ni las 51
anteriores.
