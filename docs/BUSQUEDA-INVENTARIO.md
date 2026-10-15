# Búsqueda de inventario — cambio local, 15/10/2026

Antes: Inventario descargaba el catálogo al enfocar y filtraba nombres/categorías
en memoria; el álbum real filtraba solo nombres, y el virtual solo las unidades
ya cargadas. Una serie/MAC no permitía encontrar su producto desde el catálogo.

Después: ambas pantallas reutilizan el cliente Supabase de sesión y una consulta
compartida de solo lectura. Buscan nombres (incluidos marca/modelo cuando están
registrados allí), etiqueta heredada, series completas/parciales y MAC sin
distinción de mayúsculas, con/sin `:`, `-`, puntos o espacios. No se transforman
los datos guardados. Productos sin unidades siguen siendo resultados válidos.

Cada página devuelve hasta 25 productos y 25 unidades, con una fila adicional
por consulta para detectar la página siguiente y orden estable por ID. El filtro
del álbum real se aplica por category_id en ambas consultas; los virtuales por
estado. La consulta global no restringe categoría ni estado. El filtro por nombre
de producto también permite encontrar unidades dentro de álbumes virtuales.
Hay espera de 300 ms, cancelación y descarte de respuestas anteriores.

El detalle de unidad se abre sobre los resultados. La consulta y página se guardan
en URL y el enlace de regreso del producto conserva el álbum/búsqueda de origen.
La ficha consulta un solo producto por ID, incluso si el store tenía otro álbum.
Se conservan editar/eliminar y se actualizan resultados después de sus acciones.
La navegación sin búsqueda conserva su implementación previa.

Relaciones comprobadas en código y migraciones existentes:
inventory_units.product_id → inventory_products.id;
client_id → clients.id; contract_id → service_contracts.id.
Cliente y contrato se consultan por sus FK independientes, sin elegir un contrato
por cliente, serie, nombre ni historial. Se muestran únicamente las relaciones
visibles bajo RLS, con enlaces a sus fichas y código de contrato si existe.
No existe una columna de ubicación física en estas entidades: la dirección del
contrato se etiqueta expresamente como tal. No hay campos independientes de
marca, modelo o descripción: el texto disponible es name/category. Una marca o
modelo no registrado no puede encontrarse. No se añadieron tablas ni migraciones.

Archivos del cambio:

- src/lib/inventorySearch.ts: consultas paginadas y normalización de identificadores.
- src/components/inventario/InventorySearchResults.vue: resultados, detalle y navegación.
- src/views/inventario/InventarioView.vue: búsqueda global remota.
- src/views/inventario/InventarioAlbumView.vue: búsqueda acotada al álbum.
- src/stores/inventory.ts: carga puntual de producto.
- src/views/inventario/InventarioProductoView.vue: carga puntual y regreso al contexto.
- src/lib/__tests__/inventorySearch.test.ts: 15 pruebas de consulta con transporte simulado.
- scripts/tests/inventory-search-browser.mjs: navegador local con identidad/datos sintéticos.
- Este documento y una nota independiente en ESTADO_DESARROLLO.md.

Validación:

- `node --import tsx --test src/lib/__tests__/inventorySearch.test.ts`: 15/15.
  Cubre nombre/modelo, serie completa/parcial, MAC en distintos formatos,
  consultas sin filtro de estado/categoría, consumibles, asignados/disponibles,
  paginación, caracteres especiales, ausencia de resultados, rechazo RLS
  simulado y relaciones ocultas. Las respuestas simuladas no ejecutan SQL.
- `node scripts/tests/inventory-search-browser.mjs`: correcto. Interfaz general,
  modal, valores originales, contrato, regreso al contexto, categoría remota,
  consultas acotadas y vacío; cero excepciones. Usa Vite local en puerto 4179
  con VITE_SUPABASE_URL=https://inventory.invalid y clave sintética; intercepta
  peticiones externas y bloquea Supabase. No ejecuta acciones de inventario.
- `npm.cmd run build`: TypeScript/Vue y compilación de producción correctos.
  Aviso existente de paquetes grandes en Vite.
- `git diff --check`: correcto.

Pendiente antes de desplegar: comprobar consultas contra PostgREST de un entorno
de pruebas con el esquema real (incluidos imatch y OR sobre relación embebida),
probar identidades reales de los roles operativos y medir latencia con volumen
representativo. Las pruebas simuladas no certifican RLS desplegado ni semántica
SQL ejecutada. LIKE/regex pueden recorrer muchas filas sin índices de texto;
la paginación limita transferencia, no garantiza costo constante en servidor.
Si el rendimiento requiere un índice/RPC, demostrarlo y revisar por separado
antes de cambiar BD. No hay fallback que descargue todas las unidades.

No se tocaron cantidades, movimientos, asignaciones, estados, Altas, Averías,
Rutinas ni archivos de Fase 162. No se consultó ni modificó producción,
no se hicieron push ni despliegues. Los cambios ajenos preexistentes se conservan.
