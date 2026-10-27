# A3 — frontend desplegado selectivamente

## Estado vigente: A3 migrada, desplegada y verificada técnicamente

Frontend A3 `71944f5` promovido el **27/10/2026 05:21:22 UTC (00:21 Perú)**.
Imagen activa `smartrayco-asistencia-a3:71944f5-20261027T041727Z`.
La migración A3 ya aplicada quedó conservada: **no se volvió a ejecutar**.
API, panel, Asistencia, Campo y assets publicados comprobados. Backend `16831c6`
conservado con el mismo contenedor, imagen, StartedAt y override.
**Pendiente validación funcional real A3; no declararla cerrada funcionalmente.**
Este estado prevalece sobre las notas anteriores de activación detenida o
frontend pendiente, conservadas como antecedentes. A0/A1 sigue cerrada y validada;
A2/A2.1 cerradas administrativamente con su seguimiento operativo pendiente.

## Preparación y promoción

- Inicio desde `6fb6a5b`, rama `feature/asistencia-a3-local`, limpia. Código de
  aplicación y migración idénticos a `71944f5`. Solo cinco archivos de Asistencia
  difieren respecto a la base frontend productiva `7ed8dcd`, incluida su prueba.
- Verificador corregido reconoce las siete definiciones A3/ingreso; los siete
  cuerpos coinciden con los leídos de producción. Sin migraciones ni cambios SQL.
- Respaldo saliente A2-full íntegro: índice exacto `afb27269…`, 16 blobs OCI
  verificados, SHA-256 del tar
  `da12ddbb50b4889e4a7ffe48138ff29709592628f1637f640c5ebfe9b321a53e`.
  La recuperación PC ya acreditada se conserva, sin repetirla.
- Compilación de producción desde archivo Git exacto `71944f5` en directorio
  privado aislado. URL/clave pública Supabase contrastadas con el frontend
  saliente y configuración de custodia preservada. No se reutilizó un build
  sin configuración productiva ni se copiaron credenciales del backend.
- Runtime construido sobre la imagen frontend saliente, sin modificar nginx,
  entorno ni dependencias. Los 123 archivos compilados coinciden en PC, VM e
  imagen candidata. Ocho marcadores de funciones A0–A3/devoluciones presentes.
  No se repitieron suites funcionales cerradas ni pruebas completas.
- Antes de promover: configuración de imagen y capas base preservadas; entorno
  runtime idéntico; comparación completa de Compose demuestra que solo cambia
  `services.frontend.image`. Se conservan ambos overrides anteriores y se añade
  exclusivamente el nuevo override frontend A3.
- Promoción ejecutada con la cadena siguiente y
  `up -d --no-build --no-deps --pull never frontend`; sin despliegue completo.

```text
/opt/smartrayco/docker-compose.onprem.yml
/opt/smartrayco-staging/fase175-counters-16831c6-20261026T162650Z/backend.override.json
/opt/smartrayco-staging/asistencia-a2-full-20261027T000500Z/frontend.override.json
/opt/smartrayco-staging/asistencia-a3-71944f5-20261027T034446Z/promotion/frontend.override.json
```

Hash del override nuevo:
`0b9ddcc0dffefb51b61d1c4aa5b32cc8c41cd773da967162bc9e7a6f187d99d0`.
Los hashes de los tres archivos previos permanecen intactos. Mantener la cadena
COMPLETA para operaciones posteriores; no usar la cadena antigua de etiquetas
del backend que referencia frontend A0/A1.

## Versiones productivas e identidad

Frontend: `smartrayco-asistencia-a3:71944f5-20261027T041727Z`, imagen
`sha256:09b1c008bbdf391020cdc65f0380427fd365e2656117bd9894d49666a7f8a138`;
contenedor `7a89a04412d171894dfcdbf4d49cff1753b43420a539299db6c051982f3f30f5`;
StartedAt `2026-10-27T05:21:22.676231739Z`.

Backend: `smartrayco-backend-counters:16831c6-20261026T162650Z`, imagen
`sha256:6631d4a124b631f7bedd3d8c2b6f6c8ab7e524e264385ae2fae2b46e3f67047e`;
contenedor `cd577bcaa95cab290bfa2baa7d754a97a516dab94a0aa79af5db6cb34bccf154`;
StartedAt `2026-10-26T20:44:49.856235867Z`. Identidad exacta antes y después.
Caddy, Mongo y GenieACS también conservan ID, imagen y StartedAt.

## Comprobaciones posteriores y límites

GET de `/api/health`, `/`, `/asistencia`, `/campo`: HTTP 200. Hash del index
publicado idéntico al compilado. Assets nuevos AsistenciaPanel, AsistenciaView
y entrada principal servidos por HTTPS, HTTP 200 y SHA-256 idéntico al candidato.

Lectura SQL posterior: tabla A3 con RLS y una política de lectura, sin escritura
directa authenticated ni SELECT anon; siete RPC examinadas abiertas authenticated
y cerradas anon, SECURITY DEFINER/search_path=public. Guardas de autorización ya
contrastadas por cuerpo SQL exacto. Sin marcaciones ni intercambios ficticios.
Alhely Lozano conserva sábado 08:00–13:30 y Angie Laguna 13:30–19:00.
Cero intercambios observados al verificar; ese conteo no es una prueba funcional.

Pendiente: uso real de SUPERADMIN para programar la pareja, consulta personal web/
Campo, marcación legítima del domingo compensatorio y revisión del lunes libre
en tablero/reporte. Las pruebas locales aprobadas se conservan como evidencia
separada; no reemplazan esa aceptación real del propietario.

Respaldo y rollback: `recovery/frontend.tar` y tag
`smartrayco-asistencia-a3-rollback:asistencia-a3-71944f5-20261027T034446Z`
restauran A2-full, conservando SIEMPRE override backend. No ejecutar reversión
genérica si existen intercambios, incluso cancelados: el frontend anterior los
ignoraría y el rollback SQL está diseñado para detenerse; preparar recuperación
específica sin borrar datos. No se ejecutó rollback en este despliegue.

Evidencia: `ASISTENCIA-A3-RELEASE.json` y `ASISTENCIA-A3-DEPLOYED-CHECKS.json`.
Datos/credenciales y fuente privada de compilación excluidos de Git. Directorio
principal y cambios ajenos intactos; sin operaciones OLT/MikroTik ni cambios
funcionales en otros módulos.
