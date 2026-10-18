# Detalle de producto al regresar a la pestaña

Base productiva: `dba2c67`. Corrección exclusivamente local; sin despliegue, push ni consultas a Cloud.

## Causa demostrada

`useInventoryStore` observaba `() => [auth.user?.id, auth.role]`. El callback de autenticación reemplaza `auth.user` al renovar la sesión. Aunque ID y rol no cambien, el getter produce otro array: Vue ejecuta el watcher, incrementa el epoch y vacía productos, categorías y álbumes.

`InventarioProductoView` obtenía el producto exclusivamente de esa lista y consultaba el servidor solo en `onMounted`. Al vaciarse el catálogo no volvía a consultar, y `v-if="!product"` mostraba «Producto no encontrado» tanto para una ausencia real como para una carga pendiente o un error. La carga inicial no capturaba rechazos.

Se reprodujo sobre el código del commit productivo en un servidor local aislado: abrir un producto con su equipo, reemplazar el objeto del mismo usuario como hace el callback de sesión, y comprobar catálogo vacío y «Producto no encontrado». No se necesitó alterar datos ni simular una eliminación.

## Corrección

- Observar ID y rol como dos fuentes de valores. Renovar el mismo usuario no borra el catálogo; cambiar usuario o rol sigue invalidando datos y respuestas anteriores.
- Leer el producto por el ID de ruta, también cuando cambia esa ruta o se recupera el contexto autorizado. No depender del álbum visitado previamente.
- Separar carga, error recuperable y respuesta confirmada sin fila visible. `maybeSingle` distingue cero filas de fallos de conexión, sesión o consulta; la interfaz no afirma que un producto fue eliminado.
- Mostrar mensaje y «Reintentar» ante fallos, manteniendo los datos cargados si siguen disponibles para el mismo contexto.
- Si una lista filtrada reemplaza temporalmente el catálogo compartido, ofrecer recuperación por ID sin mostrar una falsa eliminación ni dejar la pantalla vacía.
- Descartar publicaciones tardías de unidades y movimientos tras cambiar ruta, sesión o desmontar el detalle. Conservar `unit` y `returnTo` para el historial existente por serie/MAC.

No se modifican operaciones de inventario, conteos, asignaciones, Custodia, Conciliación, App de Campo, SQL ni permisos.

## Pruebas focalizadas

Script: `scripts/tests/inventory-product-resume-browser.mjs`. Chrome con Supabase/API simuladas y red operativa bloqueada. `--baseline` reproduce el fallo con la base productiva; ejecución normal valida la corrección; `--wait` añade tres minutos reales en otra pestaña. Las importaciones de stores son únicamente del servidor Vite local de pruebas.

Casos: renovación del mismo usuario, cuatro cambios de pestaña, URL directa, parámetro de equipo e historial existente, carga pendiente, HTTP 503, reintento, ausencia confirmada, cambio de producto sin remontar, respuesta anterior tardía, invalidación de permisos y recuperación, navegación Inventario–Álbum–Detalle–Conciliación y apertura de Custodia. Se exige cero excepciones del navegador y cero escrituras reales.

Las pruebas no equivalen a una reproducción con la sesión real del usuario ni prueban una pérdida real de conectividad: reproducen de forma controlada el mecanismo comprobado y sus errores de lectura. El servidor y la base de datos productivos permanecen sin cambios.

Resultado final sobre el candidato basado en producción: **PASS**, incluido retorno tras **180 segundos reales** en otra pestaña, cero excepciones y cero escrituras reales. Tipado `vue-tsc -b`, compilación Vite de 357 módulos y revisión de whitespace correctos. La compilación mantiene el aviso existente de tamaño de chunks. Custodia se comprobó con su RPC de lectura simulada y un equipo visible, y Conciliación con las cuatro clasificaciones existentes.

Para probar otro puerto Vite local, usar `PRODUCT_TEST_ORIGIN`; la validación final utilizó `http://127.0.0.1:5186`. Se reinició el servidor después de preparar y compilar el candidato para evitar recargas automáticas de HMR durante la espera. Una primera espera fue invalidada por esas recargas del entorno de prueba; no se contabiliza como resultado satisfactorio.

## Empaquetado

La rama de trabajo local general tiene un historial distinto del candidato productivo. El commit entregado se construye sobre `dba2c67`, incorporando exclusivamente los dos archivos de implementación, el test focalizado y este documento. Así conserva íntegros el selector desplegado y las protecciones de producción sin arrastrar commits ajenos. Los demás cambios locales no se incorporan ni se descartan.

Estado: **LISTO PARA DESPLEGAR**, pendiente de revisión y autorización. Producción permanece en `dba2c67`.
