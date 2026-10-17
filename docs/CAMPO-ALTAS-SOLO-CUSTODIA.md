# Selector de Altas: solo custodia propia — PREPARADO, NO DESPLEGADO

17/10/2026. La única consulta productiva de esta tarea fue `BEGIN READ ONLY`: definición y MD5 de las dos funciones implicadas, y estado de la instalación de Ángel. No se cambiaron RPC, datos, permisos ni imágenes en producción.

## Estado real y causa raíz

El commit local previo es **`dd4050b`** (el identificador `d4050b0` indicado en la solicitud no coincide con el historial local). Su hotfix **sí está aplicado en Cloud**: `inventory_order_read` conserva MD5 `8cc863804104190ce7a3b9cfb67bf458`. La función de escritura `campo_inventory_operation` tiene MD5 `4773080c559b58f51497e81f3b82f27e`.

El cambio anterior agregó custodia propia a la lectura, pero conservó explícitamente equipos libres `in_stock`. Por eso, al seleccionar Huawei siguen apareciendo series de bodega de ese producto. No significa que se estén ofreciendo todas las series instaladas o bajo custodia ajena: los filtros anteriores ya excluían esos casos.

El origen sigue siendo `onInstallUnitProductChange → fieldInventory.read(available) → /api/campo-inventory/installation/:id/available → inventory_order_read`, con el JWT del usuario. Además, el refresco general de inventario publicaba su propia respuesta `available` directamente en la lista, por lo que filtrar solo el manejador del producto habría sido insuficiente.

La escritura vigente también admite `in_stock`; ocultar esas series solo en Vue no cumpliría la nueva regla ante peticiones manipuladas o clientes antiguos. La instalación real de Ángel continúa `completed`. No se abrió, editó ni usó para probar escrituras.

## Cambios locales

- **Frontend:** filtra por producto, `with_technician`, `custody_technician_id` del actor y ausencia de vínculos previos. Quedan fuera almacén, devoluciones recibidas (`in_stock`), pendientes de devolución, instalados y custodia ajena. Un DTO antiguo sin custodio explícito se rechaza de forma segura; no se supone propietario.
- El mismo filtro se aplica a lecturas del producto y al refresco general. Generaciones de lectura descartan respuestas antiguas, incluso en cambios A → B → A. Cambios de sesión/token/contexto, ocultación/offline y desmontaje invalidan las listas mediante el controlador y las señales existentes.
- Botón **Actualizar mis series**, mensajes de custodia y consulta fresca antes de asignar. Si el equipo fue devuelto/instalado o dejó de estar disponible después de seleccionarlo, no se envía la asignación. No se persiste la lista en borradores ni se reconstruye desde caché local.
- Las Altas históricas no solicitan disponibilidad ni presentan formulario de nueva selección. Las funciones de cierre y las protecciones existentes permanecen sin cambios.
- **Parche SQL únicamente preparado:** `inventory_order_read` devuelve solo custodia propia para `available` de Altas y agrega el custodio al DTO de esa vista; Averías conserva bodega libre. `campo_inventory_operation` verifica la misma regla de asignación de Alta bajo el bloqueo existente de la unidad, antes de insertar el evento. No basta manipular serie/UUID, propietario o campos del payload.
- No se modifica la idempotencia: un recibo previo válido puede recuperarse sin escribir de nuevo, incluso si la orden ya cerró. Nuevas operaciones sobre órdenes cerradas continúan rechazadas. Las escrituras de Averías/Rutinas no cambian.

## Pruebas focalizadas

- `node --import tsx --test server/tests/installationCustodyOnly.sql.test.ts src/lib/__tests__/installationCustodySelector.test.ts`: **12/12 PASS**, PostgreSQL efímero sin red, fixtures exclusivamente. Cubren reproducción del hotfix anterior, custodios distintos en una misma cuadrilla, rechazo de peticiones con bodega/serie ajena, unidad instalada que desaparece, devolución pendiente/recibida, lista obsoleta, cierre válido e idempotencia, lectura y `stage` de Averías, preservación de ACL, rollback y reaplicación. Los casos frontend cubren sesión, datos sin custodio, respuesta antigua A → B → A y refresco global.
- `vue-tsc -b`: PASS.
- `vite build`: PASS; aviso de tamaño de chunks existente.
- `node scripts/tests/installation-custody-only-browser.mjs`, sobre bundle compilado servido en `127.0.0.1:5184`: **PASS**. Vista real de Campo, paso Instalación y red: Ruber simulado solo ve su serie; otro técnico simulado solo ve la suya; una respuesta mezclada no ofrece bodega/ajena/instalada/devolución. Si se revoca la disponibilidad antes de enviar, se repite la lectura y no se llama a la RPC de escritura. Cero excepciones y cero escrituras reales. Todas las llamadas operativas y de diagnóstico están simuladas o bloqueadas; el canal de avisos y los almacenes offline se inicializan en el perfil de prueba.

La prueba de cierre SQL valida el cambio normal de estado y la recuperación del recibo; no envía fotografías, firma ni una instalación real completa desde navegador. La prueba de navegador no suplantó usuarios productivos ni seleccionó la ONT real de Ruber.

## Archivos

- `src/views/campo/CampoTrabajoDetailView.vue`
- `src/types/fieldInventory.ts`
- `src/lib/installationCustodySelector.ts`
- `src/lib/__tests__/installationCustodySelector.test.ts`
- `server/tests/installationCustodyOnly.sql.test.ts`
- `scripts/tests/installation-custody-only-browser.mjs`
- `scripts/prepare-campo-installation-custody-only.sql`
- `scripts/rollback-campo-installation-custody-only.sql`
- Este documento.

## Activación posterior, pendiente de autorización

Requiere **parche de dos RPC existentes + despliegue frontend**. No requiere modificar backend TypeScript ni desplegar su imagen: la API existente transmite el DTO. No requiere nuevas tablas, columnas, estados, políticas, grants ni migración estructural. El script SQL no se ha ejecutado contra Cloud y no hay un aplicador automático incluido.

El parche y rollback exigen MD5 exactos de ambas funciones dentro de la misma transacción; cualquier deriva detiene todo. Preparado desde la definición real actual:

| Función | Actual en producción | Propuesta local |
| --- | --- | --- |
| `inventory_order_read` | `8cc863804104190ce7a3b9cfb67bf458` | `ee3caff47e2d49870faacd85faca9f0b` |
| `campo_inventory_operation` | `4773080c559b58f51497e81f3b82f27e` | `b1d5aeb3aad0f12cf3eaa1b0511929fc` |

Orden propuesto tras revisión: respaldar definiciones/imágenes, aplicar ambas funciones atómicamente, publicar frontend compatible y recargar Campo. El frontend nuevo necesita el custodio en el DTO; publicarlo sin el parche dejaría la lista vacía por seguridad. Sesiones con JavaScript antiguo reciben custodia propia al volver a consultar; una selección antigua de bodega se rechaza por la RPC. La nueva interfaz requiere recarga completa para sustituir código antiguo; el servidor protege la operación aunque el usuario no recargue.

Rollback propuesto: frontend anterior y luego el SQL de rollback exacto. El rollback restaura el comportamiento anterior, que admite bodega, por lo que exige una decisión operativa expresa. No se invoca automáticamente ni altera equipos u órdenes.

**Estado final: commit local preparado. Sin push, despliegue ni cambios productivos.**
