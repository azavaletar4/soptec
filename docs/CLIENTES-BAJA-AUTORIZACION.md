# Baja administrativa de línea: preparación para autorización

Fecha: 2026-10-24. Corrección funcional: **2620ed7**. **PASS técnico de preparación. SQL y despliegue NO ejecutados.** La autorización sigue pendiente.

## Resultado y diferencias con producción

Lectura Supabase: `2026-10-24T05:21:07.460849+00:00`, transacción `REPEATABLE READ READ ONLY`, `transaction_read_only=on`, rollback final. Sólo catálogo de las cinco tablas necesarias: no se consultaron fichas, contratos reales ni los cuatro casos revisados. La evidencia completa queda privada; su hash y el resumen están en `CLIENTES-BAJA-PREFLIGHT.json`.

| Verificación | Resultado |
| --- | --- |
| UUID de titular/contrato, estados enum, timestamps y perfil activo/rol | PASS: columnas y tipos requeridos presentes |
| Estados contrato y ficha | PASS: active/suspended/cancelled y prospect/active/suspended/retired |
| Altas pendientes | PASS: pending/scheduled/in_progress existen; la RPC rechaza Alta abierta de esa línea y conserva la ficha si queda otra Alta pendiente |
| RLS y propietarios | PASS: las cinco tablas tienen RLS activo, sin FORCE RLS, propietario postgres; políticas no modificadas |
| Ejecución autenticada | PASS de compatibilidad: authenticated dispone de USAGE public y EXECUTE auth.uid(); la RPC nueva se autoriza explícitamente y revalida ADMIN/SUPERADMIN activo |
| Colisión de nombres | PASS: no existen la RPC ni las dos funciones/guardas candidatas; tampoco está instalada la baja global de 38cec66 |
| FK NAP → contrato | PASS: relación existente, apta para consultar service_contracts.status sin modificar vínculos |
| Triggers por UPDATE en cliente/contrato | PASS: sólo set_updated_at; no se encontró un trigger de UPDATE comercial que retire equipos, borre NAP o invoque red |
| Cancelación de una sola línea y permisos | PASS previo de 2620ed7 y 5/5 pruebas sobre el frontend aislado: la RPC apunta a un único ID; el resto se bloquea para lectura consistente, sin UPDATE a otras líneas |
| NAP: cancelados fuera, suspendidos dentro e historial conservado | PASS de la regla común y nueve pruebas del helper ya aprobadas; el artefacto incluye esa misma corrección |
| Última línea | PASS previo: ficha retired sólo sin otros activos/suspendidos ni Altas abiertas; no exige ONT |

Diferencias exactas relevantes:

1. **Objetos nuevos todavía ausentes.** El SQL añadiría tres funciones y dos triggers; no reemplaza funciones, columnas, estados ni políticas existentes. Sin instalar la RPC, la nueva acción falla cerrada. No instalar la propuesta de baja global ni SQL del ejecutor OLT.
2. **Timestamp:** producción usa `set_updated_at` con `now()`; la fixture sintética usa `clock_timestamp()`. La firma `timestamptz`, la validación del timestamp esperado y la atomicidad son compatibles. No se cambia el trigger productivo.
3. **RLS más detallada que la fixture** en instalaciones y perfiles. La RPC corre con propietario postgres, valida el perfil vigente y sólo actualiza contrato/ficha; no modifica las instalaciones protegidas. Las guardas invocadoras siguen sujetas a los permisos del actor. No se certifica una ejecución de la RPC nueva en producción: hacerlo implicaría instalarla, lo cual está prohibido en esta fase.
4. **Privilegios por defecto:** las funciones nuevas normalmente reciben EXECUTE para anon/authenticated/service_role. Los REVOKE explícitos del candidato son obligatorios: la RPC revoca PUBLIC/anon/service_role y concede authenticated; las dos funciones trigger revocan también authenticated. No separar CREATE y REVOKE en instalaciones distintas. El archivo candidato los contiene en la misma transacción.
5. **NAP física:** sus triggers actuales liberan vínculos sólo en DELETE, que esta RPC no ejecuta. La capacidad liberada aquí es comercial, calculada por estado; se conserva el puerto y el vínculo histórico. No hay reciclaje físico automático ni cambios de aprovisionamiento.

No se detectó una incompatibilidad de firma/tipos que exija modificar 2620ed7. La validación es de catálogo más las pruebas locales existentes, no un ensayo de cambios reales.

## Artefacto exclusivamente de esta corrección

Producción sigue en base Git `c01b3ee29b7956925cf9face2ae718b88a038a05`, imagen frontend `sha256:a1f9defba1bca3aa20b111bf1a2a680b649eb125b452693357d99184ce9c56f7`, con directorio Git limpio y 118 archivos servidos.

Se contrastó el tar del último frontend publicado con esos 118 hashes. Se reconstruyó su fuente desde la base y las sobreescrituras **ya publicadas**, verificadas por hash. Sobre ella se aplicó únicamente el diff del commit 2620ed7 para estos siete archivos:

- `src/lib/napOccupancy.ts`
- `src/stores/contracts.ts`
- `src/stores/foFibra.ts`
- `src/types/domain.ts`
- `src/views/clientes/ClientDetailView.vue`
- `src/views/clientes/ClientServiceDetailView.vue`
- `src/views/zonas/ZonasView.vue`

Se verificó que ningún otro archivo versionado cambiara. **No se copiaron archivos completos desde HEAD ni se compiló el working tree.** Así quedan fuera las modificaciones anteriores no publicadas de baja global, ejecutor OLT y trabajos ajenos. Las pruebas y documentos de 2620ed7 no se publican como código de aplicación. El backend actual no cambia; la nueva operación usa RPC de sesión Supabase.

Build aislado vue-tsc/Vite: **PASS**. Pruebas reales de vista/store sobre esa fuente aislada: **5/5 PASS**, incluido rechazo de confirmación, permisos, llamada administrativa sin sincronizaciones y ausencia de fallback si la RPC no existe. Se comprobó que no entró `ClientRetirementDialog` de la fase global no aprobada. No se repitieron auditorías generales, pruebas operativas ni investigaciones OLT. La revisión visual en navegador sigue pendiente; las pruebas son de funciones aisladas y compilación.

Artefacto PC:

```text
scripts/inventory-auth-lab/runtime/contract-administrative-release-oyfuKh/frontend-dist.tar.gz
SHA256 37ccd55e18d5bd369b047122e39130254bc7df27cbda202ab2e842772e239ceb
```

SQL candidato copiado desde 2620ed7 al mismo staging local, sin ejecutar:

```text
contract-administrative-cancellation-proposal.sql
SHA256 adac9608cf1f068673fcb715fc43d7c32d42c8bb1d6e5d5b0b08e0ce15820ba3
contract-administrative-cancellation-rollback.sql
SHA256 46971c56a90007616e38832fc49f76c2d7b78725b8fdaa56ec7b9bc0e8834bef
```

Manifiesto completo de archivos/hashes: `CLIENTES-BAJA-PREFLIGHT.json`. El tar frontend no está copiado a producción ni se ha creado/activado una imagen nueva. Se usan los argumentos públicos VITE efectivos de producción; no hay `.env` en la fuente aislada.

## Respaldo recuperable

- PC: `scripts/inventory-auth-lab/runtime/contract-administrative-backup-clientes-20261024T051917Z`.
- VM: `/opt/smartrayco-staging/clientes-20261024T051917Z/backup`.
- Ocho archivos contrastados PC/VM: imagen frontend exacta, HTML, nginx, estado previo, override de rollback y tres Compose efectivos.
- Identidad OCI comprobada sin cargar/ejecutar imagen: 20 blobs, 31.082.815 bytes, todos los descriptores alcanzables verificados.
- Catálogo SQL previo guardado de forma privada en PC. Los cinco objetos candidatos no existen, por lo que el rollback de definiciones puede eliminarlos sin restaurar objetos previos. No se hizo dump de datos de clientes ni se copia/reescribe información operativa.

Las únicas escrituras remotas fueron copias de respaldo en staging; no se modificaron archivos del proyecto productivo ni contenedores. Tras el respaldo se releyeron imagen, hashes y contenedores frontend/backend/Caddy/Mongo/GenieACS: IDs, imágenes y fechas de inicio iguales; todos en ejecución. No se reinició ningún módulo.

## Procedimiento mínimo, sólo después de autorización

1. Revalidar inmediatamente antes de actuar: catálogo requerido, ausencia de objetos candidatos, propietario de instalación postgres, imagen/base actual, 118 hashes de baseline, Compose originales y hashes de artefacto/SQL/respaldo. Detener ante divergencias relevantes. Conservar el contexto privado y comprobar espacio/acceso al respaldo. Completar revisión visual local del candidato.
2. Acordar una ventana breve para la acción de baja y evitar confirmaciones durante el cambio; no detener módulos independientes. No usar fichas reales para una prueba de cancelación. Autorizar expresamente **SQL candidato + frontend**, no las fases anteriores.
3. Ejecutar exclusivamente `contract-administrative-cancellation-proposal.sql`, completo, con ON_ERROR_STOP y su BEGIN/COMMIT, como postgres. Si falla, dejar abortar y comprobar que no quedaron objetos parciales. No aplicar migraciones del repositorio ni RLS, inventario, equipo o SQL OLT. Verificar las ACL efectivas de la RPC/guardas antes de publicar el frontend.
4. Confirmar que PostgREST reconoce la función tras su actualización de caché de esquema; no invocar una baja de cliente real para comprobarlo. Preparar la imagen frontend desde el runtime actual, reemplazando sólo HTML/assets con el tar verificado y conservando nginx. Registrar nuevo ID, manifiesto y override exclusivos. No construir ni sustituir backend.
5. Activar sólo frontend con los Compose efectivos y el override candidato, `--no-deps --no-build --pull never`. No hacer pull/push, checkout de producción ni reiniciar otros servicios. Revalidar HTTPS/API, hashes, Clientes/Zonas/Prospectos y presencia de Nuevo cliente con lecturas; comprobar rechazo de la confirmación sin escrituras. Cancelar una línea real exige autorización individual posterior, no es parte del smoke test.
6. Revalidar que los servicios protegidos conservan sus identidades/fechas de inicio y que no se tocaron Janet–Estiven ni trabajos ajenos. Registrar resultado antes de habilitar la operación a usuarios.

No hay un script de activación ejecutado o invocado en esta preparación. Los helpers nuevos sólo permiten contexto, respaldo, build y validación.

## Rollback preparado

Mantener temporalmente detenidas las confirmaciones de baja y esperar las transacciones ya iniciadas. Usar la imagen exacta respaldada; si falta en Docker, recuperar con `docker load` desde `frontend.image.tar` tras verificar su hash. Aplicar el `rollback.override.json` con los mismos Compose **originales** registrados y recrear únicamente frontend con `--no-deps --no-build --pull never`. No ejecutar copias de Compose reubicadas sin revisar sus rutas relativas.

Revertir SQL, si se autoriza, sólo con `contract-administrative-cancellation-rollback.sql`: elimina los dos triggers y tres funciones nuevos, sin borrar estados ni historial. Si la instalación inicial falla dentro de la transacción, no compensar con escrituras de datos. No restaurar masivamente clientes/contratos desde un backup ni reactivar líneas canceladas tras el despliegue. La retirada de definiciones no revierte bajas comerciales ya confirmadas.

Mientras se retira la RPC, la interfaz candidata falla cerrada sin fallback. Si se restaura la interfaz anterior, mantener la acción de baja fuera de uso hasta resolver el motivo del rollback: su guardado genérico anterior no es una alternativa segura a esta RPC. No automatizar rollback que habilite ese camino sin revisión.

## Riesgos acotados y archivos de preparación

La garantía de «retirar sólo cuando no quedan vigentes/Altas» corresponde a **esta RPC individual**. Otras vías de edición de ficha preexistentes no se rediseñan ni se certifican como parte de esta entrega. Las nuevas guardas también rechazan transiciones/Altas incompatibles sobre fichas retiradas o contratos cancelados; un UPDATE que incluya los mismos campos de estado en una ficha heredada inconsistente puede recibir rechazo. No se corrigen los cuatro casos reales ni se modifica información existente al instalar definiciones.

Vínculos NAP sin estado verificable mantienen ocupación conservadora. Los paneles requieren refresco para cambios de otra sesión. La baja comercial no modifica servicios físicos ni garantiza que se apague un equipo. No se afirma cobertura del esquema productivo completo más allá del catálogo relevante leído.

Archivos nuevos de esta preparación: este informe, `CLIENTES-BAJA-PREFLIGHT.json`, los helpers `scripts/contract-administrative-{preflight-readonly.ps1,preflight-verify.mjs,release-context.mjs,release-prepare.mjs}` y sus dos recursos en `scripts/tests/contract-administrative-{preflight-readonly.sql,release-context.py}`. No se modificó la corrección 2620ed7 ni se creó otro commit. Datos privados, respaldo y artefacto permanecen fuera del versionado.

**Entrega lista para revisión/autorización técnica. Sin SQL candidato aplicado, migraciones, push, despliegue ni nueva investigación OLT.**
