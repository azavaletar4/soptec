# Puntos: riesgo aceptado y recuperación — 25/10/2026

## Decisión del propietario

El propietario retiró expresamente del alcance la corrección de reapertura de órdenes históricas. Acepta el riesgo documentado de que una orden histórica sin registro en la tabla nueva de confirmaciones no sea reconocida como definitiva por las guardas nuevas, y se compromete a no reabrir esas órdenes como SUPERADMIN.

Este riesgo deja de bloquear la preparación por decisión del propietario. No se presenta como corregido ni como protección técnica existente. No se cambian políticas, guardas, órdenes históricas ni el alcance de las tres migraciones. Las órdenes que sí reciban la confirmación administrativa nueva conservan las guardas definitivas ya probadas.

La aceptación no autoriza modificar Clientes, Contratos, Deuda, Facturación, datos históricos, OLT o MikroTik. Tampoco autoriza aplicar migraciones o desplegar en producción.

## Revisión de las candidatas

Se reutilizó el preflight productivo y las pruebas ya aprobadas. Los archivos siguen idénticos a `c6371a4`. Estos son los hashes del checkout revisado, con el orden:

| Migración | SHA-256 |
| --- | --- |
| 20261024180000_work_order_points.sql | a8af694c54d88661a9cb36c304214d5241933027080fda833a5344ef2c75c168 |
| 20261024190000_field_order_points_readonly.sql | 5a0ebce706331b3fa92433ec9b56ddf45470b03b475b8f299c6b49e55bbc7573 |
| 20261024200000_work_order_point_confirmations.sql | a73c3d58b634fbf9f02f9294e2def3edb2969cd5f92d5c70c186388dc68db59e |

Sin backfill de órdenes. Se conservan obligatoriedad de puntos nuevos, ajuste ADMIN/SUPERADMIN antes de confirmación, lectura personal de líder/ayudantes y guardas de confirmación nueva. Octubre sigue piloto fuera del cómputo oficial; el corte permanece 01/11/2026 00:00 America/Lima (05:00 UTC). Ninguna candidata se aplicó en esta sesión.

## Diagnóstico acotado del respaldo

Los tres intentos previos se interrumpieron durante COPY de tablas, tanto desde PC como desde VM. No hubo un error de validación del certificado que justificara reducir TLS. Se mantuvieron `sslmode=verify-full`, CA y comprobación de destino.

La comprobación de sesión mostró timeouts de transacción/inactividad en cero y ninguna configuración adicional de timeout en el rol postgres. El endpoint directo no fue utilizable: resolución fallida desde PC y dirección IPv6 sin ruta desde VM. No se cambiaron red, certificados, contraseñas ni configuración productiva para sortearlo.

La alternativa de exportación usa `pg_dump --format=custom --rows-per-insert=1000`: evita el protocolo COPY al leer datos, conserva el catálogo y todos los datos y mantiene una instantánea exportada de solo lectura. Los INSERT pertenecen al archivo de respaldo y a su restauración aislada; no se ejecutan en Cloud. No se excluyen tablas para aparentar una copia integral.

Referencias técnicas: [conexiones para pg_dump en Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres) y [opciones de pg_dump 17](https://www.postgresql.org/docs/17/app-pgdump.html). Evitar COPY es una medida diagnóstica; no demuestra por sí sola la causa interna del cierre de conexión.

## Resultado de recuperación

**Respaldo lógico completo y restauración aislada aprobados.** La exportación por INSERT terminó sin errores, sin excluir tablas y conservando `verify-full`. El archivo completo pasó `pg_restore --file=/dev/null` y se copió de la VM al PC. No se atribuye una causa interna definitiva al pooler/TLS: se resolvió el bloqueo operativo de esta exportación evitando COPY, sin alterar el servicio ni sus certificados.

- Instantánea Cloud: **25/10/2026 23:11:34.748524 UTC = 18:11:34.748524 Lima**.
- Archivo: `completo.dump`, **42.380.870 bytes**.
- SHA-256: `d6de4c62e91e994c314630b140c30e1d974ea3abc15e686ae32564faf6e19e8f`.
- Se contrastaron ocho archivos de base/metadatos entre VM y PC: todos los tamaños y hashes coincidieron. Se conservaron roles sin contraseñas, configuración de base, catálogo y huellas de la instantánea.
- Restauración SQL en PostgreSQL Supabase 17.6, contenedor nuevo **sin red**, con aborto ante error y sin `--no-owner` ni `--no-privileges`: completada, código 0. No se restauró nada sobre producción.
- **111 tablas** de `public`, `auth`, `storage` y `supabase_migrations`: conteos y hashes de todas sus filas idénticos al origen de la instantánea. Incluye los datos históricos de los módulos existentes; no se hicieron ajustes sobre ellos.
- **136 funciones, 103 políticas y seguridad de 110 tablas**: definiciones, propietarios, RLS y privilegios efectivos coincidentes. Se normalizó únicamente el orden de listas y la representación SQL de ACL predeterminada del propietario (`NULL` frente a su lista explícita). No se cambiaron permisos para hacer pasar la validación. Esta distinción sigue las [reglas de privilegios PostgreSQL 17](https://www.postgresql.org/docs/17/ddl-priv.html).
- **1.146 objetos Storage**, seis buckets y **131.308.078 bytes**: copia previa restaurada en otra carpeta privada, todos los SHA-256 coincidentes. Su conciliación con la base ahora restaurada dio **cero faltantes y cero identidades cambiadas**.
- Se reutilizó la verificación aprobada de las dos imágenes frontend/backend y de los 120 archivos servidos. No se volvió a respaldar o reconstruir ese conjunto innecesariamente.
- El catálogo restaurado confirma las tres versiones de puntos ausentes y la fuente compartida con MD5 `26a40b0e3a17831849b67a6562b6036d`, coincidente con la guarda de 200000. Ninguna migración de puntos se ejecutó siquiera sobre esta copia restaurada.

La primera comparación textual de catálogo marcó diferencias de orden y de representación de ACL. Se corrigió exclusivamente el comprobador y se comparó otra vez la evidencia existente, sin repetir la restauración SQL ni relajar los contenidos que debían coincidir. Los fallos anteriores y el intento por INSERT detenido para ampliar su límite de ejecución se conservaron; no se presentan como respaldos válidos.

Custodia privada, fuera de Git:

- PC: `C:\Users\USER\AppData\Local\SmartRaycoBackups\puntos_respaldo_20261025_231104_d4c2610b`, con ACL restringida a usuario y SYSTEM.
- VM: `/opt/smartrayco-staging/points-preserve-20261025T223218Z/cloud-database-inserts-1792969891907`.
- Manifiesto privado: `recovery-manifest-private.json` dentro del directorio PC. Referencia las copias de aplicación y objetos preservadas en los directorios privados anteriores.
- Evidencia y ejecutores de esta sesión: `scripts/inventory-auth-lab/runtime/points-*`, excluidos de Git. Nunca publicar runtime ni respaldos, configuraciones, credenciales o registros personales.

Este resultado acredita la recuperación lógica y los archivos referenciados; **no** certifica un arranque integral de Auth/Storage/Realtime mediante sus APIs ni una recuperación productiva con escrituras posteriores al despliegue. Se conserva como evidencia previa el ensayo SQL aprobado de recuperación posterior a ajuste/confirmación de `86f25fa`; no se repitió ni se amplió artificialmente su alcance.

## Preparación de la activación y pendientes

Se conserva el borrador aislado de 20 archivos de puntos/Campo ya compilado, con backend intacto. Su manifiesto registra ahora el riesgo histórico como aceptado. No se incorporaron cambios de Clientes, Contratos, Deuda, Facturación, prototipos ni trabajos ajenos. Tampoco se reconstruyó o desplegó de nuevo la aplicación en esta sesión.

El respaldo deja de ser un bloqueo por dump truncado. La reapertura histórica deja de bloquear por decisión del propietario. Siguen pendientes antes de recomendar activación:

1. Certificar que el artefacto acotado preserva la fuente efectiva del frontend servido: la reproducción anterior de la base Git no coincidió exactamente con los archivos activos. Esa diferencia no se resolvió en este trabajo de respaldo.
2. Cerrar la coordinación de formularios, cachés y colas antiguos: la obligatoriedad de puntos puede rechazar creaciones de clientes anteriores. No se modificaron esos clientes ni sus colas.
3. Concretar y verificar la recuperación operacional que conserve escrituras posteriores. No restaurar esta instantánea antigua sobre datos actuales ni volver ciegamente al frontend anterior con una base incompatible. Ante una contingencia posterior, preservar primero el estado más reciente, auditorías, confirmaciones y objetos nuevos; preparar y verificar la reconciliación en un destino aislado. Ningún cambio de destino, rollback o corrección productiva queda autorizado aquí.

Las pruebas físicas Android corresponden al propietario y siguen sin certificación completa. Esta sesión no abrió la APK ni declaró validados cámara, GPS, WebView u offline físico.

## Publicación y despliegue

Se publica únicamente este informe y la referencia de continuidad desde la validación final. No se incluyen ejecutores, archivos de prueba, SQL, respaldos o cambios del producto. `c6371a4` permanece como base de código funcional; el commit de esta sesión es exclusivamente documental.

**Sin migraciones productivas, despliegue, escrituras de datos reales ni cambios de servicios de internet.** El orden de activación sigue siendo 180000 → 190000 → 200000, sujeto a completar pendientes y recibir autorización posterior. Publicar esta documentación no activa puntos.
