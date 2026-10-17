# CORREGIDO EN PRODUCCIÓN — ONT de Ruber no aparecía en el Alta

17/10/2026, verificación posterior a las 17:20:54 de Perú. Frontend permanece en `9e435c9`; no se reconstruyó ni desplegó otra imagen.

## Hechos verificados en Cloud mediante SELECT READ ONLY

- Técnico: Ruber Pizango, perfil activo `TECNICO_RED`, responsable y líder de la cuadrilla del Alta de Angel Laneras Miguel.
- Alta `f8e62847-298f-4e0a-aab7-26e7437e3358`: `in_progress`, sin fecha de finalización, cliente y contrato explícitos. Existe otro técnico de apoyo en la misma cuadrilla.
- ONT: **HUAWEI HG8145X6-13**, serie **48575443DEB9F6B6**, MAC `E8-AC-23-9A-04-66`.
- Unidad `75767d43-b05a-4c46-8727-39c110940236`; producto `e7044a89-e793-42bd-8060-fbaad970c0af`.
- Estado `with_technician`, `custody_technician_id=d8574a9e-3929-4c26-b21e-e37ab10b6248` (Ruber); sin cliente, contrato u orden asignados todavía.
- Kardex: entrega confirmada `in_stock → with_technician` el 17/10/2026 a las **17:03:30 de Perú**, por `alex raico`, destinatario Ruber. No era una entrega pendiente ni un error de registro.

## Causa exacta

`CampoTrabajoDetailView.onInstallUnitProductChange()` solicita `available` al cliente contextual. Este llama `/api/campo-inventory/installation/:jobId/available?productId=...`; el backend ejecuta `inventory_order_read` con el JWT del solicitante y el contexto real de su orden.

La definición real en producción exigía exclusivamente `u.status='in_stock'`. Fase 164 ya admitía instalar un equipo `with_technician` del actor en la función de escritura, pero esa ampliación no se había incorporado a la función de lectura del selector. Por eso aparecían otras series libres de bodega y no la ONT entregada a Ruber.

## Corrección mínima aplicada

Solo `CREATE OR REPLACE` de **`inventory_order_read(text,uuid,text,integer,uuid,uuid,text)`**, conservando firma, ACL, contexto, autorizaciones de orden/cuadrilla, paginación y las demás vistas.

El predicado `available` mantiene producto activo/serializado, producto solicitado y ausencia de cliente/contrato/orden previos. Ahora permite:

1. `in_stock` con `custody_technician_id IS NULL`: bodega libre, como permitía el flujo existente.
2. Únicamente para una Alta: `with_technician` cuyo `custody_technician_id` coincide con `auth.uid()` del solicitante autorizado.

Nunca ofrece custodia ajena ni `pending_return`. Un técnico de apoyo no adquiere la custodia del líder por estar en la misma cuadrilla. Se conserva bodega compartida porque el flujo de Fase 164 y sus escrituras ya la permiten; imponer «solo custodia» sería un cambio operativo adicional que este hotfix no introduce.

La nueva condición se parametriza con el UUID del actor; no interpola identificadores externos en el SQL. No cambian las lecturas de Averías/Rutinas salvo la exclusión defensiva de una unidad inconsistente `in_stock` con custodio no nulo. No se modificaron funciones de escritura, RLS, grants ni estados.

Definición anterior MD5: `0726aa95888923bcb03b214942a13b58`.
Definición instalada MD5: `8cc863804104190ce7a3b9cfb67bf458`.
El parche exige la definición anterior exacta antes de reemplazarla; una deriva detiene la operación. La aplicación fue una transacción acotada con timeout de bloqueo de 2 segundos, sin DML operativo ni migraciones generales.

## Pruebas y postcheck

`node --import tsx --test server/tests/technicianCustodySelector.sql.test.ts`: **8/8 PASS**, PostgreSQL efímero sin red y datos simulados. Reproduce la exclusión anterior y valida la inclusión corregida, ACL intacta, denegación de lectura y uso por otro técnico de la misma cuadrilla, exclusión de devolución pendiente, producto/contexto/orden cerrada, compatibilidad de bodega y rollback exacto.

Instalación simulada desde custodia: el mismo `operation_id` devuelve el mismo recibo sin duplicar; un ID distinto no permite instalar de nuevo. Resultado: una unidad asignada, cero en custodia para esa unidad, un evento de asignación y un recibo, sin movimientos de consumibles, sin segundo descuento y sin cerrar el Alta. Se conservó el `current_stock` numérico del producto serializado: sus existencias físicas se obtienen de estados de unidades, no de restarlo como consumible.

Postcheck real en READ ONLY: unidad, custodia, Kardex y Alta idénticos antes/después. Definiciones de `campo_inventory_operation` y `apply_inventory_unit_event` idénticas. El predicado exacto corregido incluye la serie de Ruber y la excluye para el otro integrante de la cuadrilla. No se suplantó al usuario ni se ejecutó ninguna instalación real para probarlo; la ejecución completa de lectura/escritura se validó en laboratorio.

Evidencia segura: [postcheck](RUBER-ONT-CUSTODIA-VERIFICACION.json). Definiciones anteriores y registro de aplicación conservados en el runtime local ignorado por Git. No se copiaron credenciales al reporte.

## Respaldo y archivos

- Parche: `scripts/fix-campo-available-custody.sql`.
- Respaldo/rollback de la función anterior: `scripts/rollback-campo-available-custody.sql`, con guarda que exige la versión corregida antes de restaurar. SHA-256: `EC521901003727FAACA8FBE3D46F8CBC5F3B22A4A673F5D4BEE32B0246AB9038`.
- Aplicador privado: `scripts/apply-campo-available-custody-hotfix.ps1`, credencial DPAPI y TLS `verify-full`, sin mostrar secretos. Reaplicarlo se detiene por la guarda de versión.
- Prueba focalizada: `server/tests/technicianCustodySelector.sql.test.ts`.

## Acción para Ruber

Actualizar App de Campo o cambiar y volver a seleccionar **HUAWEI HG8145X6-13** para recargar las opciones. Debe ofrecer **48575443DEB9F6B6** bajo el contexto de Ruber. Ruber realiza la asignación y el cierre normales; no se instaló automáticamente ninguna ONT ni se cerró la orden artificialmente.

No se ejecutaron pruebas de escritura sobre datos reales, ni operaciones OLT/MikroTik. No hubo push ni despliegue de frontend/backend. Las mejoras visuales pendientes permanecen pausadas.
