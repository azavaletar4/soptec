# Continuidad de activación de Inventario

Actualización del responsable del 16/10/2026: rotación de credenciales aplazada,
sin bloquear por ese motivo la búsqueda. La preparación vigente y la base
operativa real comprobada por SSH se documentan en
`INVENTARIO-PRODUCCION-VENTANA.md`. El paquete sobre `ccdf94f` se conserva como
evidencia; el candidato vigente preserva las protecciones desplegadas de 592d282.

Revisión del 16/10/2026, desde `65bd12d`. **LISTO PARA AUTORIZAR** la
ejecución coordinada; este documento no autoriza cambios remotos.

## Estado recuperado

- HEAD recibido: `65bd12d`; 26 commits locales sobre la referencia local
  `origin/main` (`b128e42`). No se hizo fetch, push ni despliegue.
- Había dos documentos modificados y numerosos archivos sin seguimiento,
  incluidos `.claude/`, evidencias y scripts privados. Se conservaron. No se agregan
  esos archivos a este commit ni al manifiesto de activación.
- Se mantienen las 25/25 pruebas con JWT reales ya aprobadas. No se repitieron
  pruebas funcionales ni se reconstruyó el laboratorio.
- Cloud se comprobó únicamente por SELECT de catálogo en transacción READ ONLY:
  Fase 162 presente, Etapa 3 ausente, cierre RLS y RPC contextual ausentes,
  diez políticas previas presentes. Evidencia:
  `INVENTARIO-ACTIVACION-CONTINUIDAD-CLOUD.json`.
- Respaldo `activacion_final_completo_20261016_230124_a3f1e0d4` localizado:
  38.392.396 bytes; SHA-256 releído y coincidente con la evidencia original:
  `4248F4A3149AE24683012A8A9AE88B9D300F49DE71AE7045C297EAF00D2F5FDA`.
  Se conserva la restauración aislada aprobada; no se repitió. No contiene
  archivos de Storage ni claves externas de Vault ni atributos globales de roles.
- Los rollbacks SQL preparados siguen intactos. El de cierre RLS restituye
  las políticas previas, por lo que también restituye sus permisos amplios.

## Paquete y correcciones locales

La lista de Claude contiene **31 archivos, no 28**: cuatro backend, dos
migraciones y 25 frontend. `INVENTARIO-ACTIVACION-MANIFIESTO.json` fija sus
SHA-256. Todos coinciden con HEAD recibido, sin cambios locales en esas fuentes.
No se alteraron Fase 162, los ocho equipos históricos ni datos operativos.

El paquete local ya se construyó desde `ccdf94f` más esos 31 archivos y
`.dockerignore`, sin `.env` ni archivos sin seguimiento. Ruta y SHA-256:
`INVENTARIO-ACTIVACION-PAQUETE-LOCAL.json`; generador reproducible:
`scripts/prepare-inventory-selected-release.cjs`. No es un instalador autónomo
ni autoriza ejecutar las migraciones históricas incluidas en el árbol.

Corrección de base: `FASE161-DESPLIEGUE-RESULTADO.md` registra que el frontend
Fase 161 **sí se desplegó desde `ccdf94f`**, sin push. La referencia `origin/main`
no representa ese despliegue. Una comprobación nueva del paquete selectivo
con la base antigua `b128e42` encontró dependencia faltante `campoStore.returnRoutine`
en `CampoTrabajoDetailView.vue`. Se corrigió la preparación usando `ccdf94f`:
conserva los cinco archivos de Fase 161 como parte de la base existente, sin
eliminar sus avances ni incluir otra funcionalidad nueva. No se modificó ninguna
fuente de la aplicación. Antes de ejecutar, cotejar la imagen activa con esa
evidencia; no se consultó ni modificó el servidor operativo en esta revisión.

Corrección de empaquetado adicional: `.dockerignore` impide que `COPY . .`
de los Dockerfiles incorpore `.env`, logs, claves y el runtime privado del
laboratorio. No se reconstruyeron imágenes operativas. Imágenes previas podrían
conservar archivos copiados: revisar su eliminación controlada después de rotar,
sin borrar ahora imágenes que puedan necesitarse para recuperación.

## Exposición y rotación mínima preparada

Confirmado en el registro local de Claude
`4c73e045-a5fe-4c39-a3c3-73254ce3c4de.jsonl`, resultado de terminal del
16/10/2026 a las 22:50:42 UTC: una lectura de `.env` mostró valores privados.
No fue una impresión del script de respaldo. No se reproducen valores aquí.

| Credencial | Dependencia y alcance mínimo por autorizar |
| --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Cliente administrativo del backend en `server/src/lib/supabaseAdmin.ts`, tareas de Storage y utilerías privadas. Preparar reemplazo en los consumidores reales, verificar backend y retirar la clave anterior. Determinar primero si es la clave legacy ligada al secreto JWT: no rotar globalmente JWT sin evaluar sesiones y clave anon del frontend. |
| `SMARTOLT_API_TOKEN` | Integración SmartOLT del backend. Reemplazar la credencial y su configuración sin ejecutar comandos sobre OLT. |
| `PROXMOX_TOKEN_SECRET` | `server/src/proxmox/client.ts`; renovar el token limitado al mismo alcance y actualizar el backend. El identificador del token por sí solo no es secreto. |
| `XUI_PASSWORD` | `server/src/services/xuiService.ts`; coordinar cambio con los consumidores de la cuenta XUI y actualizar configuración del backend. Se lee al iniciar el módulo: requiere reinicio controlado. |

Los valores de `VITE_SUPABASE_ANON_KEY` son públicos por diseño; su aparición
en frontend no exige rotación independiente. En la salida examinada PostgreSQL
aparece como ruta `PGPASSWORD_DPAPI_FILE`, no como contraseña descifrada:
no hay evidencia en esa salida que justifique rotar la contraseña PostgreSQL.
No se accedió al secreto descifrado para esta investigación.

Los registros de Claude conservan las credenciales expuestas, incluidos registros
de sesiones anteriores. No se borraron ni modificaron: están fuera del workspace
y su limpieza debe coordinarse después de invalidar los valores. `.env` permanece
ignorado por Git. El escáner local compara valores actuales con archivos y diffs
de las 337 revisiones accesibles; no demuestra ausencia de secretos históricos
distintos o revocados. No se deben adjuntar los registros originales a incidencias.
Resultado del escaneo: ninguna coincidencia de los cuatro secretos privados
actuales en los diffs de esas revisiones. La única coincidencia histórica fue
el identificador de token Proxmox, que no permite autenticarse por sí solo.

`scripts/show-config-keys.cjs` sustituye las lecturas completas de `.env`: solo
imprime nombres y estado configurado/vacío. `scripts/check-inventory-secret-exposure.cjs`
solo informa nombres, rutas y commits, nunca valores. Los scripts privados de
respaldo revisados ya ocultan errores originales y secretos; no se modificaron.

## Qué falta para activar

1. Autorizar separadamente las rotaciones reales anteriores y coordinar su
   ejecución con los consumidores. Ninguna se ejecutó en esta revisión.
2. Autorizar las dos migraciones y el despliegue en una misma ventana con
   disponibilidad de rollback. Reconfirmar inmediatamente antes el estado
   de Cloud y las políticas/grants capturados; actualizar respaldo si hubo
   operaciones desde el respaldo verificado. La integridad del dump no garantiza
   que incluya escrituras posteriores.
3. Usar el release concreto preparado y cotejar la imagen base activa:
   `deploy/update.sh` hace
   `git pull` de toda la rama, por tanto no implementa la selección de 31 archivos.
   No autorizar un push indiscriminado de los 26 commits ni ejecutar un runner
   que reaplique Fase 161/162. Incluir `.dockerignore` como protección de build.
4. Aplicar Etapa 3, luego cierre RLS, desplegar frontend/backend compatible
   sin una pausa larga. La preparación de artefactos debe estar terminada antes
   de cerrar RLS; los postchecks de interfaz se hacen con el release compatible.
5. Verificar con sesiones reales ADMIN/SUPERADMIN y denegación al resto;
   lecturas y registros de Altas/Averías/Rutinas, revisión de oficina y rechazo
   al técnico retirado. Son comprobaciones de producción pendientes por diseño,
   no otra repetición del laboratorio.

Riesgos concretos: el hueco entre cierre RLS y despliegue impide temporalmente
el inventario en Campo; clientes web/WebView antiguos pueden necesitar recarga;
un despliegue de rama completa incorpora cambios excluidos del alcance;
las credenciales expuestas siguen utilizables hasta revocarlas. Si falla el
despliegue, revertir primero el cierre RLS con el SQL ya preparado, conservando
recibos y movimientos. No restaurar el dump sobre producción como primer recurso.

Validación local de esta entrega: sintaxis Node de las utilerías nuevas,
`git diff --check`, manifiesto sin duplicados y sin deriva de fuentes; consulta
mínima Cloud READ ONLY y hash del respaldo. El paquete aislado definitivo pasó
`vue-tsc -p tsconfig.app.json --noEmit` y `vite build` (342 módulos; aviso
de chunks grandes). Se verificó esta combinación nueva de fuentes, sin repetir
las pruebas funcionales aprobadas. El build local no lleva configuración de
producción: sus assets no deben desplegarse directamente; construir la imagen
autorizada con sus argumentos VITE vigentes. No se generaron ni desplegaron
imágenes de producción.
