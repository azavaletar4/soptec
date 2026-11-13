# Soporte y Prospectos — preparación final

**LISTO PARA SOLICITAR AUTORIZACIÓN. No desplegado. SQL no aplicado. Cero descartes reales.**

Implementación de partida: `61e0e31`. Se reutilizó su diagnóstico y sus pruebas resueltas; no se repitieron las 604 regresiones ni los 13 escenarios SQL. Las verificaciones nuevas se limitaron al candidato aislado, la etiqueta/desglose, el envoltorio SQL y la integridad del paquete.

## Identidad del candidato

- Rama aislada: `release/dashboard-support-prospects-20261113`.
- Commit de fuentes: **`9e1e7c1c4e71c354c4c8878cdfc97cd6bf748c09`**, hijo directo de `1d9dd40461d84262d2dfa15ae006177121c1cc97`, actualmente publicado.
- Paquete completo local: **`deploy/dashboard-support-prospects-20261113/`**. Contiene 28 archivos operativos sellados, manifiesto y SHA256SUMS; los TAR/GZ se conservan fuera de Git por tamaño. Sin ellos, un checkout no constituye un paquete publicable.
- Servicio a publicar: **solo frontend**. La migración SQL puntual es un paso separado, explícito y previo; no hay publicación backend, migraciones generales ni db push.
- Imagen frontend candidata: `sha256:191462d2258a80a3380e919e239d410d322c41fcf3df43f73f2c6a1543f20b58`.
- Imagen frontend actual y rollback: `sha256:3fc2672ff84c7c77097aa45f4d2da242794fd1ef0320a799680166f5e4e1d7e1`.
- Backend sin cambios: `sha256:165126136e3178840e6443094b42993a73a43b79a4b3aa6149f17a3730e2fe16`.

## Resultado funcional confirmado

**Trabajos pendientes: 12**, con desglose visible **1 avería + 10 rutinas + 1 Alta**; en progreso 0 y urgentes 0. La fuente compartida ACTIVE_STATUS y la deduplicación tipo+ID se conservan. Los recientes distinguen tipo, estado y ruta real. No se presentan como tickets abiertos.

**Prospectos vigentes: 1**, Manuel Romero Collantes, conforme a Clientes → Pendientes de instalación. Las tres contrataciones canceladas con estado crudo prospect se excluyen sin modificarlas; también se excluye la cuarta ficha histórica ya retired del contador anterior. El informe `operational-evidence.json` procesó offline la misma evidencia READ ONLY del 12/11 a las 23:30 Perú con los helpers del candidato; no afirma que las cantidades estén congeladas ni que sean una nueva lectura de clientes en producción.

El descarte conserva validaciones de `61e0e31`: ADMIN/SUPERADMIN activo verificado en SQL, confirmación, motivo obligatorio, responsable y fecha inalterables; no borra la ficha ni su historia. Impide servicios vigentes y Altas abiertas/completadas. Manuel no es elegible mientras su Alta esté pendiente. No actualiza contratos, órdenes, conversiones ni instalaciones automáticamente.

## Fuentes incluidas y archivos de esta fase

Nueve archivos de producto, más una prueba, sobre la base publicada:

1. `src/components/clientes/UnfulfilledProspectDiscardDialog.vue`
2. `src/lib/dashboardClients.ts`
3. `src/lib/dashboardSupport.ts`
4. `src/lib/unfulfilledProspect.ts`
5. `src/stores/clients.ts`
6. `src/stores/dashboard.ts`
7. `src/types/domain.ts`
8. `src/views/DashboardView.vue`
9. `src/views/clientes/ClientesView.vue`
10. `src/lib/__tests__/dashboardOperationalCounts.test.ts` (no se incluye en bundles de ejecución).

Respecto a `61e0e31`, solo se cambia DashboardView, dashboardSupport, la interfaz interna del resumen y su prueba para la etiqueta exacta y el desglose por tipo. No hay rediseño ni CSS nuevo.

Preparación: `scripts/prepare-dashboard-support-release.mjs`, `finalize-dashboard-support-release.mjs`, `dashboard-support-release-readonly.cjs`, `dashboard-support-source-proof.mjs`, `dashboard-support-sql-package.mjs`; pruebas `scripts/tests/dashboard-support-package-{sql,guards}.mjs`. Los tres runners existentes de navegador/contrato reciben opciones para comprobar los archivos extraídos de la imagen candidata. Capturas nuevas en `docs/dashboard-support-prospects-release-local/`. Archivos operativos y SQL exactos enumerados por package.json.

`source-scope-proof.json` vincula las 323 fuentes al commit y demuestra **313 archivos de la base sin cambios**, incluidos rutas, autenticación, dependencias, Altas, Campo y facturación. Las únicas alteraciones compartidas de Clientes son la nueva acción administrativa y sus campos opcionales. Fuentes backend: ninguna. Se conservaron los cambios locales ajenos, sin incluirlos en el commit o artefactos.

## Migración y verificación de compatibilidad

La propuesta original conserva exactamente el SHA-256 de `61e0e31`. Añade tres columnas nullable, FK, restricción, tres funciones y tres triggers, reutilizando retired. No crea tablas/históricos/cron jobs ni modifica valores existentes al instalarse.

`apply.sql` añade guardas de catálogo y propietario dentro de la misma transacción, con lock_timeout 3 s. `preflight.sql` es exclusivamente de lectura y comparó **correctamente contra el esquema real** mediante `database.ps1 -Action preflight`, con default_transaction_read_only=on, TLS verify-full y sin cargar ninguna migración. Resultado en `preflight-readonly-result.json`. El respaldo existente y su hash coinciden; no se sustituyó para ocultar diferencias.

`verify.sql`, preparado pero NO ejecutado en producción porque la migración no se aplicó, comprueba tras una futura aplicación que se conserven esquema, RLS, ACL y dependencias previos, las guardas nuevas y que anon/service_role no ejecuten la RPC. El ejecutor rechaza acciones de cambio sin -Authorized antes de leer credenciales o abrir conexiones; se comprobó esa guarda. Ese switch no sustituye una autorización del usuario.

No se cambia el servidor Hono. La RPC nueva es de Supabase y valida roles dentro de PostgreSQL; la autorización no depende de botones ocultos. El helper privado de conexión se fija por hash y no se modifica.

## Hashes sellados

| Archivo | SHA-256 |
|---|---|
| **package.json** | **`2e085a576d5c7a4914bd6584d328b65da51ea4bb93497aedbdd41edf2f552410`** |
| source.tar | `45833940c83707a37937318b1e472beef0104429db8896f963c4c9f1f815a8fb` |
| frontend-artifacts.tar | `2e83036cbf31e6aa41e1fb668aa315ea9d359b82b37ff681f0e7c0063e55d1bd` |
| apply.sql | `6d7c4ab83bb84741fdce274d8001a6f7e233ffba996c4d550f87e3ab9f5b8e1b` |
| migration-original.sql | `89e3d0f8d11634dc60f65d8c7ae9d91c7ca99e907db3df24e47f424aeaf26ce6` |
| schema-baseline.json | `2bda26cf8b1a660a3354df365c7c0099f6afde60b5c40a0c0d4cbfb8c787ef0d` |
| frontend-before.image.tar.gz | `b80df4ec443f51fac2e711ee9730316f85c4f7c2779baeb39b8b4e64da05b1e8` |

Los dos builds Linux sin red/caché producen el mismo source.tar, TAR frontend, release-manifest y árbol de 2750 archivos. La metadata de creación Docker hace distintas las dos identidades OCI; no se afirma reproducibilidad binaria de las imágenes. Se publicaría únicamente la imagen ya congelada, con su GZ y blobs OCI verificados por hash en el manifiesto. No reconstruir tras aprobar.

## Verificaciones finales realizadas

- vue-tsc sobre las fuentes aisladas y dos builds Vite/Linux: PASS.
- Seis pruebas de contadores del commit aislado: PASS; 12 trabajos, desglose, estados finales, urgentes, deduplicación y una ficha pendiente.
- 35 comprobaciones Dashboard + 16 PPPoE + 10 de descarte sobre los archivos extraídos de la **misma imagen candidata**: PASS, sin excepciones ni tráfico externo. Escritorio/tablet/móvil, errores/datos antiguos, actualización, roles y formulario.
- Contrato protegido: PASS; consultas/cálculos de facturación, actualización, errores, PPPoE/TTL, backend, rutas y permisos conservados. Altas y Campo no cambian sus fuentes; fichas no descartadas conservan las creaciones/activaciones normales ya comprobadas.
- Cinco comprobaciones nuevas del SQL protegido: PASS, con PostgreSQL efímero sin red y filas sintéticas. Rechazo de esquema distinto, aplicación con catálogo sintético sin cambiar valores de negocio, rechazo de permisos/RLS alterados y reaplicación, rollback sin uso.
- Seis guardas del paquete: PASS. Dos verificaciones sin regeneración, hash externo obligatorio, rechazo de cambio de SQL/manifiesto/ámbito backend y conservación de todos los bytes originales.
- Preflight real del esquema: PASS, exclusivamente de lectura.
- Reconfirmación productiva final: PASS, 13/11/2026 00:23:14 Perú. Salud ok; endpoint PPPoE devuelve 401 sin sesión; imágenes, contenedores, configuración y archivos siguen iguales. Sin solicitudes MikroTik ni escrituras remotas.

La ejecución restringida inicial de PowerShell no permitía scripts; la guarda se comprobó después en el contexto autorizado del entorno, **sin cambiar ExecutionPolicy ni usar Bypass**. No se eludió un bloqueo. El control rechazó apply sin autorización y no abrió conexiones.

## Aplicación futura y rollback

El procedimiento exacto está en `deploy/dashboard-support-prospects-20261113/README.md`, incluido en el sello. Resumen:

1. Verificar integridad con el hash externo anterior, sin preparar/regenerar.
2. Repetir preflight SQL READ ONLY; ante drift, detenerse.
3. Solo con autorización explícita: ejecutar database.ps1 -Action apply -Authorized y después -Action verify. No descartar fichas reales como prueba.
4. Crear staging nuevo del manifiesto, transferir solo los archivos declarados y ejecutar publish.py preflight.
5. Solo tras precondiciones correctas: publish.py apply --authorized; publica exclusivamente frontend, sin build, pull ni recreación backend. Ejecutar verify y revisión autenticada de lectura, escritorio/móvil y módulos operativos.

Si falla antes de publicar frontend, no continuar. Si SQL falló, confirmar su reversión transaccional antes de intentar rollback de objetos. Si se publicó, rollback exclusivo a la imagen frontend respaldada. Antes del primer descarte puede usarse rollback-unused.sql: elimina solo objetos nuevos y falla si hay trazabilidad. Tras uso, disable-used.sql revoca la RPC conservando columnas, guardas y evidencia; no borrar registros ni restaurar estados automáticamente.

Riesgos: bloqueos DDL breves y conflictos concurrentes que revierten completos; cambios independientes de esquema/producción deben detener la aplicación. La reapertura de un descartado queda fuera de alcance. No hay autorización de aplicación o publicación vigente para este paquete: **detenido en LISTO PARA SOLICITAR AUTORIZACIÓN**.
