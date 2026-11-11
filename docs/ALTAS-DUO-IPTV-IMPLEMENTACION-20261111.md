# Altas Dúo: implementación local y publicación pendiente

Base `6170a83`. **Implementado localmente; no migrado, publicado ni
desplegado.** Solo consultas de metadatos READ ONLY en producción.

**Revisión final posterior de `8086fba`: NO APTO para publicar sin interrumpir
Campo.** Se reprodujeron incompatibilidad de sesiones antiguas, pérdida de
modalidad en borrador vacío, defecto previo de stores IndexedDB y bloqueo
de cola. No ejecutar el procedimiento siguiente sin resolver las condiciones
de `ALTAS-IPTV-REVISION-PUBLICACION-20261111.md`. Los PASS originales que se
conservan abajo no cubrían estos escenarios ni certificaban Android real.

## Comportamiento y causa

El trigger vigente, leído el 11/11/2026 a las 12:45:30 UTC, exige TV Box
por tener `xui_line_id`. El archivo `ALTAS-IPTV-TRIGGER-LECTURA-20261111.json`
conserva su definición real; no se consultaron clientes ni órdenes reales.

Nuevas Altas Dúo eligen aplicación en Smart TV, dispositivo del cliente o
TV Box Rayco. Las dos primeras no exigen TV Box; **Internet conserva ONT**.
La tercera exige unidad `tvbox`, `assigned`, serie o MAC no vacía y mismo
cliente/contrato/Alta, con evento de asignación desde custodia. No basta
una fila reservada en bodega. Si ya hay TV Box vinculado a la Alta, no se
puede ocultar el hecho seleccionando aplicación/dispositivo propio.

La prevalidación del formulario/store y el trigger llaman a la misma
función SQL. Se comprueba antes de código de cliente, fotos o firma; al
final se guarda modalidad y estado en **un solo UPDATE**. Se mantienen
las validaciones de ONT, Zona/NAP, materiales, evidencias, cuadrilla,
permisos y cierre definitivo. No hay cambios al backend HTTP ni a los
procedimientos de inventario, facturación o aprovisionamiento.

`installations.iptv_policy_version` marca únicamente nuevas filas: ADD
nullable sin backfill, DEFAULT posterior y trigger de INSERT que impide
falsificar/quitar la versión. `iptv_installation_mode` guarda la modalidad,
relacionada con el contrato mediante el `contract_id` de la orden.
Las órdenes anteriores, abiertas o cerradas, conservan NULL y su regla
anterior. La modalidad y versión históricas/cerradas no se pueden editar.
Rosita y sus movimientos no fueron leídos, alterados ni recalculados.

La cola offline y los borradores incluyen la modalidad. Una cola anterior
sin modalidad no puede cerrar un Dúo nuevo. Una respuesta perdida de un
cierre nuevo ya confirmado con la misma modalidad/identidad se reconoce
solo leyendo; no repite evidencias ni inventario.

## Archivos del alcance

- Migración: `supabase/migrations/20261111140000_installation_iptv_mode.sql`.
- Rollback: `scripts/rollback-installation-iptv-mode.sql`.
- Reglas/transporte: `src/lib/installationIptv.ts`, `src/types/domain.ts`,
  `src/lib/offlineQueue.ts`, `src/stores/installations.ts`, `src/stores/campo.ts`.
- UI: `src/components/campo/IptvInstallationModeField.vue`,
  `src/views/campo/CampoTrabajoDetailView.vue`,
  `src/views/instalaciones/InstalacionDetailView.vue`.
- Pruebas: `src/lib/__tests__/installationIptv.test.ts`,
  `server/tests/installationIptv.ui.test.mjs`,
  `server/tests/installationIptvMode.sql.test.ts`,
  `scripts/tests/iptv-mode-browser.{html,mjs}`.
- Lectura reproducible: `scripts/iptv-installation-readonly.ps1`,
  `scripts/diagnostics/iptv-installation-readonly.sql` y evidencia JSON.
- Documentación: este informe, diseño previo, continuidad y registro de errores.

## Validación local

PostgreSQL 17 temporal, sin red, UUID/datos sintéticos y SQL candidato real:
**20/20 PASS**. Carga la función vigente y los procedimientos reales de
custodia/asignación contextual. Cubre ambas modalidades sin TV Box, Rayco
con serie o solo MAC, falta de custodia/identidad/estado, otras líneas,
falta de modalidad, ONT/Zona/NAP, órdenes legacy e históricos no vacíos,
ACL, tres carreras entre cierre/asignación/cambio de modalidad, rollback
y reaplicación sin modificar filas ni inventario.

Otras pruebas focalizadas: **63/63 PASS** (UI/store, cola offline, respuesta
perdida, materiales, custodia, cierre anterior y ONT). `vue-tsc --noEmit`
PASS. Vite producción local PASS en `dist/iptv-review` (artefacto ignorado,
sin publicar); advertencia habitual de chunks mayores a 500 kB.
Chrome oculto con componente/store reales compilados y transporte simulado:
**14/14 PASS** (tres opciones, sin selección por defecto, falta de modalidad,
estado/modalidad juntos, reintento sin escrituras y control deshabilitado).
Proxy remoto cerrado y HTTPS bloqueado; cero escrituras productivas.
Total: **97 verificaciones focalizadas PASS**, más tipos y compilación.

## Publicación futura, solo después de autorización expresa

1. Repetir la consulta de metadatos:
   `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/iptv-installation-readonly.ps1`.
   Comparar con la evidencia revisada. El SQL aborta si cambió el cuerpo
   de cierre o falta el trigger/lector contextual; nunca quitar esa guarda.
   Respaldar funciones, esquema y versiones/imágenes activas, sin cambiar datos.
2. Reejecutar pruebas del módulo si cambió fuente, SQL o dependencias:
   `node --import tsx --test server/tests/installationIptvMode.sql.test.ts`,
   `node --import tsx --test src/lib/__tests__/installationIptv.test.ts server/tests/installationIptv.ui.test.mjs`,
   `node scripts/tests/iptv-mode-browser.mjs`.
3. Verificar Git remoto y commits autorizados antes de cualquier push.
   Preparar la release con el **commit exacto de esta implementación**,
   fuentes limpias y `node scripts/frontend-release-build.mjs --export-snapshot`.
   Actualizar el contrato existente `deploy/consolidation-release-scope.json`:
   mismo commit que `release-source.json`, `backendSources: []`, solamente
   fuentes frontend listadas arriba y assets derivados del grafo Vite real.
   El contrato actual sigue apuntando a una fase OLT anterior: **no usarlo**
   para esta release sin prepararlo. No crear un sistema de despliegue paralelo.
4. Ejecutar por separado `node scripts/frontend-consolidation-release.cjs prepare`
   y luego `node scripts/frontend-consolidation-release.cjs build`. Exigir
   respaldo/rollback probado, doble build reproducible, importaciones y
   comprobación de que no se incorporan cambios de otras fases. Este build
   local de revisión no sustituye esos controles de release.
5. Con autorización de publicación: push solo de commits autorizados y
   frontend compatible primero mediante `node scripts/frontend-consolidation-release.cjs deploy`,
   seguido de `node scripts/frontend-consolidation-release.cjs verify`.
   Confirmar el commit servido y recarga de las aplicaciones de Campo.
6. En ventana coordinada sin nuevos cierres, con autorización SQL separada,
   ejecutar **solo** `20261111140000_installation_iptv_mode.sql` en el proyecto
   identificado, con `psql -X -v ON_ERROR_STOP=1 -f <archivo>` usando el canal
   privado existente (nunca contraseña en argumentos/logs). No usar un
   `supabase db push` que arrastre migraciones ajenas. Registrar aplicación
   en el mecanismo de migraciones utilizado y comprobar columnas, DEFAULT,
   funciones/ACL y trigger, sin backfill ni cierres de prueba de clientes reales.
7. Confirmar funcionalidad con fixtures aislados y luego observar el primer
   uso autorizado en una **nueva** Alta real. No usar Rosita ni otra orden
   cerrada. Actualizar continuidad con imágenes, commit y evidencia reales.

Rollback autorizado: pausar cierres, restaurar frontend anterior con el
rollback de la misma release, ejecutar `scripts/rollback-installation-iptv-mode.sql`
por el canal privado y verificar. Restaura exactamente la función capturada;
retira preflight/validador y DEFAULT/trigger de inserción nuevos. Conserva
columnas, valores y guarda UPDATE para proteger la constancia ya guardada.
Se probó reaplicar la migración después de este rollback sin tocar filas.

Riesgos: aplicaciones antiguas fallarán cerradas al cerrar un Dúo nuevo sin
modalidad; colas antiguas requieren completar el dato. Reservas Rayco sin
asignación desde custodia no cumplen el nuevo cierre. El rollback vuelve
a exigir TV Box y puede bloquear Altas nuevas iniciadas por app, sin borrar
sus modalidades. Cambios concurrentes por las RPC existentes se serializan;
conflictos/lock timeout requieren recargar y reintentar, nunca asignar dos veces.
