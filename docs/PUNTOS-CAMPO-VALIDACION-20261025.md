# Validación focalizada de puntos y App de Campo — 25/10/2026

Base: main `debeff885ba298b80e94df2dc9a8cb84586e9eb1`, limpia al iniciar. Se reutilizaron los informes de puntos, cierre definitivo, permisos/Android e integración. Sin integración Git nueva, auditoría general ni consulta a producción. No se restauraron herramientas/prototipos de cuarentena.

## Resultado y corrección terminada

Se confirmó un defecto en `CampoJobContribution.vue`: el aporte acreditado se cargaba solo al montar o al pulsar Actualizar. El puntaje asignado sí tenía actualización periódica. Confirmar sin cambiar el puntaje no necesita UPDATE de la orden; por tanto, una pantalla abierta podía seguir sin mostrar la acreditación hasta recarga manual.

Corrección limitada a ese componente: suscripción a cambios de orden/cuadrilla, consulta personal cada 15 segundos con pantalla visible y actualización al recuperar foco/conexión/visibilidad. Al cambiar usuario/orden o desmontar se liberan canal/timer; `usePersonalRead` sigue descartando respuestas tardías y limpiando datos ante error. Se conserva la separación «puntaje asignado» / «aporte acreditado».

No se abre lectura de la tabla administrativa de confirmaciones a técnicos, no se amplía publicación realtime, ni se modifica RPC, fórmula, reparto, fecha de corte o estado técnico. La consulta periódica cubre la confirmación sin UPDATE: **no se promete notificación instantánea de esa confirmación** ni entrega realtime productiva comprobada.

Corrección y harnesses registrados en el commit local `591df76` (`fix(campo): refrescar aportes acreditados y validar reintentos offline`). El ensayo nuevo de recuperación y este informe se registran en otro commit local de validación; ninguno se publica en esta sesión.

## Evidencia reutilizada

Las 139 pruebas focalizadas y 14 comprobaciones de navegador de la sincronización anterior certifican `debeff8`. No se repitió esa batería completa: los SQL candidatos, permisos, stores de órdenes/inventario y reglas de trabajo activo no se cambiaron. Se conservaron sus resultados de obligatoriedad, ADMIN/SUPERADMIN activo, técnico/ayudante sin escritura, confirmación única/concurrente, congelamiento de importes/cuadrilla, devoluciones administrativas y corte de noviembre en Lima.

El estado de producción de las migraciones/hash/ACL sigue siendo el observado en la revisión READ ONLY anterior, no una nueva certificación de catálogo en esta sesión.

## Pruebas ejecutadas en esta sesión

| Prueba | Resultado | Alcance y límite |
| --- | --- | --- |
| `node scripts/tests/campo-integration-browser.mjs` | 21 comprobaciones PASS | Vue/stores reales, RPC ficticias, solicitudes pendientes y custodia sin descuento prematuro; visualización separada de asignación y crédito; confirmación tardía por polling; ajuste administrativo simulado; foco/reconexión; error sin valor anterior; cambio de identidad y respuesta tardía. |
| `node scripts/tests/field-order-points-browser.mjs --offline-only` | 16 comprobaciones PASS | IndexedDB y store reales; Avería/Alta/Rutina quedan en cola sin escrituras; persistencia tras recargar la página; GPS numérico conservado; firma histórica preservada; reintento tras éxito no duplica; Blob de foto y error permanecen si el trabajo quedó definitivo antes de sincronizar; rechazo previo a escritura. |
| `node scripts/tests/field-order-points-browser.mjs` | 50 comprobaciones PASS | Regresión del harness modificado: líder/ayudante, tres tipos, lectura propia/error/revocación simulados, actualización, cierre sin firma nueva, preservación de firma histórica y aborto si falla su lectura; stores rechazan reapertura/eliminación/cierre de una orden definitiva antes de PATCH/DELETE. |
| `node --import tsx --test server/tests/workOrderPointRecovery.sql.test.ts` | 5 pruebas PASS (padre + 4 casos) | PostgreSQL efímero 17, sin red ni datos reales; descrito abajo. |
| `vue-tsc -b --pretty false` | PASS | Tipos frontend. |
| `tsc -p tsconfig.server.json --pretty false` | PASS | Tipos backend/pruebas. |
| `vite build --outDir scripts/inventory-auth-lab/runtime/points-functional-build-20261025` | PASS | URL/clave ficticias, salida de laboratorio ignorada; no desplegar. Solo aviso existente de chunks grandes. |

Total de esta sesión: **87 comprobaciones de navegador y 5 pruebas PostgreSQL**, más tipos y build. Los números de suites anteriores no se suman otra vez.

Los navegadores bloquearon tráfico externo. Se reutilizó el perfil sintético de pruebas, sin sesiones ni colas de usuarios reales. La cola ensayada usa `flushQueue` real y envía por `submitClosure` real con API ficticia; no es el recorrido completo del formulario móvil, `syncQueued` con todas sus consultas posteriores, Storage real ni compresión/captura de cámara. La fotografía de cola es un Blob sintético que no se sube en el intento rechazado. El GPS se verificó como datos conservados/enviados, no como lectura física de sensor.

## Migraciones: orden, dependencias y recuperación

Sin modificaciones en las tres candidatas:

1. `20261024180000_work_order_points.sql`: columna de Altas, obligatoriedad, ajuste auditado y revocación de service_role.
2. `20261024190000_field_order_points_readonly.sql`: consulta personal de asignación para líder/ayudantes, sin acreditación.
3. `20261024200000_work_order_point_confirmations.sql`: confirmación definitiva, instantáneas, guardas de orden/cuadrilla y fuente oficial.

La tercera depende de las dos anteriores y de las funciones instaladas de Mi Avance/ranking. El ensayo carga las definiciones basales ya conservadas y el modelo de ACL predeterminadas de Supabase, sin descargar esquema o datos productivos.

El test de recuperación comprueba:

- Una deriva sintética del cuerpo de la fuente compartida hace abortar 200000. No queda tabla/RPC parcial; 180000 y 190000 ya comprometidas siguen presentes. La guarda de hash real no se modifica ni se evade.
- Después de instalar las tres sin uso administrativo, se restaura el respaldo anterior en otra base vacía del mismo contenedor. Catálogo comparable íntegro: definiciones de funciones, ACL, columnas/defaults, restricciones, políticas RLS y triggers; datos previos y puntaje conservados.
- Se ajusta/confirma una orden ficticia por RPC ADMIN; el reintento conserva el ID y exactamente una auditoría/confirmación.
- El dump posterior se restaura en otra base vacía, preservando exactamente confirmación, auditoría y catálogo. Reintentar no duplica y la guarda definitiva sigue rechazando reapertura.

**Este ensayo es recuperación de BD en destinos aislados, no un down-migration productivo listo para ejecutar.** No se restaura una base antigua sobre información actual ni se borran confirmaciones reales. Después de uso, volver al cálculo previo podría desacreditar o reabrir indebidamente trabajos. Un rollback productivo debe elegir un respaldo recuperable, conservar registros posteriores, verificar Storage/configuración y coordinar el artefacto de aplicación y su conexión. La copia sintética no certifica Vault, Auth/Storage completos ni restauración de todo Supabase.

## Estado exacto de Android

- Flutter está instalado y el SDK configurado es `D:\Android`.
- ADB disponible en `D:\Android\platform-tools\adb.exe`; consulta autorizada `devices -l` exitosa: **cero dispositivos**. No se imprimieron identificadores ni se instaló/inició ninguna aplicación.
- Existe `mobile_app/build/app/outputs/flutter-apk/app-release.apk`, 46.166.196 bytes, fechado 10/10/2026. No está certificado como APK de laboratorio de esta entrega.
- `mobile_app/lib/main.dart` fija URL/host del panel productivo. No se usó esa APK para simular cierres o escrituras. Una APK de pruebas debe cargar frontend/API/Supabase/Storage aislados y disponer de datos/almacenamiento separados.

Pendientes físicos de la matriz Android existente: abrir las tres órdenes como líder/ayudante; cámara/galería y cancelación/denegación de permisos; GPS permitido/denegado/sin señal; hoja física y fotos requeridas sin firma digital nueva; firmas históricas/cola antigua con Blob; Atrás, teclado, rotación, segundo plano y muerte del proceso; conectividad interrumpida durante subidas y cierre; arranque frío offline. Persistencia de IndexedDB tras una recarga de Chrome no certifica que Flutter pueda cargar la SPA al arrancar sin red.

## Qué falta de Supabase y API real aislados

Los roles/RPC/RLS se acreditan por los ensayos PostgreSQL anteriores y el catálogo/recuperación nuevo; el navegador usa API ficticia. **No se declara aprobado el recorrido JWT real → PostgREST/API → RLS/RPC/Storage/realtime.** Faltan sesiones Auth reales de ADMIN/SUPERADMIN/líder/ayudante/ajeno/inactivo en un entorno aislado representativo, entrega realtime efectiva y sus fallos/reconexiones, conflictos de confirmación concurrente desde clientes reales y cierre completo con evidencias. No se instaló una nueva plataforma de laboratorio ni se reactivaron herramientas apartadas para aparentar esa cobertura.

## Dictamen para autorización

Las tres candidatas conservan su orden, pasan instalación/recuperación sintética y no mostraron un bloqueo SQL nuevo. La corrección de interfaz y sus pruebas quedan en commits locales específicos, sin push.

**No recomiendo todavía autorización incondicional de migración/despliegue productivos.** Antes: completar sesiones Supabase y Android aislados, fijar respaldos/rollback BD+aplicación con artefactos exactos, repetir el preflight READ ONLY autorizado de hash/ACL/historial y coordinar clientes antiguos. En particular, crear desde formularios antiguos sin puntos fallará tras 180000 y desde noviembre no se acredita oficialmente sin confirmación. Mantener el corte 01/11/2026 00:00 America/Lima (05:00 UTC); octubre no se arrastra al oficial.

No se tocaron órdenes, contratos, inventario o puntos reales; no se modificó backend operativo, Android, OLT/MikroTik ni el flujo de trabajo activo. Sin migraciones productivas, despliegue o push. La fase termina aquí para revisión, sin iniciar activación.
