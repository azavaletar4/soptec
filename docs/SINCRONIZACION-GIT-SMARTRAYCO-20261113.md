# Sincronización Git/GitHub de SmartRayco — 13/11/2026

Alcance: exclusivamente el panel ISP en D:\SmartRayco, remote origin https://github.com/azavaletar4/soptec.git. No se accedió al repositorio de la aplicación independiente Rayco TV. La rama release/iptv-20261111 de ESTE repositorio corresponde a instalaciones/contratos Altas Dúo del panel; se conservó esa funcionalidad legítima.

## Referencias e integración

Antes: main `29abf466343ee722f36c222861d24eea0098c5a1`, origin/main `be3b44da762b359e283da2b7c5492166397138ea`: 26 commits locales adelantados, ninguno remoto exclusivo.

Resultado funcional validado: `f4f96a284247dc43fbfefe449988e2dc0b0f526a`. El commit posterior solo actualiza esta documentación y la continuidad. Referencia de cierre prevista: `sync/smartrayco-20261113`, que identifica el HEAD final de main y origin/main una vez confirmado el push. El recibo local `scripts/inventory-auth-lab/runtime/git-sync-20261113/RESULTADO-FINAL.md` registra ambos SHA completos después de verificar GitHub; no confundir el commit probado con el HEAD documental final. Este informe previo al push por sí solo no acredita su ejecución.

| Trabajo validado | Commits / tratamiento |
|---|---|
| PPPoE | a4a5b41, 8875af0, f1f9ab4 y publicación 45f993e; fuente aislada b3cdef6 incorporada por historial publicado |
| Dashboard V2 | 80e8e7e, f9a2845, 2744b48 y publicación b67e31a; fuente aislada 1d9dd40 incorporada |
| Soporte / Prospectos | 61e0e31, f619d65 y evidencia 29abf46; fuente publicada 9e1e7c1 incorporada |
| Ranking | e114fb6, 37cf0ec, 8bbc006 ya en main; sin ejecutar SQL nuevamente |
| Altas Dúo/IPTV del panel | Funcionalidad ya en main; cierre selectivo b796c6e → 7823833 y 191c244 → f4f96a2 |

Merge `7ed5584`: incorpora el historial exacto publicado de 9e1e7c1. Único conflicto add/add en scripts/tests/dashboard-pppoe-browser.mjs: se conservó la prueba V2 más reciente y se comprobó que mantiene los 14 escenarios nombrados del original. Ninguna fuente de producto cambió. No se descartó ninguna funcionalidad.

No se fusionó en bloque release/iptv-20261111: contenía historia duplicada y una versión anterior del empaquetador. Los dos commits seleccionados cierran evidencia real y corrigen dos hashes históricos ya comprobados del manifiesto IPTV; no se alteraron validadores ni el empaquetador reproducible actual. La rama original permanece íntegra.

## Preservación

68 archivos originales (4 modificados y 64 sin seguimiento), verificados por SHA-256: todos conservados en el worktree local `scripts/inventory-auth-lab/runtime/git-sync-20261113/wip`, rama `wip/otros-trabajos-20261113`. Segunda copia exacta en snapshot del mismo directorio. Los cuatro modificados tienen además stash y referencia fija `recovery/git-sync-20261113/local-stash`.

Referencias de recuperación: main-before (29abf46), origin-main-before (be3b44d), iptv-before (191c244), frontend-published (9e1e7c1), bajo recovery/git-sync-20261113/. No se publican WIP, stash, snapshots, credenciales, archivos .env privados, dumps ni imágenes Docker. Los otros worktrees y ramas se conservan sin modificaciones. El main principal puede quedar limpio sin eliminar ni dar por terminados esos trabajos.

## Ramas conservadas fuera de la integración por ancestro

No estar incorporada por SHA no demuestra que falte su funcionalidad en producción: hay publicaciones selectivas/cherry-picks anteriores. Se conservan para revisión propia, sin fusionarlas automáticamente. No existen conflictos pendientes en la integración candidata; estas ramas no se certifican integrables en bloque.

| Rama | HEAD conservado |
|---|---|
| backup-fase3-olt-fase158-pendiente | 3af9986 |
| deploy/fase175-frontend-base-87ddfd3-20261026 | 99dc78b |
| deploy/fase175-trafico-selective-20261026 | 53f284c |
| diagnostico/tr069-genieacs-readonly | 8968e69 |
| docs/olt-suspension-20261021 | e358599 |
| feature/asistencia-a0-a1-local | 2391f19 |
| feature/asistencia-a2-local | 9918bb2 |
| feature/asistencia-a3-local | 24ef0eb |
| fix/averias-rutinas-custodia-20261020 | f6e60f5 |
| fix/campo-direccion-contrato-local | becdc38 |
| fix/inventario-detalle-retorno | 5952184 |
| fix/olt-retiro-historico-20261021 | 1da360d |
| fix/puntos-noviembre-local | 5a3b7b2 |
| hotfix/cierre-alta-cuadrilla | 592d282 |
| preparacion/olt-janet-estiven-post169-tipos | 6ae885d |
| release/fase175-counter-batches-20261026 | 16831c6 |
| release/inventario-655ea29-1792194002372 | 4e967d0 |
| release/iptv-20261111 | 191c244 |
| visual/campo-cabecera-20261020 | 9ad1cbb |

Las ramas que ya son ancestros están incluidas en el historial, sin borrarlas. release/dashboard-v2-20261112 (1d9dd40) y release/dashboard-support-prospects-20261113 (9e1e7c1) se publicarán con main por push normal; release/iptv-20261111 ya existía en origin. Ninguna rama ajena se publica por --all. No había PR abiertos; la integración no necesita PR si GitHub admite el avance normal de main. Si existe protección, se respeta y se detiene el push directo.

## Pruebas sobre el candidato exacto

- vue-tsc + Vite: PASS.
- 587 pruebas en 62 archivos: PASS; 0 fallos, 0 omitidas. Incluye lógica de soporte/prospectos, Altas/IPTV y regresiones del panel.
- 35 comprobaciones de Dashboard + 16 de PPPoE: PASS, con build estático, escritorio/tablet/móvil (17 anchos, 320–1920 px), permisos, actualización, errores y datos desactualizados.
- APIs simuladas solo en el entorno de pruebas: 0 solicitudes externas y 0 escrituras. No se cambió código productivo para probar.
- 323 archivos fuente frontend coinciden con la fuente publicada 9e1e7c1; server/src y dependencias coinciden con b3cdef6. Sin diferencias de producto frente al main previo.
- Inspección de los 32 commits nuevos alcanzables antes del cierre documental, 385 blobs (355 de texto), incluidas versiones anteriores: 0 secretos/patrones prohibidos detectados. No es una garantía universal de ausencia de información sensible.
- Los 68 archivos WIP conservan exactamente sus hashes originales.

Evidencia resumida: SINCRONIZACION-GIT-SMARTRAYCO-20261113.json. Logs y capturas locales: scripts/inventory-auth-lab/runtime/git-sync-20261113/validation/. La revisión final de Git y el recibo se generan después del push, sin repetir compilaciones por cambios exclusivamente documentales.

## Correspondencia con producción y límites

Última evidencia disponible: publicación controlada del 13/11/2026, 00:51 Perú (05:51 UTC); NO se consultó ni modificó la VM en esta sincronización.

| Servicio | Fuente documentada | Imagen documentada |
|---|---|---|
| Frontend | 9e1e7c1c4e71c354c4c8878cdfc97cd6bf748c09 | sha256:191462d2258a80a3380e919e239d410d322c41fcf3df43f73f2c6a1543f20b58 |
| Backend | b3cdef65c2830c2f44270568d7038b342b68b3e6 | sha256:165126136e3178840e6443094b42993a73a43b79a4b3aa6149f17a3730e2fe16 |

Fuentes: docs/DASHBOARD-PPPOE-PUBLICADO-20261112.md, docs/DASHBOARD-V2-PUBLICADO-20261112.md, docs/DASHBOARD-SOPORTE-PROSPECTOS-PUBLICADO-20261113.md y docs/ALTAS-IPTV-MIGRACION-SQL-APLICADA-20261111.md. Los 12 trabajos y 1 prospecto son la lectura de aquella publicación, no una nueva lectura operativa. La sesión visual autenticada en producción sigue siendo una limitación documentada; no se inventa su validación.

La existencia de propuestas de asistencia, cancelación sin instalación u otras fases en Git no acredita despliegue. Los respaldos automáticos siguen siendo la siguiente fase; esta sincronización no los implementa ni activa. No se ejecutaron despliegues, migraciones, consultas productivas ni operaciones sobre equipos.

## Riesgos y comprobación final

GitHub tiene master como rama predeterminada histórica (aadd198), diferente de main. Se conserva esa configuración: seleccionar explícitamente main al iniciar trabajo o PR. El repositorio es público; los archivos privados y trabajos sin clasificar permanecen locales. Las ramas antiguas se conservan como referencias, sin forzar una convergencia artificial de todo el repositorio.

Comprobar al finalizar: main limpio, main = origin/main = tag de cierre, ahead/behind 0/0, fuentes de producto sin cambios y 68 originales preservados. No usar reset --hard, clean, force push ni rebase destructivo. La sincronización completa acredita Git; no sustituye una verificación en vivo de producción.
