# Dashboard PPPoE por perfil

**Estado: LISTO PARA PUBLICAR, pendiente de autorización de despliegue.**
Implementación y validación locales; producción no fue modificada.

## Causa técnica y arquitectura

El Dashboard no tenía un agregado por perfil del administrador PPPoE.
`/ppp/active` identifica usuarios/sesiones, pero no proporciona el perfil local
que necesita este indicador. Se cruza en backend con `/ppp/secret` por el nombre
exacto del usuario. No se consulta un router de borde para cada tarjeta.

Nuevo `GET /api/dashboard/pppoe-profiles`, con los permisos existentes del
Dashboard: SUPERADMIN, ADMIN, SOPORTE y TECNICO_RED. La ruta principal del
Dashboard sigue restringiendo el acceso del técnico; no se cambió esa regla.
FACTURACION no recibe esta información ni hace peticiones desde las tarjetas.

Por cada renovación:

1. SELECT acotado del registro de routers activos `device_role=pppoe_admin`,
   máximo dos filas para detectar ambigüedad. Debe existir exactamente uno.
2. GET de `system/resource`, únicamente `board-name`, para comprobar CCR2116.
3. Dos GET por lote concurrentes, con el cliente REST existente:
   `/ppp/secret?.proplist=name,profile,service` y
   `/ppp/active?.proplist=name,service,radius`. Nunca se solicita la contraseña PPP.
4. Agrupación de las cuatro tarjetas, sin consultas remotas por cliente.

| Tarjeta | Perfil exacto |
| --- | --- |
| Dedicado | Profile_Dedicado |
| Balanceador | Profile_Balanceador |
| WAN 4 | Profile_Gamer_04 |
| WAN 5 | Profile_Gamer_05 |

`Profile_Morosos`, diferencias de mayúsculas, sufijos y otros perfiles quedan
fuera de las tarjetas. No se añade un total que pueda incluirlos.

## Reglas de conteo y fallos

- Registrados: registros de secrets de cada perfil, incluidos deshabilitados.
  Una repetición del mismo `.id` no se suma dos veces.
- Conectados: nombres únicos de sesiones con `service=pppoe`, asociados a un
  secret local compatible (`service=pppoe` o `any`). Varias sesiones del mismo
  usuario cuentan una sola vez; otros servicios PPP no se cuentan.
- Usuarios sin secret, con asignación ambigua o marcados como RADIUS no se
  adjudican a un perfil por suposición. Se informa **Lectura parcial**.
- Caché exclusivamente RAM, TTL 60 s y una promesa compartida entre solicitudes
  concurrentes. Cada éxito sustituye por completo el agregado anterior. No se
  conservan listas de usuarios, credenciales ni históricos de mediciones.
- Tras un fallo: último agregado exitoso con estado **Desactualizado** y fecha
  original, o **Sin datos** con valores `null` si no hubo éxito. No se fabrica
  un cero. Los fallos también esperan 60 s antes de otro intento remoto.
- Respuesta HTTP `Cache-Control: no-store`. Errores del router no se exponen ni
  registran con usuarios, contraseñas o listas. Solo salen agregados y mensajes
  genéricos. El SELECT de configuración tiene límite de 5 s; cada GET RouterOS,
  8 s sin reintentos; la petición de la sección tiene límite de 25 s.

## Interfaz y validación

Sección independiente con cuatro tarjetas; conectados como cifra principal,
registrados debajo y fecha completa de última lectura en `America/Lima` en
cada una. Actualiza 60 s después de completar la petición anterior. Cancela al
salir o perder permisos. No cambia los demás indicadores ni su actualización.

- **Lectura real READ ONLY: PASS.** Se identificó el único Administrador 2116,
  hardware `CCR2116-12G-4S+`. Los cuatro perfiles coincidieron con consultas GET
  filtradas independientemente en RouterOS. RADIUS deshabilitado, bandera de
  sesión disponible, sin sesiones duplicadas ni usuarios activos sin secret en
  las lecturas comprobadas. Los conteos reales no se guardaron en archivos ni
  tablas para evitar convertir la validación en un histórico de mediciones.
- **16 pruebas backend PASS:** agrupación, exclusiones, sesiones múltiples,
  RADIUS, ambigüedad, respuesta inválida, cero válido, TTL, 25 solicitudes
  concurrentes, reemplazo, fallo inicial, stale, recuperación y permisos HTTP.
- **16 comprobaciones de navegador PASS:** hora Perú con navegador en Tokio,
  1440/375/320 px, actualización automática con reloj controlado, errores,
  parcial/sin datos, permisos, no solapamiento, cancelación y desmontaje. Datos
  exclusivamente ficticios, red externa bloqueada y cero escrituras de negocio.
- `npm.cmd run build`: **PASS**, vue-tsc y Vite, 425 módulos. Advertencia existente
  de tamaño de chunks; sin errores de compilación.
- Tipos del código backend añadido: **PASS**. El chequeo global con
  `tsconfig.server.json` encuentra un error preexistente en `src/types/domain.ts:348`
  por el alias `@/lib/installationIptv`; no se modifica esa configuración ni ese módulo.

## Archivos y límites

- `server/src/services/dashboardPppoeProfiles.ts`: selección, lecturas, agregado y RAM.
- `server/src/services/dashboardPppoeHandler.ts`: handler y defensa de permisos.
- `server/src/routes/dashboard.ts`: registro de la ruta nueva.
- `src/lib/pppoeProfileCounts.ts`: perfiles exactos, contrato y hora Perú.
- `src/components/dashboard/PppoeProfileCards.vue`: tarjetas y actualización.
- `src/views/DashboardView.vue`: integración de la sección.
- `server/src/services/__tests__/dashboardPppoeProfiles.test.ts`: regresiones.
- `scripts/tests/dashboard-pppoe-browser.mjs`: navegador local con datos ficticios.
- `scripts/diagnostics/dashboard-pppoe-readonly.mjs`: comparación puntual, solo GET;
  imprime agregados, sin archivos ni listas de usuarios.
- Este informe.

Referencias oficiales: [PPP AAA](https://manual.mikrotik.com/docs/authentication-authorization-accounting/ppp-aaa/)
y [REST API](https://manual.mikrotik.com/docs/developer-guides/rest-api/).

Riesgos: la caché es por proceso; reiniciar pierde la lectura y varios workers
tendrían una caché cada uno. Los dos lotes RouterOS no son una transacción y
reflejan una lectura cercana en el tiempo. El perfil asociado es el del secret
actual, no una reconstrucción del perfil negociado antes de un cambio. Si se
habilita RADIUS, los usuarios remotos sin perfil verificable se omiten y la UI
señala lectura parcial. Si aparecen dos administradores, se rechaza la lectura
en vez de elegir uno o sumar varios routers.

**Cero escrituras en Supabase, cero cambios en MikroTik y cero despliegues.**
No se crean tablas, migraciones, snapshots ni históricos de estas lecturas. No
se modifican los servicios ni tablas de tráfico existentes. Una futura
publicación debe incluir frontend y backend de este cambio; queda pendiente
la autorización expresa. Los cambios preexistentes de otras tareas quedan
fuera del commit.
