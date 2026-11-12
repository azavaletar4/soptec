# Ranking de técnicos: corrección local de contadores

Fecha: 2026-11-12. Estado: **NO LISTO PARA PUBLICAR COMO CORRECCIÓN ACTIVA**.
Consulta corregida y validada; su activación en la función de Supabase está
fuera de la autorización recibida. Publicar únicamente frontend/backend no
cambiaría el resultado de la función actualmente instalada.

## Causa raíz confirmada mediante solo lectura

`technician_ranking_between()` obtiene las contribuciones de la misma fuente
canónica que los puntos, pero cuenta averías únicamente para las categorías
`no_service`, `slow_speed` y `equipment`. Desde noviembre, las confirmaciones
administrativas también acreditan trabajos con otras categorías. La suma de
puntos incluye esos trabajos, mientras el filtro del contador los descarta.

TCK-2026-00104, de Jadir Zavaleta:

- Estado `resolved`, categoría `other`, puntos finales 2.
- Finalización técnica: 2026-11-06 14:32:08 UTC.
- Confirmación administrativa definitiva: 2026-11-06 15:18:03 UTC.
- Cuadrilla congelada: Jadir, 2 puntos, penalización 0.
- Exactamente una contribución `ticket/work`, por 2 puntos. No falta por fecha,
  asignación o estado: la exclusión es el filtro de categoría del contador.

Las rutinas consultadas sí se contabilizan. No se encontró una omisión análoga
en sus registros reales; se añade protección ante duplicación de aportes.

## Corrección preparada

`server/queries/technicianRankingCounters.sql` contiene exclusivamente el SELECT
candidato para el cuerpo de `technician_ranking_between(p_start,p_end)`.
No instala funciones y no es una migración. Solo difieren dos agregados respecto
de la definición instalada, conservada como fixture de pruebas:

1. Averías: `count(distinct job_id)` por técnico. Conserva las categorías del
   histórico; desde el corte oficial del 1 de noviembre cuenta cada ticket
   acreditado excepto `reconnection_relocation`, que conserva su contador.
2. Rutinas: `count(distinct job_id)` por técnico.

No se cambia la fuente de contribuciones, estados, fechas, cuadrillas, sumas,
penalizaciones, ranking, reglas de reparto, Altas ni reconexiones. Un evento de
penalización no cuenta como trabajo. Las sumas conservan todos sus aportes aun
si hubiera filas relacionadas duplicadas: solo se deduplican los contadores
solicitados. El histórico de octubre permanece igual en las pruebas.

## Verificación con datos reales, sin escrituras

`scripts/ranking-counters-readonly.ps1` usa TLS `verify-full`, credencial local
protegida por DPAPI, `default_transaction_read_only=on`, `BEGIN READ ONLY` y
`ROLLBACK`. Ejecutó el SELECT candidato sin CREATE/REPLACE ni cambios de permisos.
Los resultados detallados permanecen en el directorio privado ignorado por Git
`scripts/inventory-auth-lab/runtime/ranking-counters-private.json`.

Comparación de noviembre, en la misma transacción de lectura:

| Técnico | Averías actual → candidata | Rutinas | Altas | Puntos | Puesto |
| --- | ---: | ---: | ---: | ---: | ---: |
| Jadir Zavaleta | 0 → 10 | 11 | 17 | 156,6 | 1 |
| Ruber Pizango | 1 → 9 | 33 | 5 | 148,1 | 2 |
| Jairo Bernabe | 3 → 9 | 39 | 3 | 132,8 | 3 |
| Jhordanno Zavaleta | 1 → 8 | 20 | 6 | 85,8 | 4 |
| Vicente Valdez | 0 → 0 | 1 | 3 | 15,8 | 5 |

Rutinas, Altas, puntos, puestos, reconexiones y penalizaciones son iguales antes
y después para todos los técnicos. No hay aportes de trabajo duplicados en la
muestra de noviembre. El caso indicado queda incluido en el contador candidato.

## Pruebas locales y compilación

- `node --import tsx --test server/tests/technicianRankingCounters.sql.test.ts server/tests/technicianRanking.http.test.ts`:
  **11 PASS, 0 fallos, 0 omitidas**. PostgreSQL 17 local, contenedor sin red y
  datos exclusivamente sintéticos.
- Casos: reproducción de ticket `other` con 2 puntos; categorías oficiales;
  rutinas completadas y confirmadas; trabajos pendientes o sin confirmar;
  Altas y reconexiones; cuadrillas; límites de fecha en Lima; creación antes
  del corte; histórico de octubre y semana mixta; aportes duplicados;
  penalizaciones; ranking diario, semanal, mensual y mensual compatible;
  permisos y validación HTTP. Puntos y demás campos se comparan con la función
  instalada de referencia en cada escenario.
- `npm.cmd run build`: **PASS**, incluyendo `vue-tsc -b` y Vite, 422 módulos.
  Advertencia de tamaño de chunks; sin errores de compilación.

## Archivos y límite de activación

- `server/queries/technicianRankingCounters.sql`: SELECT corregido, sin instalar.
- `server/tests/technicianRankingCountersBaseline.sql`: definición de referencia,
  sin registros reales; utilizada exclusivamente en pruebas locales.
- `server/tests/technicianRankingCounters.sql.test.ts`: regresiones SQL aisladas.
- `scripts/ranking-counters-readonly.ps1`: ejecutor de validación de solo lectura.
- `scripts/tests/ranking-counters-readonly.sql`: consultas acotadas del caso y ranking.
- Este informe.

La lógica activa reside en Supabase. También se verificó por SELECT REST que
`service_role` carece de permiso directo sobre `work_order_point_confirmations`
(42501); no sería correcto añadir una lectura al backend que fallaría o usar
estados/asignaciones actuales en lugar de las confirmaciones congeladas.

Queda pendiente autorizar, revisar y activar únicamente el cuerpo corregido de
la función en una tarea posterior. No se creó una migración, no se escribió en
Supabase, no se modificaron órdenes/clientes/datos reales ni se desplegó o hizo
push. Los cambios preexistentes de otras tareas quedan fuera del commit.
