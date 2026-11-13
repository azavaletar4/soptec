# Soporte y Prospectos — publicación controlada

**PUBLICADO. Verificaciones técnicas correctas. Cero descartes reales; registros existentes intactos.**

Frontend iniciado el **13/11/2026 a las 00:43:03 Perú**. Lectura final de datos: **00:51:02 Perú**. Solo se aplicó la migración puntual autorizada y se recreó frontend; backend, Caddy, Mongo y GenieACS conservaron imagen, contenedor, arranque, configuración y entorno.

## Identidad aprobada y desplegada

- Implementación: `61e0e31`.
- Fuentes publicadas: `9e1e7c1c4e71c354c4c8878cdfc97cd6bf748c09`, rama `release/dashboard-support-prospects-20261113`.
- Preparación: `f619d65`.
- Paquete utilizado sin regenerar: `deploy/dashboard-support-prospects-20261113/`.
- SHA-256 del manifiesto: `2e085a576d5c7a4914bd6584d328b65da51ea4bb93497aedbdd41edf2f552410`.
- Fuente TAR: `45833940c83707a37937318b1e472beef0104429db8896f963c4c9f1f815a8fb`.
- Sitio TAR: `2e83036cbf31e6aa41e1fb668aa315ea9d359b82b37ff681f0e7c0063e55d1bd`.

| Servicio | Imagen |
|---|---|
| Frontend anterior / rollback | `sha256:3fc2672ff84c7c77097aa45f4d2da242794fd1ef0320a799680166f5e4e1d7e1` |
| Frontend publicado | `sha256:191462d2258a80a3380e919e239d410d322c41fcf3df43f73f2c6a1543f20b58` |
| Backend conservado | `sha256:165126136e3178840e6443094b42993a73a43b79a4b3aa6149f17a3730e2fe16` |

Contenedor frontend: `4adbce26d9ac539991cbd22bbccc9cbf179c022ef75a9e0cbdfcd92f757fc575`.

## Respaldo PostgreSQL real antes de aplicar SQL

Se generó un **pg_dump completo custom de 21 372 811 bytes**, con snapshot REPEATABLE READ READ ONLY exportado y compartido por pg_dump. Origen TLS verify-full, credencial DPAPI por stdin, sin escrituras en Supabase. Snapshot: 13/11/2026 **00:32:55 Perú**.

Archivo privado:

`C:/Users/USER/AppData/Local/SmartRaycoBackups/dashboard_support_pre_sql_20261113_053254_3b8032fa/completo.dump`

SHA-256: **`c6b5675d9c37db65145d2a1c1cfbf353bcb777b407115d71bb9ed0f1fdc1410a`**.

ACL restringida al usuario actual y SYSTEM. Fuera de Git y del sitio web. pg_dump, inventario pg_restore, lectura completa del archivo y restauración completa con --exit-on-error --single-transaction: exit 0. Restauración exclusivamente en contenedores efímeros **sin red**, con el backup montado de solo lectura.

Se compararon todos los campos COPY originales y restaurados: **747 clientes, 768 contratos y 94 instalaciones; cero diferencias**. La huella del archivo no cambió. `postgres-backup-verification.json` conserva el resultado y las limitaciones: el dump de base de datos no incluye objetos de Storage, atributos globales de roles o claves externas de Vault. No se verificó descifrado de secretos externos; se reconstruyeron nombres de roles NOLOGIN solo en el laboratorio.

**Incidencia resuelta antes de aplicar:** la primera comparación textual JSON marcó distintos hashes de clientes/contratos. Se detuvo el procedimiento, sin cambios que revertir. Se comprobó localmente que extra_float_digits=0 reproduce exactamente ambos hashes originales y que COPY conserva todos los campos idénticos, sin siquiera diferencias de formato numérico. El origen confirmó posteriormente extra_float_digits=0. No se reemplazaron hashes esperados, no se toleraron diferencias de valores y no se alteró configuración productiva. La verificación adicional resolvió la discrepancia antes de continuar.

## Migración aplicada y preservación de datos

Se ejecutó exclusivamente el **apply.sql sellado**, SHA-256 `6d7c4ab83bb84741fdce274d8001a6f7e233ffba996c4d550f87e3ab9f5b8e1b`, mediante database.ps1 con el hash externo y autorización explícita. Preflight del esquema real y verify posterior: PASS.

Cambios: tres columnas nullable de trazabilidad en clients, FK/restricción, RPC `discard_unfulfilled_client_prospect(uuid,timestamptz,text,boolean)` y dos funciones internas con tres triggers. Se reutiliza retired y se notifica recarga de esquema PostgREST. Sin tablas nuevas, backfill, cron jobs, históricos o migraciones generales. No se tocaron funciones anteriores ni se actualizaron contratos/órdenes.

Los hashes de **todos los atributos anteriores de clients, service_contracts e installations** coinciden antes de SQL, después de SQL y al terminar. Cero filas con prospect_discarded_at. RLS, ACL, propietarios, definiciones de triggers y dependencias anteriores conservados. Los cuerpos de las tres funciones nuevas coinciden por hash con la migración original aprobada.

## Contadores y permisos reales

| Indicador | Resultado |
|---|---|
| Trabajos pendientes | **12** |
| Desglose | **1 avería open + 10 rutinas scheduled + 1 Alta scheduled** |
| En progreso / urgentes | **0 / 0** |
| Órdenes únicas / filas leídas | **12 / 12** |
| Prospectos vigentes | **1: Manuel Romero Collantes**, con Alta abierta |
| Contrataciones canceladas con estado prospect | **3 excluidas, sin modificación** |
| Descartes reales durante la publicación | **0** |

Las lecturas SQL bajo RLS authenticated para perfiles activos ADMIN y SUPERADMIN devuelven ambos 12 trabajos / 1 ficha pendiente. Se usaron únicamente SET LOCAL y ROLLBACK, sin crear usuarios ni modificar perfiles. No existen perfiles activos SOPORTE/FACTURACION; no se inventaron cuentas para probarlos. Sus reglas, las del técnico y los casos de descarte ya se probaron en la preparación del mismo candidato.

La función nueva permite EXECUTE a authenticated y valida dentro del servidor perfil activo ADMIN/SUPERADMIN, motivo, confirmación, versión, ausencia de servicios vigentes o Altas abiertas/completadas. Guarda autor/fecha/motivo y conserva historia. Los cuerpos desplegados coinciden con los que aprobaron las pruebas locales. anon y service_role no tienen EXECUTE; las guardas internas tampoco lo conceden a authenticated.

La RPC HTTPS real rechazó una petición negativa anónima con **401 / SQLSTATE 42501**, antes de ejecutarse, usando confirm=false y **sin ID de cliente**. No se invocó ningún descarte sobre una persona real. Manuel no es elegible mientras su Alta siga abierta.

## Publicación y verificaciones

Se transfirieron solo los 30 archivos documentados al staging nuevo:

`/opt/smartrayco-staging/dashboard-support-9e1e7c1c4e71-45833940c8`

publish.py preflight: PASS; apply autorizado y verify independiente: PASS. Se cargó la imagen congelada y se ejecutó únicamente `docker compose ... up -d --no-deps --no-build --pull never frontend`. Sin rebuild, pull o despliegue backend. El campo sqlExecuted=false del resultado del publicador describe ese componente; la migración se ejecutó separadamente como consta en migration-result.json.

- Salud API: ok. Árbol de frontend/Nginx, commit público, configuración y hashes HTTP de todos los assets activos: PASS. Paquete local reconfirmado sin regenerar: PASS.
- Cero errores críticos Nginx; cero excepciones JavaScript en navegador HTTPS real.
- Dashboard, Soporte, rutinas, Altas, Clientes/Pendientes, CRM, facturación, inventario y Campo redirigen correctamente a login sin sesión. Los tres endpoints protegidos de Dashboard devuelven 401.
- No se emitieron escrituras de negocio desde el navegador. No hubo comandos MikroTik/OLT, consultas nuevas a equipos, cambios PPPoE, tablas de tráfico, facturación, inventario o Campo. Backend y sus schedulers no se reiniciaron ni modificaron.
- El frontend publicado es exactamente el candidato que pasó las pruebas de escritorio/móvil, contadores, formulario, actualización, errores, permisos y regresión antes de publicarse. No se incluyen fixtures en los bundles.

**Límite de verificación:** no había una sesión administrativa interactiva disponible; no se inició una ni se extrajeron credenciales/cookies. La comprobación visual con usuario autenticado en producción no se ejecutó. Se verificaron en producción datos reales bajo RLS, funciones/permisos, guardas HTTPS y assets exactos; el render autenticado del mismo candidato se probó localmente antes de publicar. No se simularon usuarios o datos en el navegador productivo ni se eludieron controles.

## Rollback disponible y riesgos

Imagen/tag de rollback verificados: `smartrayco-dashboard-support-rollback:3fc2672ff84c`, identidad `sha256:3fc2672ff84c7c77097aa45f4d2da242794fd1ef0320a799680166f5e4e1d7e1`. Archivo en staging `frontend-before.image.tar.gz`, SHA-256 `b80df4ec443f51fac2e711ee9730316f85c4f7c2779baeb39b8b4e64da05b1e8`.

Rollback frontend exclusivo mediante publish.py rollback con el hash aprobado. Antes de uso, rollback-unused.sql elimina solo objetos nuevos y rechaza cualquier trazabilidad; después de uso, disable-used.sql revoca RPC conservando evidencia y guardas. No restaurar el dump completo automáticamente ni revertir cambios operativos posteriores. **No se ejecutó rollback.**

Riesgo residual: los bloqueos de guardas pueden devolver conflicto ante activación/descarte concurrentes; se conserva el manejo de error y actualización obligatoria. Una reapertura de ficha descartada requiere un flujo futuro autorizado. La revisión visual autenticada de producción queda pendiente; el estado técnico actual es **publicado, saludable y con datos existentes conservados**.

Evidencias: publication-summary.json, publication-result.json, migration-result.json, data-before/after/final.json, permissions-proof.json, rpc-anonymous-denied.json, postgres-backup-verification.json y public-browser.json, en la carpeta del paquete. Son registros locales de esta publicación, no históricos en Supabase. Los 28 archivos operativos aprobados permanecen intactos.
