# SmartRayco — Fase 2: correcciones de continuidad

Fecha: 2026-10-09. Base: fuente extraída y parche `fase-2-ronda2-trabajo-actual.diff` adjunto por el usuario. No se verificó un checkout del repositorio remoto. No se conectó al servidor privado, ni se aplicaron migraciones ni comandos en equipos reales.

## Cambios implementados

- El formulario envía el flujo de OLT, vínculo cliente/contrato/zona/NAP, MikroTik y WAN al backend; se elimina la segunda creación de secretos desde el navegador.
- La identidad de la operación incluye descripción, cliente, contrato, zona, NAP y los destinos/perfiles MikroTik/WAN. Las contraseñas quedan exclusivamente en la solicitud y closures; no se almacenan en `requested` ni en almacenamiento del navegador.
- La cola por dispositivo abarca toda la operación, además del bloqueo de sesión Telnet. Dos solicitudes concurrentes con la misma clave ejecutan una sola cadena en el proceso API actual.
- Se conservan las etapas solicitadas, aunque una reconciliación llegue sin credenciales. Esas etapas permanecen pendientes; no se declara `completed` por omisión.
- La reconciliación omite etapas BD/MikroTik/WAN ya confirmadas. El último resultado de cada etapa determina si se puede omitirla.
- Ante un fallo de persistencia de etapas o del ID elegido, se detiene la cadena. El ID se confirma en la base antes de escribir comandos de alta. Un fallo al guardar el resultado final devuelve HTTP 207 con advertencia.
- Una operación `completed` sin una ONT recuperable devuelve error. El frontend exige ONT, resultado OLT válido y operación completa sin advertencia de persistencia para mostrar éxito.
- Se protege una posición ONT ya asociada a otro serial, cliente o contrato; no se reinicia a `unknown` una ONT existente en un reintento.
- Creación MikroTik con PUT, sin reintentos automáticos de escritura, marcador de propiedad por clave de operación y lectura posterior para verificar perfil/activación/servicio. Una respuesta perdida se recupera consultando el marcador, sin crear nuevamente. Un usuario ajeno no se modifica.
- Se activa un secreto existente con `disabled=false`; el vínculo del contrato se guarda en esa misma etapa y se chequean errores.
- RPC transaccional para asignar NAP sin liberar la asignación anterior cuando la NAP destino está llena. Valida cliente/contrato y capacidad almacenada. Acceso exclusivo de service_role.
- Se redactan los valores secretos exactos de los errores persistidos y devueltos, incluso si contienen espacios.
- Se genera la clave también en HTTP LAN, donde `randomUUID` puede no estar disponible. Se conservan clave/operationId en localStorage; se consulta por clave tras perder la respuesta y al reabrir. El backend recupera los destinos persistidos y acepta únicamente las contraseñas nuevas en la reconciliación.

Referencia del método REST MikroTik: https://help.mikrotik.com/docs/spaces/ROS/pages/47579162/REST%2BAPI (PUT crea registros; PATCH modifica).

## Verificación realizada

El ZIP `SmartRayco_config.zip` del usuario permitió recuperar los archivos de configuración originales y el lockfile. Dependencias instaladas en la copia aislada con `npm ci --ignore-scripts --no-audit --no-fund`; no se cambió el lockfile ni se añadió PGlite al proyecto.

- `npm run build`: aprobado, incluyendo revisión estricta Vue/TypeScript y bundle Vite de producción.
- `npx --no-install tsc -p tsconfig.server.json`: aprobado, sin errores. Se añadió una comprobación explícita del ID de OLT en la nueva consulta por clave.
- 84 pruebas del código: aprobadas con las importaciones y dependencias reales del proyecto mediante `node --import tsx --test`, sin copias adaptadas para Node.
- 7 pruebas SQL: aprobadas en PostgreSQL WASM mediante PGlite, instalado en un directorio externo al proyecto y sin acceso a Supabase. Se aplicaron las migraciones 136, 136b y 136c sobre un esquema mínimo que reproduce las tablas/columnas utilizadas por sus funciones.
- Ambos parches se aplicaron a copias limpias de sus bases reconstruidas; sus archivos finales coinciden byte por byte con el paquete.

Las pruebas SQL cubren permisos de ejecución, cliente/contrato incompatibles, asignación idempotente, destino lleno sin pérdida del vínculo previo, traslado respetando puertos reservados/dañados, capacidad inválida y 40 agregados al historial. PGlite utiliza una sola conexión: esta prueba NO certifica bloqueos entre múltiples conexiones ni sustituye una integración con el esquema completo de Supabase.

Se restauraron en la copia de trabajo las importaciones originales sin `.ts` de las pruebas Telnet. La reconstrucción anterior había copiado adaptaciones temporales de esas pruebas. Esas adaptaciones no se incluyen en los parches entregados ni requieren modificar las pruebas Telnet originales del usuario.

Vite advierte sobre paquetes gráficos grandes (ApexCharts). El build termina correctamente; la optimización de esos paquetes queda fuera de esta fase.

No se ejecutó la aplicación con la sesión/autenticación real del usuario, ni se hicieron pruebas HTTP de las rutas con Hono completo y Supabase real. Las pruebas del handler ejercitan la orquestación que utilizan las rutas.

## Pendiente antes de desplegar

1. Obtener versión, estado Git y contenedores del servidor mediante comandos de solo lectura. Confirmar si allí está aplicada la fase 1 o también el trabajo de ronda 2; los parches son alternativas, nunca aplicar ambos.
2. Validar migraciones contra el esquema completo en una base aislada de Supabase, incluyendo concurrencia con varias conexiones y convivencia con las pantallas antiguas que escriben NAP.
3. Preparar respaldo, instrucciones y reversión antes de aplicar cambios. Mantener los archivos `.env` existentes y compilar usando la configuración del servidor; el paquete contiene fuente, no un bundle compilado con credenciales ajenas.
4. Presentar la revisión de esta fase para la aprobación del usuario antes de continuar de fase. Tras acordar la prueba del despliegue, utilizar exclusivamente la ONU de laboratorio; verificar credencial MikroTik, WAN y conectividad del abonado con el equipo real.

Referencia de PGlite: https://pglite.dev/docs/ (PostgreSQL WASM aislado, una conexión).

## Límites operativos

Los bloqueos de operación, OLT y router están en memoria y requieren una sola instancia del API, igual que el despliegue existente. No habilitar réplicas/cluster sin coordinación distribuida. Los bloqueos de la nueva RPC NAP coordinan llamadas a esa RPC; otras pantallas antiguas que escriben directamente puertos NAP conservan sus propios flujos y necesitan revisión aparte.

La verificación WAN actual confirma la ejecución Telnet sin error CLI; no certifica una sesión PPPoE conectada ni navegación del abonado. La prueba con equipo real sigue pendiente. El frontend recupera un intento por dispositivo y serial escaneado; el formulario manual conserva un intento manual activo por dispositivo.

No se modificó el servidor 192.168.55.201 ni se entregan contraseñas o claves SSH en el paquete.
