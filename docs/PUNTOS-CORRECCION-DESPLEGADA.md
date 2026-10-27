# Puntos: correccion productiva activada

Fuente frontend ff3077f, rama fix/puntos-noviembre-local. Promovido 2026-10-27T14:16:10.999633+00:00.
Imagen activa: `smartrayco-puntos:ff3077f-20261027T140327Z`.
ID imagen: `sha256:17a7589eee51b8d58d8457f35ecba815623f181223574623ec2254d0bd1226c4`.
Contenedor frontend: `be1401f4a676f473c60353bbedc3fd0e6404da6ec62b61a0af0141f338b35ca8`; StartedAt `2026-10-27T14:16:10.605278999Z`.

## SQL y preservacion

Aplicadas solo technician_ranking_between y my_field_order_points en transaccion con guardas de deriva, lock_timeout 2s y statement_timeout 15s. Cuerpos instalados contrastados exactamente con el candidato; permisos, propietario y search_path conservados. Las otras ocho funciones revisadas permanecen identicas. Sin DML, tablas nuevas ni cambios de liquidaciones.
Candidato SHA256 `38702ab2cd4af8f37790a67f984b3c1ed37c575a1fdc96affb770fb6a1d968b8`; SQL protegido `cb32ecec8f344f36b57c90c699a7177c776082e86386044e6d91732315982ced`.
El corte oficial permanece 01/11/2026 00:00 America/Lima (05:00 UTC). Confirmaciones elegibles y participantes congelados; sin duplicacion historica.

Octubre: filas y aportes de TCK-2026-00057, 00068 y 00070 identicos antes/despues. Mi Avance y Ranking coinciden: semana 11, mes 325.5. Historial: 00057=0, 00068=1, 00070=0; detalle operativo 00070=4 totales/2 asignados. La nueva interfaz identifica el periodo piloto. Esos ceros se conservan por decision del propietario.

## Frontend y servicios

Compilacion productiva exacta ya preparada: 124 archivos verificados en PC, VM e imagen. Runtime, entorno y capas base conservados. Compose completo comparado: solo cambia services.frontend.image. Se promovio con --no-build --no-deps --pull never frontend. A0-A3, Devoluciones y otros modulos permanecen incluidos; solo CampoJobPoints.vue difiere en fuente frente al frontend visual anterior.
Backend 16831c6: imagen `sha256:6631d4a124b631f7bedd3d8c2b6f6c8ab7e524e264385ae2fae2b46e3f67047e`, contenedor `cd577bcaa95cab290bfa2baa7d754a97a516dab94a0aa79af5db6cb34bccf154`, StartedAt `2026-10-26T20:44:49.856235867Z`, sin reinicio. Caddy, Mongo y GenieACS intactos.

Cadena Compose completa, en orden:
```text
/opt/smartrayco/docker-compose.onprem.yml
/opt/smartrayco-staging/fase175-counters-16831c6-20261026T162650Z/backend.override.json
/opt/smartrayco-staging/asistencia-a2-full-20261027T000500Z/frontend.override.json
/opt/smartrayco-staging/asistencia-a3-71944f5-20261027T034446Z/promotion/frontend.override.json
/opt/smartrayco-staging/asistencia-visual-233f230-20261027T133357Z/promotion/frontend.override.json
/opt/smartrayco-staging/puntos-ff3077f-20261027T140327Z/promotion/frontend.override.json
```

## Verificaciones y limites

API /api/health, /, /asistencia, /campo y /soporte/ranking: HTTP 200. Index y siete recursos JS/CSS de Campo, Ranking, Asistencia y entrada con SHA256 identico al candidato. SQL productivo verificado por cuerpos y ACL; historicos por consultas de solo lectura.
Se reutilizan 12 tests nuevos, 28 existentes y 26 comprobaciones de navegador aprobados. Casos ficticios: Otros/manuales, sin confirmacion, integrantes congelados, descuentos, redondeos y cambios de mes. Adicional: ensayo aislado del rollback y de guardas de deriva aprobado. No se introdujeron ordenes, confirmaciones ni relojes ficticios en produccion.
Los casos oficiales de noviembre estan comprobados con datos ficticios y el codigo instalado; no se presentan como una operacion real de noviembre. El uso real oficial corresponde al corte ya establecido. Las pantallas abiertas conservan su mecanismo habitual de consulta/actualizacion.

## Recuperacion preparada, no ejecutada

Frontend previo `smartrayco-asistencia-visual:233f230-20261027T133357Z`, ID `sha256:b1d21a1c3a2d8656b98040316b76b5458e7ba1b619d41f4d14426d15278ba038`.
Respaldo VM `/opt/smartrayco-staging/puntos-ff3077f-20261027T140327Z/recovery/frontend.tar`; copia PC `.env.a3-recovery/frontend-visual-current-points-backup.tar`. SHA256 `e7b9213a15a5d5606c91b8681aab033bfedf73d744c636e55502342083b52101`, indice OCI y 18 blobs integrales, config runtime y capas contrastados.
SQL original VM `/opt/smartrayco-staging/puntos-ff3077f-20261027T140327Z/recovery/functions-original.sql`; PC `.env.a3-recovery/points-rollback-original.sql`. SHA256 `a927121cc94083e5be4394b2eda7858340dad3047ce38116923a04fb84567ea2`. Restauracion de definiciones, ACL, propietario y search_path ensayada en PostgreSQL aislado.
Rollback SQL: restaurar solo las dos definiciones originales en transaccion; no ejecutar reversions de datos u otras migraciones. Si falta imagen, docker load del tar verificado y docker tag del ID anterior a su etiqueta.
Rollback frontend: conserva cadena actual y vuelve a aplicar el override visual anterior AL FINAL:
```bash
cd /opt/smartrayco
docker compose -f /opt/smartrayco/docker-compose.onprem.yml -f /opt/smartrayco-staging/fase175-counters-16831c6-20261026T162650Z/backend.override.json -f /opt/smartrayco-staging/asistencia-a2-full-20261027T000500Z/frontend.override.json -f /opt/smartrayco-staging/asistencia-a3-71944f5-20261027T034446Z/promotion/frontend.override.json -f /opt/smartrayco-staging/asistencia-visual-233f230-20261027T133357Z/promotion/frontend.override.json -f /opt/smartrayco-staging/puntos-ff3077f-20261027T140327Z/promotion/frontend.override.json -f /opt/smartrayco-staging/asistencia-visual-233f230-20261027T133357Z/promotion/frontend.override.json up -d --no-build --no-deps --pull never frontend
```
Despues comprobar API, assets e identidad backend. No hubo rollback en esta activacion.

Se corrigio y valido la sintaxis del script auxiliar antes de operar; una detencion previa no habia aplicado SQL ni desplegado. Evidencia detallada: PUNTOS-CORRECCION-RELEASE.json. Sin push, merge a main, nuevas fases ni cambios ajenos.
