# Altas Dúo IPTV — corrección de bloqueos y paquete local

> Preparación posterior de certificación física: [Android/WebView](ALTAS-IPTV-ANDROID-CERTIFICACION-20261111.md).
> APK de laboratorio compilada; ADB aún sin celular y cero pruebas físicas aprobadas.

**Estado: NO APTO para autorizar la publicación a técnicos hasta certificar
Android/System WebView real.** Los bloqueos de código identificados están
corregidos y el paquete local está preparado. Las pruebas de escritorio no
certifican la APK instalada. No se aplicó SQL, hizo push ni desplegó.

Base solicitada: `8688bfc`. Corrección: `36cc6b9`. Portabilidad del paquete:
`bcb3ec4`. **Candidato de aplicación/SQL empaquetado:
`bcb3ec4c432c6baa39f175cca115795d5ae1cd45`**. El commit documental de este
informe también contiene el ajuste del preparador local para compilar desde
archivos Git aislados y forzar entorno de producción; no cambia el candidato.
Este informe actualiza los bloqueos de las revisiones anteriores, que quedan
como antecedentes. Evidencia legible por máquina:
`ALTAS-IPTV-BLOQUEOS-PRUEBAS-20261111.json`.

## Causas y soluciones

| Bloqueo | Causa | Corrección y límite |
|---|---|---|
| IndexedDB incompleta | Dos inicializadores abrían la misma BD sin incrementar versión y creaban solo su store. | Conexión compartida y upgrade aditivo de `drafts` y `closures`. Conserva stores adicionales, registros y Blobs. Si una vista anterior impide el upgrade, muestra error y permite reintentar cuando se cierre esa vista; no fuerza su cierre ni elimina datos. |
| Modalidad perdida | `draftHasContent` no consideraba la modalidad aislada y se borraba el borrador vacío aparente. | Cuenta modalidad y otros campos; no guarda valores iniciales antes de restaurar ni borra automáticamente snapshots vacíos. Errores de lectura/guardado son visibles y bloquean el cierre. Reintentar un guardado fallido conserva la edición en memoria, sin recargar un snapshot anterior encima. |
| Primer pendiente bloqueaba todo | `flushQueue` hacía `break` ante cualquier rechazo. | Retiene el envío rechazado y las intenciones posteriores de esa orden; continúa otras órdenes. Red o JWT fallidos pausan el lote. Un rechazo de permisos por orden no detiene las demás. Conserva mensajes PostgREST aunque sean objetos planos. |
| Colas de versiones anteriores | No tenían modalidad ni recibo verificable de cierre. | Panel de pendientes con corrección humana explícita de modalidad, sin sustituir notas/fotos/IDs. Sin elección por defecto. Registros de otra cuenta se conservan y no se transmiten. Las colas antiguas sin propietario siguen sujetas a permisos/cuadrilla del servidor. |
| Reintentos y duplicados | Una respuesta perdida no permitía distinguir el mismo envío de una intención posterior. | ID estable de operación y SHA-256 de la intención, incluidos bytes de fotos/firma. Se guardan atómicamente con estado/modalidad. Un reintento exactamente confirmado se reconoce solo leyendo. Una intención distinta o un cierre histórico sin recibo queda para revisión, sin volver a cerrar ni descartarse automáticamente. |
| Dos vistas sincronizando | El guard anterior solo protegía una instancia de Pinia. | Web Locks por cola y por trabajo, además del guard existente. Se probó con dos pestañas. Si Web Locks no está disponible se informa y se conservan pendientes; no se simula un lock inseguro. |
| JS antiguo escribía parcialmente | La comprobación de modalidad fallaba al final, después de código/evidencias. | La RPC antigua `assert_material_closure_ready` conserva el validador original y rechaza tempranamente las Altas nuevas versión 1 con `PIP09`. El cliente nuevo usa preflight de cinco argumentos y las mismas validaciones originales. Legacy/tickets/rutinas mantienen la ruta anterior. |
| Paquete aún apuntaba a OLT | Scope/snapshot anteriores correspondían a `40e43c1`; las nuevas dependencias generan dos chunks nuevos. | Scope/snapshot IPTV separados. El contrato exige los hashes de ambos grafos y las dos adiciones explícitas; sigue rechazando bajas de chunks, cambios de identidad y archivos ajenos. Empaquetado local sin SSH. No se reemplazaron entradas de la release OLT. |

La compatibilidad mínima es **rechazar de forma temprana y recuperable** el
cliente antiguo para Altas nuevas; no hacer pasar cierres sin modalidad ni
inferir entrega Rayco. El administrador debe conservar la pausa hasta que los
dispositivos carguen la versión nueva. Detener Campo no demuestra que sus
almacenamientos estén vacíos.

## PostgreSQL, inventario e históricos

Se leyó únicamente el metadato de la prevalidación real, usando TLS y
transacción READ ONLY. No se repitió la auditoría de órdenes. Captura:
`ALTAS-IPTV-COMPAT-PREFLIGHT-20261111.json`; consulta fija:
`scripts/diagnostics/iptv-closure-compat-readonly.sql`.

La migración **preparada, no aplicada** es
`supabase/migrations/20261111140000_installation_iptv_mode.sql`:

- Mantiene las columnas de modalidad/versión y añade recibo nullable
  `closure_operation_id`/`closure_payload_hash`; filas existentes conservan
  NULL. No hay backfill ni DML sobre órdenes, contratos o inventario.
- Conserva el cuerpo real de materiales bajo nombre interno, sin EXECUTE
  para clientes. El preflight nuevo ejecuta perfil activo, permisos, lock,
  cuadrilla y materiales originales; no omite controles por elegir app.
- El preflight y el trigger llaman al mismo validador de modalidad. Smart TV
  y dispositivo propio no ejecutan asignaciones/descuentos TV Box. Rechazan
  un TV Box Rayco ya asignado/pendiente a esa misma Alta para no ocultarlo.
- Rayco exige equipo del mismo cliente, contrato y orden, serie **o** MAC
  no vacía, estado asignado y evento real desde custodia. No crea movimientos.
- Mantiene ONT, Zona/NAP y las validaciones existentes de materiales,
  evidencias y cierre. La constancia y el recibo cerrados son inmutables.
- Guardas del cuerpo previo: cierre `e452ec213962f70d8db289ac17ed361f`;
  prevalidación de materiales `729872fe0cba0b2b84315a8146a08528`. Cierre tras
  migrar: `aefea82d144a6c6f3218d0f81b43816f` (MD5 normalizado, sin comentarios).

Rollback: `scripts/rollback-installation-iptv-mode.sql`, probado junto con
reaplicación en PostgreSQL local. Restaura la función de cierre y la RPC
originales, retira preflight/validador nuevos y DEFAULT/trigger INSERT.
Conserva columnas, modalidades, recibos y guarda UPDATE; no recalcula nada.
La regla antigua vuelve a exigir TV Box: Altas iniciadas por app después del
SQL pueden quedar bloqueadas hasta recuperación autorizada. No resolverlo
inventando equipos ni modificando versiones.

Rosita, las 9 órdenes abiertas, las 4 sesiones huérfanas y la aprobación
histórica no se modificaron. La muestra 09:32:57 Lima del informe de ventana
sigue siendo **una muestra anterior**, no una comprobación vigente de toda
esta sesión. Repetirla inmediatamente antes de una intervención autorizada.

## Pruebas ejecutadas

| Prueba | Resultado y alcance |
|---|---|
| `node --import tsx --test server/tests/installationIptvMode.sql.test.ts` | **22 PASS**, PostgreSQL local sin red, datos sintéticos. Tres modalidades; ONT/NAP/contrato, materiales, permisos, serie/MAC, custodia; cierre y recibo inmutables; RPC antigua/alias; carreras de cierre, asignación y traslado; snapshots de stock/unidades/movimientos/custodia; rollback y reaplicación. |
| `node --import tsx --test src/lib/__tests__/installationIptv.test.ts server/tests/installationIptv.ui.test.mjs server/tests/installationIptvPublication.diagnostic.test.mjs` | **27 PASS**. Reglas frontend/trigger, Campo/admin, cola de las tres modalidades, respuesta perdida y distinto payload, error previo a evidencias, guardado/recuperación y ejecución del código antiguo real con prevalidación rechazada. |
| `node scripts/tests/iptv-mode-browser.mjs` | **30 PASS**, Chrome headless con perfil efímero, Vue/store reales y transporte sintético, red externa bloqueada. Ambos órdenes de creación de stores; upgrade con conexión antigua bloqueando; Blobs tras recarga; modalidad sola; corrección humana de cola; orden independiente y cuenta distinta; error plano 42501; pausa por red; dos pestañas; hash File/Blob; borrador posterior preservado. |
| `node scripts/tests/consolidation-release-contract.test.cjs --python C:/Users/USER/AppData/Local/Python/pythoncore-3.15-64/python.exe` | **34 PASS**, Python local, sin VM. Incluye transición de grafo explícita, rechazo de drift, protección de archivos estáticos/huérfanos y colisiones QR. |
| `IPTV_REVIEWED_COMMIT=bcb3ec4` + `node --test scripts/tests/iptv-maintenance-preflight.test.mjs` | **5 PASS** de integridad de la muestra anterior y del candidato. No es lectura actual del servidor. En PowerShell asignar con `$env:IPTV_REVIEWED_COMMIT='bcb3ec4'`. |
| `node node_modules/vue-tsc/bin/vue-tsc.js --noEmit -p tsconfig.app.json` | PASS. |
| `node scripts/iptv-release-local.mjs --python C:/Users/USER/AppData/Local/Python/pythoncore-3.15-64/python.exe` | PASS final: baseline y candidato desde archivos Git; dos builds de candidato idénticos, **128 artefactos**; contrato completo aprobado; paquete local SQL/rollback con hashes. |

**118 comprobaciones PASS**, más tipos y compilaciones; no sumar las antiguas
caracterizaciones de fallos como aprobaciones actuales. Un intento de tsx
falló al leer el perfil dentro del sandbox; reejecutado fuera pasó 27/27.
El empaquetado se ajustó por tar de Windows y por NODE_ENV de desarrollo
heredado de configuración local; el resultado final usa `production` y
fuentes extraídas, sin incorporar documentos/pendientes locales a Tailwind.
Los avisos de tamaño de chunks Vite siguen presentes.

### Pendiente que requiere Android/WebView real

En un entorno aislado con datos sintéticos y el APK instalado:

1. Registrar versión Android, proveedor/versión WebView y commit JS servido;
   comprobar Web Locks, IndexedDB, Web Crypto, cámara y File/Blob.
2. Mantener una vista con JS anterior y borrador/fotos; cargar la nueva,
   comprobar aviso de bloqueo, guardar y cerrar la vista antigua, reintentar
   upgrade y recuperar ambas colecciones sin borrar almacenamiento.
3. Guardar solo modalidad y luego fotos/firma; enviar la app a segundo plano,
   detener su proceso **después de confirmar guardado** y recuperar. No se
   promete recuperar una captura que Android mate antes de persistir.
4. Sin red, encolar dos órdenes, una incompatible; reconectar, elegir su
   modalidad explícitamente y verificar que la otra continúa y no duplica
   movimientos. Simular respuesta perdida en entorno aislado.
5. Cerrar tres Altas sintéticas distintas: Smart TV y equipo propio sin TV
   Box; Rayco con identidad/custodia. Validar evidencias y cantidades antes/
   después. Comprobar autenticación y recarga completa sin borrar datos.

Chrome de escritorio certifica la lógica local y el esquema, **no** la
supervivencia del proceso Android ni la caché/perfil del APK. Una cola antigua
ya cerrada sin recibo verificable queda para revisión; no se descarta ni se
reenvía como si estuviera abierta. Los locks de navegador no son locks entre
celulares: el servidor conserva su serialización; el flujo histórico de
subida de evidencias sigue usando sus operaciones/reintentos existentes.

## Paquete y secuencia de futura publicación

Versionados y separados de OLT:
`deploy/iptv-20261111/scope.json` y
`deploy/iptv-20261111/release-source.json`. El scope contiene 15 fuentes,
11 assets lógicos y 2 adiciones de grafo revisadas. Algunos chunks de Campo
y `usePersonalRead` contienen código compartido de su store; el comparador
exige el conjunto exacto de fuentes, sin fuentes ajenas.

Paquete local ignorado por Git:
`scripts/inventory-auth-lab/runtime/consolidation-release/frontend-consolidado-tr069-bcb3ec4-640f166b34/`.
Contiene `source.tar`, `input.json`, SQL, rollback y `package.json` con SHA-256.
Builds y logs locales:
`scripts/inventory-auth-lab/runtime/iptv-bcb3ec4c432c-1794410564161/`.
El prefijo histórico `tr069` pertenece al publicador existente: **no** incluye
un release de backend/TR069. El stage remoto aún no se creó.

**Comandos siguientes preparados; ninguno ejecutado contra el servidor:**

1. Completar la certificación Android anterior. Obtener autorización explícita
   para publicación y SQL. Mantener Campo detenido sin cerrar/borrar las 9
   órdenes, sesiones huérfanas ni almacenamientos locales. Repetir lectura de
   mantenimiento y metadatos; detener ante ejecución, operación incompleta o
   drift. No declarar vacíos los celulares por el resultado del servidor.
2. Verificar SHA-256 contra el JSON de evidencia; respaldar esquema, funciones,
   ACL, metadatos de instalaciones y de inventario/custodia por canal privado.
   Registrar la instantánea histórica para comparación posterior. Un backup
   productivo o imagen remota **no** está hecho por el empaquetado local.
3. Publicar en Git solo los commits autorizados mediante push normal. Usar
   estas entradas separadas en **todas** las fases del publicador:

   ```powershell
   node scripts/frontend-consolidation-release.cjs prepare --scope deploy/iptv-20261111/scope.json --snapshot deploy/iptv-20261111/release-source.json
   node scripts/frontend-consolidation-release.cjs build --scope deploy/iptv-20261111/scope.json --snapshot deploy/iptv-20261111/release-source.json
   ```

   `prepare` crea respaldos de imágenes/rollback y exige fuentes reales
   coincidentes. `build` verifica el grafo contra la imagen viva, configuración
   pública idéntica, doble build, backend HTTP/configuración/otros servicios
   intactos. Ambos requieren autorización para trabajo remoto. Si la imagen
   viva difiere del baseline o el contrato falla, detener; no ampliar el scope
   sobre la marcha ni omitir guardas. No usar los defaults OLT.
4. Frontend compatible primero, con Campo todavía cerrado:

   ```powershell
   node scripts/frontend-consolidation-release.cjs deploy --scope deploy/iptv-20261111/scope.json --snapshot deploy/iptv-20261111/release-source.json
   node scripts/frontend-consolidation-release.cjs verify --scope deploy/iptv-20261111/scope.json --snapshot deploy/iptv-20261111/release-source.json
   ```

   Verificar commit `bcb3ec4…`, assets, login, rutas y almacenamiento preservado
   en el dispositivo certificado. Antes del SQL conserva las reglas antiguas;
   no probar Smart TV cerrando clientes reales. No se despliega backend Hono.
5. Repetir lectura inmediatamente antes del SQL. Por el canal privado existente,
   en el proyecto correcto y con autorización SQL explícita:
   `psql -X -v ON_ERROR_STOP=1 -f supabase/migrations/20261111140000_installation_iptv_mode.sql`.
   No usar `supabase db push`. Confirmar commit transaccional, columnas/default,
   triggers/ACL, firma de cinco argumentos, wrapper antiguo y recarga PostgREST;
   registrar aplicación en el mecanismo existente de migraciones. Comparar
   históricos/inventario con el respaldo en solo lectura. No hay backfill.
6. Validar primero el entorno sintético aislado. Después observar únicamente
   una futura Alta Dúo real normalmente autorizada, del contrato exacto, con la
   modalidad realmente instalada, ONT/materiales/evidencias reales. Una sola
   ejecución; inventario antes/después. Rosita no es piloto y no se reabre.
7. Reabrir Campo por grupos después de recarga completa y confirmación de JS
   nuevo. No borrar caché/datos ni reinstalar. Pendientes incompatibles se
   conservan/corrigen explícitamente; un histórico cerrado sin recibo requiere
   revisión individual. Monitorear errores, colas y recibos sin regularización
   automática de sesiones ni equipos.

### Recuperación

- Antes del SQL: mantener pausa; usar `rollback` del mismo publicador con
  **los mismos** argumentos `--scope`/`--snapshot`, y verificar imagen y salud
  originales. Conservar IndexedDB aditiva; la biblioteca anterior abre sin
  versión y se probó que sigue leyendo su store. No reducir ni borrar la BD.
- Migración rechazada: la transacción aborta con timeout/guarda; verificar que
  quedó el esquema original. No ejecutar fragmentos ni modificar filas para
  hacer pasar validaciones.
- Después del SQL: detener nuevos envíos y sincronización; conservar colas y
  cierres confirmados. Con autorización, restaurar frontend del mismo stage
  y ejecutar `psql -X -v ON_ERROR_STOP=1 -f scripts/rollback-installation-iptv-mode.sql`.
  Verificar función original/ACL y retiro de activación nueva. No restaurar
  un dump encima de trabajo ya confirmado ni revertir movimientos históricos.
  Altas nuevas por app pueden quedar bloqueadas por la regla anterior: mantener
  ese caso preservado para recuperar/reaplicar el paquete coherente.
- Si cambia cualquier herramienta/scope/snapshot tras preparar el stage,
  detener y preparar un nuevo intento. No reutilizar a ciegas un staging fallido.

## Archivos de esta corrección

- Aplicación: `src/lib/campoDatabase.ts`, `closureSubmission.ts`, `formDrafts.ts`,
  `offlineQueue.ts`, `installationIptv.ts`; `src/stores/campo.ts`,
  `installations.ts`; `src/types/domain.ts`; `src/components/campo/CampoLayout.vue`,
  `ClosureQueuePanel.vue`; `src/views/campo/CampoTrabajoDetailView.vue` y
  `src/views/instalaciones/InstalacionDetailView.vue`.
- SQL/lectura: migración y rollback anteriores;
  `scripts/iptv-installation-readonly.ps1`,
  `scripts/diagnostics/iptv-closure-compat-readonly.sql`, captura JSON indicada.
- Publicación local: `scripts/frontend-release-build.mjs`,
  `frontend-consolidation-release.cjs`, `consolidation-release-contract.py`,
  `iptv-release-local.mjs`, `iptv-release-scope.py`, scope/snapshot IPTV.
- Pruebas: `src/lib/__tests__/installationIptv.test.ts`,
  `server/tests/installationIptv.ui.test.mjs`, `installationIptvMode.sql.test.ts`,
  `installationIptvPublication.diagnostic.test.mjs`;
  `scripts/tests/iptv-mode-browser.html`, `iptv-mode-browser.mjs`,
  `iptv-offline-browser-cases.mjs`, `consolidation-release-contract.test.cjs`
  y `.test.py`.
- Documentación: este informe, JSON de pruebas, referencias en los tres informes
  previos y únicamente el párrafo IPTV de continuidad. Los cambios pendientes
  de otras fases, incluso otros párrafos de continuidad e inventario documental,
  quedan fuera de los commits.
