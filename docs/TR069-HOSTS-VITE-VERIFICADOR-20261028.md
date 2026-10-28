# Verificador Vite: implementación local y diagnóstico consolidado

28/10/2026. **Sin despliegue. Corrección local todavía NO lista para publicar.**
Fuente funcional candidata intacta: `ac511d7c70c8a11700d3553f331af5bb2930926a`.
Commit del validador: `8b9f89d`. No se repitió el diagnóstico de extracción GPON.

## Causa original y tratamiento local

El contrato consideraba estático todo archivo fuera del grafo JS/CSS salvo
index.html y release-manifest.json. Por eso `.vite/manifest.json`, generado por
Vite con hashes, índices sintéticos CSS y referencias nuevas, fallaba por bytes
distintos aunque el código funcional estuviera dentro del alcance autorizado.

Los únicos metadatos generados encontrados son `.vite/manifest.json` y
`release-manifest.json`. No se excluyeron directorios ni patrones de JSON.
La implementación local valida el manifiesto Vite antes de eximirlo de igualdad
binaria entre releases diferentes:

- JSON sin claves duplicadas, campos/tipos conocidos, nombres físicos únicos,
  rutas seguras y archivos existentes.
- Referencias entre entradas, correspondencia con imports estáticos/dinámicos
  del JS compilado, entradas de index.html y cobertura del grafo real.
- Identidad, flags, CSS, assets y dependencias de módulos protegidos; conserva la
  transición GPON previamente probada, sin ampliar frontendAssets.
- Normalización limitada al formato sintético de fuentes CSS de Vite; la hoja
  CSS y su contenido siguen comparándose.
- Hashes de release-manifest.json contra archivos reales, cubriendo Vite,
  index.html y todo el grafo. Metadatos obligatorios en el build productivo.
- Backend-only mantiene TODO el frontend idéntico. El doble build continúa
  exigiendo igualdad completa, incluidos los metadatos.

## Resultado real y nuevo bloqueo

`prepare` PASS, con respaldos y rollback aislado. Build frontend canónico
aislado ejecutado, sin red; el contrato pasó los controles de contenido/alcance
del grafo, pero se detuvo en la nueva validación de metadata del frontend activo:

```
INVALID_VITE_LIST:_AsistenciaPanel.vue_vue_type_script_setup_true_lang-DZTZIfka.js:dynamicImports
```

La regla `len(values) == len(set(values))` añadida al validador es demasiado
estricta para arrays de imports Vite. No es una colisión física ni corrupción:
los manifiestos generados nativamente repiten una misma dependencia cuando hay
múltiples llamadas de importación. La revisión conjunta encontró ambos casos,
idénticos en producción y candidato:

| Entrada | Campo | Referencia | Repeticiones |
| --- | --- | --- | --- |
| AsistenciaPanel | dynamicImports | index.html | 4 |
| vue3-apexcharts | dynamicImports | apexcharts.ssr.esm-fe46cd2d.js | 2 |

El candidato falla con el mismo motivo, usando el sufijo DDefuQq7 de su panel.
No se corrigió ni reintentó tras este fallo: se cumplió la instrucción de parar
y entregar una revisión consolidada, sin encadenar parches.

## Diagnóstico consolidado de controles

Solo lectura, sin cambiar el contrato ni habilitar una release:
`node scripts/hosts-vite-diagnostics.cjs`.
La proyección de dependencias como conjuntos se usa para INFORMAR diferencias,
jamás para aprobar/deploy ni modificar los manifiestos capturados.

| Control | Resultado / límite |
| --- | --- |
| Salud, imágenes y arranques de cinco servicios | PASS al cierre 23:42:35 UTC; intactos |
| Fuentes/alcance frontend y grafo funcional protegido | Superados antes del fallo en build; ningún código funcional ajeno cambiado |
| Colisiones QR y transición GPON | Superadas por build; no se ampliaron permisos |
| Referencias inexistentes en ambos manifiestos | 0 |
| Imports compilados inconsistentes en ambos | 0 |
| Assets del grafo sin declarar / chunks inalcanzables | 0 / 0 |
| Entradas HTML frente al manifiesto | Coinciden en ambos |
| Hashes incorrectos / cobertura de artefactos incompleta | 0 / 0 |
| Diferencias semánticas de metadata normalizada | Solo GPON nuevo e import en OLT/TR-069, ya justificados |
| Estáticos e históricos fuera del grafo y metadatos conocidos | 1.119 archivos comparados; 0 diferencias inesperadas |
| Listas de imports Vite repetidas | BLOQUEO: dos arrays por imagen; no corregido |
| Nginx candidato | No ejecutado en este build; sigue después del validador |
| Segundo frontend y reproducibilidad completa | No ejecutados |
| Ambos builds backend, comparación e import de rutas | No ejecutados |
| Guard WiFi solo lectura / Compose efectivo candidato | No ejecutados |
| Archivos de imágenes candidatas y controles de drift predeploy | No ejecutados |
| Deploy, HTTP de todas las rutas/assets y permisos | No ejecutados |

No se afirma que los controles no ejecutados vayan a pasar. Tampoco se afirma
validación visual de Hosts bajo demanda ni estado actual de la cola GenieACS.

Evidencia completa:
`docs/TR069-HOSTS-VITE-METADATA-20261028.json` (manifiestos y hashes capturados) y
`docs/TR069-HOSTS-VITE-DIAGNOSTICO-CONSOLIDADO-20261028.json`.
La comparación estática adicional usa esos hashes y el grafo ya capturado del
mismo candidato; no cambia ningún archivo de las imágenes.

## Pruebas y archivos

Suite inicial: 30 PASS. Tras incorporar reproducción del caso nativo:
`node scripts/tests/consolidation-release-contract.test.cjs` → **30 PASS + 1 FAIL**.
Fallo explícito: `test_vite_native_repeated_dynamic_imports_are_valid`.
No se silenció con expectedFailure. Debe quedar verde antes de otra release.
Las regresiones cubren manifiesto legítimo, assets/imports faltantes, cambios
funcionales ajenos, colisiones físicas/QR, extracción compartida, CSS sintético,
metadatos desconocidos, hashes y backend-only estricto.

Archivos de código tocados: contrato Python, entrypoint Python de release
(requiere manifest), pruebas Python, helper de captura y nuevo diagnóstico de
solo lectura. CLAUDE.md y ESTADO_DESARROLLO.md actualizados. Pendientes ajenos
intactos. No se modificó lógica funcional de Hosts ni de los módulos protegidos.

## Imágenes activas, respaldos y rollback

- Frontend `smartrayco-frontend-consolidado:5d48a10ea497`,
  `sha256:eaa37bca78b9a3ab9006728d8794fd60b1abc9f4da75e88f59aeeb672d1c103b`.
- Backend `smartrayco-backend-wifitrial:d6ce2c2f578f`,
  `sha256:1e6ab34c4fae061efc4943a7fa717b88acd388eb5f06038e96de2aa8255e3001`.

Staging vigente: `/opt/smartrayco-staging/frontend-consolidado-tr069-ac511d7-6e89052be8/`.
Contiene `backend-before.image.tar`, `frontend-before.image.tar` y preparado de
rollback con restauración aislada probada y configuración intacta. No hizo falta
rollback productivo. Comando disponible, con este mismo tooling/snapshot:
`node scripts/frontend-consolidation-release.cjs rollback`.
Resultados locales en runtime `consolidation-release/` bajo el mismo staging.
No existe built.json, intento de deploy ni auto-rollback en este intento.

Sin tareas GenieACS, cambios de equipos/configuración, push, merge ni migraciones.
Esperar nueva indicación para resolver el caso de arrays repetidos y ejecutar
los controles pendientes; no repetir la prueba real de Hosts ya consumida.
