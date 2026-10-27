# Devoluciones desde Mi custodia — recuperación y despliegue

## Equipos seriados, custodia e instalación — fase cerrada operativamente

El propietario confirma que el **25/10/2026** se realizaron **tres instalaciones
reales exitosas** con instalación de equipos desde App de Campo. El circuito
está implementado y desplegado: **entrega al técnico → custodia → instalación
y devolución**, operativo y **sin defectos reportados**. Devolución y recepción
administrativa ya fueron validadas y cerradas por el propietario el 26/10/2026.
No volver a tratar esta fase como desarrollo pendiente ni exigir repetir las
pruebas anteriores para reconocer su cierre operativo.

Alcance de la evidencia: es la confirmación expresa del propietario sobre las
tres instalaciones. No acredita por separado cada categoría ONT, Mesh y TV Box,
ni verificaciones individuales de serie/MAC, contrato o movimientos de custodia.
No inventar esos detalles ni confundir cierre operativo con certificación
individual por categoría. Versiones productivas documentadas conservadas:
frontend `c11f6a8`, backend `16831c6`. La meta permanente de estabilidad y
rendimiento para al menos **3.000 clientes** se mantiene como requisito
transversal; no reabre esta fase operativa.

Esta actualización es solo documental: sin pruebas, auditorías, código,
consultas productivas, migraciones ni cambios de inventario/contratos.



## Antecedente: despliegue del 26/10/2026, anterior a la aceptación del propietario

La publicación aprobada `c11f6a8838faade40a605927818df4b67f5e4f11` está en
GitHub main mediante push normal. Se desplegó solo el frontend:

- Tag: `smartrayco-campo-returns:c11f6a8-20261026T171151Z`.
- ID: `sha256:b6c98bc654906516d8a72eb4d5cdf21d2380d6eda7e1aaffddaff03a0858f84a`.
- Contenedor: `db47bfa3e71cfcfab8a61dd7a1b1bcb6e0d1e1934cc4a1b8958177438343f533`.
- Arranque UTC: `2026-10-26T17:14:07.85212786Z`.
- Backend 16831c6 conservado: `sha256:6631d4a124b631f7bedd3d8c2b6f6c8ab7e524e264385ae2fae2b46e3f67047e`, contenedor
  `1a0c00376d3b2cd5ff623e90e8050bc092deb7602976b35d852179cb54f360a9`, mismo arranque `2026-10-26T16:27:41.085443964Z`.

Se copió la fuente REAL del frontend activo (Fase 175) y se superpusieron
exclusivamente las dos vistas de custodia y su validador existentes. Comparación
completa de fuentes: exactamente tres diferencias; ningún otro archivo cambió.
Build PASS. Runtime, argumentos originales, nginx, Puntos y Analítica conservados;
se conservaron también los recursos estáticos anteriores salvo el índice nuevo.
Los 582 archivos del artefacto extraído se verificaron por SHA256 antes del
navegador. No se compiló desde todo main ni se reconstruyó o reinició backend.

Pruebas previas 25/25 SQL/unitarias reutilizadas (código y RPC sin cambios).
Navegador sobre candidato compilado y dominio público, con datos ficticios:
PASS, dos botones de solicitud, equipo y material parcial, espera de recepción,
saldo material intacto hasta recepción y cero mutaciones reales. El técnico
queda redirigido al Campo si intenta entrar a Inventario general. Puntos,
Alta, Avería y Rutina PASS, sin excepciones. Panel/9 rutas HTTP 200 y API ok;
backend, Caddy, Mongo y GenieACS conservaron imagen, contenedor y arranque.
Cero errores críticos. Sin SQL, tablas, rutas, permisos o datos reales cambiados.

**Aceptación posterior COMPLETADA:** el propietario confirmó el 26/10/2026
la devolución desde App de Campo y su recepción administrativa satisfactorias.
Ambas pruebas están cerradas; no siguen pendientes. La sesión técnica del
despliegue no creó ni confirmó devoluciones reales; la validación operativa
posterior corresponde al propietario. Rechazo e
historial resuelto de equipos mantienen su limitación anterior. Se mantienen
los riesgos separados de escala/seguimiento de Analítica de Fase 175.

### Respaldo y rollback de este despliegue

- Stage: `/opt/smartrayco-staging/campo-returns-c11f6a8-20261026T171151Z`.
- Imagen anterior: `smartrayco-frontend-fase175:99dc78b-20261026T154532Z`, ID `sha256:3155f928b6b5492c9f4398e3a7601ad442a0b5b6f866bbbe637d89b7df05d959`.
- Tag de respaldo: `smartrayco-campo-returns-rollback:20261026T171151Z`.
- Archivo: `recovery/frontend.tar`; SHA256 `bf917fd96b749f9c9ff97816c1c76496537063260324fb6456ad31cd6edb8f58`.
- Candidato: `candidate.image.tar`; SHA256 `642861ebe079bff4d566aa8e773ffac9cd4b0afa49e88d7c7fd0830b491438c1`.
- Ambos archivos OCI tienen identidad, descriptores y blobs verificados.
- Rollback preparado y **no ejecutado**; ningún fallo crítico ni desvío de alcance.

Ejecutar desde /opt/smartrayco, conservando todos los overrides:

```bash
docker compose -p smartrayco --project-directory /opt/smartrayco -f /opt/smartrayco/docker-compose.onprem.yml -f /opt/smartrayco-staging/points-final-20261026T001656Z/points-approved-activation.override.json -f /opt/smartrayco-staging/points-fix-397484c-20261026T050348Z/points-fix.override.json -f /opt/smartrayco-staging/single-close-87ddfd3-20261026T054949Z/single-close.override.json -f /opt/smartrayco-staging/fase175-20261026T154532Z/backend.override.json -f /opt/smartrayco-staging/fase175-20261026T154532Z/frontend.override.json -f /opt/smartrayco-staging/fase175-20261026T154532Z/backend.rollback.json -f /opt/smartrayco-staging/fase175-counters-16831c6-20261026T162650Z/backend.override.json -f /opt/smartrayco-staging/campo-returns-c11f6a8-20261026T171151Z/frontend.override.json -f /opt/smartrayco-staging/campo-returns-c11f6a8-20261026T171151Z/frontend.rollback.json up -d --no-deps --no-build --pull never frontend
```

Si el tag de respaldo faltara, cargar primero el tar con docker load -i.
El rollback solo sustituye frontend y vuelve a la vista anterior de solo
consulta; no modifica solicitudes, custodias o inventario. Antes de cualquier
operación futura revalidar imágenes, hashes y estado activo. No safe-update.sh.
Evidencias privadas en el stage: prepared.json, deployed.json, verified.json,
recovery/ y logs; resultados ficticios locales en scripts/inventory-auth-lab/runtime/.



## Antecedente del 26/10/2026 — diagnóstico previo al despliegue

**Causa exacta:** el frontend activo
`smartrayco-frontend-fase175:99dc78b-20261026T154532Z`
(`sha256:3155f928b6b5492c9f4398e3a7601ad442a0b5b6f866bbbe637d89b7df05d959`)
conserva `CampoMiCustodiaView.vue` de solo consulta, introducida en
`377bee4`. La tarjeta Mi custodia del inicio y el menú del técnico conducen
a `/campo/mi-custodia`. Esa vista no contiene formularios ni llamadas de
devolución para ninguno de los dos tipos de bienes. El componente anterior
en `/campo/custodia` conserva las acciones, pero ya no es el destino visible
del técnico. No es una pérdida de permisos ni depende de tener o no saldo.

La corrección **ya existe en GitHub**, commit `fb56057`, conservada en
`main` verificado `734c180`. Reutiliza `CampoCustodiaView` desde
`CampoMiCustodiaView`; no llegó a la fuente real del artefacto publicado.
La fuente utilizada por Fase 175 copió la de `single-close` y solo cambió
Analítica; conservó esta discrepancia previa. No se atribuye a un cambio de
permisos ni a la corrección backend de contadores.

Se contrastaron la fuente del stage real y los chunks referenciados por el
índice activo: `CampoMiCustodiaView-CTnbAvO2.js` muestra «Solo consulta» y no
llama a `requestUnitReturn`/`requestMaterialReturn`. Router, menú y tarjeta
coinciden con GitHub; las dos vistas de custodia son las discrepancias.

### Ubicación y recorrido operativo existentes

- Técnico `TECNICO_RED` activo: App de Campo → **Mi custodia** →
  `/campo/mi-custodia` → **Solicitar devolución** por cada equipo disponible
  (`with_technician`) y material con saldo. Puede pedir devolución parcial o
  total de material hasta su saldo; equipo seriado se solicita por unidad.
- `/campo/custodia` sigue siendo la ruta anterior autorizada al técnico y
  conserva los formularios. No se añadió una ruta alternativa.
- Administración: `/inventario/custodia`, pestaña **Devoluciones**, recibe
  equipos mediante `receive_unit_return` y materiales mediante
  `confirm_material_return`. No confundir con devoluciones de clientes.
- Solicitar material crea una solicitud, sin bajar custodia ni liberar
  almacén. Solicitar equipo marca `pending_return` y conserva al custodio;
  no lo convierte en stock disponible. Solo la recepción administrativa
  descuenta custodia/libera almacén o fija la condición recibida del equipo.
- `current_stock` de material incluye la custodia; recepción no crea un
  ingreso adicional que infle ese total. Aumenta almacén libre al bajar
  custodia. Se mantienen las reglas existentes.

### Permisos productivos verificados, sin escrituras

Lectura acotada de `pg_proc`/`pg_policies` en transacción READ ONLY:

- Las cinco RPC existentes de consulta/solicitud/recepción son SECURITY
  DEFINER con `search_path=public`, EXECUTE para `authenticated`, sin EXECUTE
  para `anon`. El rol operativo se obtiene del perfil **activo** de `auth.uid()`.
- Consulta personal y solicitudes exigen `TECNICO_RED`; las RPC/triggers
  verifican custodia propia. Recepciones exigen ADMIN/SUPERADMIN.
- `inventory_products`, `inventory_units`, `inventory_movements` e
  `inventory_unit_events` mantienen RLS `inventory_admin_only`: el técnico
  no puede escribir directamente en inventario general.
- Custodia, eventos y solicitudes de materiales permiten SELECT propio al
  técnico y consulta administrativa; sin políticas de escritura directa.
- Los cuerpos vigentes de `request_material_return` y `my_inventory_custody`
  **coinciden con las salvaguardas del candidato anterior**, incluida fila
  bloqueada FOR UPDATE, bloqueo de solicitud duplicada e historial resuelto.
  La nota de 22/10 «SQL candidato sin aplicar» de abajo es histórica: las
  definiciones actuales ya contienen esa corrección. **No se requiere SQL
  ni cambio de permisos para recuperar el acceso.** No se infiere cuándo
  o por quién se instalaron esas definiciones.
- El store llama directamente a estas RPC con el JWT del usuario; no pasa
  por una ruta Node de aprobación ni necesita un endpoint backend nuevo.

### Corrección mínima preparada, sin reinventar la función

No se modificó código de producto: el código corrector ya está aprobado en
GitHub. Se preparó un paquete local con solo tres archivos existentes para
superponer sobre la fuente real activa, conservando Puntos y Analítica:

1. `src/views/campo/CampoMiCustodiaView.vue`: reutiliza la vista operativa,
   protegida por identidad de técnico.
2. `src/views/campo/CampoCustodiaView.vue`: formularios y validaciones ya
   aprobados, bloqueo de solicitudes pendientes y recarga.
3. `src/lib/custodyReturns.ts`: validador ya aprobado de cantidad y pendiente.

Paquete y hashes: `scripts/inventory-auth-lab/runtime/campo-returns-candidate/manifest.json`.
No se construyó una imagen, se hizo push ni se desplegó. Es una preparación
de fuentes, no un artefacto productivo certificado. No reconstruir todo main
para recuperarlo ni sustituir el backend actual `16831c6`.

### Pruebas de esta sesión

- Navegador público con identidad y custodia **ficticias**: reproduce cero
  botones en la vista publicada. No se utilizó la cuenta real del propietario.
- Navegador local con los componentes existentes de GitHub: dos botones,
  solicitud de equipo y de 4/10 de material simuladas, estado pendiente,
  saldo conservado y doble solicitud de material deshabilitada. Cero
  excepciones. Todas las llamadas de negocio reales y escrituras bloqueadas.
- SQL/unitarias existentes: **25/25 PASS** en PostgreSQL Docker aislado,
  sin red: propietario/otro técnico, ADMIN/SUPERADMIN reciben, técnico no
  aprueba, no doble recepción, stock no inflado, recepción parcial, rechazo,
  saldo insuficiente y concurrencia. El fixture aplica sus definiciones solo
  dentro del contenedor temporal; no es una migración productiva.
- `vue-tsc -p tsconfig.app.json --noEmit`: PASS. No se repitió build completo.
- Nueva regresión: `scripts/tests/field-custody-returns-browser.mjs`.
  Reproducir baseline con `--base https://panel.rayconetworks.com --expected readonly`;
  validar fuente local con `--base http://127.0.0.1:5198 --expected returns`.
  La expectativa `readonly` es solo la reproducción histórica del defecto;
  tras un despliegue autorizado debe usarse `returns` también para el público.

### Qué falta, límites y desvíos

Falta autorizar preparación del frontend desplegable desde su fuente real,
respaldo/rollback y promoción selectiva; luego repetir lectura visual sin
crear solicitudes con bienes reales. No hubo cambios en existencias,
custodias, equipos, solicitudes reales ni servicios productivos.

El primer Vite dentro del sandbox no respondió; la prueba pasó usando un
Vite local accesible fuera del sandbox. Sin cambios de producto adicionales.
El rechazo/historial resuelto de equipos continúa con la limitación existente;
no se amplió en esta recuperación. Una futura prueba de recepción física
debe corresponder a una devolución real autorizada.

## Antecedente del 22/10/2026 (no describe por sí solo el estado actual)

Fecha: 2026-10-22. Sin push, despliegue ni escritura en producción.

## Causa raíz

La ruta `/campo/mi-custodia` carga `CampoMiCustodiaView.vue`, una vista de consulta sin acciones. La vista anterior `CampoCustodiaView.vue` conserva los formularios y las RPC `request_unit_return` y `request_material_return`. El enlace actual de Campo dirige a la vista de consulta, dejando el flujo existente fuera del recorrido visible.

## Cambio

- Mi custodia reutiliza la vista existente; se desmonta al cambiar la identidad autenticada.
- Botón «Solicitar devolución» en cada equipo disponible y material, con serie y MAC visibles.
- Validación de cantidad positiva, finita y menor o igual al saldo; bloqueo de material con solicitud pendiente y de envíos simultáneos en la misma pantalla.
- Recarga tras solicitar y cada 30 segundos mientras la pestaña está visible; limpieza del temporizador al salir. Las confirmaciones administrativas ya recargan su panel.
- Se conservan RPC y permisos existentes. El técnico no escribe movimientos de almacén.

## SQL candidato, no aplicado a producción

`scripts/prepare-custody-returns-review.sql` reemplaza dos funciones existentes, sin crear tablas, RPC adicionales ni cambiar permisos. `request_material_return` bloquea la fila de saldo antes de comprobar solicitudes pendientes, serializando peticiones simultáneas del mismo técnico/producto. `my_inventory_custody` incluye también solicitudes resueltas de materiales para mostrar Pendiente, Recibido y Rechazado. Requiere revisión del esquema realmente desplegado y autorización antes de aplicar.

Sin aplicar ese SQL, el frontend funciona con las firmas actuales, pero el backend anterior sigue permitiendo solicitudes de material duplicadas entre sesiones y solo devuelve las pendientes. La validación visual no sustituye esa protección.

## Pruebas

- PASS: suite SQL existente en PostgreSQL efímero, sin red y con datos ficticios (18 pruebas incluyendo contenedor padre).
- PASS: misma suite con SQL candidato y verificaciones adicionales: solicitud parcial sin cambio de stock ni saldo, bloqueo de duplicado, técnico sin permiso de confirmar, doble confirmación bloqueada, historial Recibido/Rechazado y duplicado serializado bloqueado.
- PASS: 2 pruebas unitarias de cantidades, producto inexistente y solicitudes pendientes/resueltas.
- PASS: `npm run build` (TypeScript y Vite); advertencia existente de tamaño de chunks.
- NO EJECUTADO: navegación completa con navegador y confirmación cruzada de dos sesiones; no se afirma certificación visual ni prueba concurrente.

Los materiales se contabilizan con el modelo existente: `current_stock` incluye la custodia; almacén disponible = `current_stock - custodia`. Confirmar disminuye custodia y libera almacén disponible sin insertar otro ingreso ni inflar `current_stock`.

## Límites y compatibilidad

El flujo serializado existente admite solicitar y recibir, pero no rechazar. No se agregó una transición nueva ni se simula un estado Rechazado para equipos. Ese requisito queda pendiente de un ajuste de base de datos autorizado. Tampoco se agregó historial serializado resuelto.

La ruta y el enlace de Mi custodia ya eran cambios locales previos en router/layout: se conservaron y no se incluyen en este commit. Un despliegue futuro debe integrar esos cambios con su trabajo original. La vista de consulta previa, que aún no estaba versionada, se respaldó en TEMP antes de sustituirla por el componente reutilizado. No se modificaron los demás archivos pendientes ni OLT, MikroTik, contratos, facturación u órdenes.

## Archivos de esta entrega

- `src/views/campo/CampoMiCustodiaView.vue`
- `src/views/campo/CampoCustodiaView.vue`
- `src/lib/custodyReturns.ts`
- `src/lib/__tests__/custodyReturns.test.ts`
- `server/tests/technicianCustody.sql.test.ts`
- `scripts/prepare-custody-returns-review.sql`
- Este informe.

Estado: corrección local del acceso preparada; cumplimiento completo pendiente del ajuste autorizado de base de datos y del rechazo serializado. Producción intacta.
