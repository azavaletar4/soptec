# Decisiones financieras consolidadas (Fase 20 → Fase 26)

Documento único de decisiones ya resueltas por el propietario durante la
conciliación financiera masiva (Excel "Fibra Rayco.xlsx" vs SmartRayco).
**Fuente obligatoria para fases posteriores** — no reabrir nada de lo
listado aquí salvo evidencia nueva que lo contradiga. Referenciado desde
`ESTADO_DESARROLLO.md`.

## Principios permanentes

1. **SmartRayco prevalece** sobre el Excel en tarifas, fechas contractuales
   y PON — el Excel solo se usa para anclar pagos/periodos históricos
   (`anchorDate`), nunca para redefinir la tarifa o el PON vigente.
2. **Modalidades comerciales ya definidas**: `adelantado` = 7 días de
   gracia tras el vencimiento; `cumplido` = sin gracia, elegible a
   suspensión inmediata.
3. **Casos sin evidencia financiera suficiente quedan pendientes**, sin
   detener el resto del lote ni repetir preguntas de identidad/condiciones
   ya resueltas (DNI/nombre, cintillo, PON, tarifa).
4. **Nunca inventar deuda, pago o promoción** — una fila sin evidencia
   (sin pago anclable, sin periodo cubierto, sin cintillo/DNI que
   coincida) se excluye, no se asume en cero ni se asume cubierta.
5. **Nunca duplicar** pagos, facturas, periodos ni ingresos ya existentes
   en SmartRayco.
6. Restricciones permanentes de infraestructura: sin cortes/reconexiones,
   sin tocar OLT/MikroTik/XUI, sin WhatsApp, sin eliminar registros, sin
   ampliar el scheduler más allá de lo autorizado explícitamente.
7. **Respetar siempre las confirmaciones de seguridad del entorno** — ante
   un bloqueo del clasificador de escritura, detenerse e informar el
   bloqueo exacto; nunca intentar eludirlo.

## Estado autorizado y ejecutado de Fase 26 (26/11/2026)

Esta autorización posterior supera el límite anterior de 17 y la ausencia
de autorización productiva de Fase 25. **365 aperturas/S/22,690 mensuales
ejecutadas; total 524 incorporados. 36 mensualidades/S/2,355 emitidas,
FAC-2026-00107 a FAC-2026-00142. Scheduler efectivo 159**, únicamente los
17 AR/BAR y los 142 de Fase 24. Los 365 recién incorporados quedan fuera.
La gracia limita elegibilidad de corte, nunca impide emitir un ciclo iniciado.

No se crearon pagos históricos ni ingresos nuevos. Las 102 facturas previas,
pagos y saldos a favor se conservaron. Del lote nuevo hay 34 facturas
históricas preservadas: 14 pagadas y 20 pendientes/S/1,265; «34 pendientes»
en el plan anterior era una descripción imprecisa del total histórico.
Las 215 excepciones conservan su listado y huella, sin reabrir decisiones.

**Caja Chica: autorización exclusivamente local.** Implementados y probados
vínculo único del efectivo, separación de digitales, mixtos, identificación
de administradora, reversos auditados, cierre diario y retiros del
propietario separados. Migración y código sin aplicar/publicar en
producción, activación deshabilitada por defecto y sin importar cobros
antiguos. Aplicación, despliegue y habilitación requieren autorización futura.

Resultado detallado: `docs/finanzas-fase26-20261126/EJECUCION.md`.
Las secciones de Fase 24/25 que siguen conservan las decisiones y el
contexto histórico; sus límites anteriores no sustituyen este estado vigente.

## Decisiones por caso (ya resueltas, no reabrir)

- **BAR1-3 (9 contratos, Fase 21-22)**: 6 activos incorporados con
  condiciones de facturación + saldo inicial; cortesías (7) y correcciones
  de tarifa (3) aplicadas; 3 facturas de cortesía mal generadas canceladas
  vía transición `pending→cancelled` del propio guard. Excluidos: Zuli,
  Alina, Cristian (sin evidencia suficiente en ese momento).
- **Anderson Melchor Geronimo**: fecha de vencimiento real confirmada
  **29/11/2026** (no diciembre).
- **Jorge Lopez Boado (B4, `CTR-2026-00750`)**: sin ninguna fila en el
  Excel bajo su nombre/DNI — **sin evidencia, queda excluido**. No
  inventar su ancla. Su contrato MI (otro PON) no se toca ni se cruza con
  este caso.
- **Oficina ofi**: la corrección NO debe afirmar que los cobros
  precedieron la designación de cortesía — queda **pendiente**, sin
  ejecutar esa anotación todavía.
- **Rosmery**: regularizar liberando el `debt_hold_status` (sin deuda real
  verificada) — autorizado, sujeto a verificación de triggers de red antes
  de ejecutar (ver más abajo, fail-closed confirmado).
- **Alina**: suspender por confirmación expresa del propietario —
  autorizado, misma verificación de triggers.
- **2 marcas 🎁 (Kirkby Maldonado Salcedo, Anibal Perez Villanueva, CB)**:
  significado no confirmable (tarifa igual a la ya registrada, sin
  indicio de descuento real) — **excluidos** de este lote.
- **5 casos "se cortó DD/MM" (2 en B3, 3 en B4)**: evidencia real de corte
  de servicio no reflejada en `status` — **excluidos**, no auto-resueltos.
- **1 contrato "cumplido" (Jhon Garcia Rodriguez, REV, `CTR-2026-00208`
  con diferencia de tarifa S/100 vs S/85 Excel)**: requiere **confirmación
  administrativa agrupada explícita** antes de aplicar condiciones —
  nunca auto-aplicado solo por estar "listo" en los demás criterios.
- **1 factura histórica (Tereza Chirado Avila, B4)**: verificada sin
  riesgo de duplicado (ancla real posterior a esa factura) — se incluye
  normalmente en el lote.
- **Scheduler**: tope vigente **159 contratos**: los 17 AR/BAR originales y
  los 142 de Fase 24, autorizados y ampliados en Fase 26. Los 365 nuevos
  permanecen fuera; cualquier ampliación posterior exige autorización.
- **Debt-hold/suspensión**: el servicio `debtHoldService.ts` está
  **fail-closed** (`FINANCE_TECHNICAL_BLOCK`) — cero riesgo real de acción
  de red al tocar `debt_hold_status`/`status` en esta fase; confirmado por
  lectura de código, no repetir esta auditoría.

## Lote vigente (147 de 155, Fase 24 — ver `ESTADO_DESARROLLO.md` para el detalle de ejecución)

| PON | Listos | Facturación mensual |
|---|---|---|
| B3 | 29 | S/1,780 |
| REV | 37 (Jhon ya está excluido de los SQL originales) | S/2,420 |
| TS | 15 | S/945 |
| B4 | 47 | S/2,950 |
| CB | 19 | S/1,405 |
| **Total** | **147** | **S/9,500** |

SQL exacto ya generado (no recalcular) en
`scripts/inventory-auth-lab/runtime/finance-phase20-private/fase24-sql-batches/`.

## Resultado verificado de ejecución de Fase 24 (26/11/2026)

Se conservaron las decisiones anteriores y los SQL originales. El cotejo
de los archivos confirmó que **Jhon ya estaba excluido del lote de 147**;
la descripción previa de la fila REV era una inconsistencia documental,
no una autorización para incorporarlo ni cambiar su modalidad.

**142 incorporados, S/9,155 mensuales**: B3 28/S/1,720; REV 36/S/2,360;
TS 15/S/945; B4 44/S/2,725; CB 19/S/1,405. Los otros cinco (S/345/mes)
quedan pendientes por evidencia financiera insuficiente: los SQL
presentaban fechas futuras como `anchorDate`, sin fecha verificable de
recepción del pago. La RPC existente rechaza una ancla futura simple;
su modalidad de cobertura anticipada exige `receivedDate` real y ciclos
coherentes con el día contractual. **No se inventaron esas fechas ni se
modificaron las funciones para admitirlas.**

| Contrato | PON | Ancla futura preparada | Mensualidad |
|---|---|---|---|
| CTR-2026-00770 | B3 | 03/02/2027 | S/60 |
| CTR-2026-00668 | REV | 21/12/2026 | S/60 |
| CTR-2026-00366 | B4 | 29/11/2026 | S/50 |
| CTR-2026-00739 | B4 | 22/12/2026 | S/105 |
| CTR-2026-00478 | B4 | 03/12/2026 | S/70 |

Scheduler efectivo: **17 exactos (11 AR + 6 BAR), 1,440 minutos**. No
incluye ninguno de los 142 nuevos. Rosmery quedó `debt_hold_status=none`,
cortesía activa S/0; Alina `status=suspended`, solo administrativamente.
Oficina ofi y las exclusiones anteriores continúan pendientes.
Detalle de ejecución, respaldo, saldos y fechas: `ESTADO_DESARROLLO.md`
y `docs/finanzas-fase24-20261126/EJECUCION.md`.

## Continuidad de Fase 25 — preparación, sin autorización de nuevas escrituras

Se conservan todas las decisiones anteriores. **El scheduler autorizado
continúa limitado a 17**, aunque la propuesta local y las pruebas aisladas
contemplen llegar a 159. La propuesta no constituye autorización de emisión,
apertura, ampliación o despliegue.

Los 36 períodos de Fase 24 siguen sin emitir: al 26/11/2026, 11/S/700
están fuera de gracia y 25/S/1,655 en prórroga; no tienen duplicidades ni
ambigüedades detectadas. Se prepararon 365 aperturas adicionales por
S/22,690/mes en las once PON restantes y un caso adicional de B4, con las tarifas/días/PON SmartRayco y evidencia
ya conciliada. Se conservarán 34 facturas históricas por S/1,265 pendientes;
una apertura inicial sin deuda nueva no cancela ese saldo anterior.

Cristian conserva su exclusión específica de BAR: una clasificación
anterior contradictoria no reemplaza la decisión posterior. Los tres
servicios distintos de homónimos y Jorge B4 continúan sin pago propio
verificado, sin transferir evidencia de otro contrato. Los IPTV pendientes
de ficha no requieren PON/ONT/PPPoE. Las cinco anclas futuras de Fase 24
siguen pendientes; se identificaron otras cinco en las PON restantes.

El único listado operativo de excepciones está en
`scripts/inventory-auth-lab/runtime/finance-phase25-private/secure/EXCEPCIONES-CONSOLIDADAS.csv`:
215 filas únicas con motivo concreto, incluidas las exclusiones previas
todavía pendientes. No reabrir identidades, tarifas ni fechas resueltas.
El plan único y las pruebas están en
`docs/finanzas-fase25-20261126/PLAN_CONSOLIDADO.md`.

Aplicada en la preparación la regla ya aprobada de PON SmartRayco a las
coincidencias exactas de código que aparecen en otra hoja: Jordan
`CTR-2026-00232` conserva B4 y usa evidencia B6; Cesar `CTR-2026-00813`
conserva BO y usa evidencia REV. Son códigos únicos y no comparten fila
con otro contrato. Henry `CTR-2026-00650` sigue pendiente por una
anotación real de corte/retiro, conservando REV. No se cambió ninguna
ubicación ni se pidió resolver otra vez una identidad.

## Decisiones Fase 30 (27/11/2026) — Caja Chica: responsables y categorías

Autorizadas expresamente por el propietario durante la revisión de
experiencia de usuario de Caja Chica. **Solo decisiones de diseño —
ningún código, migración ni despliegue ejecutado todavía**; implementar
en una fase posterior con autorización explícita de despliegue.

1. **Responsables excluidos del selector de Caja Chica**: Alex Prueba,
   claude, Jadir Zavaleta, Jairo Bernabe, Jhordanno Zavaleta, Ruber
   Pizango. No volver a preguntar por esta lista — si surge evidencia de
   que alguno debe reincorporarse, es una decisión nueva del propietario,
   no una suposición.
2. **Responsables que deben seguir disponibles** (confirmados
   explícitamente, sin ser una lista cerrada de "los únicos permitidos"):
   alex raico, Alhely Lozano, ANGIE LAGUNA. El resto del personal activo
   no mencionado aquí **permanece visible por defecto** — la exclusión es
   la excepción, nunca la regla.
3. **Mecanismo**: una configuración administrable (tabla propia de Caja
   Chica, ej. `caja_chica_responsables_visibles`, auditada), **nunca una
   lista de nombres hardcodeada en el código**. Apagar a alguien solo lo
   oculta del selector de "Responsable" al crear un movimiento nuevo —
   nunca borra su historial ya registrado, nunca modifica sus permisos ni
   su acceso en ningún otro módulo del sistema (Soporte, Rutinas, App de
   Campo, etc. siguen intactos).
4. **Categorías de Caja Chica separadas por tipo (ingreso/egreso)**:
   conservar las 5 categorías manuales existentes (todas de egreso:
   Combustible, Mantenimiento vehículos, Insumos de instalación,
   Delivery/mensajería, Otros) con sus relaciones históricas intactas;
   agregar la dimensión de tipo sin recrear ni duplicar ninguna fila.
   Las categorías de ingreso son nuevas y empiezan vacías — se siguen
   creando igual que hoy ("+ Nueva categoría"), ahora quedando asociadas
   al tipo correspondiente. **Las categorías automáticas del sistema
   ("Cobros de clientes", "Retiros del propietario") no se tocan, no se
   duplican y nunca aparecen en el selector manual** — siguen siendo
   generadas únicamente por la conciliación de cobranzas y por el flujo
   de retiro del propietario, respectivamente.
5. **Alcance de esta fase**: propuesta visual actualizada en
   `docs/finanzas-fase30-20261127/prototipo-caja-chica.html` (pestaña
   "Responsables (configuración)" + categoría dependiente del tipo
   seleccionado). Implementación funcional, migración y despliegue
   quedan para una fase posterior con autorización expresa.

## Decisión Fase 30.1 (27/11/2026) — Requisito aprobado para una fase futura de cortes por deuda (solo documentado, SIN implementar)

Autorizada expresamente por el propietario durante la corrección
funcional de Fase 30. **Esto es únicamente un requisito registrado para
cuando se trabaje la fase de cortes por deuda — no se implementa, no se
migra ni se despliega nada de esto ahora.**

1. **Interruptor de corte automático individual por contrato**: cada
   contrato en Facturación/ficha del cliente tendrá su propio interruptor
   para habilitar o deshabilitar el corte automático por deuda —
   decisión por contrato, nunca una regla global para todos los clientes.
2. **Desactivado por defecto**: ningún contrato existente ni nuevo queda
   con el corte automático activado por el solo hecho de crear esta
   función — activarlo es una acción explícita y deliberada.
3. **Autorizados a cambiarlo**: únicamente ADMIN y SUPERADMIN.
4. **Auditoría obligatoria**: cada cambio de este interruptor (quién,
   cuándo, motivo) queda registrado, mismo patrón ya usado en todo el
   proyecto (`admin_audit_log`/`log_admin_audit`).
5. **Respeta todas las protecciones financieras ya aprobadas** en este
   documento y en `CLAUDE.md` — en particular: `debtHoldService.ts` sigue
   fail-closed (`FINANCE_TECHNICAL_BLOCK`) mientras no se autorice lo
   contrario explícitamente; el cruce de mora sigue siendo por
   `contract_id` exacto, nunca por `client_id` (regla 13ay de
   `CLAUDE.md`); cortesías y contratos suspendidos nunca generan
   elegibilidad de corte; la gracia por modalidad comercial (adelantado/
   cumplido) sigue siendo la que ya está vigente, no se redefine aquí.
6. **No se implementa todavía**: ni el interruptor, ni su migración, ni
   su RPC, ni ningún cambio a `debtHoldService.ts`/`debtHoldEligibility.ts`.
   Queda como requisito aprobado para cuando el propietario autorice
   explícitamente iniciar esa fase.
