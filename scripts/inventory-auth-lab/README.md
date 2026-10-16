# Laboratorio local de autorización de inventario

## Prototipo SSE: BLOQUEADO (16/10/2026)

Ver `docs/INVENTARIO-LAB-SSE-VALIDACION.md`: 8 PASS y un FAIL bloqueante con JWT
reales. Al pausar el backend, el timeout SQL libera locks; la revocación confirma
y el proceso reanuda escribiendo un aviso antes de procesar el error de sesión.
No integrar ni arrancar como transporte seguro. El servidor de ensayo quedó
detenido; la fixture y evidencia se conservan. No repetir `sse-prepare.mjs` ni
`sse-validate.mjs`. `sse-audit.mjs` verifica el estado final mediante solo lectura.
No hay cambios de aplicación ni dependencias nuevas. El prototipo no modifica
inventario ni conecta a Cloud; usa psql dentro del contenedor fijo del laboratorio.

## Etapa 4 Realtime: BLOQUEADO (16/10/2026)

Causa exacta y alternativa de entrega autorizada en servidor:
`docs/INVENTARIO-REALTIME-REVOCACION-ALTERNATIVA.md`. Broadcast por orden sigue
descartado como garantía de revocación inmediata. La alternativa SSE con barrera
SQL está propuesta, sin implementar ni validar; no repetir el ensayo previo.

Se añadió experimentalmente Realtime v2.143.3 en la red interna existente,
con Caddy en `127.0.0.1:54385` y WAL lógico solo en el DB local. Se conservan
volumen, Auth y fixtures. No está integrado en Campo. La policy por orden
autoriza el JOIN, pero el técnico retirado siguió recibiendo `{v:1}` en su
socket abierto aunque la reconsulta contextual ya respondía 403. No usar esta
configuración como seguridad aprobada ni trasladarla a Cloud.

Evidencia, pendientes y rollback en
`docs/INVENTARIO-LAB-REALTIME-VALIDACION.md`. No repetir automáticamente
`realtime-prepare.mjs` ni `realtime-revocation.mjs`: hay journal y fixture
conservados. `realtime-status.mjs` permite diagnóstico local sin mostrar claves.
Para iniciar/conservar también Realtime, usar ambos archivos de compose:
`runtime/compose.json` y `runtime/realtime-compose.json` con `--pull never`.
Los comandos originales de abajo describen el laboratorio Auth/API anterior.

Estado validado el 16/10/2026. No usa `.env` de la raíz, respaldos ni Cloud.

Servicios: PostgreSQL 17, GoTrue v2.197.0, PostgREST v14.18 y Caddy 2. Auth,
REST y DB solo están en una red Docker interna; Caddy publica los accesos
exclusivamente en 127.0.0.1. El proxy no tiene upstreams de producción.
Se reutilizaron PostgreSQL/Caddy y se descargaron solo Auth/PostgREST.

Documentación de configuración utilizada:
[compose oficial de Supabase](https://github.com/supabase/supabase/blob/master/docker/docker-compose.yml)
y [configuración JWK de Supabase Auth](https://github.com/supabase/auth/blob/master/internal/conf/jwk.go).

## Uso del entorno ya preparado

Abrir **http://127.0.0.1:54384/**. Elegir leader, support, outsider o removed y
pulsar «Iniciar sesión real». Las contraseñas son generadas, exclusivamente de
prueba; la pantalla las usa contra Auth local. No hay que enviarlas por chat.
Elegir Alta/Avería ficticia y consultar. Leader/support pueden consultar las dos
primeras órdenes; outsider tiene las dos órdenes ajenas; removed ya fue retirado
por la validación y debe recibir denegación.

No es toda la App de Campo: es una pantalla mínima con el store Auth real,
el cliente contextual real y las rutas/backend reales, sin inicializadores ni
servicios operativos de otros módulos. Por defecto no hay botones de mutación;
solo aparecen al habilitar explícitamente el modo transaccional local.

## Reiniciar tras apagar el equipo

Desde D:\SmartRayco, conservando runtime y su volumen:

```powershell
docker compose --project-name smartrayco-inventory-auth-lab -f scripts/inventory-auth-lab/runtime/compose.json up -d --pull never
node --import tsx scripts/inventory-auth-lab/backend.ts
```

Para el ensayo transaccional autorizado, sustituir la última línea por:

```powershell
$env:LAB_INVENTORY_WRITES='1'
node --import tsx scripts/inventory-auth-lab/backend.ts
```

Este es el modo activo al cerrar la validación transaccional del 16/10. Solo
permite POST a campo_inventory_operation y al control concurrente del laboratorio;
no permite INSERT/PATCH/DELETE generales por el gateway. El control exige el
JWT del ADMIN ficticio y solo acepta las dos órdenes de control de su fixture.

En otra terminal:

```powershell
node node_modules/vite/bin/vite.js --config scripts/inventory-auth-lab/vite.config.ts
```

No iniciar `npm run dev` ni `server/src/index.ts`: iniciarían otros módulos y
schedulers. Los procesos específicos anteriores no importan ese punto de entrada.
El backend fija las URL locales antes de importar las rutas y bloquea fetch
externo. Vite usa `envDir:false`, define solo claves locales y no sirve runtime.

Detener: Ctrl+C en las dos terminales y:

```powershell
docker compose --project-name smartrayco-inventory-auth-lab -f scripts/inventory-auth-lab/runtime/compose.json stop
```

No se necesitan permisos ni acciones en Supabase Cloud. No usar `down -v` si
se quiere conservar las cuentas ficticias; borrar el volumen es un reset local
deliberado, nunca una tarea automática de estos scripts.

## Preparación desde cero (solo laboratorio nuevo)

`prepare.mjs` genera claves ES256 y credenciales locales en runtime, excluido de
Git; falla si existe configuración previa para no regenerar claves inadvertidamente.
Iniciar solo db con el compose generado, ejecutar `schema.mjs`, iniciar
auth/rest/edge, iniciar backend, ejecutar `seed.mjs` y después iniciar Vite.
El esquema parte de la fixture de tablas, carga funciones/triggers/policies de
la captura de cuadrillas y aplica únicamente la migración de etapa 3. GoTrue
aplica sus propias migraciones de Auth en esta base nueva. No hay migración
Fase 162. Las definiciones ya desplegadas de Fase 161 son dependencias locales
de la captura, no una reinstalación en Cloud.

`seed.mjs` es una operación inicial, no un reset: no repetirlo sobre datos
sembrados. Crea cuatro cuentas usando signup Auth real y después solo fixtures.

## Validación y seguridad

- `validate.mjs`: 49 comprobaciones con login por contraseña y JWT emitidos por
  GoTrue. Comprueba ES256/issuer/audience/sub, accesos propios, contratos exactos,
  denegaciones, revocación con el mismo JWT, y hashes de inventario invariantes.
  Usa SQL exclusivamente contra el contenedor con nombre fijo para quitar al
  usuario ficticio removed de su cuadrilla. La prueba es stateful: tras pasar,
  removed permanece retirado. Para repetir desde el estado inicial, preparar
  otro laboratorio limpio o restituir deliberadamente solo esa fixture local;
  no ejecutar un reset contra configuraciones ajenas.
- `browser.mjs`: ocho escenarios Chrome con Auth real y peticiones reales.
  Fetch solo permite continuar destinos localhost: no devuelve respuestas
  simuladas. Se guarda un informe sin tokens ni contraseñas.
- La clave service_role local solo existe para el middleware real, que la usa
  para leer el perfil; no simula técnicos. Las consultas de inventario usan el
  JWT del usuario. Todas las sesiones de prueba proceden de login real en Auth.
- El gateway de validación bloquea POST de REST/RPC con 405 en modo lectura. En
  modo transaccional solo habilita las dos RPC indicadas. Los puertos REST
  de diagnóstico (54383) conservan las policies capturadas y no son una frontera
  de solo lectura adicional: no usarlos para mutaciones. Todo su contenido es
  ficticio; no copiar aquí secretos ni datos operativos.
- Los permisos amplios legacy de tablas no se cierran en este laboratorio.
  Un 403 del endpoint contextual no acredita aislamiento administrativo completo
  de todas las consultas REST directas. Esa etapa sigue separada.

Puertos: 54381 backend/gateway; 54382 proxy Auth; 54383 proxy REST; 54384 UI.
PostgreSQL no publica puerto. No hay conexiones OLT/MikroTik, cron de aplicación,
Realtime/Storage ni integración con servicios operativos. Los workers internos
de Auth son parte del servicio de autenticación, no schedulers de SmartRayco.

No guardar tokens en informes ni versionar runtime. El login de navegador guarda
la sesión local en el perfil de prueba; su validez se limita a este laboratorio.
