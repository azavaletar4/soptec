# Cancelar contratación no instalada — paquete de migración y despliegue (preparado, SIN ejecutar)

Fecha: 2026-11-02. Continuación de `docs/CLIENTES-CONTRATACION-NO-INSTALADA.md`
(causa raíz, diseño, pruebas SQL/UI). Este documento es el **paquete listo
para producción** — qué aplicar, cómo verificarlo y cómo revertirlo — sin
haber tocado Supabase Cloud ni la VM de producción.

## Qué se valida aquí y cómo

Autorización: "entorno de prueba aislado con PostgreSQL temporal y datos
ficticios". Se montó, se usó y se desmontó por completo en esta sesión:

- **PostgreSQL 17 temporal** (Docker, `--tmpfs`, puerto local 15432) — NUNCA
  Supabase Cloud. Se cargó el mismo esquema sintético de
  `server/tests/clientRetirement.fixture.sql` + la migración candidata real
  (`docs/sql/contract-cancel-unfulfilled-proposal.sql`, sin modificar) + 3
  clientes/contratos **ficticios** (`CTR-VAL-0001/0002A/0002B/0003`,
  documentos `VAL-000x`, claramente marcados "(prueba)") — ningún dato real.
- **PostgREST 14.17** (Docker, imagen oficial) apuntando a ese Postgres —
  mismo motor de API que usa producción, para que las políticas RLS y la
  RPC se probaran exactamente como se ejecutan de verdad, no simuladas.
- Un *proxy* mínimo local (script Node desechable, sin dependencias nuevas)
  que traduce `/rest/v1` ↔ PostgREST y responde `/auth/v1/user` con un
  usuario sintético a partir del propio JWT — reemplaza a GoTrue, que no
  hace falta aquí (nadie valida contraseñas en esta prueba).
- **Chrome real** (extensión Claude in Chrome) contra un **Vite real**
  (`npm run vite`, puerto 5180) apuntando a ese stack — nunca al `.env` real
  del proyecto (se usaron variables de entorno de arranque, no se tocó
  ningún archivo `.env`).
- Un componente Vue **temporal y desechable**
  (`src/views/_TempCancelUnfulfilledHarness.vue` + una ruta temporal en
  `src/router/index.ts`) que reutiliza el **store y cliente reales**
  (`useAuthStore`, `useContractsStore().cancelContractUnfulfilled`,
  `supabase`) y la misma lógica/markup del botón y modal ya agregados a
  `ClientServiceDetailView.vue` — sin montar las ~14 dependencias ajenas de
  esa vista (Mikrotik, XUI, OLT, NAP, inventario, fotos...), que son
  subsistemas no relacionados con este cambio. **Ambos archivos temporales
  ya se borraron** al cerrar esta sesión; `git status` confirma que
  `src/router/index.ts` quedó byte a byte igual al original.

JWT de prueba firmados con HS256 y un secreto desechable, usando solo
`node:crypto` (sin dependencias nuevas) — nunca con las claves reales del
proyecto.

## Resultados — navegador real, Postgres real, RLS real

| Caso | Resultado |
| --- | --- |
| **SUPERADMIN**: botón visible | PASS — confirmado visualmente |
| **ADMIN**: botón oculto (`(botón oculto: rol actual no es SUPERADMIN)`) | PASS — confirmado visualmente |
| **Escenario 1** — Alta cancelada, sin otro servicio: cancela, ficha → `prospect`, motivo guardado | PASS — `CTR-VAL-0001` → `cancelled`; `contract_unfulfilled_cancellations` con el motivo exacto tecleado en el navegador |
| **Escenario 2** — múltiples contratos: cancela solo la línea elegida | PASS — `CTR-VAL-0002A` → `cancelled`; `CTR-VAL-0002B` intacta (`active`); ficha del cliente sigue `active` (verificado en la base, no solo en pantalla) |
| **Escenario 3** — instalación completada: bloquea | PASS — mensaje en pantalla tal cual lo devuelve la RPC ("Esta línea ya tuvo una instalación completada; use la baja administrativa existente"); contrato siguió `active`, cero filas nuevas en el historial (verificado en la base) |
| Motivo obligatorio (botón deshabilitado con <5 caracteres) | PASS — confirmado visualmente con "ab" |
| Confirmación con el contrato exacto en el texto | PASS — mensaje real capturado: *"Se cancelará la línea CTR-VAL-0001 por no haberse instalado. El cliente volverá a Prospecto si no tiene otro servicio vigente. ¿Confirmar?"* |
| Sin afectar otros contratos/inventario/facturación/historial | PASS — ya cubierto exhaustivamente por las 14 pruebas SQL de la sesión anterior; aquí se confirmó además en el caso real de múltiples contratos (tabla, no solo UI) |
| Transaccional / sin estados parciales | PASS — ya probado en SQL (Escenario 3 bloqueado no dejó ninguna fila nueva ni cambio de estado, confirmado también aquí en la base real tras el intento) |
| Rollback | Ya probado en la suite SQL de la sesión anterior (retira solo la función, conserva historial/estados) — no se repitió aquí, no aporta nada nuevo hacerlo contra este mismo stack desechable |

### Hallazgo de infraestructura de prueba (no es un defecto de la RPC ni de producción)

El `auth.uid()` que usa `server/tests/clientRetirement.fixture.sql` (fixture
compartido de pruebas SQL) está escrito para leer
`request.jwt.claim.sub` — una convención antigua de PostgREST. PostgREST
14.17 (la versión real que usa este proyecto, confirmada en la imagen de
producción) ya no expone esa variable individual, solo el JSON consolidado
`request.jwt.claims`. Los tests SQL existentes (`contractAdministrativeCancellation.sql.test.ts`,
el mío) nunca lo notan porque fijan esa variable a mano vía `SET`, sin pasar
por la traducción real de PostgREST. Al validar con PostgREST real por
primera vez, esto sí se manifestó — se corrigió **solo en la base temporal
de esta sesión** (ya destruida), nunca en el fixture compartido ni en
ningún archivo del repo. **No afecta a producción**: el `auth.uid()` real
de Supabase ya usa la convención moderna (`request.jwt.claims`), coincide
con lo que PostgREST 14 realmente envía. Se deja registrado por si una
futura sesión intenta este mismo tipo de validación con navegador real.

## Paquete a aplicar en producción (cuando se autorice)

**Un solo archivo, ya escrito y ya probado dos veces** (suite SQL aislada +
este stack con PostgREST real): `docs/sql/contract-cancel-unfulfilled-proposal.sql`.
No requiere ningún otro cambio de esquema. Mismo patrón que el despliegue
real ya existente de `contract_cancel_administrative` (ver
`docs/CLIENTES-BAJA-LINEA-ADMINISTRATIVA.md`): este tipo de RPC administrativa
se aplica directamente contra Supabase (SQL Editor o
`mcp__claude_ai_Supabase__apply_migration`), no como archivo numerado en
`supabase/migrations/` — no se introduce un criterio nuevo.

### Procedimiento (sin ejecutar todavía)

1. **Confirmar el entorno destino** — ¿producción (`mzupdnjegfwmpajywckd`,
   el único proyecto activo real) o primero un branch/preview de Supabase
   si está disponible? Pedir instrucción explícita.
2. Leer el contenido completo de `docs/sql/contract-cancel-unfulfilled-proposal.sql`
   una vez más contra el esquema real (no asumir que nada cambió desde que
   se escribió) — en particular confirmar que `invoices`, `tickets`,
   `routines`, `olt_onts`, `inventory_units`, `service_contracts`,
   `installations`, `clients`, `profiles` siguen con las mismas columnas
   que usa la RPC.
3. Aplicarlo en una única transacción (el archivo ya empieza con `begin;` y
   termina con `commit;` — si cualquier paso falla, no se aplica nada).
4. **Verificación post-aplicación** (solo lectura):
   - `select proname from pg_proc where proname='contract_cancel_unfulfilled';`
   - `select * from information_schema.tables where table_name='contract_unfulfilled_cancellations';`
   - Confirmar que `contract_administrative_guard` (la guarda ya viva en
     producción) sigue existiendo sin cambios — esta migración no la toca.
5. **Prueba funcional real**, solo si el propietario autoriza un caso real
   concreto (ver el procedimiento de regularización de Jheraldin/Fiorella/
   Daniel en `docs/CLIENTES-CONTRATACION-NO-INSTALADA.md`) — nunca una
   prueba genérica contra un cliente real solo para "probar que funciona".
6. Publicar el frontend ya presente (`src/stores/contracts.ts`,
   `src/views/clientes/ClientServiceDetailView.vue`) — hoy el botón ya
   existe en el código pero, sin la RPC aplicada, muestra el mensaje "Esta
   acción todavía no está habilitada..." en vez de un error técnico (ya
   probado, ver `docs/CLIENTES-CONTRATACION-NO-INSTALADA.md`).

### Rollback (si algo sale mal después de aplicar)

`docs/sql/contract-cancel-unfulfilled-rollback.sql` — retira solo
`contract_cancel_unfulfilled(...)`. **No borra** `contract_unfulfilled_cancellations`
ni ningún dato ya escrito por la función (mismo criterio que el resto del
proyecto: nunca se pierde historial). Si se necesita revertir también el
historial de alguna cancelación puntual hecha por error, eso es una decisión
operativa aparte — no la cubre este rollback ni se automatiza aquí.

## Autorización exacta que se necesitaría para producción

Para avanzar más allá de este punto hace falta, por separado:

1. **Autorización para aplicar la migración** en Supabase (decir
   explícitamente contra qué proyecto/entorno).
2. **Autorización para publicar el frontend** (commit + push + build +
   deploy a la VM) — nada de esto se hizo ni se preparó como paquete de
   despliegue de la app todavía, solo el candidato local.
3. Por separado, para los casos reales: autorización puntual para cada uno
   de Jheraldin/Fiorella/Daniel, **después** de confirmar con campo/ventas
   que de verdad nunca se instalaron (ver el procedimiento ya escrito).

Nada de esto se ejecutó en esta sesión.
