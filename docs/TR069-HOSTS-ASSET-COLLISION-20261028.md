# Hosts: colisión corregida, publicación detenida por nuevo bloqueo

28/10/2026. No se repitió la prueba activa previa ni se enviaron tareas TR-069.

## Causa comprobada y corrección

El normalizador retiraba los sufijos Vite y usaba un diccionario por nombre
lógico: dos archivos distintos terminaban en `assets/qr-scanner-worker.min.js`.
Son dos assets legítimos, alcanzables desde AuthorizeOnuModal y presentes en
el manifiesto, tanto en producción como en el candidato:

| Archivo | SHA-256 idéntico antes/después |
| --- | --- |
| `assets/qr-scanner-worker.min-D85Z9gVD.js` | `f9d5a00a24ef3c0f52453748a018feec9441c0031c7068e41606c744a26491f5` |
| `assets/qr-scanner-worker.min-PJMWJc5V.js` | `f4d8445f5a15c4e5f71a8c8c062c6443f09db370b8d3fe1fbdc7fe7889630d14` |

No existe reemplazo físico entre archivos. Commit local `32e64ee` corrige
únicamente el contrato: los grupos ambiguos exigen igual conjunto de nombres
físicos y bytes exactos; sus referencias tampoco pierden el sufijo al comparar.
Los demás chunks conservan la normalización existente. Siguen vigentes los
controles de estructura, alcance, contenido, archivos estáticos y huérfanos.

Archivos: `scripts/consolidation-release-contract.py` y su prueba Python.
Helper diagnóstico nuevo `scripts/hosts-release-collision.cjs`, sin endpoints
GenieACS; evidencia completa en el JSON del mismo nombre de este documento.

## Validaciones y detención

`node scripts/tests/consolidation-release-contract.test.cjs`: 17/17 PASS.
Cubre backend-only, frontend-only, ambos, cambios ajenos y entorno restringido.
Regresiones nuevas: coexistencia de ambos workers; rechazo al cambiar cualquiera
incluso si se declara su nombre lógico; rechazo de renombrado y de intercambio
de referencias. No cambió código funcional de Hosts ni otros módulos.

Fuente candidata/snapshot permanece `ac511d7c70c8a11700d3553f331af5bb2930926a`.
`prepare`: PASS, respaldos renovados, restauración aislada probada.
`build`: FAIL, ahora supera la colisión pero detecta otra diferencia:

```
HISTORICAL_ASSETS_STRUCTURE_CHANGED:removed=;added=assets/gponSerial.js
```

Se detuvo sin modificar el alcance ni investigar/corregir otro bloqueo,
conforme a la instrucción expresa. No se ejecutaron deploy ni verify.
No afirmar validación visual de la función nueva: continúa sin publicar.

## Producción, respaldos y rollback

SSH y `/api/health` PASS al cierre, 23:25:59 UTC. Los cinco servicios conservan
imágenes, contenedores y arranques; hashes completos en JSON. Activos:

- Frontend `smartrayco-frontend-consolidado:5d48a10ea497`,
  `sha256:eaa37bca78b9a3ab9006728d8794fd60b1abc9f4da75e88f59aeeb672d1c103b`.
- Backend `smartrayco-backend-wifitrial:d6ce2c2f578f`,
  `sha256:1e6ab34c4fae061efc4943a7fa717b88acd388eb5f06038e96de2aa8255e3001`.

Staging: `/opt/smartrayco-staging/frontend-consolidado-tr069-ac511d7-1d3e9f92b7/`.
Contiene `backend-before.image.tar`, `frontend-before.image.tar` y preparado
de rollback contra esas imágenes activas. No hizo falta rollback productivo.
Procedimiento disponible: `node scripts/frontend-consolidation-release.cjs rollback`
con el mismo contrato/snapshot/tooling de este intento, solo si procede restaurar.
Resultados locales: `scripts/inventory-auth-lab/runtime/consolidation-release/`
`frontend-consolidado-tr069-ac511d7-1d3e9f92b7/{prepare,build}.json`.

Sin push, merge, migraciones, cambios de configuración de equipos ni módulos
ajenos. Archivos pendientes de otras fases intactos. CLAUDE.md y el bloque de
continuidad de ESTADO_DESARROLLO.md actualizados. Esperar indicación del
propietario respecto al nuevo bloqueo; no repetir la lectura activa consumida.
