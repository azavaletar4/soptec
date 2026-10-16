# Inventario de Campo — etapas 1 y 2, implementación local

Base: `2a5e24c`. Solo Altas y Averías. **Listo para revisión local**, sin
certificar todavía el cierre de acceso directo a las tablas de Supabase.
No se aplicó ni generó migración, no se modificaron RLS/permisos o datos de
producción, no se hizo push ni despliegue. Fase 162 permanece separada.

## Etapa 1: contexto sin cambiar las escrituras

La referencia contiene jobType, jobId, actorId, clientId y contractId. El
cliente obtiene actor/cliente/contrato del trabajo actual; el servidor deriva
los valores autorizados del JWT, perfil y orden, no de parámetros del navegador.
El cliente rechaza respuestas que no coincidan o cuya identidad local cambió.

Retirar equipo de Alta y desvincular pendiente de Avería pasan ahora por
`performUnitAction`: GET contextual para comprobar equipo/orden/estado y
vínculos, seguido de **una sola invocación** a markRepaired/rejectUnit existentes.
No agrega installation_id/ticket_id al evento: eso cambiaría el comportamiento
del trigger. La validación y la delegación transportan el contexto; el payload
SQL anterior permanece intacto. No se implementaron nuevas mutaciones.

Las demás escrituras ya transportaban los identificadores propios de su flujo
y se conservan. En inventory.ts solo se estrecha el tipo de entrada necesario
para revertMovement; su cuerpo y las escrituras no cambian.

Esta comprobación previa no es una autorización transaccional de la escritura:
puede haber una reasignación después de la lectura. Resolver ese intervalo y
los reintentos de mutaciones corresponde a la etapa 3, no implementada.

## Etapa 2: lecturas contextualizadas

Nuevo endpoint exclusivamente GET:
`/api/campo-inventory/:jobType/:jobId/:view`.
Vistas: products, materials, assigned, pending, available y unit-context.
Tipos admitidos: installation/ticket; rutina se rechaza en este endpoint.

Reutiliza requireAuth y el cliente Supabase **con clave pública y JWT del
solicitante**. No utiliza service_role ni funciones SECURITY DEFINER nuevas.
En cada consulta relee el perfil activo sin la caché de requireAuth, comprueba
rol y orden; para TECNICO_RED exige una entrada vigente exacta en job_assignees,
sea leader o support. ADMIN/SUPERADMIN activos pueden consultar el contexto
sin ser miembros de la cuadrilla. SOPORTE/FACTURACION/CLIENTE se rechazan.

Estados técnicos de trabajo: Altas pending/scheduled/in_progress; Averías
open/in_progress/rescheduled. Sin asignación, una orden devuelta no da acceso.
Para conservar consulta histórica, el técnico todavía asignado puede leer
materials/assigned/pending de Altas completed y Averías resolved/closed, pero
no catálogo, disponibles ni validación de acciones. Canceladas quedan excluidas.
La autorización se repite antes de responder; si cambia el vínculo de la orden
o se pierde la asignación durante la consulta, no se entrega el resultado.

El catálogo devuelve nombre, unidad, identificación, serialización, cantidad
operativa y slug de categoría. Materiales/equipos solo incluyen campos de la
operación. No se devuelven precios, valorizaciones, balance_after, documentos,
correos de autores ni notas administrativas. Proyección explícita de salida,
además de SELECT de columnas específicas.

Disponibles: modelo activo serializado, estado in_stock y sin vínculos a
cliente/contrato/orden. Asignados de Avería: cliente y contrato exactos,
verificando que el contrato pertenece al cliente de la orden. Los pendientes
se restringen al ticket. Una Alta ve sus equipos por installation_id.

**Históricos sin contrato:** se elimina la ampliación automática a todos los
equipos del cliente. Solo se muestran equipos vinculados directamente a la
orden y sin contrato; se muestra un aviso para revisar los demás históricos.
Esto evita mezclar servicios de clientes multicontrato y puede requerir que
administración precise un vínculo antes de operar un equipo antiguo. No se
inventan contratos, no se reasigna ningún equipo y no se corrige información
operativa automáticamente.

Cada respuesta pagina 100 filas (+1 para siguiente página), con orden estable.
El adaptador recorre las páginas del conjunto contextual necesario para los
selectores actuales; no busca por todas las unidades administrativas. Cada
página vuelve a autorizarse y no existe fallback a las consultas amplias.

Campo usa estas lecturas al abrir, tomar una orden, refrescar cuadrilla y
actualizar materiales/equipos. Los disponibles se limpian al cambiar modelo;
una respuesta de otro modelo ya seleccionado no repuebla el selector. El
catálogo de Campo vive separado del store administrativo. Cambiar identidad
o rol limpia las listas y descarta respuestas pendientes incompatibles.

## Pruebas ejecutadas

- `node --import tsx --test server/src/services/__tests__/fieldInventory.test.ts src/lib/__tests__/fieldInventoryClient.test.ts`: **24/24**, transporte sintético sin Cloud.
- Casos: líder/apoyo, no asignado, inactivo, roles denegados, orden devuelta,
  reasignación durante lectura, cliente multicontrato, contrato de otro cliente,
  equipos correctos/ajenos, disponibles, paginación, lectura histórica, contexto
  cambiado, sesión anónima y exclusión de Rutinas.
- `node scripts/tests/field-inventory-browser.mjs`: integración de componentes
  reales de Campo en Vite local, Altas y Averías; cero lecturas directas amplias
  de inventario en esos flujos. Retirada/desvinculación generan exactamente un
  INSERT de evento simulado con payload anterior y cero INSERT de movimientos.
  Cero excepciones. Datos, identidad y peticiones externas son simulados; no se
  inicia el backend real ni sus schedulers. La página harness es solo de pruebas.
- Typecheck explícito de las dos unidades backend nuevas: correcto.
- `npm.cmd run build`: correcto (aviso existente de paquetes grandes).
- `git diff --check`: correcto.

No se repitieron pruebas funcionales de búsqueda ni auditorías de Cloud. No se
probó con sesiones reales de cada rol ni se ejecutaron escrituras operativas.
Las pruebas verifican delegación única, no idempotencia de mutaciones ante una
respuesta de red perdida ni concurrencia transaccional de asignaciones.

## Archivos

- server/src/routes/fieldInventory.ts y services/fieldInventory.ts: endpoint y lecturas autorizadas.
- server/src/index.ts: registro del endpoint; ningún scheduler nuevo.
- src/types/fieldInventory.ts y src/lib/fieldInventoryClient.ts: DTO mínimos, páginas y contexto.
- src/views/campo/CampoTrabajoDetailView.vue: consumidores de Altas/Averías y dos delegaciones contextualizadas.
- src/stores/inventory.ts: cambio de tipo para reversión, sin cambio de cuerpo.
- server/src/services/__tests__/fieldInventory.test.ts y src/lib/__tests__/fieldInventoryClient.test.ts.
- scripts/tests/field-inventory-harness.html y field-inventory-browser.mjs.
- Este documento y nota específica en ESTADO_DESARROLLO.md.

## Riesgos pendientes y rollback

1. RLS y REST directo siguen amplios: esta entrega no cierra la exposición
   administrativa confirmada. No implementar etapas 3–6 como parte de este cambio.
2. Backend y frontend nuevos deben probarse juntos antes de una entrega futura;
   un backend antiguo no tiene este endpoint y la UI no hará fallback inseguro.
3. Las comprobaciones de lectura son varias consultas bajo las RLS actuales,
   no una transacción bloqueante. Existe una ventana posterior a la última
   comprobación; no se promete revocación instantánea ni serialización de escrituras.
4. Pendientes medición de latencia con sesiones reales y volumen por modelo;
   el doble control de autorización agrega consultas. Probar también históricos
   sin contrato y datos in_stock con vínculos residuales, excluidos por seguridad.
5. Realtime y la cola offline siguen con su implementación anterior y sus
   limitaciones documentadas. RoutineInventory y Fase 162 no se modificaron.

Rollback local: revertir el commit de esta entrega en una revisión separada.
No requiere rollback SQL ni restaurar datos; volvería a las lecturas amplias
anteriores de Campo. No se revierte la protección frontend de 2a5e24c ni se
incluyen archivos ajenos de la sesión.
