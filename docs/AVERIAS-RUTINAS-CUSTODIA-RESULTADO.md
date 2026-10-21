# Averías y Rutinas — custodia personal en App de Campo

Resultado local: PASS. Base aislada `1b437935f7dc8544131d94ca570b6afff0b2a708`; rama `fix/averias-rutinas-custodia-20261020`. Sin push ni despliegue.

## Causa raíz y corrección mínima

`40cd396` ya filtra consumibles por saldo cuando la custodia está lista. No corrigió equipos: Campo mostraba todos los productos serializados y Rutinas los serializados activos; ambos consultaban `inventory_order_read(..., 'available')`. La función SQL vigente tiene una rama exclusiva de Altas para `with_technician` del actor; en Averías/Rutinas su rama heredada busca `in_stock` sin custodio. Es una lectura de bodega, no de equipos entregados al técnico. Además, el filtro anterior de materiales volvía al catálogo completo durante carga o error.

Esta corrección reutiliza `useTechnicianCustodyStore.fetchMyCustody()` / `my_inventory_custody()`, ya empleados por Altas. La RPC toma el técnico de la sesión, no del líder de cuadrilla, y devuelve exclusivamente su custodia.

- Averías/Rutinas toman los materiales con saldo positivo directamente de esa respuesta; no sustituyen una carga/error por catálogo general.
- Modelos y unidades se derivan de la custodia real, por ID de producto. No requieren que el modelo aparezca en el catálogo activo, una categoría concreta ni una coincidencia de nombres. Solo las unidades `with_technician` se ofrecen para entrar; se excluyen devoluciones pendientes y equipos ya ocupados. La RPC excluye equipos de almacén y de otros técnicos.
- Las opciones identifican modelo, serie y MAC disponibles. La selección se recarga antes de una instalación nueva; las respuestas de otro contexto/técnico no se utilizan para escribir.
- Los reintentos inciertos mantienen el mismo UUID y llegan al recibo existente aunque el primer intento ya haya ocupado la unidad. La corrección de un rechazo confirmado sigue usando los clientes de operación existentes. Averías refresca custodia también después de confirmar un pendiente.
- Altas conserva sus consultas, kit y reglas. No se modifica ninguna RPC, trigger, tabla ni validación SQL; no se necesita migración para esta corrección de selectores. Las operaciones actuales ya admiten custodia propia y rechazan custodia ajena.

También se revisaron los usos de escritorio: `RoutineInventory` es compartido por Campo y el modal de Rutinas; fuera de Campo conserva su modo de revisión sin habilitar nuevas escrituras. La ficha administrativa de Averías no es el selector entrante reportado.

## Archivos del candidato

Funcionales:

- `src/views/campo/CampoTrabajoDetailView.vue`
- `src/components/inventario/RoutineInventory.vue`
- `src/lib/fieldCustodyChoices.ts`

Pruebas:

- `src/lib/__tests__/fieldCustodyChoices.test.ts`
- `server/tests/fieldCustodyEquipment.sql.test.ts`
- `scripts/tests/field-custody-choices-browser.mjs`

Documentación y evidencia: este informe y `docs/evidencia-averias-rutinas-20261020/` (dos PNG y recibo de navegador). No incluye cambios OLT, contratos, facturación, migraciones o configuración productiva.

## Pruebas

| Comprobación | Resultado |
|---|---|
| TypeScript `vue-tsc -b` y `npm.cmd run build` | PASS |
| Selección, disponibilidad, refrescos, idempotencia y rechazos (7 archivos de pruebas frontend) | 67/67 PASS |
| `custodyRequiredMaterials.sql.test.ts` | 47/47 PASS, incluyendo padre y subpruebas |
| `installationCustodyOnly.sql.test.ts` | 8/8 PASS |
| Nueva `fieldCustodyEquipment.sql.test.ts` | 3/3 PASS |
| Navegador móvil con aplicación compilada real | 13 comprobaciones PASS, 0 excepciones |

125 pruebas Node/SQL aprobadas y 13 verificaciones del navegador. Las pruebas SQL corrieron en contenedores nuevos PostgreSQL 17, red `none` y datos en tmpfs, mediante Docker Desktop local (`npipe:////./pipe/dockerDesktopLinuxEngine`). Ninguna prueba usa consumos o inventario productivos.

El navegador usa una sesión sintética, respuestas interceptadas y bloqueo de solicitudes de API/Supabase fuera de las fixtures. Los POST de operación se simulan en memoria; no salen hacia servidores reales. Viewport 390 × 844.

Cobertura obligatoria:

- Con materiales/equipos: modelo en custodia ausente del catálogo general, serie y MAC propias visibles en ambos tipos de orden.
- Sin custodia: listas vacías y mensaje explícito; no catálogo como sustituto.
- Agotado: saldo 0 omitido; consumo excesivo rechazado por SQL y corrección 2 → 1 en formularios reales con el mismo UUID.
- Almacén/ajenos: nunca seleccionados desde la nueva fuente; SELECT real de `my_inventory_custody` y pruebas de escritura bajo otro integrante verifican el aislamiento.
- Cuadrillas: apoyo y líder con unidades diferentes; cada sesión ve/consume lo propio. RPC de ambos tipos rechaza instalar el equipo del otro.
- Equipos: operación real SQL aceptada desde custodia propia; reintento genera un único evento; desaparece de custodia disponible. Equipo de bodega permanece intacto en laboratorio.
- Respuesta de equipo perdida: el formulario recupera la operación con idéntico UUID, aunque la unidad ya no esté disponible, en Averías y Rutinas.
- Error al consultar custodia: no se presenta catálogo, se informa el error y Reintentar recupera la lista.
- Altas: selector original excluye bodega/ajenos/devolución; regresiones SQL de asignación, cierre, recibos y materiales pasan.

Incidencias del laboratorio resueltas: el invocador inicial de TypeScript utilizó una ruta Windows sin URL `file://`; se usó el loader normal `--import tsx`. La fixture SQL de Altas exigía hashes de definiciones con LF y falló con el checkout CRLF; se normalizaron temporalmente sus dos scripts en este worktree y se repitió solo esa regresión, que pasó. Se restauraron los saltos de línea originales: esos scripts no forman parte del diff. El verificador de navegador se corrigió durante su preparación y su última ejecución completa pasó. El build solo conserva la advertencia de tamaño de chunks, sin errores.

## Capturas

- [Avería móvil — equipo de custodia](evidencia-averias-rutinas-20261020/AVERIA-MOVIL.png)
- [Rutina móvil — materiales y equipo de custodia](evidencia-averias-rutinas-20261020/RUTINA-MOVIL.png)
- [Recibo de verificaciones del navegador](evidencia-averias-rutinas-20261020/BROWSER-RESULTADO.json)

Las imágenes contienen únicamente datos de laboratorio. El recibo de navegador puede conservar en su campo `out` la ruta anterior a archivar las capturas; los archivos entregados son los de esta carpeta de documentación.

## Riesgos y límites

- Pendiente revisión visual/funcional en Android real y autorización posterior para publicar. No se ha aplicado esta corrección en producción.
- Las restricciones existentes de escritura siguen vigentes: un producto desactivado o una orden sin autorización puede ser rechazado por el servidor aunque exista una custodia histórica. No se activan catálogos ni se reasignan equipos automáticamente.
- Las Rutinas sin cliente conservan su restricción existente para instalar/retirar equipos; sí permiten los materiales autorizados. No se vincula ningún cliente o contrato nuevo.
- La RPC heredada `available` para Averías/Rutinas sigue conservando su compatibilidad de bodega para clientes antiguos. La nueva UI no la usa para entrantes. Endurecer también ese acceso SQL heredado sería un alcance distinto con autorización de cambio en base de datos; esta corrección no lo oculta ni lo modifica.
- Saldo o disponibilidad pueden cambiar después de leer. El servidor conserva el bloqueo y la validación definitiva; no se confía en el selector para autorizar consumo.

Los 216 archivos pendientes se verificaron por hash y permanecen intactos. Main local y los demás worktrees no se modifican. Detenido tras preparar el candidato local para revisión.
