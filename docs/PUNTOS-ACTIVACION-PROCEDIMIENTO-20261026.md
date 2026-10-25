# Procedimiento propuesto de activación de puntos — 26/10/2026

Preparado el 25/10/2026. Publicar el repositorio no autoriza ejecutar este procedimiento. Migraciones, despliegue y cualquier operación productiva requieren autorización posterior. Octubre continúa como período de pruebas, excluido del cómputo oficial.

## Versión y condiciones previas

Cambios validados: `591df768a48703895967bac9e4543738f44a2373` y `86f25fa9be401ea8668e3cccec7156412a6cfc63`, sobre `debeff885ba298b80e94df2dc9a8cb84586e9eb1`. Este documento agrega únicamente instrucciones. El informe [de validación](PUNTOS-CAMPO-VALIDACION-20261025.md) describe pruebas, límites y pendientes; sus referencias a «sin push» corresponden a aquella sesión.

Antes de autorizar producción:

- Completar el recorrido Auth/JWT real → API/PostgREST → RLS/RPC/Storage/realtime en Supabase aislado con ADMIN, SUPERADMIN, líder, ayudante, ajeno e inactivo. Probar reintentos y confirmación concurrente sin duplicados, lectura propia y rechazo de modificaciones tras cierre definitivo.
- Completar Android en dispositivo con APK conectada exclusivamente al laboratorio: puntos, cámara/fotos, permisos y GPS, firma histórica sin captura nueva, devoluciones pendientes de recepción, interrupciones, cola y arranque offline. La APK existente apunta a producción y no certifica estas pruebas.
- Identificar el commit/artefacto exacto a desplegar, configuración productiva y versión anterior recuperable. No desplegar la compilación sintética de las pruebas.
- Revisar automatizaciones externas: el push autorizado es solo publicación de código, no autorización para despliegue automático.

## Orden de ejecución, sujeto a autorización

1. **Preflight de solo lectura.** Confirmar proyecto destino, versión PostgreSQL, historial real de migraciones, funciones dependientes, ACL/RLS y triggers existentes. Verificar que las tres versiones estén pendientes y que la guarda de la fuente compartida de 200000 coincida con su definición esperada. Si hay deriva o una versión previa diferente ya aplicada, detenerse; no eludir la guarda ni modificar el historial.
2. **Respaldo verificable.** Registrar hora y versión desplegada. Respaldar base e historial de migraciones, definiciones y permisos de funciones, roles/ACL/RLS, auditorías y configuración necesaria; preservar Storage y firmas históricas con inventario de objetos. Custodiar secretos fuera del repositorio. Verificar hashes y una restauración en destino aislado compatible con Supabase, incluyendo sus dependencias. Definir cómo conservar las escrituras posteriores al respaldo y los responsables de recuperación.
3. **Ventana coordinada.** Suspender temporalmente las operaciones afectadas por el cambio y coordinar clientes/colas antiguos. 180000 exige puntos al crear: formularios antiguos pueden fallar. Evitar una ventana con interfaz y base incompatibles; no alterar estados técnicos ni vaciar colas.
4. **Migrar exactamente en este orden**, con revisión después de cada transacción: `20261024180000_work_order_points.sql` → `20261024190000_field_order_points_readonly.sql` → `20261024200000_work_order_point_confirmations.sql`. No aplicar indiscriminadamente otras migraciones pendientes. Ante cualquier error, detener la secuencia. Cada archivo tiene su propia transacción; fallar el tercero no revierte los dos anteriores. Usar el mecanismo acordado que registre correctamente las versiones aplicadas.
5. **Comprobar esquema y permisos.** Confirmar instalación e historial exactos, revocación de escritura directa innecesaria de `service_role` en auditoría, RPC autorizadas, RLS, restricciones únicas y guardas definitivas. No usar órdenes reales para ensayar ajustes ni confirmaciones.
6. **Desplegar artefactos aprobados.** Publicar únicamente componentes afectados con configuración revisada; coordinar caché y recarga de clientes. Una actualización de APK, si resulta necesaria, requiere su propia validación y autorización. Mantener disponible la versión anterior y el plan de compatibilidad con la base migrada.
7. **Validación funcional.** Ejecutar primero la matriz completa con datos sintéticos en el entorno aislado: Avería/Alta/Rutina con puntos obligatorios; líder/ayudante consultan; técnico no ajusta ni confirma; ADMIN/SUPERADMIN ajustan con motivo/auditoría; confirmación única congela reparto e impide reapertura por interfaz/API/RPC; actualización de crédito sin confundirlo con asignación; evidencias, firmas históricas, cola/reintentos y devoluciones sin movimiento prematuro. En producción limitar inicialmente a comprobaciones de lectura; cualquier ensayo que escriba requiere autorización expresa y un plan de datos separado.
8. **Cierre de ventana.** Confirmar salud, versiones, errores de permisos y colas, registrar evidencia y habilitar operaciones afectadas solo cuando las comprobaciones sean satisfactorias. Vigencia oficial: **01/11/2026 00:00 America/Lima = 05:00 UTC**. Octubre no se arrastra al oficial; verificar los criterios de creación, cierre técnico y confirmación documentados.

## Rollback y contingencia

- Un error dentro de una migración revierte esa transacción. Detenerse y registrar cuáles versiones anteriores sí quedaron instaladas; no repetir ni borrar versiones a ciegas.
- Antes de uso nuevo, volver al estado anterior exige un respaldo restaurable y compatibilidad de aplicación/base, sin perder escrituras posteriores. Ensayar la recuperación en destino aislado antes de cualquier cambio productivo; requiere autorización específica.
- Después de crear órdenes, ajustar o confirmar, **no borrar tablas, auditorías, confirmaciones ni columnas; no restaurar una copia antigua encima de datos actuales ni volver ciegamente al cálculo anterior**. Conservar evidencias y escrituras nuevas, restringir operaciones afectadas y preferir una corrección hacia adelante. Una recuperación debe reconciliar los datos en un destino aislado y aprobar un cambio de destino verificado.
- Revertir solo el frontend no revierte el esquema ni garantiza compatibilidad. Mantener bloqueadas las operaciones incompatibles hasta resolverlo. No reabrir permisos de auditoría ni desactivar guardas para facilitar la recuperación.

El ensayo PostgreSQL acreditado demuestra recuperación sintética en bases vacías; no constituye un script de reversión productiva ni certifica la recuperación integral de Auth, Storage o Vault. No iniciar activación mientras esos límites y los pendientes Android/Supabase sigan sin resolver.
