# SmartRayco — guía para Claude Code

## Cierre definitivo de Fase A3 - 27/10/2026

**A3 implementada, desplegada, aprobada y validada visualmente por el propietario.
Cierre administrativo definitivo autorizado expresamente.**

Frontend visual `233f230`: `smartrayco-asistencia-visual:233f230-20261027T133357Z`.
Backend conservado `16831c6`. Despliegue documentado en el commit `d958555`
y en `docs/ASISTENCIA-VISUAL-DESPLEGADA.md`, con evidencias y rollback disponibles.

La validación operativa de intercambios reales continuará durante el uso diario,
sin bloquear ni reabrir el cierre administrativo. **A0-A3 permanecen cerradas**;
solo se reabrirán ante incidencias concretas, sin repetir auditorías ni pruebas
ya aprobadas por el solo seguimiento operativo.

Esta declaración prevalece sobre las notas históricas de fases abiertas,
validaciones pendientes o mejora visual sin publicar que se conservan abajo.
Actualización exclusivamente documental: sin código, SQL, permisos, consultas
ni cambios productivos; sin merge a main ni inicio de nuevas fases.

## Despliegue visual A3 completado ? 27/10/2026

Mejora de cuatro pesta?as del commit `233f230` **DESPLEGADA** el
27/10/2026 a las 13:34:58 UTC (08:34:58 Per?), con autorizaci?n expl?cita.
Frontend activo: `smartrayco-asistencia-visual:233f230-20261027T133357Z`; imagen
`sha256:b1d21a1c3a2d8656b98040316b76b5458e7ba1b619d41f4d14426d15278ba038`.
Backend `16831c6` conservado: contenedor
`cd577bcaa95cab290bfa2baa7d754a97a516dab94a0aa79af5db6cb34bccf154`,
StartedAt `2026-10-26T20:44:49.856235867Z`, misma imagen y sin reinicio.
A0?A3, Devoluciones, Puntos y dem?s m?dulos conservados; solo cuatro fuentes
de interfaz de Asistencia cambian respecto a A3. Sin SQL ni cambios de datos.
API, panel, Asistencia y Campo HTTP 200; index y recursos comprobados por SHA-256.
Se mantienen todos los overrides anteriores y se a?ade al final
`/opt/smartrayco-staging/asistencia-visual-233f230-20261027T133357Z/promotion/frontend.override.json`.
Respaldo recuperable de A3 anterior disponible en PC y VM, OCI ?ntegro (17 blobs).
Detalle, cadena Compose y rollback: `docs/ASISTENCIA-VISUAL-DESPLEGADA.md`.
Esta secci?n prevalece sobre las notas hist?ricas de mejora visual local pendiente.
No se inicia ninguna fase nueva.

## Cierre de sesión y continuidad — 27/10/2026

- **A0/A1 y A2/A2.1 cerradas administrativamente.** A0/A1 también validadas;
  el seguimiento operativo de sábado/vacaciones/permisos A2/A2.1 se conserva.
- **A3 implementada, migrada y desplegada; intercambio de descanso confirmado
  funcional por el propietario.** No volver a registrarlo como validación pendiente.
- **Mejora visual de cuatro pestañas implementada y probada LOCALMENTE,
  pendiente de despliegue.** Commit visual `233f230f06e0946dca31109cf68299e4356cb2b5`
  (`233f230`), rama `feature/asistencia-a3-local`; cinco escenarios de navegador
  aprobados, tipado/compilación aprobados y siete capturas guardadas. Evidencia
  existente conservada, sin repetir pruebas para este cierre.
- Frontend productivo documentado conservado:
  `smartrayco-asistencia-a3:71944f5-20261027T041727Z`. La mejora visual no está
  publicada. Backend `16831c6`, contenedor `cd577bcaa95cab290bfa2baa7d754a97a516dab94a0aa79af5db6cb34bccf154`,
  StartedAt `2026-10-26T20:44:49.856235867Z`, conservado.

**Siguiente paso, previa autorización: desplegar únicamente el frontend visual
del commit `233f230`, conservando exactamente backend `16831c6` y sus overrides
activos.** Mantener la cadena completa de Compose: base
`/opt/smartrayco/docker-compose.onprem.yml`, override backend
`/opt/smartrayco-staging/fase175-counters-16831c6-20261026T162650Z/backend.override.json`,
override frontend A2-full y override frontend A3 ya documentados; agregar solo
un override nuevo del frontend visual. No recrear backend ni reaplicar A3.

Cierre exclusivamente documental para Claude Code y Codex. El push normal a
`origin/feature/asistencia-a3-local` respalda código/documentación; no constituye
despliegue. Sin merge a main ni force push. No se ejecutaron migraciones, builds,
pruebas ni despliegues durante este cierre; directorio principal y cambios ajenos
intactos. Esta sección prevalece sobre las notas históricas de «sin push» y de
aceptación funcional A3 pendiente.

Detalle visual/capturas: `docs/ASISTENCIA-PESTANAS-VISUAL-LOCAL.md`.
Cadena exacta y estado productivo: `docs/ASISTENCIA-A3-FRONTEND-DESPLEGADO.md`.

## Estado vigente: A3 migrada, desplegada y verificada técnicamente

Frontend A3 `71944f5` promovido el **27/10/2026 05:21:22 UTC (00:21 Perú)**.
Imagen activa `smartrayco-asistencia-a3:71944f5-20261027T041727Z`.
La migración A3 ya aplicada quedó conservada: **no se volvió a ejecutar**.
API, panel, Asistencia, Campo y assets publicados comprobados. Backend `16831c6`
conservado con el mismo contenedor, imagen, StartedAt y override.
**Pendiente validación funcional real A3; no declararla cerrada funcionalmente.**
Este estado prevalece sobre las notas anteriores de activación detenida o
frontend pendiente, conservadas como antecedentes. A0/A1 sigue cerrada y validada;
A2/A2.1 cerradas administrativamente con su seguimiento operativo pendiente.

Detalle: `docs/ASISTENCIA-A3-FRONTEND-DESPLEGADO.md`.

## Estado vigente: SQL A3 aplicada y verificada; frontend A3 NO desplegado

La migración `20261029000000_asistencia_a3_intercambios.sql` del candidato
`71944f5` se aplicó exclusivamente al proyecto `mzupdnjegfwmpajywckd` el
27/10/2026 a las 04:19:31 UTC (26/10, 23:19 Perú). Su verificación posterior
está completada. La activación se detuvo antes de construir/promover frontend
por un fallo del parser de verificación, corregido después solo para comprobar
el SQL. **El frontend sigue en A2/A2.1 `7ed8dcd`; A3 NO está activada de punta
a punta.** Esta nota prevalece sobre los estados anteriores de A3 sin migrar
o lista para activación completa. No reaplicar la migración.

Detalle: `docs/ASISTENCIA-A3-SQL-APLICADA-FRONTEND-PENDIENTE.md`.

## Estado vigente: respaldos verificados; A3 todavía NO activada

**APTO para retomar la activación controlada.** Se identificó y corrigió el
verificador, se acreditó la recuperación real de la imagen y del respaldo SQL,
y se conservaron frontend, backend y overrides. No se aplicó la migración A3
ni se construyó/promovió frontend. Esta actualización sustituye el bloqueo del
respaldo descrito en `ASISTENCIA-A3-ACTIVACION-DETENIDA.md`, conservado como
antecedente. No constituye autorización ni ejecución de la activación pendiente.

Detalle: `docs/ASISTENCIA-A3-RESPALDOS-CORREGIDOS.md`.

## Estado vigente: A3 NO activada

La activación del candidato `71944f5` fue autorizada por el propietario, pero
se detuvo en el paso 2 al fallar la verificación de la imagen respaldada.
No se aplicó la migración A3, no se construyó ni promovió frontend, y no se
recreó backend. Esta nota prevalece sobre cualquier indicación de activación
completada. A3 sigue pendiente de activación y validación operativa real.

Se actualiza documentación y se sincroniza la rama A3 conforme a la autorización;
el push no representa despliegue. A0/A1 y A2/A2.1 mantienen su estado anterior.

Detalle: `docs/ASISTENCIA-A3-ACTIVACION-DETENIDA.md`.

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

## Estado vigente — cierre administrativo de Asistencia A2/A2.1

**A2/A2.1 cerradas administrativamente por decisión del propietario; validación funcional completa aún no acreditada. Incidencias posteriores se atenderán puntualmente**.

- A0/A1: cerrada y validada.
- A2 y A2.1: implementadas, desplegadas y cerradas administrativamente.
- Horarios del sábado configurados y guardados correctamente: Alhely Lozano,
  08:00–13:30 (mañana); Angie Laguna, 13:30–19:00 (tarde).
- Las marcaciones reales del próximo sábado y el uso real de vacaciones/permisos
  quedan en seguimiento operativo, sin bloquear el cierre administrativo.
- **Siguiente fase pendiente: A3 — intercambio de descansos**, aún sin implementar.

Esta decisión posterior del propietario prevalece sobre todas las notas de estos
documentos que indiquen «NO cerradas todavía», «pendiente de cierre» o que exijan
validación real como condición de cierre de A2/A2.1. Esas notas se conservan como
antecedentes y no acreditan validación funcional completa.

Continuidad compartida para Claude Code y Codex en `feature/asistencia-a2-local`:
consultar este estado vigente en los tres documentos sincronizados. Actualización
exclusivamente documental, sin cambios funcionales, pruebas repetidas, migraciones
ni despliegues; versiones productivas conservadas. A3 no se inicia con este cierre.

## Asistencia A0/A1/A2/A2.1 — desplegadas; A2/A2.1 pendientes de validación real (27/10/2026)

**Estado vigente, confirmado por el propietario**: A0/A1 **cerrada y
validada**. A2 (vacaciones/descanso/permisos por horas/medias jornadas) y
A2.1 (horarios parciales recurrentes por trabajador) están **implementadas
y desplegadas** en producción (migraciones
`20261028000000_asistencia_a2_novedades.sql` y
`20261028010000_asistencia_a2_horarios_personales.sql` aplicadas en ese
orden; frontend `smartrayco-asistencia-a2-full:7ed8dcd-20261027T000500Z`;
backend `smartrayco-backend-counters:16831c6-...` conservado exacto,
mismo contenedor/`StartedAt`). API/panel verificados en vivo;
Puntos/Devoluciones/Analítica confirmados intactos (sin cambios de
código/backend/BD, sin repetir sus pruebas). Rollback preparado y
verificado: `scripts/sql/asistencia-a2-rollback.sql` + tag
`smartrayco-asistencia-a2-full-rollback:20261027T000500Z`.

**Horarios parciales recurrentes ya guardados en producción** (A2.1,
`asistencia_horarios_personales`, configurados por SUPERADMIN):
- Alhely Lozano — sábado 08:00–13:30 (mañana).
- Angie Laguna — sábado 13:30–19:00 (tarde).

**A2/A2.1 NO se declaran completamente cerradas todavía** — pendiente
validar con marcaciones reales del sábado (que la tardanza/falta de cada
una se calcule contra SU horario, no el global) y el funcionamiento real
de vacaciones/permisos desde el panel. No repetir esta validación por
otra vía ni auditar de nuevo hasta que el propietario confirme esas
pruebas. Detalle completo en `ESTADO_DESARROLLO.md` ("Activación
CONJUNTA A2 + A2.1 — DESPLEGADA").

## Asistencia semiautomática A0/A1 — CERRADA y validada en producción (26/10/2026)

El propietario cerró A0/A1 explícitamente el 2026-10-26: desplegada,
operativa y validada en producción. No reabrir esta fase ni repetir su
auditoría — continuar con A2 (ver sección propia más abajo). SUPERADMIN
gestiona configuración y
aprueba/rechaza, pero está **exento de asistencia**: no tiene horario,
marcación ni reporte personal; no suma faltas, tardanzas ni pendientes de
marcación — confirmado por `asistencia_ausencias_resumen` y el trigger de
marcación, que rechaza sus escrituras. Sus marcas históricas se conservan
intactas. ADMIN marca/reporta desde el panel web y técnico desde Campo
(mismo widget/RPC), resolución auditada, protección del historial.

- **Migración `20261027010000_asistencia_a0_a1.sql`: APLICADA** a Supabase
  de producción el 2026-10-26 ~20:27 UTC. Verificado de solo lectura antes
  y después: 113 marcaciones históricas, mismo hash — ninguna fila se
  alteró. Permisos re-verificados (`has_function_privilege`): las 4 RPC
  de marcación siguen abiertas a `authenticated`/cerradas a `anon`; las 3
  RPC nuevas solo `authenticated`; escritura directa de
  `asistencia_registros` cerrada para todos (solo vía RPC).
- **Frontend: ACTIVO**, imagen `smartrayco-asistencia-polish:070c777-20261026T220705Z`
  (commit `070c777` — corrige `class="input"` inexistente en el formulario
  personal ADMIN/TECNICO_RED, mismo defecto que `cd0d0c9` ya corrigió en la
  bandeja SUPERADMIN: campos sin estilo, diminutos y amontonados por una
  clase CSS que no existe en `style.css`; la real es
  `field-input`/`field-label`). Construido sobre
  `smartrayco-asistencia-approve:263f66e-...` (aprobación/rechazo
  SUPERADMIN corregido), que a su vez ya incluía A0/A1, Puntos y
  Devoluciones — las 5 funciones confirmadas presentes en la imagen
  (grep sobre el JS compilado) antes de promoverla.
- **Backend: SIN TOCAR** — sigue en `smartrayco-backend-counters:16831c6-...`
  (misma corrección de contadores de Fase 175). Confirmado por ID de
  contenedor y `StartedAt` idénticos antes/después de los 4 despliegues de
  frontend de Asistencia (`711a7fc`, `4db50f9`, `263f66e`, `070c777`).
- Rollback del frontend preparado y sin usar: `smartrayco-asistencia-polish-rollback:20261026T220705Z`
  (imagen anterior `263f66e` respaldada en
  `/opt/smartrayco-staging/asistencia-polish-070c777-20261026T220705Z/recovery/frontend.tar`).
- Rama `feature/asistencia-a0-a1-local`, commits `1fa2c59` → `fb7c3e2` →
  `0dfecfa` → `d984e56` → `711a7fc` → `4db50f9` → `0143c5c` → `263f66e` →
  `4723f30` → `cd0d0c9` → `070c777` → `33637f5`. **Pusheada a GitHub el
  2026-10-26** (`origin/feature/asistencia-a0-a1-local`, sin force push,
  sin PR abierto todavía) — el despliegue en la VM siguió usando el
  mecanismo selectivo (override de 1 solo servicio), el push es solo para
  respaldo/colaboración con Codex en GitHub, no afecta lo ya desplegado.
- Pruebas (commit `070c777`, previas al despliegue, datos ficticios/Postgres
  aislado): 9/9 navegador + `vue-tsc` limpio para ambas correcciones
  visuales; unitarias/pruebas de aprobación-rechazo previas sin cambios de
  código, no repetidas. No se resolvió ninguna solicitud real.
- **A2 implementada y DESPLEGADA** (2026-10-27 ~02:44 UTC), **pendiente de
  cierre hasta validar vacaciones/permisos reales desde el panel**:
  vacaciones por rango, descansos programados, permisos por horas y
  medias jornadas — SUPERADMIN programa y aprueba en un solo paso,
  ADMIN/TECNICO_RED solo consultan sus propias novedades. Migración
  `20261028000000_asistencia_a2_novedades.sql` **APLICADA**, componente
  `NovedadesPanel.vue` (montado en Control de Asistencia y en el widget
  compartido Campo/panel) **ACTIVO**. 13/13 SQL + 5/5 navegador +
  unitarias PASS, `vue-tsc`/build limpios.
- **A2.1 implementada y DESPLEGADA**, **pendiente de cierre hasta validar
  marcaciones reales del sábado** (requisito operativo real: dos técnicos
  que todos los sábados trabajan media jornada, uno por la mañana y otro
  por la tarde): horarios parciales RECURRENTES por trabajador (tabla
  `asistencia_horarios_personales`, día de la semana 1..6 + turno + horas
  REALES configuradas por SUPERADMIN, nunca inventadas), distintos del
  permiso EXCEPCIONAL de un solo día (`asistencia_novedades` tipo
  `media_jornada`). **Horarios reales ya guardados en producción**:
  Alhely Lozano (sábado 08:00–13:30, mañana) y Angie Laguna (sábado
  13:30–19:00, tarde). `mark_attendance_ingreso` ahora calcula la
  tardanza contra el horario REAL de cada persona (precedencia: permiso
  excepcional de hoy > horario habitual recurrente de ese día > horario
  general de la compañía) — nunca se marca ausente "la otra mitad" del
  día, porque falta sigue siendo por día completo sin ninguna marcación,
  nunca por segmento. **Corrige la limitación documentada de A2**:
  `media_jornada` ya NO exime el día completo (ahora exige turno + horas
  reales, igual forma que `permiso_horas`, y requiere una marcación real
  como cualquier otro día). Migración
  `20261028010000_asistencia_a2_horarios_personales.sql` **APLICADA**,
  componente `HorariosPersonalesPanel.vue` **ACTIVO**. 14/14 SQL + 5/5
  navegador + 2 unitarias nuevas PASS, `vue-tsc`/build limpios.
  **Ejecutar las suites de Asistencia de una por una**
  (`node --test server/tests/<archivo>`) — en paralelo los contenedores
  Docker aislados interfieren entre sí y dan fallos falsos (confirmado:
  cada suite 100% verde por separado, no es una regresión real).
  Detalle completo de A2/A2.1 en `ESTADO_DESARROLLO.md` ("Asistencia A2" /
  "Asistencia A2.1" / "Activación CONJUNTA A2 + A2.1 — DESPLEGADA").
  **No declarar A2/A2.1 completamente cerradas hasta que el propietario
  confirme las marcaciones reales del sábado y el uso real de
  vacaciones/permisos** — mismo criterio que A0/A1 (que sí quedó cerrada
  tras confirmación explícita).

## Antes de empezar

Lee primero `ESTADO_DESARROLLO.md` (raíz del repo) — tiene el estado real
(implementado/desplegado/pendiente), la arquitectura, el último commit
desplegado y los riesgos/trabajos pendientes conocidos. Evita repetir
análisis ya hecho. Mantenlo actualizado al final de cada sesión relevante
(qué cambió, qué quedó pendiente, próximo paso recomendado) — es la
referencia compartida entre Claude Code y ChatGPT para este proyecto.

Después consulta `docs/REGISTRO-VERSIONES-PRODUCTIVAS.md` para las versiones
reales por servicio y `docs/FASE175-CONTADORES-ACTIVADOS-20261026.md` para la
evidencia de Fase 175. **Fase 175 está desplegada y operativa:** backend
`16831c6`, muestreo automático recuperado con 360 registros nuevos del
Administrador. El HTTP 400 por URL excesiva está corregido con lotes de 100;
los errores y rollbacks anteriores son antecedentes, no incidentes activos.
Seguimiento de ciclos y certificación integral de 3.000 clientes siguen
pendientes, pero no invalidan la recuperación real ya confirmada.

## Devoluciones de App de Campo — estado vigente (26/10/2026)

Acceso implementado y desplegado en `/campo/mi-custodia`: «Solicitar devolución»
para materiales y equipos bajo custodia. El artefacto anterior conservaba una
vista de solo consulta; se incorporó selectivamente el código ya aprobado
`fb56057`, con publicación `c11f6a8`. Frontend `smartrayco-campo-returns:c11f6a8-20261026T171151Z`;
backend `16831c6` conservado sin reinicio. Sin SQL ni permisos nuevos.
Pruebas de navegador del candidato/publicado con datos ficticios PASS;
25/25 SQL/unitarias previas conservadas. **Devoluciones de materiales y
equipos seriados implementadas, desplegadas y validadas funcionalmente**.
El propietario confirmó expresamente el **26/10/2026** que probó
satisfactoriamente la devolución desde App de Campo en Android y su recepción
administrativa. **Ambas pruebas COMPLETADAS; flujo probado y cerrado.**
No volver a registrarlas como pendientes ni repetir pruebas anteriores.
Frontend `c11f6a8`, backend `16831c6` sin cambios; antecedentes publicados:
`c11f6a8` y documentación `6a8dadd`. Este cierre prevalece sobre las notas
de aceptación pendiente de informes anteriores, conservadas como antecedentes.
Sin pruebas nuevas ni operaciones productivas en esta actualización.
Detalle/rollback: `docs/CUSTODIA-DEVOLUCIONES-CORRECCION-LOCAL.md`;
versiones exactas en `docs/REGISTRO-VERSIONES-PRODUCTIVAS.md`.

## Equipos seriados, custodia e instalación — fase cerrada operativamente

El propietario confirma que el **25/10/2026** se realizaron **tres instalaciones
reales exitosas** con instalación de equipos desde App de Campo. El circuito
está implementado y desplegado: **entrega al técnico → custodia → instalación
y devolución**, operativo y **sin defectos reportados**. Devolución y recepción
administrativa ya fueron validadas y cerradas por el propietario el 26/10/2026.
No volver a tratar esta fase como desarrollo pendiente ni exigir repetir las
pruebas anteriores para reconocer su cierre operativo.

Alcance de la evidencia: es la confirmación expresa del propietario sobre las
tres instalaciones. No acredita por separado cada categoría ONT, Mesh y TV Box,
ni verificaciones individuales de serie/MAC, contrato o movimientos de custodia.
No inventar esos detalles ni confundir cierre operativo con certificación
individual por categoría. Versiones productivas documentadas conservadas:
frontend `c11f6a8`, backend `16831c6`. La meta permanente de estabilidad y
rendimiento para al menos **3.000 clientes** se mantiene como requisito
transversal; no reabre esta fase operativa.

Esta actualización es solo documental: sin pruebas, auditorías, código,
consultas productivas, migraciones ni cambios de inventario/contratos.

## Capacidad mínima (requisito permanente)

SmartRayco debe soportar al menos **3.000 clientes** con estabilidad y
rendimiento. Distinguir pruebas simuladas de escalabilidad y certificación
integral con carga real; no declarar una como sustituto de la otra.

## Contexto

SmartRayco está en fase de pruebas operativas reales (octubre 2026). Técnicos y
administradores lo usan en campo. Clientes, servicios y datos son reales —
protegerlos siempre (ver regla 13).

## Usabilidad para personal administrativo (regla permanente)

SmartRayco lo usa a diario personal administrativo **sin conocimientos
técnicos de redes** — toda interfaz debe ser intuitiva, clara y
comprensible para ese usuario, no solo correcta para quien conoce el
dominio técnico. Aplica a corrección y desarrollo en **Clientes,
Contratos, OLT, Soporte, Rutinas, Altas, Inventario, Facturación y App
Campo** — no solo al módulo en que se trabaje puntualmente.

Requisitos obligatorios:

1. Mostrar nombre del cliente, código y contrato cuando estén
   vinculados y **verificados** — nunca inferidos por nombre,
   descripción o posición física (ver regla 6 de la migración OLT).
2. Mostrar fecha y hora **real** del evento (nunca la hora de
   renderizado) en horario de Perú (`America/Lima`, sin asumir la zona
   horaria del dispositivo de quien mira la pantalla).
3. Ofrecer acceso directo a la ficha del cliente o del servicio/contrato
   correspondiente — no obligar a buscarlo aparte.
4. Mensajes de error y alertas en lenguaje sencillo: qué ocurrió y qué
   debe hacer el usuario — no un mensaje técnico crudo (código, log,
   jerga de red) como única explicación.
5. Los datos técnicos (serial, slot/puerto, señal, mensajes crudos)
   siguen disponibles, pero como información **secundaria** — nunca lo
   primero que se lee.
6. No obligar al personal a buscar manualmente un dato que el sistema
   ya tiene y puede resolver solo (mismo cliente, mismo contrato, misma
   zona ya cargados en otra parte del mismo panel).
7. Sin vínculo verificable, mostrar **"Pendiente de vincular"** — nunca
   inventar ni asumir un dato para rellenar el hueco.
8. Respetar siempre los 3 roles operativos reales (regla 9 de la
   migración OLT: SUPERADMIN, ADMIN, TECNICO_RED).

Precedente ya implementado siguiendo esta regla (referencia de patrón,
no repetir su investigación): Fase B de discrepancias PON↔zona↔contrato
(`src/lib/ontZoneDiscrepancy.ts`, `OntZoneDiscrepancyModal.vue`), las
alertas operativas de OLT (`src/lib/oltAlertPresentation.ts`,
`ESTADO_DESARROLLO.md` 13as) y su historial (`GET /:id/alert-log`,
sección "Historial de alertas" dentro de la misma tarjeta en
`OltDetailView.vue`, 13at/13au — tabla `olt_alert_log` ya **aplicada y
desplegada en producción**, migración `20261014150451`) — mismo
criterio de vínculo verificable (en el historial, un *snapshot* al
momento del evento, nunca el vínculo de hoy), hora real en horario de
Perú con la distinción explícita entre "hora de detección" y hora real
del evento, acceso directo a la ficha, datos técnicos como secundarios.

Fase 5 (`src/lib/oltConnectionStatus.ts`, pestañas "Estado
actual"/"Historial de alertas" en la misma tarjeta de
`OltDetailView.vue`, `ESTADO_DESARROLLO.md` 13aw, DESPLEGADA) es el
ejemplo más reciente de esta regla aplicada **sin ningún backend
nuevo**: todos los conteos/listas/avisos se derivan de datos ya
cargados en el panel (`oltStore.onts`, `summary`, el propio
`GET /:id/alert-log`) — útil como referencia de que mejorar la
visualización para personal administrativo no siempre requiere
tabla/endpoint/servicio nuevo, solo agregación pura y bien probada
sobre lo que ya existe.

**Admin-disabled ≠ desconectado, y admin-disabled ≠ deuda (13ax, ver
`ESTADO_DESARROLLO.md`)**: una ONU con `admin_state='disable'` (mismo
dato que SmartOLT reporta como "admin-disabled mode") NUNCA debe
contarse ni mostrarse como "sin conexión" — `admin_state` manda
SIEMPRE sobre `status`, incluso si `status` quedó en `'online'` de
antes de suspenderse. Caso real confirmado (Danner Ávalos Ventura,
CTR-2026-00356): admin-disabled con `debt_hold_status='none'` en su
contrato — pese a que el operador afirmaba que era "por deuda", el
propio sistema no lo corrobora. Por eso el motivo "por deuda/mora"
**solo** se muestra si hay evidencia confiable
(`service_contracts.debt_hold_status='suspended'`, ya cruzado por
`GET /:id/onts/disabled`/`suspensionReasonLabel` en
`oltConnectionStatus.ts`) — nunca inferido del admin-state solo.

**El cruce de mora es SIEMPRE por `contract_id` exacto, nunca por
`client_id` (13ay)**: un cliente con 2+ contratos, donde solo uno está
en mora, no debe "contagiar" ese motivo a sus demás servicios al día.
Ver `server/src/services/oltDisabledReason.ts`
(`resolveDisabledReason`, puro) — si se vuelve a tocar
`GET /:id/onts/disabled`, mantener el cruce por `contract_id`, no
retroceder a `client_id`.

## Modo de desarrollo y validación eficiente

Objetivo: detectar, corregir y validar problemas sin auditorías completas en
cada modificación — reducir trabajo/tokens redundantes, no bajar el estándar
de calidad.

1. Antes de modificar código, identifica únicamente el módulo y los archivos
   relacionados (usa Grep/Glob dirigido, no una exploración amplia).
2. No leas todo el repositorio si el problema está localizado.
3. No repitas análisis que ya estén documentados — revisa primero
   `docs/ERRORES-CAMPO.md` y la memoria de proyecto.
4. Usa primero las pruebas automatizadas existentes (`npm pkg get scripts`
   para ver las disponibles: `test:telnet`, `test:provisioning`,
   `test:fetch-timeout`, `test:nap-sql`, `test:single-active-job-sql`, etc.)
   antes de escribir pruebas nuevas desde cero.
5. Al corregir un error funcional, crea una prueba de regresión pequeña y
   reutilizable — para RPCs/triggers de Supabase, sigue el patrón de
   `server/tests/*.sql.test.ts` (Postgres real en Docker, aislado, con el
   archivo de migración real cargado tal cual).
6. Usa mocks y datos sintéticos para pruebas que puedan modificar
   información real. Nunca ejecutes escrituras de prueba contra Supabase de
   producción, la OLT real ni MikroTik real.
7. Evita generar documentación HTML o informes extensos para correcciones
   menores — un resumen de texto alcanza.
8. No repitas compilaciones (`vue-tsc`, `tsc`, `npm run build`) si los
   archivos relevantes no cambiaron desde la última corrida.
9. No ejecutes suites completas salvo que el alcance o el riesgo lo
   justifique — corre primero solo el/los scripts de prueba del módulo
   tocado.
10. Resume resultados en un máximo de 10 líneas, salvo errores importantes.
11. No muestres logs completos si basta con indicar el resultado y las
    líneas relevantes del error.
12. No hagas preguntas cuando el problema se pueda resolver con la
    arquitectura existente — pregunta solo ante una decisión que de verdad
    requiera al usuario (dato ambiguo, cambio que afecte datos/equipos
    reales, alcance fuera de lo pedido).
13. Datos reales protegidos siempre: nunca un `UPDATE`/`DELETE` de prueba
    contra Supabase de producción, la OLT real (10.15.15.2) ni MikroTik
    real. Confirmar el destino antes de cualquier escritura en vivo.
14. Revisar primero si una funcionalidad ya existe (y cómo) antes de
    implementarla — buscar en el código, no asumir desde memoria ni desde
    un prompt anterior. No duplicar funciones/componentes ya existentes.
15. Comentarios/commits en español, consistente con el resto del proyecto.
    Commit solo después de pasar las pruebas correspondientes al cambio.
16. **Nunca aplicar una migración en Supabase de producción ni ejecutar
    `bash deploy/update.sh` en la VM sin que el usuario lo pida
    explícitamente en ese mismo turno** — "implementa esto" o "corrige
    esto" NO es autorización para migrar/desplegar; esperar un pedido
    explícito tipo "aplica la migración y despliega". Esto aplica incluso
    si ya se desplegó algo similar antes en la misma sesión.

## Validación por niveles

- **Nivel 1** (cambio cosmético/UI acotado): prueba localizada + comprobación
  visual.
- **Nivel 2** (cambio funcional de un módulo): pruebas del módulo + validación
  backend + comprobación en campo (pedir al usuario que lo pruebe si aplica).
- **Nivel 3** (cambio estructural/BD/multi-módulo): pruebas de integración +
  respaldo + revisión de riesgos + reversión preparada antes de aplicar.

Elige el nivel según el riesgo real del cambio, no automáticamente el más alto.

## Migración OLT — vínculo cliente/contrato/ONT (permanente)

SmartRayco está migrando gradualmente la administración desde SmartOLT y
registros anteriores — faltan ~400 abonados por registrar (2026-10-13).
Mientras dure esa migración, **toda sesión debe consultar esto antes de
tocar flujos de OLT, clientes o aprovisionamiento** — ver el caso real
documentado en `ESTADO_DESARROLLO.md` (Violeta García Silva / Clara
Caballero Valderrama / Mayco Paredes Rodríguez) para el precedente
completo.

**Tres situaciones posibles, permanentes mientras dure la migración:**

- **A — ONT online sin cliente/contrato en SmartRayco**: el abonado puede
  ser real y estar navegando normalmente; su info administrativa
  simplemente no se migró todavía. **Nunca asumir** que es una ONT
  abandonada, duplicada o disponible para eliminar.
- **B — Cliente y contrato registrados, pero sin ONT vinculada**: el
  abonado existe en SmartRayco, falta relacionar su ONT física. No
  implica necesariamente que esté sin servicio — verificar serial,
  posición, contrato y PPPoE antes de vincular.
- **C — Cliente, contrato y ONT correctamente vinculados**: igual hay que
  distinguir el estado real de la OLT del último `last_synced_at` de
  SmartRayco — no son lo mismo.

**Reglas permanentes:**

1. La OLT real es la referencia para serial, posición y estado físico
   — siempre que la consulta sea actual y verificable (no asumir desde
   una lectura vieja).
2. Supabase es la referencia para clientes, contratos y sus relaciones
   administrativas.
3. Nunca eliminar ni desautorizar una ONT solo porque aparece sin
   cliente vinculado (Situación A) — eliminar su fila en `olt_onts`
   también manda `no onu` a la OLT real y corta el servicio.
4. No duplicar clientes, contratos, usuarios PPPoE ni equipos durante
   la migración — buscar primero si ya existe (por nombre, documento,
   serial) antes de crear algo nuevo.
5. No reprovisionar una ONT que ya navega solo para completar
   información administrativa — vincular `client_id`/`contract_id` es
   una escritura de metadatos en Supabase, nunca requiere volver a
   autorizar/registrar en la OLT.
6. No sobrescribir nombres o descripciones administrativas sin
   comprobar su procedencia — un `description` puede venir de la OLT
   (texto libre, no confiable) o de una edición administrativa real.
   **Ya implementado**: "Importar ONTs desde la OLT" deja de pisar
   `description` en cuanto una ONT queda vinculada a un cliente **y el
   serial sigue siendo el mismo** — si el serial cambia en una posición
   ya vinculada (ONT reemplazada/trasladada), esa fila no se toca en
   absoluto y se reporta como conflicto para revisión manual, nunca se
   resuelve sola (ver `oltImportDescriptionGuard.ts` y 13ai/13aj en
   `ESTADO_DESARROLLO.md`) — si se toca ese import, mantener esa
   protección de 3 vías (sin vincular / vinculada mismo serial /
   conflicto), no volver a la versión que solo miraba la posición.
7. Mantener intactos los servicios existentes durante toda la
   migración — cualquier corrección se valida de solo lectura primero.
8. Si hay discrepancia entre lo que dice la OLT y lo que dice
   Supabase, **detener la operación y pedir verificación** — no
   adivinar cuál de las dos fuentes tiene razón.
9. Solo usamos 3 roles operativos reales: **SUPERADMIN, ADMIN y
   TECNICO_RED** — SOPORTE/FACTURACION no se usan; no desarrollar
   funcionalidades nuevas para ellos ni tocar sus políticas existentes.
10. **Ingresar un dato una sola vez, reutilizarlo en todos los módulos**
    — nunca pedir el mismo dato dos veces en formularios distintos si ya
    existe una fuente confiable (ver Fase 3 OLT, PON↔zona↔contrato↔App
    Campo, `ESTADO_DESARROLLO.md` 13ak-13am): `zones.name` codifica el
    número de PON oficial (`src/lib/ponZoneMapping.ts`); cada ONT se
    compara contra su cliente/contrato real por `contract_id`, nunca por
    nombre/posición (`src/lib/ontZoneDiscrepancy.ts`); al cerrar un
    traslado desde App Campo, la zona se deriva de la caja NAP que el
    técnico ya eligió en vez de pedírsela de nuevo, y la sincronización
    de NAP+zona de la ONT reutiliza SIEMPRE la transacción de Fase 158
    (`assign_contract_nap_sync_ont_zone`, ver `src/lib/ontZoneSync.ts`
    `canSyncOltZone`/`resolveClosureTargetZoneId`) — nunca una escritura
    paralela nueva. Ante una discrepancia entre fuentes, se informa (nunca
    se calla ni se adivina) y se deja para revisión humana — regla 8.

**"Traslado de servicio" en Rutinas (2026-10-13, ver `ESTADO_DESARROLLO.md`
13an-13ap)**: `routines.contract_id` (Fase 159) ya está aplicada en
Supabase producción — `routines` ahora identifica el contrato/servicio
EXACTO que se traslada (nunca por `client_id` solo). El selector de
contrato (`RutinasView.vue`), la sección de traslado en App Campo
(`CampoTrabajoDetailView.vue`) y el cierre vía Fase 158
(`campo.ts`/`ontZoneSync.ts`) están implementados y probados con pruebas
unitarias (`routineTraslado.ts`). El historial "anterior→nuevo" se
congela con el mismo mecanismo de borradores que `closureForm`
(`resolveTrasladoAnteriorSnapshot`) — **nunca recalcularlo desde
`activeContract` directo**, un reintento podría ya tener el contrato
mutado. **Todavía no se probó con un traslado real de punta a punta** ni
se desplegó — no declarar esta funcionalidad "terminada" ante el usuario
sin esa verificación real.

## Registro de errores de campo

Todo bug reportado desde campo (técnicos/administradores usando el sistema
real) se registra en `docs/ERRORES-CAMPO.md` — ver ese archivo por el
formato. Revisarlo antes de investigar un problema nuevo: puede que ya esté
documentado.
