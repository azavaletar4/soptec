# Continuidad Claude Code / Codex — 03/11/2026

**Esta nota es un puntero rápido, no la fuente de verdad.** La fuente única
real sigue siendo la sección **"ESTADO DE CONTINUIDAD"** al inicio de
`ESTADO_DESARROLLO.md` (regla ya establecida en `CLAUDE.md`) — léela
primero siempre. Este documento solo resume rutas, commits y próximo paso
para no tener que abrir el archivo completo cada vez.

## Repositorio

- `main` local y `origin/main` coinciden en **`f99299a`** (verificado con
  `git fetch` + comparación directa de hashes, no solo `git log`).
- Push más reciente: fast-forward normal, sin force/rebase/reset.
- Archivos locales de otras fases, sin tocar ni commitear en esta tarea
  (lista completa y vigente en `git status`): `docs/ASISTENCIA-SEMIAUTOMATICA-FASE-A-PROPUESTA.md`,
  4× `docs/FASE175-*-20261026.md`, `docs/OFICINA-XUI-AUDIT-20261030.{json,md}`,
  8× `docs/PUNTOS-*-2026102{5,6}.md`, `docs/SAMSUNG-HOST-DIAGNOSTICO-20261030.{json,md}`,
  3× `docs/TR069-RELEASE-*-20261030.{json,md}`, `scripts/oficina-xui-audit.cjs`,
  `scripts/samsung-host-readonly.cjs`, `scripts/tr069-release-build-diagnostic.cjs`,
  `scripts/tr069-release-preflight.cjs`,
  `server/src/services/__tests__/trafficAnalyticsCounterStates.test.ts`.

## Producción (verificado por manifiesto/imagen, no solo por commit)

| Componente | Commit desplegado | Verificado por |
|---|---|---|
| Frontend | `f99299a` | `GET /release-manifest.json` |
| Backend | `0787173` | `docker inspect` → etiqueta de imagen/revisión |

Ambos confirmados en vivo el 02-03/11/2026. Backend sin cambios pendientes
de desplegar.

## Supabase

- Migración `20261102220000_technician_points_october_november_boundary.sql`
  **aplicada y verificada** (registrada en `supabase_migrations.schema_migrations`;
  hash de `technician_point_contributions` en vivo coincide con el archivo
  versionado). **No volver a aplicarla.**
- Resultado real confirmado: Jairo Bernabe +10, Ruber Pizango +5, Jhordanno
  Zavaleta +5, Jadir Zavaleta +2 puntos en noviembre, sin duplicar octubre.

## VM de producción (`192.168.55.201`)

- Contenedores Docker: corren exactamente las imágenes de la tabla de
  arriba (confirmado por `docker inspect`).
- El checkout git propio de la VM (`/opt/smartrayco`) está en la rama
  local `preview-fase174` (Fase 174b, MikroTik — **ajena a este trabajo**),
  y su ref `main` simplemente está atrasado respecto a `origin/main` (sin
  commits exclusivos, sin divergencia real).
- **Ese checkout NO es la fuente de los despliegues** — las imágenes se
  construyen empacando el commit exacto desde el repositorio local vía
  `git archive` (`scripts/frontend-consolidation-release.cjs`), nunca
  desde ese checkout de la VM. No se le hizo `pull` ni se tocó.

## Pendiente real — ONT externa de Gustavo Reyes Sandoval

Detalle completo y procedimiento seguro en
`docs/OLT-IMPORTADOR-EXTERNAS-PENDIENTE-20261102.md` (no se repite aquí).
Resumen: `CTR-2026-00764`, serial `ZTEGD4FE1386`, `gpon-onu_1/2/8:26`,
online, autorizada directamente en SmartOLT — existe en la OLT real pero
no en `olt_onts`. Usar el importador ya existente
(`POST /:id/onts/import-existing`) para traerla, sin reprovisionar.

## Próxima tarea exacta

Revisar el importador existente (`POST /:id/onts/import-existing`) para
confirmar que incorpora correctamente ONT autorizadas externamente en
general (no solo el caso puntual), usando a Gustavo Reyes como caso de
validación real — **sin ejecutar ninguna escritura todavía**. Requiere
autorización aparte antes de correrlo contra producción (implica un
escaneo completo de la OLT).
