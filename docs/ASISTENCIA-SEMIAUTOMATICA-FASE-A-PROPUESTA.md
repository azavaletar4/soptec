# Asistencia semiautomática — Fase A, diagnóstico y propuesta

## Estado vigente — A2 implementada LOCALMENTE (26/10/2026)

A0/A1 (sección siguiente) quedaron **cerradas y validadas en producción**;
el propietario autorizó el push de esa rama a GitHub. A2 — vacaciones por
rango, descansos programados, permisos por horas y medias jornadas — está
**implementada LOCALMENTE** en `feature/asistencia-a2-local`, siguiendo
exactamente el diseño ya anticipado en la sección "A2. Vacaciones, permisos
parciales y descansos programados" más abajo (SUPERADMIN programa y aprueba
en un solo paso, sin "pendiente"; ADMIN/TECNICO_RED solo consultan). Sin
migrar a Supabase ni desplegar — pendiente autorización explícita separada.
Detalle completo (modelo de datos, RPC, integración con Control de
Asistencia/App de Campo, límite conocido de "media jornada" con la
arquitectura actual de una sola marca por día, y las 13 SQL + 5 navegador +
unitarias que pasan) en `ESTADO_DESARROLLO.md`, sección "Asistencia A2" —
no se repite aquí para no duplicar.

## Estado vigente — A0 + A1 implementadas LOCALMENTE (26/10/2026)

Autorización del propietario: implementar A0/A1, preparar migración y pruebas,
crear commit local **sin push**, sin aplicar SQL ni desplegar. A2 y A3 no iniciadas.
Este estado prevalece sobre el diagnóstico original conservado más abajo.

### Verificación puntual de acceso y ajuste local posterior

Código verificado: `src/router/index.ts` permite ADMIN y SUPERADMIN en `/campo`
mediante `meta.roles`; el guard global aplica esa lista. Su inicio habitual es
Dashboard del panel, mientras TECNICO_RED se redirige a Campo. No se modifican
estas rutas ni se obliga a ADMIN a entrar a Campo.

En `src/components/layout/AppLayout.vue`, el botón «Marcar asistencia» abre
«Mi asistencia» y monta el mismo `AsistenciaPanel.vue` que usa Campo. Por ello
ADMIN **ya podía marcar y reportar ausencias desde el panel web con A1**.
Se limita la altura del cuerpo del modal y se habilita desplazamiento para
mantener accesibles las marcaciones y el historial personal de solicitudes.

**Regla vigente aclarada por el propietario:** SUPERADMIN no tiene horario laboral
ni está sujeto al control de asistencia. Gestiona configuración y aprueba/rechaza,
pero no marca ni reporta ausencia personal. La habilitación local de su reporte
en la revisión anterior queda sustituida por esta exención antes de cualquier
despliegue; nunca se aplicó a producción.

La configuración existente es global (horarios, tolerancias, geocerca y feriados),
sin opción de exención por rol. Se requiere un ajuste mínimo de código y de la
migración local pendiente; no una nueva configuración, tabla, ruta o flujo:

- Widget compartido: SUPERADMIN muestra aviso de exención, sin acciones de marcar
  ni reportar; el panel web oculta su botón personal. ADMIN conserva ambas acciones
  desde el panel y TECNICO_RED desde Campo. Gestión SUPERADMIN permanece intacta.
- Reportes: SUPERADMIN se excluye de filas del tablero, agregados diarios y
  reporte mensual/CSV; no aparece como «Sin marcar», ni suma faltas o tardanzas.
  El resumen RPC también excluye sus eventuales solicitudes previas de indicadores.
- Backend/RPC: `reportar_ausencia_hoy` admite solo ADMIN/TECNICO_RED. El trigger
  compartido de escritura de marcaciones excluye SUPERADMIN, por lo que sus RPC
  tampoco pueden crear/modificar marcas. Mantiene permiso de lectura y de gestión;
  RLS de configuración/resolución continúa exclusiva de SUPERADMIN.
- No se borran ni recalculan filas históricas, ni se ponen tardanzas previas a cero.
  Permanecen consultables mediante la lectura existente de PostgreSQL/RLS; se
  excluyen de indicadores laborales, sin crear otra pantalla de historial.

Comprobación backend: asistencia se escribe mediante los RPC de PostgreSQL
existentes, no mediante endpoints Node nuevos. `current_user_role()` consulta
perfil activo; el reporte deriva el usuario de la sesión y permanece pendiente.
Las marcaciones siguen con los cuatro RPC existentes, sin crear registros de
ingreso por reportar ausencia. Sin aplicación de SQL ni comprobaciones productivas.

Pruebas puntuales actualizadas para la exención: SUPERADMIN sin acciones personales
en navegador, RPC que rechazan sus escrituras, preservación literal de marcas
ficticias previas (incluida tardanza), lectura conservada y exclusión del resumen.
Se conservan las pruebas ADMIN/técnico y de gestión SUPERADMIN. Resultado:
**17/17 SQL, 7/7 navegador y 11/11 unitarias PASS**. No se crea otro flujo ni se
duplican registros. No se repiten auditorías generales.

### Implementación A0/A1

- **A0:** RLS limita cambios de `company_settings` y `feriados` a SUPERADMIN;
  un trigger valida también al actor y audita valores anteriores/nuevos.
  ADMIN mantiene consulta (configuración deshabilitada para edición) y marcación;
  TECNICO_RED mantiene el widget de Campo. Se revoca ejecución anónima de los
  cuatro RPC de marcación, sin cambiar sus cálculos. Trigger protege marcaciones
  históricas, identidad/fecha y borrados, incluso cascadas. No se actualiza ningún
  registro existente al aplicar la migración. Feriados pasados quedan protegidos.
- **A1:** `AusenciasPanel.vue` se integra en el widget compartido de Campo/panel
  y en Control de Asistencia como bandeja SUPERADMIN. ADMIN/TECNICO_RED reportan
  solo su ausencia de hoy (fecha servidor America/Lima), motivos enumerados y
  observación opcional de hasta 1.000 caracteres. Estado inicial independiente:
  **Pendiente de justificar**. La identidad se deriva de `auth.uid()`.
- RPC de reporte idempotente por UUID; mismo UUID con datos distintos se rechaza.
  Índice único parcial impide dos solicitudes pendientes/aprobadas por persona/día.
  Un rechazo se conserva y permite volver a reportar ese mismo día con nueva
  operación. Resumen toma el último estado por persona/día, sin faltas duplicadas.
- Resolución exclusiva de SUPERADMIN con motivo obligatorio, bloqueo transaccional
  y versión esperada; decisión concurrente perdedora devuelve conflicto (`40001`).
  Eventos de creación y resolución se insertan en la misma transacción. No hay
  escritura REST directa para trabajadores, administradores ni SUPERADMIN.
- Aprobar ausencia completa con ingreso existente se rechaza. Marcar después de
  una aprobación sigue permitido: conserva ambos hechos y muestra coincidencia
  para revisión. No se implementaron permisos parciales ni ajustes de marcaciones.
- RLS permite ver solicitudes propias o todas a SUPERADMIN. ADMIN ve en tablero
  solo resumen de estado de compañeros, **sin motivos/observaciones privados**.
  Listas paginadas, filtros de bandeja y actualización manual. No hay nuevo sistema
  de notificaciones ni publicación Realtime de solicitudes en A1.
- Tablero y reporte/CSV distinguen pendientes, justificadas y rechazadas.
  Pendiente/justificada sin ingreso se separa de las faltas; rechazo computa como
  falta solo en día laborable pasado sin ingreso, una vez. SUPERADMIN y otros roles
  no obligatorios no generan faltas automáticas. Ingresos/tardanzas/refrigerio
  mantienen los hechos originales. Resúmenes paginados no se aceptan si falla una
  página; reporte no se presenta como completo ante error de carga.
- Fechas y visualización de horas usan Perú; calendario de fechas usa UTC sin
  depender del huso del navegador. Reporte mensual de marcaciones se pagina para
  evitar truncamiento REST. No se llama a MikroTik, OLT ni otros módulos.

### Archivos y migración necesarios

- `supabase/migrations/20261027010000_asistencia_a0_a1.sql`: políticas, tres tablas
  (`asistencia_solicitudes`, `asistencia_solicitud_eventos`, `asistencia_config_eventos`),
  índices, RPC, permisos y triggers. **Preparada y probada solo en PostgreSQL local**.
- `src/components/asistencia/AusenciasPanel.vue`, integración en
  `AsistenciaPanel.vue` y `src/views/asistencia/AsistenciaView.vue`.
- `src/lib/asistenciaAusencias.ts`, `src/lib/asistenciaReglas.ts` y
  `src/stores/asistencia.ts`. Se reutiliza Supabase/RPC como backend existente;
  no se crean endpoints Node ni se reconstruye otro módulo.
- Pruebas: `server/tests/asistenciaA0A1.test.cjs`,
  `server/tests/asistenciaA0A1.browser.test.cjs`, su HTML ficticio en
  `server/tests/fixtures/asistencia-a0-a1.html`,
  `src/lib/__tests__/asistenciaAusencias.test.ts` y regresión existente
  `src/lib/__tests__/asistenciaReglas.test.ts`.

### Validación local y pendientes

Resultado vigente: **17/17 SQL, 7/7 navegador y 11/11 unitarias PASS** tras la
exención SUPERADMIN (conserva casos anteriores y añade comprobación de exención).
El conteo de Node incluye los contenedores de suite.
`npm run build` PASS (vue-tsc + Vite); `git diff --check` PASS.
Vite conserva aviso de chunks grandes de librerías existentes; no se rediseñan
ni reconstruyen módulos ajenos para resolver ese aviso.

Pruebas reproducibles desde el worktree aislado:

```text
node --test server/tests/asistenciaA0A1.test.cjs
node --test server/tests/asistenciaA0A1.browser.test.cjs
node --import tsx --test src/lib/__tests__/asistenciaAusencias.test.ts src/lib/__tests__/asistenciaReglas.test.ts
npm run build
```

SQL usa PostgreSQL 17 efímero, sin red ni volumen productivo: permisos/RLS,
anónimo/inactivo/cliente, reporte ADMIN/técnico, idempotencia, duplicados,
aprobación/rechazo, dos conexiones concurrentes, privacidad, 550 colaboradores
ficticios paginados, preservación literal del historial y conflicto con ingreso.
Navegador: Chrome local sin ventana; toda petición de negocio se intercepta,
Supabase ficticio `attendance.invalid`, sin credenciales productivas. Comprueba
reporte/reintento, estado ADMIN y aprobación/rechazo SUPERADMIN. Unitarias cubren
Perú/medianoche, fechas calendario, faltas y regresión de puntos GPS.

Pendiente: revisión del propietario, autorización separada para aplicar migración
y desplegar selectivamente, y aceptación funcional con usuarios autorizados después.
Para un futuro despliegue debe aplicarse primero SQL y luego frontend; todavía no
se ha preparado imagen ni intervenido producción. Un rollback futuro del frontend
no debe reabrir permisos ADMIN ni borrar solicitudes/eventos ya generados.

Riesgos/límites: reporte mensual conserva el calendario global existente y usa los
perfiles actuales; no reconstruye altas/bajas o cambios históricos de rol. No se
implementan calendarios individuales, vacaciones, descansos, medios días ni A2/A3.
El trigger de historial hará fallar un borrado futuro de perfil que intente borrar
marcaciones en cascada; se debe conservar/desactivar el perfil. La prueba de 550
colaboradores valida paginación como prueba sintética de regresión, no representa
la dotación prevista. **Control de Asistencia tendrá como máximo 30 usuarios
internos.** La meta de **al menos 3.000 clientes y contratos del ISP** corresponde
al negocio ISP, no a trabajadores ni usuarios de asistencia; no es un requisito
de capacidad ni una certificación pendiente de A0/A1. Se mantienen las pruebas
aprobadas, sin repetir auditorías ni pruebas de 3.000 usuarios de asistencia.
La referencia no introdujo límites ni estructuras para 3.000 trabajadores;
se incorporaron paginación de consultas/reportes y la prueba sintética de 550
colaboradores para comprobar integridad de resultados. Se conservan como
protecciones de lectura, sin exigir ese volumen de personal.
Versiones productivas conservadas: frontend `c11f6a8`, backend
`16831c6`; devoluciones y equipos seriados siguen cerrados operativamente.

## Antecedente: diagnóstico y propuesta inicial, anterior a esta implementación

26/10/2026. **Estado en aquel momento: solo propuesta, no implementada.** Revisión
focalizada de Asistencia y sus entradas en Campo/panel. Catálogo consultado
con transacción READ ONLY: sin marcaciones personales, GPS ni datos reales
de colaboradores. No se ejecutaron pruebas, escrituras ni migraciones.

## Reglas confirmadas por el propietario

- `TECNICO_RED` y `ADMIN` deben marcar asistencia. Ambos pueden reportar su
  ausencia del mismo día sin autorización previa. Reportar no aprueba:
  estado visible **Pendiente de justificar**.
- Solo `SUPERADMIN` recibe la bandeja de resolución y aprueba/rechaza; solo
  ese rol configura horarios, descansos, vacaciones y reglas de asistencia.
- SUPERADMIN puede programar directamente vacaciones por rangos, descansos
  compensatorios y medios días. Descanso aprobado no produce falta/tardanza.
- Intercambio de descanso: vínculo explícito entre día libre y día trabajado.
- No alterar ni eliminar marcaciones históricas. Separar hechos de marcación
  y resoluciones de justificación. Mantener los módulos cerrados intactos.

## Qué existe y se puede reutilizar

| Pieza | Ubicación | Uso actual y reutilización |
|---|---|---|
| Marcación compartida | `src/components/asistencia/AsistenciaPanel.vue` | Ingreso, inicio/fin de almuerzo, salida, GPS, confirmación y errores. Añadir aquí la acción personal, sin duplicar formularios entre Campo y ADMIN. |
| Entrada del técnico | `src/views/campo/CampoDashboardView.vue` | Panel dentro de «Asistencia y accesos secundarios»; mantenerlo y hacer visible «Reportar ausencia» sin exigir una marcación previa. |
| Entrada ADMIN | `src/components/layout/AppLayout.vue` | Modal «Mi asistencia» con el mismo componente. ADMIN puede reportar sin obtener privilegios de configuración/aprobación. |
| Control | `src/views/asistencia/AsistenciaView.vue`, `src/router/index.ts` | `/asistencia` admite ADMIN/SUPERADMIN. Tablero, mensual, CSV, GPS, configuración y feriados. Reutilizar; no crear otra pantalla general. |
| Cliente de datos | `src/stores/asistencia.ts` | Supabase directo y RPC; lecturas del día/rango y suscripción de marcaciones. No hay endpoint Node de asistencia que deba duplicarse. |
| Marcaciones | `public.asistencia_registros` | Una fila por persona/día, UNIQUE(user_id,fecha), timestamps/GPS/minutos/estado. Conservar intactos los hechos históricos. |
| Configuración | `public.company_settings` | Singleton de geocerca, horarios lunes/resto, tolerancia y almuerzo. No representa horarios personales ni tiene vigencias históricas. |
| Calendario general | `public.feriados` | Días globales, no vacaciones o descansos individuales. No usar un feriado global para justificar a una persona. |
| Fechas y presentación | `src/lib/asistenciaReglas.ts`, `src/types/domain.ts` | Helpers Lima, tipos y presentación. Ampliar sin convertir la solicitud en un estado crudo de marcación. |
| Validación vigente | Fase 117/135 y `src/lib/__tests__/asistenciaReglas.test.ts` | Referencias de esquema/RLS y pruebas GPS existentes; no cubren solicitudes, permisos ni solapamientos. |

RPC actuales, invocadas desde `supabase.rpc()`:

- `mark_attendance_ingreso(numeric,numeric)`;
- `mark_attendance_inicio_almuerzo()`;
- `mark_attendance_fin_almuerzo(numeric,numeric)`;
- `mark_attendance_salida(numeric,numeric)`.

Las cuatro son SECURITY DEFINER, usan la fecha del servidor en America/Lima
y escriben únicamente la fila propia del día. No son solicitudes de permiso.
Los endpoints existentes son REST de Supabase sobre las tres tablas y esas
RPC; no se identificó `/api/asistencia` en `server/src/index.ts`.

## Diferencias reales respecto a las reglas nuevas

1. **Permisos de configuración:** RLS vigente de `company_settings` admite
   UPDATE de ADMIN/SUPERADMIN; `feriados` admite escritura de ambos. La vista
   muestra Configuración sin distinguirlos. Cambiar solo la interfaz no basta.
2. **Sin solicitudes:** en el código y búsqueda acotada del catálogo no se
   localizaron solicitudes de ausencia, vacaciones/descansos personales,
   resolución o bitácora de decisiones de asistencia.
3. **Faltas derivadas en el navegador:** tablero y mensual consideran días
   lunes-sábado sin feriado y ausencia de ingreso. No consultan justificaciones.
   El mensual puede contar hoy como falta antes de terminar el día, aunque el
   tablero evita hacerlo; debe unificarse el criterio.
4. **Población:** `catalogs.fetchStaff()` incluye todo perfil activo no CLIENTE;
   el reporte no limita obligación a TECNICO_RED/ADMIN. No asignar faltas a
   SUPERADMIN por reutilizar esa lista sin filtrar.
5. **Permisos RPC:** el catálogo concede EXECUTE a `authenticated` y `anon`
   para las cuatro marcaciones. Sus cuerpos no comprueban explícitamente
   perfil activo/rol. Esto no demuestra escritura anónima exitosa — falta
   `auth.uid()` y la tabla exige usuario — pero debe cerrarse al diseñar las
   nuevas funciones, sin confiar en botones o JWT de rol declarado por cliente.
6. **Historial:** RLS de registros solo permite SELECT propio o staff de
   despacho (SUPERADMIN/ADMIN/SOPORTE); sin escritura directa. Sin embargo,
   su FK a profiles tiene ON DELETE CASCADE: la preservación histórica también
   exige impedir el borrado de perfiles que arrastre marcaciones.
7. **Domingos:** ingreso rechaza domingo/feriado y el componente oculta la
   marcación esos días. No sirve aún para un intercambio que programe trabajo
   en domingo; necesitará el calendario personal de una etapa posterior.
8. **Zona horaria:** servidor usa Lima, pero `formatHora()` no fija timeZone
   y el recorrido mensual mezcla medianoche local con `toISOString()`.
   Puede variar en celulares configurados fuera de Perú.

Las políticas antiguas de SOPORTE/FACTURACION no se amplían ni se crean
funciones nuevas para esos roles. Los motivos privados de ausencias no deben
heredar la lectura amplia del tablero/GPS.

## Implementación mínima por etapas

### A0. Alinear autorización y preservar historial

Parte necesaria de la primera entrega, sin rediseñar Control de Asistencia:

- Mantener `/asistencia` y su consulta existente; solo SUPERADMIN ve y ejecuta
  configuración de horarios/feriados. Sustituir escrituras RLS ADMIN por
  SUPERADMIN; conservar las políticas SELECT. Para feriados separar escritura
  de lectura: no eliminar accidentalmente la política que deja leerlos al staff.
- Validar en cada nueva RPC `auth.uid()`, perfil vigente activo y rol real;
  revocar ejecución anónima/PUBLIC y denegar escrituras directas por RLS.
  Revisar las cuatro marcaciones existentes para incorporar validación de
  sesión activa sin bloquear los usuarios legítimos que ya marcan.
- No borrar registros ni perfiles con marcaciones, ni reescribir fechas,
  GPS, minutos o estados de días pasados. Preparar protección de historial
  frente a UPDATE/DELETE y cascadas; transiciones normales del día actual
  siguen disponibles. Nuevas referencias de solicitudes/auditoría usarán
  RESTRICT, no CASCADE. No eliminar perfiles para desactivar usuarios.
- No permitir que una edición/borrado de feriado pasado altere silenciosamente
  faltas históricas. En esta primera etapa, calendario nuevo con efecto futuro;
  rectificaciones retroactivas requieren resolución auditada, no edición libre.

### A1. Reportar ausencia de hoy y resolverla

**Alcance inicial:** ausencia de jornada completa de la fecha de Perú actual.
No incluir todavía formularios de vacaciones, medios días o intercambios.

**Modelo propuesto, todavía no creado:**

- `asistencia_solicitudes`: UUID de operación/solicitud idempotente, `user_id`,
  `fecha`, tipo ausencia, motivo, estado pendiente/aprobada/rechazada,
  `created_at`, `resolved_at`, `resolved_by`, motivo de decisión y versión.
  El servidor fija solicitante, fecha, timestamps y estado inicial. El UUID
  identifica el mismo envío, no permite cambiar su autor o contenido al repetirlo.
- `asistencia_solicitud_eventos`: bitácora append-only de creación y resolución,
  con solicitud, actor, rol al actuar, instante, estado anterior/nuevo y motivo.
  Solo las RPC insertan eventos, dentro de la misma transacción. No editar
  ni borrar decisiones: una futura rectificación será otro evento explícito.
- Índice por solicitante/fecha y por estado/fecha; unicidad de solicitud activa
  por usuario/día (pendiente o aprobada). Una solicitud rechazada se conserva;
  un nuevo reporte del mismo día puede crear una nueva solicitud, sin duplicar
  las pendientes. No usar la fila de marcación como contenedor de solicitudes.

**Contrato de servidor propuesto:**

- `reportar_ausencia_hoy(p_operacion_id, p_fecha_esperada, p_motivo)`:
  TECNICO_RED/ADMIN activos, exclusivamente su propia ausencia; fecha esperada
  debe coincidir con `(now() at time zone 'America/Lima')::date`. Motivo no
  vacío y acotado. No exige autorización previa, GPS ni ingreso. Devuelve recibo
  con estado **Pendiente de justificar**, nunca aprobado.
- `resolver_ausencia(p_solicitud_id, p_version_esperada, p_decision, p_motivo)`:
  únicamente SUPERADMIN activo. Bloquea la solicitud FOR UPDATE y comprueba
  que sigue pendiente. Una resolución simultánea/repetida no duplica eventos
  ni cambia una decisión ya registrada. No acepta autor/rol/fecha de decisión
  suministrados por el cliente.
- Listado personal y bandeja paginada de SUPERADMIN. La bandeja es la recepción
  durable de la solicitud; no depende de correo/push ni requiere infraestructura
  de notificaciones nueva. Refresco al abrir y manual; actualización automática
  puede reutilizar el patrón existente, sin ser condición de la aprobación.
- RLS SELECT de solicitudes/eventos: autor o SUPERADMIN, no ADMIN de terceros.
  ADMIN solo conserva la consulta operativa del tablero actual; si necesita
  ver un indicador de ausencia ajena, recibirlo en un DTO resumido autorizado,
  sin motivo privado, adjuntos ni decisiones completas.

**Interfaz reutilizada:**

- En `AsistenciaPanel`: «Reportar ausencia de hoy», motivo y fecha Lima,
  confirmación, estado de envío y resultado persistido; accesible tanto a
  técnico como ADMIN. No esconderlo por domingo sin consultar calendario:
  informar si ya es no laborable; no crear una solicitud aprobada automática.
- En `/asistencia`, bandeja «Ausencias pendientes» y Aprobar/Rechazar solo
  SUPERADMIN. El ADMIN no puede autoaprobar su reporte ni configurar reglas.
- «Pendiente de justificar» pertenece a la justificación, no al enum
  `asistencia_estado` ni al estado de jornada En Almuerzo/Finalizado.
- Reportar no suspende automáticamente la obligación de marcar ni bloquea
  una marcación posterior. No impedir registrar la presencia real para hacer
  coincidir una solicitud de ausencia.

**Conflicto con marcación:** si hay ingreso real no aprobar silenciosamente
una ausencia de jornada completa; marcar conflicto para SUPERADMIN. Resolver
sin borrar marcaciones, o usar un permiso parcial cuando A2 exista. Una
marcación posterior a una aprobación también debe conservarse y señalar la
contradicción. Compartir el criterio de conciliación/serialización por usuario
y fecha entre resolución y marcación; releer dentro de la transacción para no
aprobar sobre un snapshot antiguo. No convertir una tardanza real en dato falso.

### A1. Reporte derivado común y criterios de aceptación

Preparar una consulta/resolvedor servidor para el estado justificado por fecha
y persona, separado de los hechos originales. Reutilizarla en tablero y mensual,
no añadir parches de exclusión distintos en cada vista. Contrato tentativo:
`asistencia_resumen(p_desde, p_hasta, p_cursor)`, paginado, con ámbito propio
para técnico y visibilidad operativa ya autorizada para ADMIN/SUPERADMIN.
No devolver motivos privados en el resumen general.

Precedencia mínima:

| Situación | Presentación/cómputo |
|---|---|
| Día actual sin marcar | Sin marcar; no falta final anticipada |
| Ausencia pendiente sin ingreso | Pendiente de justificar; no aprobar ni esconderla bajo «descanso» |
| Ausencia aprobada sin ingreso | Ausencia justificada, sin falta ni tardanza computable |
| Rechazada, día laborable cerrado sin ingreso | Falta/sin justificar, conservando resolución |
| Descanso/vacaciones aprobados (A2) | Día/segmento exento de falta y tardanza |
| Hay marcación y solicitud contradictoria | Conservar marcación y advertir conflicto; revisión explícita |

El hecho de ingreso tardío puede seguir almacenado; una exención aprobada
solo cambia el cómputo derivado del segmento cubierto, no su timestamp/minutos.
Historial de resoluciones permite explicar por qué cambió un reporte al aprobar
una justificación; exportar fecha de emisión y estado/instante de decisión.
No recalcular en masa ni sobrescribir marcaciones antiguas al instalar.

Pruebas de implementación, solo futuras y aisladas:

1. Técnico/ADMIN crean reporte propio de hoy sin autorización; siempre pendiente.
2. Sin sesión, perfil inactivo, otro usuario o rol no autorizado: rechazo servidor.
3. ADMIN no aprueba ni configura mediante REST/RPC manipulado; SUPERADMIN sí.
4. Dos sesiones/reintento con igual UUID: un reporte; contenido distinto con
   mismo UUID: rechazo; dos decisiones concurrentes: una sola resolución.
5. Medianoche Lima, dispositivo en otra zona y envío offline de día anterior:
   fecha inequívoca, sin registrar silenciosamente en un día distinto.
6. Ausencia con marcación concurrente, posterior o parcial: señalada; hechos intactos.
7. RLS impide leer motivos ajenos; sin INSERT/UPDATE/DELETE directo.
8. Snapshot de marcaciones antiguas, GPS y métricas idéntico antes/después
   de solicitar, resolver, instalar o revertir la funcionalidad.
9. Tablero, mensual y CSV coinciden; no contar SUPERADMIN como obligado por
   defecto, ni días futuros/hoy incompleto como faltas cerradas.

### A2. Vacaciones, permisos parciales y descansos programados

Solo tras completar A1. Reutilizar resolución, bitácora y calendario derivado;
añadir una programación personal con inicio/fin y tipo. SUPERADMIN puede
crearla directamente con origen «programación SUPERADMIN», sin simular una
solicitud del empleado ni pasar por pendiente. Solicitudes futuras del
empleado, si se incorporan, usarán el mismo procedimiento de aprobación.

- Rangos inclusivos de vacaciones, convertidos a intervalos inequívocos;
  medios días como segmentos mañana/tarde del horario aplicable, sin fijar
  arbitrariamente cuatro horas para todas las jornadas.
- Intervalos aprobados no solapados por empleado; una pendiente no concede
  descanso y tampoco reserva/consume automáticamente otro rango. Bloqueo o
  restricción de concurrencia y revalidación al aprobar, no solo validación Vue.
- Jornada personal efectiva por fecha como única fuente para mostrar marcación,
  calcular obligación y resolver exenciones. No reutilizar `feriados` globales.
- Horarios/reglas con vigencia para no reinterpretar días pasados usando la
  tolerancia o descanso vigente hoy. Preservar decisiones y fechas de efecto.

### A3. Intercambio de descanso

Vincular en un único registro/operación el día exento y el día trabajado de
la misma persona. Aprobar/invalidar la pareja atómicamente y auditar ambos;
impedir usar el mismo día trabajado en múltiples compensaciones.
El día trabajado no se inventa como marcación: se debe registrar realmente.
La jornada personal debe permitir marcar el domingo/feriado programado y
eximir el día libre. No activar intercambios mientras solo exista el veto
global de domingo de las RPC actuales.

## Archivos concretos para implementar después de autorizar

Existentes:

- `src/components/asistencia/AsistenciaPanel.vue`: entrada personal compartida.
- `src/views/asistencia/AsistenciaView.vue`: bandeja, permisos y resumen/CSV.
- `src/stores/asistencia.ts`: RPC/listados; no mutaciones directas de solicitudes.
- `src/lib/asistenciaReglas.ts`: estados derivados/fechas y hora siempre Lima.
- `src/types/domain.ts`: tipos de solicitud/decisión/DTO, sin alterar el enum de marcas.
- `src/components/layout/AppLayout.vue` y `src/views/campo/CampoDashboardView.vue`:
  verificar entradas existentes; cambiar solo si es necesario para visibilidad.
- `src/router/index.ts`: mantener ruta; no crear un módulo paralelo.
- `src/lib/__tests__/asistenciaReglas.test.ts`: regresión de calendario/presentación.

Nuevos previstos, **no creados** en esta propuesta:

- Una migración aditiva en `supabase/migrations/` con solicitudes, bitácora,
  constraints, RLS/RPC, permisos SUPERADMIN y protección histórica acordada.
  Fase 117/135 se conservan como historia; no editar esas migraciones aplicadas.
- `server/tests/asistenciaSolicitudes.sql.test.ts`: PostgreSQL aislado por roles
  y concurrencia; `src/lib/__tests__/asistenciaSolicitudes.test.ts` y una
  prueba focalizada de navegador. Puede añadirse un componente de formulario
  si mantiene el uso compartido; no es necesaria una vista/ruta adicional.

No se necesita un endpoint Node nuevo para A1: la regla backend reside en las
RPC y RLS de Supabase, siguiendo el patrón de marcación actual. Si se añadiera
posteriormente una API Node, mantener JWT de sesión y volver a validar en DB;
una guarda de Vue o un filtro de menú no sustituye permisos de servidor.

## Riesgos y decisiones de implementación

- Duplicados por doble clic, dos dispositivos y confirmación perdida: UUID,
  recibo y unicidad transaccional; interfaz no promete éxito sin confirmación.
- Solapamientos: no conceder dos exenciones superpuestas ni vacaciones y
  compensación sobre el mismo segmento. Resolver explícitamente, sin fusionar
  o eliminar solicitudes históricas automáticamente.
- Retroactividad: reporte inicial solo de hoy; SUPERADMIN puede resolverlo
  después, conservando cuándo ocurrió y cuándo se decidió. Si se rectifica
  un período cerrado, hacerlo como resolución auditable, nunca por edición de marcas.
- Conflictos de presencia: distinguir una ausencia total de salida anticipada
  o permiso parcial; A1 no simula medios días que todavía no modela.
- Reporte mensual actual depende de perfiles activos actuales y feriados sin
  vigencia. No deducir faltas previas al ingreso del colaborador ni cambiar
  obligación histórica al cambiarle hoy el rol; preparar elegibilidad efectiva
  por fecha en el resolvedor, sin alterar registros de marcación.
- Escala: lecturas de solicitudes y mensual paginadas por fecha/usuario, con
  índices y sin una consulta por colaborador/día. Capacidad aclarada por el
  propietario: máximo 30 usuarios internos de asistencia. La meta de 3.000
  clientes y contratos es del ISP; no exige 3.000 trabajadores ni pruebas de
  ese volumen para asistencia. Se conservan las pruebas ya aprobadas.
- Rollback futuro: desactivar entradas y RPC nuevas de escritura conservando
  solicitudes/eventos; no DROP de evidencias ni restauración destructiva de tablas.

## Qué se hizo, qué falta y desvíos

Se revisaron exclusivamente fuentes, entradas de Campo y metadatos de
Asistencia. La lectura real confirmó tablas/RLS/RPC; no se consultaron filas
de asistencia ni usuarios reales. No se repitieron auditorías generales ni
pruebas operativas.

Falta autorizar e implementar A0+A1, sus pruebas aisladas y posteriormente
una preparación productiva independiente. A2/A3 quedan definidos para evitar
que el primer reporte de ausencia se convierta en un rediseño completo.
Sin código funcional, datos, migración, despliegue, commit ni push en esta
sesión; únicamente propuesta y nota de continuidad local. Sin desvíos de alcance.
