# Baja definitiva de Clientes — preparada localmente, no activada

Estado: **DETENIDA PARA REVISIÓN DE SQL/RLS Y FUNCIÓN COMPARTIDA DE REACTIVACIÓN**. No se cambiaron las cuatro fichas revisadas ni ningún dato operativo. Sin migraciones, push o despliegue. El SQL de `docs/sql` es una propuesta explícita, fuera del directorio de migraciones; sólo se ensayó en PostgreSQL efímero con datos sintéticos y sin red.

## Causa raíz y flujo real

`ClientDetailView.handleClientStatusChange` enviaba `clientsStore.updateClient(id,{status})`. El formulario de edición en `ClientesView` también guardaba `clients.status` directamente. Ninguno incluía contratos en la misma operación. La policy desplegada `clients_staff_only FOR ALL` admitía esas actualizaciones para staff: ocultar una opción no resolvería el problema.

Los contratos tienen `active`, `suspended`, `cancelled`. Las Altas abiertas son `pending`, `scheduled`, `in_progress`. La lectura de catálogo limitada a `clients`, `service_contracts`, `installations` confirmó que cambiar estados de cliente/contrato sólo dispara sus timestamps; sus disparadores de liberación NAP actúan al **eliminar**, no al cancelar. En cambio, cancelar una instalación puede devolver inventario y cerrar sesiones de trabajo mediante triggers existentes. Por eso esta propuesta **bloquea ante cualquier Alta abierta y nunca cancela órdenes automáticamente**.

Además, el pago de una factura puede llamar a `reactivateContract` en `debtHoldService.ts`. Esa función no comprobaba contrato cancelado/ficha retirada antes de aplicar perfiles OLT/MikroTik. Se prepara una guarda local en ese punto compartido, antes de cualquier comando. No se cambia el registro del pago ni se ejecuta la función contra servicios reales.

## Comportamiento preparado

1. Seleccionar Baja en la edición de Clientes o en la ficha abre un diálogo compartido. No guarda primero el estado. Un cliente nuevo se crea sin Baja; el retiro se revisa sobre una ficha existente.
2. El backend consulta una vista previa con JWT del operador: titular, **todos** sus contratos, activos/suspendidos a cancelar, vínculos PPPoE/ONT/IPTV, equipos vinculados y Altas abiertas. No entrega credenciales.
3. Se muestran números/códigos/estado de cada contrato y total afectado; un checkbox obliga a confirmar explícitamente todos, también en clientes de varias líneas. Cancelar/cerrar el diálogo no envía POST de baja. Cambios de contacto no guardados se tramitan por separado.
4. Si hay Altas abiertas, se deshabilita confirmar. El servidor SQL vuelve a comprobarlo: ni una vista previa antigua ni una llamada directa permiten omitir ese bloqueo. Resolver el Alta exige usar su flujo autorizado, sin cancelarla por esta operación.
5. Confirmar envía token de revisión, IDs exactos de los contratos no cancelados y confirmación explícita. No se confía en números ni estados enviados por el navegador.
6. En una sola transacción, PostgreSQL valida operador activo ADMIN/SUPERADMIN, bloquea perfil/ficha/contratos/órdenes relevantes, vuelve a leer los datos y compara token/lista. Cambios concurrentes invalidan la confirmación. Cancela únicamente contratos `active`/`suspended` del titular y marca `clients.status=retired`. Los ya cancelados no se vuelven a actualizar.
7. Cualquier fallo revierte contratos, ficha y timestamps. No hay fallback a dos llamadas separadas ni reintento automático. Ante respuesta perdida, el mensaje pide recargar para determinar si hubo commit antes de volver a confirmar.
8. El resultado avisa que la baja es comercial y la revisión de red/equipos queda pendiente. No ejecuta ONT, PPPoE, IPTV, Telnet, SSH, OLT/MikroTik, devoluciones, liberación NAP ni reasignaciones. No crea una tarea de red automática.

Se conservan facturas, deudas, pagos, órdenes, prospectos, equipos y demás registros. No se pone saldo cero, no se exonera ni elimina nada. Cancelar un servicio individual continúa siendo una operación sobre ese contrato; si otros siguen activos/suspendidos, el titular conserva su estado y sigue vigente en el clasificador. No se reemplaza ese flujo por una baja total.

La ficha retirada muestra sus tarjetas de contratos/historial en lugar de dejar visible un formulario embebido con el contrato anterior en caché. Los links de consulta siguen disponibles. Un error de refresco después de una baja confirmada se informa como tal, sin simular que la transacción falló.

## Permisos y garantías de base de datos propuestos

- Frontend: Baja y confirmación sólo ADMIN/SUPERADMIN; el store rechaza las transiciones directas a Baja. El contacto de fichas históricas retiradas sigue editable según permisos preexistentes.
- Backend: nuevas rutas GET/POST `/api/clients/:id/retirement`, con autenticación habitual y rol explícito. La sesión se reenvía a Supabase con anon key + JWT del operador; **no** se usa service_role para el RPC.
- SQL: ejecutables de preview/commit sólo `authenticated`; revocados de PUBLIC, anon y service_role. Ambos consultan el perfil real activo. El commit bloquea ese perfil para que una revocación concurrente no deje operar sólo por la caché del middleware.
- Dos policies **RESTRICTIVE** nuevas complementan las existentes; no se sustituye `current_user_role` ni se reescriben las policies actuales. Protegen la transición nueva y la creación directa de fichas en Baja.
- Un trigger rechaza marcar la ficha en Baja fuera del RPC, incluso siendo ADMIN y falsificando el GUC de contexto. Se exige además ejecución con el propietario del RPC; el contexto por sí solo no autoriza.
- Triggers en contratos/Altas serializan nuevas líneas y estados con el titular; impiden añadir/activar servicios o abrir Altas para retirados. Cuando RLS impide validar el padre, fallan cerrados. No reparan filas históricas ni bloquean cambios de contacto de fichas ya retiradas.
- La propuesta contiene **6 funciones nuevas, 3 triggers y 2 policies**; no ejecuta UPDATE masivo alguno al instalarse ni crea contratos. No hay migración en `supabase/migrations`.

## Función compartida: revisión obligatoria antes de activar

`reactivateContract` recibe una validación local de estado contractual y ficha antes de tocar red. Si contrato cancelado/ficha retirada, rechaza reactivar; el endpoint de pago existente ya conserva el pago y reporta separadamente el resultado de reactivación. Ficha desconocida también falla cerrada. La reactivación normal de un servicio suspendido y ficha no retirada conserva su camino anterior.

Esta guarda es parte necesaria de la propuesta, **no debe omitirse al preparar el backend**. Cambia una función compartida por cobro y reactivación manual: exige revisión e integración con ese flujo antes de activar, como indicó el usuario. No se modificaron las rutas de facturación ni se ejecutaron pagos reales.

Los controles de red existentes no son una transacción distribuida con PostgreSQL. Una reactivación que ya hubiera pasado su validación y estuviera en vuelo antes de la baja necesita coordinación operativa; no se afirma resolver esa carrera mediante una simple comprobación previa. Antes de activar debe revisarse la exclusión con operaciones de red/cobro en curso. La conciliación MikroTik existente sólo reporta discrepancias de habilitación y no hace un corte por el nuevo `cancelled`; no se altera ese servicio.

## Archivos de la mejora

Funcionales:

- `src/components/clientes/ClientRetirementDialog.vue` — confirmación, bloqueo, advertencias y resultado.
- `src/types/clientRetirement.ts` — contrato de preview/confirmación/resultado.
- `src/stores/clients.ts` — preview/commit por API y prohibición de Baja directa.
- `src/views/clientes/ClientesView.vue`, `ClientDetailView.vue` — dos puntos de entrada.
- `server/src/routes/clientRetirement.ts`, `server/src/index.ts` — endpoints de sesión y registro de ruta.
- `server/src/services/clientReactivationGuard.ts`, `debtHoldService.ts` — protección compartida contra reactivar bajas al pagar.
- `docs/sql/client-retirement-proposal.sql` y `client-retirement-rollback-proposal.sql` — propuestas, no ejecutadas en producción.

Validación:

- `server/tests/clientRetirement.fixture.sql`, `clientRetirement.sql.test.ts`, `clientRetirement.http.test.ts`, `clientRetirement.reactivation.test.ts`.
- `scripts/tests/clientes-lifecycle-browser.mjs --retirement` — modo adicional con API de baja completamente simulada; `--prospects` conserva su ensayo anterior.
- `scripts/client-retirement-metadata-readonly.ps1`, `scripts/tests/client-retirement-metadata-readonly.sql` — lectura de catálogo focalizada, sin filas de clientes.
- Este informe. Contexto privado, logs y builds temporales no se versionan ni forman un release publicable.

## Validación

| Prueba | Resultado |
| --- | --- |
| Éxito con activo+suspendido, contrato ya cancelado sin cambios | PASS, PostgreSQL sintético |
| Sin confirmación / lista parcial / IDs duplicados | PASS, rechazo sin cambios |
| ADMIN y SUPERADMIN; demás roles, inactivo, anon y service_role | PASS |
| Actualización directa y GUC falsificado; RLS independiente del trigger | PASS |
| Alta pendiente/programada/en curso; nueva Alta después de preview | PASS |
| Ficha o contrato cambiado; perfil desactivado tras preview | PASS |
| Fallo al actualizar ficha / fallo dentro del lote contractual | PASS, rollback byte a byte de estados/timestamps |
| Cancelar sólo un servicio con otro vigente | PASS, titular no se retira |
| Concurrencia al crear otro contrato | PASS, nunca Baja con contrato activo |
| Ficha sin contratos y órdenes cerradas | PASS, conserva historial |
| Datos sintéticos inconsistentes existentes no se corrigen al instalar propuesta | PASS |
| Contacto histórico y rollback de definiciones | PASS, conserva datos y retira sólo objetos nuevos |
| HTTP: rol, JWT reenviado, payload, permisos revocados, conflicto y SQL ausente | PASS, 4 pruebas |
| Reactivación compartida: bloquea antes de equipos/comandos; suspensión válida conserva validación anterior | PASS, 2 pruebas, fetch sintético y sin comandos |
| Chrome: lista y ficha, cancelar sin POST, dos contratos, checkbox, doble clic, Alta abierta, preview antigua, permisos y SQL ausente | PASS |
| Chrome: Prospectos/seguimiento/conversión preservados con espías | PASS |
| `npm run build` (frontend TypeScript + Vite) | PASS, aviso de tamaño de chunks |
| Typecheck focalizado backend con `--lib ES2022`, consistente con su tsconfig | PASS |
| Typecheck completo `tsconfig.server.json` | **FAIL fuera de esta mejora:** 5 diagnósticos en archivos ajenos no modificados: import `.ts` de `fieldInventory.test.ts`, unión de tipos de `oltProvisioningService.ts` y UUIDs en `custodyRequiredMaterials.sql.test.ts`. No se corrigen ni se incluyen esos archivos. |

No se valida una instalación de funciones sobre una copia completa de producción ni se ensayan pagos/red reales. Los ensayos SQL usan el rol real del proyecto y una fixture mínima, no un dump de clientes. Esas limitaciones no se presentan como certificación productiva.

Resultado final del comando focalizado `node --import tsx --test server/tests/clientRetirement.sql.test.ts server/tests/clientRetirement.http.test.ts server/tests/clientRetirement.reactivation.test.ts`: **23 PASS, 0 FAIL**. Los dos modos de navegador (`--retirement`, `--prospects`) también finalizaron PASS, con datos sintéticos y sin escrituras productivas.

## Riesgos y pasos de activación, todavía no autorizados

1. Revisar esta propuesta SQL, la guarda compartida de reactivación y su coordinación con cobros/comandos en vuelo. Aprobar expresamente funciones, triggers y policies nuevos; no tratar este archivo como una migración ya autorizada.
2. Revalidar sólo catálogo/propietarios de tablas y funciones pertinentes y conservar definiciones previas. Confirmar que las funciones SECURITY DEFINER pertenecen a un rol confiable y que sus ACL y search_path son los propuestos. Respaldo y rollback PC/VM de frontend/backend y definiciones, antes de activar.
3. Ensayar en staging con esquema completo, nuevas Altas, asignación de contratos, suspensión por deuda y pago histórico de un contrato cancelado. Revisar contención con transacciones de trabajadores: locks por titular, timeout de bloqueo de 3 segundos, posibles deadlocks/serialización que abortan sin cambios y se presentan como conflicto para nueva confirmación.
4. Construir backend/frontend aislados a partir de las versiones actuales de producción más **sólo** los archivos aprobados; no usar ni desplegar el working tree con trabajos ajenos. El `dist` compilado aquí sólo demuestra compilación local y no es artefacto de despliegue aprobado.
5. Tras autorización, instalar SQL y recargar la caché de esquema PostgREST según el procedimiento del entorno; después backend con la guarda compartida, y finalmente frontend. Hasta que SQL/API existan, la UI nueva falla cerrada y no intenta la actualización antigua.
6. Verificar con usuario autorizado, sin corregir automáticamente las cuatro fichas. Cada eventual baja de esos clientes requiere aprobación individual de sus contratos y de sus consecuencias.
7. Si se revierte la instalación, bloquear bajas durante el cambio y usar el SQL de rollback propuesto sólo tras comprobar definiciones. Quitar funciones no reactiva clientes ni contratos ya cancelados; no deshacer una baja comercial mediante UPDATE compensatorio. No retirar a ciegas la protección de reactivación por deuda de contratos ya cancelados.

**Detención:** preparado para revisión, con commit local; no aplicar SQL, publicar backend/frontend ni corregir clientes reales en esta fase. Reincorporación, recupero físico y acciones de red continúan separados y pendientes de autorización.
