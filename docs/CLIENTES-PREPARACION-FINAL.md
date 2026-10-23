# Clientes — preparación final, sin despliegue

Estado: **PREPARADO PARA REVISIÓN; NO DESPLEGADO**. Continuación de `e3c95aa`, conservado sin amend. Los cinco archivos adicionales de la aclaración de Prospectos pertenecen exclusivamente a Clientes: contador, clasificador, pruebas y documentación. Los cambios ajenos de Campo, soporte, router, inventario y otros documentos no se incluyen en el commit ni en el artefacto.

## Totales reales de Supabase

Lectura del **23/10/2026, 11:29:25 Lima / 16:29:25 UTC**, en una transacción `REPEATABLE READ READ ONLY`, con rollback final. Sin DDL, INSERT, UPDATE, DELETE ni pruebas de escritura. La evidencia publicada sólo contiene agregados y metadatos: [CLIENTES-PREFLIGHT.json](CLIENTES-PREFLIGHT.json).

| Concepto | Total |
| --- | ---: |
| Fichas registradas | 698 |
| Abonados vigentes, excluyendo retirados y fichas sin servicio | **697** |
| Titulares con algún contrato activo | 680 |
| Titulares suspendidos | 17 |
| Retirados definitivos | **1** |
| Titulares con múltiples servicios | 15 |
| Altas abiertas | 0 |
| Fichas `clients.status = prospect` | 3 |
| Fichas prospecto sin servicio | 0 |
| Prospectos comerciales, tabla separada | 3 |
| De ellos, convertidos / en negociación | 2 / 1 |
| Seguimientos comerciales | 1 |

Los 3 registros `clients.status = prospect` ya tienen servicios que justifican contarlos según el clasificador, sin cambiar su estado almacenado. No son los 3 registros comerciales de `prospects`. El dashboard clasifica 680 activos, 17 suspendidos, 0 pendientes/prospectos sin servicio vigente y 1 retirado. El único retirado se excluye del contador principal. Los 15 titulares con múltiples servicios conservan al menos un contrato activo y permanecen vigentes. No hay actualmente un titular con contrato activo y otro cancelado: ese caso queda verificado con datos sintéticos, sin crear uno real.

Se contrastaron las filas mínimas de ciclo de vida leídas de Supabase con las funciones reales del frontend: mismos 697 abonados y 1 retirado. No se publican nombres, documentos ni IDs de clientes.

## RLS y Prospectos

- PASS: RLS habilitada en `clients`, `service_contracts`, `installations`, `prospects`, `prospect_followups`.
- PASS: con claims locales de un actor ADMIN y otro SUPERADMIN se leen 698 fichas, 716 contratos, 41 instalaciones, 3 prospectos y 1 seguimiento; ambos ven los 15 titulares con varios servicios activos.
- PASS: TECNICO_RED no puede leer prospectos ni seguimientos; anónimo lee cero fichas, prospectos y seguimientos.
- LIMITACIÓN: no existen actores activos SOPORTE/FACTURACION. Sus políticas desplegadas y sus permisos de interfaz se revisaron; no se simula una identidad real inexistente ni se afirma una prueba RLS con esos actores.
- RIESGO PREEXISTENTE: producción conserva `clients_staff_only FOR ALL`, incluyendo TECNICO_RED. Es más amplia que las policies separadas de la migración fase 2b del repositorio. No se corrige en esta fase ni se modifica RLS. Reincorporar sigue siendo únicamente un diálogo sin backend operativo; requiere autorización de backend específica antes de incorporar cualquier escritura.
- PASS: código y store de Prospectos intactos. Su botón original sigue junto a «+ Nuevo cliente», tanto en vigentes como en retirados. Registro, búsqueda, filtros, seguimiento, cancelación y conversión se ejercitan en navegador con espías en memoria: conserva plan, zona, tarifa y relaciones, y marca convertido después de cliente + contrato + instalación. Cero escrituras HTTP. No se certifica persistencia mediante escritura en producción.

## Pruebas focalizadas

| Verificación | Resultado |
| --- | --- |
| Dominio/paginación y comparación del snapshot SQL con el frontend | PASS: 10 pruebas |
| Prospectos sobre fuente aislada compatible con producción | PASS: `clientes-lifecycle-browser.mjs --prospects --source=...` |
| Vigentes/retirados, filtros, búsqueda, duplicados, Reincorporar sin escritura y dashboard sobre la misma fuente | PASS: `clientes-lifecycle-browser.mjs --source=...` |
| Compilación necesaria para el artefacto aislado, TypeScript + Vite | PASS |
| Identidad de imagen OCI y SHA-256 de respaldos PC/VM | PASS |
| Comprobación de rollback, sin ejecutar sus comandos | PASS |
| Imagen/117 archivos servidos y contenedores frontend, backend, Caddy, Mongo y GenieACS iguales tras la preparación | PASS |

No se ejecutaron auditorías generales, pruebas operativas de OLT/MikroTik ni generación de facturas.

## Artefacto y respaldo

Producción utiliza base Git `c01b3ee29b7956925cf9face2ae718b88a038a05` e imagen frontend `sha256:314269b263dcfa8987f95caf9b458e4792efc187e8aa9dc1594793c1a2a6ca2c`. Sus 117 archivos servidos coinciden con la entrega ya desplegada de devoluciones. La base de producción incluye tres archivos de esa entrega sobrepuestos al commit del servidor; se conservaron exactamente. No se incluyeron los otros cambios locales de este workspace.

Se reconstruyó un árbol aislado desde esa base más los tres archivos ya desplegados y los **seis archivos de frontend de Clientes** declarados en [CLIENTES-ARTEFACTO.json](CLIENTES-ARTEFACTO.json). Los 994 archivos de base se contrastaron: fuera de las sobreescrituras declaradas no hay diferencias. `package-lock.json` conserva el mismo contenido semántico (sólo difieren finales de línea PC/Git). Las tres variables públicas VITE de producción, incluida `VITE_MATERIAL_CUSTODY_LIVE_SINCE`, se mantienen; sus valores se guardan sólo en contexto privado. Sin cambios de servidor, dependencias, nginx ni base de datos.

- Archivo PC: `scripts/inventory-auth-lab/runtime/clientes-release-SvNuLF/frontend-dist.tar.gz`.
- SHA-256: `e3b07dba31b7f5b4796e0157e93fa3e903b88d63e3f4d50fe6d1674351d833b2`.
- Staging VM: `/opt/smartrayco-staging/clientes-20261023T163256Z`.
- Respaldo PC: `scripts/inventory-auth-lab/runtime/clientes-backup-clientes-20261023T163256Z`.
- Respaldo VM: subdirectorio `backup` del staging anterior.
- Siete archivos de respaldo verificados: imagen exacta, HTML actual, nginx, estado previo, override de rollback y los dos archivos Compose efectivos. Cuatro archivos de preparación adicionales verificados: artefacto, manifiesto y dos verificadores de rollback.
- [CLIENTES-RESPALDO.json](CLIENTES-RESPALDO.json) conserva rutas, hashes y comandos de rollback ya preparados. La comprobación OCI recorre y valida todos los blobs referenciados; no carga ni ejecuta la imagen.

El respaldo cubre el frontend que cambiaría esta entrega. No se genera ni restaura un dump nuevo de base de datos: no hay cambios SQL ni de datos que revertir. Las copias en staging son las únicas escrituras efectuadas en la VM; no modifican `/opt/smartrayco`, imágenes activas ni contenedores.

## Procedimiento de despliegue pendiente de aprobación

1. Revalidar identidad actual `314269...`, base `c01b3ee...`, archivos Compose efectivos y SHA-256 de candidato/respaldo. Detener si producción ha cambiado desde este preflight. Conservar los contenedores protegidos y sus tiempos de inicio del manifiesto previo. Volver a leer los totales si ha pasado tiempo: pueden cambiar por trabajo legítimo de operadores.
2. Preparar, sin cambiar contenedores, una imagen frontend a partir de la imagen exacta respaldada, reemplazando únicamente `/usr/share/nginx/html` con el tar candidato. Conservar las capas de runtime y nginx. Usar un tag exclusivo para Clientes, verificar los hashes de todos los archivos resultantes y registrar el ID final en un nuevo `image-ready.json` y override frontend. **Esta imagen candidata y el override de activación todavía no se crean en esta preparación.** El artefacto entregado es el frontend estático compatible, no una imagen activada.
3. Sólo después de aprobación, usar los dos archivos Compose efectivos del manifiesto previo, más el nuevo override de Clientes. La activación debe limitarse a `up -d --no-deps --no-build --pull never frontend`. No hacer checkout/pull del workspace local completo ni ejecutar migraciones ni tocar backend, OLT, MikroTik, facturación o equipos.
4. Verificar HTTP y hashes de assets servidos, accesos a Clientes/Prospectos, contador y búsqueda sin guardar. Confirmar invariancia de backend/Caddy/Mongo/GenieACS. Reincorporar sólo abre preparación; no ejecutar operaciones desde la ficha.
5. Si falla, aplicar el rollback preparado debajo. Registrar resultado y detener cambios adicionales.

## Rollback preparado, no ejecutado

Comprobar en VM, sin efectos operativos:

```sh
python3 /opt/smartrayco-staging/clientes-20261023T163256Z/rollback-check.py /opt/smartrayco-staging/clientes-20261023T163256Z
```

Resultado ya obtenido: `PASS`, hashes correctos e identidad exacta. El script sólo comprueba y emite comandos; nunca los ejecuta. Para restaurar, **únicamente con autorización**, los comandos emitidos son:

```sh
docker load -i /opt/smartrayco-staging/clientes-20261023T163256Z/backup/frontend.image.tar
docker compose -f /opt/smartrayco/docker-compose.onprem.yml -f /opt/smartrayco-staging/custody-returns-20261022T171559Z/deploy.override.json -f /opt/smartrayco-staging/clientes-20261023T163256Z/backup/rollback.override.json up -d --no-deps --no-build --pull never frontend
```

Después comprobar imagen `314269...`, HTML/nginx previos y servicios protegidos iguales. No hay rollback SQL. La restauración real no se ensayó porque recrearía el frontend de producción.

## Archivos de esta continuación

Los cinco archivos previamente pendientes: `src/lib/clientLifecycle.ts`, `src/views/clientes/ClientesView.vue`, `src/lib/__tests__/clientLifecycle.test.ts`, `scripts/tests/clientes-lifecycle-browser.mjs`, `docs/CLIENTES-VIGENTES-RETIRADOS.md`.

Preparación agregada: `scripts/clientes-cloud-readonly.ps1`, `scripts/clientes-release.mjs`, `scripts/tests/clientes-preflight-readonly.sql`, `scripts/tests/clientes-production-classification.test.ts`, `scripts/tests/clientes-release-vm.py`, `scripts/tests/clientes-image-verify.py`, `scripts/tests/clientes-rollback-check.py`, este documento y los tres manifiestos JSON citados. Credenciales, snapshots privados, respaldos binarios, código temporal y builds no se versionan.

El commit final local es hijo de `e3c95aa`; consultar `git log -1` para su hash, sin autorreferencia en el documento. Sin push ni despliegue. Antes de autorizar, considerar: datos paginados no transaccionales en el navegador, políticas preexistentes amplias, ausencia de actores SOPORTE/FACTURACION, y que la conversión se verificó con espías, no con persistencia real. La reincorporación operativa permanece detenida.
