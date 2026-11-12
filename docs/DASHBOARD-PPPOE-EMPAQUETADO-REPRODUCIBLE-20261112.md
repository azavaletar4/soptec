# PPPoE: empaquetado reproducible verificado

**LISTO PARA SOLICITAR NUEVA AUTORIZACIÓN DE PUBLICACIÓN. No desplegado.**
Trabajo exclusivamente local: no se abrió SSH, no se consultó MikroTik ni se
accedió a Supabase o a servicios de producción en esta tarea.

## Causa raíz demostrada

El TAR originalmente validado (`9a31e148…`) ya no está disponible: `prepare` lo
sobrescribió en el intento anterior. Se conserva su huella original, la definición
del paquete y el TAR regenerado (`ec1fdf08…`); no se altera esa evidencia.

Se reprodujo el procedimiento antiguo dos veces sobre el mismo snapshot:
`git archive` seguido de `tar.exe -rf`. Se modificó únicamente su fecha de acceso.
Los **317 archivos**, sus bytes, nombres, orden, permisos, uid/gid, mtime y
formato USTAR/PAX permanecieron iguales. La única diferencia de entradas fue
**PAX `atime` de `release-source.json`**. Los SHA-256 de los TAR fueron distintos.
Esto demuestra la falta de reproducibilidad por metadatos sin atribuir una
comparación binaria al original perdido.

## Corrección

El mismo `git archive` genera ahora todo el TAR, incluido el snapshot, mediante
`--add-file`. Se fija `--mtime` al timestamp del commit autorizado
(`1794506596`), `tar.umask=0022` y el modo del snapshot temporal a `0644`.
Git produce uid/gid `0`, propietario/grupo `root`, archivos `0644`, directorios
`0755` y orden estable. No incorpora `atime`, `ctime` ni `creationtime` de Windows.
Se conserva únicamente el PAX global estable con la referencia al commit.

`package` crea archivos con creación exclusiva. Si ya existe un manifiesto,
verifica todos sus hashes, contrato y candidato regenerado; **no reescribe el
paquete ni su manifiesto**. `prepare` exige un paquete previo, verifica sus bytes,
genera un candidato temporal y compara las huellas antes de transferir el archivo
original. Una divergencia detiene el proceso antes de SSH. Los validadores Python
de alcance, configuración, build, promoción y rollback permanecen intactos.

`prepare --local` permite probar esa fase sin abrir SSH ni crear staging remoto.
La preparación local de imágenes consume el `source.tar` validado, no un archivo
Git paralelo. Las imágenes de cada ejecución se conservan con etiquetas propias.

## Evidencia de reproducibilidad

Fuentes: **`b3cdef65c2830c2f44270568d7038b342b68b3e6`**, implementación `a4a5b41`.
Las dos ejecuciones completas conservadas están en el runtime privado
`scripts/inventory-auth-lab/runtime/pppoe-publication/repack-run1/` y `repack-run2/`.
Cada una ejecutó preparación local, build frontend canónico y repetición
`--no-cache`, build backend `--no-cache`, pruebas y validación de alcance.

| Artefacto | SHA-256 idéntico en ambas ejecuciones |
| --- | --- |
| `source.tar` | `1e5c90ffb5bd676ba0d00dd1731833ca0225ea18767418c6be43143b825c26b7` |
| `input.json` | `878a1219c80a93bddbfbbc0eeed4ac2c9c345c92bd1dcc63f6bb0e2c43400be5` |
| `package.json` | `17231abea8c6c8be81b12e465b024415840a83d77366f2441332ec52b7018f33` |
| TAR canónico del frontend construido | `5ff684b0ecda8fcc7eacf56bc2afd87c88906cca84bc505fcbc46cf406bc8907` |
| TAR canónico de fuentes del backend construido | `4034db4ceeb2c21d823da4cc956ea55b6053d05a48d87506bd5efa93c517db5f` |

Se comparan los archivos reales extraídos de las imágenes y las exportaciones TAR
de software con metadatos normalizados. Las imágenes OCI completas pueden tener
IDs distintos por fechas/provenance de BuildKit; no se afirma reproducibilidad
binaria de OCI. Los **2.555 archivos frontend y 380 backend** coinciden con los
árboles completos probados originalmente, cuyas huellas siguen siendo:

- Frontend: `f0485fb7e25a565cb916f43c65b35859ee7de721132862baa8b30c5c653b0fa1`.
- Backend: `1ae06259d11f39e83d2ff6b0985796ede35bc5bce8ade87fe4444ec3cdef04a8`.

El cambio de `input.json` frente al paquete antiguo se limita a `stage` y
`toolHash`, derivados del empaquetador corregido. Su resto, incluido el snapshot,
las fuentes backend y el alcance, se compara exactamente. Los 317 archivos del
nuevo TAR coinciden con los del TAR conservado del intento detenido.

## Pruebas

- **11 comprobaciones de empaquetado PASS**: reproducción del fallo antiguo,
  dos paquetes/prepares iguales pese a cambiar fechas y permisos, ausencia de
  metadatos variables, archivos validados sin reescritura y rechazo de TAR,
  input, snapshot o contrato alterados y de prepare sin paquete.
- **Dos preparaciones/builds completos PASS**, con comparación directa de ambas
  imágenes, sus árboles y TAR exportados. Se repitió adicionalmente la primera
  ejecución tras detectar que el laboratorio reutilizaba etiquetas Docker;
  se conservaron las referencias por ejecución antes de la comparación final.
- **16 pruebas backend PASS** en Node 22, importación/auth de Dashboard PASS,
  tipos productivos PASS; diagnósticos globales preexistentes iguales a la base.
- **34 pruebas del contrato de publicación y 7 pruebas AST PASS**.
- **16 verificaciones de navegador compilado PASS**, sin excepciones: cuatro
  perfiles, permisos, hora Perú, móvil, refresco, stale, errores y sin datos.
- **Transporte RouterOS real contra mock local PASS**, Docker sin red:
  exclusivamente GET, 25 peticiones comparten un lote, usuarios únicos y stale.
- **Verificador local final PASS**, incluidos hashes del paquete, respaldos y
  equivalencia del input con el original.

## Alcance y archivos

No se modificó ningún archivo de producto. Se conservan exactamente las tres
fuentes frontend y cuatro backend del paquete anterior (una compartida), las
reglas PPPoE, la exclusión de Morosos, los permisos y la caché RAM. `scope.json`,
`linker-proof.json`, `preparation.json`, `rollback.override.json` y la evidencia
del intento detenido permanecen iguales a los originales.

Herramientas modificadas:

- `scripts/frontend-consolidation-release.cjs`: TAR determinista, paquete
  inmutable y prepare local sin SSH.
- `scripts/prepare-pppoe-publication.mjs`: builds desde el paquete validado,
  carpetas independientes de evidencia y conservación de imágenes locales.
- `scripts/pppoe-publication-verify.cjs`: selección explícita de preparación
  revisada, comparación del input y verificación local claramente identificada.
- `scripts/tests/pppoe-publication-backend-compat.mjs`: selección de la nueva
  preparación para probar la imagen exacta construida.

Pruebas nuevas: `scripts/tests/pppoe-package-repro.mjs` y
`scripts/tests/pppoe-package-build-proof.mjs`. Evidencia nueva en
`deploy/pppoe-20261112/`: `tar-reproducibility.json`, `build-reproducibility.json`,
`preparation-reproducible.json` y `local-package-verification.json`.

## Respaldos, rollback y siguiente publicación

Los respaldos locales originales de frontend/backend se verificaron de nuevo
por SHA-256 y mediante restauración/extracción local. No se reemplazaron. Los
respaldos y rollback del staging detenido se conservan sin intervención remota.
No se realizaron limpiezas ni se reutilizará aquel staging.

El paquete revisado está en el runtime privado:
`scripts/inventory-auth-lab/runtime/consolidation-release/frontend-consolidado-tr069-b3cdef6-f00edbfc18/`.
Su referencia revisable es **`deploy/pppoe-20261112/preparation-reproducible.json`**;
la preparación anterior se conserva como evidencia histórica.

Tras una **nueva autorización expresa**, usar el mismo scope y snapshot, comprobar
de nuevo la producción actual y ejecutar el procedimiento preparado:

1. Lectura de estado actual y `pppoe-publication-verify.cjs --preparation
   deploy/pppoe-20261112/preparation-reproducible.json` **sin `--local`**.
   Cualquier diferencia de base detiene el intento.
2. `frontend-consolidation-release.cjs prepare`, después `build`, siempre con
   `--scope deploy/pppoe-20261112/scope.json --snapshot
   scripts/inventory-auth-lab/runtime/pppoe-publication/release-source.json`.
   Se creará un staging nuevo `…b3cdef6-f00edbfc18`; no reutilizar el anterior.
3. Es obligatorio verificar el build remoto mediante
   `pppoe-publication-verify.cjs --built --preparation
   deploy/pppoe-20261112/preparation-reproducible.json`: exige los mismos árboles
   completos que las pruebas locales. Solo entonces promover backend/frontend.
4. Verificar salud, auth, navegación y contadores reales del CCR2116. Ante un
   fallo crítico, detener y evaluar el rollback protegido del nuevo staging.

`--local` no certifica la base productiva ni sustituye el control remoto previo
a promoción. Esta tarea no ha consultado su estado actual y no ha ejecutado
prepare/build remotos. Cero despliegues, migraciones, escrituras Supabase,
solicitudes o cambios MikroTik, registros históricos PPPoE o cambios de tráfico.
