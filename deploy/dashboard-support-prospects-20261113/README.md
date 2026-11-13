# Soporte y Prospectos — publicación preparada, no ejecutada

**LISTO PARA SOLICITAR AUTORIZACIÓN.** La autorización debe abarcar la migración puntual y la imagen frontend de este paquete. No permite descartar personas concretas, publicar backend ni realizar otras escrituras.

Fuente aislada: `9e1e7c1c4e71c354c4c8878cdfc97cd6bf748c09`, rama `release/dashboard-support-prospects-20261113`, hijo directo del frontend publicado `1d9dd40461d84262d2dfa15ae006177121c1cc97`. Parte de la implementación `61e0e31`; solo añade la etiqueta solicitada y su desglose de pendientes. Nueve archivos productivos y una prueba de librería; 313 fuentes de la base conservadas sin cambios. `source-scope-proof.json` enumera el alcance exacto.

El Dashboard muestra **Trabajos pendientes** y su desglose por averías, rutinas y Altas. En progreso y urgentes conservan su significado; recientes conserva tipos, estados y rutas. Prospectos enlaza a Pendientes de instalación. La evidencia READ ONLY del diagnóstico, procesada otra vez offline con el candidato, da **12 / 0 / 0** (1 avería + 10 rutinas + 1 Alta) y **1 prospecto: Manuel Romero Collantes**. Las tres fichas canceladas con estado crudo prospect y la cuarta ficha histórica ya retired quedan excluidas, sin editarlas. Estas son cifras del instante documentado, no una nueva lectura productiva.

## Integridad y reproducibilidad

Dos compilaciones Linux locales sin red ni caché, Node 22.23.4:

- `source.tar`: `45833940c83707a37937318b1e472beef0104429db8896f963c4c9f1f815a8fb`.
- `frontend-artifacts.tar`: `2e83036cbf31e6aa41e1fb668aa315ea9d359b82b37ff681f0e7c0063e55d1bd`.
- Árbol completo: 2750 archivos con idénticos bytes; se retienen assets de software del frontend anterior para pestañas abiertas. No son históricos de operación ni almacenamiento Supabase.
- Las identidades Docker de ambas compilaciones difieren por metadata de imagen; no se afirma reproducibilidad binaria de los contenedores. Se congela y verifica **una** imagen candidata; nunca se reconstruye después de aprobarla.

Frontend anterior / rollback: `sha256:3fc2672ff84c7c77097aa45f4d2da242794fd1ef0320a799680166f5e4e1d7e1`.

Frontend candidato: `sha256:191462d2258a80a3380e919e239d410d322c41fcf3df43f73f2c6a1543f20b58`.

Backend conservado: `sha256:165126136e3178840e6443094b42993a73a43b79a4b3aa6149f17a3730e2fe16`.

Los TAR/GZ se conservan localmente y se excluyen de Git. Un checkout sin estos archivos **no es el paquete completo**. `package.json` firma los archivos operativos; `SHA256SUMS` incluye también el manifiesto. El SHA-256 externo del manifiesto se entrega en el informe final, fuera de este documento para evitar una referencia circular. No aceptar un hash calculado desde un manifiesto sin comparar con ese valor aprobado.

## Migración, permisos y respaldo

`migration-original.sql` es byte por byte la propuesta de `61e0e31` (SHA-256 `89e3d0f8d11634dc60f65d8c7ae9d91c7ca99e907db3df24e47f424aeaf26ce6`). `apply.sql` la envuelve en una transacción con comprobación exacta de esquema, función de rol, dueño y bloqueos breves; notifica recarga del esquema PostgREST al terminar. Detiene todo si hay discrepancias; no sustituir el catálogo esperado ni saltar guardas.

Añade tres columnas nullable a clients, una FK, una restricción, tres funciones nuevas y tres triggers. Reutiliza status retired. No crea tablas ni modifica filas al instalarse. Los cambios de descarte posteriores solo se producen mediante una acción explícita ADMIN/SUPERADMIN activo, con confirmación, motivo, fecha y responsable. La guarda SQL valida el perfil; no confía en ocultar botones ni en GUC del usuario. Se conserva la ficha y su trazabilidad, que no se puede borrar/alterar desde la API.

No permite servicios vigentes ni instalaciones abiertas/completadas; no cancela contratos u órdenes. Manuel no puede descartarse mientras su Alta siga abierta. Una ficha descartada no recibe nuevos servicios/Altas activos sin un futuro flujo de reapertura autorizado. El contacto sigue editable y el historial consultable en No instalados. No se modifica el CRM comercial ni su conversión.

`schema-baseline.json` es el respaldo de catálogo existente (SHA-256 `2bda26cf8b1a660a3354df365c7c0099f6afde60b5c40a0c0d4cbfb8c787ef0d`): columnas/defaults, restricciones, índices, propietarios, ACL, RLS, políticas y funciones de triggers de las tres tablas base. No contiene filas de negocio ni credenciales. No sustituye un backup de datos. Las definiciones anteriores se conservan; rollback elimina únicamente objetos nuevos, condicionado a que no exista trazabilidad.

La imagen anterior está íntegra en `frontend-before.image.tar.gz`, SHA-256 `b80df4ec443f51fac2e711ee9730316f85c4f7c2779baeb39b8b4e64da05b1e8`; corresponde al candidato sellado que se publicó en Dashboard V2 y cuya identidad se reconfirmó por lectura. El finalizador comprueba sus blobs OCI y que puede cargarse localmente.

## Verificaciones realizadas

- Tipos sobre las fuentes aisladas y dos builds reproducibles: PASS.
- Seis pruebas finales de contadores del candidato: PASS. Se reutilizan las 604 regresiones y 13 pruebas SQL de `61e0e31`, sin repetirlas; la migración original no cambia.
- Cinco verificaciones nuevas del envoltorio SQL: PASS. El archivo exacto rechaza un esquema distinto sin aplicar DDL; el mismo guard y migración funcionan con catálogo sintético. Verificación posterior rechaza permisos anónimos y RLS alterados. Rollback sin uso conserva datos sintéticos, contratos, órdenes y trazas previas. La prueba positiva usa catálogo sintético; no ejecuta el SQL productivo.
- Imagen candidata extraída: 35 comprobaciones Dashboard + 16 PPPoE + 10 de descarte, escritorio/tablet/móvil: PASS. Cero tráfico externo o escrituras reales. La captura del caso 12/1 corresponde a FACTURACION, por eso respeta la ocultación de PPPoE para ese rol; la vista ADMIN y los cuatro perfiles se prueban en el mismo candidato.
- Contrato protegido de facturación, actualización/errores, backend, rutas y permisos: PASS. Altas y App de Campo conservan sus fuentes originales; el técnico conserva su redirección a Campo. Las únicas guardas de relaciones nuevas se limitan a impedir activaciones de una ficha descartada; una ficha normal conserva su flujo.
- No hay cambios de backend, MikroTik, OLT, PPPoE/TTL 60 s, tráfico histórico, cron jobs o retención. No se incluyen fixtures ni capturas en los bundles productivos.

## Procedimiento futuro — no ejecutado

Detenerse ante cualquier rechazo del entorno. No usar ExecutionPolicy Bypass, desactivar validadores o modificar hashes esperados para aceptar diferencias.

1. Conservar completo el paquete y comparar su hash externo aprobado. Desde `D:/smartrayco`:

```powershell
$packageRoot = 'D:/smartrayco/deploy/dashboard-support-prospects-20261113'
$approvedPackageSha256 = '<SHA-256 externo entregado y autorizado>'
node scripts/prepare-dashboard-support-release.mjs --verify --expected-package-sha256 $approvedPackageSha256
if ($LASTEXITCODE -ne 0) { throw 'Detener: integridad' }
```

El modo verify solo lee. No compila, genera ni sobrescribe artefactos. No usar prepare sin verify después de aprobar.

2. Preflight SQL, exclusivamente de lectura; requiere las credenciales DPAPI/TLS y Docker local del entorno existente:

```powershell
powershell.exe -NoProfile -File "$packageRoot/database.ps1" -Action preflight -ExpectedPackageSha256 $approvedPackageSha256
if ($LASTEXITCODE -ne 0) { throw 'Detener: esquema o entorno distinto' }
```

Comprueba el catálogo completo contra el respaldo, con default_transaction_read_only=on. El ejecutor valida todos los archivos del manifiesto antes de cargar credenciales; fija proyecto, TLS verify-full y hash de su librería privada existente. No imprime credenciales ni resultados personales. Un cambio del catálogo exige revisión y nueva preparación, nunca editar el baseline a ciegas.

3. **Solo tras autorización explícita del SQL y de este paquete:**

```powershell
powershell.exe -NoProfile -File "$packageRoot/database.ps1" -Action apply -ExpectedPackageSha256 $approvedPackageSha256 -Authorized
if ($LASTEXITCODE -ne 0) { throw 'Detener; revisar estado y rollback, sin reintento ciego' }
powershell.exe -NoProfile -File "$packageRoot/database.ps1" -Action verify -ExpectedPackageSha256 $approvedPackageSha256
if ($LASTEXITCODE -ne 0) { throw 'Detener antes de publicar frontend' }
```

El marcador local impide repetir apply sin investigar el intento anterior. verify valida que esquema/RLS/ACL/definiciones anteriores se conservan, que las funciones/triggers nuevos existen, que anon/service_role no ejecutan la RPC y que no hay descartes inconsistentes. Antes de habilitar el formulario debe haber cero descartes, ya que instalar DDL no descarta fichas. No ejecutar un descarte real como prueba.

4. Crear staging NUEVO y transferir exclusivamente archivos firmados, después de autorizar publicación:

```powershell
$releaseStage = '/opt/smartrayco-staging/dashboard-support-9e1e7c1c4e71-45833940c8'
$deployTarget = 'root@192.168.55.201'
$deployKey = Join-Path $env:USERPROFILE '.ssh/smartrayco-deploy'
$manifest = Get-Content "$packageRoot/package.json" -Raw | ConvertFrom-Json
$transferFiles = @('package.json','SHA256SUMS') + @($manifest.files.PSObject.Properties.Name)
$transferFiles = @($transferFiles | ForEach-Object { Join-Path $packageRoot $_ })
ssh.exe -o BatchMode=yes -i $deployKey $deployTarget "test ! -e '$releaseStage' && mkdir -m 700 '$releaseStage'"
if ($LASTEXITCODE -ne 0) { throw 'Detener: staging existente o no disponible' }
scp.exe -q -i $deployKey @transferFiles ($deployTarget + ':' + $releaseStage + '/')
if ($LASTEXITCODE -ne 0) { throw 'Detener: transferencia incompleta' }
ssh.exe -o BatchMode=yes -i $deployKey $deployTarget "python3 $releaseStage/publish.py preflight --expected-package-sha256 $approvedPackageSha256"
if ($LASTEXITCODE -ne 0) { throw 'Detener: producción cambió' }
```

5. Solo si SQL, integridad y preflight resultan correctos, publicar la imagen congelada:

```powershell
ssh.exe -o BatchMode=yes -i $deployKey $deployTarget "python3 $releaseStage/publish.py apply --authorized --expected-package-sha256 $approvedPackageSha256"
if ($LASTEXITCODE -ne 0) { throw 'Detener y evaluar rollback' }
ssh.exe -o BatchMode=yes -i $deployKey $deployTarget "python3 $releaseStage/publish.py verify --expected-package-sha256 $approvedPackageSha256"
if ($LASTEXITCODE -ne 0) { throw 'Detener y evaluar rollback' }
```

El publicador conserva sus guardas originales y ejecuta exclusivamente `docker compose ... up -d --no-deps --no-build --pull never frontend`. No ejecuta SQL. Comprueba que backend, otros servicios, configuración, Nginx y entorno no cambien. Verifica salud, rutas SPA, hashes HTTP y rechazo 401 de endpoints sin sesión.

6. Con una sesión existente y sin escrituras: comparar Dashboard con Soporte / Todas y Clientes / Pendientes de instalación, abrir recientes de cada tipo, revisar facturación, Altas y Campo según rol. Comprobar errores/fechas de origen, refresco 60 s, PPPoE autorizado, ONT, móvil y alertas al final. Los valores pueden variar desde el diagnóstico por actividad legítima; deben coincidir entre módulos al mismo instante. Ver el diálogo de descarte y cancelar, sin confirmar ningún registro real.

## Rollback exclusivo y conservador

Si se publicó frontend y falla un control crítico, restaurar únicamente su imagen anterior mediante el publicador guardado:

```powershell
ssh.exe -o BatchMode=yes -i $deployKey $deployTarget "python3 $releaseStage/publish.py rollback --authorized --expected-package-sha256 $approvedPackageSha256"
```

SQL antes del primer descarte: después de revisar el estado y autorizar rollback, `database.ps1 -Action rollback-unused -ExpectedPackageSha256 $approvedPackageSha256 -Authorized`. Rechaza cualquier trazabilidad; no modifica estados ni contratos/órdenes. Si SQL falló dentro de su transacción, confirmar que no se instaló antes de intentar retirar objetos inexistentes.

Si hubo uso real: revertir frontend y ejecutar únicamente `database.ps1 -Action disable-used -ExpectedPackageSha256 $approvedPackageSha256 -Authorized`. Revoca acceso a la RPC y conserva columnas, trazabilidad y guardas; no borrar evidencia ni reactivar personas. Los cambios de negocio posteriores no se revierten automáticamente.

Riesgos: bloqueos DDL breves (lock_timeout 3 s), conflictos/deadlocks que revierten completos y un posible cambio concurrente del esquema/producción que debe detener la aplicación. No hay despliegue backend ni migración general. `--authorized` es una guarda técnica y no reemplaza la aprobación expresa del usuario.
