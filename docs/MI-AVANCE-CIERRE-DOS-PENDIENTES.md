# Mi Avance: dos pendientes cerrados en laboratorio — 20/10/2026

**Recuperación HTTP del frontend y revisión visual móvil: PASS.** No se retomó
el despliegue. No hubo migraciones, push, escrituras ni conexiones a producción.
No se modificaron sus contenedores ni se repitieron la validación OCI completa
o la restauración PostgreSQL ya aprobadas.

## Recuperación frontend

El impedimento era la capacidad Linux `CHOWN`, no la ausencia del programa
`chown`, ni un defecto del respaldo. Nginx necesita preparar el propietario de
su caché temporal al arrancar con su configuración original. El laboratorio
había retirado todas las capacidades, incluida esa capacidad normalmente
disponible en un contenedor Docker root. No forma parte del contenido recuperado
ni requiere modificar el bundle o la configuración de la aplicación.

El ensayo focalizado reutilizó la imagen real ya restaurada del respaldo:

`sha256:21e9c2944a25660abb5611114b875d207e98e0ab779d2cfb0af759d1978b2e0c`

El manifiesto privado del respaldo y el ID exacto del daemon local identifican
la imagen usada. No se volvió a exportar/cargar ni se aceptó una etiqueta como
sustituto de identidad. Los controles previos de integridad permanecen vigentes.

Se ajustó exclusivamente el contenedor desechable del laboratorio:

- Red `none`, sin puertos publicados y sin consultas a `/api`.
- Imagen y configuración originales, filesystem de solo lectura.
- `/run` y `/var/cache/nginx` en tmpfs.
- `--cap-drop ALL`, agregando solo CHOWN para caché, SETUID/SETGID para los
  workers de Nginx y NET_BIND_SERVICE para su puerto original.
- Resolución local `backend:127.0.0.1` para poder cargar la configuración sin
  el DNS de Compose; no se arrancó ni contactó backend.
- HTTP mediante wget dentro del mismo contenedor, por loopback. Contenedor
  de prueba detenido y retirado al terminar; imagen respaldada conservada.

Resultado del ensayo:

| Recurso | Resultado |
| --- | --- |
| `/index.html` | HTTP 200, bytes coincidentes con el hash del respaldo |
| `/campo` | HTTP 200, fallback SPA idéntico al índice respaldado |
| `/assets/index-BrygMn_O.js` | HTTP 200, bundle coincidente con el hash del respaldo |

SHA-256 índice:
`fb7ec7372704c72dbedd0535498c7dd28c1cd0c45fcec155f69e5cfd48968ad4`

SHA-256 bundle:
`d829a0610375cb0e92a0c8a670a44f87508daa4d86a6671e142ae10cdfc6321b`

La comparación HTTP usa los hashes del manifiesto anterior, no una copia del
archivo extraída del contenedor bajo prueba. Evidencia automática:
[MI-AVANCE-FRONTEND-RECUPERACION.json](MI-AVANCE-FRONTEND-RECUPERACION.json).

Comando ejecutado localmente:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/tests/mi-avance-frontend-http-recovery.ps1
```

Este ensayo recupera la **versión anterior respaldada**, no instala el candidato
Mi Avance. Demuestra HTTP y contenido estático recuperables, sin afirmar salud
de API o una restauración integral del stack. El script general de recuperación
también quedó ajustado al mismo entorno de Nginx; no se repitió su ciclo completo.

## Ruta y revisión visual del candidato

Ruta real: **`/campo`**, nombre `campo` en `src/router/index.ts`.
Componente: `src/views/campo/CampoDashboardView.vue`, con `CampoLayout.vue` y
`CampoAvance.vue`. No se navegó a una fila del historial. Se abrió directamente
esa ruta en Vite localhost con sesión sintética TECNICO_RED autorizada para
laboratorio, sin usar ni generar credenciales reales. Supabase y `/api` externos
estuvieron bloqueados, con respuestas ficticias en memoria.

El fallo anterior era del selector de prueba, no una navegación ni un cambio
del componente: `main.querySelector('ul>li')` seleccionaba el historial anidado.
Se corrigió a `:scope > ul > li`, tanto para medir posición como para contar las
órdenes. La detección de recortes considera únicamente elementos visibles.

Se probó el candidato real, con tres órdenes pendientes ficticias (Alta, Avería,
Rutina), una atendida y nombres/referencias largos. **No hizo falta cambiar la
presentación:** ya corresponde a la propuesta y utiliza la pantalla de campo
del técnico, con asistencia plegada al final y administración separada.

| Propuesta | Comprobación en el navegador |
| --- | --- |
| Puntos Hoy/Semana/Mes primero | Tres totales visibles, fechas y aviso de valores actuales |
| Ranking después de puntos | Enlace visible antes de custodia, destino compartido accesible |
| Mi custodia | Acceso visible, equipos/materiales y unidades, sin acciones de modificación |
| Mis órdenes | Tres órdenes asignadas, referencias y estado de aporte de puntos |
| Accesos secundarios | Asistencia plegada después de las órdenes |
| Experiencia del técnico | Sin panel Operaciones de Hoy, gestión de usuarios o facturación |

Anchos comprobados: **320, 360, 390 y 412 px móviles; 1280 px escritorio**.
En todos: orden vertical correcto, cero desbordamientos horizontales, cero
recortes detectados en textos visibles y cero controles/enlaces administrativos
identificados en la pantalla de campo. Cero excepciones JavaScript. Se revisaron
visualmente las capturas de inicio completo, ranking y custodia; los nombres y
series largos se ajustan a varias líneas.

Capturas reales de Chrome headless, viewport móvil 360 × 800 con UA Android/WebView,
datos ficticios (no son mockups ni capturas de un dispositivo Android físico):

- [Inicio móvil, viewport](MI-AVANCE-MOVIL-REVISION.png).
- [Inicio móvil, contenido completo](MI-AVANCE-MOVIL-COMPLETA.png).
- [Ranking](MI-AVANCE-RANKING-REVISION.png).
- [Custodia](MI-AVANCE-CUSTODIA-REVISION.png).
- [Mediciones y resultado automático](MI-AVANCE-REVISION-VISUAL.json).

Comando focalizado ejecutado, sin repetir las suites generales:

```powershell
node scripts/tests/field-progress-browser.mjs --layout-only
```

## Archivos de esta continuación

- Nuevo `scripts/tests/mi-avance-frontend-http-recovery.ps1`.
- Ajustado `scripts/mi-avance-image-recovery.ps1`: únicamente capacidades del
  contenedor temporal Nginx, coherentes con el ensayo HTTP aprobado.
- Ajustado `scripts/tests/field-progress-browser.mjs`: ruta directa `/campo`
  en modo visual, selector de lista principal y detección de visibilidad.
- Nuevos los dos JSON y las cuatro capturas enlazados arriba.
- Este informe y referencia de actualización en MI-AVANCE-RESOLUCION-RESPALDOS.md.

Sin cambios nuevos a componentes de aplicación, puntuación, custodia o permisos.
No se tocaron cambios ajenos pendientes. Sin commits, push ni despliegue.

## Riesgos y siguiente paso

**Ambos pendientes solicitados están resueltos. Se espera autorización; no se
retoma automáticamente el despliegue.** La activación futura debe comprobar
vigencia del candidato y respaldos frente al estado de ese momento.

Android físico sigue pendiente: navegación Atrás, controles nativos/WebView,
teclado y escalado del sistema, retorno del segundo plano, pérdida de conexión
y cambio de sesión entre técnicos. La revisión de navegador no los sustituye.

La API autenticada contra RPC instaladas y la salud frontend/backend tras una
eventual activación siguen siendo verificaciones de despliegue. El ensayo
funcional del backend mencionado en el informe anterior no formó parte de estos
dos pendientes y no se ejecutó; no se declara recuperación integral del stack.
Las fórmulas y permisos conservan las pruebas aprobadas anteriores.
