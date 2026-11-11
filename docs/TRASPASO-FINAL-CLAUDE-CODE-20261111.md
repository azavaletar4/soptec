# Traspaso final a Claude Code — 11/11/2026

Leer primero el bloque ESTADO DE CONTINUIDAD de [ESTADO_DESARROLLO.md](../ESTADO_DESARROLLO.md). Este documento detalla ese bloque y no reemplaza su autoridad. Este cierre autoriza solo documentación; no nuevas funcionalidades, migraciones, despliegues, escrituras productivas ni push.

## Certificación

Candidato de aplicación/SQL: bcb3ec4c432c6baa39f175cca115795d5ae1cd45. Certificación registrada en 77d8ed2: **26/26 pruebas físicas PASS, 14 cierres sintéticos únicos y 12/12 regresiones de sonda Chrome PASS**, contabilizadas por separado. OPPO CPH2579, Android 15/API 35, WebView 156.0.8078.47; APK independiente com.smartrayco.iptvlab. Foto real de 1.276.704 bytes preservada tras force-stop; cola, reconexión USB, concurrencia y upgrade IndexedDB comprobados. Cola principal sin pendientes tras confirmación. La BD LAB de legado conserva un pendiente sintético y sus Blobs: no borrar para fabricar un cero. APK habitual y sus metadatos intactos; almacenamiento privado sin inspeccionar.

Informe: [certificación Android](ALTAS-IPTV-ANDROID-CERTIFICACION-20261111.md); [evidencia JSON](ALTAS-IPTV-ANDROID-EVIDENCIA-20261111.json). Resultado: apto para solicitar autorización de publicación controlada; no constituye autorización de publicar.

## Qué NO se probó contra PostgreSQL real

Las 26 pruebas físicas Android y las 12 regresiones Chrome usaron receptor HTTP sintético, sin conexión PostgreSQL. Los 14 cierres son ficticios. No se ejecutó la vista Campo completa → backend/PostgREST → PostgreSQL con autenticación real, subida de evidencias y cierre integrado. Tampoco se certificaron desde Android la custodia/inventario reales, permisos/RLS efectivos de producción, concurrencia entre celulares contra SQL ni rollback productivo.

Sí hubo **PostgreSQL real local** en las pruebas SQL previas: 22 PASS sobre PostgreSQL 17 temporal en Docker, sin red, con esquema/identidades/datos sintéticos (server/tests/installationIptvMode.sql.test.ts). Incluyeron modalidades, validaciones, custodia, carreras, rollback y reaplicación. No confundir datos sintéticos con motor simulado: esas pruebas SQL sí usaron el motor real, pero no el esquema completo desplegado ni sesiones/JWT productivos. Las consultas productivas previas fueron de solo lectura; no certifican la migración aplicada. No se repitieron pruebas ni consultas remotas durante este cierre documental.

Tampoco se probaron cambios reales de radios Wi-Fi/datos (se probó corte USB y offline CDP), otros modelos/versiones, perfil productivo/caché de técnicos ni piloto real. Cámara y galería no tienen certificaciones separadas.

## Archivos de migración y paquete

Procedimiento completo vigente: [bloqueos resueltos y secuencia](ALTAS-IPTV-BLOQUEOS-RESUELTOS-20261111.md), sección «Paquete y secuencia de futura publicación». El informe de ventana conserva antecedentes superados; usar la resolución vigente.

- Migración pendiente: supabase/migrations/20261111140000_installation_iptv_mode.sql.
- Rollback SQL: scripts/rollback-installation-iptv-mode.sql.
- Alcance/fuentes: deploy/iptv-20261111/scope.json y deploy/iptv-20261111/release-source.json. Mantener ambos argumentos explícitos en todas las fases; no usar defaults OLT.
- Paquete local ignorado: scripts/inventory-auth-lab/runtime/consolidation-release/frontend-consolidado-tr069-bcb3ec4-640f166b34/ (source.tar, input.json, SQL, rollback, package.json con SHA-256).
- Builds/logs: scripts/inventory-auth-lab/runtime/iptv-bcb3ec4c432c-1794410564161/.
- Evidencia física privada: scripts/inventory-auth-lab/runtime/android-iptv-1794411550984/phone/. Preservar fotos/datos fuera de Git.

## Secuencia futura y validaciones posteriores

Preparada, **no ejecutada y sujeta a autorización explícita de publicación y SQL**:

1. Revisar evidencia/alcance y mantener Campo detenido. Repetir scripts/iptv-maintenance-readonly.ps1 y preflight; detener ante actividad, operaciones incompletas o drift. La muestra 09:32:57 Lima es histórica. Una lectura del servidor no demuestra que los celulares estén vacíos.
2. Verificar hashes del paquete. Respaldar por canal privado esquema, funciones, ACL, instalaciones, inventario/custodia y metadatos históricos; registrar rutas y recuperación comprobable. No existe respaldo productivo nuevo ni stage remoto IPTV creado por este cierre.
3. Revisar los commits pendientes antes de cualquier push futuro: hay trabajos de otras tareas, por lo que no se debe publicar main indiscriminadamente. Ejecutar las fases prepare y build de scripts/frontend-consolidation-release.cjs con --scope deploy/iptv-20261111/scope.json --snapshot deploy/iptv-20261111/release-source.json. Prepare genera respaldos de imágenes y rollback; build exige contrato, grafo, configuración y reproducibilidad contra la imagen viva. Detener ante diferencias sin ampliar guardas.
4. Desplegar primero frontend compatible, con Campo cerrado: fases deploy y verify del mismo publicador y argumentos. Confirmar manifiesto/candidato bcb3ec4, assets, rutas, login, salud y almacenamiento móvil preservado. Backend Hono y otros servicios quedan fuera del paquete.
5. Repetir preflight inmediatamente antes del SQL. Por canal privado autorizado: psql -X -v ON_ERROR_STOP=1 -f supabase/migrations/20261111140000_installation_iptv_mode.sql. No usar supabase db push. Confirmar commit transaccional, registro de migración, columnas/default, triggers/ACL, RPC de cinco argumentos, wrapper anterior y recarga PostgREST. Comparar históricos/inventario con respaldo; no hay backfill.
6. Validar flujo integrado en entorno aislado real con datos sintéticos. Luego, solo con autorización, observar una futura Alta Dúo real del contrato correcto con modalidad, ONT/materiales/evidencias reales. Comprobar inventario antes/después, recibo y ausencia de duplicados. Rosita no es piloto ni se reabre.
7. Reabrir Campo por grupos tras confirmar recarga completa del JS correcto. Monitorear errores, colas y recibos. No borrar caché/datos, reinstalar ni descartar pendientes para actualizar.

## Respaldos y rollback

El empaquetado local y los respaldos de despliegues antiguos no sustituyen la copia previa a esta migración. Antes del SQL, mantener pausa y usar la fase rollback del mismo publicador/stage y argumentos; verificar imagen/configuración/salud originales. Conservar IndexedDB aditiva, sin downgrade ni borrado.

Si falla la migración, verificar aborto transaccional y esquema original; no ejecutar fragmentos. Después del SQL, detener envíos/sincronización, conservar colas/recibos y, con autorización, restaurar frontend del mismo stage y ejecutar el rollback SQL. Restaura funciones/RPC anteriores y retira activación nueva; conserva columnas, modalidades, recibos y guarda UPDATE. Verificar ACL y función original. No restaurar un dump encima de trabajo confirmado ni revertir históricos. Las Altas nuevas por app pueden quedar bloqueadas por la antigua exigencia de TV Box: preservar y recuperar mediante paquete coherente autorizado, sin inventar equipos.

No reutilizar staging si cambian herramientas/scope/snapshot: preparar intento nuevo.

## Preservación de históricos y cambios ajenos

Conservar Rosita, las 9 órdenes abiertas, 4 sesiones huérfanas y una aprobación histórica. Son conteos de la muestra anterior, no reverificados aquí. No cerrar, cancelar, aprobar ni regularizar para fabricar ceros. Preservar borradores, fotos, colas y trabajos de técnicos.

Los archivos ajenos listados abajo quedan intactos y fuera del commit. De ESTADO_DESARROLLO.md se incluye solo el ajuste IPTV y su enlace a este traspaso; las adiciones previas de Supabase/Samsung/TR-069 permanecen locales, excluidas del índice.

## Git exacto al iniciar el cierre

Captura local del 11/11/2026, previa al commit documental. Rama main; HEAD 77d8ed2d72be855a840effc7118c1d9f4ce7f1e7; origin/main local be3b44da762b359e283da2b7c5492166397138ea; tracking origin/main; 0 detrás y 10 delante. Sin fetch/ls-remote en este cierre: la referencia almacenada no garantiza la punta actual de GitHub. Índice inicialmente vacío. Dos archivos versionados modificados y 42 archivos sin seguimiento. Sin push por riesgo de incluir trabajos ajenos.

Commits pendientes respecto a origin/main local, del más antiguo al más nuevo:

```text
cd7242c1972eae378570016ea564fb7c38a6c9a3 docs(clientes): diagnosticar cancelación no instalada y proponer protección
6170a83bcdaa51c819547fcd7cc390d58b759904 docs(altas): diseñar modalidad IPTV sin TV Box obligatorio
8086fba460b587a0560bad5c360c59c48e29eb03 fix(altas): permitir IPTV sin TV Box en instalaciones futuras
127fa3777b368526e9ee7196bba04d6c3e36e314 docs(altas): revisar publicación IPTV y documentar bloqueos de continuidad
8688bfc83d1c5fa6662283e73213d42aef6c023b docs(altas): preparar ventana IPTV y verificar Campo en solo lectura
36cc6b939830d09053fc3a1955c7946920c59718 fix(campo): preservar borradores y cierres IPTV entre versiones
bcb3ec4c432c6baa39f175cca115795d5ae1cd45 fix(release): preparar paquete local compatible con tar de Windows
8b6f1af4ac63f1c7359db20115d3177e374ea38e docs(altas): registrar paquete IPTV verificado y puerta Android pendiente
1f9474e742fa740a168c37b9fd6eb758a1adf79e test(android): preparar laboratorio IPTV aislado y registrar pendientes fisicos
77d8ed2d72be855a840effc7118c1d9f4ce7f1e7 test(android): certificar persistencia IPTV en OPPO y documentar alcance
```

Estado literal previo a este cierre:

```text
 M ESTADO_DESARROLLO.md
 M docs/INVENTARIO-PRODUCCION-IMAGENES.json
?? docs/ASISTENCIA-SEMIAUTOMATICA-FASE-A-PROPUESTA.md
?? docs/FASE175-CORRECCION-CONTADORES-HTTP400-20261026.md
?? docs/FASE175-INTENTO-Y-ROLLBACK-20261026.md
?? docs/FASE175-PREFLIGHT-SELECTIVO-20261026.md
?? docs/FASE175-REINTENTO-CONTROLADO-20261026.md
?? docs/OFICINA-XUI-AUDIT-20261030.json
?? docs/OFICINA-XUI-AUDIT-20261030.md
?? docs/PUNTOS-ACTIVACION-CONTROLADA-PREFLIGHT-20261025.md
?? docs/PUNTOS-ACTIVACION-DETENIDA-20261025.md
?? docs/PUNTOS-ACTIVACION-PRODUCCION-20261025.md
?? docs/PUNTOS-ALCANCE-ARTEFACTO-RESPALDO-20261025.md
?? docs/PUNTOS-CIERRE-UNICO-DESPLEGADO-20261026.md
?? docs/PUNTOS-CORRECCION-ACTIVADA-20261026.md
?? docs/PUNTOS-PREFLIGHT-FINAL-210000-20261025.md
?? docs/PUNTOS-RETOMA-VALIDACION-20261025.md
?? docs/PUNTOS-VENTANA-SIMPLIFICADA-VERIFICADA-20261025.md
?? docs/SAMSUNG-HOST-DIAGNOSTICO-20261030.json
?? docs/SAMSUNG-HOST-DIAGNOSTICO-20261030.md
?? docs/SUPABASE-CONSUMO-DIAGNOSTICO-20261110.md
?? docs/SUPABASE-CONSUMPTION-ESTIMATES-20261110.json
?? docs/SUPABASE-CONSUMPTION-TABLES-20261110.md
?? docs/SUPABASE-CONSUMPTION-catalog-20261110.json
?? docs/SUPABASE-CONSUMPTION-catalog-20261110.jsonl
?? docs/SUPABASE-CONSUMPTION-detail-20261110.json
?? docs/SUPABASE-CONSUMPTION-detail-20261110.jsonl
?? docs/SUPABASE-CONSUMPTION-metrics-20261110.json
?? docs/SUPABASE-CONSUMPTION-metrics-20261110.jsonl
?? docs/TR069-RELEASE-BUILD-DIAGNOSTIC-20261030.json
?? docs/TR069-RELEASE-PREFLIGHT-20261030.json
?? docs/TR069-RELEASE-PREPARADO-20261030.md
?? docs/XUI-HUAWEI-AUDITORIA-CONEXION-20261106.md
?? docs/XUI-RAYCOTV-INTEGRACION-20261106.md
?? scripts/diagnostics/supabase-consumption-catalog.sql
?? scripts/diagnostics/supabase-consumption-detail.sql
?? scripts/diagnostics/supabase-consumption-metrics.sql
?? scripts/diagnostics/supabase-consumption-report.cjs
?? scripts/oficina-xui-audit.cjs
?? scripts/samsung-host-readonly.cjs
?? scripts/supabase-consumption-readonly.ps1
?? scripts/tr069-release-build-diagnostic.cjs
?? scripts/tr069-release-preflight.cjs
?? server/src/services/__tests__/trafficAnalyticsCounterStates.test.ts
```

El commit que introduce este documento es el cierre documental: identificarlo con git log -1 --format=fuller -- docs/TRASPASO-FINAL-CLAUDE-CODE-20261111.md. Incluye únicamente este documento y el ajuste IPTV de ESTADO_DESARROLLO.md. Tras guardarlo, main quedará 11 commits delante de origin/main local si nada más cambia; los dos archivos versionados ajenos seguirán modificados y los 42 sin seguimiento continuarán fuera del índice. No se incrusta el hash de un commit en su propio contenido. Al retomar, comprobar git status --short --branch y git diff --cached --stat.
