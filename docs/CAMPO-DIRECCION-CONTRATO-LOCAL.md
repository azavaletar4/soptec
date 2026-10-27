# Campo: dirección del contrato seleccionado

Estado: corrección local en `fix/campo-direccion-contrato-local`, sin push ni
despliegue. Solo cambia la presentación compartida de Altas, Averías y Rutinas.

## Causa y relación verificada

La cabecera mostraba `trabajo.direccion`: dirección general en Altas, destino
libre en Rutinas y vacío en Averías. El GPS se resolvía por cada coordenada con
alternativas, y `loadClientInfo` podía escoger otro contrato cuando no encontraba
el vinculado. Esto permitía presentar una dirección y coordenadas de orígenes
distintos.

Metadatos productivos consultados exclusivamente en transacción de solo lectura,
sin consultar direcciones o identidades reales: `tickets`, `installations` y
`routines` tienen `client_id` hacia `clients.id` y `contract_id` hacia
`service_contracts.id`; el contrato tiene `client_id` hacia `clients.id`.
La dirección de Clientes → Contrato → Ubicación es
`service_contracts.installation_address`; el código es `contract_number` y su GPS
vive en `latitude`/`longitude`. Todos esos campos ya llegan mediante
`fetchContractsByClient`; `fetchClientById` ya trae la dirección general.

## Cambio puntual

- `fieldOrderLocation.ts` verifica ID de contrato e ID de cliente; no selecciona
  otro servicio por orden, estado o nombre. Devuelve dirección, origen, código y
  un par GPS completo del contrato vinculado.
- `CampoTrabajoDetailView.vue` reutiliza su tarjeta existente para los tres tipos
  de orden. Muestra el código y la dirección del contrato. Si está vacía o solo
  tiene espacios, usa la dirección general del cliente y lo indica expresamente.
- Si el contrato no está disponible o pertenece a otro cliente, informa que no
  pudo verificarlo y evita mostrar otro servicio o sus enlaces de navegación.
- Con contrato explícito sin GPS completo/válido, no ofrece Maps/Waze: no mezcla
  su dirección con coordenadas del cliente o de otro servicio. Si la dirección
  usa la alternativa general, el GPS sigue siendo exclusivamente del contrato.
- Sin contrato, conserva la dirección y resolución GPS anteriores, incluido el
  destino libre de las Rutinas. No agrega contratos por inferencia.

`activeContract`, la carga de datos y el contexto de cierre permanecen iguales;
`displayContract` y la resolución nueva son exclusivamente de presentación.
No cambia ejecución técnica, asignación, inventario, puntos ni persistencia GPS.
No requiere backend, SQL, permisos ni migraciones: reutiliza las lecturas actuales.

## Verificación focalizada

- 7 pruebas unitarias aprobadas: contrato exacto, alternativa, ausencia de ambas
  direcciones, contrato ajeno/ausente, GPS parcial/inválido, coordenadas cero,
  compatibilidad sin contrato y ausencia de mutaciones.
- 27 escenarios de la vista real en Chrome headless móvil 390×844, con 229
  comprobaciones aprobadas. Cliente ficticio con tres servicios, segundo/tercer
  contrato, dirección vacía, GPS parcial, contrato ausente/ajeno, error y demora
  de consulta, y orden sin contrato, para los tres tipos de trabajo.
- Enlaces Maps y Waze comprobados contra el GPS exacto; sin desborde horizontal,
  cero escrituras y conexiones externas bloqueadas. Capturas de tercer contrato
  y alternativa guardadas en `.env.a3-recovery/field-address-captures/` (privadas,
  excluidas de Git); inspeccionadas Alta/tercer contrato y Rutina/alternativa.
- `npm.cmd run build`: vue-tsc y Vite aprobados, advertencia habitual de chunks.

Comandos reproducibles:

```text
node --import tsx --test src/lib/__tests__/fieldOrderLocation.test.ts
node scripts/tests/field-address-browser.mjs
npm.cmd run build
```

Sin datos reales modificados, operaciones productivas, push o despliegue. La
publicación futura requiere autorización del propietario.
