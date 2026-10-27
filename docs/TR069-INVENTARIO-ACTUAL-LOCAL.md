# TR-069: inventario actual separado del histórico

Estado: IMPLEMENTADO Y PROBADO LOCALMENTE. Pendiente de autorización productiva.
Rama independiente: `diagnostico/tr069-genieacs-readonly`.

## Causa comprobada y alcance

El diagnóstico previo confirmó cero dispositivos en NBI y dos registros antiguos
en `tr069_devices`. La sincronización solo insertaba/actualizaba los presentes;
la vista mostraba toda la tabla como si fuera el inventario actual de GenieACS.
La ausencia en ACS no eliminaba el registro local, lo cual es correcto para
conservar historia, pero faltaba distinguir presencia actual de caché histórica.
La sustitución de la ZTE por Huawei no justifica transferir automáticamente
la asociación del contrato. No se atribuye una causa al vaciado del ACS.

## Corrección

- `server/src/services/tr069Inventory.ts`: lectura NBI completa y sincronización
  por identidad ACS exacta. Exige HTTP 200, JSON válido, cabecera `total`, cantidad
  coincidente, IDs únicos y fechas válidas. Rechaza rangos, redirecciones,
  truncamientos y timeout. Segunda enumeración de IDs detecta cambios durante
  la lectura. Sin tareas CWMP ni cambios de parámetros.
- `server/src/routes/tr069sync.ts`: nuevo GET autenticado `/inventory`, sin
  escrituras. POST y scheduler reutilizan la lectura validada antes de escribir.
  Solo actualizan caché de presentes o insertan nuevos sin contrato; los ausentes
  no reciben ninguna escritura. Se conservan UUID, contratos, notas y métricas.
- `src/types/tr069Inventory.ts`, `src/lib/tr069Inventory.ts`, `src/stores/tr069.ts`:
  lista actual basada en NBI; históricos separados; registros no comprobados
  identificados explícitamente. Lectura paginada de Supabase. Las respuestas
  tardías no reemplazan una consulta más reciente. Un fallo conserva la última
  comprobación válida con advertencia; sin comprobación previa no se afirma
  presencia ni retirada. Registros creados después de la última comprobación
  quedan sin verificar.
- `src/views/tr069/Tr069View.vue`: inventario actual, fecha de comprobación y
  sección de históricos con contratos preservados. Huawei nueva visible antes
  de sincronizar, sin heredar contrato ni permitir acciones hasta registrarse
  localmente. Actualizar lista solo lee; sincronizar conserva el mecanismo
  explícito existente de altas/caché.

La cabecera `total` corresponde al contrato del NBI 1.2.16 ya identificado:
[fuente oficial de GenieACS](https://github.com/genieacs/genieacs/blob/v1.2.16/lib/nbi.ts).
Una respuesta sin esas garantías se trata como desconocida, nunca como vacía.
La comprobación describe dos lecturas consecutivas, no una transacción Mongo:
puede haber cambios posteriores y debe actualizarse la lista para observarlos.
Registrado en ACS no equivale a conectado en este instante.

Sin migraciones, eliminación de registros, desvinculaciones ni cambios de RLS.
La recolección programada de métricas existente no se modifica en esta fase;
puede seguir informando fallos para IDs antiguos, sin convertirlos en actuales.
No se alteran las acciones existentes sobre equipos ni otros módulos.

## Pruebas locales

- `node --import tsx --test server/tests/tr069Inventory.test.ts`: 22 aprobadas.
  ACS vacío, retirado, Huawei nueva, reaparición con asociación conservada,
  errores HTTP/timeout/incompletos/identidad cambiante, caché fallida y auth.
- `node scripts/tests/tr069-inventory-browser.mjs`: 29 comprobaciones aprobadas
  usando vista Vue y store reales, APIs ficticias y tráfico externo bloqueado.
  Comprueba históricos, contrato conservado, Huawei sin asociación heredada,
  sincronización ficticia, fallos, respuestas tardías y arranque sin NBI.
  Fixture: `scripts/tests/tr069-inventory-browser.html`.
- `npm run build`: aprobado (advertencia de tamaño de chunks).
- TypeScript del backend modificado: aprobado con `tsc --noEmit --target ES2022
  --module ESNext --moduleResolution Bundler --skipLibCheck --esModuleInterop
  server/src/routes/tr069sync.ts`.
- `git diff --check`: aprobado.

Datos ficticios; sin conexiones productivas, migraciones, despliegues, tareas
ACS ni cambios en ONTs, OLT o MikroTik durante esta implementación.

## Propuesta de activación (no ejecutada)

1. Con autorización, revalidar versiones e imágenes activas, cadena completa de
   overrides, acceso NBI y respaldos recuperables de backend y frontend.
2. Preparar backend con únicamente el cambio TR-069 sobre la versión productiva
   vigente y frontend correspondiente. Esta corrección requiere ambos: un
   despliegue exclusivamente frontend no basta. No desplegar toda esta rama
   sobre producción sin comparar contra el backend vigente.
3. Promover backend primero y comprobar GET autenticado y total NBI; después
   frontend. No SQL ni cambios de configuración ACS o de equipos.
4. Verificar lectura: cero actuales si NBI sigue vacío, dos históricos con sus
   asociaciones intactas; no ejecutar sincronización manual ni tareas de equipos
   como parte de la verificación. Una Huawei aparecerá solo si se registra
   realmente en ACS, con identidad propia; su vinculación seguirá siendo manual.
5. Ante fallos, detenerse y evaluar rollback de imágenes. Como no hay cambios
   de esquema ni eliminación de historia, no requiere restaurar datos.

Pendiente: comprobar la integración desplegada y el registro real de Huawei con
autorización separada. Las pruebas locales no certifican conectividad CWMP real.
