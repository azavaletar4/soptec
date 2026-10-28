# Verificador Vite: regla de unicidad corregida — build real PASS, sin desplegar

28/10/2026 (continuación, sesión posterior a `cb5ba7f`). **Sin despliegue.**
Corrige el bloqueo documentado en
`docs/TR069-HOSTS-VITE-VERIFICADOR-20261028.md`. Commit de la corrección:
`91e9ff1`. Fuente funcional candidata sigue intacta:
`ac511d7c70c8a11700d3553f331af5bb2930926a` (Hosts bajo demanda).

## Causa raíz

`validate_vite_manifest` (en `scripts/consolidation-release-contract.py`)
exigía, para las cuatro listas de cada entrada del manifiesto Vite
(`imports`, `dynamicImports`, `css`, `assets`), que no tuvieran valores
repetidos (`len(values) == len(set(values))`). Esa exigencia es correcta
para `css`/`assets` (rutas físicas: repetir una no aporta nada y señalaría
un manifiesto mal formado), pero es **incorrecta** para `imports`/
`dynamicImports`: Vite nativamente repite una misma clave en esas listas
cuando el código fuente compilado tiene varias llamadas `import()`/import
estático al mismo módulo. Confirmado real en ambos manifiestos (producción
activa y candidato), sin relación con el cambio de Hosts:

| Entrada que repite | Campo | Clave repetida | Veces |
| --- | --- | --- | --- |
| `_AsistenciaPanel.vue...-DZTZIfka.js` (activo) / `...DDefuQq7.js` (candidato) | `dynamicImports` | `index.html` | 4 |
| `vue3-apexcharts` (SSR) | `dynamicImports` | chunk de `apexcharts.ssr.esm` | 2 |

No era una colisión física ni corrupción — el resto de controles (tipo de
cada valor, existencia de la clave referida en el manifiesto, cobertura del
grafo, hashes) ya pasaban antes de llegar a esta regla.

## Corrección aplicada

En `validate_vite_manifest`, la comprobación de "sin repetidos" se restringe
a `css`/`assets`; `imports`/`dynamicImports` ya no la exigen, conservando
el resto de sus validaciones (tipo string, que cada clave referida exista en
el manifiesto). No se tocó ningún otro control: grafo real alcanzable,
entradas HTML, hashes de `release-manifest.json`, identidad/dependencias
protegidas de módulos ajenos (`VITE_METADATA_IDENTITY_CHANGED`,
`VITE_PROTECTED_DEPENDENCIES_CHANGED`) siguen exactamente igual — las listas
normalizadas (`record[field] = sorted(...)`) conservan las repeticiones, así
que una entrada protegida con el mismo patrón nativo de repetición sigue
comparándose igual entre `before`/`after` sin margen nuevo para ocultar un
cambio real.

## Pruebas

`node scripts/tests/consolidation-release-contract.test.cjs` (Python
estándar de la VM, puro en memoria, sin Docker/datos/tareas) y la misma
suite ejecutada localmente sin red: **31 PASS** (antes 30 PASS + 1 FAIL).
`test_vite_native_repeated_dynamic_imports_are_valid` ahora pasa; ninguna
otra prueba cambió de resultado — todas las protecciones de Asistencia,
Puntos, Campo, OLT, Rutinas, WiFi, colisión QR y extracción GPON siguen
cubiertas y en verde.

## Build real aislado

`prepare` y `build` reales ejecutados sobre el candidato `ac511d7`, mismo
alcance que ya estaba declarado (`deploy/consolidation-release-scope.json`,
Hosts backend+frontend, serial único `HWTC1D3691B7`):

```
prepare → {"prepared":true,"rollbackTested":true,...,"servicesChanged":false}
build   → {"built":true,"reproducible":true,
           "contractGuardValidatedReadOnly":true,"artifactCount":126,
           "frontendChangedAssets":["assets/Tr069View.js","assets/tr069.js"],
           "servicesChanged":false}
```

El build pasó exactamente el punto donde antes fallaba con
`INVALID_VITE_LIST:...AsistenciaPanel...:dynamicImports`. Únicos assets de
frontend marcados como cambiados: los dos ya autorizados por el alcance.
No se ejecutó `deploy` ni `verify`. Cero tareas GenieACS. No se tocó Hosts,
OLT, MikroTik, WiFi, PPPoE, WAN, VLAN ni ningún otro módulo funcional — el
único archivo de código modificado es `scripts/consolidation-release-contract.py`.

## Pendiente (no ejecutado en esta sesión)

Igual que antes de este bloqueo: doble build backend/frontend completo,
nginx del candidato, archivos de imágenes candidatas, controles de drift
predeploy, `deploy`, verificación HTTP de todas las rutas/assets y
`verify` posterior. No se afirma que vayan a pasar sin ejecutarlos.

## Estado para despliegue

El verificador queda corregido y validado con build real; **el despliegue
de Hosts sigue sin autorización explícita del propietario** — no ejecutar
`deploy` sin ese pedido explícito en el turno correspondiente (regla 16 de
`CLAUDE.md`).
