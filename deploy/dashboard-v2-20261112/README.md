# Publicación aislada Dashboard V2 — preparación

**LISTO para solicitar autorización. No desplegado.**

## Identidad y alcance

- Base publicada: `b3cdef65c2830c2f44270568d7038b342b68b3e6`.
- Aprobación visual: `80e8e7e` + `f9a2845`.
- Rama aislada: `release/dashboard-v2-20261112`.
- Fuente única: `1d9dd40461d84262d2dfa15ae006177121c1cc97`, hijo directo de la base.
- Servicio autorizado para una futura publicación: **solo `frontend`**.
- Cuatro diferencias de producto, idénticas a `f9a2845`:
  `src/views/DashboardView.vue`, `src/components/dashboard/PppoeProfileCards.vue`,
  `src/components/dashboard/DashboardIcon.vue` y `src/components/dashboard/dashboard-v2.css`.
- `backendSources: []`. Sin SQL, cambios de permisos, autenticación, rutas o API.

## Archivos y hashes sellados

`package.json` declara 14 archivos operativos; `SHA256SUMS` los identifica junto
con el propio manifiesto. Los TAR/GZ están presentes en esta carpeta local y se
excluyen de Git por tamaño. **Un checkout de Git sin esos archivos no constituye
el paquete completo.** Conservarlos y transferir los 16 archivos indicados abajo.

| Archivo | SHA-256 |
| --- | --- |
| `package.json` | `0b790f14b694571f21a5c5c6d2f32661d3e09d57ab3f5c43b846bc2db9765787` |
| `source.tar` | `c7b4dc966cd66d7ac6b6d3fe40d76feb68a50fbc5b4e87f21657318cadc4d443` |
| `frontend-artifacts.tar` | `8b3c24e8065689f77611d777177ed08c43657d83b06bbeb266bc9239694da754` |
| `frontend-candidate.image.tar.gz` | `b80df4ec443f51fac2e711ee9730316f85c4f7c2779baeb39b8b4e64da05b1e8` |
| `frontend-before.image.tar.gz` | `e6a1a0bb038d4b00879d763c6bd4771878174715a0f08048d471631e6f1cd497` |

Imagen actual / rollback:
`sha256:b3a851fb925aa77feab2db9d16be92db50e3309810f42bb671fba96cf3be0b50`.

Imagen candidata congelada:
`sha256:3fc2672ff84c7c77097aa45f4d2da242794fd1ef0320a799680166f5e4e1d7e1`.

Tag candidato: `smartrayco-dashboard-v2:1d9dd40461d8`.
Tag de rollback previsto: `smartrayco-dashboard-v2-rollback:b3a851fb925a`.
El tag de rollback aún no se creó en producción.

**Reproducibilidad demostrada:** dos compilaciones Linux independientes, sin
caché de build ni red, producen el mismo TAR Git de 319 archivos (318 fuentes
firmadas más snapshot), el mismo TAR del sitio y los mismos bytes de sus 2652
archivos. Se conservan los assets de software anteriores para los navegadores
que aún los referencian; no son históricos operativos ni datos Supabase.

No se afirma que ambos contenedores sean binariamente idénticos: difieren en su
fecha de creación y en 131 `mtime`, sin diferencias de contenido, permisos,
propietario o configuración de ejecución. Está documentado en
`image-metadata-differences.json`. Se publica la imagen candidata ya congelada;
**no se reconstruye ni regenera el paquete tras la autorización**. Su archivo
GZ y la raíz OCI completa están verificados, independientemente del TAR canónico.

## Verificación local sin regeneración

Desde `D:/smartrayco`:

```powershell
node scripts/prepare-dashboard-v2-publication.mjs --verify --expected-package-sha256 0b790f14b694571f21a5c5c6d2f32661d3e09d57ab3f5c43b846bc2db9765787
```

Este modo solo lee los archivos existentes. No compila, reempaqueta, abre SSH
ni modifica sus fechas. Ya pasó dos veces consecutivas. Si falla, detenerse;
no cambiar los hashes para aceptar la diferencia.

## Procedimiento futuro — REQUIERE autorización expresa

**Los siguientes comandos NO se ejecutaron durante la preparación.** No usar el
publicador genérico de otras fases: este paquete utiliza `publish.py`, limitado
a frontend y ligado al hash externo del manifiesto.

1. Repetir la verificación local anterior. Revisar que el respaldo siga presente.
2. Crear staging nuevo y transferir exclusivamente los archivos declarados.
   Si el directorio ya existe, detenerse y revisar el intento; no sobrescribirlo.

```powershell
$dashboardReleaseRoot = 'D:/smartrayco/deploy/dashboard-v2-20261112'
$dashboardReleaseStage = '/opt/smartrayco-staging/dashboard-v2-1d9dd40461d8-c7b4dc966c'
$dashboardDeployTarget = 'root@192.168.55.201'
$dashboardDeployKey = Join-Path $env:USERPROFILE '.ssh/smartrayco-deploy'
$dashboardManifest = Get-Content (Join-Path $dashboardReleaseRoot 'package.json') -Raw | ConvertFrom-Json
$dashboardTransferFiles = @('package.json','SHA256SUMS') + @($dashboardManifest.files.PSObject.Properties.Name)
$dashboardTransferFiles = @($dashboardTransferFiles | ForEach-Object { Join-Path $dashboardReleaseRoot $_ })
ssh.exe -o BatchMode=yes -i $dashboardDeployKey $dashboardDeployTarget "test ! -e '$dashboardReleaseStage' && mkdir -m 700 '$dashboardReleaseStage'"
if ($LASTEXITCODE -ne 0) { throw 'Detener: staging existente o no disponible' }
$dashboardDestination = $dashboardDeployTarget + ':' + $dashboardReleaseStage + '/'
scp.exe -q -i $dashboardDeployKey @dashboardTransferFiles $dashboardDestination
if ($LASTEXITCODE -ne 0) { throw 'Detener: transferencia incompleta' }
```

3. Ejecutar preflight remoto **de solo lectura**:

```powershell
ssh.exe -o BatchMode=yes -i $dashboardDeployKey $dashboardDeployTarget "python3 $dashboardReleaseStage/publish.py preflight --expected-package-sha256 0b790f14b694571f21a5c5c6d2f32661d3e09d57ab3f5c43b846bc2db9765787"
if ($LASTEXITCODE -ne 0) { throw 'Detener: precondiciones distintas' }
```

Exige los mismos cinco contenedores, IDs de imagen, fechas de arranque,
entornos, archivos de configuración, hashes del contrato backend, árbol
frontend y Nginx. Comprueba los 14 archivos del paquete, la cadena efectiva de
Compose y que el único cambio propuesto sea la imagen frontend. Un cambio
independiente de producción obliga a revisar/preparar de nuevo, sin relajar
estos controles ni sustituir hashes.

4. Solo después del preflight correcto y de la autorización de publicación:

```powershell
ssh.exe -o BatchMode=yes -i $dashboardDeployKey $dashboardDeployTarget "python3 $dashboardReleaseStage/publish.py apply --authorized --expected-package-sha256 0b790f14b694571f21a5c5c6d2f32661d3e09d57ab3f5c43b846bc2db9765787"
if ($LASTEXITCODE -ne 0) { throw 'Detener y evaluar rollback' }
```

Carga únicamente la imagen frontend congelada y crea su tag de rollback. La
única promoción de servicio es `docker compose ... up -d --no-deps --no-build
--pull never frontend`. No recompila, descarga imágenes, recrea backend o cambia
otros servicios. Un archivo de intento impide repetir la aplicación a ciegas.

5. Verificación posterior independiente:

```powershell
ssh.exe -o BatchMode=yes -i $dashboardDeployKey $dashboardDeployTarget "python3 $dashboardReleaseStage/publish.py verify --expected-package-sha256 0b790f14b694571f21a5c5c6d2f32661d3e09d57ab3f5c43b846bc2db9765787"
if ($LASTEXITCODE -ne 0) { throw 'Detener y evaluar rollback' }
```

Comprueba salud, imagen, commit público, árbol de archivos exacto, Nginx,
entorno frontend, hashes HTTP de todos los assets activos y rutas SPA críticas.
Backend y otros servicios deben conservar contenedor, imagen, arranque y
configuración. Los tres endpoints de Dashboard deben seguir devolviendo 401
sin sesión. Esto no sustituye la revisión autenticada siguiente.

6. Con una **sesión existente** y en modo consulta: abrir Dashboard, comprobar
   PPPoE y ONT, Soporte, Clientes, Contratos, Facturación, Equipos y navegación
   hacia OLT/Inventario. Verificar en la respuesta GET PPPoE los cuatro nombres
   exactos `Profile_Dedicado`, `Profile_Balanceador`, `Profile_Gamer_04` y
   `Profile_Gamer_05`, ausencia de Morosos, cantidades y `lastSuccessAt` contra
   la misma lectura del Dashboard. Esperar un ciclo de 60 s y comprobar que
   actualiza sin duplicar solicitudes. No provocar fallos de equipos ni alterar
   sesiones/perfiles: los estados de fallo ya se probaron localmente.
7. Revisar escritorio/tablet/móvil: gráfico móvil contraído, tres clientes,
   fechas de origen separadas y ausencia de desplazamiento horizontal. Si falla
   una comprobación crítica, detenerse y evaluar el rollback preparado.

## Rollback exacto — solo tras evaluar y autorizar su ejecución

```powershell
ssh.exe -o BatchMode=yes -i $dashboardDeployKey $dashboardDeployTarget "python3 $dashboardReleaseStage/publish.py rollback --authorized --expected-package-sha256 0b790f14b694571f21a5c5c6d2f32661d3e09d57ab3f5c43b846bc2db9765787"
if ($LASTEXITCODE -ne 0) { throw 'Detener: rollback no verificado' }
```

Revalida paquete/respaldo y cambios concurrentes, carga la imagen frontend
anterior con su identidad OCI exacta y recrea **solo frontend**. Verifica el
árbol original completo, entorno, Nginx, rutas, autenticación y salud. Backend
y los otros contenedores permanecen intactos. No ejecuta SQL ni restaura datos.
El respaldo ya se cargó y verificó en Docker **local**; no se ejecutó rollback
en producción. Se conservan los paquetes y respaldos de fases anteriores.

## Evidencia y límites

- `build-reproducibility.json`: dos TAR y árboles iguales; Node `v22.23.4`,
  igual al de las herramientas de compilación existentes; tipos correctos.
- `artifact-scope-proof.json`: 119 módulos protegidos, precargas resueltas,
  extracción del helper de Vue equivalente y metadata/imports comprobados.
- `regression.json`: 32 pruebas V2 + 16 PPPoE, Nginx real local, configuración
  conservada y archivos de imágenes verificados desde su raíz OCI.
- `package-guard-tests.json`: seis comprobaciones; rechaza corrupción de un
  byte, cambio de manifiesto, ámbito backend y ejecución en directorio erróneo.
- Nueve pruebas del comparador AST: positivas y rechazos de cambios de lógica.
  Se corrigió únicamente la representación de bindings de array en esa
  herramienta local; no se modifica ningún asset para pasar el validador.
- `production-unchanged.json`: reconfirmación final de solo lectura;
  salud correcta, guard PPPoE 401, servicios/archivos intactos, cero escrituras.

Los fixtures del navegador permanecen fuera del TAR de Dashboard y del sitio
publicado. Los tests de librerías preexistentes bajo `src/lib/__tests__` se
conservan como fuentes de la base; no forman parte de los bundles de ejecución.
No se incluyen prototipo, capturas de laboratorio, interceptores de fetch ni
datos PPPoE simulados en la imagen candidata.

Los datos usan las mismas consultas/endpoints y configuración pública. ONT
sigue siendo caché parcial si corresponde; Equipos carece de timestamp de
prueba en la API. No se inventa actualidad. Backend, TTL RAM PPPoE, permisos y
rutas no cambian. No hay nuevas tablas, históricos, cron jobs, telemetría,
retención, Supabase o conexiones a MikroTik durante esta preparación.

La comprobación autenticada en producción corresponde a la publicación futura;
no se realizaron login, operaciones de negocio, staging remoto ni despliegues.
