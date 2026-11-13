# Dashboard V2 — publicación preparada

**LISTO para solicitar autorización final. NO desplegado.**

Paquete local: `deploy/dashboard-v2-20261112/`.
[Procedimiento exacto, hashes, aplicación y rollback](../deploy/dashboard-v2-20261112/README.md).

## Fuente aislada

Rama `release/dashboard-v2-20261112`, commit
`1d9dd40461d84262d2dfa15ae006177121c1cc97`, sobre la fuente actualmente publicada
`b3cdef65c2830c2f44270568d7038b342b68b3e6`. Contiene únicamente los cuatro archivos
de producto de `80e8e7e` + `f9a2845`, con bytes idénticos al diseño final aprobado:

- `src/views/DashboardView.vue`.
- `src/components/dashboard/PppoeProfileCards.vue`.
- `src/components/dashboard/DashboardIcon.vue`.
- `src/components/dashboard/dashboard-v2.css`.

No se tomaron fuentes pendientes del checkout principal. Los cambios locales
ajenos y los paquetes previos se conservan. El commit de preparación agrega
solo procedimiento, herramientas locales de validación y evidencia; no cambia
código de producto respecto de `f9a2845`.

## Compatibilidad y alcance

**Solo frontend. No se necesita backend, Supabase ni MikroTik.** Se compararon
en producción los hashes de las rutas/servicios PPPoE y su contrato, así como
el lockfile. Coinciden con la base desplegada. El controlador PPPoE mantiene
permisos, caché RAM de 60 s, polling, cancelación y estados stale/error/sin datos.

El store general y las consultas a clientes, contratos, tickets y facturas
permanecen intactos. PPPoE, ONT y Equipos usan los tres endpoints actuales. Las
fechas de lectura y consulta mantienen sus significados; el timestamp que no
proporciona Equipos sigue indicado como no disponible. No se incluyeron fixtures
del Dashboard en código ni bundles productivos.

La generación de CSS y la extracción por Rollup de un helper de Vue causan
cambios de nombres/imports en bundles compartidos. Se verificaron mediante AST:
la función antes incluida en Asistencia es equivalente, el entrypoint conserva
su lógica y 119 módulos están protegidos frente a cambios funcionales. Las
precargas nuevas se resuelven a sus destinos concretos, sin alterar artefactos
para aprobar el control. El comparador local corrigió un falso positivo al
tratar bindings de array como si tuvieran claves de objeto; nueve pruebas
incluyen rechazos de cambios de lógica e intercambio de key/value.

## Reproducibilidad e integridad

| Artefacto | SHA-256 |
| --- | --- |
| Manifiesto del paquete | `0b790f14b694571f21a5c5c6d2f32661d3e09d57ab3f5c43b846bc2db9765787` |
| TAR Git de fuentes | `c7b4dc966cd66d7ac6b6d3fe40d76feb68a50fbc5b4e87f21657318cadc4d443` |
| TAR canónico del sitio | `8b3c24e8065689f77611d777177ed08c43657d83b06bbeb266bc9239694da754` |

Dos builds Linux sin caché ni red producen los mismos TAR y los mismos 2652
archivos, incluidos los assets anteriores conservados. El TAR fuente contiene
319 archivos: 318 entradas de fuentes firmadas y el snapshot. Metadatos Git
normalizados, sin atime/ctime; uid/gid 0, modos 644/755. La verificación del
paquete sellado se repitió dos veces sin regenerar ni sobrescribir archivos.

Los IDs OCI de las dos imágenes **no son idénticos**: difieren las fechas de
creación y 131 mtimes de archivos; contenido, modos, propietarios y configuración
coinciden. La reproducibilidad demostrada corresponde a fuentes y contenido
publicado, no a las attestations/metadatos binarios del contenedor. Se congeló
la imagen candidata exacta, con hash independiente de su GZ y toda la cadena
OCI verificada. No se reconstruirá después de la autorización.

Imagen candidata:
`sha256:3fc2672ff84c7c77097aa45f4d2da242794fd1ef0320a799680166f5e4e1d7e1`.
Archivo: `frontend-candidate.image.tar.gz`, SHA-256
`b80df4ec443f51fac2e711ee9730316f85c4f7c2779baeb39b8b4e64da05b1e8`.

Los binarios TAR/GZ se conservan localmente y no se versionan en Git. El paquete
completo requiere esos archivos además de los manifiestos versionados.

## Pruebas

- Compilación aislada: tipos Vue correctos y dos builds Vite Linux en Node
  `v22.23.4`, con las dependencias existentes verificadas por lockfile.
- Navegador contra los artefactos exactos: **32 PASS V2 + 16 PASS PPPoE**;
  escritorio, tablet y móvil, 17 anchos, errores/stale, permisos y navegación.
- Contratos: **PASS**, stores/layout/API/backend intactos y lógica aprobada
  conservada; script de lectura PPPoE idéntico.
- Comparador AST: **9 PASS**, incluidos casos negativos.
- Protección del paquete: **6 PASS**, corrupción, digest externo, scope backend,
  directorio de ejecución, metadatos y ausencia de regeneración.
- Nginx real local: configuración y siete rutas correctas, sin red ni backend.
  Su upstream se resolvió únicamente a loopback en el contenedor de laboratorio;
  no se cambió el archivo de configuración.
- Respaldos/imágenes: blobs y descriptores OCI comprobados; configuración de
  ejecución y Nginx conservados. Cero fixtures de navegador en artefactos activos.

Los tests usan respuestas simuladas fuera del producto; las solicitudes externas
y las escrituras están bloqueadas. Las capturas de ese build quedan en el
runtime local de preparación; siguen vigentes las capturas aprobadas de
`docs/dashboard-v2-final-local/`.

## Respaldo y rollback

Imagen frontend actual:
`sha256:b3a851fb925aa77feab2db9d16be92db50e3309810f42bb671fba96cf3be0b50`.
Respaldo completo `deploy/dashboard-v2-20261112/frontend-before.image.tar.gz`,
70.543.690 bytes; SHA-256
`e6a1a0bb038d4b00879d763c6bd4771878174715a0f08048d471631e6f1cd497`.

Se obtuvo por `docker save` hacia stdout SSH; sin archivos ni tags remotos.
Se cargó y verificó en Docker local. `rollback.override.json` y `publish.py`
restauran únicamente frontend, verificando imagen, archivos, entorno, Nginx,
rutas y salud. No se ejecutó rollback en producción ni se prepararon cambios
de backend. Los respaldos de fases previas siguen disponibles.

El backend seguirá usando:
`sha256:165126136e3178840e6443094b42993a73a43b79a4b3aa6149f17a3730e2fe16`.

## Estado de producción y límites

Reconfirmación final: **12/11/2026 19:19:27 Perú**. Los cinco servicios,
contenedores, imágenes, entornos, configuración y archivos siguen intactos.
Salud `ok`; PPPoE sin sesión devuelve 401. Cero escrituras remotas, solicitudes
a Supabase o MikroTik en la preparación. Sin SQL, migraciones, tablas, muestras,
históricos, cron jobs ni cambios de retención. El almacenamiento de Supabase
no aumenta.

No se ejecutaron staging, SCP, build remoto, promoción de servicios ni cambios
en producción. Las comprobaciones autenticadas de operación corresponden al
procedimiento posterior al despliegue autorizado; aún están pendientes por
definición. El preflight futuro detiene cualquier drift y no ajusta hashes para
aceptarlo. El rollback requiere evaluación y ejecución expresa; no es automático.

**LISTO para autorización de publicación exclusiva de frontend con este paquete
congelado. Se detiene el trabajo al finalizar la preparación.**
