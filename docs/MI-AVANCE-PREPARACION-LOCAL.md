# Mi Avance — entrega local para revisión (20/10/2026)

Política vigente posterior: ranking compartido entre técnicos autenticados,
anónimo bloqueado y detalle personal privado. Ver
[MI-AVANCE-PERMISOS-RANKING.md](MI-AVANCE-PERMISOS-RANKING.md). Las restricciones
anteriores al ranking de compañeros quedan sustituidas por esa autorización.

Actualización posterior: se completó el contraste READ ONLY de Supabase y el
ensayo de volumen, sin activación. Se corrigió únicamente en el candidato la ACL
heredada de anon y se añadió rollback que conserva privacidad. Resultado vigente:
[MI-AVANCE-VALIDACION-PREVIA.md](MI-AVANCE-VALIDACION-PREVIA.md). El resto de este
documento conserva el registro de la preparación inicial.

Estado: preparado y probado **solo en local**. Sin commit, push, despliegue,
conexión a producción ni modificación de datos reales. Los SQL se ejecutaron
únicamente en contenedores efímeros sin red con fixtures ficticios. No se agregó
ningún archivo a `supabase/migrations`.

## Resultado preparado

- Inicio del técnico: «Mi Avance» (Hoy/Semana/Mes), «Mi custodia» y «Mis órdenes».
  /soporte y /soporte/ranking redirigen a /campo únicamente para TECNICO_RED.
  El componente administrativo OperacionesHoyView.vue no se modificó.
- Períodos calculados por PostgreSQL, con el reloj del servidor y America/Lima:
  hoy desde medianoche, semana lunes a domingo y mes calendario; inicio incluido
  y fin excluido. Cada tarjeta muestra fechas. No se acepta reloj del cliente.
- Totales actuales redondeados a un decimal como el ranking, fecha de consulta
  y advertencia de posibles ajustes posteriores. El detalle muestra hasta cuatro
  decimales del reparto. No se crean estados de puntos ni reglas monetarias.
- Historial de aportes y descuentos de los períodos actuales; enlaces al trabajo
  original. Las tarjetas muestran su aporte si está en los períodos consultados.
  Para trabajos históricos anteriores, el detalle obtiene el aporte individual
  directamente del servidor, sin reconstruir puntuaciones en Vue.
- Consulta de custodia independiente en /campo/mi-custodia: producto, serie y
  MAC (ambos si existen), estado, cantidad y unidad original. Reutiliza
  technicianCustody.fetchMyCustody()/my_inventory_custody(). No inventa un modelo
  distinto del nombre de producto disponible. No contiene devoluciones ni otras
  mutaciones. El flujo anterior /campo/custodia se conserva.
- Carga/error/reintento/vacíos explícitos. Una respuesta tardía tras cambiar de
  usuario o desmontar la vista se descarta y se borran los datos personales.
  Asistencia permanece accesible en un bloque secundario; el bloqueo de almuerzo
  y los controles de inicio/cierre siguen usando sus implementaciones existentes.

## Una sola fuente de puntuación

SQL candidato: `docs/sql/mi-avance-candidate.sql` (fuera del directorio automático).
Extrae las selecciones y fórmulas de Fase 130 a la función interna
`technician_point_contributions(start,end)`. El ranking y las consultas personales
leen esa misma fuente. No hay fórmulas de puntos en frontend/backend TypeScript.

Conserva 10 por Alta completada; puntos manuales o 5/3 por categorías de ticket;
Rutinas completadas con puntos asignados o cero si NULL; reparto según todas las
filas actuales de job_assignees, con fallback a assigned_to solo sin cuadrilla;
penalización de 5 por ticket original con reincidencia imputable dentro de siete
días, repartida entre sus integrantes. Otras categorías de ticket aportan cero.
Sin cambios de estados computables, fechas de atribución, precedencia de fecha
resolved_at/closed_at, conteos, redondeo ni orden del ranking.

La función interna conserva la penalización como magnitud positiva, como la
fuente original; ranking y resumen la restan, y el historial la presenta negativa.
No se modifica el historial ni se guarda un nuevo saldo.

El ranking conserva sus límites mensuales dependientes de la zona de sesión
existente. Mi Avance fija Perú. **Pueden diferir cerca de medianoche si la sesión
del ranking no usa Perú**: no se corrigió silenciosamente el ranking. Las pruebas
demuestran equivalencia con el original en cada zona y equivalencia entre el mes
personal y el ranking original cuando este se consulta en Perú.

## Autorización y permisos

- `my_field_progress()` exige técnico activo y auth.uid(), sin parámetro de ID;
  devuelve solo contribuciones propias, sin nombres ni puntos de compañeros.
- `my_field_job_points(type,id)` aplica el mismo control y filtra al actor antes
  de devolver el aporte. IDs ajenos, inválidos o sin aporte devuelven NULL.
- Función interna sin EXECUTE para PUBLIC, anon, authenticated ni service_role.
  Solo funciones propietarias la invocan mediante SECURITY DEFINER y search_path
  fijo. Las RPC personales revocan PUBLIC/anon/service_role y conceden únicamente
  authenticated, con comprobación interna de rol activo.
- La RPC de ranking devuelve filas completas a ADMIN/SUPERADMIN/SOPORTE activos
  y al rol service_role del backend. Un técnico/cliente no recibe filas.
- La API /api/soporte/ranking-tecnicos rechaza TECNICO_RED antes de consultar con
  supabaseAdmin. ADMIN/SUPERADMIN/SOPORTE conservan su ruta y permisos previos.
- No hay tablas nuevas ni cambios a políticas RLS existentes. El aislamiento de
  las RPC SECURITY DEFINER se impone dentro de SQL; no depende de filtrar en Vue.

## Archivos de esta entrega

| Archivo | Cambio |
| --- | --- |
| docs/sql/mi-avance-candidate.sql | Candidato transaccional: fuente compartida, RPC personales y permiso de ranking |
| docs/sql/mi-avance-rollback.sql | Restauración transaccional de la definición anterior y eliminación de funciones nuevas |
| server/src/routes/soporte.ts | Cierra ranking global al técnico en API |
| src/router/index.ts | Inicio personal y ruta de custodia de consulta |
| src/components/campo/CampoLayout.vue | Acceso de custodia según rol, sin duplicarlo en inicio personal |
| src/components/campo/CampoAvance.vue | Resumen y detalle de aportes |
| src/components/campo/CampoJobPoints.vue | Aporte personal del trabajo, incluido histórico |
| src/views/campo/CampoDashboardView.vue | Organización móvil y puntos por orden |
| src/views/campo/CampoTrabajoDetailView.vue | Inserta panel de consulta; no cambia lógica operativa |
| src/views/campo/CampoMiCustodiaView.vue | Nueva custodia de solo lectura |
| src/composables/usePersonalRead.ts | Estados de lectura y descarte de respuestas de otra sesión |
| src/lib/fieldProgress.ts | Tipos y presentación, sin cálculo de puntuaciones |
| src/lib/__tests__/fieldProgress.test.ts | Estados, cambio de sesión, límites del historial |
| server/tests/fieldProgress.sql.test.ts | Equivalencia, períodos, permisos, reparto, reincidencias y rollback |
| scripts/tests/field-progress-browser.mjs | Navegador con fixtures y conexiones externas bloqueadas |
| docs/MI-AVANCE-NAVEGADOR-LOCAL.json | Evidencia de verificaciones visuales |
| docs/MI-AVANCE-MOVIL-LOCAL.png | Captura móvil ficticia de Mi Avance |
| docs/MI-AVANCE-CUSTODIA-LOCAL.png | Captura móvil ficticia de Mi custodia |
| ESTADO_DESARROLLO.md | Referencia a esta entrega local pendiente de revisión |

El diagnóstico anterior queda en docs/CAMPO-MOVIL-PUNTOS-DIAGNOSTICO.md.
Los cambios preexistentes en docs/DEVOLVER-RUTINAS.md,
docs/FASE162-DEADLOCK-CORREGIDO.md y demás archivos ajenos no se tocaron ni
incorporaron. No se creó ningún commit.

## Pruebas ejecutadas

- `node --import tsx --test server/tests/fieldProgress.sql.test.ts`: 12/12 PASS
  (11 escenarios y contenedor padre). Compara todas las columnas del ranking
  original frente al refactor en 12 meses × UTC/Perú/Tokio, con 1590 trabajos
  ficticios iniciales y casos adicionales. Cubre técnico ajeno, perfil inactivo,
  anon/cliente/administración/soporte/service_role, función interna privada,
  detalle antiguo, cero manual, NULL, tres integrantes, medianoche, semana que
  cruza año, reincidencia a siete días inclusive, exclusión posterior, ausencia
  de doble penalización, comparación mensual y rollback de prosrc byte a byte.
- `node --import tsx --test src/lib/__tests__/*.test.ts`: 361/361 PASS, incluidas
  tres pruebas nuevas. Comprueba lecturas personales sin datos obsoletos y mantiene
  cobertura de inventario/idempotencia/custodia/asistencia ya existente.
- `node --import tsx --test server/tests/technicianCustody.sql.test.ts server/tests/materialRejectionCorrection.sql.test.ts`:
  33/33 PASS. Suites existentes en Docker sin red, cubren custodia y rechazo/
  corrección/cierre compartidos en Alta/Avería/Rutina.
- `node node_modules/vue-tsc/bin/vue-tsc.js -b`: PASS.
- `node node_modules/vite/bin/vite.js build`: PASS.
- `node scripts/tests/field-progress-browser.mjs`: 12 verificaciones PASS,
  cero excepciones JS. Chrome headless con sesión/datos ficticios y red externa
  bloqueada; 360/390/1280 px y UA Android WebView con SmartRaycoApp/1.0.
  Comprueba navegación de técnico y ADMIN, puntos, estados de consulta,
  identificadores largos y ausencia de desbordamiento/acciones de devolución.
  La telemetría ya existente de la app es rechazada por el fixture; no se permite
  ejecutar mutaciones operativas. **No equivale a una prueba en APK física**.
- `git diff --check`: sin errores.

## Riesgos y pasos previos a cualquier activación

1. Comparar en lectura la función y ACL realmente instaladas. El candidato tiene
   guarda MD5 de prosrc de la Fase 130 versionada; se detiene ante diferencias.
   Revisar también tipos de columnas, propietario, grants de esquema/función y
   default privileges para service_role. No se leyó producción en esta sesión.
2. Medir plan y tiempo en staging representativo: la fuente calcula la cuadrilla
   completa antes de filtrar al técnico para conservar el divisor; el historial
   del resumen incluye el mes/semana actuales completos, sin paginar. El detalle
   de un trabajo limita la búsqueda a su instante de cierre.
3. Revisar y aceptar la diferencia de calendario respecto al ranking antes de
   comparar cifras a medianoche. El SQL no cambia la zona ni las cifras del
   ranking administrativo existente.
4. Datos actuales, no fotografía histórica: reasignaciones, puntos manuales y
   reincidencias posteriores pueden cambiar aportes. Esto ya ocurre en origen.
5. Revisión conjunta del diff de esta entrega, preflight y respaldo de definiciones
   y permisos; decidir secuencia coordinada de SQL/API/frontend. Sin RPC nuevas,
   la interfaz muestra error de consulta, nunca un cero inventado.
6. Probar APK/WebView real y conectividad intermitente, dos cuentas de técnico
   para aislamiento, administración y un piloto supervisado contrastando con el
   ranking y custodia reales. Continúan pendientes las verificaciones visuales
   de Fase 165 registradas previamente; esta entrega no las da por cerradas.

No se incluyen herramientas de activación ni se ejecutará un SQL de producción
sin una autorización posterior explícita.

## Rollback

Para revisión: `docs/sql/mi-avance-rollback.sql`. Comprueba el MD5 de la nueva
definición del ranking antes de proceder; elimina las dos RPC personales,
restaura exactamente el cuerpo previo del ranking y elimina la función interna,
todo en transacción. Probado que recupera el MD5 original. No toca filas de datos.

Revertir únicamente los archivos frontend/API de esta entrega desde el artefacto
previo aprobado, sin resetear el árbol compartido ni tocar cambios ajenos.
**El rollback SQL restaura también el comportamiento anterior de exposición por
RPC directa**: conserva las ACL previas y elimina el filtro interno. No ejecutar
automáticamente: ante un incidente valorar mantener la corrección de privacidad
y retirar solo la pantalla nueva. Registrar esa decisión en la ventana autorizada.
