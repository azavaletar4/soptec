# Dashboard V2 integrado en frontend local

**LISTO PARA REVISIÓN LOCAL ANTES DE PUBLICAR. No desplegado.**

El Dashboard real de Vue adopta V2: cabecera mínima, sin numeración decorativa,
PPPoE y ONT primero, Soporte al lado, franja de clientes/contratos, facturación,
registros de clientes y equipos, y Atención al final por categoría de severidad.
Se mantienen la marca Rayco y el layout de la aplicación.

Los datos del componente proceden exclusivamente del store `dashboard`, del
store `olt` para la navegación y del endpoint PPPoE existente. No se importan
fixtures ni archivos del prototipo en código de producto. Las capturas usan
respuestas de laboratorio, con cifras diferentes a las del prototipo, para
verificar los bindings sin consultar o exponer datos reales.

## Archivos de producto

| Archivo | Cambio |
| --- | --- |
| `src/views/DashboardView.vue` | Composición V2, fechas Perú, estados de lectura, adaptación móvil y navegación conservada |
| `src/components/dashboard/PppoeProfileCards.vue` | Presentación compartida de cuatro perfiles y filas en móvil; script de lectura intacto |
| `src/components/dashboard/dashboard-v2.css` | Estilos scoped del Dashboard, sin efectos en otros módulos |
| `src/components/dashboard/DashboardIcon.vue` | Seis iconos SVG locales, sin biblioteca nueva |

No se modificaron stores, contratos de datos, router, `AppLayout`, API/backend,
Supabase, MikroTik, configuración, dependencias ni módulos ajenos. La prueba de
contrato contrasta la base `45f993e`: once archivos intactos, once funciones o
valores conservados y el script PPPoE idéntico. Los umbrales de recaudo conservan
80/50; solo cambian los nombres de clases de sus colores.

## Ajustes y significado de los datos

- **Móvil hasta 700 px:** el gráfico financiero inicia contraído y se puede
  expandir/cerrar sin consultar datos. En escritorio se muestra abierto. Los
  clientes recientes pasan a tres; «Ver todos» conserva la ruta `/clientes`.
  En escritorio aparecen los cinco recibidos.
- Los tickets muestran tres recientes inicialmente y permiten ampliar a todos
  los recibidos por el store, sin nuevas lecturas. Cada fila conserva título,
  cliente, estado y navegación a su ticket.
- Las cifras PPPoE son las cuatro entradas de `/api/dashboard/pppoe-profiles`,
  con los nombres exactos ya definidos. Morosos no entra. Conectados permanece
  como cifra principal; registrados es independiente. La fecha común del lote
  sustituye las cuatro repeticiones visuales del mismo timestamp.
- PPPoE conserva 60 segundos desde completar la lectura, cancelación al salir,
  guardas de rol y protección frente a solapamientos. El backend y su caché RAM
  de 60 segundos no se tocaron. Actualizar el resumen general sigue siendo un
  circuito distinto de actualizar PPPoE.
- ONT autorizado sigue siendo online + offline. Señal baja no se suma como un
  tercer estado ni se añade sin autorizar. Se mantienen los filtros de una OLT
  y la navegación al listado cuando existen varias. Sin `checkedAt` no se
  presentan ceros de caché vacía como una lectura válida; se conserva la cantidad
  de OLTs activas y el aviso de ausencia de lectura. Escaneo parcial es explícito.
- Facturación conserva facturado, cobrado del mes, cobrado hoy, sin cobrar del
  mes, porcentaje de recaudo, vencidas y pendiente total. El gráfico conserva
  exactamente el cálculo de barras de las dos series existentes de seis meses.
  Se mantiene la distinción entre pendiente del mes y pendiente total.
- Equipos conserva totales, OK, caídos y sin probar para OLT y MikroTik. El
  encabezado dice **última prueba registrada**, no salud en vivo ni SLA. Sin
  pruebas o datos suficientes no declara la red sana.
- Atención presenta los urgentes, todos los equipos con problemas (nombre,
  tipo y host) y señal baja. Los accesos usan rutas/filtros existentes. No hay
  motor de eventos, prioridad automática, sumatoria global de alertas ni historial.
- Un error general conserva el resumen anterior, su fecha de éxito y un aviso
  de desactualización. En carga inicial no se inventan cifras. PPPoE mantiene
  de forma independiente sus estados actual, parcial, stale, error y sin datos;
  401/403 limpian sus valores y un rol no permitido no inicia su polling.

## Diferencias frente al prototipo

Se preservan sidebar, cabecera móvil, avisos y asistencia reales de `AppLayout`;
no se implementa el shell simplificado del prototipo. El modo claro se integra
sin añadir un sistema de temas global. No se incorpora el selector de escenarios
de muestra ni los diálogos ficticios: los accesos navegan a módulos reales.

Los importes conservan primero el redondeo `toFixed(2)` original y se presentan
con separadores `es-PE`, sin cambiar su valor. Se verifica el borde `1.005 → 1.00`.
El gráfico reutiliza el SVG real; no se incorpora una biblioteca ni la tabla
alternable adicional del prototipo. La última lectura PPPoE sigue mostrando
fecha completa y segundos. Las fechas de lectura se presentan en Perú.

## Pruebas y capturas

- `npm.cmd run build`: **PASS**, antes de modificar y sobre la versión final.
  Incluye `vue-tsc -b` y Vite. La advertencia previa de chunks mayores de 500 kB
  permanece en bibliotecas existentes; no se añadió ninguna dependencia.
- `node scripts/tests/dashboard-v2-contract.mjs`: **PASS**. Contrasta fuentes,
  consultas, permisos, polling y cálculos con la base previa.
- `node scripts/tests/dashboard-v2-browser.mjs`: **26 comprobaciones PASS**
  contra el frontend compilado servido en `127.0.0.1:5194`. Usa los stores reales
  con respuestas API/REST simuladas; no sustituye el store por cifras estáticas.
- La misma ejecución corre la regresión PPPoE existente: **16 comprobaciones
  PASS**, incluyendo 60 s, stale, parcial, errores, ausencia de datos,
  no solapamiento, cancelación, permisos y ausencia de escrituras.
- Tamaños: **320, 375, 390, 700, 834, 1024, 1440 y 1920 px**. Se verifican las
  tres filas móviles de clientes, colapso/expansión del gráfico, los cinco
  recientes accesibles, fechas Perú en un navegador con zona Tokio, estado sin
  caché OLT, red sin probar, listas vacías, carga inicial y error con datos previos.
- Cambiar tamaño, ampliar tickets o abrir el gráfico **no añade consultas**.
- Se verifican destinos y filtros mediante el router real; se cancela la
  transición en el laboratorio para no iniciar flujos de módulos fuera de alcance.
- Cero excepciones JS, intentos de escritura o acceso a servicios externos. Las
  fuentes Google preexistentes del HTML global se sustituyen por CSS vacío
  únicamente en el laboratorio. No se cambia esa configuración de la aplicación.

Capturas del build integrado en `docs/dashboard-v2-local/`:

- `desktop.png`: escritorio, gráfico abierto y cinco clientes recientes.
- `tablet.png`: tablet, con el layout global real.
- `mobile.png` y `mobile-full.png`: móvil, gráfico contraído y tres recientes.
- `mobile-chart-expanded.png`: gráfico expandido por el usuario.
- `summary-stale.png` y `initial-loading.png`: estados de lectura.
- `verification.json`, `pppoe-regression.json` y `contract-verification.json`:
  resultados reproducibles. Todas las imágenes están identificadas como locales
  y con datos simulados; no contienen clientes o lecturas de producción.

## Límites de las API actuales

`network-status` devuelve la última prueba guardada y no su antigüedad, por lo
que el Dashboard no puede garantizar conexión en vivo. `olt-summary` devuelve
agregados de caché y puede ser parcial o tener `checkedAt` nulo. La vista no
escanea equipos ni genera datos para completar esos huecos.

El resumen general conserva el `Promise.all` del store existente: un fallo en
sus endpoints puede impedir el resumen completo. Algunas consultas Supabase del
store ya usan `count ?? 0` o arrays vacíos ante respuestas sin datos; esta tarea
no modifica ese contrato ni promete distinguir todos los errores REST parciales.
Se representa el error general que el store expone y se conserva su último éxito.

Los permisos siguen siendo los actuales: el componente PPPoE oculta sus lecturas
a Facturación; los endpoints generales también pueden rechazar ese rol según
sus guards existentes. No se amplían autorizaciones para forzar la vista. Los
problemas de equipos no incluyen IDs de dispositivo, por eso el acceso abre el
listado OLT/MikroTik, sin inventar un destino individual.

El store recibe cinco recientes; «Ver todos» navega al módulo completo y no
solicita otra lista desde el Dashboard. No se realizaron pruebas autenticadas
contra producción ni operaciones de negocio reales. La validación es local.

## Seguridad y estado

Cero modificaciones o escrituras en Supabase, cero migraciones y cero consultas
o cambios MikroTik. No hay tablas, cron jobs, retención nueva, snapshots de red,
históricos PPPoE/OLT/MikroTik ni telemetría. El gráfico financiero utiliza los
datos existentes. No aumenta el almacenamiento de Supabase.

El commit de integración solo incluye estos cuatro archivos de producto,
pruebas y evidencia. No incluye los cambios preexistentes de otras tareas ni el
prototipo aún no versionado. Los temporales de autoría permanecen en el runtime
local ignorado y no son dependencia de la aplicación.

**LISTO para revisión local. No es una publicación ni un paquete de despliegue.**
Publicar requiere preparación aislada, comprobación de la base productiva y
una nueva autorización expresa. Esta tarea termina sin desplegar.
