# Inventario: ventana de producción pendiente de autorización

16/10/2026. Continúa desde `655ea29`. **BLOQUEADO para iniciar**: falta la
autorización expresa solicitada por el responsable y la última lectura muestra
dos operaciones de Campo en curso. No se ejecutaron migraciones ni despliegues.

## Decisión vigente

El responsable aplaza expresamente la rotación de credenciales. El riesgo
documentado en `INVENTARIO-CONTINUIDAD-CODEX.md` se conserva y no bloquea esta
activación. No se rotará ninguna credencial en esta tarea.

## Prechecks realizados

- HEAD inicial `655ea29`; los dos documentos modificados y los archivos sin
  seguimiento de sesiones anteriores se conservan. No hubo push.
- Los 31 archivos y el tar anterior siguen íntegros: cero discrepancias de
  SHA-256. Las dos migraciones coinciden exactamente con las validadas.
- Lectura SSH: frontend activo `592d282b9f51747b672a06aa1a099470f3539512`,
  imagen `sha256:e8e14d309e1f7bf6b77baafc6fdbdd92020f89fc25238032bc18ebb286aeeaa6`.
  Backend activo `sha256:2689e00e112fa34d090abe23ff5c27e0363c7c9215d9c4064b68e7b434c54b02`.
  Ambas imágenes se pueden recuperar localmente. No se alteraron etiquetas ni
  contenedores. Caddy y GenieACS quedan fuera del cambio.
- El backend apunta al Cloud correcto. Sus 68 archivos de código se compararon
  por hash normalizado: ninguna diferencia ajena a los cuatro archivos backend
  del paquete. Las diez políticas coinciden con la captura usada para rollback.
- Cloud a las **18:45:51, hora de Lima**: Fase 162 presente; Etapa 3 y cierre
  RLS ausentes; cero bloqueos de escritura y cero transacciones cliente abiertas.
  **Dos sesiones de Campo abiertas: una Avería y una Rutina en progreso**.
  No se cerraron ni cambiaron estas órdenes. Sin bloqueos SQL no significa
  que los técnicos hayan terminado: se exige coordinación antes de la ventana.
- Inventario: 32 productos, 128 unidades, 275 movimientos, 302 eventos;
  última escritura a las 18:27:10 de Lima. El respaldo anterior tenía cuatro
  movimientos y un evento menos, por lo que se creó uno nuevo de solo lectura.
- Respaldo nuevo `activacion_final_completo_20261016_233807_8dda07bc`:
  38.398.248 bytes; SHA-256
  `04119650FB5A91B9A067721785B20D57B3369A9A4FAA50D4645346A7E7F536AC`;
  pg_dump, lectura y restauración aislada terminados con código cero.
  No se reconstruyó el laboratorio ni se repitieron sus 25 pruebas aprobadas.
  El respaldo conserva las limitaciones de Storage, roles globales y Vault
  previamente documentadas. No cubre cambios posteriores a su snapshot.

Evidencias: `INVENTARIO-PRODUCCION-PRECHECK.json`,
`INVENTARIO-PRODUCCION-IMAGENES.json`, `INVENTARIO-PRODUCCION-COMPATIBILIDAD.json`
y `INVENTARIO-PRODUCCION-RESPALDO.json`.

## Candidato exacto que se propone desplegar

La base anterior `ccdf94f` ya no coincide con la imagen activa. Se conservó
el paquete original y se preparó un candidato sobre la base operativa
**592d282**, añadiendo los mismos 31 archivos de Inventario. El único archivo
compartido que necesitó integración fue `CampoTrabajoDetailView.vue`: una
fusión de tres vías sin conflictos conserva exactamente las protecciones de
cierre ya desplegadas (11 líneas añadidas y seis retiradas respecto del archivo
de Inventario). Los otros 30 archivos conservan los hashes aprobados. No hay
funcionalidad nueva ajena a Inventario.

Revisión local de release **`4e967d08559a566ea0605087bd0778361bd835ec`**, con padre
592d282, creada con índice aislado sin tocar HEAD ni los fuentes de trabajo.
Su diferencia consta de 31 archivos funcionales, `.dockerignore` y un manifiesto
de procedencia. No se confunde esta revisión compuesta con un despliegue de
toda la rama main. Tar local y hashes por archivo:
`INVENTARIO-PRODUCCION-CANDIDATO.json`; SHA-256 del tar:
`c0e43443b1ca8eb082366a1fa767146870c47c59fb444601afe62e7a6fb8c98c`.

El candidato pasó `vue-tsc -p tsconfig.app.json --noEmit` y `vite build`
(345 módulos, solo aviso de chunks grandes). El build local carece de
configuración de producción y no se desplegará: las imágenes se construirán
con los argumentos VITE vigentes de producción. Ningún secreto viaja en el tar.

## Alcance de la autorización única solicitada

Autorizar una ventana que incluya:

1. Coordinar el fin o pausa operativa de las órdenes activas, sin que este agente
   cambie sus estados para forzar el precheck. Repetir exclusivamente el precheck
   focalizado antes de iniciar. Si persisten sesiones/órdenes en progreso, se
   detiene. Si cambiaron los datos respaldados, actualizar respaldo antes de DDL.
2. Transferir el tar verificado a `/opt/smartrayco-staging/inventario-4e967d0`,
   preparar las etiquetas de recuperación y construir imágenes frontend/backend
   desde ese candidato, sin sustituir todavía contenedores. Validar configuración
   Compose sin imprimirla y comprobar que las imágenes activas no cambiaron.
3. Aplicar **únicamente** Etapa 3 y después cierre RLS administrativo, con los
   cuerpos SQL validados, dentro de una transacción con `ON_ERROR_STOP`,
   `lock_timeout=2s`, `statement_timeout=60s` y `transaction_timeout=120s`.
   El bundle aborta si hay trabajo activo o deriva de políticas/RPC; compara
   hashes de las cinco tablas antes/después y de la RPC de Fase 162; notifica
   a PostgREST para refrescar el esquema. No se reaplica ninguna migración previa.
4. Con el commit SQL confirmado, sustituir **solo frontend y backend** usando
   el override preparado y `up -d --no-deps --no-build --pull never frontend backend`.
   No usar `deploy/update.sh`, no hacer git pull/push, no recrear Caddy/GenieACS
   ni operar OLT o MikroTik.
5. Verificar salud, revisión de imágenes, HTTPS y las lecturas reales descritas
   abajo. Conservar las evidencias sin series, MACs, datos de cliente ni tokens.
6. Si falla después del commit SQL: autorizar como parte de esta misma ventana
   el rollback RLS preparado y la vuelta a las **dos imágenes actuales**. No
   restaurar saldos ni borrar recibos. Etapa 3 se conserva si es inocua; la
   revocación de su EXECUTE solo corresponde si es necesario y con consumidores
   anteriores ya restaurados. Ante estado SQL ambiguo, inspeccionar primero por
   solo lectura; no repetir a ciegas ni restaurar el dump sobre producción.

Preparado: `INVENTARIO-PRODUCCION-VENTANA.json`, bundle SQL privado y overrides
en runtime. `scripts/apply-inventory-production-window.ps1` verifica hashes y
exige un registro de autorización posterior, con revisión exacta y caducidad;
ese registro **no existe**. `scripts/inventory-production-window.sh` requiere
marcas de autorización y de commit SQL antes de sustituir imágenes. Su sintaxis
Bash y la del ejecutor PowerShell se comprobaron sin ejecutarlos.

Migraciones propuestas, **todavía no aplicadas**:

| Archivo | SHA-256 |
| --- | --- |
| `20261016010000_campo_inventory_operations.sql` | `e585f2f076100e1325c0db0ec6cfa25702014c15ea46fafa540b39e1c149e259` |
| `20261016220000_inventario_contextual_rls_admin.sql` | `1e79cdd23f42eb5d46b30b0a5c3095582cc916210cee53e6801c092ccd5eaa9f` |

## Validación real posterior pendiente

Se solicitó disponibilidad de sesiones personales ADMIN, SUPERADMIN y técnico,
sin contraseñas ni tokens por chat. Las sesiones del laboratorio, la clave
service_role y la suplantación de claims SQL no acreditan esta validación HTTP.

Con sesiones reales del Cloud y muestras existentes, únicamente lecturas:

- Nombre y modelo; serie completa/parcial; MAC completa/parcial.
- Álbum ONUs/ONTs: coincidencias de su categoría, exclusión de otras categorías
  y páginas disjuntas sin duplicados. Si una muestra real no existe, declararlo;
  no fabricar existencias ni resultados para marcar PASS.
- ADMIN y SUPERADMIN permitidos; consultas directas a inventario y álbumes
  denegadas a roles no administrativos, además de la guarda de interfaz.
- Altas, Averías y Rutinas: abrir materiales/equipos de órdenes reales con
  asignación vigente; comprobar que no haya errores de inventario y que un
  usuario ajeno no obtenga datos. No consumir ni asignar equipos para probar.

Las escrituras transaccionales siguen cubiertas por las 25 pruebas previas;
no se certificarán como ejecutadas en producción, porque esta tarea prohíbe
alterar saldos, contratos o existencias reales.

Riesgos concretos: actividad de técnicos durante la ventana, brecha entre
cierre RLS y despliegue, clientes WebView con código anterior que requieran
recarga y credenciales expuestas pendientes de rotación. El cierre RLS solo
se hará cuando las imágenes estén construidas y listas para sustituirse.

Estado de esta entrega: **BLOQUEADO para ejecutar**, no desplegado ni validado
en producción. Pendientes: autorización expresa, coordinación de las dos
operaciones activas y sesiones para las verificaciones finales.
