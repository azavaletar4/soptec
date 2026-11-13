# Dashboard V2 — publicación controlada

**PUBLICADO. Verificaciones automáticas correctas. Revisión visual autenticada
pendiente de confirmación del usuario.**

Publicado el **12/11/2026 a las 23:00:43 Perú**, exclusivamente `frontend`.
Fuente `1d9dd40461d84262d2dfa15ae006177121c1cc97`, rama
`release/dashboard-v2-20261112`; preparación `2744b48` y diseño aprobado `f9a2845`.

## Imágenes y alcance

| Servicio | Imagen |
| --- | --- |
| Frontend anterior / rollback | `sha256:b3a851fb925aa77feab2db9d16be92db50e3309810f42bb671fba96cf3be0b50` |
| Frontend publicado | `sha256:3fc2672ff84c7c77097aa45f4d2da242794fd1ef0320a799680166f5e4e1d7e1` |
| Backend conservado | `sha256:165126136e3178840e6443094b42993a73a43b79a4b3aa6149f17a3730e2fe16` |

Tag publicado: `smartrayco-dashboard-v2:1d9dd40461d8`.
Contenedor frontend nuevo:
`5f6c92d2a411ea2b10c82ab3755dfb8da7d698348ae4cba833002a83e40d3cd2`.

Backend, Caddy, Mongo y GenieACS conservan ID de contenedor, imagen, arranque y
entorno. No se desplegó backend, se recrearon dependencias ni se cambió Nginx,
configuración, permisos, autenticación o rutas.

## Integridad y procedimiento ejecutado

Paquete: `deploy/dashboard-v2-20261112/`. Se verificaron sus 14 archivos, respaldo
y manifiesto, se transfirieron únicamente los 16 archivos documentados a staging
nuevo y se ejecutó `publish.py preflight`. Resultado: PASS, sin cambiar servicios.

Se ejecutó el `publish.py apply --authorized` aprobado. Se cargó la imagen
candidata congelada y se promovió únicamente frontend con `--no-deps --no-build
--pull never`. **No se reconstruyó, regeneró ni sustituyó el paquete.**

| Artefacto | SHA-256 verificado antes y después |
| --- | --- |
| `package.json` | `0b790f14b694571f21a5c5c6d2f32661d3e09d57ab3f5c43b846bc2db9765787` |
| `source.tar` | `c7b4dc966cd66d7ac6b6d3fe40d76feb68a50fbc5b4e87f21657318cadc4d443` |
| `frontend-artifacts.tar` | `8b3c24e8065689f77611d777177ed08c43657d83b06bbeb266bc9239694da754` |
| Imagen candidata GZ | `b80df4ec443f51fac2e711ee9730316f85c4f7c2779baeb39b8b4e64da05b1e8` |
| Respaldo frontend GZ | `e6a1a0bb038d4b00879d763c6bd4771878174715a0f08048d471631e6f1cd497` |

## Verificaciones posteriores

- `publish.py verify`: PASS. Salud `ok`, imagen/commit públicos correctos,
  árbol completo de archivos, hashes HTTP de todos los assets activos, Nginx,
  entorno y configuración correctos.
- Rutas HTTP: `/`, `/dashboard`, `/clientes`, `/soporte`, `/olt`, `/mikrotik`,
  `/inventario`, `/facturacion`, `/tr069`, `/asistencia`, `/campo`: shell esperado.
- Navegador real sin sesión: Dashboard, OLT, Soporte, Inventario y Facturación
  redirigen a login. Endpoints protegidos y token inválido: 401. Sin excepciones
  JavaScript ni intentos de escritura. Esto verifica guardas, no una sesión
  autenticada de usuario.
- Reconfirmación independiente: todos los archivos y configuración coinciden
  con la imagen aprobada; los otros cuatro servicios permanecen intactos.
- Logs frontend desde el arranque nuevo: **cero errores Nginx emerg/alert/crit**.
- El sitio publicado coincide con los mismos artefactos que pasaron 32 pruebas
  V2 y 16 PPPoE locales, incluyendo móvil, tablet, gráfico contraído, tres
  clientes recientes y Atención al final. No se insertaron fixtures en producción.

## Contadores PPPoE reales

Lectura puntual de verificación **12/11/2026 23:02:17 Perú** del
**CCR2116-12G-4S+ Administrador**, comparada con consultas RouterOS GET del mismo
equipo, sin consultar los routers de Dedicado/Balanceador/WAN por separado.

| Perfil | Registrados | Conectados únicos | Comparación |
| --- | ---: | ---: | --- |
| `Profile_Dedicado` | 229 | 202 | PASS |
| `Profile_Balanceador` | 481 | 419 | PASS |
| `Profile_Gamer_04` | 30 | 27 | PASS |
| `Profile_Gamer_05` | 25 | 21 | PASS |

Morosos excluido; cero sesiones duplicadas, RADIUS o usuarios activos sin secret
local en esta comprobación. Veinticinco solicitudes concurrentes al servicio
existente compartieron un lote de tres lecturas RouterOS; la caché respondió
sin nuevas consultas. Sin modificaciones de perfiles, secrets, sesiones o
configuración. Los nombres y listas PPP permanecieron solo en memoria; no se
registraron usuarios ni contraseñas.

El diagnóstico ejecutó el mismo servicio backend desplegado en un proceso de
solo lectura, sin modificar archivos ni la autenticación HTTP. La comprobación
de lo visible en una sesión de usuario se informa por separado.

## Otros indicadores reales

Se comprobaron las consultas existentes mediante GET/HEAD con el servicio
existente, reutilizando el helper de ciclo de vida de clientes. Cero escrituras,
escaneos OLT o consultas MikroTik adicionales en esta comprobación.

- Clientes: 723 activos, 17 suspendidos, 0 prospectos y 7 retirados; 743 contratos
  activos. Se devolvieron cinco recientes, conservando el límite de tres móvil.
- Soporte: un abierto, cero en progreso y cero urgentes; consulta reciente válida.
- ONT: 646 en línea, 110 desconectadas, 14 sin autorizar y cero con señal baja;
  una OLT, escaneo completo. **Lectura de caché 12/11/2026 22:45:07 Perú**;
  la consulta general no convierte esa lectura en una lectura nueva.
- Equipos: una OLT y tres MikroTik con última prueba registrada OK, sin caídos
  o sin probar. La API sigue sin aportar fecha de prueba; no es salud en vivo.
- Facturación: consultas de pendientes, mes, día y series correctas; valores
  numéricos válidos. No se registraron importes, clientes, nombres ni listas.

Estas consultas validan disponibilidad y significado de las fuentes con el
servicio existente; no sustituyen la revisión autenticada en la sesión del
usuario. El usuario confirmó disponer de sesión y se solicitó comprobar las
tarjetas, navegación y presentación publicada. La confirmación sigue pendiente.

## Incidencias y rollback

Sin discrepancias críticas detectadas en los controles automáticos. No hubo
bloqueos de seguridad ni se eludieron controles. No se ejecutó rollback.

Rollback exclusivo de frontend disponible y verificado:

- Tag: `smartrayco-dashboard-v2-rollback:b3a851fb925a`, ligado a la imagen anterior.
- Respaldo íntegro local y en
  `/opt/smartrayco-staging/dashboard-v2-1d9dd40461d8-c7b4dc966c/frontend-before.image.tar.gz`.
- Restauración: el `publish.py rollback --authorized` documentado, con el mismo
  hash de manifiesto. Solo frontend; sin restauración de datos o cambios backend.

No se ejecutaron SQL, migraciones, cambios en Supabase/MikroTik, tablas, nuevos
históricos, cron jobs, muestras periódicas o modificaciones de retención. El
TTL RAM PPPoE sigue siendo 60 segundos. El informe registra una verificación
puntual de publicación; no se implementó almacenamiento de lecturas.

Evidencia: `publication-before.json`, `publication-after.json` y
`publication-result.json` dentro de `deploy/dashboard-v2-20261112/`. Se conservan
el paquete aprobado y los respaldos anteriores sin sobrescrituras.
