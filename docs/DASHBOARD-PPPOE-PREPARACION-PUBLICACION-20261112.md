# PPPoE: preparación de publicación aislada

**LISTO PARA SOLICITAR AUTORIZACIÓN. No desplegado; producción sin cambios.**
Se incorpora la confirmación del usuario: no se utiliza RADIUS; los clientes se
autentican en el único Administrador CCR2116. No se cambia ninguna configuración.

## Alcance y alias

Implementación: `a4a5b41`. La base frontend activa es `bcb3ec4`. Para conservar lo
publicado, se reaplicó exclusivamente ese cambio en un worktree local aislado:
**fuentes de publicación `b3cdef65c2830c2f44270568d7038b342b68b3e6`**.
Sus seis archivos de producto son idénticos a los de `a4a5b41`.

Servicios afectados: **backend y frontend**. Caddy, Mongo, GenieACS, volúmenes,
configuración efectiva y servicios/tablas de tráfico permanecen iguales.

| Backend: cuatro fuentes de overlay | Frontend: tres fuentes modificadas |
| --- | --- |
| `server/src/routes/dashboard.ts` | `src/views/DashboardView.vue` |
| `server/src/services/dashboardPppoeHandler.ts` | `src/components/dashboard/PppoeProfileCards.vue` |
| `server/src/services/dashboardPppoeProfiles.ts` | `src/lib/pppoeProfileCounts.ts` |
| `src/lib/pppoeProfileCounts.ts` (compartido) | |

El error `TS2307` del checkout está en `src/types/domain.ts:348`, en un
`import(...)` **solo de tipo**, anterior al cambio. El alias desaparece al
transpilar. El Dockerfile backend ejecuta `tsx`, sin un gate `tsc`; Vite y el
tsconfig frontend ya resuelven `@/`. El overlay no incorpora `domain.ts` ni
modifica tsconfigs, dependencias o componentes IPTV.

La candidata se construyó sobre la imagen backend activa con Node **22.23.4**.
Sus fuentes productivas pasan tipos y sus rutas cargan correctamente. El
chequeo global de esa base contiene dos errores antiguos en tests; son
exactamente iguales antes/después y no forman parte de la ejecución. No se
ocultan ni se corrigen dentro de esta publicación. **El alias no bloquea este
paquete ni su despliegue mediante el procedimiento preparado.**

## Integridad y pruebas

Se construyeron dos imágenes frontend Linux sin red sobre las imágenes activas;
sus manifests y artefactos son reproducibles. Se preservan assets históricos y
Nginx. El contrato existente verificó que solo cambian las tres fuentes frontend.

Rollup regeneró aliases/imports e identificadores locales en otros 83 JS. La
prueba adicional compara símbolos resueltos, claves públicas y operaciones AST:
solo varían nombres de compilación; el cuerpo del entrypoint común es idéntico.
**No se reescriben assets ni se relajan las guardas existentes.** El cambio
funcional queda en Dashboard y su CSS. El alcance completo generado está en
`deploy/pppoe-20261112/scope.json`; la prueba en `linker-proof.json`.

- **16 pruebas backend PASS**, usando Node 22 sobre la base aislada.
- **34 pruebas del contrato de publicación PASS** y **7 de la prueba AST PASS**.
- **16 verificaciones de navegador sobre la imagen frontend compilada PASS**:
  hora Perú, cuatro tarjetas, móvil 320/375/1440, actualización, errores,
  permisos, no solapamiento y cancelación. Datos ficticios y red externa bloqueada.
- **Transporte real RouterOS del backend candidato contra mock local PASS**:
  contenedor sin red; únicamente GET; 25 solicitudes comparten un lote de dos
  lecturas PPP más la comprobación de hardware; duplicados y stale correctos.
- Tipos de fuentes productivas backend **PASS**; importación/auth de las rutas
  nueva y existentes **PASS** en Node 22/Linux, sin arrancar schedulers.
- Árbol real de la imagen backend: solo las cuatro fuentes declaradas cambian.
  Configuración de ejecución de ambas imágenes y Nginx: **iguales a la base**.

La función PPPoE solo hace SELECT de configuración y GET al CCR2116; no solicita
contraseñas PPP. La caché es un único agregado en RAM, TTL 60 s y una promesa
compartida. Sustituye la lectura completa; no hay acumulación histórica ni
persistencia. Fallos: stale con fecha original o null/sin datos, nunca cero falso.

## Respaldo y paquete

Imágenes originales, exportadas por lectura y verificadas tras cargarlas solo
en Docker local:

- Backend: `sha256:87e442e9bdcf17fcd192dbe401fa533c5746e8fd96658b50e0fe24b175162001`.
- Frontend: `sha256:6ed5f7751bb2f8b7c26baf6bed8228c1c9ed695ef60a25c2ca676a36bbea923d`.

Los `.tar.gz`, sus SHA-256 y las copias exactas de fuentes/assets están en el
directorio privado ignorado por Git `scripts/inventory-auth-lab/runtime/pppoe-publication/`.
Se comprobó que esas imágenes restauran exactamente el software previo.

`deploy/pppoe-20261112/preparation.json` identifica paquete, fuentes, imágenes,
respaldos y huellas. `verification.json` valida paquete/respaldos y que los cinco
servicios mantienen ID, imagen, inicio y entorno originales. No se incluye SQL,
secretos, cambios de entorno ni registros de lecturas PPPoE.

## Procedimiento posterior a una autorización expresa

No ejecutar todavía los comandos de promoción. Usar el publicador existente,
con estos argumentos en todas sus acciones:

```powershell
$pppoeScope = 'deploy/pppoe-20261112/scope.json'
$pppoeSnapshot = 'scripts/inventory-auth-lab/runtime/pppoe-publication/release-source.json'
```

1. Reconfirmar la base, huellas y respaldos. Si cambian, detenerse y renovar la
   preparación; no sustituir el alcance por HEAD ni desplegar todo el stack:
   `node scripts/pppoe-publication-readonly.cjs --state-only`, seguido de
   `node scripts/pppoe-publication-verify.cjs`.
2. Con autorización, ejecutar `node scripts/frontend-consolidation-release.cjs
   prepare --scope $pppoeScope --snapshot $pppoeSnapshot`. Esta fase futura crea
   staging privado, guarda las imágenes/Compose efectivos y prepara rollback.
3. Ejecutar la misma herramienta con acción `build`. Conserva configuraciones
   y verifica alcance/reproducibilidad; no despliega. Antes de promover es
   **obligatorio** `node scripts/pppoe-publication-verify.cjs --built`: exige que
   los árboles construidos en VM coincidan exactamente con los probados aquí,
   incluida la prueba de enlaces. Si difieren, detenerse sin desplegar.
4. Ejecutar la herramienta con acción `deploy`, los mismos scope/snapshot. Solo
   recrea backend y frontend con `--no-deps --no-build --pull never`. No tocar
   Caddy, Mongo, GenieACS, volúmenes, Supabase ni MikroTik.
5. Acción `verify`, salud HTTPS y revisión autenticada del Dashboard: cuatro
   perfiles, fecha Perú reciente, comparación de registrados/conectados, permisos
   y móvil. No aceptar "Sin datos" como una lectura válida de cero. No guardar
   nombres PPP ni listas completas en los registros de comprobación.

Rollback: la herramienta con acción `rollback` y los mismos argumentos restaura
ambas imágenes anteriores, con configuración y entorno originales. Su guardado
y validación están implementados en el publicador; si falla la promoción o su
verificación, dispone de rollback automático. También se conserva la referencia
exacta de imágenes en `rollback.override.json`; no reconstruir ni usar tags latest.

Riesgo residual: breve reinicio de dos servicios y caché inicialmente fría; los
errores de tipado global ajenos siguen visibles para una futura tarea de CI.
Si cambian fuentes/base, toolchain, entorno o artefactos, las huellas y la prueba
de publicación deben renovarse. Los contadores no requieren migraciones ni
escrituras de datos. **En esta preparación hubo cero despliegues y cero cambios
en producción, Supabase o MikroTik.**
