# Puntos desde noviembre: validación y corrección local

## Estado vigente: activada en producción

SQL y frontend ff3077f aplicados y verificados el 27/10/2026 con autorización.
Detalle: [PUNTOS-CORRECCION-DESPLEGADA.md](PUNTOS-CORRECCION-DESPLEGADA.md).
Lo siguiente conserva la evidencia de la preparación local anterior.


Estado: candidato local, sin SQL aplicado, push ni despliegue. Rama
`fix/puntos-noviembre-local`. Octubre permanece como piloto, incluidos sus ceros.

El corte existente es `2026-11-01 00:00 America/Lima` = `2026-11-01 05:00 UTC`.
La fuente compartida separa el histórico anterior de las confirmaciones oficiales;
exige creación, finalización técnica y confirmación desde ese corte. El período
oficial corresponde a la confirmación. Una orden de octubre no pasa a noviembre.

## Defectos reproducidos y corrección

- Ranking omitía al técnico con solo tickets confirmados de categoría `other`:
  sumaba sus puntos, pero el filtro de participantes solo contaba las categorías
  históricas. Se admite también a quien tiene aportes oficiales desde noviembre,
  sin modificar la elegibilidad histórica ni los conteos por categoría.
- El detalle de Campo calculaba desde puntos/cuadrilla actuales y no distinguía
  lo configurado de lo acreditado. Para confirmaciones oficiales devuelve los
  puntos, integrantes, descuento y fecha congelados. La interfaz separa parte
  bruta, descuento y aporte neto; sin confirmación informa que todavía no suma.
  Mantiene los valores operativos previos para órdenes del piloto y los identifica.

No se modifica `technician_point_contributions`, su versión legacy, el calendario
de `my_field_progress`, las fórmulas, las confirmaciones ni las guardas finales.
La candidata reemplaza únicamente dos funciones de lectura; no contiene DML ni
cambia tablas, datos, liquidaciones o roles. El reparto continúa igual para líder
y apoyos. No se redondea cada participación; el total se redondea a un decimal y
el detalle se presenta con hasta cuatro, como antes.

## Evidencia aislada

- PostgreSQL 17 con `--network none`, almacenamiento temporal, perfiles y órdenes
  ficticios. La nueva suite compara definiciones preservadas y reproduce octubre
  con `NULL`, `other` y división entera sin recalcularlo.
- Casos: réplica ficticia del 00070 en noviembre (4 totales, 2 por integrante),
  sin confirmación, NULL, categoría Otro como único aporte, descuentos congelados,
  dos/tres integrantes, fracciones, participantes congelados y acceso ajeno.
- Fechas: ambos lados de medianoche Perú; zonas UTC/Lima/Tokio; semana mixta sin
  duplicados; orden creada o terminada en octubre excluida del oficial; terminación
  noviembre y confirmación diciembre; coherencia de Altas, Tickets y Rutinas.
- El reloj de `my_field_progress` se sustituye solo dentro de la prueba por un
  instante ficticio. Las fechas de confirmación se fijan solo en el contenedor.
- Nueva suite: 11 escenarios, 12 tests contando el contenedor. Regresión existente
  de confirmaciones: 27 escenarios, 28 tests contando el contenedor. Aprobados.
- Chrome headless local: 26 comprobaciones, API ficticia y tráfico externo
  bloqueado; cero escrituras. `vue-tsc` y Vite build aprobados; advertencia habitual
  de tamaño de chunks.

Comandos: `node --import tsx --test server/tests/novemberPointConsistency.sql.test.ts`,
`node --import tsx --test server/tests/workOrderPointConfirmations.sql.test.ts`,
`node scripts/tests/november-points-browser.mjs`, `npm.cmd run build`.
`POINTS_BASELINE=1` permite reproducir los defectos sin cargar la candidata.

Archivos de producto: `src/components/campo/CampoJobPoints.vue` y la propuesta
`docs/sql/puntos-noviembre-coherencia-candidate.sql`, fuera de migraciones automáticas.
Las otras tres adiciones son esta evidencia y las dos pruebas focalizadas.

La transición y la fuente oficial existentes están protegidas por las pruebas,
pero los dos defectos de lectura no quedan corregidos en producción hasta una
futura aplicación SQL y publicación expresamente autorizadas. No se garantiza
la sincronización instantánea de pantallas ya abiertas: Mi Avance y Ranking
mantienen su mecanismo actual de consulta/actualización. No se consultó producción
ni se modificó main, A3 o el trabajo ajeno del directorio principal.
