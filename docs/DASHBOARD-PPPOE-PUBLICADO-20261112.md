# Contadores PPPoE publicados

**PUBLICADO. Salud e integridad correctas; verificaciones de solo lectura PASS.**

Publicación: **12/11/2026, 16:45:17, horario Perú**. Solo se recrearon backend y
frontend mediante el procedimiento protegido existente, sin relajar validadores.

## Paquete e imágenes

Empaquetado autorizado: `f1f9ab4`; implementación: `a4a5b41`; fuentes aisladas:
`b3cdef65c2830c2f44270568d7038b342b68b3e6`. SHA-256 del TAR aprobado, conservado
sin sobrescritura durante preparación y publicación:
`1e5c90ffb5bd676ba0d00dd1731833ca0225ea18767418c6be43143b825c26b7`.

| Servicio | Imagen publicada |
| --- | --- |
| Frontend | `smartrayco-frontend-consolidado:b3cdef65c283` — `sha256:b3a851fb925aa77feab2db9d16be92db50e3309810f42bb671fba96cf3be0b50` |
| Backend | `smartrayco-backend-wifitrial:b3cdef65c283` — `sha256:165126136e3178840e6443094b42993a73a43b79a4b3aa6149f17a3730e2fe16` |

Producción coincidía exactamente con imágenes, contenedores, inicio y entorno
esperados antes de intervenir. Los respaldos locales y el paquete pasaron sus
hashes. El staging nuevo guardó y verificó imágenes originales y rollback antes
de construir. Las candidatas remotas reprodujeron exactamente los árboles de
software aprobados localmente. El contrato y las fuentes del publicador no
cambiaron respecto a `f1f9ab4`.

## Verificaciones posteriores

- Salud HTTPS `/api/health`: **OK**. Verificación protegida `deploy` y luego
  `verify`: **PASS**. Los 128 artefactos del manifiesto se descargaron y
  verificaron por hash; fuentes backend, Nginx y entorno efectivo correctos.
- Caddy, Mongo y GenieACS conservan contenedor, imagen y hora de inicio. No se
  reiniciaron ni se modificaron otros servicios, volúmenes o configuración.
- Navegador real, perfil nuevo sin sesión: Dashboard, OLT, soporte, inventario y
  facturación redirigen a `/login` y cargan el formulario, sin excepciones JS.
  APIs protegidas devuelven **401** sin token; el endpoint PPPoE también rechaza
  un token inválido. Se bloquearon métodos de escritura y terceros durante el
  diagnóstico; no hubo intentos de escritura.
- Consultas **GET/SELECT**, usando el cliente y entorno del backend publicado,
  a las fuentes de datos de OLT, soporte, inventario y facturación: **PASS**.
  No se ejecutaron acciones operativas, cobros, cambios de inventario ni órdenes.

**Límite de la comprobación de acceso:** no se dispuso de una sesión real de
usuario. No se inició sesión ni se crearon tokens/cuentas. No se afirma una
prueba HTTP 200 autenticada ni un recorrido completo de negocio de esos módulos.
Sus rutas, barreras de acceso, archivos y lecturas de datos sí se verificaron.

## Comparación PPPoE real

Lectura exitosa **16:46:15 Perú**. En un proceso diagnóstico separado dentro del
backend publicado se importó el servicio real, sin iniciar otro servidor ni
schedulers. Se usaron su conexión y transporte existentes; únicamente GET al
Administrador **CCR2116-12G-4S+**. No se consultaron otros routers.

Los cuatro perfiles exactos `Profile_Dedicado`, `Profile_Balanceador`,
`Profile_Gamer_04` y `Profile_Gamer_05` coincidieron con consultas independientes
filtradas de secrets y sesiones activas antes/después de la lectura. Los valores
se comunicaron en la entrega, sin generar archivos de lecturas o series.

Se verificaron **25 solicitudes concurrentes → un SELECT de Administrador y
tres GET RouterOS** (hardware, secrets y active). La siguiente solicitud usó la
misma caché sin lecturas adicionales. Cuatro resultados exactos, estado fresh,
Morosos excluido, RADIUS desactivado, cero usuarios sin secret y cero sesiones
duplicadas en la lectura observada. El conteo usa usuarios únicos.

El diagnóstico ejecuta el módulo desplegado, **no una petición HTTP con una
sesión de usuario**. Las listas PPP y credenciales permanecieron transitorias;
solo se imprimieron agregados. No se añadieron logs de usuarios, snapshots ni
tablas. La funcionalidad conserva un agregado en RAM con TTL de 60 segundos.

## Supabase y restricciones

La función publicada solo hace SELECT de configuración y GET RouterOS; no tiene
persistencia, inserts, updates, RPC de escritura ni historial PPPoE. El diagnóstico
de lectura observó exclusivamente GET y cero métodos mutantes. No se ejecutaron
migraciones ni cambios SQL o de configuración MikroTik.

No se modificaron tablas históricas de tráfico, no se limpiaron registros y no
se alteraron sus schedulers. Esta comprobación no pretende afirmar que toda la
aplicación deja de escribir: los procesos operativos preexistentes siguen su
funcionamiento normal. Los contadores PPPoE y las verificaciones de esta tarea
no añaden escrituras ni históricos en Supabase.

## Rollback

Disponible y reverificado tras publicar, **sin ejecutar**:

`/opt/smartrayco-staging/frontend-consolidado-tr069-b3cdef6-f00edbfc18/`

Contiene `backend-before.image.tar`, `frontend-before.image.tar`,
`release.rollback.json`, Compose efectivo privado y manifiestos de integridad.
Las copias completas, sus SHA-256 y las referencias Docker originales pasaron.
Los respaldos locales y los del intento anterior se conservan.

Imágenes de retorno:

- Backend: `sha256:87e442e9bdcf17fcd192dbe401fa533c5746e8fd96658b50e0fe24b175162001`.
- Frontend: `sha256:6ed5f7751bb2f8b7c26baf6bed8228c1c9ed695ef60a25c2ca676a36bbea923d`.

Si se requiere revertir, el publicador existente admite `rollback` con el mismo
scope y snapshot; restaura exclusivamente estas dos imágenes y verifica salud,
software, entorno y continuidad de los demás servicios. No se necesita rollback
por los resultados observados.

Evidencia: `publication-result.json`, `publication-checks.json`,
`remote-build-verification.json`, `verification.json` y
`rollback-availability.json` en `deploy/pppoe-20261112/`. Los diagnósticos nuevos
solo verifican lectura; no forman parte de las imágenes publicadas.
