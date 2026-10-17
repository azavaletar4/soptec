# Inventario: interfaz y conciliación de solo lectura

Preparado localmente el 17/10/2026. Producción continúa en `b646757` (Fase 164 y mejoras de Custodia). No se desplegó ni hizo push.

## Interfaz

- Inicio: categorías separadas de ubicación/estado. Accesos a almacén, asignados a clientes, Custodia existente, pendientes de aprobación y conciliación. Se mantienen los cálculos originales del resumen; se explica que no son un conteo físico ni una cantidad de modelos.
- Álbum: distingue modelos/materiales de unidades físicas; cada modelo indica sus unidades en almacén. Búsqueda global existente conservada. Navegación al producto conserva el retorno al álbum y su búsqueda. Los estados de recojo y averías siguen en sus bandejas existentes.
- Detalle: búsqueda por serie, MAC o cliente, filtro de ubicación y paginación de 25 unidades. Los totales existentes se calculan sobre todas las unidades, no sobre el filtro. Se añaden indicadores de custodia y pendientes de aprobación sin cambiar los anteriores. El técnico se muestra por su FK verificada; la lectura adicional del perfil se solicita solamente en esta pantalla, conservando las consultas por defecto usadas por otros módulos.
- Serie/MAC y resultados de búsqueda abren el Kardex existente. No se creó otro Kardex ni otra Custodia.
- Confirmación antes de asignar, recibir/cambiar estado, marcar reparado, cambiar categoría o registrar movimientos de existencias. Las acciones y sus permisos existentes se conservan; no se ejecutó ninguna durante las pruebas. Las tarjetas de modelo permiten navegación con teclado.

## Fuentes reales identificadas en el código y las migraciones existentes

| Fuente | Relación verificable | Uso |
| --- | --- | --- |
| `inventory_units` | PK de unidad, producto, `client_id`, `contract_id`, `installation_id`, `custody_technician_id` | Estado vigente y vínculos explícitos |
| `inventory_products` / `inventory_categories` | FK de producto y categoría | Solo equipos serializados; filtros ONUs/ONTs, TV Box y otras categorías, sin inferir categoría por nombre |
| `clients`, `service_contracts`, `profiles` | FK desde la unidad; contrato contrastado con su cliente | Mostrar únicamente vínculos verificables |
| `installations` | `id`, cliente, contrato y estado | Contrastar vínculos y finalización; una orden finalizada por sí sola no confirma un equipo instalado |
| `work_order_closures` | `job_type=installation`, `job_id`, cliente y `ont_serial` | Posible coincidencia exacta de serial ONT con cierre de una orden finalizada y cliente coherente |
| `inventory_unit_events` | Kardex por `unit_id` ya existente | Consulta del historial en la ficha existente, sin duplicarlo en el reporte |

No se leyeron datos de OLT/MikroTik, fotografías/OCR, notas libres ni nombres similares para inferir identidad o ubicación. El campo `ont_serial` no se trata como un registro genérico de TV Box o MAC.

## Reporte disponible

Ruta administrativa: `/inventario/conciliacion`, con los mismos roles de Inventario (ADMIN/SUPERADMIN), guardia adicional de lectura y RLS existente. Solo SELECT; no agrega RPC ni utiliza credenciales privilegiadas.

| Clasificación | Criterio conservador |
| --- | --- |
| Instalación confirmada | Estado vigente `assigned`, cliente verificable, contrato/orden coherentes cuando existen, sin custodia simultánea ni identidad duplicada. Es confirmación documental de la asignación; no prueba física. |
| Custodia confirmada | Estado `with_technician` o `pending_return`, técnico verificable, sin cliente/contrato simultáneos ni identidad duplicada. |
| Posible coincidencia que requiere revisión | Serie/MAC duplicada entre unidades, serial ONT exacto en cierre histórico de instalación finalizada, o vínculos/estados insuficientes o contradictorios. Nunca cambia el estado registrado. |
| Ubicación sin verificar | No hay evidencia suficiente para confirmar ubicación vigente. Incluso un equipo registrado en almacén puede quedar aquí. |

Seriales: coincidencia completa, ignorando solo espacios exteriores y mayúsculas/minúsculas. MAC: 12 dígitos hexadecimales, normalizando separadores. No se usan coincidencias parciales para clasificar. La búsqueda visual sí permite texto parcial.

El reporte permite filtrar categoría, resultado, estado registrado y texto; resalta equipos en almacén con señales para revisión. Solo muestra cliente, contrato, orden o técnico si existe vínculo explícito verificable. Un cierre coincidente por serie no atribuye su cliente/contrato al equipo. Las coincidencias históricas no prevalecen sobre una asignación o custodia vigente coherente.

## Alcance y limitaciones

- No se consultó Supabase Cloud durante esta tarea. No se cuantificaron diferencias reales ni se identificaron equipos reales de Jadir. El reporte está preparado para lecturas con sesión administrativa cuando se publique posteriormente.
- En el escenario simulado de navegador: 4 unidades, una por cada clasificación; 1 ONT en almacén con serial coincidente en un cierre, señalada solo para revisión. La TV Box sin vínculos queda sin ubicación verificable. Estos números no describen producción.
- Las TV Box y otros equipos se contrastan mediante relaciones explícitas y duplicados de serie/MAC. No existe en las fuentes revisadas un serial genérico de TV Box en los cierres; no se interpreta `ont_serial` como tal. Una TV Box en almacén sin enlaces ni identificadores externos seguirá sin verificar. Incorporar otras evidencias de identidad requeriría revisar su origen y permisos posteriormente.
- Son lecturas de registros visibles por RLS, no un snapshot transaccional ni un conteo físico. Un origen oculto por RLS no permite inferir ausencia real. Errores de lectura, falta de total verificable, cambios del total entre páginas o más de 20 000 filas en una fuente impiden mostrar un reporte parcial. Se leen todas las páginas visibles y se contrastan con `count=exact`, incluso con límites de respuesta menores a 500.
- No se necesita cambio de tablas, RPC o políticas para el alcance implementado según el esquema existente. Si una fuente no es accesible en el entorno de destino, esa lectura se detendrá con error; cualquier ampliación de permisos o consulta del servidor requiere revisión posterior. No se crea ni aplica una migración.

## Validación focalizada

- `vue-tsc -b`: correcto.
- `vite build`: correcto; aviso de tamaño de chunks existente.
- 6 pruebas de conciliación + 3 pruebas existentes de Custodia: 9/9 PASS. Cubren cierres históricos, relaciones incoherentes, custodia, identidad duplicada, serial/MAC, categorías, conteos sin mutación, paginación, lectura fallida, límites y restricción de rol.
- Chrome sobre bundle compilado local: secciones de Inventario, navegación a álbum/detalle, filtros de unidad y reporte, cuatro clasificaciones, retorno desde Kardex, cancelación de cambio sensible y vista móvil (390 px): PASS. Falla simulada de lectura no muestra datos parciales. Cero excepciones y cero escrituras reales.
- Regresión de navegador de Custodia: selección automática/manual, actualización, historial Perú y acceso al Kardex: PASS.
- Evidencia visual local: [reporte en móvil](INVENTARIO-CONCILIACION-LOCAL.png). Para reproducir: `vite build`, `vite preview --host 127.0.0.1 --port 5184 --strictPort`, luego `node scripts/tests/inventory-reconciliation-browser.mjs`. Las respuestas de negocio son simuladas en el navegador y su red real está bloqueada.

No se modificaron existencias, movimientos, estados, contratos, órdenes, RPC, RLS, migraciones, Altas, Averías, Rutinas ni App de Campo. Los cambios ajenos presentes en el workspace quedaron fuera del commit de esta mejora.

## Archivos de esta mejora

- Vistas: `src/views/inventario/InventarioView.vue`, `InventarioAlbumView.vue`, `InventarioProductoView.vue`, nueva `InventarioConciliacionView.vue`.
- Componentes: `src/components/inventario/AlbumCard.vue`, `ProductGridCard.vue`, `InventorySearchResults.vue`.
- Navegación y lectura: `src/router/index.ts`, `src/stores/inventoryUnits.ts`.
- Lógica local: `src/lib/inventoryPresentation.ts`, `src/lib/inventoryReconciliation.ts`.
- Pruebas: `src/lib/__tests__/inventoryReconciliation.test.ts`, `scripts/tests/inventory-reconciliation-browser.mjs`.
- Documentación y evidencia: este documento y `docs/INVENTARIO-CONCILIACION-LOCAL.png`.
