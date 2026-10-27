# Frontend consolidado y WiFi TR-069 — continuidad común Claude/Codex

## Estado que prevalece

**Desplegado el 27/10/2026, 22:08 UTC / 17:08 Perú.** Se resolvió la parada de
`3c6b085`. Fuente exacta de los artefactos: **`288f2d8ac3c4ed0d2279b9a01618885bcfb02b9f`**,
árbol `8e16c5d268ff9285d7fad94987edc94680d6dc42`.

Base canónica: rama **`integration/frontend-productivo-tr069-20261027`**, worktree
`D:/SmartRayco/scripts/inventory-auth-lab/runtime/frontend-productivo-tr069-worktree`.
La rama se publicó con push normal. `main` **local** se avanzó a esta misma línea
por fast-forward, sin tocar main remoto. Se respaldaron y verificaron los 21
archivos pendientes previos: los ya idénticos a fuentes integradas quedaron
absorbidos sin perder contenido; los demás conservan su estado local. El respaldo
está en `scripts/inventory-auth-lab/runtime/main-before-frontend-consolidation-20261027/`.
El checkout raíz ya contiene la base consolidada y configuración pública local
de build coherente con la publicación; no se modificaron credenciales productivas.
Los commits posteriores de publicación/documentación conservan las mismas fuentes
de aplicación de `288f2d8`. No usar una rama antigua como base por el solo hecho
de tener una fase cerrada. La identificación verificable del frontend publicado
está en **`https://panel.rayconetworks.com/release-manifest.json`**.

| Servicio | Imagen publicada |
|---|---|
| Frontend | `smartrayco-frontend-consolidado:288f2d8ac3c4` |
| Backend selectivo WiFi | `smartrayco-backend-wifitrial:288f2d8ac3c4` |

Digest frontend: `sha256:fca857f7dbfc9d07df9f9f5e82b45758f5e58fa0cd2c84d07433c35bb85b85db`.
Digest backend: `sha256:7959f08b6535c733c63d90f7a7a0dd4ca65fa524866fb2cc6b56be719de326a0`.
Caddy, Mongo y GenieACS conservaron sus IDs, imágenes y horas de inicio.
Backend y frontend se recrearon selectivamente, sin migraciones ni cambios de datos
de clientes, contratos, inventario o facturación efectuados por esta tarea.

## Causas encontradas y resolución

1. `main` local incluía WiFi, pero **no** las correcciones productivas acumuladas
   en la línea `diagnostico/tr069-genieacs-readonly`. El código real debía incluir
   Asistencia A0/A1 y aprobación, A2/A2.1/A3, pestañas y exención SUPERADMIN;
   coherencia de Puntos de noviembre; dirección/GPS del contrato en Campo;
   separación de inventario ACS actual frente a histórico. El frontend estaba
   compuesto por entregas/overrides sucesivos y el Git de la VM seguía en
   `b379028`: ninguno de esos hechos acreditaba por sí solo un árbol consolidado.
2. El intento anterior reconstruía desde un archivo reducido y comparaba el HTML
   byte a byte. Tailwind escaneaba también archivos fuera de `src`; cambiar el
   contexto alteraba CSS, nombres de chunks y HTML. Las versiones de dependencias
   principales sí coincidían con el lockfile: no se atribuye el fallo a versiones
   distintas sin evidencia. Se fijó el escaneo a `src` y se creó un build canónico.
3. Había una diferencia funcional de configuración: Compose indicaba una fecha
   `VITE_MATERIAL_CUSTODY_LIVE_SINCE`, pero el bundle activo de `technicianCustody`
   tenía un objeto de entorno vacío y evaluaba su corte como **null**. Pasar la
   fecha de Compose al nuevo build habría activado advertencias no publicadas.
   Se acreditó el comportamiento del código compilado y se conservó el valor
   efectivo vacío/null. No se cambió la lógica ni los datos de custodia. URL y
   clave pública Supabase se verificaron contra el bundle activo, sin registrarlas.

La recuperación fue por archivos/deltas identificados, no por reescribir módulos.
Solo store/vista TR-069 necesitaron integración en tres vías sobre `734c180`;
se conservaron ambas funcionalidades, inventario productivo y nueva prueba WiFi.
También se recuperaron fuentes de runtime del backend activo para que una futura
compilación completa no active rutas locales de clientes que no estaban publicadas,
y se conservó la corrección productiva de contadores Fase 175.

## Commits y procedencia

- **`ead801a`**: integración de fuentes productivas y sus pruebas. Referencia
  `8968e69`, rama `diagnostico/tr069-genieacs-readonly`, que ya contenía la línea
  Asistencia/Puntos/Campo. Se conservaron los avances WiFi de `3c6b085`.
- **`288f2d8`**: build canónico, escaneo CSS explícito y política de fuente mínima
  consolidada. Es el commit exacto compilado/publicado.
- **`c6bdab9`**: herramientas versionadas de promoción, conservación de configuración
  efectiva y rollback aislado.
- **`67c64b4`**: merge controlado de los cuatro commits pendientes de `origin/main`
  (`c11f6a8`, `6a8dadd`, `911c01d`, `88dec40`), limitados a cierres/documentación y
  prueba de devoluciones de Campo. Conflictos solo en inserciones de CLAUDE/ESTADO;
  se conservaron tanto TR-069 como los cierres operativos. No introdujo cambios de
  aplicación ni alteró los artefactos compilados.

Correcciones recuperadas: `263f66e`, `070c777`, `3cecefa`, `a0d832b`, `71944f5`,
`233f230`, `ff3077f`, `fc9047f`, `30bbb54`, `0480b3a`, `7105679`, `16831c6`.
Ramas de origen: `feature/asistencia-a2-local`, `feature/asistencia-a3-local`,
`fix/puntos-noviembre-local`, `fix/campo-direccion-contrato-local` y diagnóstico TR-069.
Detalle por archivo: `FRONTEND-CONSOLIDACION-FUENTES-20261027.json`.

Frente a la fuente productiva `8968e69`, las únicas diferencias en `src` son
los 8 archivos del flujo WiFi/confirmación y CSS determinista. El router es
idéntico; el manifiesto conserva 46 entradas dinámicas de vistas. No se borraron
pantallas ni se cambiaron permisos de otras funciones. Los assets anteriores
se conservaron con sus mismos hashes para sesiones ya abiertas; el nuevo HTML
carga un build completo de la fuente consolidada, sin parchear bundles a mano.

## Validación y rollback

- **93 pruebas unitarias PASS**: 72 focalizadas en Asistencia/Campo/TR-069,
  incluidas las **42 TR-069**, más 21 de detección/clasificación de custodia.
- Navegador con datos ficticios: Asistencia A0/A1 (9), horarios (5), novedades (5),
  intercambios (6), pestañas/responsive (6); Puntos noviembre (26 comprobaciones);
  Campo dirección/GPS (229 comprobaciones, 27 escenarios); Campo integrado (21).
- WiFi: 6 capturas con el componente real y store consolidado; confirmación,
  instancia restringida, pendiente/verificado y restauración simulados, cero
  llamadas a equipos. La prueba conserva inventario actual e histórico.
- Devoluciones de equipo y material parcial: navegador sobre los estáticos
  publicados, todas las llamadas de negocio interceptadas, PASS y cero escrituras.
- TypeScript frontend/backend y sintaxis de herramientas: PASS.
- Dos builds locales idénticos y dos builds remotos idénticos (segundo sin caché).
  Manifiestos/125 artefactos estáticos coincidentes, configuración efectiva acreditada.
- Tras publicar: hashes HTTP de los 125 artefactos, rutas/HTML y salud API PASS;
  acceso sin autenticación a estado de prueba devuelve 401.

Stage: `/opt/smartrayco-staging/frontend-consolidado-tr069-288f2d8-20261027/`.
Override activo añadido al final de la cadena previa: `release.override.json`.
No eliminar overrides anteriores ni usar un compose aislado que descarte fases.
`release.rollback.json` restaura ambas imágenes anteriores y apaga la bandera WiFi.
Backups originales reutilizados tras verificar imagen/hash: stage
`/opt/smartrayco-staging/tr069-wifi-manual-20261027/`, archivos
`backend-before.image.tar` y `frontend-before.image.tar`.
**Rollback probado**: archivos cargados y rootfs comparado desde contenedores
aislados; no se ejecutó restauración sobre servicios activos porque la promoción
pasó sus comprobaciones. Se preparó retorno automático ante fallo de promoción.

## Estado WiFi y uso manual

Comprobación posterior 22:11 UTC / 17:11 Perú: bandera habilitada, identidad exacta,
`WirelessNet-5G` en `InternetGatewayDevice.LANDevice.1.WLANConfiguration.5`, capacidad
anunciada de escritura, banda/Enable sin dato. **0 operaciones registradas, 0 tareas
pendientes. Codex no envió tareas a GenieACS.**

ADMIN/SUPERADMIN: entrar en `/tr069`, Huawei `HWTC1D3691B7`, «Configurar», elegir
instancia 5, escribir nuevo nombre, «Guardar SSID» y confirmar «Enviar cambio».
El servidor valida el contrato CTR-2026-00214 y guarda el respaldo antes de enviar.
El registro persistente se crea en ese primer envío, no al consultar el panel.
Espera al siguiente Inform, pulsa «Verificar resultado» para solicitar lectura
puntual y después «Consultar estado». Aceptado/encolado no equivale a verificado.
Una vez verificado, «Restaurar SSID anterior» pide nueva confirmación; verificar
también la restauración. Confirmar físicamente red y navegación en ambos casos.
Prueba limitada a un cambio y una restauración; nada automático.

Siguen bloqueados contraseñas, PPPoE, WAN, VLAN, otras instancias y otras ONT.
No se crearon asociaciones; el vínculo TR-069 nulo se admite solo tras la cadena
exacta ONT/contrato/cliente comprobada. Queda pendiente la **prueba manual real**
del propietario y acreditar aceptación del firmware; writable anunciado no la prueba.

## Procedimiento obligatorio para próximas compilaciones

1. Partir de la rama canónica o un descendiente revisado de `ead801a`, conservar
   cambios posteriores y comparar siempre con `/release-manifest.json` activo.
   No compilar desde el Git antiguo de la VM ni desde un checkout raíz atrasado.
2. Mantener lockfile e instalar con `npm ci`. Restaurar argumentos públicos desde
   la configuración **efectivamente compilada**, comprobando sus hashes; no asumir
   que Compose o `.env` actuales representan la versión publicada. No registrar claves.
3. Con fuentes limpias: `npm run build:release -- --export-snapshot`. El snapshot
   ignorado `release-source.json` identifica commit, árbol y 299 fuentes; la política
   exige ancestro consolidado y presencia de componentes productivos.
4. `npm run build:release -- --out dist-release` y repetir en `dist-repro` con
   `--compare dist-release`. El manifiesto asocia commit/lock/configuración/artefactos.
   En Docker usar `--snapshot release-source.json`; se verifican las fuentes antes
   de compilar, sin necesidad de incluir `.git` ni secretos en el contexto.
5. Revisar pruebas del módulo y las compartidas afectadas. La promoción consume
   el snapshot/artifact del commit exacto; no remezcla ramas ni reconstruye con
   fuentes distintas en el último momento. Guardar y probar rollback del runtime
   que esté activo en ese momento; los backups de esta entrega no son universales.
6. Conservar toda la cadena compose y modificar solo los servicios autorizados.
   Probar manifiesto/hashes/HTTP/roles tras publicar. Backend solo cuando sea
   necesario y autorizado; esta entrega incluyó exclusivamente los módulos WiFi.
7. Publicar rama de integración con push normal y PR revisada. `origin/main`
   quedó en `88dec40`; es ancestro de esta rama tras el merge controlado. No hay
   que forzar ni reemplazar su historial. La incorporación a main remoto queda
   para revisión; no se realizó en esta tarea.

La compilación rechaza fuentes sucias, componentes requeridos ausentes, falta
del ancestro consolidado, snapshot/configuración incoherentes o comparación no
reproducible. La publicación debe detenerse ante diferencias sin justificar.
Estos controles no sustituyen la aceptación física ni certifican por sí solos
capacidad integral para 3.000 clientes; ese requisito permanece vigente.

Evidencia: `FRONTEND-CONSOLIDACION-{PREPARE,BUILD,DEPLOY,VERIFY}-20261027.json`,
`FRONTEND-TR069-POST-DESPLIEGUE-20261027.json`,
`FRONTEND-CAMPO-DEVOLUCIONES-PUBLICADO-20261027.json` y capturas de Asistencia/WiFi.
