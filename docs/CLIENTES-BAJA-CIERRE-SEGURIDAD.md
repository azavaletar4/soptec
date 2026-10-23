# Cierre de seguridad: baja, NAP y reactivación

Fecha: 2026-10-23. Base: `38cec66` y `CLIENTES-BAJA-REVISION-FINAL.md`.

**Resultado: FAIL para activar. Parada por la condición explícita del encargo.**
La arquitectura existente no ofrece exclusión entre toda la reactivación de red y la baja SQL. No se implementan cambios funcionales insuficientes ni se activa la baja. Este cierre añade únicamente este informe; los archivos de la revisión anterior y los trabajos ajenos permanecen como estaban.

## Limitación comprobada

`reactivateContract` en `server/src/services/debtHoldService.ts` obtiene contrato y ficha mediante Supabase HTTP, valida su estado y después ejecuta operaciones externas con datos de esa lectura. Las llamadas posteriores no forman parte de una transacción PostgreSQL abierta.

`client_retire_atomic` en `docs/sql/client-retirement-proposal.sql` bloquea ficha, contratos e instalaciones con `FOR UPDATE`, y confirma la baja en una sola transacción. Esos bloqueos no incluyen el intervalo de ejecución de red de otra solicitud.

`server/src/services/oltTelnetLock.ts` mantiene colas por dispositivo en un `Map` del proceso Node. No coordina el RPC de baja, no protege las operaciones MikroTik y no cubre otras sesiones/procesos. El backend usa `supabaseAdmin` HTTP, no una conexión PostgreSQL retenida durante la operación crítica. No se encontró un coordinador persistente de estas operaciones en los flujos implicados.

Secuencia reproducida localmente: lectura válida → confirmación simulada de baja → continuidad de acciones OLT simuladas. La base conserva `retired/cancelled`, pero la guarda inicial no impide la acción externa posterior. Una segunda lectura, un UPDATE condicional al final o un mutex sólo en la ruta HTTP tampoco eliminan esta ventana ni protegen el acceso directo al RPC.

No se afirma que sea imposible resolverlo: requiere incorporar coordinación compartida que hoy no existe. Por la instrucción de detenerse ante esta limitación, no se modifican funciones compartidas ni se continúa con una implementación parcial de NAP/ONT.

## Cambio mínimo necesario, todavía no implementado

1. Preparar para revisión un coordinador persistente por titular, adquirido atómicamente con revalidación de ficha/contrato. Baja y reactivación deben participar; también los caminos que puedan cancelar o reasignar contratos durante la operación, incluidos accesos directos autorizados a la base. Debe cubrir el backend con `service_role`; ocultar botones o añadir sólo RLS para `authenticated` no basta.
2. Mantener la exclusión durante todas las operaciones externas y su confirmación. Si gana la baja, la reactivación debe rechazar antes de cualquier efecto; si gana la reactivación, la baja debe rechazar o esperar sin cambiar estados. La operación debe volver a validar bajo esa exclusión, no antes de adquirirla.
3. Diseñar recuperación ante caída del proceso, timeout o resultado de red incierto. No liberar automáticamente por TTL ni en un `finally` incondicional mientras una orden pudiera seguir ejecutándose. Un registro persistente que bloquee hasta recuperación explícita es una alternativa a evaluar, con token de propietario, permisos mínimos y recuperación documentada. No se certifica esa alternativa sin implementación y pruebas multiproceso. No existe rollback transaccional de órdenes físicas mediante PostgreSQL.
4. Resolver ONT por `contract_id` exacto y comprobar titular y pertenencia inequívoca; rechazar vínculos ausentes/ambiguos antes del transporte. No usar todas las ONT del titular como fallback. Revisar también la estabilidad del vínculo durante la exclusión. `findOnts(clientId)` se comparte con la suspensión por deuda: su modificación requiere pruebas de ambos caminos. No se cambian generadores ni comandos físicos.
5. Preparar cambios SQL y rollback de definiciones como propuesta separada, con permisos y recuperación revisados, sin aplicarlos. La activación dependerá de autorización explícita y coordinación del backend y la base; no activar sólo el frontend de baja.

## NAP: alcance exacto pendiente

`src/views/zonas/ZonasView.vue` usa `serviciosOcupados` de `src/lib/napOccupancy.ts`. Este helper filtra `estado='ocupado'` y presencia de `client_id`, y deduplica por contrato (o por titular cuando falta contrato), pero no inspecciona el estado contractual. Las consultas de `src/stores/foFibra.ts` cargan número/código de contrato, sin su estado. Por tanto una relación conservada con contrato cancelado puede seguir contando.

Además, el total de zona en `ZonasView.vue` y `zoneServiceCount` en `ClientServiceDetailView.vue` cuentan contratos de la zona sin excluir cancelados. Cambiar sólo el badge de la NAP dejaría validaciones y contadores incoherentes.

Pendiente: un cálculo comercial reutilizable que cuente contratos distintos activos y suspendidos, separe cancelados como historial y trate relaciones no verificables como pendientes de revisión. Mostrar Activo verde, Suspendido ámbar y Cancelado gris en Zonas. Conservar la relación histórica sin cambiar estados ni asignaciones de puertos físicos. No reutilizar la liberación existente que borra `client_id/contract_id` para resolver este requisito. Al reincorporar, contar únicamente la asignación vigente del contrato correspondiente y evitar duplicados del mismo contrato, sin fusionar servicios distintos del titular. Esto no está implementado ni certificado en este cierre.

## Pruebas focalizadas ejecutadas

Sin importar el servidor principal ni cargar transportes reales. PostgreSQL efímero local `postgres:17`, `--network none`, datos sintéticos y eliminación del contenedor propio al terminar. Sin consultas o escrituras productivas.

| Comprobación | Resultado |
| --- | --- |
| API: roles, JWT reenviado, confirmación, errores y fallo cerrado | PASS, 4 pruebas |
| Guarda previa: cancelado/retirado/desconocido bloqueados; suspendido permitido | PASS, 2 pruebas |
| Comparación de suspensión por deuda y reactivación legítima antes/después de `38cec66` | PASS, pruebas comparativas locales |
| Exclusión baja/reactivación durante la ejecución | **FAIL del requisito**, reproducer confirma la carrera |
| Varias líneas con ONT distintas: aislar la ONT de cada contrato | **FAIL del requisito**, reproducer confirma alcance por titular preexistente |
| Baja SQL: atomicidad, historial, múltiples contratos, Altas abiertas, permisos, concurrencia con alta de contrato y rollback | PASS, 16 subpruebas |
| NAP: deduplicación y compatibilidad del helper anterior | PASS, 8 pruebas existentes; no prueban exclusión de cancelados |
| Cancelación libera capacidad comercial e historial separado con colores en Zonas | **FAIL: pendiente**, código actual no clasifica por estado contractual |
| Reincorporación posterior sin duplicar ocupación | PENDIENTE, no ejecutada ni implementada |
| Suspensión temporal | Cobertura limitada al estado `suspended` en guarda/reactivación; no se certifica su flujo completo |

Comandos reproducibles:

```text
node --import tsx --test server/tests/clientRetirement.review.test.ts server/tests/clientRetirement.reactivation.test.ts server/tests/clientRetirement.http.test.ts
node --import tsx --test server/tests/clientRetirement.sql.test.ts src/lib/__tests__/napOccupancy.test.ts
```

Primer comando: 11/11 PASS del runner. Segundo: 25/25 PASS del runner, incluido el contenedor de 16 subpruebas SQL. Los reproductores pasan porque detectan los defectos esperados; **no equivalen a PASS de seguridad**. La prueba concurrente de alta de contrato SQL tampoco equivale a exclusión con red.

Un sondeo adicional de NAP con `node -e` no llegó a ejecutarse por `uv_os_get_passwd ENOMEM` de tsx; no aporta evidencia y no se usa para concluir PASS. Las ocho pruebas NAP indicadas sí finalizaron.

## Archivos, commit y activación

Único archivo añadido por este cierre: `docs/CLIENTES-BAJA-CIERRE-SEGURIDAD.md`. Commit local documental posterior a `38cec66`; su hash se informa al entregar. No se incluyen informes/pruebas anteriores sin commit ni trabajos ajenos. No se corrigen los cinco errores TypeScript ya identificados ni se repite su comparación global.

No se modifican los cuatro clientes, contratos, equipos, historial, RLS, SQL propuesto, OLT/MikroTik ni Janet–Estiven. Sin migraciones, push, artefacto nuevo ni despliegue. **La baja definitiva sigue sin estar lista para activación.** Antes de activarla hacen falta coordinación persistente revisada, selección ONT exacta, clasificación comercial NAP y pruebas de esos cambios, con fallos de transporte y recuperación incluidos.
