# Continuidad Claude Code / Codex — 03/11/2026 (vínculos manuales verificados)

**Esta nota es un puntero rápido, no la fuente de verdad.** La fuente única
real sigue siendo la sección **"ESTADO DE CONTINUIDAD"** al inicio de
`ESTADO_DESARROLLO.md` (regla ya establecida en `CLAUDE.md`) — léela
primero siempre, por completo, antes de tocar código. Este documento
actualiza el traspaso: las cinco ONT ya están importadas y vinculadas por
el propietario; no requieren otra importación ni vinculación.

## Repositorio

- Base del cierre documental: **`02ad1be`**, `main`. `git fetch origin`
  completado en el cierre: HEAD y `origin/main` idénticos, 0 adelante/0
  atrás antes del nuevo commit. El propietario autoriza commit documental
  y push normal si es fast-forward. El commit de cierre es el que contiene
  esta actualización; al retomar comprobar `git log -1` y
  `git ls-remote origin refs/heads/main`. No asumir que los hashes históricos
  de despliegue representan la punta actual del repositorio.
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
  **Ninguno de estos se incluye en el commit de cierre.** Los dos bloques
  locales Samsung Hosts/TR-069 de `ESTADO_DESARROLLO.md` se preservan
  exclusivamente en el archivo de trabajo mediante selección del contenido
  del índice; no se publican como parte del cierre ONT. Estos pendientes
  quedan guardados en disco, sin respaldo nuevo en GitHub en este cierre.
  Archivos documentales propios: `CLAUDE.md`, `ESTADO_DESARROLLO.md`
  (solo cambios ONT/cierre), este documento y la evidencia JSON de los cinco
  vínculos. No se incluyen código funcional ni archivos de otras fases.

## Producción (verificado por manifiesto/imagen, no solo por commit)

| Componente | Commit desplegado | Verificado por |
|---|---|---|
| Frontend | `40e43c1` | `GET /release-manifest.json` + `docker exec` grep del bundle real |
| Backend | `40e43c1` | `docker inspect`/`docker ps` → etiqueta `...wifitrial:40e43c155b51` |

Confirmado en la sesión histórica de despliegue del 03/11/2026, no
reverificado en esta revisión de vínculos. Caddy/Mongo/GenieACS sin tocar desde
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
   implementada todavía**. Mejora genérica para futuras ONT: el botón
   continúa llamando al importador masivo. Ninguna de estas cinco ONT la
   necesita. Último alcance autorizado: documentación, commit y push normal
   de este cierre; sin cambios de código, importaciones, vínculos ni
   operaciones de equipos.

## Cinco ONT importadas y vinculadas — verificación de lectura completada

El propietario confirmó la vinculación manual. Verificación independiente
mediante cuatro GET a Supabase, finalizada el **03/11/2026 03:12:32 UTC
(02/11 22:12:32 Lima)**, proyecto `mzupdnjegfwmpajywckd`:

| Cliente | Serial | Posición | Contrato activo |
|---|---|---|---|
| Gustavo Reyes Sandoval | `ZTEGD4FE1386` | `1/2/8:26` | `CTR-2026-00764` |
| Lourdes García Rojas | `ASKY00934183` | `1/2/5:38` | `CTR-2026-00446` |
| Jorge López Boado | `ZTEGD776E66D` | `1/2/12:50` | `CTR-2026-00750` |
| Ángel Larenas Miguel | `HWTCDEB9F6B6` | `1/3/4:8` | `CTR-2026-00543` |
| David Saona Sánchez | `HWTC5C1F6CB4` | `1/3/4:13` | `CTR-2026-00757` |

Para cada ONT: `client_id` y `contract_id` presentes; cliente resuelto y
nombre coincidente con el traspaso (normalizando tildes); contrato resuelto,
activo y perteneciente exactamente a ese `client_id`. Gustavo conserva
la fila `abed7231-7ad5-4c5f-b0b6-54112bd44f4e` y el contrato solicitado.
Consulta paginada del inventario activo completo: 738 ONT. Para cada serial
del lote hay una sola ONT activa, una sola fila en la consulta histórica
por esos seriales, una sola ocupación activa de la posición dentro de esta
OLT y un solo uso activo del contrato en el inventario. No se detectaron
duplicados ni conflictos administrativos en estas cinco identidades.
Esto valida las relaciones registradas; no es una nueva comprobación física
de seriales/servicios en la OLT ni una auditoría de todo el inventario.

**Indicadores:** caché `new_onts_detected=[]`, último ciclo
`2026-11-03T03:01:04.562+00:00`; la lógica de `GET /:id/onts/new-detected`
produce 0 elementos. Este indicador excluye ONT ya importadas, aunque
todavía no estén vinculadas. `listUnlinkedOnts` real ejecutada localmente
con las cinco filas consultadas devuelve 0: todas tienen cliente, contrato
y relación contractual resuelta. No se llamó a la aplicación ni se verificó
el navegador; se comprobaron los datos de producción y los filtros actuales.
No se recontaron otros pendientes ajenos a este lote.

Evidencia local: `docs/ONT-EXTERNAS-VINCULOS-VERIFICACION-20261103.json`.
La comprobación local de las cinco identidades y ambos criterios pasó.
La verificación previa no hizo importaciones, vinculaciones, Telnet,
cambios de OLT, migraciones ni despliegues. El cierre posterior autoriza
exclusivamente commit y push documental. **No volver a importar ni vincular estas cinco ONT.**

## Mejora futura — importación individual genérica, sin implementación autorizada ahora

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

**Alcance propuesto para una futura implementación, fuera de este turno:**
1. Importación **individual**: una ruta/flujo que traiga/verifique SOLO
   la ONT elegida (por posición+serial), sin recorrer ni reescribir las
   demás ~737 posiciones.
2. Si la ONT ya tiene fila en `olt_onts` y sigue sin vincular:
   **saltar la importación y abrir directamente el modal de vinculación**
   (`OntLinkModal.vue`) — nunca reimportar algo que ya existe. Si ya está
   vinculada, no ofrecer una nueva vinculación ni transferir su contrato.
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
7. **No volver a importar ni vincular la ONT de Gustavo ni las otras cuatro.**
   Gustavo sirve como referencia de identidad ya vinculada, que no admite
   otro vínculo. La rama existente-sin-vincular debe probarse con fixtures.

Sigue existiendo una necesidad funcional para futuras altas externas: un
clic sobre una ONT continúa ejecutando el importador masivo y procesando
todo el inventario. El importador masivo y el vínculo manual permiten
operar hoy; la mejora reduce alcance, espera y posibilidad de confusión.
No es necesaria para corregir este lote. Antes de usar una lectura acotada
de identidad en producción debe validarse su salida: `portRunningConfigCommand`
está marcado en `zteCommands.ts` como no confirmado y no utilizable para
decisiones reales; no basta asumir que incluye bloques de servicio ONT.

**Próxima tarea exacta para retomar con un nuevo pedido de implementación:**
reutilizar el clasificador y la evidencia existentes para el flujo individual
en ruta backend, store OLT y `handleImportAndLink`, con modal posterior y
timeout explícito. Primero resolver cómo verificar identidad acotada sin
usar comandos no validados; cualquier validación contra la OLT real requiere
su autorización específica. No repetir la auditoría del lote ya resuelto.

**Pruebas necesarias antes de un commit funcional:** fixtures aislados para
ONT existente sin vincular (cero importaciones, modal correcto), existente
ya vinculada (rechazar nuevo vínculo), nueva (una sola inserción y modal),
serial en otra posición, posición ocupada por otro serial, lectura incompleta
o identidad cambiante, dos clics/dos administradores, timeout o respuesta
perdida tras inserción (reintento sin duplicado), vínculo concurrente y
contrato de otro cliente. Verificar importador masivo intacto, permisos
ADMIN/SUPERADMIN y ausencia de comandos de configuración/escrituras a
equipos. Ejecutar pruebas focalizadas existentes de identidad/importación/
vinculación y chequeos TypeScript backend/frontend acordes a lo modificado.
Nunca usar estas cinco ONT reales como fixtures de escritura ni aplicar
migraciones, push funcional o deploy sin autorización explícita.

**Estados al cierre:** detección y vinculación existentes implementadas y
desplegadas según evidencia histórica `40e43c1`; cinco relaciones verificadas
por Codex en Supabase y filtros locales PASS; navegador y OLT física no
reverificados; importación individual no implementada ni desplegada.
No se ejecutan pruebas de aplicación adicionales en el cierre exclusivamente
documental; se revisan diff, JSON de evidencia y alcance exacto del índice.

## Riesgos conocidos

- El importador masivo sigue siendo lento con cientos de ONTs — conocido,
  documentado, no es un bug nuevo; la corrección de arriba lo evita para
  el caso de 1 ONT, pero el botón masivo en sí no se modifica en esta
  tarea.
- Las cinco ONT del lote ya están vinculadas y verificadas en Supabase;
  no queda trabajo administrativo pendiente para ellas en estos indicadores.
- Conflicto de identidad preexistente y ajeno detectado por el sync
  automático: posición `1/2/8:3`, serial esperado `MSTC8CCE647E` vs
  observado `HWTCE5C94DB6` — antecedente ajeno a este lote, no reverificado
  en esta revisión; no tocar sin diagnóstico propio.

## Restricciones de producción (vigentes, repetir en cada sesión)

No autorizar/reiniciar/desautorizar/reprovisionar ONT sin pedido expreso.
No modificar VLAN/GEM/PPPoE/MikroTik/perfiles de la OLT. No aplicar
migraciones ni desplegar sin que el propietario lo pida en ese mismo
turno (aunque ya se haya hecho algo similar antes). No ejecutar
sincronizaciones masivas adicionales que compitan con el escaneo
periódico. Nunca escribir contra Supabase de producción, la OLT real
(10.15.15.2) ni MikroTik real en una prueba.
