# Dashboard V2 — ajustes finales locales

**LISTO para revisión final. No desplegado.** Base: `80e8e7e`.

## Cambios de producto

| Archivo | Ajuste |
| --- | --- |
| `src/components/dashboard/dashboard-v2.css` | En tablet de 768–1150 px, recupera 16 px por lado del padding del slot, dejando 16 px exteriores. Tipografía secundaria de ONT/Equipos y fechas de 11–12 px. Cabecera móvil permite separar consulta general y estado de red. |
| `src/components/dashboard/PppoeProfileCards.vue` | Tipografía secundaria de 11–12 px y registrados de 14 px en columnas/18 px en filas. Los perfiles usan filas si el panel tiene hasta 540 px, conservando cuatro columnas cuando hay espacio. Fecha real del lote visible bajo «Lectura PPPoE». |
| `src/views/DashboardView.vue` | La cabecera muestra la fecha/hora de la última consulta general exitosa. ONT presenta la fecha/hora de caché; Equipos declara que su fecha de prueba no está disponible. Año y segundos visibles en horario Perú. |

El sidebar y `AppLayout` permanecen intactos. La adaptación PPPoE usa consultas
CSS de contenedor, compatibles con los navegadores modernos; se verificó en
Chrome local, no en navegadores antiguos ni dispositivos físicos.

## Significado de las fechas

- **Dashboard:** `dashboard.lastUpdated`, actualizado únicamente al completar
  el resumen general con éxito. En carga o fallo conserva la última fecha
  exitosa e indica «Consultando» o «Sin actualizar».
- **PPPoE:** `lastSuccessAt` del endpoint existente, independiente de la consulta
  general. Se usa «Lectura disponible» para el estado `fresh` del servidor;
  no se presenta como una lectura nueva obtenida por el refresco general.
  Los estados parcial, desactualizado, error y ausencia de datos se conservan.
- **ONT:** `oltSummary.checkedAt`, identificado como caché. La API entrega la
  fecha más antigua entre las OLTs recibidas; no garantiza simultaneidad de
  todas las lecturas. Sin fecha válida se conserva la ausencia de lectura.
- **Equipos:** la API no proporciona timestamp de las pruebas registradas.
  Se indica «Fecha de prueba no disponible · No es monitoreo en vivo».

No se inventan umbrales de antigüedad ni se cambian reglas de lectura. Mostrar
una fecha antigua no la sustituye por la hora de consulta ni declara actualidad
en vivo. Una prueba específica conserva fechas de origen de 2001 tras un
refresco general exitoso.

## Validación

- `npm.cmd run build`: **PASS**, `vue-tsc -b` y Vite. Solo permanece la advertencia
  previa de chunks mayores de 500 kB; no se añadieron dependencias.
- `node scripts/tests/dashboard-v2-contract.mjs`: **PASS**. Once archivos de
  contrato/servicios/layout sin cambios, once funciones/valores originales
  conservados y script PPPoE idéntico. Contra `80e8e7e`, todas las declaraciones
  del script del Dashboard permanecen idénticas excepto los dos formatos de fecha.
- `node scripts/tests/dashboard-v2-browser.mjs`: **32 comprobaciones PASS**,
  más **16 PASS** de la regresión PPPoE existente, ejecutada por el mismo script.
- Anchos **320, 375, 390, 540, 700, 701, 767, 768, 820, 834, 950, 951, 1024,
  1150, 1151, 1440 y 1920 px**: sin desbordamiento de página ni Dashboard.
  En tablet se comprueban márgenes; desde 768 px, sidebar de 256 px en su
  posición original. Se espera su animación existente antes de medir.
- Comprobados gráfico móvil inicialmente contraído, tres clientes recientes,
  rutas/permisos, errores, lectura parcial, ausencia de caché y actualización
  independiente de cada circuito. Un fallo general conserva las fechas previas.
- Cambiar tamaño, expandir el gráfico o ampliar tickets no añade consultas.
  El laboratorio bloquea solicitudes externas y escrituras: **cero intentos de
  escritura, cero acceso a producción y cero excepciones JS**.

Se ajustaron únicamente los tres scripts de pruebas existentes para los nuevos
rótulos, comprobar los límites de ancho y separar las fechas de origen.

## Capturas y evidencia

En `docs/dashboard-v2-final-local/`, sin sobrescribir la evidencia anterior:

- `desktop.png`, `tablet.png` (834 px), `tablet-landscape.png` (1024 px).
- `mobile.png`, `mobile-full.png`, `mobile-chart-expanded.png`.
- `source-dates.png`, `summary-stale.png`, `initial-loading.png`.
- `verification.json`, `pppoe-regression.json`, `contract-verification.json`.

Capturas del frontend compilado, con respuestas simuladas y marca de laboratorio;
no contienen lecturas reales ni datos sensibles. La primera ejecución restringida
del navegador no avanzó y se interrumpió; la ejecución autorizada pudo completar
las pruebas. La medición inicial durante la animación del sidebar se corrigió en
el test esperando su estado final, sin alterar el producto.

## Alcance y preparación

Cero cambios en backend, Supabase, MikroTik, stores, API, rutas, permisos,
dependencias y otros módulos. Cero consultas a producción, escrituras, tablas,
migraciones, históricos o almacenamiento nuevo. Polling y caché RAM PPPoE de
60 segundos intactos. Cambios ajenos preexistentes excluidos del commit.

Se detiene el trabajo para revisión final; no se genera ni aplica un despliegue.
