# Corrección puntual del historial — PASS para preparar activación

Integra el candidato local 6c5579c sin cambiar sus migraciones ni conciliación. No se accedió a producción ni se ejecutaron migraciones, push, despliegues o comandos OLT.

## Causa y corrección

El endpoint alert-log mostraba directamente olt_onts.status como estado actual. Ahora consulta también identidad completa y retired_at, y proyecta el estado con la evidencia vigente de ontTelemetry (UUID, serial, posición, OLT y vencimiento). Sin evidencia confirmada devuelve status NULL. Una retirada invalida incluso una caché anterior online. No consulta por posición para sustituir la ONT histórica por la nueva.

La vista distingue «Evento registrado» (kind y fecha originales) de «Estado actual confirmado», «Estado actual no confirmado» u «ONT retirada». Conserva el detalle original y duración, serial y relaciones del evento. La coordenada de una retirada se rotula «Última posición histórica» y no ofrece el botón Ver ONT para operar la retirada. Los estados de eventos recuperados conservan su significado histórico, no indican conectividad actual.

No se reescriben eventos ni se inventa una medición exacta al momento de la alerta: el esquema conserva kind/at/detail, no un snapshot completo de telemetría. El status almacenado de la fila ONT tampoco se interpreta como ese snapshot.

## Archivos funcionales

- server/src/routes/olt.ts
- server/src/services/oltAlertHistoryOnt.ts
- src/lib/oltAlertPresentation.ts
- src/views/olt/OltDetailView.vue

Prueba nueva: server/src/services/__tests__/oltAlertHistoryOnt.test.ts. Evidencias nuevas: docs/olt-alert-history-validation-20261021-163737/. Manifiesto integrado actualizado: docs/OLT-RETIRO-HISTORICO-ARCHIVOS.json (SHA256 de blobs Git, sin auto-hash).

## Validación focalizada

39/39 pruebas aprobadas (5 nuevas y 34 existentes de alertas/presentación). Incluyen activa online/offline, retirada con caché online, alerta anterior al retiro y datos originales, evidencia ausente/vencida, serial distinto en posición reutilizada, relación ausente y payload anterior sin confirmación. Se comprueba cableado de consulta y plantilla; no es una prueba HTTP integral o aceptación visual en navegador.

vue-tsc -b PASS. Comprobación directa de tipos backend: exactamente los cuatro diagnósticos preexistentes registrados en 6c5579c; ninguno nuevo. No se corrigieron errores ajenos. Primer intento de captura de pruebas falló por aislamiento de Windows (uv_os_get_passwd ENOMEM); se preservó fuera del candidato y se repitió con autorización fuera del aislamiento: PASS.

216/216 archivos de la captura protegida conservan SHA256. No hay cambios de las migraciones, scripts SQL o datos respecto de 6c5579c. El nuevo commit será descendiente directo de ese candidato.

## Riesgos y activación

PASS del bloqueo de alertas para preparar activación; no autoriza ejecutarla. Mantienen vigencia los riesgos y secuencia de VALIDACION-FINAL.md: preflight y respaldos frescos recuperables; expansión; backend/frontend compatibles; unicidad activa; conciliación autorizada; observación normal. No se repiten auditorías ni pruebas SQL ya aprobadas porque esos archivos no cambian.

La evidencia confirmada describe la lectura indicada por su fecha, no garantiza continuidad física después de la respuesta; refrescar las pantallas tras conciliación. GenieACS mantiene su ciclo independiente. Los cuatro errores de tipos pueden bloquear un gate tsc completo. Después de reutilizar la posición, conservar ambas historias y el esquema/aplicación compatibles; no hacer downgrade que ignore retired_at. Validación visual y productiva permanece pendiente de autorización.
