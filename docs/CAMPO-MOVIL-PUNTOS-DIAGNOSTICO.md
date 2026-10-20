# App de Campo: diagnóstico y propuesta local (20/10/2026)

## Alcance y evidencia

Leídos ESTADO_DESARROLLO.md y el estado de Git. Hay cambios previos en dos
documentos y numerosos archivos sin seguimiento: no se incorporan ni modifican.
Diagnóstico del código versionado, sin consultar ni escribir producción; la
definición efectivamente instalada de las funciones debe contrastarse antes de
desplegar. No se recibió una captura adjunta en este turno.

## Puntuación existente

Fuente más reciente localizada: `supabase/migrations/20261007010000_fase130_rutinas_puntaje_ranking.sql`,
función `get_technician_ranking(int,int)`. Evoluciona Fases 27b/27c/49/94.

| Trabajo | Estado computable | Fecha del período | Puntos del trabajo |
| --- | --- | --- | --- |
| Alta (installations) | completed | completed_at | 10 |
| Avería: no_service, slow_speed, equipment | resolved o closed | coalesce(resolved_at, closed_at) | tickets.points si no es NULL, en otro caso 5 |
| Reconexión/traslado (ticket) | resolved o closed | coalesce(resolved_at, closed_at) | tickets.points si no es NULL, en otro caso 3 |
| Otras categorías de ticket | resolved o closed | misma fecha | 0, incluso con points manual |
| Rutina | completed | completed_at | routines.points; NULL aporta 0 |

Un cero manual de ticket se respeta. Una rutina cancelada no puntúa. El
formulario exige puntos positivos para rutinas, pero la BD admite NULL y cero:
no asignar valores retrospectivamente a las históricas.

La atribución usa todos los registros de job_assignees del trabajo; únicamente
si no existen usa assigned_to. Divide los puntos entre el número de integrantes,
sin dar un porcentaje especial al líder. Los conteos de trabajos no se dividen.
Utiliza asignaciones actuales, no una fotografía de la cuadrilla al cerrar.

Reincidencia: una avería resuelta en el período recibe -5 si existe otra avería
del mismo cliente, distinta, creada después de la resolución y hasta siete días
después inclusive, con imputable_a_tecnico verdadero. La segunda no necesita
estar resuelta. Penaliza al equipo del primer ticket; divide -5 entre integrantes.
EXISTS aplica una penalización por ticket original, no por cada nueva avería.
La penalización se atribuye al período del ticket original, por lo que los
totales pueden cambiar posteriormente. El ranking redondea el total a un decimal;
la posición usa el total sin redondear. Solo incluye perfiles TECNICO_RED con
actividad computable. No hay estados persistidos de puntos confirmados,
estimados o pendientes, ni fórmula monetaria de bono en esta función.

## Límites y permisos

La función solo ofrece un agregado mensual. Construye fechas con make_date,
sin AT TIME ZONE America/Lima: los límites al comparar timestamps dependen de
los tipos y de la zona de sesión. No garantiza explícitamente calendario peruano.
No devuelve detalle por ticket, día ni semana.

`server/src/routes/soporte.ts` permite TECNICO_RED y devuelve todas las filas
mediante supabaseAdmin. La RPC es SECURITY DEFINER, está concedida a
authenticated y no filtra auth.uid() ni valida rol internamente. Por tanto,
filtrar el resultado en Vue no satisface privacidad: el cliente ya recibió
nombres y puntos ajenos. Debe revisarse tanto la ruta como la invocación RPC
directa; conservar el ranking administrativo requiere distinguir permisos.

No reconstruir el total desde campoStore.trabajos: es una lista operativa,
no contiene la comprobación completa de reincidencias y su pertenencia combina
assigned_to con asignaciones de cuadrilla. Puede diferir de la atribución SQL.

## Custodia existente

`my_inventory_custody()` exige TECNICO_RED y auth.uid(), y limita las consultas
a ese usuario. Reutilizable mediante technicianCustody.fetchMyCustody().
Devuelve equipos with_technician/pending_return con nombre de producto, serie,
MAC y estado; materiales de saldo positivo con nombre, cantidad y unidad; y
solicitudes pendientes. Nombre de producto disponible; no hay campo separado
de modelo en esa respuesta: no inventarlo. Mostrar serie y MAC si existen ambas.

CampoCustodiaView ya existe en /campo/custodia, pero contiene devoluciones.
La nueva consulta debe ser independiente, sin esos formularios ni llamadas de
mutación, conservando el flujo previo. Su acceso será exclusivo del técnico:
la ruta actual también admite administradores aunque la RPC los rechaza.

## Propuesta concreta de pantalla

Para TECNICO_RED en /soporte (OperacionesHoyView, destino actual de Inicio),
reutilizar la experiencia móvil de /campo; mantener las operaciones de
administración en la vista existente. Ambos accesos del técnico deben conducir
a la misma experiencia, sin duplicar cargas ni romper enlaces de detalle.

1. Resumen compacto: Hoy / Semana / Mes, con intervalo visible, hora de
   actualización y avance de órdenes propias. Totales solo cuando exista
   una fuente personal completa. Error o carga nunca se presenta como cero.
2. Enlace ancho y compacto «Mi custodia · Solo consulta» a una nueva ruta
   personal; equipos y materiales con carga, error/reintento y vacíos separados.
3. Mis órdenes: tipo, referencia, cliente o destino, estado, fecha y aporte
   individual calculado por servidor. Historial de aportes separado del simple
   histórico de atendidos; incluir penalizaciones y su ticket original.
4. Filtros compactos y accesos secundarios (disponibles, asistencia, contactos),
   conservando la posibilidad de marcar asistencia y el bloqueo de almuerzo.

Sin etiquetas «confirmado/estimado/pendiente» para puntos: no existen en origen.
Los valores configurados para órdenes abiertas pueden mostrarse como «Puntos
del trabajo», indicando que aún no aportan al total; no presentarlos como bono
ganado. Evitar truncar referencias, producto, serie/MAC y cifras; permitir
saltos de línea y una sola acción principal por tarjeta.

## Decisión necesaria antes de Fase B de puntos

Se requiere una fuente de lectura personal con detalle y períodos. Propuesta:
preparar **localmente** una migración candidata (sin aplicarla) con consulta
basada en auth.uid(), reutilizando exactamente las reglas anteriores, y cerrar
el acceso a puntos ajenos tanto por RPC como por API, manteniendo el acceso
administrativo. No modificar puntuaciones, bonos, historial ni cuadrillas.

Límites propuestos: America/Lima; hoy [00:00, 00:00 siguiente), semana
[lunes 00:00, lunes siguiente), mes [día 1 00:00, día 1 siguiente mes).
La semana no está definida por el ranking existente: requiere decisión del
usuario. Explicitar Perú puede cambiar qué mes incluye cierres próximos a
medianoche frente a la zona actual; comparar antes de alterar el ranking.

El usuario pidió detenerse y solicitar decisión si puntos requieren cambios
de BD. Por ello esta entrega termina en diagnóstico/propuesta, sin modificar
lógica, crear migraciones ni implementar parcialmente la nueva pantalla.

## Validación pendiente y entrega

Solo se añadió este documento. Sin commits, push, despliegue o pruebas de UI:
no hay implementación que certificar. No se cambiaron archivos ajenos.

Tras decidir la fuente: pruebas aisladas de medianoche Perú, lunes, cambio de
mes/año; cero manual, rutina NULL, otras categorías, reparto líder/apoyo y
fallback sin cuadrilla; reincidencia exacta a siete días, imputabilidad,
duplicados y atribución al período original; aislamiento entre dos técnicos,
anon/otros roles y RPC directa; carga/error/reintento/vacíos y cambio de sesión.
Comparar resultados mensuales con la función original y documentar diferencias
de zona antes de aprobarlas. Historial paginado sin perder aportes del resumen.

Verificar navegador móvil a 360/390 px, escritorio, navegación por teclado y
WebView Android real; sin desbordamiento, números o identificadores cortados.
Regresión de inicio/cierre de Alta/Avería/Rutina, cola offline, almuerzo,
cuadrillas y custodia, sin tocar sus operaciones. Mantener pendientes las tres
validaciones reales de Fase 165 descritas en ESTADO_DESARROLLO.md. Después:
revisión de diff, autorización explícita separada para migrar/desplegar y piloto
supervisado con un técnico contrastando puntos y custodia reales.
