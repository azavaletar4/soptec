# Fase 162 — inventario de Rutinas, implementación local

Base: ccdf94f. Implementación autorizada únicamente en local; bodega central, sin inventario personal ni paralelo. No se usó SSH, Supabase Cloud ni el respaldo privado durante esta implementación. No se aplicaron migraciones reales ni se ejecutaron movimientos reales, push o despliegues.

## Comportamiento implementado

- Nuevo componente `RoutineInventory.vue` integrado exclusivamente para Rutinas en Campo y en el modal de oficina de Rutinas. Reutiliza catálogo, consultas de equipos, productos, tipos y formato de errores de los stores actuales. Las ramas de Averías/Altas y sus stores permanecen intactos.
- Consumibles: saldo central, cantidades positivas de hasta dos decimales; productos en unidades requieren enteros. Los equipos serializados no aparecen como consumibles ni descuentan current_stock. Corrección = reversa + nuevo egreso en una sola transacción; quitar un registro inserta reversa trazada. No se borran movimientos.
- Entrantes: unidad existente por serie/MAC, disponible, producto activo serializado, cliente de Rutina y contrato verificado. Si la Rutina tiene contrato, no se permite sustituirlo; si el cliente tiene contratos y la Rutina no fija uno, se exige selección explícita. Sin contratos puede quedar solo cliente. Se conserva el límite existente de una ONT por contrato.
- Entrante queda `pending_approval`. Oficina (`SUPERADMIN`, `ADMIN`, `SOPORTE`) aprueba a `assigned` desde la misma sección. El técnico no puede aprobar. Rechazar/corregir un entrante lo deja `en_recupero`, pendiente de recepción física; no se presume que un equipo ya registrado esté físicamente en bodega.
- Retiro: solo equipo `assigned` del cliente y contrato verificados de esa Rutina. Exige motivo. Se permite la excepción autorizada aunque el equipo proceda de un Alta o Avería cerrada. Queda `en_recupero`, con responsable y referencia a la rutina; no disponible en bodega. No necesita aprobación previa de oficina, pero sí recepción posterior.
- Oficina confirma recepción física y condición (`in_stock`, `in_repair`, `damaged`). Los eventos inmutables conservan los IDs de instalación/ticket originales, cliente/contrato, autor y estados. Solo al recibir se limpia la asignación actual de la unidad, como una devolución normal: no modifica ni elimina la orden original y permite reutilizar el equipo conforme a los flujos existentes.
- Devolver, cancelar, completar o reasignar la Rutina no revierte automáticamente inventario. Técnico anterior pierde escritura. Nuevo técnico ve el historial; solo puede registrar durante `in_progress` y siendo integrante activo de la cuadrilla. Oficina conserva aprobación/recepción de pendientes incluso si la Rutina ya no está en progreso.

## Seguridad e idempotencia

Única entrada nueva: `public.routine_inventory_operation(uuid,uuid,text,jsonb)`. Comprueba auth.uid y current_user_role, bloquea la Rutina y su cuadrilla antes de operaciones del técnico y bloquea producto/unidad. No acepta el autor del navegador. Reintentos con el mismo UUID/carga/actor devuelven el resultado original; distinta carga o identidad se rechaza. Un reintento de una operación ya confirmada puede resolverse tras devolver la orden, sin nuevos movimientos.

`routine_inventory_operations` guarda comprobantes de petición/respuesta, no stock. Es privada, sin acceso directo de authenticated/anon/service_role. Los guardas requieren comprobante pendiente del actor y transacción actuales. UUIDs, settings de sesión o inserts directos no conceden la excepción. Hay unicidad de reversa para movimientos de Rutinas y protección frente a escrituras directas en sus movimientos, eventos y estado/asignación de unidades. No se borran unidades con historial de Rutina.

El dispatcher `apply_inventory_unit_event()` añade una única rama para eventos con routine_id respaldados por esos comprobantes. Todo el código previo de Fase 151 se conserva y se compara literalmente en las pruebas. No se desactiva ningún trigger. La migración verifica antes de cambiar esquema que la función compartida coincide con la revisión de Fase 151; ante drift aborta para revisión.

El navegador persiste el UUID y la carga antes de enviar. Si pierde la respuesta, bloquea nuevas operaciones hasta resolver la pendiente con el mismo UUID. Una respuesta SQL de rechazo libera la intención porque la transacción falló; una pérdida de red conserva el comprobante. No se encolan consumos dentro del cierre offline ni se descuentan otra vez al cerrar.

## Migración pendiente

`supabase/migrations/20261015180000_fase162_inventario_rutinas.sql` (transaccional):

1. Guarda de compatibilidad de la función Fase 151.
2. Tabla privada de comprobantes; FK routine_id/operation_id en Kardex y eventos; routine_id en estado actual de unidad; índices y reversa única.
3. Guardas acotados, operación de Rutinas y excepción autorizada del dispatcher.
4. Privilegios: solo authenticated ejecuta la operación pública; helpers privados sin EXECUTE público.

Requiere Fases 151/159/161 y columnas/estados de inventario existentes, incluido en_recupero. Antes de cualquier aplicación futura: contrastar solo esos objetos con el catálogo Cloud y revisar el SQL. Si la guarda detecta diferencias, detenerse; no reemplazar funciones reales a ciegas. Aplicar SQL antes del frontend, solo tras autorización separada.

Rollback futuro recomendado: revocar ejecución de la nueva RPC bajo autorización y restaurar frontend previo; conservar esquema, comprobantes y movimientos. Resolver los equipos pendientes mediante oficina antes de retirar la interfaz de recepción. No borrar columnas/eventos ni volver a Fase 151 mientras existan operaciones nuevas sin un plan de compatibilidad.

## Validación realizada

- Pruebas SQL con PostgreSQL 17 real, contenedores efímeros sin red ni puertos, datos sintéticos. Se cargan funciones reales de Fase 151, sesiones 150/150b, devolución 161 y migración nueva. El fixture reproduce tablas relevantes; no es una réplica completa de Supabase.
- Fase 162: UTP 12,75 m; RJ45 entero; rechazo de fracciones en unidades, cantidades inválidas y serializados como material; stock insuficiente; reintento y carga/actor distintos; doble envío concurrente; corrección atómica y doble reversa; TV Box pendiente y aprobación; retiro desde origen cerrado, recepción y trazabilidad; cliente/contrato/estado ajenos; autenticación, técnico inactivo/cuadrilla/estado; inserts directos y falsificación; fallo de evento con rollback de proyección/comprobante; devolución/reasignación; cancelación; dos retiros concurrentes; regresión legacy y rechazo de drift en Fase 151.
- Regresiones existentes: `closedOrders.sql.test.ts` y `routineReturns.sql.test.ts` aprobadas. Adicionalmente, la suite nueva comprueba Averías/Altas con la Fase 162 ya instalada, y compara que la rama anterior del dispatcher sea idéntica.
- Dos pruebas de almacenamiento de peticiones: respuesta perdida/reapertura, UUID estable, rechazo de cambio de carga, rechazo SQL y fallo de persistencia antes del envío.
- `vue-tsc -p tsconfig.app.json --noEmit`: aprobado. Build Vite local: aprobado; advertencia de chunks grandes, sin actualizar dependencias.
- Chrome local con viewport móvil y User-Agent SmartRaycoApp: registro visual simulado de UTP, RJ45, TV Box y retiro; oficina aprueba desde modal de Rutinas. API completa interceptada, sin solicitudes reales. No sustituye la prueba física de APK o una prueba autorizada con JWT reales.

Comandos:

```text
npm run test:routine-inventory-sql
npm run test:routine-inventory-request
node --import tsx --test server/tests/closedOrders.sql.test.ts server/tests/routineReturns.sql.test.ts
node node_modules/vue-tsc/bin/vue-tsc.js -p tsconfig.app.json --noEmit
node node_modules/vite/bin/vite.js build --outDir revision-fase2/fase162-ui-build
node node_modules/vite/bin/vite.js preview --outDir revision-fase2/fase162-ui-build --host 127.0.0.1 --port 4176
node scripts/tests/fase162-local-ui.mjs
```

## Riesgos y verificaciones pendientes

- Compatibilidad exacta con Cloud aún no contrastada en esta fase. La implementación y migración NO están en producción.
- Falta probar en APK física: suspensión, recarga, atrás, teclado decimal y recuperación de conexión con operación pendiente. Los comprobantes locales no sobreviven al borrado de datos del navegador; no repetir manualmente un registro dudoso sin revisar el historial.
- En un perfil Chrome vacío se observó un problema previo: drafts y closures usan el mismo nombre de IndexedDB con createStore independientes; puede faltar un object store. No se modificaron esos módulos. El arnés visual inicializa ambos almacenes de la fixture para probar el inventario; este hallazgo queda pendiente de una corrección separada del arranque offline.
- No se ha certificado end-to-end de inventario real ni facturación/activación IPTV. Asignar un TV Box no modifica el servicio de TV.
- `en_recupero` se reutiliza para pendiente de recepción; el módulo existente puede mostrarlo en su bandeja de recupero. Las operaciones sobre unidades vinculadas a Rutina deben pasar por la sección de Rutinas, no por inserts legacy sin comprobante. Revisar esa presentación con oficina antes del despliegue.
- La obligación de conservar auditoría bloquea eliminación de Rutinas, perfiles de actores y unidades referenciadas. Usar cancelación/desactivación.
- Las unidades de medida provienen de inventory_products.unit. El control de enteros cubre etiquetas de unidad revisadas; antes de desplegar, contrastar las unidades reales de los productos que se habilitarán.

Los cambios previos de Fase 161 y documentos ajenos se conservan fuera del commit de esta implementación. No se cambiaron backend, OLT, MikroTik ni los flujos de Averías/Altas.
