# Corrección NOWAIT y recibos revocados — 16/10/2026

Continuación de `6326203` y la pausa del 15/10.
**LISTO PARA REVISIÓN LOCAL.** Se resolvieron las comprobaciones pendientes;
no se aplicó la migración ni se consultó/modificó Cloud en esta sesión.

## Corrección incluida

- La migración conserva `FOR SHARE NOWAIT` al comprobar job_assignees: evita
  esperar la fila de asignación mientras la RPC retiene el padre, rompiendo
  el ciclo reproducido con UPDATE/DELETE legacy de cuadrilla. La contención
  devuelve `55P03` y revierte toda la transacción, sin movimiento ni recibo.
- El cliente traduce `55P03`: «Hay otra operación en curso. Puedes reintentarlo
  de forma segura. Si hay una operación pendiente, usa “Confirmar operación de
  inventario pendiente”». No muestra nombres de tablas ni el error SQL crudo.
- Primer intento con SQLSTATE: mantiene el tratamiento de rollback confirmado.
  Tras una respuesta incierta: conserva UUID y carga originales; el mensaje
  no descarta ni reemplaza esa intención.

## Pruebas ejecutadas únicamente sobre lo pendiente

1. PostgreSQL aislado, caso `RPC reasigna antes`: **correcto para Alta y Avería**.
   Después del commit de reasignación, el técnico anterior recibe `42501` al
   corregir/reintentar y al pedir el recibo de su consumo anterior. El recibo
   no sustituye la autorización vigente. El nuevo técnico sí puede operar.
2. PostgreSQL aislado, caso `DML legacy ... no deadlock, rollback y reintento`:
   **correcto para DELETE y UPDATE**. No hubo `40P01`; inventario abortó con
   `55P03`, stock 100 y cero movimientos. Tras DELETE, reintento denegado.
   Tras UPDATE a apoyo, dos llamadas con la misma UUID dejan stock 99, una sola
   aplicación del consumo. Se cargó la migración real y las protecciones
   capturadas de Cloud en Docker efímero sin red, con roles/identidades sintéticos.
3. Dos pruebas TS nuevas, filtradas por `55P03`: **2/2 correctas**. Mensaje
   español sin detalles SQL; intención incierta conserva UUID y permite
   confirmación con la misma clave.
4. `npm.cmd run build`: **correcto**, vue-tsc y Vite; aviso existente de chunks
   mayores a 500 kB. `git diff --check`: correcto.

Las dos ejecuciones SQL dirigidas informan cada una 2 tests aprobados (prueba
principal + caso hijo); son **dos casos de integración**, no cuatro casos.
Se filtraron los demás casos aprobados ayer. No se repitieron las 17 SQL,
30 TypeScript ni escenarios de navegador anteriores. La compilación se ejecutó
porque cambió el helper que utiliza Campo.

Reproducción dirigida:

```powershell
node --import tsx --test --test-skip-pattern "cierre coordinado gana|inventario gana|devolución atómica|DML legacy|cancelación con|Fase 161 capturada|dos grupos históricos" server/tests/fieldInventoryCrew.sql.test.ts
node --import tsx --test --test-skip-pattern "cierre coordinado gana|inventario gana|RPC reasigna|devolución atómica|cancelación con|Fase 161 capturada|dos grupos históricos" server/tests/fieldInventoryCrew.sql.test.ts
node --import tsx --test --test-name-pattern 55P03 src/lib/__tests__/fieldInventoryOperation.test.ts
```

## Archivos exclusivos del commit

- `supabase/migrations/20261016010000_campo_inventory_operations.sql`.
- `src/lib/fieldInventoryOperation.ts` y su prueba existente actualizada.
- `server/tests/fieldInventoryCrew.sql.test.ts`: suite de integración guardada
  ayer, incluida ahora con la aserción de recibo revocado verificada.
- `docs/INVENTARIO-ETAPA-3-CUADRILLAS-CLOUD.json`: captura de ayer necesaria para
  reproducir la suite sin acceder a Cloud. Contiene definiciones/policies y
  agregados, no credenciales ni identificadores personales. Incluye dependencias
  existentes de Rutinas; no implementa ni cambia Fase 161/162.
- Este informe. Los documentos anteriores de pausa/preflight, sus ejecutores y
  cambios ajenos de Fases 161/162 quedan fuera del commit. La nota de sesión en
  ESTADO_DESARROLLO.md queda local para no mezclar sus cambios previos.

## Pendientes y límites

Siguen pendientes sesiones reales de líder/apoyo/ajeno con JWT y dispositivos
reales; no se simularon mediante service_role. La corrección demuestra ausencia
del deadlock en los escenarios probados, no una garantía universal para cualquier
transacción externa. Los permisos REST amplios anteriores continúan como trabajo
separado: no se cierran aquí ni se solicita aplicar la migración.

Cloud, las ocho unidades históricas y sus relaciones permanecen intactos.
Rutinas/Fase 162 no tienen cambios operativos. Sin push ni despliegue.
Rollback local: revertir este commit separado; volver a esperar la asignación
reintroduciría el riesgo de deadlock, por lo que no se recomienda para activar
la etapa. El rollback operativo futuro y la conservación de recibos descritos
en `INVENTARIO-ETAPA-3-IMPLEMENTACION.md` no cambian.
