# Procedimiento preparado — NO EJECUTADO

Se aplica al candidato completo, que modifica frontend Y backend. Requiere autorización posterior.
No ejecutar tareas de esta lista durante la validación de solo lectura.

## Preparación antes de reemplazar servicios

1. Registrar SHA final y árbol Git desde el worktree aislado. Comparar contra la producción vigente
   y la lista `OLT-SEGURIDAD-FINAL-ARCHIVOS.txt`. Verificar origin/main remoto sin sobrescribirlo;
   detenerse si hay commits ajenos/divergencia. Preservar el checkout principal y dceafa0.
2. Construir ambos artefactos productivos exclusivamente desde git archive del SHA aprobado.
   Verificar plataforma, revisión y hashes de archivos. Configuración frontend real por canal protegido;
   no sustituirla por el .env ficticio del laboratorio. No ejecutar SQL ni scripts de sincronización.
3. Reinspeccionar los contenedores ejecutados y comparar sus IDs de imagen exactos con
   `backup-2026-10-20T22-41-08.247Z/verification.json`. Si cambiaron, detener y respaldar los nuevos
   en un directorio distinto; nunca asumir que el backup anterior corresponde al servicio actual.
4. Copiar los dos tars, verification.json y rollback.override.json a un directorio NUEVO protegido
   del servidor, por ejemplo `/opt/smartrayco-backups/olt-serial-<UTC>-<SHA>/`. Verificar los dos
   SHA256 del informe y repetir verificación OCI. No alterar ni borrar respaldos anteriores.
5. Conservar copia protegida de compose/.env actuales y sus hashes. No imprimir secretos. Este
   ensayo conservó producción intacta; el respaldo local de imágenes no sustituye el de secretos.
   Mantener el archivo compose anterior para revisar exactamente los servicios recuperados.
6. Tener disponibles ambas imágenes anteriores; si faltan, restaurarlas con docker load de los
   tars verificados, sin cambiar contenedores aún. Validar Id/plataforma/RootFS contra el recibo.
7. Preparar override de despliegue con las dos imágenes nuevas fijadas y scheduler OLT inicialmente
   desactivado. Mantener el volumen `smartrayco_olt_telemetry`, path
   `/var/lib/smartrayco-olt/signal-references.json` y permisos del usuario backend. Verificar compose
   normalizado sin exponer valores secretos. El montaje y la recuperación del checkpoint se ensayaron
   con Docker Linux local; verificar sus permisos reales antes de activar el scheduler.

## Activación posterior a autorización

1. Integrar únicamente el árbol autorizado y hacer push sin forzar desde un checkout limpio. No
   modificar el checkout principal. Revisar los commits entrantes exactos; el candidato incluye los
   padres 6aea8b5 y 0a10d33. No habilitar multi-commit del script seguro si hay alguno ajeno.
2. Aplicar los gates de `deploy/safe-update.sh` con el SHA exacto. Usar su modo
   `DEPLOY_SKIP_DOCKER=1` para separar actualización Git de construcción/activación de imágenes;
   este modo SÍ actualiza Git y no se ejecutó en la validación.
3. Cargar imágenes verificadas y recrear SOLO frontend/backend con compose + override fijado:
   `up -d --no-deps --no-build --pull never frontend backend`. No recrear ni modificar Caddy,
   Mongo, GenieACS ni los equipos de red. No usar actualizaciones generales ni pruning.
4. Verificar HTTPS 200, /api/health, imágenes exactas, SHA del código/artefactos y logs. Verificar
   volumen/ruta escribibles mediante prueba local del helper de checkpoint y formato versión 1;
   no convertir el chequeo en una sincronización ni usar /signal (también escribe en BD).
5. Con autorización de operación normal, habilitar scheduler OLT y observar un único ciclo sin
   lanzar escaneos manuales paralelos. La sincronización normal escribe telemetría/cache/alertas
   en Supabase: no está autorizada por la tarea actual de solo lectura. No se configura la OLT.
6. Confirmar que la retirada queda no confirmada sin potencia ajena, que las identidades nuevas
   conservan mediciones propias y que contratos/vínculos son idénticos. No ejecutar la reparación
   de MSTC8CCE647E ni catalogar/reasignar Estiven automáticamente.
7. Confirmar archivo checkpoint con hash válido y respaldo nuevo de ese estado. Detener la
   activación si aparece error de guardado. En el primer arranque no existe base fiable histórica:
   revisar también las ONT con señal actualmente baja, no esperar una transición reconstruida.
8. Para futuros reinicios planificados, esperar un ciclo terminado/checkpoint guardado y verificar
   que no hay lectura/importación en curso. No eliminar el volumen; conservarlo al recrear imágenes.

## Rollback exclusivo frontend/backend

Preparar desde `rollback.override.json` (solo imágenes) una variante segura que mantenga
`OLT_SYNC_SCHEDULER_ENABLED=false` en backend. Se detiene la sincronización OLT anterior para no
reintroducir silenciosamente la atribución por posición. Su reactivación requiere decisión operativa.
No afectar otros servicios/schedulers ni cambiar equipos.

1. Informar antes de aplicar, salvo recuperación imprescindible ante interrupción causada por el
   despliegue. Registrar motivo, imágenes actuales y último checkpoint; no borrar esa evidencia.
2. Verificar otra vez hashes de los dos tars, cargar ambas imágenes anteriores si faltan y comprobar
   los IDs EXACTOS que figuran en el recibo, no reconstruirlas desde el HEAD Git.
3. Desde `/opt/smartrayco`, usar el compose revisado + la variante segura del override de rollback:

   ```sh
   docker compose -f docker-compose.onprem.yml -f /RUTA/rollback-safe.override.json up -d --no-deps --no-build --pull never frontend backend
   ```

4. Confirmar imágenes: frontend
   `sha256:8b8fcb9b9caa0ddb1de35c87e46cb29d1ef682407b80be8e008fd29009f389bd`, backend
   `sha256:43c7f723812b02d254ffe57909e328adfa20ac5a67cb1562eb91a051b76f032d`.
   Verificar HTTP/API y logs; Mongo, GenieACS y Caddy deben conservar sus contenedores.
5. Conservar el volumen checkpoint para evidencia/reavance; el backend anterior no lo utiliza.
   Restaurar una versión de ese archivo solo si hay corrupción confirmada y autorización; una
   referencia vencida no se vuelve válida por restaurarla.
6. No ejecutar reset --hard, clean, migraciones, restauración global de BD ni rollback.sh genérico.
   Cambiar imágenes no revierte escrituras de telemetría ya realizadas: no tocar datos históricos.

Ensayo realizado: carga exacta de ambas imágenes, integridad OCI, comparación plataforma/RootFS,
nginx -t, Node sin iniciar aplicación, compose de rollback y checkpoint entre contenedores Linux.
La salud funcional completa con configuración productiva se verificará en la ventana autorizada,
no iniciando schedulers de producción desde el laboratorio.
