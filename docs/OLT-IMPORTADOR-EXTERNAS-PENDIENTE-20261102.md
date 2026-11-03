# Pendiente — usar el importador existente para ONT autorizadas externamente

**Estado: tarea identificada, NO iniciada.** Documental únicamente — no se
tocó código, Supabase ni la OLT en esta nota.

## Contexto

Dos incidentes reales de la misma OLT (ZTE C300) en esta sesión:

1. Gustavo Reyes Sandoval (CTR-2026-00764): su ONT real
   (`ZTEGD4FE1386`, posición `gpon-onu_1/2/8:26`, online, VLAN 120) fue
   autorizada directamente en **SmartOLT** el 30/10/2026 porque SmartRayco
   no respondía en ese momento. Nunca pasó por el flujo propio de
   "Autorizar ONT" de SmartRayco, así que nunca quedó una fila en
   `olt_onts` — es real, está en servicio, y SmartRayco simplemente no la
   conoce.
2. El indicador "ONTs pendientes de vincular" (recién mejorado, commit
   `025a495`) **no puede** mostrar este caso: solo lista filas que YA
   existen en `olt_onts` sin cliente/contrato completo. Una ONT que nunca
   se importó no tiene fila que listar — confirmado explícitamente en el
   propio panel con un aviso fijo.

## Qué ya existe (no duplicar)

`POST /api/olt-devices/:id/onts/import-existing` (`server/src/routes/olt.ts`,
línea ~751) ya es exactamente el mecanismo correcto para este escenario
("Situación A" de la migración OLT, ver `CLAUDE.md`): escanea la OLT real
completa, verifica identidad por serial, **nunca sobrescribe** una fila ya
vinculada a un cliente/contrato, y reporta conflictos (serial distinto en
una posición ya vinculada) para revisión manual en vez de resolverlos solo.
No escribe nada en la OLT — solo lee de la OLT y escribe filas nuevas (o
actualiza metadata no identitaria) en `olt_onts`.

El frontend ya tiene el botón correspondiente en `oltStore.importExistingOnts()`
(`src/stores/olt.ts`), consumido donde ya se usa en `OltDetailView.vue`.

## Por qué no se ejecutó todavía

Esta sesión, cada diagnóstico de OLT se mantuvo deliberadamente acotado a
consultas puntuales de una sola posición/puerto (nunca un escaneo completo),
por restricción explícita del propietario en cada tarea ("no iniciar
sincronización masiva"). El importador SÍ hace un escaneo completo de la
OLT por diseño (es necesario para detectar conflictos de identidad en
cualquier posición, no solo la reportada) — por eso queda para una
autorización aparte, con la OLT en un momento de bajo tráfico si se
prefiere.

## Procedimiento seguro propuesto (para la próxima sesión/autorización)

1. Confirmar `HEAD`/`origin/main` y que no hay cambios locales pendientes
   antes de ejecutar nada contra producción.
2. Ejecutar `POST /:id/onts/import-existing` desde el panel (botón
   "Importar ONTs desde la OLT") en un momento sin sincronización activa.
3. Revisar la respuesta: `imported` (cuántas filas nuevas/actualizadas),
   `conflicts` (posiciones con identidad distinta — revisar una por una,
   nunca resolver en masa) y `failedPorts` (puertos que no respondieron).
4. Confirmar en Supabase (solo lectura) que apareció la fila esperada para
   Gustavo Reyes Sandoval: `frame=1, slot=2, port=8, ont_id=26,
   serial='ZTEGD4FE1386'` — y que NO quedó vinculada automáticamente a su
   cliente/contrato todavía (el importador es solo identidad/metadata, no
   asigna cliente).
5. Vincular esa fila a Gustavo (CTR-2026-00764) por el flujo normal de
   edición de ONT ya existente — nunca reprovisionarla ni tocar VLAN/GEM/
   PPPoE, que ya funcionan.
6. Repetir la verificación del indicador "ONTs pendientes de vincular":
   debería seguir mostrando 4 (las mismas de antes) — la fila de Gustavo
   no debería aparecer ahí porque quedará correctamente vinculada en el
   mismo paso 5, no como una quinta "pendiente".

## Riesgo si se pospone

Ninguno para el cliente (su servicio ya funciona vía SmartOLT/OLT real,
independiente de SmartRayco). El riesgo es puramente administrativo:
mientras no se importe, SmartRayco no puede mostrar el estado/señal/alertas
de esa ONT ni contarla en los indicadores del panel — y es probable que
existan más casos iguales (cualquier ONT autorizada por SmartOLT durante
alguna falla de SmartRayco) que solo el importador completo revelaría.
