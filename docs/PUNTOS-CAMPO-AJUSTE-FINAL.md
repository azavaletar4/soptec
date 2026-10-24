# Puntos y firma en Campo — continuación de 506b35a

Entrega local del 24/10/2026. No se repite la obligatoriedad de creación.
Sin migraciones en producción, órdenes reales modificadas, push ni despliegue.
Se conserva el trabajo previo ajeno a este alcance en el árbol local.

## Límite encontrado: cierre administrativo

Se revisaron vistas, stores, funciones de puntuación y metadatos instalados
mediante una transacción explícita READ ONLY, TLS verificado y rollback.
La consulta solo obtiene estados, políticas y restricciones de firma; no lee
órdenes, clientes, materiales ni evidencias reales.

| Clase | Finalización técnica real | Cierre administrativo separado |
| --- | --- | --- |
| Avería | `resolved` | Existe `closed`; la política vigente también permite SOPORTE, además de ADMIN/SUPERADMIN |
| Alta | `completed` | No existe. El selector administrativo vuelve a escribir el mismo estado |
| Rutina | `completed` | No existe. El selector administrativo usa el mismo estado |

Otros estados observados: Averías `open`, `in_progress`, `rescheduled`;
Altas y Rutinas `pending`, `scheduled`, `in_progress`, `cancelled`.
No se añadieron ni reinterpretaron estados.

**Se detiene la confirmación/acreditación administrativa común de los puntos
3–5 del pedido.** No hay un cierre administrativo existente de Altas/Rutinas
que se pueda envolver con una confirmación sin introducir un hecho nuevo.
Tampoco se habilita una solución distinta solo para Averías.

La guarda de ajustes de `506b35a` continúa permitiendo ajustes auditados antes
del cierre técnico; no se amplió aún al intervalo posterior a ese cierre.
La contabilización vigente sigue considerando el cierre técnico, como datos
de prueba: **todavía no satisface la acreditación definitiva solicitada**.
Esta entrega no está lista para activar la contabilización oficial de noviembre.

Propuesta mínima pendiente de decisión: registrar una confirmación
administrativa única por `(job_type, job_id)`, con puntos, responsable, fecha
y distribución efectiva de la cuadrilla. Una RPC transaccional exigiría la
confirmación explícita, auditaría cualquier cambio con motivo y ejecutaría
`closed` en Averías; Altas/Rutinas conservarían su estado técnico `completed`
y registrarían esa confirmación aparte. El índice único impediría duplicar
acreditación. Es un hecho administrativo adicional, por eso **no se implementó**.

El corte oficial solicitado es noviembre de 2026; octubre sigue siendo prueba.
No se ha programado una transición automática ni una corrección histórica.
La futura definición debe fijar también cómo tratar una orden de octubre
confirmada por administración en noviembre y qué fecha atribuye el periodo.

## Cambios compatibles implementados

### Consulta operativa de puntos

- `CampoJobPoints` muestra el puntaje asignado completo y la parte del propio
  técnico tanto en abiertas como terminadas. No lo denomina acreditación.
- RPC nueva `my_field_order_points`: exige técnico activo y pertenencia a
  la cuadrilla; líder y ayudantes leen lo mismo. Si existe cuadrilla se usa
  esa; `assigned_to` solo es fallback cuando no existe, igual que la fuente
  compartida. Una orden ajena o inexistente devuelve NULL sin datos.
- Solo devuelve puntos, reparto, estado y hora de consulta: no enumera
  técnicos, clientes ni órdenes ajenas. ADMIN/SUPERADMIN usa su editor
  administrativo previo, no esta RPC personal.
- Lee el valor de la orden; conserva los fallbacks 10/5/3 o cero histórico
  cuando corresponden. En una categoría sin regla automática muestra el
  valor manual asignado, aunque la contabilidad de prueba histórica todavía
  lo ignore. Son conceptos separados hasta resolver la acreditación oficial.
- No escribe puntos ni asignaciones. Tampoco acredita, crea movimientos ni
  suma eventos de auditoría. La RPC de modificación y sus guardas de permisos
  de `506b35a` se conservan.
- Actualiza por realtime de orden/cuadrilla, al recuperar foco/conexión y
  cada 15 segundos como respaldo. Usa las publicaciones ya previstas en
  migraciones 121/132; no se ha certificado su entrega real en producción.
  Durante desconexión no se promete actualización instantánea.
- Se reutiliza `usePersonalRead`, ya disponible localmente, para descartar
  respuestas atrasadas al cambiar de identidad/orden o desmontar. Se incluye
  como dependencia del componente, sin alterar su comportamiento previo.
- El montaje de `CampoJobPoints` en el detalle, antes solo local y no incluido
  en `506b35a`, se incorpora ahora junto con su implementación definitiva de
  consulta. El resto de cambios previos de Campo/ranking/router queda fuera.

### Firma del cliente

- Se retira el panel `SignaturePad` de los tres flujos y el requisito de
  firma de Altas, incluido el resumen de pendientes. Queda el aviso de hoja
  física; no se agregó otra validación ni evidencia obligatoria.
- Se conserva la columna `signature_path`, sus archivos históricos y los
  lectores existentes. La revisión instalada confirmó `is_nullable=YES`,
  sin CHECK de firma ni triggers detectados que referencien esa exigencia.
  El cierre usa Supabase directamente; no se encontró exigencia en rutas API.
- Las firmas ya capturadas en borradores/colas anteriores siguen siendo
  compatibles: se restauran como evidencia previa, sin reabrir un panel de
  captura ni exigir otra firma. Se conserva el soporte de subida de esa cola
  antigua, no una captura nueva.
- Antes del upsert se conserva la ruta de firma ya existente. Si falla esa
  lectura se aborta/reintenta, evitando sobrescribir una firma histórica con
  NULL por un fallo de consulta.
- No cambian fotografías, hoja de servicio fotografiada, GPS, materiales,
  validaciones de red/equipos ni el estado final enviado por el técnico.

### Protección de históricos

Se revisa la candidata **no aplicada** `20261024180000_work_order_points.sql`:
se conserva su creación obligatoria, ajuste, permisos y auditoría, pero se
retiran la reescritura de `technician_point_contributions` y la RPC nueva del
reporte que cambiaban el cálculo histórico. La fuente queda byte a byte igual
en PostgreSQL aislado antes/después de ambas candidatas.

`reports.ts` y el texto añadido de `ReportesView.vue` vuelven exactamente al
contenido anterior a `506b35a`. No cambia lógica financiera ni facturación.
Los reportes históricos conservan sus limitaciones previas; no se corrigen
silenciosamente mientras el flujo oficial sigue detenido. Tampoco se hacen
backfills, puntuaciones estimadas para históricos ni cambios de pagos.

## Archivos de esta continuación

| Archivo | Cambio |
| --- | --- |
| `src/components/campo/CampoJobPoints.vue` | Consulta operativa y actualización automática |
| `src/composables/usePersonalRead.ts` | Dependencia local reutilizada, incorporada al commit |
| `src/views/campo/CampoTrabajoDetailView.vue` | Montaje de puntos; retirar captura/bloqueo de firma |
| `src/stores/campo.ts` | Compatibilidad de firmas previas y rechazo ante error de lectura |
| `src/views/instalaciones/InstalacionDetailView.vue` | Texto de hoja física |
| `src/stores/reports.ts`, `src/views/reportes/ReportesView.vue` | Restaurar reporte anterior |
| `supabase/migrations/20261024180000_work_order_points.sql` | Retirar cambios pendientes de contabilización histórica |
| `supabase/migrations/20261024190000_field_order_points_readonly.sql` | RPC personal de lectura, sin acreditación |
| `server/tests/workOrderPoints.sql.test.ts` | Permisos/reparto/lectura de las tres clases y conservación de fuente |
| `scripts/tests/field-order-points-browser.html`, `.mjs` | Navegador aislado con API ficticia |
| `scripts/tests/field-points-signature-readonly.sql` | Metadatos acotados de estados/permisos/firma |
| `scripts/work-order-points-readonly.ps1` | Selector acotado para esa consulta |
| `docs/PUNTOS-ORDENES-VALIDACION.md` | Enlace a esta revisión que sustituye su parte contable |
| Este documento | Resultados, límites y propuesta pendiente |

## Pruebas focalizadas

73 pruebas aprobadas:

```text
node --import tsx --test server/tests/workOrderPoints.sql.test.ts src/lib/__tests__/workOrderPoints.test.ts src/lib/__tests__/jobClosureIdempotency.test.ts server/tests/closedOrders.sql.test.ts server/tests/routineReturns.sql.test.ts
```

PostgreSQL efímero sin red ni datos reales. Cubre las tres clases: puntos
obligatorios previos sin regresión, ajustes ADMIN/SUPERADMIN auditados,
rechazo de modificación por líder/ayudante mediante RPC y UPDATE directo,
técnico inactivo, sesiones ajenas, lectura abierta/terminada, revocación de
asignación, fallback, reparto y no duplicación en los cálculos vigentes tras
repetir cierre. La fuente histórica no cambia; se comprueba también la
lectura de Altas antes de existir su columna candidata de puntos.
No se certifica la futura acreditación administrativa, que no se implementó.

Chrome headless: **35 comprobaciones aprobadas** con
`node scripts/tests/field-order-points-browser.mjs`. Renderiza el componente
real y ejecuta el store real de cierre contra API ficticia, con red externa
bloqueada: líder/ayudante, tres clases, notificación simulada, polling real,
foco/online, error/acceso revocado sin datos viejos, cierre sin firma nueva,
preservación de ruta histórica y aborto si falla su lectura, sin errores JS.
El cierre ensayado es la canalización del store con entradas mínimas: no es
una prueba integral de red/NAP/ONT, cámara, WebView Android o formulario móvil
completo. No se llamaron servicios de OLT, MikroTik o facturación.

También pasan tipos (`vue-tsc -b --pretty false`) y `vite build`. Aviso existente
de tamaño de chunks. Las pruebas locales previas del lector personal pasan
(3 casos de carga/error, identidad tardía y límites de periodo), sin modificar
ese trabajo previo. Los primeros ensayos requirieron ajustar la representación
de NULL en psql y esperar más de 15 segundos en el test de polling; se repitieron.

## Migraciones pendientes y riesgos

- Ninguna aplicada en producción. La candidata anterior mantiene la
  obligatoriedad/auditoría; la nueva solo instala la lectura personal.
- Retirar la firma no requiere migración de firma según los metadatos leídos.
- El componente necesita su RPC para funcionar; frontend y RPC deben
  coordinarse en una eventual activación autorizada por separado.
- En producción no se han probado ediciones, lecturas de técnicos ni cierres
  funcionales. La consulta fue exclusivamente de metadatos READ ONLY.
- El cierre administrativo y la acreditación oficial desde noviembre siguen
  detenidos. No activar la candidata como si ya resolviera esas reglas.
- No se tocaron archivos de MikroTik, OLT, facturación ni asignaciones de
  cuadrilla; tampoco órdenes reales, pagos, bonificaciones ni evidencias.
