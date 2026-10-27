# Asistencia ? interfaz de cuatro pesta?as desplegada

Despliegue autorizado del commit `233f230f06e0946dca31109cf68299e4356cb2b5` desde
`feature/asistencia-a3-local`, completado el 27/10/2026 13:35 UTC (08:35 Per?).

Frontend: `smartrayco-asistencia-visual:233f230-20261027T133357Z`.
Imagen: `sha256:b1d21a1c3a2d8656b98040316b76b5458e7ba1b619d41f4d14426d15278ba038`.
Contenedor: `eabc57a9ed58e13734dc3ac64f7a6fdd921877bd48159ccb0fcd34edf9c53c37`; StartedAt `2026-10-27T13:34:58.030706237Z`.

Backend `16831c6`: imagen `sha256:6631d4a124b631f7bedd3d8c2b6f6c8ab7e524e264385ae2fae2b46e3f67047e`,
contenedor `cd577bcaa95cab290bfa2baa7d754a97a516dab94a0aa79af5db6cb34bccf154`,
StartedAt `2026-10-26T20:44:49.856235867Z`. Los tres valores se comprobaron antes
y despu?s: sin reconstrucci?n ni reinicio. Caddy, Mongo y GenieACS intactos.

## Compilaci?n y preservaci?n

Fuente archivada desde Git exacto 233f230; SHA-256 del archivo fuente
`d0d9d0951f768bdda6f582b3041214e2c19d3564f27bf0a793ed1d9b685e90aa`. Compilaci?n Vite productiva aprobada
con URL y clave p?blica Supabase contrastadas contra los assets activos,
y configuraci?n de custodia preservada. No se copiaron credenciales backend.
Imagen basada en el runtime frontend A3 saliente: misma configuraci?n, entorno,
nginx y capas base. Los 124 archivos compilados coinciden en PC, VM e imagen.
Ocho marcadores A0?A3/devoluciones verificados. Solo cuatro archivos fuente de
interfaz de Asistencia difieren de 71944f5; otros m?dulos, stores, librer?as,
backend y migraciones conservados. Puntos y Devoluciones permanecen incluidos.

Pruebas visuales y compilaci?n local aprobadas reutilizadas desde
ASISTENCIA-PESTANAS-VISUAL-LOCAL.md, sin repetir suites cerradas ni auditor?as generales.
La aceptaci?n funcional A3 del propietario sigue vigente. No hubo SQL, cambios
de datos, operaciones OLT/MikroTik, ni fases nuevas.

## Compose y comprobaciones

Cadena efectiva completa, en este orden:

```text
/opt/smartrayco/docker-compose.onprem.yml
/opt/smartrayco-staging/fase175-counters-16831c6-20261026T162650Z/backend.override.json
/opt/smartrayco-staging/asistencia-a2-full-20261027T000500Z/frontend.override.json
/opt/smartrayco-staging/asistencia-a3-71944f5-20261027T034446Z/promotion/frontend.override.json
/opt/smartrayco-staging/asistencia-visual-233f230-20261027T133357Z/promotion/frontend.override.json
```

Comparaci?n completa de Compose: ?nicamente cambia services.frontend.image.
Override nuevo SHA-256 `58ce63ae6e65f34a645e09a0300d37743d2ae9f8f1d22e4b5567cecd99798e8b`; archivos previos
con hashes conservados. Activaci?n ejecutada ?nicamente con
`up -d --no-build --no-deps --pull never frontend`.

API /api/health, /, /asistencia y /campo: HTTP 200. Hash del index p?blico
id?ntico al compilado; entrada JS y JS/CSS AsistenciaView y AsistenciaPanel
publicados por HTTPS, HTTP 200 y hashes id?nticos al candidato.
Evidencia detallada: ASISTENCIA-VISUAL-RELEASE.json.

## Respaldo y rollback disponible, no ejecutado

Imagen anterior A3: `smartrayco-asistencia-a3:71944f5-20261027T041727Z`, digest `sha256:09b1c008bbdf391020cdc65f0380427fd365e2656117bd9894d49666a7f8a138`.
Respaldo VM: `/opt/smartrayco-staging/asistencia-visual-233f230-20261027T133357Z/recovery/frontend.tar`.
Copia PC: `.env.a3-recovery/frontend-a3-current.tar` (excluida de Git).
SHA-256 `c62725256b147aae6108b6d7827eafc6cb094ae267749d7063444e7a60444b72`; ?ndice OCI exacto y 17 blobs ?ntegros,
configuraci?n runtime/capas comparadas con la imagen activa al respaldar.

Para revertir solo la interfaz visual, conservar toda la cadena y volver a
aplicar AL FINAL el override A3 anterior (repetirlo al final es intencional):

```bash
cd /opt/smartrayco
docker compose -f /opt/smartrayco/docker-compose.onprem.yml -f /opt/smartrayco-staging/fase175-counters-16831c6-20261026T162650Z/backend.override.json -f /opt/smartrayco-staging/asistencia-a2-full-20261027T000500Z/frontend.override.json -f /opt/smartrayco-staging/asistencia-a3-71944f5-20261027T034446Z/promotion/frontend.override.json -f /opt/smartrayco-staging/asistencia-visual-233f230-20261027T133357Z/promotion/frontend.override.json -f /opt/smartrayco-staging/asistencia-a3-71944f5-20261027T034446Z/promotion/frontend.override.json up -d --no-build --no-deps --pull never frontend
```

Si la imagen anterior ya no est? disponible, cargar el tar verificado y
restablecer su etiqueta antes de ese comando:

```bash
docker load -i /opt/smartrayco-staging/asistencia-visual-233f230-20261027T133357Z/recovery/frontend.tar
docker tag sha256:09b1c008bbdf391020cdc65f0380427fd365e2656117bd9894d49666a7f8a138 smartrayco-asistencia-a3:71944f5-20261027T041727Z
```

Rollback conserva A3 y el override backend; no usar rollback SQL ni restaurar A2.
Comprobar API/assets e identidad backend despu?s de cualquier reversi?n.
No hubo rollback ni errores durante esta publicaci?n.
Directorio principal y cambios ajenos intactos; documentaci?n y push limitados
a feature/asistencia-a3-local, sin tocar main.
