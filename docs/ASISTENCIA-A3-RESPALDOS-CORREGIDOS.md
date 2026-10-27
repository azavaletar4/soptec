# A3 — bloqueo de respaldo corregido, APTO para retomar activación

## Estado vigente: respaldos verificados; A3 todavía NO activada

**APTO para retomar la activación controlada.** Se identificó y corrigió el
verificador, se acreditó la recuperación real de la imagen y del respaldo SQL,
y se conservaron frontend, backend y overrides. No se aplicó la migración A3
ni se construyó/promovió frontend. Esta actualización sustituye el bloqueo del
respaldo descrito en `ASISTENCIA-A3-ACTIVACION-DETENIDA.md`, conservado como
antecedente. No constituye autorización ni ejecución de la activación pendiente.

## Causa raíz demostrada

El Docker Engine productivo 29.8.1 utiliza el digest de un **índice OCI** como
ID de esta imagen. `container.Image`, `docker image inspect.Id`, RepoDigests y
`Descriptor.digest` coinciden en:
`sha256:afb272698444096271026ff940615a8d66fa1d367b094f1182861a99e9f4418e`.
El tar `index.json` referencia exactamente ese índice. Su configuración interna
es otro objeto, digest `37c1b8efbfa476f44fe047bf5c044fecb3a78d61e7ed7954f5afc5dd155c6c1a`.
El verificador anterior comparaba configuración con índice, provocando un falso
`ARCHIVE_IMAGE_MISMATCH`; el respaldo no correspondía a otra imagen.

Se corrigió el ejecutor local para usar `asistencia-a3-archive-verify.py`:
identidad del índice exportado, tamaño y SHA-256 de cada descriptor, índices
anidados, manifests, configuración y capas, incluidas attestations. Además se
comparan configuración y diff_ids con la imagen viva. No se retiró ninguna
protección para aceptar contenido incorrecto. Cinco casos del verificador
prueban aceptación válida y rechazo de digest de otra imagen, capa alterada,
tamaño inválido y configuración distinta. No se repitieron suites funcionales.

## Respaldo de imagen correcto y recuperable

Se conserva el tar original, ahora acreditado, sin regenerarlo innecesariamente:
`/opt/smartrayco-staging/asistencia-a3-71944f5-20261027T034446Z/recovery/frontend.tar`.
SHA-256: `da12ddbb50b4889e4a7ffe48138ff29709592628f1637f640c5ebfe9b321a53e`.
Tag recuperable:
`smartrayco-asistencia-a3-rollback:asistencia-a3-71944f5-20261027T034446Z`.

Los 16 blobs OCI verifican integridad y el índice coincide con la imagen activa.
Copiado al PC en `.env.a3-recovery/frontend.tar`, mismo SHA-256. Cargado realmente
en Docker LOCAL y recuperado el ID inmutable exacto `afb27269…`. Se creó un
contenedor local sin red y sin arrancarlo; sus 124 archivos de frontend coinciden
por ruta y SHA-256 con los del frontend vivo. Ese contenedor temporal fue retirado;
no se inició ningún servicio. Los tres archivos de Compose/overrides también
quedaron respaldados en VM y PC, con hashes coincidentes.

## Respaldo SQL específico, restaurado y verificado

Lectura productiva con `default_transaction_read_only=on`, TLS verify-full,
proyecto exacto `mzupdnjegfwmpajywckd`. Solo ocho tablas de Asistencia/configuración
con pg_dump custom; definiciones/ACL de 15 funciones, políticas, triggers y
dependencias mínimas de restauración capturadas aparte. Las credenciales no se
guardan en los respaldos. Los datos y perfiles de dependencia son privados,
excluidos de Git dentro de `.env.a3-recovery/`; la copia VM tiene permisos 0600
dentro del directorio privado de recuperación. No publicar dump ni snapshot.

- `asistencia-before.dump`: 52.953 bytes, SHA-256
  `eed0f35d1eed42fc6d03d8f93a050bc2ebee9e9298f9e8da4d0f94b831e5aaa8`.
- `functions-before.sql`: SHA-256
  `b5cdda7de02f39a34eccde71504a5d5210c269acb906e7c6279d645bb2a9496c`.
- También preservados `sql-before-private.json` y `asistencia-a3-rollback.sql`.
  Los cuatro archivos tienen copia en el mismo `recovery/` de la VM, verificada
  por SHA-256 contra el PC.

Restauración REAL en PostgreSQL 17 efímero LOCAL con `--network none`:
pre-data, definiciones/ACL, data, post-data. Coinciden conteos y hashes de las ocho
tablas (incluidas 113 marcaciones y los dos horarios), cuerpos de 15 funciones,
nueve triggers y 13 políticas RLS. A3 sigue ausente. El contenedor efímero fue
retirado. Se corrigieron dos detalles del empaquetado/verificación SQL local:
separadores `;` entre definiciones y comparación de conjuntos por nombre, pues
la colación local ordena `_` distinto de Cloud; todos los hashes individuales
se conservaron y comprobaron, sin omitir tablas ni filas.

## Estado productivo y límites

Frontend A2-full `7ed8dcd`: contenedor `5ed0853222f375a388ef8410843ca024445ef3015b345ccc137fd6e007fa2286`,
StartedAt `2026-10-27T02:44:18.038826098Z`.
Backend `16831c6`: contenedor `cd577bcaa95cab290bfa2baa7d754a97a516dab94a0aa79af5db6cb34bccf154`,
StartedAt `2026-10-26T20:44:49.856235867Z`, imagen
`sha256:6631d4a124b631f7bedd3d8c2b6f6c8ab7e524e264385ae2fae2b46e3f67047e`.
Ambos mantienen ID, imagen y arranque; hashes de overrides originales intactos.

Pendiente: revalidar drift y frescura del respaldo antes de aplicar exclusivamente
A3 y promover solo frontend `71944f5`, siguiendo el procedimiento selectivo.
Los respaldos son de un momento concreto: no deben sobrescribir marcaciones
legítimas posteriores. El rollback automático A3 sigue bloqueado si existe
cualquier intercambio, incluso cancelado; en ese caso se prepara recuperación
específica, sin eliminar registros. Validación funcional real A3 pendiente.

Evidencia pública sin filas privadas: `ASISTENCIA-A3-BACKUP-DIAGNOSIS.json`,
`ASISTENCIA-A3-IMAGE-BACKUP-VERIFIED.json`, `ASISTENCIA-A3-SQL-BACKUP-VERIFIED.json`
y `ASISTENCIA-A3-BACKUPS-FINAL-CHECK.json`. Sin push ni nuevo despliegue en esta
corrección. Directorio principal y cambios ajenos intactos.
