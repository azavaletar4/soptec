# Campo: ícono de recarga corregido localmente — 20/10/2026

Base: ff20a0fd7dd86886445486b7b08c0a9ce5a04751 (versión visual desplegada).
Rama aislada: fix/campo-recarga-icono-20261020.
Sin push, despliegue, consultas de negocio ni escrituras en producción.

## Causa y corrección

La cabecera real es src/components/campo/CampoLayout.vue. El SVG anterior tenía
viewBox 24×24 y dimensiones 20×20 correctas; no se encontró una regla CSS heredada
que alterara su proporción. La apariencia deformada ya se observa en Chrome:
los extremos de los arcos de radio 7 no coinciden con los trazos de las puntas,
y el dibujo se percibe como dos curvas separadas, en lugar del símbolo circular.
No se atribuye a un defecto exclusivo de Android sin prueba en dispositivo físico.

Se reemplazó únicamente el path por el ícono de recarga ya utilizado en
src/components/layout/AppLayout.vue. Se añadieron block, w-5, h-5 y shrink-0 para
mantener la caja cuadrada y evitar encogimiento en flex. Se conserva stroke 1.8,
color, viewBox y dimensiones, consistentes con Inicio en esta misma cabecera.

El único archivo de aplicación modificado es CampoLayout.vue (una línea SVG).
El botón mantiene min-h-11/min-w-11, centrado flex, aria-label, título y handler.
El bloque script setup coincide con la base normalizando CRLF/LF de Windows:
la confirmación y window.location.reload no se modificaron. No hay cambios de
puntos, ranking, custodia, órdenes, router, backend, SQL ni Flutter.

## Verificación

- TypeScript vue-tsc -b: PASS.
- Seis pruebas existentes de custodyPresentation y fieldProgress: PASS.
- Build Vite: PASS; persiste aviso previo de chunks grandes.
- Chrome con UA Android/WebView y datos ficticios: 320/360/390/412 y 1280 px.
- SVG medido 20×20, igual que Inicio; flex-shrink 0; botón 44×44 en todos los anchos.
- Centro del SVG coincide con el centro del botón: desplazamiento X/Y 0 px.
- Sin recortes, desbordamientos ni excepciones JavaScript.
- Recargar conserva confirmación de cambios sin guardar y recarga realmente el
  documento de laboratorio. Cuenta, rutas, filtros y presentación existentes PASS.
- Se revisó la captura resultante. No se ejecutaron operaciones reales de negocio.

Captura móvil 360×800: [CAMPO-RECARGA-ICONO-MOVIL.png](CAMPO-RECARGA-ICONO-MOVIL.png).
Evidencia: [CAMPO-RECARGA-ICONO-PRUEBAS.json](CAMPO-RECARGA-ICONO-PRUEBAS.json).
Los auxiliares de ejecución y logs completos se conservan en runtime ignorado:
campo-recarga-checks.cjs, campo-recarga-browser.mjs y campo-recarga-evidencia-20261020/.
El auxiliar inicial se ajustó para comparar CRLF/LF antes de ejecutar las pruebas;
no se cambió código funcional para satisfacerlo.

La configuración .env.local es sintética y se mantiene ignorada. Este build es de
laboratorio y no es un artefacto para publicar. Android físico sigue pendiente.
El checkout principal y sus 216 archivos pendientes se mantienen intactos; este
cambio no incorpora modificaciones del main local. Esperar nueva autorización
antes de push o despliegue.
