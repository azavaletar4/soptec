# Rutinas: autorización vigente de recibos — APROBADO EN LABORATORIO

16/10/2026. Base `88adc3d`. Corrección puntual autorizada de compatibilidad con
Fase 162. No constituye el cierre global RLS administrativo ni un despliegue.

## Causa y corrección mínima

`routine_inventory_operation` devolvía un recibo después de validar su actor,
rutina, acción y carga, pero antes de validar la pertenencia actual. Un técnico
retirado que conservaba JWT, UUID y carga podía recuperar su antiguo resultado.
Se reprodujo ese comportamiento mediante la RPC original y un JWT GoTrue real
del laboratorio, sin generar otro movimiento.

La migración local
`20261016020000_fase162_autorizacion_recibos.sql` sustituye **solo esa RPC**:

1. Conserva identidad activa y lock idempotente originales.
2. Bloquea la Rutina y verifica el rol correspondiente a la acción; para las
   acciones técnicas bloquea la cuadrilla y exige pertenencia vigente.
3. Solo entonces busca y devuelve el recibo coincidente. Conserva el rechazo
   de UUID usado con otra identidad, Rutina, acción o carga.
4. Una operación nueva de técnico sigue exigiendo `in_progress`. Para recuperar
   un recibo existente no se añade esa condición: un técnico activo que sigue
   asignado conserva el reintento tras cierre, sin reabrir la Rutina ni ejecutar
   otra escritura. Si fue retirado, incluso mediante `return_routine`, se deniega.

Las acciones de oficina siguen reservadas a ADMIN/SUPERADMIN/SOPORTE. No se
otorga a administradores consumo técnico que antes no tenían. El cuerpo de
escrituras, validaciones de stock, payload, UUID, resultado y trazabilidad es
idéntico al original; solo se reordena la frontera de autorización/retorno.
Se conserva el orden de locks de operaciones nuevas: clave, Rutina, cuadrilla,
producto/movimiento/equipo. Ahora los reintentos también pasan por esa frontera.

El SQL incluye una comprobación de huella de la RPC previa y aborta antes de
sustituirla si falta Fase 162 o hay diferencias. `CREATE OR REPLACE` conserva
firma, propietario y ACL. No hay nuevas tablas, políticas, grants ni cambios a
otras funciones de Fase 162. Su migración original permanece intacta.

## Laboratorio y pruebas nuevas

Se conservó el laboratorio anterior. Se creó la base ficticia separada
`inventory_routine_receipt_lab` en su PostgreSQL local y un PostgREST independiente
en `127.0.0.1:54389`, con el mismo Auth local. La base nueva carga el fixture
reducido existente y las dependencias originales 150/150b/151/161/162, sin
restaurar información operativa. La corrección se aplicó **solo allí**.

Comandos focalizados:

```text
node scripts/inventory-auth-lab/routine-receipts-prepare.mjs
node scripts/inventory-auth-lab/routine-receipts-validate.mjs
```

Ambos se detienen si ya existe su preparación/ensayo para no recrear datos ni
repetir escrituras automáticamente. Runtime, credenciales y fixtures quedan
ignorados por Git. No se cargó `.env`, no se utilizó service_role ni se inventaron
tokens. Se iniciaron sesiones GoTrue y se verificaron firma ES256, sujeto,
issuer y audience antes de llamar a PostgREST con sus JWT.

**11/11 grupos aprobados**, evidencia en
`INVENTARIO-RUTINAS-RECIBOS-RESULTADOS.json`:

| Caso | Resultado |
| --- | --- |
| JWT de líder, apoyo, retirado, ajeno y ADMIN | Firmas y sujetos reales comprobados en Auth local |
| RPC original tras retirar al actor | Fallo reproducido: devuelve recibo anterior, sin segunda escritura |
| Aplicación puntual del parche | Otras funciones, firma, propietario, ACL, search_path, inventario y recibos sin cambios |
| Retirado con mismo JWT, UUID y carga | Denegado sin identificadores de recibo |
| Ajeno, identidad distinta y carga distinta | Denegados sin alterar inventario |
| Líder y apoyo asignados | Recibos recuperables; dos envíos simultáneos y respuesta descartada/reintento producen un solo consumo |
| Perfil inactivo con JWT aún válido | Denegado; reactivación del perfil ficticio recupera el mismo recibo sin escribir |
| Rutina completada | Asignado activo recupera su recibo; una operación nueva se deniega; estado conservado |
| Devolución mediante RPC original `return_routine` | Tras eliminar la cuadrilla, antiguo recibo denegado |
| Roles de oficina | ADMIN/SUPERADMIN/SOPORTE conservan recuperación de recibo propio de recepción |
| Integridad | 4 consumos, 5 recibos, cero eventos; saldo y Kardex = 86; inventario previo intacto |

Precisión de los ensayos: los roles de oficina se verificaron con un JWT real
de una cuenta ficticia y cambios de rol efectivo en su perfil **de la base nueva**.
Su recibo de recepción se sembró como fixture; no se certifica una recepción
física nueva. Las escrituras de material sí ejecutaron la RPC y sus triggers
reales. La pérdida de respuesta se representó descartando el resultado y
reenviando la misma intención; no se hizo un corte físico de red. Los errores
de autorización preservan el formato SQL existente (P0001/HTTP 400), sin devolver
campos del recibo. No se cambió la traducción de errores frontend.

Se comparó el cuerpo de escritura con el original y las definiciones/ACL de
todas las demás funciones de la base antes/después. Los hashes de productos,
unidades, movimientos, eventos y recibos Campo del laboratorio anterior
coinciden con el baseline. No se repitieron suites aprobadas de etapas 1–4 ni
el conjunto completo de pruebas de Fase 162.

## Archivos y límites pendientes

- Migración puntual: `supabase/migrations/20261016020000_fase162_autorizacion_recibos.sql`.
- Preparación y ensayo: `scripts/inventory-auth-lab/routine-receipts-{prepare,validate}.mjs`.
- Este documento, JSON de resultados y referencias de bloqueo/RLS actualizadas.

La corrección queda lista para revisión local. Sigue pendiente el cierre RLS
administrativo de los consumidores Soporte/Clientes/Rutinas y las lecturas
backend con JWT. No se inicia ese trabajo en esta autorización puntual.

La compatibilidad con definiciones efectivamente desplegadas requiere su
revisión cuando corresponda; no se consultó Cloud y la huella bloquea una
aplicación sobre una RPC diferente. No se ha validado carga de toda la flota ni
carreras adicionales contra cierre/cambio de cuadrilla; se comprobó concurrencia
de dos reintentos de la misma intención y denegación después de revocación
confirmada. Los recibos ahora toman los locks de autorización y pueden esperar
a otra transacción, como las operaciones nuevas existentes. Sin cambios de
timeouts ni del protocolo offline. No se declara una garantía nueva sobre la
concurrencia global de Fase 162.

Rollback propuesto si alguna vez se aplica: sustituir únicamente esta RPC por
su definición exacta previa, preservando ACL/owner y sin borrar recibos ni
movimientos. Eso reabriría el fallo; solo como reversión controlada ante una
incompatibilidad. No volver a ejecutar la migración completa de Fase 162.
En esta entrega no hay rollback de Cloud que realizar.

Sin producción, Cloud, migraciones remotas, escrituras reales, ocho equipos
históricos, push ni despliegue. Datos y evidencia del nuevo ensayo conservados.
