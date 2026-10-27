# Asistencia A3 — intercambio de días de descanso, candidato local

## Estado vigente de A3

A3 implementada y validada localmente en `feature/asistencia-a3-local`,
worktree `scripts/inventory-auth-lab/runtime/asistencia-a3-worktree`, sobre
`9918bb2`. Sin push, merge, migración productiva ni despliegue. A0/A1 sigue
cerrada y validada; A2/A2.1 sigue cerrada administrativamente por decisión del
propietario, con validación funcional completa aún no acreditada y seguimiento
operativo del sábado/vacaciones/permisos. A3 deja de ser «sin implementar»:
su pendiente ahora es revisión y autorización de activación productiva.
Detalle de alcance, pruebas y rollback: `docs/ASISTENCIA-A3-INTERCAMBIOS-LOCAL.md`.
Esta nota prevalece sobre las menciones anteriores de A3 como no iniciada.

## Comportamiento y archivos

- `IntercambiosPanel.vue`: SUPERADMIN selecciona colaborador activo, dos fechas
  y horas reales; autoriza la pareja completa. ADMIN/TECNICO_RED consultan sus
  propios intercambios en el mismo widget web/Campo. Se conserva el UUID al
  reintentar una creación con los mismos datos. Cancelación con motivo, solo
  antes de ambos días; sin edición parcial ni eliminación del registro.
- `asistenciaIntercambios.ts`: lectura paginada, resumen diario y calendario
  personal del reporte; añade el domingo/feriado compensatorio y retira el
  descanso, incluso si los días pertenecen a meses diferentes.
- `AsistenciaPanel.vue` y `AsistenciaView.vue`: integración mínima con widget,
  tablero y reporte mensual/CSV; muestra pareja/horas, evita «Sin marcar» en
  descanso autorizado y distingue programación de días realmente trabajados.
- Migración `20261029000000_asistencia_a3_intercambios.sql`: tabla vinculada
  `asistencia_intercambios`, RLS de lectura, RPC de crear/cancelar/resumir y
  auditoría mediante `asistencia_config_eventos` existente. Sin escritura directa
  del usuario. Solo cambia la RPC de ingreso para A3; almuerzo/salida reutilizan
  las RPC existentes sobre el ingreso válido. No se cambian migraciones previas.

El descanso reemplaza un día normalmente laborable; la compensación se programa
en domingo o feriado. No permite fechas pasadas, jornadas ya comenzadas, registros
o solicitudes previas en ambos días, fechas reutilizadas o solapamiento con A2.
El descanso de hoy solo puede programarse antes del ingreso personal/global;
la compensación de hoy, antes de su ingreso configurado. Las horas no cruzan
medianoche. Ingreso usa horario compensatorio y tolerancia vigente; almuerzo
conserva la duración global y salida conserva su comportamiento sin bloqueo por
hora, como A2.1. SUPERADMIN permanece exento; horarios de sábado intactos.

Locks transaccionales serializan intercambios, marcación, solicitudes y novedades.
Guards adicionales impiden novedades A2 posteriores sobre la pareja, solicitudes
redundantes de ausencia en el descanso y cambios de feriado sobre fechas vinculadas.
Toda fecha y hora de negocio usa `America/Lima`. No se reescriben marcaciones.

## Validación focalizada

- `node --test server/tests/asistenciaA3Intercambios.test.cjs`: 11 escenarios SQL
  en PostgreSQL 17 efímero, `--network none`. Migraciones reales A0–A3; reloj
  reemplazado únicamente dentro de esa base desechable, sin cambiar reloj del SO.
  Incluye permisos/RLS reales, lunes/domingo, almuerzo/salida, feriado/tardanza,
  sábado personal, históricos, cancelación, rollback y concurrencia A2/A3.
- `node --test server/tests/asistenciaA3Intercambios.browser.test.cjs`: 5 escenarios
  Chrome headless con API ficticia y fixture `server/tests/fixtures/asistencia-a3.html`.
  Programación/cancelación, consulta ADMIN/técnico, widget domingo/lunes, exención
  SUPERADMIN y tablero/reporte mensual real con/sin ingreso dominical.
- `node --import tsx --test src/lib/__tests__/asistenciaIntercambios.test.ts`:
  3 casos de calendario mensual, ausencia justificada, aislamiento por trabajador
  y meses distintos. `npm.cmd run build`: tipado y compilación aprobados;
  advertencia habitual de tamaño de chunks, sin errores.
- No se repitieron auditorías ni suites cerradas A0–A2.1. Ninguna escritura real.

## Riesgos y pendientes para producción

Requiere autorización nueva de push, migración y despliegue selectivo. Antes de
activar: verificar dependencias y versión real de Asistencia, respaldo de SQL/
imagen y cadena completa de overrides, conservando backend `16831c6` y las demás
funciones. Aplicar SQL antes de publicar el frontend A3: este requiere tabla/RPC
nuevas; ante error de lectura bloquea controles personales y ofrece reintento.
La evidencia es local con datos ficticios; falta validación operativa real de A3.

Rollback preparado en `scripts/sql/asistencia-a3-rollback.sql`: devuelve ingreso
exactamente a A2.1 y revoca RPC A3, sin borrar tabla ni auditoría. Solo admite
base sin intercambios; probado que se detiene si existe cualquier registro,
incluso cancelado, para no reinterpretar históricos. Con registros, conservar
A3 y preparar una recuperación específica; no sustituir por frontend antiguo
que ignore los intercambios. Sin registros, coordinar pausa de programación y
reversión de frontend antes del SQL; la estructura preservada requiere una
reactivación específica, no reaplicar a ciegas el CREATE TABLE original.

El directorio principal y sus cambios ajenos se conservaron. Producción no fue
consultada ni modificada durante A3. Las versiones del registro productivo siguen
siendo las últimas documentadas; este candidato no constituye una nueva versión
productiva ni certifica el seguimiento operativo pendiente de A2/A2.1.
