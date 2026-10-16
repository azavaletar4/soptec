# Etapa 4 integrada en Campo — LISTO PARA REVISIÓN

16/10/2026. Base `030043f`. Integración local, sin despliegue ni aprobación de
producción. Continúa la solución genérica aprobada en laboratorio; no reactiva
Broadcast ni el SSE contextual bloqueado.

## Comportamiento implementado

Altas y Averías usan `inventoryRefresh.ts` e `inventorySignals.ts`, promovidos
del comportamiento validado en laboratorio. El backend Hono sirve
`GET /api/inventory-signals`: reloj global por proceso, 10.000 ms y frame fijo
de 33 bytes `event: invalidate\ndata: {"v":1}\n\n`. Sin SQL, JWT, órdenes,
contadores, fechas, replay ni emisiones ligadas a escrituras. Es público porque
no contiene información operativa ni otorga acceso. Node omite `Date`; no hay
cookies ni ETag. Se corta una salida lenta sin esperar al cliente.

Cada señal recarga el snapshot autorizado de la orden visible: materiales,
catálogo contextual, asignados y pendientes en Averías; disponibles solo si
hay un producto seleccionado. Conserva la paginación del cliente existente.
No consulta tablas administrativas. Una sola carga concurrente; las señales
superpuestas se agrupan. Una escritura confirmada durante una lectura exige
otro snapshot y descarta el anterior. Los RPC, UUID persistentes y reglas de
etapa 3 se conservan.

Se eliminaron exclusivamente las suscripciones Campo a `inventory_movements`
y `inventory_units`. La suscripción existente a `job_assignees`, administración
y RoutineInventory siguen intactas. La cuadrilla vuelve a comprobar el acceso
si reaparece una asignación. No se cambiaron Rutinas ni Fase 162.

401/403 vacía catálogo, movimientos, unidades, selecciones y edición de
material; aborta lecturas y pausa siguientes consultas. El botón «Comprobar
acceso al inventario» realiza una comprobación autorizada nueva. Cambiar
actor/rol/token/cliente/contrato invalida la generación anterior. Logout y
respuestas tardías no restauran datos. La intención persistida de una escritura
no se elimina al perder conexión o sesión; su reintento sigue pasando por RPC.

Offline, pestaña oculta o caída del stream cancelan lecturas y limpian el
snapshot. Reconexión recarga, con espera 1–10 s y cancelación al desmontar.
WebView sin EventSource usa un reloj local de 10 s; no un canal operativo
alternativo. Firma, fotos y borrador de cierre no se borran por estos avisos.

## Pruebas ejecutadas en esta integración

| Comprobación | Resultado |
| --- | --- |
| `node --import tsx --test scripts/tests/inventory-integration.test.ts` | 5/5: agrupación, lectura posterior a escritura, 401/403, generaciones, slow consumer y fallback WebView/cleanup |
| `node --import tsx --test scripts/tests/inventory-signals-http.test.ts` | 1/1: adaptador HTTP real local; dos clientes, cuatro frames idénticos, intervalo medido 10.000 ms, sin Date/cookies/ETag |
| `node scripts/tests/inventory-integration-browser.mjs` | 2/2 escenarios compuestos, Alta y Avería, con el componente Vue real |
| `node scripts/tests/field-inventory-browser.mjs` | 4/4 regresiones afectadas: retiro/desvinculación normal y respuesta perdida, un commit ficticio y UUID estable |
| `node --import tsx --test src/lib/__tests__/fetchWithTimeout.test.ts` | 11/11; cancelación externa, timeout y body lento |
| `vue-tsc -b` y Vite build con configuración sintética | Aprobados; 341 módulos. Advertencia de chunks grandes de gráficas, ajena a esta integración |

Los escenarios del componente comprobaron un snapshot inicial por vista,
100 señales simultáneas sin duplicar lecturas, consumo de material y posterior
refresco sin duplicar POST, limpieza y pausa 401 y 403, reingreso, cambio de
usuario, descarte de respuesta en vuelo al logout, offline/reconexión y ausencia
de reconexión tras desmontar. Validaron carga de foto mediante su handler,
conservación de firma/foto/notas, validaciones de cierre y payload de cierre
con orden, contrato, firma y fotografía correctos.

**Alcance preciso:** estas regresiones Vue interceptan HTTP con datos ficticios
y sustituyen la persistencia del cierre; no certifican Storage, cámara Android
ni un cierre persistido real. El SSE HTTP usa un servidor local aislado que
importa únicamente la nueva ruta, nunca `server/src/index.ts` ni schedulers.
Los JWT reales y transacciones de las etapas previas ya aprobados no se
repitieron ni se presentan como pruebas nuevas de este harness.

El UA de navegador incluye Android/WebView/SmartRaycoApp y se probó el fallback
sin EventSource. **No hubo dispositivo/emulador en `adb devices`**: WebView
Flutter física, cámara, firma táctil y retorno de segundo plano nativo quedan
pendientes en una compilación dirigida exclusivamente al laboratorio. No se
abrió la APK que apunta a producción ni se cambió su URL.

## Archivos de esta entrega

- `src/views/campo/CampoTrabajoDetailView.vue`: integración, limpieza y retirada de listeners de filas.
- `src/lib/inventoryRefresh.ts`, `src/lib/inventorySignals.ts`: snapshot, sesiones y transporte.
- `src/lib/api.ts`: conserva el status HTTP en errores, sin cambiar mensajes ni contratos exitosos.
- `server/src/routes/inventorySignals.ts`, `server/src/index.ts`: ruta genérica y registro.
- `scripts/tests/field-inventory-harness.html`: fixture sintética ampliada.
- `scripts/tests/inventory-integration.test.ts`, `inventory-signals-http.test.ts`,
  `inventory-integration-browser.mjs`, `inventory-integration.vite.ts`: pruebas/configuración aisladas.
- Este documento y `INVENTARIO-RLS-ADMIN-PENDIENTE.md`.

## Límites y revisión de despliegue

- Frontend y backend deben revisarse/desplegarse coordinadamente; con un
  backend antiguo `/api/inventory-signals` no existe y el consumidor limpia
  inventario hasta reconectar. No se preparó ni ejecutó despliegue.
- Snapshot sin páginas adicionales: 3 GET por Alta y 4 por Avería cada 10 s
  visible (18/24 por minuto); disponible añade una consulta paginada. Una
  fuente SSE por vista, 33 bytes por tick más HTTP/TCP. La agrupación quedó
  medida; capacidad con toda la flota y proxy operativo siguen pendientes.
- Los timers del proceso/navegador pueden retrasarse; no se garantiza un SLA
  exacto de refresco. Inventario de otros técnicos puede tardar un tick más
  red; la autorización de cada consulta y escritura sigue siendo del servidor.
- El reloj público seguirá llegando a técnicos revocados; es deliberadamente
  indistinguible y no informa de su antigua orden. Limpieza visual al siguiente
  401/403, evento de sesión o pérdida de conectividad; no es revocación de
  bytes ya entregados ni protección de todas las vistas de la aplicación.
- La migración local de etapa 3 continúa sin aplicar en Cloud. El cierre RLS
  administrativo permanece pendiente y separado; ver el documento asociado.
- Ocho equipos históricos, datos reales y archivos ajenos permanecen intactos.

Rollback de esta entrega: revertir exclusivamente este commit local (fuentes,
ruta y pruebas). No requiere rollback SQL, porque no añade migraciones ni
modifica permisos. Antes de una eventual reversión desplegada, comprobar la
compatibilidad con las políticas que existan entonces; no restaurar listeners
antiguos bajo unas RLS futuras sin revisar esa compatibilidad.

No se ejecutaron auditorías generales, suites SQL previas, migraciones Cloud,
escrituras reales, push ni despliegue. Siguiente paso: revisión de este cambio
y pruebas nativas aisladas pendientes; no se inicia otra fase.
