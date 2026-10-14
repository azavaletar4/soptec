# Devolver rutinas — preparación local (Fase 161)

No aplicado en Supabase ni desplegado. No hay escrituras contra datos reales.

## Causa y comportamiento

App Campo mostraba el formulario solo para tickets y llamaba a `return_ticket`.
Rutinas no tenía RPC de devolución ni historial compatible. `job_assignees`
solo permite escritura directa a despacho; no se modifica esa política.

`return_routine` exige identidad de técnico activo, pertenencia a cuadrilla,
estado `in_progress` y motivo no vacío. Bloquea la rutina y las asignaciones
existentes. Registra UUID del evento, rutina, técnico, hora del servidor,
motivo y copia de IDs/roles de cuadrilla. En la misma transacción pasa a
`pending`, libera `assigned_to` y elimina la cuadrilla completa. El trigger
existente cierra la sesión como `paused`. No modifica `closure_notes`, fotos,
contratos ni fechas de programación. Un reintento tras devolver se rechaza;
un nuevo ciclo de atención permite otra devolución con su propio registro.

Oficina encuentra la rutina en Pendientes, Sin asignar, con la marca
«Con devoluciones». Al abrirla ve el historial y puede usar el editor de
cuadrilla existente. La marca es histórica: permanece después de reasignar.
Fechas del historial en America/Lima. El responsable se resuelve por ID
verificado a su perfil actual; si cambia el nombre, el ID auditado se conserva.

## Validación

`npm run test:routine-returns-sql`: PostgreSQL 17 en Docker, red deshabilitada,
datos sintéticos, migración local real y policies/funciones relevantes reales.
Incluye identidad, RLS, estados, motivo, apoyo, múltiples ciclos,
concurrencia entre devoluciones, rollback por fallo al eliminar cuadrilla,
sesión de trabajo, lectura/reasignación administrativa y RPC original de Averías.

`node node_modules/vue-tsc/bin/vue-tsc.js -p tsconfig.app.json --noEmit`.

Pendiente comprobación visual y prueba operativa de punta a punta después
de una autorización separada. No se verificó contra Supabase en esta tarea.

## Aplicación futura (solo con autorización explícita)

1. Respaldar el esquema y guardar commit anterior del frontend.
2. Revisar y aplicar exclusivamente
   `supabase/migrations/20261014180000_fase161_devolver_rutinas.sql`;
   no ejecutar indiscriminadamente otras migraciones locales pendientes.
3. Comprobar tabla, FK, RLS, permisos y firma RPC; refrescar el esquema
   de PostgREST si aún no reconoce la relación.
4. Desplegar frontend después de aplicar SQL. Su consulta de Rutinas incluye
   la relación `routine_returns`; antes de migrar no funcionará esa consulta.
5. Verificar listado, historial y controles con una orden de prueba autorizada,
   nunca usando órdenes reales para pruebas destructivas.

## Riesgos y rollback

Las FK `ON DELETE RESTRICT` impiden borrar rutinas o perfiles con devoluciones:
es intencional para conservar la auditoría; la oficina debe cancelar la rutina
en vez de borrarla. No se cambian políticas globales. No se amplían roles.
Las fechas anteriores se conservan: oficina revisa la programación al reasignar.

Rollback recomendado: restaurar el frontend anterior y revocar ejecución de
`return_routine` a `authenticated` (sin ejecutarlo durante esta preparación).
Conservar `routine_returns` y sus datos de auditoría. Si luego se decide quitar
la RPC, `DROP FUNCTION public.return_routine(uuid,text)` no borra el historial.
No borrar la tabla salvo respaldo y autorización explícita. No reconstruir
automáticamente cuadrillas ni estados antiguos: una rutina ya devuelta puede
haber sido reasignada o atendida; se revisa cada orden con oficina.
