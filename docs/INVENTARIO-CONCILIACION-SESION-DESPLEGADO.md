# DESPLEGADO — Corrección de sesión en Conciliación (18/10/2026)

Commit fuente autorizado: `9b9993f5a09df03da96b51a9e58d77b5bcfa2289`. Base
real verificada antes de desplegar: `e34a3dc5f1e481dbe5914b052fd2816732f447b3`,
imagen `sha256:855fb3a93f2d51b4bb0353fa98e3918f1a11d905f15d0e4b0ce7e1e1fbd15920`
— coincidía exactamente con lo que corría en producción, sin drift.

## Sin riesgo para los registros de ONT en curso

Este despliegue solo recrea el contenedor `frontend` (archivos estáticos
servidos por nginx) — nunca toca Supabase, el backend ni ningún dato de
negocio. Verificado explícitamente: el contenedor `smartrayco-backend-1`
(por donde se escriben los registros de ONT) mantuvo el **mismo `Id` y el
mismo `StartedAt`** (`2026-10-17T20:21:37Z`) antes y después del
despliegue — no se reinició ni se interrumpió en ningún momento. `caddy`,
`genieacs` y `mongo` tampoco cambiaron. No hubo ninguna consulta a
Supabase Cloud durante esta sesión.

## Candidato aislado

Reconstruido en un worktree local separado (`git worktree add --detach
e34a3dc`) + únicamente los 2 archivos de aplicación que afectan el
frontend compilado: `src/lib/reconciliationSessionGuard.ts` (nuevo) y
`src/views/inventario/InventarioConciliacionView.vue` (modificado). El
`.md` y el `.test.ts` del commit no forman parte del `dist` — se dejaron
fuera del candidato. `git diff --stat` contra la base confirmó exactamente
esos 2 archivos — ningún cambio ajeno incorporado. Los 2 se verificaron
byte a byte contra el commit de origen antes de compilar. (Nota de
proceso: al copiar temporalmente un archivo de prueba para correrlo en el
candidato, se sobrescribió sin querer un `.test.ts` que ya pertenecía a la
base — se detectó por el `git diff --stat` inesperado, se restauró antes
de compilar, y se reconstruyó el `dist` limpio; el hash final no cambió,
confirmando que un archivo de pruebas nunca formó parte del bundle.)

## Pruebas y compilación (en el candidato aislado)

- 23/23 pruebas unitarias (`inventoryReconciliation.test.ts` + `inventoryReconciliationReview.test.ts` + `reconciliationSessionGuard.test.ts`, copiadas temporalmente solo para correrlas — no forman parte del candidato de despliegue): PASS.
- `npm run build` (`vue-tsc -b && vite build`): PASS, sin errores de tipos.

## Despliegue

Mismo patrón ya usado en los despliegues anteriores de esta pantalla.
Precheck de base (revisión + imagen) antes de tocar nada, candado de
archivo contra ejecuciones concurrentes, respaldo completo con manifiesto
SHA-256 — **verificado tras el despliegue, sin discrepancias**.

- Commit instalado: `9b9993f5a09df03da96b51a9e58d77b5bcfa2289`.
- Imagen nueva: `sha256:6a490413d459520d1b5f2faf25a2d24b5c2db5c666a6f67fff041a23aafad37c`.
- `distSha256`: `e264e7b34ac98db51f2a2ff6aa78e25c9388bf6788deee5bc59e63db3e41ad9a`
  (idéntico al `dist.tar.gz` construido y verificado localmente antes de
  enviarlo).
- Contenedores protegidos (`backend`, `caddy`, `genieacs`, `mongo`): mismos
  `Id` antes y después.
- HTTPS verificado dentro del propio script de despliegue: `/`,
  `/inventario` y `/inventario/conciliacion` devuelven el mismo
  `index.html` que el `dist` construido; todos los assets responden.
  Verificación manual adicional: se identificó el chunk realmente
  referenciado (`InventarioConciliacionView-DTPO9mNB.js`) y se confirmó
  que contiene "Necesitan revisión", "Todo el inventario", "Documentalmente
  coherentes", **"Reintentar"** (el botón nuevo) y que el mensaje "La
  sesión cambió" sigue presente para un cambio real de identidad/rol — es
  decir, el bloqueo de datos ante un cambio real se conserva.
- Respaldo en
  `/opt/smartrayco-staging/inventory-conciliacion-sesion-9b9993f/backup/`.
  Imagen de rollback ya etiquetada y presente en el host:
  `smartrayco-frontend:rollback-inventory-conciliacion-sesion-9b9993f`
  (`sha256:855fb3a9...`, idéntica a la base pre-despliegue). Rollback
  preparado, no usado:

  ```sh
  docker compose --project-directory /opt/smartrayco \
    -f /opt/smartrayco/docker-compose.onprem.yml \
    -f /opt/smartrayco-staging/inventory-conciliacion-sesion-9b9993f/rollback.override.yml \
    up -d --no-deps --no-build --pull never frontend
  ```

## Limitación de validación con sesión real (dejada explícita)

No se validó con una sesión administrativa real en el navegador — este
entorno no tiene credenciales de producción. Lo verificado son las
comprobaciones automáticas del propio script de despliegue y la
confirmación manual del texto en el chunk realmente servido. El
comportamiento exacto que originó el reporte (cambiar de pestaña → volver
→ renovación de sesión del mismo usuario) se demostró mediante 5 pruebas
unitarias que reproducen la causa raíz usando la reactividad real de Vue
(`src/lib/__tests__/reconciliationSessionGuard.test.ts`), ejecutadas sobre
el **mismo código exacto** que ahora está en producción
(`distSha256` idéntico) — pero no con el navegador real ni una sesión
Supabase real con token de refresco auténtico. Se recomienda que un
administrador use la pantalla con normalidad, cambie de pestaña y regrese,
y confirme que el reporte ya no desaparece.

## Confirmación de alcance

Sin migraciones, RPC ni cambios de RLS/backend — solo el contenedor
`frontend` se recreó. Sin escrituras en Supabase. No se tocaron equipos,
existencias, movimientos, contratos, órdenes ni los registros de ONT que
se estaban capturando en paralelo (confirmado por el `StartedAt` sin
cambios del backend). No se operó OLT/MikroTik. Sin push al repositorio
remoto.
