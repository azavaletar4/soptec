# Control de Asistencia — pestañas, mejora visual local

## Estado vigente: desplegada

La mejora visual 233f230 ya est? publicada y verificada (27/10/2026).
Detalle: [ASISTENCIA-VISUAL-DESPLEGADA.md](ASISTENCIA-VISUAL-DESPLEGADA.md).
Las secciones siguientes conservan la evidencia de preparaci?n local.

## Antecedente: estado al validar localmente

El propietario confirma que **A3 funciona correctamente y está validada**.
Esto supera las notas anteriores de aceptación funcional pendiente de A3.
La nueva reorganización visual está implementada y validada **solo localmente**,
en `feature/asistencia-a3-local`, sobre `4156e84`. Sin push ni despliegue.
Las imágenes productivas documentadas se mantienen; no se consultó producción.

## Archivos de interfaz

- `src/views/asistencia/AsistenciaView.vue`: pestañas Asistencia, Ausencias,
  Descansos y permisos, Horarios. Asistencia inicial; solo un panel visible.
  `v-show` conserva componentes, borradores, comentarios y filtros. Indicadores
  en tarjetas, búsqueda y reporte mensual/CSV conservados. Pestañas con ARIA,
  flechas/Home/End y desplazamiento horizontal; la seleccionada queda visible.
  Configuración visible exclusivamente SUPERADMIN, como pidió el propietario.
- `src/components/asistencia/IntercambiosPanel.vue`, `NovedadesPanel.vue` y
  `HorariosPersonalesPanel.vue`: separan formulario y listado con encabezados
  claros; dos columnas de gestión en escritorio y una en móvil. Sin nuevos
  controles que escondan acciones. Campos/botones de 44 px como mínimo en la
  vista administrativa; estilos locales reutilizan surface/field-input/btn.
  Los widgets personales conservan las mismas ramas de permisos y funciones.

Los scripts completos de los tres componentes hijos son idénticos al commit
base (normalizando CRLF/LF). El script de la vista también es idéntico tras
excluir únicamente el bloque nuevo de estado/navegación de pestañas. No se
tocaron cálculos, consultas, validaciones, callbacks, eventos changed, stores,
tipos, SQL, RPC, RLS, backend ni módulos ajenos. Ninguna escritura sobre horarios
reales de Alhely/Angie; las capturas usan exclusivamente colaboradores ficticios.

## Validación y capturas

`node --test server/tests/asistenciaTabs.browser.test.cjs`: cinco escenarios
focalizados aprobados (seis tests contando el contenedor de la suite), Chrome
headless y API ficticia. Cubre pestaña inicial y panel único, separación visual,
borradores de intercambio/novedad/horario, comentario de ausencia y filtros de
pendientes/aprobadas/rechazadas, navegación por teclado, selector visible en
móvil, controles de 44 px, ausencia de desborde global y Configuración exclusiva
SUPERADMIN. Cambiar pestañas no envía escrituras. Fixture real de vista/layout:
`server/tests/fixtures/asistencia-tabs.html`.

`npm.cmd run build`: tipado vue-tsc y compilación Vite aprobados; advertencia
habitual de tamaño de chunks, sin errores. Sin auditorías generales, suites SQL
ni repetición de pruebas funcionales A0–A3.

Capturas inspeccionadas en 1440×1000 y 390×844; imágenes de página completa:

- [Escritorio: Asistencia](capturas/asistencia-tabs/desktop-asistencia.png)
- [Escritorio: Ausencias](capturas/asistencia-tabs/desktop-ausencias.png)
- [Escritorio: Descansos y permisos](capturas/asistencia-tabs/desktop-descansos.png)
- [Escritorio: Horarios](capturas/asistencia-tabs/desktop-horarios.png)
- [Móvil: Asistencia](capturas/asistencia-tabs/mobile-asistencia.png)
- [Móvil: Descansos y permisos](capturas/asistencia-tabs/mobile-descansos.png)
- [Móvil: Horarios](capturas/asistencia-tabs/mobile-horarios.png)

La tabla conserva desplazamiento horizontal propio en móvil para mantener todas
las columnas y acciones. La página y los formularios no desbordan la pantalla.
La futura publicación requiere autorización nueva; no hay migraciones que aplicar.
Directorio principal y trabajo ajeno conservados. La mejora visual aún no está
publicada; no confundir estas capturas locales con el frontend productivo.
