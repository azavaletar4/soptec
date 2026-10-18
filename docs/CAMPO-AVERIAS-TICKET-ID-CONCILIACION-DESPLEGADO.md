# DESPLEGADO — Conciliación enlaza la Avería vinculada (18/10/2026)

Commit fuente autorizado: `5ef5e75aa9c3fd5a8fd4635eb221af34cba10f59` (+
`f3ef13e`, solo documentación local, no desplegable). Base real verificada
antes de desplegar: `595218423f036568d3bb83944ecc7e95ef2e50f5` (5952184),
imagen `sha256:8a6bf551d040d2457c9d8a4dab063869674015b899d38ce6dbb974dfda0137d5`
— coincidía exactamente con lo que corría en producción, sin drift.

## Candidato aislado

Reconstruido en un worktree local separado (`git worktree add --detach
dba2c67`) + los 2 archivos ya en vivo de `5952184` + los 3 archivos
autorizados de `5ef5e75` (`src/lib/inventoryReconciliation.ts`,
`src/lib/__tests__/inventoryReconciliation.test.ts`,
`src/views/inventario/InventarioConciliacionView.vue`). `git diff --stat`
contra `dba2c67` confirmó exactamente esos 5 archivos — ningún cambio ajeno
incorporado. Los 5 se verificaron byte a byte contra sus commits de origen
antes de compilar.

## Pruebas y compilación (en el candidato aislado, no en el repo principal)

- 12/12 pruebas unitarias de `inventoryReconciliation.test.ts`: PASS.
- `npm run build` (`vue-tsc -b && vite build`): PASS, sin errores de tipos.
- Verificación del bundle: URL de Supabase correcta y texto "Avería
  vinculada" presente en el chunk `InventarioConciliacionView-*.js`.

## Despliegue

Mismo patrón ya usado en despliegues previos de Conciliación: imagen nueva
`FROM` el tag de rollback de la imagen que ya corría (sin reconstruir toda
la cadena histórica de overrides — docker compose solo aplica el último
`image:` del servicio `frontend`, y `--no-deps` deja intactos los demás
servicios). Precheck de base (revisión + imagen) antes de tocar nada,
candado de archivo (`fcntl.flock`) contra ejecuciones concurrentes,
respaldo completo (HTML servido, imagen Docker completa, fuentes
anteriores y nuevas) con manifiesto SHA-256 — **verificado índice por
índice tras el despliegue, sin discrepancias**.

- Commit instalado: `5ef5e75aa9c3fd5a8fd4635eb221af34cba10f59`.
- Imagen nueva: `sha256:1f36cd9b949620868025f0f2bc8b5568f7064dac366a930ecc43d9cf454856f0`.
- `distSha256`: `92206540ebd518bcd6b421db506e0ddda67fa59a9535d9d0bade6a53e5abc355`
  (idéntico al `dist.tar.gz` construido y verificado localmente antes de
  enviarlo).
- Contenedores protegidos (`backend`, `caddy`, `genieacs`, `mongo`): mismos
  `Id` antes y después — ninguno se tocó.
- HTTPS verificado automáticamente dentro del propio script de despliegue:
  `/`, `/inventario` y `/inventario/conciliacion` devuelven el mismo
  `index.html` que el `dist` construido; todos los assets del nuevo build
  responden. Verificación adicional manual tras el despliegue:
  `/inventario/custodia`, `/campo`, `/soporte` responden HTTP 200 (shell de
  la SPA; no se validó el renderizado interno con sesión real — ver
  limitación).
- Respaldo en `/opt/smartrayco-staging/inventory-conciliacion-ticket-5ef5e75/backup/`.
  Imagen de rollback ya etiquetada y presente en el host:
  `smartrayco-frontend:rollback-inventory-conciliacion-ticket-5ef5e75`
  (`sha256:8a6bf551...`, idéntica a la base pre-despliegue). Rollback
  preparado, no usado:

  ```sh
  docker compose --project-directory /opt/smartrayco \
    -f /opt/smartrayco/docker-compose.onprem.yml \
    -f /opt/smartrayco-staging/inventory-conciliacion-ticket-5ef5e75/rollback.override.yml \
    up -d --no-deps --no-build --pull never frontend
  ```

## Diferencias reales esperadas en el reporte (ya cuantificadas antes de desplegar)

10 unidades reales (5 ONT + 5 TV Box) pasan a mostrar "Avería vinculada"
con acceso directo al ticket; las 10 verificadas (mismo cliente), 0 con
conflicto, 0 pendientes de aprobación en este momento. Clasificaciones
(`installed`/`custody`/`possible`/`unknown`) idénticas a la lectura
anterior — detalle completo en
`docs/CAMPO-AVERIAS-TICKET-ID-CONCILIACION-DESPLIEGUE.md` y
`docs/INVENTARIO-CONCILIACION-AVERIA-TICKET-LINK-RESUMEN.json`.

## Limitación pendiente

El candidato incluye también la lógica de `defe251` (cierres de Avería por
serie, inerte: 0 cierres con `ont_serial` hoy) porque ambos cambios viven
en el mismo archivo y no se habían desplegado por separado — no agrega
riesgo (solo lectura, probado), pero suma 2 consultas de solo lectura más
(`tickets`, `work_order_closures` de Avería) a cada carga del reporte de
Conciliación. No se validó el renderizado con una sesión administrativa
real en el navegador (sin credenciales para iniciar sesión en producción
desde este entorno) — las comprobaciones HTTPS confirman que el bundle
correcto se sirve y que el resto de la aplicación (Custodia, Altas, App de
Campo, Soporte) sigue respondiendo, pero no sustituyen una verificación
visual humana. Se recomienda que un administrador abra
`/inventario/conciliacion` y confirme visualmente el enlace "Avería
vinculada" en al menos una de las 10 unidades identificadas.

## Confirmación de alcance

Sin migraciones, RPC ni cambios de RLS/backend — solo el contenedor
`frontend` se recreó. Sin escrituras en Supabase. No se tocaron equipos,
existencias, movimientos, contratos ni órdenes reales. No se operó
OLT/MikroTik. Sin push al repositorio remoto.
