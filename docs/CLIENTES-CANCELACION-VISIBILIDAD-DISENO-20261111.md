# Cancelación no instalada: diagnóstico y diseño pendiente de autorización

11/11/2026. **Sin corrección implementada, migración creada/aplicada,
push ni despliegue.** El usuario exige presentar el diseño y detenerse si
la solución requiere migración. Hace falta reemplazar la RPC vigente;
no se entrega una corrección parcial de interfaz.

## Causa raíz comprobada

`ClientServiceDetailView.vue`: `canCancelUnfulfilled` solo comprueba
SUPERADMIN; el `v-if` añade `contract.status !== 'cancelled'`. Ni abrir el
modal ni confirmar comprueban evidencia de instalación. Por tanto, el
botón aparece incluso para servicios instalados. `contracts.ts` llama
directamente a `contract_cancel_unfulfilled`, sin backend HTTP intermedio.

Consulta del 11/11 a las 12:26:15 UTC (07:26 Lima), transacción READ ONLY:
Carlos Castillo Melendez, `CTR-2026-00400`, contrato y cliente `active`,
un único contrato, usuario PPPoE presente, sin XUI ni facturas. **No hay
filas de instalación**, ni por cliente ni por contrato, ni cierres del
cliente. ONT `412f741c-1f1b-42c9-a113-be28648487e2`, estado almacenado
`online`, vinculada al contrato exacto `1cb97bb3-534b-4548-8f0c-16b4f83b69c1`.
La ausencia de Alta no demuestra ausencia de instalación física; es
compatible con un servicio incorporado sin Alta histórica (inferencia).
No se consultó la OLT física ni se comprobó tráfico de Internet.

La RPC **sí existe en producción** y su definición coincide en lógica con
la propuesta anterior. Bloquea SUPERADMIN inactivo/otros roles, falta de
confirmación/motivo, revisión obsoleta, Alta abierta, instalación
`completed`, factura, ONT, unidad asignada y tickets/rutinas abiertos.
Mantiene bloqueo transaccional del cliente, contratos e instalaciones,
auditoría e idempotencia. Para Carlos, rechazaría por ONT vinculada
(`PNI13`), demostrado con su patrón en datos sintéticos, sin invocarla
en producción. No se encontró evidencia de una cancelación real indebida.

El hueco del servidor: ausencia de filas se interpreta como elegibilidad;
solo busca `status='completed'` y por contrato exacto. Ignora `completed_at`
persistente, Altas sin contrato y asociaciones PPPoE/XUI al evaluar la
elegibilidad. Es posible cancelar casos ambiguos si faltan las otras
barreras. Ocultar el botón por sí solo no satisface el objetivo.

Cómo se registra el cierre: Campo actualiza `installations.status` a
`completed`; el trigger vigente `trg_installations_completed_at` asigna
`completed_at` al entrar en ese estado y no lo limpia al salir. La relación
es `installations.contract_id -> service_contracts.id` (nullable), además
de `client_id`. Una muestra completada de solo lectura confirma contrato
exacto, mismo cliente y fecha de finalización. El estado contractual sigue
siendo independiente de la orden.

## Diseño mínimo propuesto; todavía sin SQL ni cambios de aplicación

1. Migración **solo de funciones**, sin tablas/columnas/estados nuevos:
   extraer la elegibilidad a una función de consulta acotada y reemplazar
   `contract_cancel_unfulfilled` para reutilizarla después de sus bloqueos
   y antes de escribir. Mantener permisos, firma de cancelación,
   confirmación, timestamp, auditoría, idempotencia y transición del titular.
   La consulta no debe tomar bloqueos de escritura ni cancelar nada;
   comprobar perfil vigente y devolver solo elegibilidad/motivo del contrato.
2. Evidencia positiva: al menos una Alta `cancelled` del contrato exacto y
   mismo cliente; todas las Altas de ese contrato canceladas, sin
   `completed_at` ni cierre técnico asociado. Rechazar si falta historial,
   hay Alta abierta/completada, vínculo de cliente contradictorio o Alta
   del titular sin contrato que haga incierta la atribución. Bloquear
   estados inesperados y cualquier error de consulta.
3. Conservar todas las barreras actuales. También rechazar si hay
   `completed_at` aunque cambió el estado, cierre técnico previo, o
   indicios de servicio como PPPoE/XUI/código de cliente. Una asociación
   administrativa puede preceder a la instalación: bloquearla es una
   decisión conservadora, no una afirmación de instalación física.
   No consultar routers/equipos ni cambiar sus datos o reglas.
4. Frontend: consultar elegibilidad por contrato exacto, oculta mientras
   carga o ante error/resultado incompleto; validar rol y revisión/identidad
   de respuesta, descartando respuestas de otro contrato al navegar.
   Usar la misma condición al mostrar, abrir y confirmar. El servidor
   revalida siempre; el resultado de consulta no autoriza una escritura.
5. Varios servicios: completadas atribuibles a otro contrato no bloquean
   por sí solas una línea con evidencia suficiente. Las Altas sin vínculo
   son ambiguas, nunca se atribuyen al contrato único por suposición.
   Recalcular el titular con la lógica existente y preservar sus otras
   líneas. Revisar concurrencia con cierre/reasignación de Altas usando los
   bloqueos existentes ampliados a las filas con vínculo contradictorio.

Se conservan **Activo, Suspendido y Cancelado**; sin cambios a facturación,
PPPoE, OLT, inventario ni datos existentes. Rollback futuro: restaurar la
definición de RPC capturada y retirar la función de consulta nueva; no
revertir estados ni historial. Migrar y desplegar requieren autorización
separada; este documento no es un SQL ejecutable.

## Pruebas ejecutadas y aceptación posterior

- UI/store existentes: 7/7 PASS.
- SQL candidato anterior, PostgreSQL 17 efímero sin red: 14/14 PASS.
- Definición **leída de producción**, cargada solo en PostgreSQL 17
  efímero sin red, datos sintéticos: 12/12 PASS de caracterización.
  Incluye completada, las tres Altas abiertas, cancelada, patrón Carlos,
  varios contratos y las cuatro brechas descritas. Estos PASS confirman
  la conducta actual, **no acreditan una corrección**.

Tras autorización, convertir los cuatro casos de brecha en regresiones
que exijan rechazo sin cambios. Agregar falta/error de consulta, carreras
de navegación, cierre concurrente, XUI/código de cliente y vínculos
contradictorios; probar el botón real con evidencia completada, abierta,
cancelada y ambigua. Ninguna prueba de escritura usa clientes reales.

Riesgo pendiente: el botón y las brechas actuales siguen en producción.
El diseño puede excluir preventivamente contrataciones válidas con datos
incompletos o asociaciones previas; deben revisarse administrativamente.
La protección actual por ONT cubre a Carlos con los datos consultados.

Evidencia: `CONTRATACION-NO-INSTALADA-LECTURA-20261111.json` (sin secretos),
consulta fija `scripts/diagnostics/contract-unfulfilled-readonly.sql`,
lector `scripts/contract-unfulfilled-readonly.ps1` (TLS verify-full,
credencial DPAPI por stdin, SQL READ ONLY) y caracterización reproducible
`server/tests/contractCancelUnfulfilled.diagnostic.test.ts`.
Prueba: `node --import tsx --test server/tests/contractCancelUnfulfilled.diagnostic.test.ts`.
