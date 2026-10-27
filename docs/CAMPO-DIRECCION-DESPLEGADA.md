# Campo: direccion del contrato desplegada

Frontend fuente fc9047f, rama fix/campo-direccion-contrato-local. Promovido 2026-10-27T14:58:48.491085+00:00 (09:58:48 Peru).
Imagen activa: `smartrayco-campo-direccion:fc9047f-20261027T145104Z`.
ID: `sha256:dac71cc991c71f494ba9eb9b489eb4c6ad0c11fdc4eedfaf26989c08fc2136d0`.
Contenedor frontend: `4fd954e70a8daa3958b7f84a6e10e48cabffc51c12a5df4d47ce8999fbcd56ac`; StartedAt `2026-10-27T14:58:48.143889293Z`.

## Alcance y preservacion

Solo dos fuentes de producto: fieldOrderLocation.ts y CampoTrabajoDetailView.vue. Presentacion comun para Altas, Averias y Rutinas: direccion y codigo del contrato exacto, alternativa general identificada si no tiene direccion y GPS completo del mismo contrato para Maps/Waze. Sin contrato se conserva la presentacion anterior. Contrato ausente/ajeno o error de consulta no selecciona otro servicio para la ficha visible.
No cambia la asignacion ni la seleccion/contexto de ejecucion tecnica. Sin cambios de puntuacion, inventario, clientes, contratos o direcciones reales. No requiere ni ejecuta SQL, migraciones, operaciones Supabase/OLT/MikroTik ni backend. A0-A3, Puntos y Devoluciones permanecen incluidos.
Backend 16831c6: imagen `sha256:6631d4a124b631f7bedd3d8c2b6f6c8ab7e524e264385ae2fae2b46e3f67047e`, contenedor `cd577bcaa95cab290bfa2baa7d754a97a516dab94a0aa79af5db6cb34bccf154`, StartedAt `2026-10-26T20:44:49.856235867Z`. Identicos antes/despues, sin reinicio. Caddy, Mongo y GenieACS intactos.

## Preparacion y activacion

Fuente archivada exacta fc9047f, SHA256 `7977ca9102fa96f4d7dded4b0a95b0ae738efc145b57243a99f1c2af8c3663bd`. URL y clave publica de Supabase contrastadas con el frontend activo; configuracion de custodia preservada. Compilacion productiva aprobada. Runtime, entorno nginx y capas base conservados. Los 124 recursos coinciden entre PC, VM e imagen.
Compose efectivo comparado completo: solo services.frontend.image cambia. Hash override nuevo `0a871b28b3793215e880f9f0588c6155c18a37b8cee674af891ef22e7a6f257f`. Promocion con up -d --no-build --no-deps --pull never frontend, conservando toda la cadena:

```text
/opt/smartrayco/docker-compose.onprem.yml
/opt/smartrayco-staging/fase175-counters-16831c6-20261026T162650Z/backend.override.json
/opt/smartrayco-staging/asistencia-a2-full-20261027T000500Z/frontend.override.json
/opt/smartrayco-staging/asistencia-a3-71944f5-20261027T034446Z/promotion/frontend.override.json
/opt/smartrayco-staging/asistencia-visual-233f230-20261027T133357Z/promotion/frontend.override.json
/opt/smartrayco-staging/puntos-ff3077f-20261027T140327Z/promotion/frontend.override.json
/opt/smartrayco-staging/campo-direccion-fc9047f-20261027T145104Z/promotion/frontend.override.json
```

## Comprobaciones

API /api/health, /, /asistencia, /campo y /soporte/ranking: HTTP 200. Index y siete JS/CSS relevantes servidos por HTTPS con SHA256 igual al candidato.
Regresiones locales ya aprobadas: 7 tests unitarios y 229 comprobaciones de vista movil, 27 escenarios. Ver CAMPO-DIRECCION-CONTRATO-LOCAL.md.
Comprobacion adicional del artefacto compilado: 118 verificaciones en 12 escenarios a 390x844, primero en copia local y despues en el frontend publico desplegado. Se usaron sesion y ordenes ficticias, tres servicios del mismo cliente y casos de segundo/tercer contrato, direccion vacia y GPS incompleto, para los tres tipos de orden. Direccion, codigo, origen y destinos Maps/Waze correctos; sin desborde horizontal ni excepciones del navegador.
El simulador del artefacto se ajusto para respetar la paginacion del listado de Altas; no requirio cambios del producto. En la comprobacion publica solo se permitieron GET de documentos y assets; las consultas de datos, autenticacion, telemetria, WebSocket y EventSource estuvieron simuladas/bloqueadas. Cero escrituras reales.
Alcance: se acredita la interfaz publicada con datos ficticios y el mismo codigo compilado. No se presenta como una visita fisica ni prueba Android con orden real. El tecnico debe recargar su pantalla para descargar el nuevo frontend.

## Respaldo y rollback preparado, no ejecutado

Imagen saliente `smartrayco-puntos:ff3077f-20261027T140327Z`, ID `sha256:17a7589eee51b8d58d8457f35ecba815623f181223574623ec2254d0bd1226c4`.
Tar VM `/opt/smartrayco-staging/campo-direccion-fc9047f-20261027T145104Z/recovery/frontend.tar`; copia PC `.env.a3-recovery/field-address-frontend-before.tar`. SHA256 `eb5c037c206fffeb3ccab5f6a583121680ea203a4b41fec99ab850676eb40c68`; indice OCI y 19 blobs verificados, configuracion runtime y capas contrastadas.
Snapshot privado de Compose y contenedores en /opt/smartrayco-staging/campo-direccion-fc9047f-20261027T145104Z/recovery/. Directorio protegido. Override de rollback `/opt/smartrayco-staging/campo-direccion-fc9047f-20261027T145104Z/recovery/frontend.rollback.json`.
Si falta la imagen saliente, cargar el tar verificado y restablecer su etiqueta:
```bash
docker load -i /opt/smartrayco-staging/campo-direccion-fc9047f-20261027T145104Z/recovery/frontend.tar
docker tag sha256:17a7589eee51b8d58d8457f35ecba815623f181223574623ec2254d0bd1226c4 smartrayco-puntos:ff3077f-20261027T140327Z
```
Rollback exclusivo frontend, manteniendo el override backend y toda la cadena:
```bash
cd /opt/smartrayco
docker compose -f /opt/smartrayco/docker-compose.onprem.yml -f /opt/smartrayco-staging/fase175-counters-16831c6-20261026T162650Z/backend.override.json -f /opt/smartrayco-staging/asistencia-a2-full-20261027T000500Z/frontend.override.json -f /opt/smartrayco-staging/asistencia-a3-71944f5-20261027T034446Z/promotion/frontend.override.json -f /opt/smartrayco-staging/asistencia-visual-233f230-20261027T133357Z/promotion/frontend.override.json -f /opt/smartrayco-staging/puntos-ff3077f-20261027T140327Z/promotion/frontend.override.json -f /opt/smartrayco-staging/campo-direccion-fc9047f-20261027T145104Z/promotion/frontend.override.json -f /opt/smartrayco-staging/campo-direccion-fc9047f-20261027T145104Z/recovery/frontend.rollback.json up -d --no-build --no-deps --pull never frontend
```
Verificar API/assets y backend despues de cualquier rollback. No ejecutar rollback SQL ni actualizacion general.

Documentacion y evidencia actualizadas en esta rama; sincronizacion GitHub por push normal, sin force ni merge a main. Directorio principal y cambios ajenos conservados.
