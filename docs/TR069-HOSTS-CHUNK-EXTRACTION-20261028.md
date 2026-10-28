# Hosts: extracción GPON verificada; nuevo bloqueo de manifiesto

28/10/2026. Fuente de aplicación candidata: `ac511d7c70c8a11700d3553f331af5bb2930926a`.
Commit local de tooling/pruebas/evidencia: `dce97e7`. Sin cambios funcionales.

## Causa y evidencia del grafo

La fuente nueva autorizada `src/lib/tr069HostsPanel.ts` importa
`normalizeGponSerial` para identificar exactamente la ONT al abrir/actualizar
Hosts. La vista OLT ya usaba ese mismo helper. Vite extrae el código antes
integrado en OLT a un chunk compartido de 376 bytes normalizados.
`src/lib/gponSerial.ts` no cambió: SHA-256
`60ef16fbdd7026ccf2e9a24236124de72113dd975673d69fc6dce6fd29f6a947`.

| Grafo activo | Grafo candidato |
| --- | --- |
| `OltDetailView-BVbRmhxl.js`, helper integrado | `OltDetailView-CHQ7riMi.js` → `gponSerial-YN5nGXc9.js` |
| `Tr069View-CjCNZeig.js`, sin ese import | `Tr069View-cQ7k5iEr.js` → `gponSerial-YN5nGXc9.js` |
| 122 assets alcanzables | 123 assets alcanzables |

El código de entrada añade la precarga de GPON únicamente a OLT y TR-069;
no importa directamente el helper. El nuevo chunk no tiene dependencias.
Grafo completo con nombres físicos/imports:
`docs/TR069-HOSTS-CHUNK-GRAPH-20261028.json`.

`node scripts/hosts-chunk-extraction-proof.cjs` PASS sobre la captura real:

- AST del helper antiguo y extraído iguales, neutralizando solo bindings locales.
- AST protegido de OLT igual tras reemplazar las tres declaraciones del helper
  por su import. Se conservan operadores, literales, propiedades y dependencias.
- `index.js` idéntico byte a byte al revertir la tabla/índices de precarga y quitar
  solo GPON de las dos rutas indicadas; las demás precargas permanecen iguales.

Prueba y hashes: `docs/TR069-HOSTS-CHUNK-PROOF-20261028.json`.
Captura bruta para repetir la prueba: runtime ignorado
`scripts/inventory-auth-lab/runtime/hosts-chunk-capture.json`.
Se regenera con `node scripts/hosts-release-collision.cjs graph` (solo imágenes
y salud por SSH; no endpoints GenieACS). No requiere ni envía tareas TR-069.

## Contrato y pruebas

El contrato anterior exigía igual conjunto de nombres lógicos y confundía esta
extracción con una modificación funcional. Ahora reconoce esta transición
revisada, fijando commit, fuente intacta, diferencias exactas de fuentes
autorizadas, hashes antiguos/nuevos de OLT/index/helper e importadores exactos.
No se añadió OLT/index/GPON a frontendAssets. Cualquier byte funcional distinto
de los artefactos probados vuelve a fallar. No autoriza automáticamente otras
extracciones futuras: requieren evidencia equivalente y revisión explícita.

Siguen estrictos todos los demás chunks, Asistencia, Puntos, Campo, OLT,
Rutinas, WiFi, archivos estáticos/huérfanos y los dos workers QR fijados.
`node scripts/tests/consolidation-release-contract.test.cjs`: **21/21 PASS**.
Incluye tres modos de release, colisiones, extracción válida, rechazo de cambios
funcionales, fuente alterada, dependencia inesperada, alcance o commit incorrectos.

## Intento de release y detención

- `prepare` PASS: imágenes activas respaldadas y restauración aislada probada.
- `build` supera el control GPON y falla en el control siguiente:
  `UNRELATED_STATIC_ASSETS_CHANGED:.vite/manifest.json`.
- Causa concreta del nuevo bloqueo: `.vite/manifest.json` queda fuera del grafo
  alcanzable JS/CSS y el contrato exige igualdad binaria como archivo estático;
  el build candidato produce bytes diferentes. No se analizó ni aceptó esa
  diferencia como excepción. Ese control permanece intacto.
- Se detuvo, según instrucción expresa de no encadenar soluciones ante otro
  bloqueo. No se completó doble build, ni build backend, deploy o verify.

## Producción y rollback

SSH y `/api/health` PASS al cierre **23:32:37 UTC**. Mismos cinco contenedores,
imágenes y arranques. Evidencia: última entrada de
`docs/TR069-HOSTS-ASSET-COLLISION-20261028.json`.

- Frontend activo `smartrayco-frontend-consolidado:5d48a10ea497`,
  `sha256:eaa37bca78b9a3ab9006728d8794fd60b1abc9f4da75e88f59aeeb672d1c103b`.
- Backend activo `smartrayco-backend-wifitrial:d6ce2c2f578f`,
  `sha256:1e6ab34c4fae061efc4943a7fa717b88acd388eb5f06038e96de2aa8255e3001`.

Staging vigente: `/opt/smartrayco-staging/frontend-consolidado-tr069-ac511d7-86075e28a2/`.
Respaldos `backend-before.image.tar` y `frontend-before.image.tar`, restauración
aislada probada contra las imágenes anteriores y configuración efectiva intacta.
No hizo falta rollback en producción. Procedimiento disponible, conservando
este contrato/snapshot/tooling: `node scripts/frontend-consolidation-release.cjs rollback`.
Resultados en runtime local `consolidation-release/` bajo el mismo nombre de staging.

CLAUDE.md y ESTADO_DE_CONTINUIDAD actualizados. No se alteraron fuentes de app,
equipos ni módulos ajenos. Cero tareas TR-069, push, merge o migraciones.
Pendientes de otras fases intactos. Hosts bajo demanda sigue sin desplegar;
no se afirma validación visual nueva. Esperar indicación sobre el nuevo bloqueo.
