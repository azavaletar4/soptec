# Continuidad Claude Code / Codex — 03/11/2026 (cierre de sesión Claude, traspaso a Codex)

**Esta nota es un puntero rápido, no la fuente de verdad.** La fuente única
real sigue siendo la sección **"ESTADO DE CONTINUIDAD"** al inicio de
`ESTADO_DESARROLLO.md` (regla ya establecida en `CLAUDE.md`) — léela
primero siempre, por completo, antes de tocar código. Este documento
reemplaza la versión anterior (describía el estado previo a esta sesión:
sin detección automática, sin la ONT de Gustavo importada).

## Repositorio

- `main` local y `origin/main` coinciden en **`cb26e42`** (verificado con
  `git fetch` + comparación directa de hashes). Push normal, fast-forward,
  sin force/rebase/reset en toda la sesión.
- Commits de esta sesión, en orden: `56254bf` (vinculación externa) →
  `467b637` (registro deploy) → `96663a0` (detección automática) →
  `40e43c1` (fix cosmético CSS, mismo patrón que `f99299a`) → `cb26e42`
  (registro deploy de la detección).
- Archivos locales de otras fases, sin tocar ni commitear en esta sesión
  (lista vigente en `git status`, confirmar antes de asumir que sigue
  igual): `docs/ASISTENCIA-SEMIAUTOMATICA-FASE-A-PROPUESTA.md`,
  4× `docs/FASE175-*-20261026.md`, `docs/OFICINA-XUI-AUDIT-20261030.{json,md}`,
  8× `docs/PUNTOS-*-2026102{5,6}.md`, `docs/SAMSUNG-HOST-DIAGNOSTICO-20261030.{json,md}`,
  3× `docs/TR069-RELEASE-*-20261030.{json,md}`, `scripts/oficina-xui-audit.cjs`,
  `scripts/samsung-host-readonly.cjs`, `scripts/tr069-release-build-diagnostic.cjs`,
  `scripts/tr069-release-preflight.cjs`,
  `server/src/services/__tests__/trafficAnalyticsCounterStates.test.ts`.
  También `docs/INVENTARIO-PRODUCCION-IMAGENES.json` (modificado, ajeno).
  **Ninguno de estos se incluyó en los commits de esta sesión.**

## Producción (verificado por manifiesto/imagen, no solo por commit)

| Componente | Commit desplegado | Verificado por |
|---|---|---|
| Frontend | `40e43c1` | `GET /release-manifest.json` + `docker exec` grep del bundle real |
| Backend | `40e43c1` | `docker inspect`/`docker ps` → etiqueta `...wifitrial:40e43c155b51` |

Confirmado en vivo 03/11/2026. Caddy/Mongo/GenieACS sin tocar desde
30/10. `prepare`→`build`→`deploy`→`verify` todos PASS (126 artefactos,
reproducible, 11 rutas, `401` sin autenticación, `ssidTasksSent:0`).

## Supabase — migraciones aplicadas en esta sesión (no repetir)

- `20261103013533_olt_ont_external_link` — tabla `olt_ont_link_audit` +
  índice único parcial `olt_onts_contract_id_active_key`. **Aplicada y
  verificada.**
- `olt_sync_new_onts_detected` (archivo local `20261104000000_olt_sync_new_onts_detected.sql`) —
  2 columnas aditivas en `olt_sync_cache`: `new_onts_detected jsonb not
  null default '[]'`, `new_onts_checked_at timestamptz` nullable. **Aplicada
  y verificada** (columnas confirmadas por `information_schema.columns`,
  RLS sin cambios — 0 policies, igual que antes).
- Sin migraciones pendientes de aplicar en esta sesión.

## Funcionalidades — implementado / desplegado / probado / verificado

1. **Vinculación de ONT externas** (`/:id/onts/:ontDbId/link`,
   `OntLinkModal.vue`) — las 4 condiciones completas: implementado,
   respaldado en GitHub, desplegado, probado funcionalmente en producción.
2. **Detección automática de ONT autorizadas externamente** (sync
   periódico detecta ONT con onu-id ya autorizado en la OLT pero sin fila
   en `olt_onts`, panel "Nuevas ONT detectadas",
   `GET /:id/onts/new-detected`) — las 4 condiciones completas. Confirmado
   en vivo con un ciclo 100% pasivo del scheduler: detectó 5 ONT reales
   (ver abajo), sin tocar la OLT ni GenieACS.
3. **Importación individual tras un clic en "Importar y vincular"** — **NO
   implementado todavía, es la tarea pendiente** (sección siguiente). El
   botón hoy llama al importador masivo existente.

## Pendiente real #1 — ONT de Gustavo Reyes Sandoval: YA IMPORTADA, falta vincular

Ya **no** está pendiente de importar (a diferencia de lo que decía la
versión anterior de este documento). Estado verificado en `olt_onts`
(solo lectura, 03/11/2026 ~02:45 UTC):

```
id: abed7231-7ad5-4c5f-b0b6-54112bd44f4e
serial: ZTEGD4FE1386, posición 1/2/8:26, olt_device_id: 700d31b5-679e-4dda-9eeb-53bf3aaf87e0
client_id: null, contract_id: null   ← falta vincular
created_at: 2026-11-03T02:42:11.556Z (import-existing, audit action="import")
```

Contrato objetivo: `CTR-2026-00764`. **No volver a importarla** — ya existe
la fila, un segundo `import-existing`/registro manual sobre esa posición
es innecesario y redundante. Solo falta el paso de vinculación
(`PATCH`/`POST .../link` ya existente, vía `OntLinkModal.vue`), que se
puede hacer manualmente desde el panel ("ONTs pendientes de vincular")
**ahora mismo, sin esperar la corrección de abajo**, o automáticamente una
vez corregido el flujo del botón.

Junto con Gustavo, ese mismo clic de "Importar y vincular" importó otras
**4 ONT reales** (mismo lote, mismo timestamp, todas sin cliente/contrato
todavía): Lourdes García Rojas (`ASKY00934183`, `1/2/5:38`), Jorge López
Boado (`ZTEGD776E66D`, `1/2/12:50`), Ángel Larenas Miguel
(`HWTCDEB9F6B6`, `1/3/4:8`), David Saona Sánchez (`HWTC5C1F6CB4`,
`1/3/4:13`). Las 5 son reales y deben vincularse manualmente cuando
corresponda — ninguna se vinculó automáticamente, ninguna se duplicó.

## Pendiente real #2 — Tarea para Codex: corrección de importación individual

**Diagnóstico confirmado (ver `docs/` — este mismo documento resume lo
esencial, no hace falta repetir el diagnóstico):**
- El botón "Importar y vincular" (`handleImportAndLink` en
  `src/views/olt/OltDetailView.vue`, acción `oltStore.importExistingOnts`
  en `src/stores/olt.ts`) llama al **importador masivo**
  `POST /:id/onts/import-existing` (`server/src/routes/olt.ts`), que
  reescanea y reprocesa **las ~738 posiciones de toda la OLT** con una
  escritura secuencial por posición — no solo la ONT elegida.
- La importación de Gustavo (y las otras 4) **terminó correctamente**, sin
  errores, sin duplicados, sin conflictos — pero tardó varios minutos
  (comportamiento ya documentado en el propio diálogo de confirmación del
  botón masivo) y el modal de vinculación nunca se abrió en el navegador
  porque el usuario no esperó/la UI no dio ninguna señal de progreo.
- Causa raíz de UX: `apiFetch` para esta llamada no tiene `timeoutMs`
  explícito (a diferencia de `provisionOnt`/`getSignal`, que sí lo tienen)
  y el botón no muestra ningún aviso de duración esperada.

**Qué implementar (Codex, con autorización explícita previa del
propietario antes de cualquier escritura/despliegue real):**
1. Importación **individual**: una ruta/flujo que traiga/verifique SOLO
   la ONT elegida (por posición+serial), sin recorrer ni reescribir las
   demás ~737 posiciones.
2. Si la ONT ya tiene fila en `olt_onts` (como Gustavo ahora mismo):
   **saltar la importación y abrir directamente el modal de vinculación**
   (`OntLinkModal.vue`) — nunca reimportar algo que ya existe.
3. Si es genuinamente nueva: importarla individualmente y **después**
   abrir el modal — nunca ambos pasos en una sola operación sin
   confirmación intermedia si eso complica el manejo de errores.
4. **Conservar intacto** el importador masivo existente
   (`import-existing`) — esta corrección es un camino alternativo más
   rápido para 1 ONT, no un reemplazo. Reutilizar la lógica de
   verificación de identidad ya existente (`buildScannedCandidates`,
   `classifyImportCandidates`, `oltScanCandidates.ts`) en vez de
   duplicarla.
5. Proteger contra: duplicados (una ONT ya importada no debe generar una
   segunda fila), conflictos de serial/posición (igual criterio que ya
   existe, revisión manual, nunca auto-resolver), concurrencia (dos clics
   seguidos o dos administradores a la vez), errores de red/timeout
   (usar `timeoutMs` explícito en `apiFetch`, mensaje claro si falla a
   medias).
6. Probar localmente (pruebas aisladas, Docker/fakes, sin tocar la OLT ni
   Supabase de producción) **antes** de pedir autorización para
   desplegar.
7. **No volver a importar la ONT de Gustavo** — ya existe, úsala como
   caso de prueba de la rama "ya existe → abrir modal directo", nunca
   como caso de "importar" en las pruebas contra producción.

## Riesgos conocidos

- El importador masivo sigue siendo lento con cientos de ONTs — conocido,
  documentado, no es un bug nuevo; la corrección de arriba lo evita para
  el caso de 1 ONT, pero el botón masivo en sí no se modifica en esta
  tarea.
- Las 5 ONT recién importadas (Gustavo + 4 más) están sin vincular — no es
  un riesgo de datos (no hay duplicados ni vínculos erróneos), solo trabajo
  administrativo pendiente.
- Conflicto de identidad preexistente y ajeno detectado por el sync
  automático: posición `1/2/8:3`, serial esperado `MSTC8CCE647E` vs
  observado `HWTCE5C94DB6` — no relacionado con esta sesión, requiere
  revisión manual aparte (no tocar sin diagnóstico propio).

## Restricciones de producción (vigentes, repetir en cada sesión)

No autorizar/reiniciar/desautorizar/reprovisionar ONT sin pedido expreso.
No modificar VLAN/GEM/PPPoE/MikroTik/perfiles de la OLT. No aplicar
migraciones ni desplegar sin que el propietario lo pida en ese mismo
turno (aunque ya se haya hecho algo similar antes). No ejecutar
sincronizaciones masivas adicionales que compitan con el escaneo
periódico. Nunca escribir contra Supabase de producción, la OLT real
(10.15.15.2) ni MikroTik real en una prueba.
