# Preparación de instalación Fase 162 — actualización de revisión

**Actualización:** el deadlock siguiente se reprodujo y corrigió localmente con
FOR SHARE NOWAIT; 9/9 grupos de concurrencia, 2/2 de instalación y 3/3 del helper
aprobaron. Procedimiento vigente y huellas actualizadas en
`FASE162-DEADLOCK-CORREGIDO.md`: **LISTO PARA REVISIÓN LOCAL**, no autorización
de Cloud. El texto siguiente conserva la preparación histórica rechazada;
sus huellas antiguas no identifican el artefacto runtime actual. No ejecutarlo.

16/10/2026. Base funcional `299b42e` y corrección de recibos `7e6abd5`.
No se autoriza ni se ejecuta la instalación. No se modificó código de negocio.

## Dependencias reales y compatibilidad estructural

Se ejecutó el preflight existente por SQL de solo lectura, con TLS verify-full,
READ ONLY y timeouts. Evidencia actual: `FASE162-PREPARACION-CLOUD.json`,
capturada a las 14:50:49 Lima. Contiene 87 filas sin bloqueo y un resumen
COMPATIBILIDAD ESTRUCTURAL OK; las filas de revisión manual no sustituyen la
validación funcional. Solo se recuperaron metadatos y agregados necesarios.
Los seis helpers referenciados por los triggers se recuperaron por lectura
adicional acotada en `FASE162-PREPARACION-HELPERS-CLOUD.json`.

- Columnas/tipos necesarios, enums, roles, claves destino y permisos del
  migrador compatibles. Unidades de consumibles observadas: `metros`, `unidad`.
  Cero productos con saldo negativo/no finito.
- Huellas de `current_user_role`, saldo y dispatcher Fase 151 coinciden con las
  revisadas. No cambiar ni relajar esas guardas. Fase 161 está instalada por
  objetos/función; no reinstalarla.
- Fase 162 no está instalada: objetos nuevos ausentes y sin colisiones.
  El parche de recibos solo puede seguir a la creación de la RPC original.
- Se recuperaron definiciones efectivas de triggers, funciones, políticas,
  columnas, constraints e índices de las tablas involucradas. No se asumió que
  las migraciones del repositorio reflejaran Cloud.
- Conteos observados: 126 unidades, 299 eventos, 271 movimientos y los mismos
  ocho asignados sin contrato. No se investigaron ni modificaron esos ocho.

## Bloqueo funcional reproducido

PostgreSQL 17 efímero, sin red ni puertos, datos exclusivamente ficticios.
Se cargaron las políticas y definiciones de triggers capturadas, incluidos
`trg_job_assignees_lock_parent` y `lock_job_crew_parent` realmente desplegados,
además de los helpers y protecciones de cierre. No se restauraron datos reales.

La carrera entre recuperación de recibo y retirada mediante DELETE de
`job_assignees` produjo un **deadlock**:

1. A retiene el lock de la Rutina, que la RPC toma antes de bloquear cuadrilla.
2. B hace DELETE de la asignación: retiene su fila y su trigger BEFORE intenta
   bloquear la Rutina, por lo que espera a A.
3. A recupera el recibo mediante la RPC corregida, cuyo `FOR UPDATE` de cuadrilla
   espera la fila retenida por B. PostgreSQL detecta el ciclo y aborta A.

El ensayo introduce una pausa mediante el prefijo transaccional de locks para
forzar ese interleaving; no modifica la RPC ni el trigger de Cloud. A terminó
con error de psql 3 y `deadlock detected`; B confirmó correctamente. No fue un
timeout. El mismo orden Rutina→cuadrilla existe en operaciones técnicas nuevas.
No se afirma que todas ellas se hayan probado en esa carrera, ni que el fallo
se haya ejecutado en producción.

No basta que la migración compile y pase postchecks para declararla segura.
La corrección de recibos previamente aprobada sin estas protecciones sigue
siendo válida en su alcance, pero **no certificaba esta compatibilidad**.
No se cambió ahora el SQL funcional para resolver el bloqueo ni se añadió una
funcionalidad. Es necesario revisar puntualmente la adquisición de locks frente
a la edición directa de cuadrillas y su manejo/reintento antes de autorizar.

## Pruebas nuevas ejecutadas

`node scripts/tests/fase162-installation-compatibility.cjs`:

| Comprobación | Resultado |
| --- | --- |
| Fase 162 original y parche de recibos, en una sola transacción | PASS |
| Snapshot de diez tablas ficticias antes/después de instalar | PASS: saldos, contratos, órdenes y ocho históricos ficticios idénticos; cero recibos creados por instalar |
| Políticas previas antes/después | PASS: idénticas |
| Postcheck del conjunto, incluida nueva huella de RPC | PASS: funciones/ACL/search_path/guards/índices/siete FK |
| Consumo y recuperación con políticas/triggers capturados | PASS: un movimiento, un recibo, stock 99 desde 100 |
| Recuperación concurrente con retirada de cuadrilla | **FAIL: deadlock** |
| SQL nuevo de invariancia de datos | PASS sintáctico en la base ficticia separada, exclusivamente READ ONLY |

Resultados reproducibles y SHA-256 en `FASE162-INSTALACION-ENSAYO.json`.
El contenedor se detuvo/eliminó al terminar; el laboratorio Auth previo no se
tocó. Este ensayo usa rol authenticated y `auth.uid()` en SQL, **no son nuevas
pruebas JWT**. No se repitieron las 11 pruebas JWT ni las suites ya aprobadas.

Alcance del fixture: reproduce definiciones de políticas/triggers y completa
columnas necesarias; no es un clon íntegro de Cloud. Grants legacy y constraints
externos no se certifican como réplica exacta. El deadlock con la protección
real basta para impedir autorización; no se presenta una validación global
aprobada ni se extrapola una prueba completa de todos los contratos reales.

## SQL exacto previsto, NO EJECUTAR con el bloqueo actual

Orden lógico exclusivo, sin incluir etapas 1–4 de Campo ni reinstalar 151/161:

1. `supabase/migrations/20261015180000_fase162_inventario_rutinas.sql`
   SHA-256 `16a7d9a05dfb6b02ddce08051f7293a93bb246429ca8237229c81ac46748b225`.
2. `supabase/migrations/20261016020000_fase162_autorizacion_recibos.sql`
   SHA-256 `ba75c72224b4638428712341f2352ba6baaab1690cc1a9b2a937575c1fb0639c`.

Ambos contenidos deben formar **una única transacción**, sin BEGIN/COMMIT
internos, con lock_timeout 2 s y statement_timeout 60 s; cualquier error
revierte todo. Así nadie puede invocar la RPC original sin corregir entre
commits. No ejecutar dos archivos originales como transacciones independientes.
No ejecutar indiscriminadamente el directorio de migraciones.

El ensayo conserva el artefacto exacto en
`scripts/inventory-auth-lab/runtime/fase162-installation-bundle.sql`, SHA-256
`b520a0ae7e544dd280cce481d77cb681c9c2e540de4b183daa8cbcff27b93e32`.
Es un artefacto local bloqueado, no una tercera migración ni una orden para
aplicarlo. Tras corregir el bloqueo habrá que volver a revisar las huellas del
conjunto; estas corresponden al conjunto actualmente rechazado.

## Respaldo preparado, todavía pendiente de ejecutar/verificar

Reutilizar `scripts/respaldar-fase162-final-privado.ps1`: dump privado con TLS,
ACL restringida, hash, comprobación de lectura y restauración aislada sin red.
Introducir credenciales solo en sus entradas privadas locales, nunca en chat.
No se ejecutó ahora ni se generó copia de datos operativos.

Antes de una futura autorización: obtener respaldo actualizado con Fase 161 ya
instalada, manifiesto/hash y restauración verificados. El respaldo antiguo
documentado es anterior a cambios posteriores y no se acredita como snapshot
actual. Ese respaldo no cubre archivos Storage, membresías globales completas
ni claves externas Vault; acordar cobertura por separado y no restaurar un dump
antiguo sobre producción actual como rollback ordinario.

## Orden operativo propuesto tras levantar el bloqueo

1. Revisar la corrección puntual de locks y su ensayo; no autorizar con un
   deadlock pendiente. Confirmar artefactos finales, respaldo actual verificado,
   responsable y ventana breve sin escrituras de inventario/órdenes/cuadrillas.
2. Repetir solo el contraste de dependencias si cambió el destino; guardar el
   baseline de `scripts/tests/fase162-installation-data-check.sql` y las
   definiciones/ACL previas. No activar aún el frontend nuevo.
3. Con autorización expresa futura, aplicar el conjunto atómico revisado.
   Registrar versiones/huellas mediante el mecanismo aprobado; no corregir
   manualmente el ledger ni reinstalar objetos solo porque falte su entrada.
4. Ejecutar únicamente lecturas de
   `scripts/tests/fase162-installation-postcheck.sql` y el data-check; comparar
   hashes/conteos protegidos durante la misma ventana. Sus diferencias solo
   descuentan columnas nullable nuevas; ocho históricos deben seguir iguales.
5. Autorizar frontend por separado tras postchecks e integridad correctos.
   Mantener pendientes Flutter físico/arranque offline documentados. No usar
   consumos/retiros reales para probar instalación; transacciones funcionales
   y carreras se validan con datos ficticios.

## Rollback conservador preparado, NO ejecutado

- Si falla la transacción de instalación: ROLLBACK completo, sin frontend nuevo.
- Si falla un postcheck antes de habilitar el uso: mantener frontend anterior,
  detener la habilitación de la RPC y conservar evidencia; no reejecutar a ciegas.
- Si ya hubo uso: congelar nuevas operaciones y, con autorización expresa,
  revocar EXECUTE de la RPC a authenticated. Esto también bloquea oficina:
  coordinar resolución/recepción administrativa controlada de pendientes antes
  de retirar la UI. Conservar recibos, FK, columnas, guards, eventos y saldos.
  No hacer DROP ni restaurar el dispatcher Fase 151 sobre unidades de Rutinas.
  Volver al frontend previo no deshace consumos ni devuelve equipos físicamente.
- No restaurar saldos ni borrar historial automáticamente. Restaurar respaldo
  completo es recuperación de desastre con revisión de datos posteriores.

## Archivos de preparación

Tres JSON de captura/ensayo, este documento, el ensayo focalizado y dos SQL de
postchecks/invariancia. Se actualiza la referencia del informe previo, sin
alterar migraciones originales ni la corrección `7e6abd5`. Preparación local sin
commit de código funcional, push, despliegue, migraciones remotas ni cambios
de permisos o datos reales. No continuar el desarrollo después de este informe.
