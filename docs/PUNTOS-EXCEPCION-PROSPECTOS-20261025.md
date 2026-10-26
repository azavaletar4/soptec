# Excepción puntual: Alta automática de Prospectos con 0 inicial

Implementación preparada por autorización del propietario. **No aplicada ni desplegada en producción.** El riesgo de reapertura histórica sigue aceptado y sin corrección.

## Comportamiento

- Averías directas, Altas directas y Rutinas conservan sus reglas. No se cambia `requireWorkOrderPoints`, sus formularios ni el DTO/almacenamiento de las colas antiguas.
- La conversión nueva de un Prospecto crea su cliente, contrato y Alta con **0 puntos iniciales** en una sola RPC PostgreSQL: `convert_prospect_with_installation`.
- El servidor verifica al operador activo con los roles comerciales existentes, bloquea el Prospecto real y utiliza su plan/zona. No acepta un `allowZero`, origen, puntaje, precio o IDs de registros nuevos enviados por el navegador.
- La RPC inserta un recibo privado que vincula exactamente Prospecto, cliente, contrato y Alta. Los usuarios, `anon` y `service_role` no pueden escribirlo. La guarda solo admite el 0 de esa instalación y esas relaciones; no se permite volver de positivo a 0 ni trasladar el 0 a otra relación.
- ADMIN/SUPERADMIN debe asignar y confirmar puntos **mayores que 0** antes del cierre administrativo. Puede asignarlos con motivo y confirmar después, o asignar/auditar/confirmar en la misma llamada existente. Cero no confirma. El reparto y las guardas finales se conservan.
- La única ampliación de la protección de octubre es la transición 0 → positivo de esta Alta nueva acreditada por recibo. No se abre la edición de puntajes históricos ordinarios. Octubre sigue fuera del cómputo oficial; el corte del 01/11/2026 00:00 Lima no cambia.

El cálculo anterior de `points: 10` dentro de la conversión se sustituye por esta vía backend. Ninguna otra creación recibe un valor automático o una excepción.

## Atomicidad y duplicados

Se elimina del flujo de conversión la secuencia de tres escrituras independientes del navegador y el marcado posterior del Prospecto. Un error SQL, incluso al final, revierte cliente, contrato, Alta, recibo y estado del Prospecto juntos. El referente opcional conserva sus campos y defaults existentes dentro de la misma transacción; no se cambia su descuento ni código de facturación.

El bloqueo de la fila del Prospecto y el recibo con clave primaria impiden dos conversiones del mismo origen. Una respuesta perdida se recupera reintentando el mismo Prospecto/datos: devuelve los mismos IDs, sin crear otra ficha, contrato u orden. Datos diferentes sobre una conversión ya registrada producen conflicto, no una reconversión silenciosa.

La validación documental del backend conserva el criterio de la pantalla, sin distinguir mayúsculas y espacios exteriores. Las conversiones concurrentes de distintos Prospectos con el mismo documento normalizado se serializan; el segundo intento no crea datos parciales. Se conserva también la unicidad existente del documento. No se introduce unicidad de teléfono: el aviso y las excepciones de teléfonos compartidos siguen siendo los existentes.

El recibo y sus referencias se preservan para acreditar origen e idempotencia. Una conversión anterior sin recibo, una ficha previamente existente o una conversión parcial antigua no se adopta ni repara automáticamente; se rechaza y requiere revisión por la vía existente. No se actualizan registros históricos.

## Archivos

| Archivo | Cambio limitado |
| --- | --- |
| `supabase/migrations/20261024210000_prospect_conversion_initial_points.sql` | Candidata adicional: recibo privado, RPC atómica, guarda de origen y señal de revisión. |
| `src/stores/prospects.ts` | Invoca una sola RPC y valida el recibo; no escribe por separado cliente/contrato/Alta. |
| `src/views/clientes/ClientesView.vue` | Solo la rama de conversión pasa a la operación atómica; altas manuales/edición conservan su ruta. Permite recuperar el recibo tras respuesta perdida. |
| `src/components/soporte/WorkOrderPointsEditor.vue` | Permite asignar el cero pendiente acreditado por el servidor y explica el requisito antes de confirmar. |
| `src/lib/workOrderPoints.ts` | Tipo opcional `prospectPointsPending`; validadores y fórmulas intactos. |
| `server/tests/prospectConversionPoints.sql.test.ts` | Regresión de la excepción, permisos, atomicidad, concurrencia, cierre y recuperación del recibo. |
| `server/tests/prospectConversion.ui.test.mjs` | Wiring real de los handlers/stores, doble envío, respuesta perdida y visibilidad del editor. |
| Este informe, procedimiento de activación y referencia de preparación final | Evidencia y nuevo orden propuesto; sin ejecutar operaciones. |

No cambian los archivos de las tres candidatas anteriores, los stores de creación de órdenes, las vistas de creación directa, el backend Hono, Deuda o Facturación.

## Pruebas focalizadas

- `node --import tsx --test server/tests/prospectConversionPoints.sql.test.ts`: **10 PASS**, incluyendo el test padre y nueve casos. PostgreSQL 17 sin red, datos ficticios y SQL candidato instalado exclusivamente en laboratorio.
  - 0/nulo/negativo directos rechazados en Averías, Altas y Rutinas; positivos conservados.
  - Conversión autorizada en 0, plan y tarifa desde el Prospecto real; referente con defaults originales.
  - Reintentos y concurrencia del mismo Prospecto: mismos IDs y una sola conversión.
  - Prospectos distintos con documento equivalente: un éxito y un rechazo sin datos parciales.
  - Anónimo, técnico, inactivo, `service_role`, campos de origen/puntaje falsificados y escritura directa del recibo: rechazados.
  - Fallo tardío de FK: reversión completa y posterior reintento válido.
  - Cero no confirma; asignación positiva solo administrativa, auditoría 0 → positivo, reparto 6/6 y bloqueo definitivo conservados. Exclusión oficial de octubre comprobada.
  - Restauración de una copia sintética con recibos: se conserva su contenido, idempotencia, protección y asignación posterior. No se repite el respaldo/restauración reales ya aprobados.
- `node --test server/tests/prospectConversion.ui.test.mjs`: **6 PASS**. Se ejecuta el código de los handlers y del store extraído mediante AST, con dependencias aisladas: conversión sin escrituras múltiples, reintento tras respuesta perdida, doble envío, rutas directas intactas, recibo incompleto y permisos/flag del editor.
- `vue-tsc -b --pretty false`: PASS. Tipos frontend.
- `tsc -p tsconfig.server.json --pretty false`: PASS. Tipos backend/pruebas.

No son pruebas físicas Android ni una nueva certificación completa de Auth/Storage/Realtime. Se reutilizan las pruebas anteriores de puntos, firmas, colas y cierre; no se suman otra vez sus resultados.

## Artefacto acotado actualizado

Se preparó otra imagen sobre la base ya certificada contra los 120 archivos servidos, sin desplegar:

- Base VM: `b3790286c65ba6a00f759e8124e073e1b6ff6018`.
- Imagen candidata nueva: `sha256:2b3fbce9da951988afa06d0c562198fcf8af315e34ade046add2593a940558b0`.
- SHA-256 del archivo: `3a19cda26a3c916b61a1f92d4b7a89cbb31ff07b0435f08b423c50c2f443c617`.
- Copia PC ignorada: `scripts/inventory-auth-lab/runtime/points-prospect-certified-20261025.image.tar`.
- **22 fuentes**: las 20 de puntos/Campo previas, más Prospectos y únicamente la transformación de la conversión sobre el `ClientesView` desplegado. No se copió el `ClientesView` completo de main ni sus funciones ajenas. Todo el resto de la fuente, Nginx y backend se conservó. La imagen se inspeccionó sin iniciarla y se verificaron sus 17 blobs OCI y hashes PC/VM.

Las imágenes anteriores siguen conservadas, pero no contienen esta implementación; no deben usarse para activar la excepción.

## Pendientes de activación

1. Autorizar expresamente la ejecución productiva. Esta entrega autoriza preparación/publicación de código, no migración ni despliegue.
2. Preflight específico de la nueva candidata sobre el destino: dependencias, columnas/FK y restricción de Altas, nombres de las RPC, permisos, historial y guarda compartida. Ante deriva, detenerse.
3. Orden propuesto actualizado: **180000 → 190000 → 200000 → 210000**. Las tres originales permanecen intactas; 210000 es adicional. Aplicar solo esas versiones autorizadas y comprobar cada transacción, sin un push indiscriminado de SQL pendiente.
4. Coordinar la ventana y la publicación del artefacto acotado aprobado. Todos los operadores de conversión deben recargar al cliente nuevo: el formulario antiguo sigue siendo secuencial y no adquiere atomicidad por instalar la RPC. No vaciar IndexedDB ni colas. No habilitar la conversión nueva antes de tener 210000 y su RPC disponibles.
5. Conservar el respaldo recuperable y el procedimiento B1 ya documentados. Tras uso nuevo, una recuperación debe preservar también `prospect_conversion_receipts`; no quitar recibos, auditorías o confirmaciones para forzar reintentos.
6. Pruebas físicas Android a cargo del propietario y comprobaciones de la ventana autorizada. No se cerraron órdenes reales para probar.

Sin migraciones productivas, despliegues, datos reales modificados ni operaciones OLT/MikroTik. Los tres informes locales anteriores y los artefactos/harnesses privados de runtime no forman parte del commit.
