# Etapa 3 — implementación local, NO desplegada

15/10/2026, continuación de `c74a86e`. **LISTO PARA REVISIÓN LOCAL**;
no equivale a aprobación de producción ni a cierre global de RLS.

## Cambios

- Migración `20261016010000_campo_inventory_operations.sql`: RPC única
  `campo_inventory_operation` para consume, kit, correct, reverse, assign,
  unassign, stage, return y unlink. Solo Altas/Averías. Kit y corrección son
  atómicos: cualquier fallo revierte todas las filas y el recibo.
- Tabla nueva `campo_inventory_operations`: una intención UUID, actor, orden,
  contexto cliente/contrato, carga exacta JSONB y respuesta. Es necesaria para
  recuperar la petición completa y el resultado de operaciones de dos/N filas;
  las filas existentes no almacenan la intención original del kit/corrección
  ni su resultado agrupado. No se modifica el esquema de las tablas existentes.
- Reutiliza INSERT en movimientos/eventos y sus triggers de stock, límites ONU,
  aprobación pendiente y protección de órdenes cerradas. Ningún UPDATE directo
  de saldos o unidades, ninguna edición/borrado de historial.
- `CampoTrabajoDetailView.vue`: todos esos consumidores usan RPC, incluyendo
  kit; no hay fallback a INSERT. Los stores administrativos quedan intactos.
  Refresca pantalla con lecturas contextuales, sin usar balance_after.
- `fieldInventoryOperation.ts`: persiste intención en localStorage antes del
  envío, separada por actor/tipo/orden. Reintento con la misma UUID; bloquea
  payload distinto mientras el resultado sea incierto. Botón para confirmar
  petición pendiente, incluso tras recargar. Web Locks serializa acceso entre
  pestañas; sin soporte de almacenamiento/Web Locks se deniega el envío.

## Autorización y concurrencia

RPC SECURITY DEFINER con search_path fijo (`pg_catalog, public`), tablas y
auth.uid cualificadas, sin SQL dinámico. No acepta actor/cliente/contrato/saldo
del navegador ni un estado arbitrario. Claves permitidas por acción, tamaño
de carga limitado y kit acotado a 25 filas; cantidades positivas con 2 decimales.

El dueño de la función es el rol de migración; debe revisarse su ownership en
el preflight futuro. La elevación es necesaria para responder sin SELECT de
tablas administrativas. No se otorgan privilegios amplios a usuarios: tabla
de recibos con RLS sin policies y grants revocados a PUBLIC/anon/authenticated;
EXECUTE revocado a PUBLIC/anon y concedido a authenticated exclusivamente.
La función valida siempre identidad activa y rol ADMIN/SUPERADMIN/TECNICO_RED.
SOPORTE/FACTURACION son rechazados sin modificar sus flujos de oficina.

Locks de perfil (SHARE), orden (UPDATE), asignación vigente leader/support
(SHARE), contrato exacto (UPDATE), intención (advisory transaccional), original
y productos/unidades. El contrato serializa operaciones sobre un mismo
servicio; los productos de un kit se bloquean en orden de UUID. UPDATE/DELETE
concurrentes de perfil/orden/asignación/contrato esperan esos locks. Una fila
de asignación eliminada o modificada antes de obtener el lock se revalida.
No se incorporan triggers sobre dispatch ni Rutinas.

La reversión relee el original, exige egreso de la misma orden, y comprueba que
no tenga reversión. La corrección agrega reversión + nuevo egreso dentro de
esa transacción. Dos operaciones contextuales concurrentes de la misma orden
quedan serializadas; la RPC no afirma proteger las escrituras legacy directas
de otros módulos contra todo tipo de duplicado. No se cambia su comportamiento.

Un replay con misma intención/carga/actor/orden/contexto devuelve el recibo sin
INSERT nuevo. Cambiar cualquiera se rechaza. Se revalida identidad/asignación
también en replay; si hubo revocación, se conserva localmente el intento para
revisión, no se cambia la clave. Una orden cerrada permite recuperar un recibo
ya confirmado al técnico todavía autorizado, pero no crear una operación nueva.

Error SQLSTATE en el **primer intento** confirma rollback y permite corregir el
formulario. Fallo de transporte, recibo inválido o denegación posterior a una
respuesta incierta conserva el intento. No se descarta una operación incierta
automáticamente. El almacenamiento no sustituye un respaldo: borrarlo o perder
el dispositivo puede perder la clave del cliente; no se debe recrear el consumo
a ciegas. No se añade una cola offline ni se cambia la cola de cierres.

## Equipos y compatibilidad

Entrantes: solo unidad in_stock libre de todos los vínculos, producto activo
serializado, orden y servicio verificables; Alta asigna y Avería deja pendiente.
Salientes/desvinculación: contrato y cliente exactos; Alta/pending exigen además
su orden explícita y estado correcto. Retiro de Avería admite equipo asignado
al mismo servicio, conservando los candados del trigger de su orden anterior.
No se infieren servicios por cliente ni eventos antiguos.

Los ocho equipos indeterminados no se consultaron ni alteraron. La RPC rechaza
retiro/desvinculación de cualquier unidad sin contrato actual verificable.
También rechaza nuevas operaciones de equipos de órdenes sin contrato; son
casos de revisión administrativa independiente. Materiales sí permiten órdenes
sin contrato, con autorización contextual. No se habilitan excepciones a los
candados de instalaciones completadas o Averías cerradas.

Los flujos administrativos conservan stores, tablas, policies y triggers
existentes. Se prueba un INSERT/RETURNING administrativo legacy después de la
migración. Rutinas/Fase 162 no se cargan en esta suite ni se modifican; no se
afirma haber validado esa fase pendiente con este cambio.

## Validación ejecutada

- `node --import tsx --test server/tests/fieldInventoryOperations.sql.test.ts`:
  **17/17** (16 casos y suite principal). PostgreSQL 17 Docker efímero, sin red,
  datos sintéticos. Carga funciones reales `current_user_role`,
  `apply_inventory_movement` y `apply_inventory_unit_event` desde migraciones
  existentes y ejecuta la nueva migración completa, no una copia simplificada.
  Fixture de tablas acotada, no clon del esquema Cloud.
- Casos SQL: líder/apoyo, ADMIN/SUPERADMIN, ajeno, SOPORTE, FACTURACION, inactivo,
  anon, tabla de recibos privada; atomicidad de kit/corrección; stock insuficiente;
  replay en conexión nueva y simultáneo; colisión de carga/identidad/servicio;
  dos técnicos revirtiendo/consumiendo/asignando; reasignación y cierre concurrentes;
  contrato incorrecto; ocho unidades sintéticas sin contrato intactas; DTO sin
  SELECT administrativo y compatibilidad de INSERT/RETURNING administrativo.
- `node --import tsx --test src/lib/__tests__/fieldInventoryOperation.test.ts
  server/src/services/__tests__/fieldInventory.test.ts
  src/lib/__tests__/fieldInventoryClient.test.ts`: **30/30**. Se repitieron las
  24 de lectura/contexto porque cambió la integración de sus consumidores, más
  6 nuevas de persistencia/error/identidad/resultado incierto.
- `node scripts/tests/field-inventory-browser.mjs`: **4 escenarios** correctos:
  Alta y Avería, respuesta normal y respuesta perdida seguida de replay. Cada
  escenario conserva un solo commit simulado y cero INSERT directos. Vite local
  con claves sintéticas y peticiones externas interceptadas; sin backend real.
- `npm.cmd run build`: correcto, incluyendo vue-tsc; aviso existente de chunks
  mayores a 500 kB. `git diff --check`: correcto.

Las primeras ejecuciones detectaron problemas del harness (readiness TCP y
captura tardía del rechazo esperado concurrente), corregidos antes del resultado
final. No se ejecutaron escrituras/pruebas en Cloud ni sesiones reales simuladas
con service_role.

## Pendientes y riesgos antes de producción

1. Revisión de la RPC SECURITY DEFINER, ownership/default grants, compatibilidad
   exacta de esquema/triggers desplegados y tiempos de lock con volumen real.
   Esta sesión no volvió a auditar Cloud. No aplicar automáticamente todas las
   migraciones pendientes: Fase 162 debe continuar excluida.
2. Sesiones reales de líder/apoyo/ajeno y validación operativa de Altas/Averías,
   incluyendo dispositivos con Web Locks y almacenamiento persistente.
3. Migración y frontend deben activarse coordinadamente tras aprobación futura;
   frontend nuevo contra Cloud actual no tiene esta RPC y falla sin fallback.
4. Las RLS/permisos directos amplios previamente documentados siguen pendientes.
   Esta entrega prepara escrituras seguras, no cierra REST administrativo ni
   Realtime ni clientes antiguos. No avanzar al cierre global de permisos.
5. Errores inciertos seguidos de revocación o cambio de servicio quedan para
   conciliación administrativa; no borrar localStorage/recibos para destrabarlos.
   No purgar recibos mientras puedan existir reintentos.

## Rollback preparado

Ahora no hay rollback operativo: todo es local y Cloud permanece intacto.
Para una activación futura: pausar nuevas operaciones, conciliar pendientes,
restaurar la versión anterior del frontend y después revocar EXECUTE de la
RPC a authenticated. Conservar recibos, movimientos y eventos confirmados;
no restaurar stock ni borrar la tabla. El script complementario de revocación
está fuera de migrations y **no fue ejecutado**. No tocar policies de Rutinas,
triggers compartidos ni los ocho equipos. El rollback a clientes legacy mantiene
el riesgo de acceso amplio anterior; no constituye solución de seguridad.

Archivos de esta entrega: migración, helper y pruebas TS, vista Campo,
`server/tests/fieldInventoryOperations.sql.test.ts`, harness/browser existentes
actualizados, este informe y `scripts/rollback-campo-inventory-etapa3.sql`.
Nota de sesión añadida a ESTADO_DESARROLLO.md sin incluir cambios ajenos en Git.
