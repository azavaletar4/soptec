# Mi Avance y ranking compartido — candidato vigente, 20/10/2026

**Listo para solicitar autorización de despliegue controlado. Solo local.**
Esta política sustituye la restricción anterior que impedía al técnico consultar
el ranking de sus compañeros. Consultar productividad agregada entre técnicos
autenticados está autorizado. Se mantiene privado el detalle de trabajos y custodia.
El acceso anónimo continúa prohibido. No hubo consultas nuevas a producción,
migraciones remotas, cambios de datos reales, commits, push ni despliegue.

## Permisos y datos

| Actor | Mi Avance/detalle | Ranking diario/semanal/mensual | Custodia personal |
| --- | --- | --- | --- |
| Técnico activo autenticado | Solo propios | Todos los técnicos con actividad computable | Solo propia |
| ADMIN/SUPERADMIN | Permisos administrativos existentes; no suplantan al técnico en la RPC personal | Permitido | Permisos administrativos existentes |
| SOPORTE | Sin acceso nuevo al detalle personal | Permitido, como el ranking anterior | Sin acceso nuevo |
| Anónimo, CLIENTE o perfil inactivo | Denegado | Anónimo sin EXECUTE; perfiles ajenos/inactivos sin datos | Denegado |

El ranking conserva el criterio existente de mostrar técnicos con actividad
computable, incluidos históricos. El consumidor autenticado puede consultar el
agregado de sus compañeros, sin obtener su lista de trabajos.

La respuesta compartida contiene exactamente: technician_id, technician_name,
installations_count, averias_count, reconexiones_count, rutinas_count,
reincidencias_count, total_points y ranking. La metadata del período contiene
inicio, fin, zona horaria y hora de consulta. Sin clientes, contratos, salarios,
contactos, emails ni identificadores/referencias de tickets ajenos. Se quitó el
fallback de nombre a email: si no hay nombre, se muestra «Técnico».

La API usa una lista explícita de campos admitidos, incluso si el proveedor
devolviera campos extra. No hay enlaces del ranking al detalle de trabajos de
compañeros. Exportar e imprimir conserva únicamente los agregados visibles.

## SQL y compatibilidad

`docs/sql/mi-avance-candidate.sql` sigue fuera de las migraciones automáticas y
conserva su guarda del cuerpo instalado original. No fue aplicado en producción.

- technician_point_contributions conserva la única fuente de aportes: pesos,
  puntos manuales, estados, cuadrillas, reincidencias y truncamiento entero de
  tickets.points. Sin nuevos valores ni cambios de bono.
- technician_ranking_between agrega esos aportes y calcula la posición; es
  interna, sin EXECUTE para anon/authenticated/service_role.
- get_technician_ranking(month,year) conserva firma, columnas y calendario
  mensual anterior. Permite técnico/ADMIN/SUPERADMIN/SOPORTE activos y backend.
  No se modifican los resultados de puntuación; se elimina el email alternativo.
- get_technician_period_ranking(period,date) ofrece day/week/month en Perú,
  semana lunes-domingo, inicio incluido y fin excluido. Delega al mismo agregador.
  Revoca PUBLIC/anon, concede authenticated/service_role y valida el rol activo
  dentro de SQL. La clave privilegiada permanece exclusivamente en backend.
- my_field_progress y my_field_job_points mantienen sus restricciones personales;
  un ID de trabajo ajeno sigue devolviendo NULL. La custodia y sus políticas RLS
  no cambian. No se conceden lecturas nuevas a tablas de clientes o perfiles.

Se revisaron las revocaciones: **solo anon/PUBLIC pierden EXECUTE del ranking**;
authenticated y service_role lo conservan. Las funciones internas siguen cerradas.
La API ya no devuelve 403 al técnico autorizado y el router ya no lo expulsa de
/soporte/ranking. /soporte continúa enviándolo a su inicio de campo; administración
conserva Operaciones de Hoy sin cambios en su componente.

La API mantiene `?mes=...&anio=...` para consumidores mensuales existentes.
La nueva vista usa `?periodo=day|week|month&fecha=YYYY-MM-DD`. Todos ven los mismos
límites de Perú, y los puntos de cada técnico coinciden con Mi Avance del mismo
período. La consulta mensual de compatibilidad conserva su calendario previo:
puede diferir en fronteras UTC/Perú; no se cambió silenciosamente su semántica.

## Interfaz

- Mi Avance conserva Hoy/Semana/Mes, aportes propios y aviso de valores actuales;
  ofrece «Ver ranking de técnicos», también si falla la consulta personal.
- Ranking incorpora selector Diario/Semanal/Mensual, fecha de referencia o mes/año,
  rango visible y aviso de posibles ajustes posteriores. Mantiene CSV e impresión.
- En móvil usa filas compactas sin tabla ancha; escritorio conserva la tabla.
  Los empates muestran todos los primeros lugares, sin ocultar participantes.
- Al cambiar de período, una respuesta anterior tardía se descarta. Error/reintento
  no dejan cifras de otro filtro como si fueran del seleccionado.

Captura ficticia revisada: [MI-AVANCE-RANKING-LOCAL.png](MI-AVANCE-RANKING-LOCAL.png).

## Verificación ejecutada

- SQL + HTTP: **20/20 PASS**, `node --import tsx --test server/tests/fieldProgress.sql.test.ts server/tests/technicianRanking.http.test.ts`.
  Matriz anónimo/técnico/ADMIN/SUPERADMIN/SOPORTE/cliente/inactivo; acceso compartido
  en los tres períodos; detalle ajeno rechazado; proyección exacta sin datos
  privados ni email alternativo; períodos iguales a Mi Avance; guardas y rollback.
  Regresión del ranking original en 12 meses × tres zonas, reparto, cero manual,
  NULL, división entera, fechas y reincidencias.
- Funciones compartidas: **361/361 PASS**, suite src/lib sin regresiones.
- Navegador: **19 verificaciones PASS**, cero excepciones JS. Sesión ficticia,
  conexiones externas bloqueadas, 360/390/1280 px, UA Android/WebView; ranking
  accesible para técnicos/ADMIN/SUPERADMIN, tres períodos, empates, carreras de
  respuestas, error/reintento, Mi Avance y custodia. No es APK física.
- `vue-tsc -b`, comprobación TypeScript de server/src/routes/soporte.ts y build:
  PASS. `git diff --check`: sin errores.
- Ensayo local con tipos/índices conocidos de Supabase y **100.000 trabajos
  ficticios**, sin red ni filas reales copiadas. Ranking compartido mensual:
  63,773–72,744 ms de ejecución PostgreSQL; Mi Avance: 58,714–60,195 ms.
  Compatibilidad mensual original confirmada en los dos volúmenes probados.
  Son tres muestras, sin latencia móvil ni carga concurrente. Evidencias en
  MI-AVANCE-RENDIMIENTO-LOCAL.json y MI-AVANCE-NAVEGADOR-LOCAL.json.

## Archivos ajustados en este turno

- docs/sql/mi-avance-candidate.sql; docs/sql/mi-avance-rollback.sql;
  docs/sql/mi-avance-rollback-private.sql.
- server/src/routes/soporte.ts; nuevo server/src/services/technicianRanking.ts.
- src/stores/soporteRanking.ts; src/views/soporte/RankingTecnicosView.vue;
  src/router/index.ts; src/components/campo/CampoAvance.vue.
- server/tests/fieldProgress.sql.test.ts; nuevo
  server/tests/technicianRanking.http.test.ts.
- scripts/tests/field-progress-browser.mjs; field-progress-performance.mjs;
  prepare-field-progress-audit.cjs y su SELECT generado de rendimiento cloud.
  Este último se preparó localmente; no se ejecutó contra producción en este turno.
- Informes, capturas/evidencias locales y referencias en ESTADO_DESARROLLO.md,
  MI-AVANCE-PREPARACION-LOCAL.md y MI-AVANCE-VALIDACION-PREVIA.md.

Sin cambios ajenos incorporados ni modificación del componente administrativo
OperacionesHoyView.vue. El informe previo de Supabase conserva valor como captura
histórica de definiciones/ACL; su política de bloquear a técnicos queda sustituida.

## Activación y rollback, pendientes de autorización

Antes de activar: reconfirmar en lectura guarda, propietario y ACL instaladas,
respaldar definiciones/permisos y revisar los artefactos exactos. Secuencia propuesta:
SQL transaccional que bloquea anon y prepara RPC → backend de períodos y proyección
segura → frontend. Verificar caché PostgREST y smoke con JWT reales: técnico accede
al agregado de compañeros pero no a sus tickets/custodia; anon denegado; ADMIN y
SUPERADMIN conservan operación y ranking. No hay pasos de activación automáticos.

Los dos archivos de rollback ahora conservan la política autorizada: restauran
el cálculo mensual original, mantienen ranking autenticado compartido y nombres
sin email alternativo, deniegan anon y retiran RPC/agregadores nuevos. Ninguno
rehabilita el acceso anónimo. Tienen guarda actualizada y se probaron en Docker.
Si solo falla el frontend, preferir retirar la interfaz nueva manteniendo SQL y
autorización seguros; si se retira la base, coordinar la retirada de la interfaz
de períodos y usar la petición mensual compatible. No resetear el árbol compartido.

Pendientes posteriores: HTTP real tras instalar las RPC y APK física/piloto con
dos técnicos. Se mantienen las instrucciones Android de
MI-AVANCE-VALIDACION-PREVIA.md; allí donde la política anterior pedía denegar el
ranking al técnico, ahora debe comprobarse que comparte solo estos agregados.
Persisten diferencias posibles de calendario con consumidores mensuales antiguos,
truncamiento existente de tickets, ajustes posteriores y concurrencia no medida.
No bloquean solicitar autorización controlada; impiden declarar cerrado el piloto.
