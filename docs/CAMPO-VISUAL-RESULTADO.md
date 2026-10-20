# App de Campo: mejora visual local — 20/10/2026

**Preparada para revisión. Sin push, despliegue, cambios de base ni accesos de
negocio a producción.** Rama local aislada `visual/campo-cabecera-20261020`,
basada en la versión desplegada `377bee454b5f0e77e0e1c6509afb3ad71b71ea03`.
El checkout original y sus cambios ajenos permanecen intactos.

## Cambios

- `CampoLayout.vue`: el icono anterior era una llave sin texto visible, enlazada
  a Cambiar contraseña. Se sustituyó por «Cuenta», con enlaces/acciones textuales
  «Cambiar contraseña» y «Cerrar sesión». Destino `/cambiar-password`, llamada
  auth.signOut y navegación a `/login` conservados. Cierra con Escape, clic fuera
  y cambio de ruta; Escape devuelve el foco al botón de cuenta.
- Se conserva el isotipo oficial importado de logo-icon.png, sin modificaciones.
  Inicio usa el destino existente por rol; Recargar en WebView usa la misma
  confirmación de cambios sin guardar del layout general. Flutter no tiene una
  barra/FAB duplicada; su código permanece intacto. El acceso secundario a equipos
  de las páginas de detalle pasa al menú donde antes existía el icono de bolsa;
  no se duplica en la portada, que ya contiene Mi custodia.
- Controles de cabecera con área mínima 44 × 44 px, foco visible, nombres
  accesibles y menú con semántica nativa de disclosure. Estado sin conexión o
  sincronización ocupa su propia fila para no comprimir las acciones.
- `CampoAvance.vue`: Hoy/Semana/Mes y valores sin cambios; aviso corto visible de
  valores actuales que pueden variar, CTA destacado de ranking, fechas y explicación
  completa en «Sobre los puntos». Historial sigue plegable, con los mismos aportes.
- `CampoCustodiaResumen.vue`: consulta personal mediante el store y RPC existentes
  fetchMyCustody/my_inventory_custody y usePersonalRead. Muestra equipos con estado
  with_technician; pending_return se cuenta aparte como «en devolución». Materiales
  se suman exclusivamente por la unidad registrada, sin conversiones ni restar
  solicitudes pendientes con reglas nuevas. No se usa número de productos como
  cantidad disponible. Datos inválidos producen «Resumen no disponible», no cero.
- `CampoDashboardView.vue`: nuevo resumen de custodia, búsqueda etiquetada y filtros
  compactos con contador en línea y aria-pressed. Se conservan Pendientes, Atendidos,
  Disponibles, búsqueda y todos sus callbacks. No se cambiaron tarjetas de orden,
  inicios/cierres de trabajos ni sus stores.

El resumen es presentación derivada de los mismos saldos personales del detalle,
no una modificación del inventario. El detalle de custodia continúa intacto y de
solo lectura. La portada añade una lectura de custodia al montarse; se actualiza
al volver a entrar o recargar, sin nuevo canal realtime. El detalle conserva su
Actualizar existente.

## Pruebas y límites

- TypeScript `vue-tsc -b`: PASS.
- Build Vite: PASS. Persiste el aviso de chunks grandes preexistente; no se
  modificó configuración ni división de bundles.
- Seis pruebas focalizadas: PASS. Totales por medida y exclusión de equipos en
  devolución; sin mutar respuesta; vacío real, decimales y unidades no convertidas;
  inválidos sin cero inventado; lectura personal con carga/error; descarte de
  respuestas tardías/cambio de actor; períodos/historial y descuentos existentes.
- Navegador: 320/360/390/412 px con UA Android/WebView y 1280 px; cero excepciones
  JS, desbordamientos y recortes detectados. Todos los controles de cabecera
  cumplen 44 × 44 px. También se comprobó navegador de escritorio sin UA nativa.
- Menú por teclado, Escape, foco devuelto y clic fuera: PASS. El enlace carga el
  formulario real de contraseña; no se envió ninguna contraseña. Cerrar sesión
  usa el logout simulado y elimina el token local; destino login verificado.
- Recargar confirma el riesgo de perder cambios y recarga realmente el documento
  de laboratorio. No se omitió la confirmación.
- Filtros Pendientes/Atendidos/Disponibles, detalle e historial, cabecera offline,
  error/carga/reintento de custodia: PASS.
- Comparación estructural de las respuestas antes/después: idénticas para
  my_field_progress, ranking-tecnicos, my_inventory_custody, tickets, installations
  y routines. La fixture usa 2 equipos disponibles, 1 en devolución, 150.5 metros,
  7 unidades y 2.25 rollos, con 5 productos materiales distintos. Se muestran las
  cantidades por medida, nunca un total ficticio de «5 materiales».
- Las primeras órdenes quedan a 581 px frente a 614.98 px antes en ancho 320;
  a 577 frente a 583.48 px en 360. El resumen nuevo aporta información sin empujar
  las órdenes más abajo en los anchos probados.
- Verificación de alcance contra la base: servidor, SQL/migraciones, Flutter,
  stores, router, puntos, composable de aislamiento, detalle de trabajo/custodia,
  vistas administrativas y logo sin cambios.

Las capturas son reales de Chrome headless sobre código local, con idénticos
datos sintéticos, acceso externo a Supabase/API bloqueado y configuración local
ficticia. La sesión técnica es exclusivamente de laboratorio; no es una sesión
real de producción ni una captura de Android físico. Los cambios de contraseña
y logout reales no se ejecutaron contra Supabase.

## Capturas y evidencias

| Pantalla | Antes | Después |
| --- | --- | --- |
| Inicio móvil | [Antes](CAMPO-VISUAL-ANTES-INICIO.png) | [Después](CAMPO-VISUAL-DESPUES-INICIO.png) |
| Cuenta | Iconos anteriores visibles en Inicio | [Menú Cuenta](CAMPO-VISUAL-DESPUES-CUENTA.png) |
| Ranking | [Antes](CAMPO-VISUAL-ANTES-RANKING.png) | [Después](CAMPO-VISUAL-DESPUES-RANKING.png) |
| Custodia | [Antes](CAMPO-VISUAL-ANTES-CUSTODIA.png) | [Después](CAMPO-VISUAL-DESPUES-CUSTODIA.png) |

[Antes: mediciones/datos](CAMPO-VISUAL-ANTES.json),
[Después: mediciones/datos](CAMPO-VISUAL-DESPUES.json),
[Igualdad y comparación](CAMPO-VISUAL-COMPARACION.json),
[TypeScript/build/pruebas/alcance](CAMPO-VISUAL-CHECKS.json).

## Archivos de la entrega local

Aplicación:

- src/components/campo/CampoLayout.vue
- src/components/campo/CampoAvance.vue
- src/components/campo/CampoCustodiaResumen.vue (nuevo)
- src/views/campo/CampoDashboardView.vue
- src/lib/custodyPresentation.ts (nuevo, presentación sin escrituras)

Pruebas:

- src/lib/__tests__/custodyPresentation.test.ts
- scripts/tests/campo-visual-browser.mjs
- scripts/tests/campo-visual-compare.cjs
- scripts/tests/campo-visual-checks.cjs

Además de este informe, cuatro JSON y siete PNG de evidencia. No se incluye
.env.local, node_modules ni dist. Los auxiliares de preparación están en runtime
ignorado y no forman parte del commit. No se consultó ni modificó producción,
no hubo cambios de puntuación, bonos, custodia, inventario, permisos, OLT/MikroTik,
Altas, Averías o Rutinas.

Comandos, desde el checkout visual:

```powershell
node D:/SmartRayco/node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5194 --strictPort
node scripts/tests/campo-visual-browser.mjs
node scripts/tests/campo-visual-compare.cjs
node scripts/tests/campo-visual-checks.cjs
```

La configuración .env.local de laboratorio contiene una URL con el project ref
que espera la fixture y una clave ficticia, no credenciales de producción.
El build generado con esa configuración es solo de laboratorio; no se publicará.
El modo --before se ejecutó contra 377bee4 antes de editar los componentes.

## Pendientes

- Revisión visual del propietario y autorización separada para publicar/desplegar.
- APK física: TalkBack, escala de fuente del sistema, teclado, botón Atrás nativo,
  rotación y ciclo segundo plano. UA WebView simulada no sustituye un dispositivo.
- Al activar en una fase futura, smoke con sesiones reales de técnico y control
  de los permisos ya existentes; aquí no se modificaron ni se reauditó producción.

Para descartar esta preparación basta no integrar la rama visual; la producción
desplegada no se alteró. No requiere rollback SQL ni migraciones.
