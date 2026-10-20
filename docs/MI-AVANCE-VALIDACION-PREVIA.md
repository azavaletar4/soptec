# Mi Avance — validación previa al despliegue, 20/10/2026

**Actualización de autorización:** los técnicos pueden compartir productividad
agregada. La prohibición del ranking entre técnicos descrita abajo es histórica;
se mantiene la prohibición de acceso anónimo y de detalle ajeno. El candidato y
ambos rollback se ajustaron a la nueva política. Informe vigente:
[MI-AVANCE-PERMISOS-RANKING.md](MI-AVANCE-PERMISOS-RANKING.md).

**Candidato listo para solicitar autorización de despliegue controlado. No activado.**
Las RPC nuevas siguen ausentes de producción. No se aplicaron migraciones, no
se cambiaron datos reales y no hubo commit, push ni despliegue. El acceso a
Supabase de esta sesión fue exclusivamente READ ONLY, con TLS verify-full,
timeout de 10 segundos y rollback de cada transacción. Las pruebas con datos
sintéticos se hicieron en un PostgreSQL efímero sin red.

## Contraste con lo instalado

Evidencia agregada: [MI-AVANCE-PREFLIGHT-CLOUD.json](MI-AVANCE-PREFLIGHT-CLOUD.json).
Definiciones completas, ACL, políticas, índices y planes quedan en el directorio
ignorado scripts/inventory-auth-lab/runtime/, sin credenciales ni datos de clientes
en los informes compartidos. No se copiaron filas reales al laboratorio.

| Comprobación | Resultado |
| --- | --- |
| Fuente instalada del ranking | MD5 e1a53bc89358018536db151da721c908, idéntico al esperado por la guarda del candidato |
| Propietario/configuración | postgres, STABLE SECURITY DEFINER, search_path=public |
| Custodia instalada | MD5 c2f433b3c4d2ed628ce07ad114b98530; únicamente authenticated tiene EXECUTE entre los roles de aplicación |
| Identidad | auth.uid() instalado y current_user_role() con comprobación de perfil activo |
| Nuevas RPC/fuente interna | No existen todavía en producción; no se instalaron para medir |
| Campos de fechas | completed_at/resolved_at/closed_at son timestamptz |
| Puntos | tickets.points es int4; routines.points es numeric |
| Sesión auditada | UTC; los límites de Mi Avance se fijan explícitamente en America/Lima |
| Volumen actual | 35 Altas, 32 tickets, 64 Rutinas; 177 asignaciones; 6 técnicos activos |
| Cuadrillas registradas | 98 trabajos con 1 integrante, 36 con 2, 1 con 3 y 1 con 4 |

**Hallazgo real de permisos:** los default privileges de Supabase conceden
EXECUTE explícitamente a anon/authenticated/service_role. La función de ranking
instalada no filtra identidad: cada uno de los seis técnicos recibió, en la
auditoría SQL agregada, cinco filas ajenas; anon pudo obtener seis filas. No se
devolvieron nombres ni puntos individuales en los informes. La exposición
preexistente continúa mientras no se autorice y ejecute la activación.

CREATE OR REPLACE conserva ACL. Se corrigió el candidato **solo localmente**
para revocar explícitamente PUBLIC/anon en el ranking, manteniendo
authenticated/service_role. Su filtro interno sigue reservando el ranking global
a ADMIN/SUPERADMIN/SOPORTE activos y al backend service_role; TECNICO_RED/CLIENTE
no reciben filas. La API candidata conserva su bloqueo previo al técnico antes
de consultar con el cliente administrativo. Las RPC personales y la función
interna ya tenían revocaciones explícitas compatibles con los defaults reales.

## Aislamiento: probado y pendiente

- Se invocó la custodia instalada para **los seis técnicos activos**, mediante
  rol authenticated y claims locales a la transacción. En todos: cero equipos,
  materiales o solicitudes ajenos; cantidades y conjuntos coinciden con la
  custodia del actor. También se intentó leer directamente la tabla de materiales
  filtrando por técnico diferente: cero filas por RLS.
- La RPC de custodia no admite un ID de actor ni existe una sobrecarga que lo
  permita. La definición instalada utiliza auth.uid() y exige técnico activo.
- El candidato personal no admite ID de técnico. El ID de trabajo en
  my_field_job_points sí es controlable por el cliente, pero se exige que exista
  una contribución del actor: un trabajo ajeno devuelve NULL. La función interna
  no tiene EXECUTE para los roles de aplicación. Se volvió a verificar en local
  con los permisos predeterminados reales, no con ACL inferidas de migraciones.
- Los tests incluyen técnico ajeno, cliente, anon, inactivo, ADMIN/SUPERADMIN,
  SOPORTE, service_role, intento de pasar identidad y solicitud de trabajo ajeno.

Los ensayos SQL con roles/claims no equivalen a sesiones firmadas de usuarios.
No se iniciaron sesiones reales ni se usó service_role fingiendo ser un técnico.
La comprobación HTTP con JWT real de las RPC nuevas solo puede hacerse después
de su instalación autorizada; puede realizarse desde navegador, no requiere APK.

## Reglas y calendario

Se preserva la fuente de puntuación instalada, incluidos estados, precedencia
de fecha, cero manual, NULL, integrantes actuales y penalización del trabajo
original por reincidencia imputable dentro de siete días inclusive.

**Matiz confirmado del reparto de tickets:** por ser tickets.points entero,
la expresión existente divide enteros y trunca. Por ejemplo, 5 puntos entre dos
integrantes aportan 2 a cada uno, no 2,5. Altas, Rutinas y descuentos usan
aritmética numeric. El candidato preserva ese comportamiento; se añadió un test
explícito y se corrigió el tipo del fixture. No se cambia esta regla de hecho ni
se compensan puntos, bonos o históricos.

Los inicios de Hoy/Semana/Mes de Mi Avance son medianoche de Perú, equivalentes
a 05:00 UTC; la semana empieza el lunes. Inicio incluido y fin excluido. La
consulta real del 20/10 mostró semana desde 19/10 00:00 -05 y mes desde
01/10 00:00 -05. Los casos de frontera, cambio de año, cuadrillas y reincidencias
siguen pasando con el tipo real y las ACL reales.

No se cambió el calendario previo del ranking. La comparación de todas sus
columnas sobre los datos reales del mes, usando SELECT extraído del candidato,
resultó idéntica a la función instalada. La lectura adicional UTC frente a Perú
encontró **cero trabajos en la diferencia de límites y cero técnicos con total
mensual distinto actualmente**. Esta coincidencia puede cambiar con cierres en
las cinco horas de diferencia al inicio/final del mes; no implica equivalencia
permanente de ambos calendarios.

## Rendimiento

Sobre datos reales se usaron EXPLAIN ANALYZE de SELECT, sin CREATE FUNCTION ni
migraciones. Los SELECT candidatos se extraen mecánicamente de sus cuerpos SQL;
no son otra fórmula de puntuación. No se exportan filas de resultados.

| Consulta sobre volumen actual real | Planificación | Ejecución PostgreSQL |
| --- | ---: | ---: |
| Ranking instalado | 0,051 ms | 5,542 ms |
| SELECT del ranking candidato | 5,975 ms | 2,308 ms |
| SELECT de Mi Avance candidato | 6,052 ms | 2,087 ms |
| Custodia instalada | 0,029 ms | 15,167 ms |

El plan de una función instalada es opaco; el SELECT extraído muestra otra
frontera de planificación. No interpretar esa tabla como una mejora de velocidad.

Ensayo adicional local con definiciones instaladas, categorías/tipos reales e
índices actuales reproducidos. Tres muestras por consulta, sin añadir índices al
candidato. Evidencia: [MI-AVANCE-RENDIMIENTO-LOCAL.json](MI-AVANCE-RENDIMIENTO-LOCAL.json).

| Volumen ficticio | Mi Avance | Detalle de trabajo | Ranking candidato | Ranking original |
| --- | ---: | ---: | ---: | ---: |
| 131 trabajos, 6 técnicos | 6,778–6,843 ms | 5,022–8,957 ms | 6,155–6,762 ms | 5,484–5,739 ms |
| 100.000 trabajos, 60 técnicos | 60,904–62,981 ms | 5,604–7,153 ms | 64,907–72,068 ms | 61,760–63,352 ms |

El caso grande contiene 50.000 tickets, 30.000 Altas, 20.000 Rutinas y 137.606
asignaciones; el JSON personal de muestra ocupa 13.785 bytes. En ambos volúmenes
el ranking coincide con el original en todas sus columnas. No se observaron
timeouts. Son muestras de servidor, no latencia HTTP, móvil, percentiles de carga
ni una prueba de concurrencia. El historial del resumen sigue acotado al mes/
semana actual sin paginar; una carga muy concentrada en un técnico debe vigilarse.

## Interfaz administrativa y captura

OperacionesHoyView.vue y RankingTecnicosView.vue continúan sin cambios. No se
editaron componentes, rutas ni estilos en esta validación. Se mantienen las
evidencias aprobadas de 360/390/1280 px, navegación administrativa y consulta.

Se abrió y examinó MI-AVANCE-MOVIL-LOCAL.png: orden Mi Avance → Mi custodia →
Mis órdenes, fechas legibles, nombre largo y referencia de orden envueltos y sin
desbordamiento visible. No se encontró un defecto visual comprobado que justificara
una corrección. **No se repitió navegador, build, TypeScript ni suites de 361/33
pruebas**: no hubo cambios en esos módulos. Se conservan sus resultados previos.

Solo se repitió la suite SQL modificada por los hallazgos de ACL/tipo y por el
nuevo rollback: `node --import tsx --test server/tests/fieldProgress.sql.test.ts`,
**14/14 PASS** (13 escenarios y contenedor padre). Añadidos truncamiento entero,
defaults reales y rollback de privacidad. `git diff --check` sin errores.

## Archivos de esta validación

Modificados respecto de la entrega anterior:

- docs/sql/mi-avance-candidate.sql: revocación explícita del ranking a anon/PUBLIC.
- docs/sql/mi-avance-rollback.sql: restauración de las ACL realmente instaladas;
  se conserva como restauración histórica completa, no como opción recomendada.
- server/tests/fieldProgress.sql.test.ts: tipos/defaults reales y casos nuevos.
- docs/MI-AVANCE-PREPARACION-LOCAL.md y ESTADO_DESARROLLO.md: referencia al preflight.

Nuevos:

- docs/sql/mi-avance-rollback-private.sql: rollback recomendado, conserva privacidad.
- scripts/field-progress-cloud-readonly.ps1: lector restringido a cuatro auditorías
  fijas; usa credencial DPAPI privada, nunca la imprime ni la pasa como argumento.
- scripts/tests/field-progress-cloud-{preflight,access,performance,calendar}.sql:
  catálogo, aislamiento de custodia, planes SELECT y diferencias de calendario.
- scripts/tests/prepare-field-progress-audit.cjs: extracción mecánica de SELECT,
  informes agregados y preparación del rollback privado; no conecta a Supabase.
- scripts/tests/field-progress-performance.mjs: crecimiento ficticio en Docker sin red.
- docs/MI-AVANCE-PREFLIGHT-CLOUD.json, docs/MI-AVANCE-RENDIMIENTO-LOCAL.json y este informe.

Los resultados privados permanecen ignorados por Git. Sin commits; no se mezclaron
los cambios ajenos existentes en el árbol.

## Activación propuesta, pendiente de autorización

1. Reconfirmar guarda/ACL y respaldar definiciones y permisos inmediatamente antes
   de la ventana; confirmar artefactos exactos y registrar el candidato en el flujo
   de migración revisado. Si aparece drift, detener esa activación.
2. Publicar el bloqueo API para técnicos, aplicar el SQL transaccional revisado
   y después habilitar el frontend nuevo, de forma coordinada. Hasta cerrar las
   vías API y RPC, no declarar resuelta la exposición preexistente.
3. Comprobar disponibilidad de las firmas RPC en PostgREST y refrescar su caché
   mediante el mecanismo autorizado si fuera necesario; no se hizo ahora.
4. Smoke HTTP con dos técnicos reales: puntos propios, ID de trabajo ajeno → NULL,
   intento de actor ajeno sin efecto, ranking global denegado, custodia propia;
   cliente/anon denegados y ADMIN/SUPERADMIN conservan ranking/Operaciones de Hoy.
5. Contrastar cifras con administración, considerando calendario y truncamiento;
   vigilar errores, payload y tiempos. Luego piloto Android descrito abajo.

La activación exige autorización separada de SQL/API/frontend. Esta entrega no
la presupone ni prepara una ejecución automática.

## Android real: instrucciones para después del despliegue

Obligatorio en una APK física: Chrome con UA emulado no reproduce integración
Flutter/WebView, teclado, navegación del sistema, caché ni suspensión Android.

1. Anotar modelo de teléfono, Android, versión de Android System WebView y APK.
   Abrir la APK actualizada con una cuenta de técnico y comprobar que carga el
   nuevo artefacto, incluso tras cerrar por completo y volver a abrir.
2. En vertical y horizontal, y con tamaño de letra aumentado, revisar puntos,
   referencias largas y serie/MAC. Comprobar que Inicio/Actualizar nativos y las
   barras del sistema no tapan tarjetas, enlaces o la última fila de custodia.
3. Escribir en Buscar con teclado Android, cerrar teclado y volver con botón/gesto
   Atrás. Debe conservar navegación útil y permitir regresar desde detalle/custodia.
4. Abrir Mi Avance, pasar a otra app/bloquear pantalla y regresar. Probar modo avión
   y retorno por Wi-Fi/datos móviles usando solo Actualizar: carga/error/reintento,
   sin mostrar cero inventado ni quedar bloqueado. Confirmar la hora de consulta.
5. Cerrar sesión e ingresar con otro técnico en la misma APK. No deben aparecer
   puntos o custodia anteriores, ni transitoriamente. Comparar los propios con un
   control administrativo autorizado, sin mostrar el ranking de compañeros.
6. Abrir un trabajo propio de Alta/Avería/Rutina ya existente y verificar navegación
   y panel de puntos; consultar custodia y confirmar ausencia de acciones de
   mutación. No crear/cerrar trabajos ni entregar/devolver material para este smoke.

Registrar PASS/FALLO por paso y captura sin información de otros técnicos. Un
fallo de aislamiento, caché de sesión o navegación que impida trabajar detiene
el piloto. Los cálculos calendarios, reparto y reincidencias se validan en SQL;
no necesitan alterar el reloj del teléfono ni esperar al siguiente mes. Las
validaciones operativas previas de Fase 165 siguen pendientes por separado.

## Rollback y riesgos residuales

Primera opción si falla solo la interfaz: retirar únicamente el frontend nuevo,
mantener el bloqueo API y el SQL que cierra la consulta global. No resetear el
repositorio compartido ni desplegar una API antigua que reabra la exposición.

Si es imprescindible retirar el refactor SQL, usar como candidato de rollback
**docs/sql/mi-avance-rollback-private.sql**: guarda MD5, restaura puntuación original
con control administrativo, revoca anon, retira RPC personales y fuente interna,
todo en transacción. Probado que conserva resultados administrativos, devuelve
cero filas al técnico y deniega anon. Mantener el bloqueo API y retirar el frontend
que depende de las RPC eliminadas.

docs/sql/mi-avance-rollback.sql restaura cuerpo y permisos históricos completos,
incluida la exposición a anon/técnicos: **no es el rollback recomendado** y no
debe usarse automáticamente. Ambos son archivos de revisión, sin ejecución remota.

Persisten los riesgos conocidos: diferencia de calendario futura con el ranking,
truncamiento histórico de puntos enteros, cambios posteriores por reasignación/
reincidencia, rendimiento sin ensayo concurrente y validación pendiente en APK.
No hay una fórmula de bono nueva ni una modificación de esas reglas. Con estas
limitaciones explícitas, el candidato está preparado para solicitar una ventana
de despliegue controlado y validación posterior, no para declarar cerrado el piloto.
