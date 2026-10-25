# Integración Git de puntos — candidata para revisión

## Resultado vigente

La decisión del usuario autoriza conservar consulta y solicitudes de devolución en «Mi custodia», pendientes de recepción administrativa. Se resolvieron por contenido los 29 archivos (72 bloques de conflicto), sin estrategias globales ours/theirs. La candidata está en `candidate/puntos-integracion-20261025`; su commit de merge conserva como padres `f763d37` y `0b60cb8`. No se modificó main, no hay push ni despliegue.

### Funcionalidades y resoluciones

| Área / archivos | Resolución |
| --- | --- |
| `CampoMiCustodiaView.vue`, `CampoCustodiaView.vue` | Entrada por identidad hacia la pantalla operativa local; consulta de equipos/materiales y solicitudes conservada. Se integra `usePersonalRead` remoto para limpiar datos y descartar respuestas tardías al cambiar de usuario; se limpian formularios. Solicitar llama únicamente a las RPC existentes; no confirma, libera ni descuenta desde el cliente. |
| `CampoJobPoints.vue`, nuevo `CampoJobContribution.vue`, `CampoTrabajoDetailView.vue` | Se muestran por separado puntaje asignado y aporte acreditado. Se conserva la consulta operativa local con realtime/polling y la consulta personal de aportes remota; ninguna acredita desde el cliente. Se conserva el formulario móvil remoto de inventario y se retiran captura/requisito de firma nueva según la decisión previa; firmas históricas y guardas definitivas locales permanecen. |
| `InstalacionDetailView.vue` | Historial remoto de movimientos revertidos y estilos, junto con editor de puntos/guardas locales y texto de hoja física. No se reemplaza la vista completa. |
| `ClientesView.vue`, `ClientDetailView.vue`, `ClientServiceDetailView.vue`, stores de clientes/instalaciones/contratos | Baja definitiva local y reactivación protegida, clasificación/paginación/prospectos remotos y baja administrativa por línea conservados. Contratos no tenía conflicto textual; se valida su comportamiento con sus suites. La conversión de prospecto conserva los 10 puntos del Alta; se actualiza esa expectativa del test remoto. |
| `server/src/services/debtHoldService.ts` | Se mantiene la guarda local que impide reactivar contrato cancelado/ficha retirada, además de las protecciones remotas de ONT retirada/router administrador. El conflicto adicional era el comentario de fase. |
| `server/src/index.ts`, `package.json` | Se conservan tanto la ruta local de baja como scheduler remoto del balanceador y script de prueba de reintentos. |
| Archivos MikroTik del inventario histórico de conflictos | Los bloques comunes se resuelven con la numeración remota 171/172/173. Los bloques nuevos remotos conservan descubrimiento WAN, salud, gráficos, alertas y corrección del eje Y; las funciones comunes locales de borde/reconciliación permanecen. Se revisaron todos los bloques del detalle, no se seleccionó un archivo completo a ciegas. |
| `materialRejectionDoesNotBlockClosure.sql.test.ts` | Se conservan también las fixtures y regresión remota de Rutinas, además de Altas/Averías. |
| `scripts/tests/clientes-lifecycle-browser.mjs` | Se integra la ampliación local de baja definitiva sin perder escenarios remotos de prospectos. |
| `ESTADO_DESARROLLO.md`, documentos de clientes y errores | Se mantienen ambas historias de desarrollo con procedencia explícita, los enlaces locales a despliegues históricos y la explicación remota ampliada del incidente de materiales. Es evidencia histórica, no una nueva afirmación sobre producción. |

El inventario de los 29 archivos se conserva al final en la sección histórica. Los auto-merges se revisaron en Campo, clientes, contratos, tipos y stores de órdenes; fueron cubiertos por pruebas de ambos lados. Los demás módulos remotos permanecen en el historial y en el árbol de la candidata.

### Migraciones y preservación

Los originales locales `20261024120000_fase168_mikrotik_device_role.sql` y `20261024130000_fase169_mikrotik_borde_trafico.sql` se archivaron íntegros en `docs/sql/mikrotik-legacy/`. Se conservan sus versiones canónicas remotas Fase 171/172 en `supabase/migrations`. Solo diferían comentarios de fase; no hay diferencias SQL. El archivo README del directorio explica la equivalencia y prohíbe ejecutarlos desde el archivo histórico.

No se borra trabajo: los 1122 paths de la unión de ambos árboles padre están presentes, con esos dos movimientos explícitos verificados. Todas las versiones de `supabase/migrations` son únicas. Las tres migraciones de puntos coinciden exactamente como objetos Git con `0b60cb8`, incluida la revocación service_role; no se alteraron hash exigido, cálculo, reparto ni fechas.

La evidencia reproducible está en `PUNTOS-INTEGRACION-PRESERVACION-20261025.json`. Se conservaron los 23 commits locales y 35 remotos, sin rebase/cherry-pick ni recreación de commits. La verificación de ambos padres como ancestros se hace al crear el commit candidato. El bundle y referencias de respaldo descritos abajo permanecen disponibles.

### Pruebas de la candidata

| Grupo | Resultado |
| --- | --- |
| Puntos, confirmación, cierres, devolución de Rutinas, idempotencia y pruebas de dos fixtures corregidas | 119 aprobadas en la ejecución final |
| Custodia, baja definitiva de cliente, API/guardas de reactivación, baja por línea y lectura personal | 62 aprobadas; la suite de custodia se repitió después de reforzar trazabilidad (23/23) |
| Materiales, reintentos, equipo serializado y funciones afectadas de MikroTik | 144 aprobadas |
| Contratos UI/store real, clasificación de clientes, selectores de custodia y presentación de movimientos/rechazos | 32 aprobadas |
| Navegador Vue real con API sintética/red externa bloqueada | 147 comprobaciones: 64 confirmación + 19 editor + 50 Campo/stores + 14 integración custodia/puntos |
| Flujos de clientes en navegador | Baja definitiva y prospectos/conversión aprobados; todas las escrituras son simuladas |
| TypeScript | `vue-tsc -b --pretty false` y `tsc -p tsconfig.server.json --pretty false` aprobados |
| Compilación | `vite build` aprobado con configuración sintética; 391 módulos. Aviso existente de chunks mayores de 500 kB. Artefacto de laboratorio, no desplegarlo. |

Los ensayos SQL usan PostgreSQL efímero Docker sin red y datos ficticios. Los navegadores solo acceden al servidor local; APIs externas se interceptan o bloquean. Se usan las dependencias instaladas existentes, no se copia .env ni trabajo sin commit del checkout principal.

Total: **357 pruebas distintas aprobadas** en los cuatro grupos, cero fallidas/omitidas en sus ejecuciones finales, más 147 comprobaciones de navegador y los dos flujos de clientes. Las repeticiones de suites no se suman al total.

Comandos focalizados ejecutados:

```text
node --import tsx --test server/tests/workOrderPointConfirmations.sql.test.ts server/tests/workOrderPoints.sql.test.ts server/tests/closedOrders.sql.test.ts server/tests/routineReturns.sql.test.ts src/lib/__tests__/workOrderPoints.test.ts src/lib/__tests__/jobClosureIdempotency.test.ts server/src/services/__tests__/fieldInventory.test.ts server/src/services/__tests__/oltAlertHistoryOnt.test.ts
node --import tsx --test server/tests/technicianCustody.sql.test.ts server/tests/clientRetirement.sql.test.ts server/tests/clientRetirement.http.test.ts server/tests/clientRetirement.reactivation.test.ts server/tests/clientRetirement.executorBoundary.test.mjs server/tests/contractAdministrativeCancellation.sql.test.ts src/lib/__tests__/custodyReturns.test.ts src/lib/__tests__/fieldProgress.test.ts
node --import tsx --test server/tests/custodyRequiredMaterials.sql.test.ts server/tests/materialRejectionDoesNotBlockClosure.sql.test.ts server/tests/installationEquipmentRequiredClosure.sql.test.ts server/tests/retryRejectedMaterialOperation.sql.test.ts server/src/services/__tests__/mikrotikBorderTraffic.test.ts server/src/services/__tests__/mikrotikDeviceRole.test.ts server/src/services/__tests__/mikrotikReconcileScope.test.ts server/src/services/__tests__/mikrotikBalancerAlerts.test.ts server/src/services/__tests__/mikrotikBalancerDiscovery.test.ts server/src/services/__tests__/mikrotikBalancerTrafficSeries.test.ts src/lib/__tests__/mikrotikBorderTraffic.test.ts src/lib/__tests__/mikrotikBalancerHealth.test.ts src/lib/__tests__/mikrotikBalancerLinkAlerts.test.ts
node --import tsx --test server/tests/contractAdministrativeCancellation.ui.test.mjs src/lib/__tests__/clientLifecycle.test.ts src/lib/__tests__/fieldCustodyChoices.test.ts src/lib/__tests__/materialMovementPresentation.test.ts src/lib/__tests__/materialRejectionPresentation.test.ts
node scripts/tests/point-confirmations-browser.mjs
node scripts/tests/work-order-points-browser.mjs
node scripts/tests/field-order-points-browser.mjs
node scripts/tests/campo-integration-browser.mjs
node scripts/tests/clientes-lifecycle-browser.mjs --retirement
node scripts/tests/clientes-lifecycle-browser.mjs --prospects
```

Fallos iniciales resueltos y límites de la evidencia:

- El checkout Windows convirtió SQL de fixture a CRLF y causó el aborto esperado por hash. Se normaliza LF al leer fixtures de las dos suites; la candidata SQL y su guarda de deriva no se cambian. El nuevo ensayo instala las tres en aislamiento.
- TypeScript detectó import `.ts` incompatible con tsconfig en una prueba remota, dos propiedades nullable ausentes en una fixture OLT y dos parámetros UUID inferidos demasiado estrechos en pruebas de materiales. Se corrigieron solo esas pruebas, sin cambiar módulos de negocio.
- Los navegadores de puntos dependían de .env del checkout principal; se explicitan URL/clave ficticias en los tres runners. Se repitieron con éxito. Un primer intento de Chrome falló por acceso al WebSocket local; el ensayo con permisos de ejecución aprobados pasó.
- La prueba remota de conversión esperaba un Alta sin puntos; ahora comprueba `points: 10`, requerido por la implementación local ya aprobada. No se cambia ese comportamiento.
- La prueba de custodia verifica además que `pending_return` conserva el técnico, material pendiente conserva saldo y no crea Kardex, técnico solicitante y administrador receptor quedan trazados y la recepción se registra una sola vez. La fixture usa el default real auth.uid en created_by de eventos de equipo.

### Pendientes de activación y publicación

La integración no equivale a autorización de producción. Faltan prueba Android/WebView completa y sesiones Supabase/realtime reales en aislamiento, rollback coordinado de puntos después de COMMIT y preflight autorizado antes de cualquier instalación. Se conserva el límite ya conocido del mutex OLT entre procesos; su prueba reproduce la limitación, no la corrige ni habilita operaciones de red.

Antes de publicar: revisar este merge, comprobar otra vez origin/main y abrir/publicar solo la rama candidata con autorización explícita. Si remoto avanzó, preparar una nueva integración controlada; nunca force push ni reemplazo de main. No ejecutar una instalación global de migraciones pendientes por integrar el repositorio.

Main sigue en `0b60cb8`; se verificaron nuevamente los 289 originales respaldados con cero cambios. Su índice y los nueve archivos versionados modificados previos se conservan; no se introdujo trabajo sin commit de main en la candidata. Producción permaneció sin conexiones ni escrituras. Sin push, despliegue, reset, clean o force push.

## Registro histórico de la pausa anterior — decisión ya resuelta

Fecha: 25/10/2026. No es una versión integrada ni certificada. Se detuvo al identificar una elección de comportamiento, conforme a la restricción del usuario. No se resolvieron archivos por preferencia global local/remoto.

## Referencias y respaldo verificado

- Main original: `0b60cb8d1b1b90202ebbbcdb9e9fbeceb9003fe9`, sin mover.
- Origin/main después de `git fetch --no-tags origin main`: `f763d37b646a07ecbf70e354c8976ce96bae9d28`, sin cambios respecto a la referencia anterior.
- Base común: `40cd3967b573db0d8379e2df67449584ab10051b`.
- 23 commits exclusivos locales y 35 exclusivos remotos: 58 commits exclusivos en conjunto, todos preservados en el respaldo de historial completo. No equivale a 58 commits ya integrados en la candidata.
- Referencias de respaldo: `backup/puntos-local-20261025` y `backup/puntos-origin-prefetch-20261025`.
- Bundle: `D:/SmartRayco/scripts/inventory-auth-lab/runtime/git-integration-20261025/history.bundle`.
- `git bundle verify` aprobado: historial completo y ambas referencias. SHA-256: `5981FD01113CB425D1190FD9349A30E89DC89DA8E61D83836BB72E61386D438B`.
- Respaldo privado adicional en ese directorio: diff binario de árbol e índice, copias de nueve archivos versionados modificados y 280 no versionados, con manifiesto SHA-256. Se verificaron los 289 originales y sus copias: cero discrepancias. No es un respaldo de todos los archivos ignorados ni de otros worktrees; estos permanecen intactos. No publicar el directorio privado.

## Worktree y estado del merge

- Rama: `candidate/puntos-integracion-20261025`.
- Worktree: `D:/SmartRayco/scripts/inventory-auth-lab/runtime/puntos-integracion-worktree`.
- Creada desde origin/main. HEAD candidato sigue en `f763d37`; MERGE_HEAD es `0b60cb8`.
- Ejecutado exclusivamente en este worktree: `git merge --no-ff --no-commit backup/puntos-local-20261025`.
- 29 archivos sin resolver. No hay commit final de integración. Este informe queda como archivo nuevo sin commit en el worktree candidato.
- Los auto-merges no fueron aceptados como correctos por comportamiento. Clientes e instalaciones tienen partes combinadas automáticamente; contratos no presentó conflicto de texto. Eso no certifica su integración funcional.

## Decisión necesaria antes de continuar

`src/views/campo/CampoMiCustodiaView.vue` tiene dos implementaciones para la ruta del técnico `/campo/mi-custodia`:

- Remoto: pantalla de consulta de equipos/materiales con lectura personal protegida mediante `usePersonalRead`, sin formularios de solicitud de devolución en esa pantalla.
- Local: abre `CampoCustodiaView` por identidad; permite solicitar devolución de equipos/materiales y consultar solicitudes. Su recepción sigue siendo administrativa.

El menú del técnico dirige a esa ruta. No se debe escoger silenciosamente qué acciones estarán disponibles allí. Se solicita decidir si conservar la entrada operativa local con solicitudes de devolución o mantener la pantalla remota de consulta y definir el acceso a las solicitudes por separado. Una eventual combinación visual de ambas requiere también una decisión explícita y pruebas.

Otros conflictos ya observados, sin resolver: `CampoJobPoints` usa aporte acreditado en remoto y puntaje asignado en local; la continuación de puntos ya establece la distinción entre ambos. La firma nueva está en remoto y retirada en local por el requisito vigente. Altas tiene historial de materiales revertidos en remoto, que no debe perderse al incorporar guardas/puntos locales. Clientes incorpora la baja definitiva local; los cruces con las correcciones remotas requieren revisión. No se alcanzó una revisión funcional completa de los 29 conflictos.

## Inventario de conflictos

```text
ESTADO_DESARROLLO.md
docs/CLIENTES-PREPARACION-FINAL.md
docs/CLIENTES-VIGENTES-RETIRADOS.md
docs/ERRORES-CAMPO.md
package.json
scripts/tests/clientes-lifecycle-browser.mjs
server/src/index.ts
server/src/mikrotik/borderTraffic.ts
server/src/mikrotik/deviceRole.ts
server/src/routes/mikrotik.ts
server/src/services/__tests__/mikrotikBorderTraffic.test.ts
server/src/services/__tests__/mikrotikReconcileScope.test.ts
server/src/services/debtHoldService.ts
server/src/services/mikrotikBorderTrafficScheduler.ts
server/src/services/mikrotikBorderTrafficService.ts
server/src/services/mikrotikReconcileScheduler.ts
server/src/services/mikrotikReconcileService.ts
server/tests/materialRejectionDoesNotBlockClosure.sql.test.ts
src/components/campo/CampoJobPoints.vue
src/lib/__tests__/mikrotikBorderTraffic.test.ts
src/lib/mikrotikBorderTraffic.ts
src/lib/mikrotikDeviceRole.ts
src/stores/mikrotik.ts
src/views/campo/CampoMiCustodiaView.vue
src/views/campo/CampoTrabajoDetailView.vue
src/views/clientes/ClientServiceDetailView.vue
src/views/clientes/ClientesView.vue
src/views/instalaciones/InstalacionDetailView.vue
src/views/mikrotik/MikrotikDetailView.vue
```

No hay conflicto textual en los SQL de migración, pero el merge incorpora los archivos locales de MikroTik Fase 168/169 además de sus versiones renumeradas remotas Fase 171/172. Está pendiente reconciliar nombres/versiones y referencias antes de declarar un candidato válido; no borrar por apariencia ni ejecutar migraciones. Las tres candidatas de puntos se incorporaron al índice por merge, no se ejecutaron.

## Validaciones y pendientes

Aprobado en esta sesión: actualización de referencia remota, comprobación de divergencia, bundle completo válido y verificación SHA-256 de las 289 copias/originales. Main conserva HEAD, índice vacío y los mismos nueve archivos versionados modificados; los 280 originales no versionados no se alteraron.

No ejecutado en esta sesión: pruebas focalizadas del candidato, TypeScript y build. Hay marcadores de conflicto, incluido package.json, por lo que no corresponde certificarlo. Las 106 pruebas del commit local anterior siguen siendo evidencia de ese commit, no del merge pendiente.

Después de la decisión: resolver por contenido todos los conflictos, revisar auto-merges y migraciones, ejecutar pruebas aisladas de puntos/clientes/contratos/Campo y los cruces afectados, TypeScript frontend/backend y compilación; documentar resultados, verificar ambos padres como ancestros del commit final y comprobar de nuevo integridad del worktree original. No instalar migraciones ni usar datos reales durante las pruebas.

No se hicieron push, despliegue, conexión a producción, migración ni modificación de datos reales. No se ejecutaron reset, clean ni force push. El merge queda abierto exclusivamente en el worktree candidato, listo para continuar tras respuesta del usuario.
