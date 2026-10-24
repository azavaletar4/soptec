# Baja administrativa de una línea — preparación local

Fecha: 2026-10-24. **PASS local de pruebas focalizadas y compilación. Sin aplicación SQL ni publicación productiva.** Se detiene el desarrollo/investigación del ejecutor OLT: sus archivos y pruebas anteriores no forman parte de esta corrección ni de su commit.

## Causa y corrección

El guardado genérico de un contrato podía cambiar `status` y después ejecutar sincronizaciones de perfiles/estado y asignación NAP. No era un camino exclusivamente administrativo. Además, el conteo NAP consideraba filas ocupadas sin excluir contratos cancelados; la ficha del titular se guardaba separadamente.

La baja ahora usa una rama separada, para ADMIN/SUPERADMIN, al seleccionar Cancelado. Muestra exactamente:

> Este contrato pasará a Cancelado y liberará su ocupación en la NAP. ¿Confirmar?

Si se rechaza, no llama al backend. Si se confirma, sólo envía el contrato seleccionado, su timestamp y la confirmación a la RPC de sesión Supabase `contract_cancel_administrative`. No guarda otros cambios pendientes del formulario como parte de la baja. No ejecuta las sincronizaciones ni desasigna la NAP. El guardado de un contrato ya cancelado tampoco ejecuta esas sincronizaciones después de guardar.

No existía una RPC de baja **individual** que actualizara también al titular en una transacción. Se prepara SQL nuevo, reutilizando el patrón seguro local de `38cec66`: perfil vigente en PostgreSQL, bloqueo del titular y sus contratos, timestamp de revisión, validación de Altas y transacción única. No depende de instalar la propuesta anterior de baja global ni del coordinador OLT.

## Transacción y permisos

`docs/sql/contract-administrative-cancellation-proposal.sql` es una **propuesta pendiente de autorización**, no una migración ejecutada en producción.

- Revalida ADMIN/SUPERADMIN activo y exige confirmación. No confía sólo en la opción deshabilitada de la interfaz. No concede ejecución a anon ni service_role.
- Bloquea titular, contratos e instalaciones; rechaza una ficha/contrato movido o timestamp obsoleto y una Alta abierta de la línea elegida.
- Actualiza **sólo ese contrato** a Cancelado. Las otras líneas y sus timestamps no cambian.
- Si queda un activo, la ficha queda Activo; si sólo quedan suspendidos, Suspendido. Ambos son vigentes bajo la clasificación existente de Clientes.
- Si no quedan servicios vigentes ni Altas abiertas, ficha Baja/retired. Si queda una Alta independiente abierta, conserva la relación comercial como Prospecto; no cancela esa orden ni retira una ficha con instalación pendiente.
- Contrato y estado de ficha se confirman juntos; cualquier error revierte toda la operación. No se mantienen contadores almacenados que pudieran quedar desfasados.
- Una repetición tras respuesta perdida, si ya está cancelado, devuelve el estado guardado sin repetir escrituras ni corregir retroactivamente otras fichas.
- Guardas de contratos impiden saltarse la confirmación con un UPDATE directo o un GUC falsificado; serializan altas de servicios con esta baja. Guardas de instalaciones rechazan nuevas Altas sobre contrato cancelado o titular retirado.
- No cambia políticas RLS existentes. La RPC SECURITY DEFINER tiene search_path fijo, permisos de ejecución acotados y validación explícita de actor. La compatibilidad con las guardas locales `38cec66` se prueba en laboratorio; no se propone activar aquella fase completa.

## NAP: una única regla comercial

`src/lib/napOccupancy.ts` concentra clasificación, deduplicación, conteo y colores. `countOcupadosReales` y `serviciosOcupados` delegan en `classifyNapServices`:

- Activo: verde, ocupa.
- Suspendido: ámbar, ocupa.
- Cancelado: gris, sólo historial, no ocupa.
- El mismo contrato no se cuenta dos veces; dos contratos del mismo cliente sí son dos servicios.
- Un vínculo sin estado verificable no libera capacidad silenciosamente: conserva ocupación y aparece Sin verificar. No se infiere la línea por el nombre del cliente.

Las consultas del store de fibra incluyen `service_contracts.status`. Zonas separa ocupación actual e historial expandible de cancelados, con enlaces a sus fichas. El total de zona y su validación en la ficha de servicio excluyen cancelados usando la regla común `occupiesCommercialCapacity`.

No se borra ni se cambia ninguna fila `fo_nap_puertos` por cancelar: se conserva su relación histórica. **La capacidad liberada es comercial; no se libera/reutiliza un puerto físico ni se cambia su asignación.** Los mecanismos de aprovisionamiento/asignación física existentes no se modifican. Una reasignación física futura sigue necesitando su propio flujo autorizado; no se garantiza reciclaje automático de esos registros históricos.

La ficha embebida comunica la cancelación al titular antes de refrescar Clientes, evitando mostrar una tarjeta con estado anterior al retirarse su última línea. Una falla del refresco informa «Baja confirmada» y pide recargar, sin inducir otra escritura. Si la RPC aún no existe, falla cerrada sin UPDATE alternativo.

## Pruebas ejecutadas

```text
node --test server/tests/contractAdministrativeCancellation.ui.test.mjs
node --import tsx --test server/tests/contractAdministrativeCancellation.sql.test.ts src/lib/__tests__/napOccupancy.test.ts
npm run build
```

| Comprobación | Resultado |
| --- | --- |
| Cancelar una línea: contrato cancelado y capacidad NAP disminuye | PASS, consulta SQL real sintética + regla común usada por UI |
| Suspensión mantiene ocupación y vigencia | PASS |
| Dos líneas: sólo cambia seleccionada, otra byte a byte intacta | PASS |
| Última línea sin ONT: ficha retirada y clasificación real de Clientes | PASS |
| Cancelados siguen vinculados y visibles en lista de historial calculada | PASS |
| Rechazar confirmación: sin RPC ni cambios de contrato/NAP | PASS, funciones reales de la vista aisladas |
| ADMIN/SUPERADMIN; demás roles, inactivo, anónimo, service_role, bypass directo | PASS |
| Alta abierta de la línea; Alta independiente; timestamp obsoleto | PASS |
| Fallo al actualizar ficha revierte contrato y timestamps | PASS |
| Cancelaciones comerciales concurrentes, idempotencia y rollback de definiciones | PASS |
| Ruta administrativa omite todas las sincronizaciones y desasignación NAP | PASS, funciones reales con stubs que fallan si se invocan |
| RPC no instalada: sin fallback; refresco fallido tras commit | PASS |
| Frontend vue-tsc y Vite | PASS; advertencia de tamaño de chunks, sin error |

Runner: **5/5 UI/store + 19/19 SQL/NAP**, incluidos un contenedor de nueve subpruebas SQL y nueve pruebas del helper NAP. No equivalen a validación visual en navegador: ésta queda pendiente para revisión previa a publicar.

PostgreSQL 17 efímero con `--network none` y tmpfs, sin credenciales/servicios reales. Se reutiliza la fixture sintética de la fase anterior; facturas/pagos/inventario histórico se representan por sentinelas, además de comprobar equipos, órdenes y vínculos NAP sintéticos sin mutación. No se certifica todo el esquema productivo ni se repite una auditoría general. tsx requirió ejecución autorizada fuera del sandbox por fallo de acceso a datos de usuario; no fue una conexión productiva.

## Archivos incluidos

- `src/lib/napOccupancy.ts`, `src/lib/__tests__/napOccupancy.test.ts`.
- `src/stores/contracts.ts`, `src/stores/foFibra.ts`, `src/types/domain.ts`.
- `src/views/clientes/ClientServiceDetailView.vue`, `src/views/clientes/ClientDetailView.vue`, `src/views/zonas/ZonasView.vue`.
- `docs/sql/contract-administrative-cancellation-proposal.sql`, `docs/sql/contract-administrative-cancellation-rollback.sql`.
- `server/tests/contractAdministrativeCancellation.sql.test.ts`, `server/tests/contractAdministrativeCancellation.ui.test.mjs`.
- Este informe. Commit local con sólo estos trece archivos; hash informado al entregar.

## Riesgos y activación pendiente

No se hace ninguna escritura productiva ni se corrigen los cuatro casos reales. Se conservan deudas, pagos, equipos, órdenes y vínculos históricos. No se cambia OLT, Telnet, MikroTik, PPPoE, ACS, TR-069 ni Janet–Estiven. Las operaciones de red quedan completamente fuera de esta corrección; no se afirma que una baja administrativa apague un servicio físico ni que cierre carreras de otro flujo operativo.

La propuesta añade RPC y guardas de consistencia comercial; requiere revisar el esquema/trigger efectivo del entorno destino antes de autorizar su instalación. Si hay una Alta abierta de la línea, se bloquea sin cambiar la orden. Los vínculos NAP ambiguos permanecen ocupados hasta revisión, no se limpian ni se corrigen automáticamente. Clientes/Zonas deben refrescarse para observar cambios de otras sesiones; no se introduce realtime nuevo.

La compilación del workspace valida código local pero incluye trabajos ajenos ya presentes: **dist no es un artefacto aprobado ni se incluye en el commit**. Una futura publicación deberá preparar un checkout/artefacto aislado de esta mejora; no publicar el working tree ni activar propuestas anteriores/ejecutor OLT.

Pasos futuros sujetos a aprobación: revisar/aprobar SQL candidato y rollback, verificar respaldo y consumidores de estados comerciales, instalar sólo las nuevas definiciones autorizadas y publicar frontend compatible aislado. Sin RPC, el frontend queda cerrado para esta operación. Rollback de definiciones elimina sólo objetos nuevos y conserva estados/historial; no reactiva contratos ni revierte bajas comerciales automáticamente. Mantener la acción deshabilitada/cerrada al retirar la RPC, sin restaurar el guardado genérico de baja con sincronizaciones.

**Entrega detenida antes de producción. Sin migraciones productivas, push ni despliegue.**
