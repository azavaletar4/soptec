# Revisión final IPTV: NO APTO para publicar sin interrumpir Campo

**Fuente revisada: `8086fba460b587a0560bad5c360c59c48e29eb03`.** Solo
diagnóstico, pruebas locales y documentación. Sin cambios de aplicación,
SQL candidato, Flutter o rollback; sin consultas/escrituras productivas,
push, migración o despliegue. Esta revisión condiciona el procedimiento
del informe de implementación: no ejecutarlo mientras existan bloqueos.

## Veredicto y bloqueos

La regla nueva funciona con cliente actualizado: Smart TV/dispositivo propio
cierran con ONT y sin descontar TV Box; Rayco exige identidad y custodia.
**Eso no basta para publicar sin interrupciones.** Los PASS de diagnóstico
que reproducen defectos no equivalen a aprobación para producción.

| Bloqueo | Evidencia y efecto | Trabajo pendiente, fuera de esta revisión |
|---|---|---|
| Sesiones antiguas | INSERT marca inmediatamente versión 1. El JS anterior solo envía `status='completed'`: PostgreSQL lo rechaza por modalidad ausente incluso con TV Box válido. Ese JS puede escribir código de cliente y evidencia antes del rechazo final. | Compatibilidad/activación gradual y detección de versión frontend; comprobar sesiones realmente actualizadas antes de exigir modalidad. No inferir Rayco ni generar movimientos para hacerlas pasar. |
| Borrador solo con modalidad | `draftHasContent` no incluye `iptvInstallationMode`. Si aún no hay NAP, notas, fotos u otro dato considerado contenido, `persistDraft` llama a `clearDraft`. Se pierde la selección al salir/recargar. | Contabilizar la modalidad y probar guardado/restauración real, también ante cierre del proceso Android. |
| Esquema IndexedDB previo | `formDrafts.ts:12` y `offlineQueue.ts:62` usan la misma BD `smartrayco-campo` con stores distintos. `idb-keyval` crea el store solo en `onupgradeneeded`, sin incrementar versión al abrir el segundo. Perfil nuevo: drafts primero → cola `NotFoundError`; closures primero → borrador `NotFoundError`. | Upgrade local no destructivo que conserve ambas colecciones y Blobs. No borrar caché, datos de aplicación, BD, cierres o borradores del técnico. Este defecto ya existe en el padre de `8086fba`; no lo introdujo IPTV. |
| Cola bloqueada por cierre incompatible | `flushQueue` detiene todo al primer error. Una orden nueva versión 1 encolada por JS antiguo sin modalidad bloquea las siguientes, incluidas otras clases de trabajo. En una BD coherente, el almacenamiento persiste, pero no se resuelve esa incompatibilidad al recargar. | Recuperación explícita de la orden pendiente sin perder fotos ni duplicar cierre; elección humana de modalidad, estrategia de continuidad de cola y pruebas. No todos los cierres antiguos fallan: órdenes creadas antes del SQL conservan NULL y la regla anterior. |
| Paquete y dispositivos | El manifiesto de alcance sigue en `40e43c1`, con fuentes OLT. Los 14/22 controles Chrome no son una prueba del APK/System WebView instalado en los celulares. | Preparar alcance exclusivo y artefactos reproducibles; comprobar APK/WebView soportados y sesiones/borradores reales de prueba aislada. |

## Flutter, WebView, sesiones y versiones

`mobile_app/lib/main.dart` carga el panel remoto en WebView, habilita JS,
conserva última URL y agrega el token constante `SmartRaycoApp/1.0` al UA.
El formulario es Vue, no una pantalla Dart; no se identificó una API nativa
nueva necesaria para presentar el selector. El UA **no identifica el commit
del JS cargado**. Una sesión abierta no reemplaza sus módulos por publicar
HTML nuevo; navegar dentro de la SPA tampoco demuestra actualización.

La recarga es explícita (`_controller.reload()` y cabeceras Vue con
confirmación). No se encontró un protocolo de versión/activación que drene
clientes antiguos, confirme migración de borradores y luego habilite SQL.
`CampoLayout` intenta sincronizar pendientes al recuperar conexión: no se
debe activar la exigencia mientras esos clientes puedan seguir trabajando
con código anterior. Cerrar sesión o limpiar almacenamiento no es una
solución de actualización segura.

Con esquema IndexedDB coherente de fixture, la recarga conserva notas,
código, foto/Blob, cierre antiguo sin modalidad y cierre nuevo con modalidad.
También conserva el error que bloquea la cola. El inicializador real no
garantiza ese esquema: se reprodujo la ausencia del segundo store en ambos
órdenes de creación **antes** de preparar el fixture coherente.
No se ejecutó APK en Android ni se verificaron versiones instaladas de
System WebView. Esa certificación sigue pendiente; no se requiere alterar
Flutter para efectuar esta revisión.

## SQL, históricos e inventario

La migración mantiene transacción única y `lock_timeout=5s`, verifica el
cuerpo de cierre y su trigger, agrega columnas nullable sin DEFAULT inicial
y fija después el DEFAULT. No contiene backfill ni DML sobre filas previas.
Impide cambiar versión y modalidad históricas/cerradas; conserva la regla
previa para filas NULL y las validaciones de ONT/Zona/NAP. La RPC de
preflight delega permisos en el lector contextual y comparte validador con
el trigger. Los procedimientos de inventario no se reemplazan.

Snapshots sintéticos antes/después incluyen órdenes previas abiertas,
completadas y canceladas, TV Box/ONT asignados, **productos/stock**, unidades,
eventos, movimientos y custodia. Permanecen iguales al migrar, cerrar por
app/dispositivo propio, revertir y reaplicar. Rayco con falta de serie/MAC,
custodia, estado o identidad correcta se rechaza sin cambios de inventario.
Seleccionar una modalidad no llama a asignación ni inventa un equipo.
Una asignación manual previa de TV Box se rechaza como contradicción al
intentar cerrar con modalidad sin entrega; no se devuelve automáticamente.

Rosita Ferrel Rivera no fue consultada, reabierta, modificada ni utilizada
como fixture. La revisión no cambió producción. La protección histórica se
verificó con código y snapshots sintéticos; no se hizo una nueva auditoría
de su contenido actual ni de operaciones ajenas.

El diff de `8086fba` frente a su padre contiene los 22 archivos documentados
de IPTV (8 de frontend, 2 SQL, 5 de pruebas, 3 de lectura/evidencia y 4 de
documentación). No incluye Flutter, Hono, manifiesto OLT, facturación ni los
pendientes Fase 175/Asistencia/analítica. Es distinto del historial completo
de sus ancestros: preparar el alcance exacto antes de publicar.

## Pruebas de esta revisión

| Comando | Resultado | Interpretación |
|---|---|---|
| `node --import tsx --test server/tests/installationIptvMode.sql.test.ts` | 21/21 PASS, PostgreSQL 17 efímero sin red | Tres modalidades, cero consumo TV Box sin entrega, stock/custodia, históricos, permisos, concurrencia, cliente viejo rechazado y limitación del rollback. |
| `node --import tsx --test server/tests/installationIptvPublication.diagnostic.test.mjs src/lib/__tests__/installationIptv.test.ts server/tests/installationIptv.ui.test.mjs` | 25/25 PASS | Cuatro caracterizaciones incluyen defectos vigentes: borrador eliminado, cola detenida y evidencia antes del rechazo en JS anterior. |
| `node scripts/tests/iptv-mode-browser.mjs` | 22/22 PASS, Chrome oculto | Componente/store compilados, transporte sintético, IndexedDB real, ambos fallos de esquema, recarga con Blobs y bloqueo de cola. Proxy remoto cerrado y HTTPS bloqueado. |

**68 comprobaciones PASS; NO APTO.** No sumar a las 97 anteriores: hay
pruebas repetidas/ampliadas. No se repitió build ni tipos: las fuentes de
aplicación no cambiaron desde su PASS en `8086fba`. El navegador compila
únicamente su harness de prueba. Evidencia estructurada:
`ALTAS-IPTV-REVISION-PUBLICACION-20261111.json`.

## Secuencia de publicación: preparada, actualmente detenida

**Punto 0 obligatorio:** resolver y volver a probar los bloqueos con nueva
autorización de implementación. No cambiar SQL/código durante esta revisión.
Una opción de diseño es separar expansión compatible de activación y añadir
verificación de capacidades del cliente; el SQL actual activa de inmediato.
La secuencia siguiente requiere un candidato corregido y autorizado.

1. Preparar checkout/commit exacto y alcance exclusivo; revisar commits por
   publicar, manifiesto de fuentes, imágenes reales y respaldo de funciones.
   Revalidar metadatos con `scripts/iptv-installation-readonly.ps1`; no quitar
   guardas si aparece drift. Nada de SQL contra Rosita o históricos.
2. Regenerar `release-source.json` con
   `node scripts/frontend-release-build.mjs --export-snapshot` desde fuentes
   limpias. Ajustar **el contrato existente** de release al mismo commit,
   `backendSources: []` y grafo/assets frontend exactos. El backend HTTP/Hono
   no tiene cambios y no se debe reconstruir ni reiniciar por esta tarea.
3. Ejecutar separadamente `node scripts/frontend-consolidation-release.cjs prepare`
   y `node scripts/frontend-consolidation-release.cjs build`. Exigir respaldo,
   rollback, doble build reproducible y exclusión de fases ajenas. Los
   paquetes/manifiestos correspondientes siguen pendientes, no están aprobados.
4. Tras autorización de push/deploy, publicar solo commits autorizados y el
   **frontend compatible primero** con `... deploy`, seguido de `... verify`.
   Verificar manifest, HTML, assets y versión realmente cargada en cada
   navegador/WebView de prueba; preservar autenticación, notas y fotos.
5. **Barrera de activación:** comprobar sesiones abiertas, versiones viejas,
   borradores y colas de todos los técnicos afectados. Un servidor que sirve
   JS nuevo no prueba que todos lo ejecuten. Si queda un cliente incompatible,
   cola sin resolver o persistencia incierta, **detener aquí**, mantener SQL
   anterior y permitir continuar por la regla anterior. No forzar recargas
   con datos inciertos. Una ventana manual que pause técnicos no cumple el
   objetivo de cero interrupciones y requiere aceptación explícita aparte.
6. Solo después de superar la barrera y obtener autorización SQL, aplicar el
   archivo **exacto** revisado por el canal privado (`psql -X -v ON_ERROR_STOP=1 -f <archivo>`).
   No ejecutar `supabase db push` con fases ajenas. Verificar transacción,
   esquema/DEFAULT, triggers, hash/ACL, recarga PostgREST y registro de versión;
   ninguna escritura de prueba sobre clientes reales. Si se opta por separar
   expansión/activación, el nuevo paquete SQL debe revisarse y probarse antes.
7. Comprobar tres modalidades con fixtures de staging y luego observar el
   primer uso autorizado normal en una **nueva** Alta. Monitorear errores de
   cierre, colas, reintentos, stocks y custodia. Registrar evidencia por
   frontend, SQL y backend HTTP intacto. No declarar éxito por un deploy PASS.

## Reversión ante fallos

- Antes de aplicar SQL: revertir solo frontend con el rollback del stage
  exacto, si es necesario. Base de datos conserva la regla anterior.
- Si falla la transacción SQL/guarda/timeout: detener; la transacción aborta
  sin habilitación parcial. Comprobar funciones, DEFAULT y registro antes de
  cualquier reintento. No forzar locks ni continuar con SQL parcial.
- Después de activar SQL: coordinar y detener nuevos envíos/sincronización
  antes de revertir; preservar cierres confirmados y exportar/verificar
  pendientes locales sin borrarlos. Restaurar frontend anterior mediante el
  stage de esta release y ejecutar `scripts/rollback-installation-iptv-mode.sql`
  por canal privado, solo con autorización. Verificar hash original, retirada
  de preflight/validador/DEFAULT/trigger INSERT; conservar columnas y guarda
  UPDATE, modalidades y movimientos ya registrados.
- **Limitación comprobada:** un Dúo nuevo por app sin TV Box vuelve a bloquear
  con el trigger anterior; el cliente nuevo tampoco tiene su RPC tras el
  rollback. Una reversión íntegra conserva datos, pero no garantiza que esos
  trabajos continúen. No bajar versiones por fila, fabricar TV Box, borrar
  colas o tocar históricos para sortearlo. La recuperación/reaplicación de
  funciones fue probada localmente; un plan de continuidad para esos pendientes
  sigue siendo condición previa de publicación.
