# Conciliación ONT: cuantificación de la mejora por Averías (18/10/2026)

Lectura real en Supabase Cloud, solo lectura, autorizada explícitamente para
cuantificar la mejora local `defe251` (ver `ESTADO_DESARROLLO.md`). Misma
transacción `REPEATABLE READ READ ONLY` y mismo guion de compatibilidad ya
usado el 17/10 (`scripts/inventory-reconciliation-cloud-readonly.ps1`),
ampliado para incluir `tickets` y los cierres de Avería
(`work_order_closures` con `job_type='ticket'`) junto a las tablas ya
verificadas. El clasificador ejecutado es el real de `src/lib/inventoryReconciliation.ts`
(commit `defe251`), no una copia.

## Resultado: 0 coincidencias nuevas por Avería

A las 2026-10-18 03:01:33 UTC existen **29 tickets** en producción, pero
**0 cierres de Avería tienen `ont_serial` no nulo** — la misma situación ya
diagnosticada para Altas el 17/10 (0 cierres de instalación con serial).
Por tanto:

- **ONT "Sin verificar" antes:** 28 (lectura 17/10, 16:53 Perú).
- **ONT "Sin verificar" después:** 27 — la baja de 1 es por movimiento de
  stock real entre ambas lecturas (una unidad pasó de almacén a
  asignada/custodia), confirmado por `warehouseTicketSerialMatches: 0` y
  `ticketSerialMatchUnits: 0` en la categoría `onu`; **no** es efecto de la
  mejora de Averías.
- **Coincidencias nuevas por Avería:** 0 en las 95 ONT registradas (antes 94;
  +1 por alta real entre lecturas).
- **Coincidencias ambiguas o contradictorias:** 0 (no hay ninguna coincidencia
  que evaluar; `possible` en ONT se mantiene en 4, igual que el 17/10, sin
  relación con Averías).
- **TV Box "Sin verificar":** 18 → 17 (misma causa de movimiento real de
  stock; la lógica de TV Box no cambió — `warehouseTicketSerialMatches`/
  `ticketSerialMatchUnits` también en 0 por diseño, ver restricción a
  categoría `onu` en el clasificador).

Detalle completo por categoría: `docs/INVENTARIO-CONCILIACION-AVERIAS-RESUMEN.json`.
Snapshot anterior para comparar: `docs/INVENTARIO-CONCILIACION-REAL-RESUMEN.json`.

## Causa raíz confirmada

El cierre de Avería en App de Campo permite registrar `ont_serial`
(`src/stores/campo.ts`), pero en los 29 tickets existentes nunca se llenó ese
campo al cerrar. No es un defecto del clasificador ni de la consulta: es una
ausencia real de dato en campo, igual que con las Altas.

## Confirmación de solo lectura

Transacción `REPEATABLE READ READ ONLY`, `ROLLBACK` explícito, `transaction_read_only=on`
verificado antes de procesar. Sin `INSERT`/`UPDATE`/`DELETE`, sin RPC de
escritura, sin migraciones, sin cambios de RLS/permisos, sin push ni
despliegue. Los conteos operativos (134→135 unidades, 310→317 eventos de
Kardex, 275→287 movimientos) cambiaron por actividad real del negocio entre
ambas lecturas, no por esta sesión.

## Recomendación

**Sí conviene desplegar la mejora de código** (commit `defe251`): es inocua
(solo lectura, no reclasifica nada a `'installed'` por Avería, pruebas y
tipado en verde) y queda lista para capturar coincidencias automáticamente
el día que SÍ existan cierres de Avería con serial. Pero **no genera ningún
beneficio cuantificable hoy** porque el dato de origen no existe — desplegarla
sola no mueve ninguna cifra del reporte de Inventario.

Para que esta vía aporte valor real, el paso de mayor impacto es operativo,
no de código: pedir a los técnicos que registren el serial de la ONT también
al cerrar una Avería (igual que ya se hace en Altas), o evaluar si conviene
hacerlo obligatorio en ese formulario. Sin ese cambio de uso en campo, la
ampliación queda como capacidad preparada, no como resultado medible.
