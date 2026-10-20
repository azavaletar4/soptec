# OLT: identidad por serial antes de estado y potencia — preparación local

Fecha: 20/10/2026. Rama fix/olt-identidad-serial-20261020.
Base e679d9c9254746a7fe50ba317eabf7cb1d2c8871.
Sin push, despliegue, migraciones ni conexión a producción durante esta corrección.
Se preservan el checkout principal, sus 216 archivos pendientes y dceafa0.

## Diagnóstico y corrección

La sincronización anterior resolvía olt_onts por OLT/frame/slot/port/ont_id,
sin consultar el serial actual de esa posición. La fila MSTC8CCE647E recibía
estado/potencia de la ONT que reemplazó esa posición. El diagnóstico comprobó
HWTCE5C94DB6 (con E después de HWTC), no HWTC5C94DB6. El otro serial se mantiene
HWTCDEB847B6, la Huawei de Janet. No se volvió a consultar esa OLT en esta fase.

El lector compartido obtiene inventario completo de seriales antes y después
 de las lecturas. Solo publica y persiste mediciones si ambos inventarios
confirman el mismo serial en la misma OLT/posición y el estado se pudo interpretar.
RX y TX conservan sesiones Telnet separadas. Cada sesión sigue usando el lock
existente; no se añade configure terminal ni comando de escritura al lector.

Casos separados: valid, failed, absent, moved, conflict, ambiguous y unconfirmed.
La ausencia de configuración/estado interpretable no es una desconexión.
Un serial trasladado se informa con la nueva posición pero NO se mueve la fila,
no se crean ONT automáticamente y no se modifican vínculos comerciales.
Una posición reutilizada registra posición y ambos seriales, sin nombres,
contratos, clientes, credenciales ni salida cruda del running-config.

La persistencia usa predicados atómicos sobre id, OLT, serial y todas las
coordenadas; si una fila cambia concurrentemente no recibe la medición anterior.
Se reemplaza el bulk RPC sin guarda de identidad por updates condicionados solo
para filas cuyos valores cambiaron. No se necesita una migración.

## Evidencia actual versus valores históricos

Los registros históricos conflictivos NO se modifican ni borran. La API proyecta
status unknown (No confirmado) y RX/TX actuales null, conservando los valores
persistidos y su timestamp en telemetry.historical. La interfaz distingue ese
registro guardado de una potencia actual; no afirma que lo contaminado fuera una
medición real del serial antiguo. No se inventa su última conexión válida.

La prueba de identidad es temporal, en memoria del backend: tras reinicio o
caducidad se exige una lectura nueva antes de mostrar En línea. Su vigencia es
el intervalo configurado +5 minutos (35 con el intervalo actual documentado de
30), con máximo de 65 minutos. Se separan hora de consulta de estado, hora de
consulta de señal y hora final de verificación. La caducidad parte de la lectura
de estado, sin rejuvenecerla artificialmente al cerrar el running-config.

El store OLT comprueba caducidad cada segundo aunque el listado quede abierto;
los parches SSE y respuestas de metadatos no pueden restaurar un online histórico.
Una activación administrativa ya no implica online: actualiza admin_state y deja
status unknown hasta verificar conexión. Los fallos de guardado invalidan la
proyección y notifican al panel. Las alertas comparan contra evidencia anterior
verificada, no contra un valor histórico que pudo pertenecer a otro serial.

## Caminos cubiertos y archivos

- server/src/services/oltTelemetry.ts: lectura y evaluación de identidad, evidencia,
  proyección y discrepancias con campos permitidos.
- server/src/services/oltTelemetryPersistence.ts: escritura condicionada por identidad.
- server/src/services/oltVerifiedRead.ts: consulta puntual de señal; presupuesto
  de 80s dentro de las sesiones para respetar el timeout cliente existente de 90s.
- server/src/services/oltSyncService.ts: scheduler/full sync mediante ese lector;
  sin actualización de filas conflictivas ni fallback a online por error de lectura.
- server/src/routes/olt.ts: escaneo manual, señal, proyecciones de listados/búsquedas,
  estados por serial y SSE; activación administrativa sin online optimista.
- server/src/services/oltImportDescriptionGuard.ts: el import explícito protege
  también filas SIN cliente y traslados. Ya no sobrescribe el serial de la fila
  histórica. Importación queda limitada a metadatos: no publica mediciones por
  posición sin el lector verificado. Una ONT desconocida solo puede incorporarse
  por la acción explícita de importación ya existente; el scheduler no crea filas.
- src/lib/ontTelemetryEvidence.ts y src/stores/olt.ts: caducidad y rechazo de
  estados/potencias sin evidencia; resultado puntual de señal incluye su evidencia.
- src/views/olt/OltDetailView.vue y OntDetailModal.vue: No confirmado y distinción
  entre señal actual, fallo/conflicto y registro histórico.
- Pruebas: oltTelemetry.test.ts, oltTelemetryIntegration.test.ts,
  oltImportDescriptionGuard.test.ts y src/lib/__tests__/ontTelemetryEvidence.test.ts.

No se modificaron clientes, contratos, facturación, RLS, funciones SQL, equipos
MikroTik ni rutinas de aprovisionamiento físico. No hay script de reparación de
producción incluido ni ejecutado. Las evidencias de despliegues/diagnóstico
anteriores se conservaron intactas.

## Pruebas y compilación

93 pruebas focalizadas/regresión: PASS, 0 fallos.
Cubren mismo serial/posición, traslado, reutilización, ausencia, consulta fallida,
cambio de identidad durante lectura, serial/estado ambiguo, dos ONT en épocas
distintas, protección de Huawei y ONT nueva, escritura concurrente rechazada,
registro sin datos sensibles, reinicio/caducidad y presentación frontend.

La integración ejecuta runOltFullSync y handlers reales de listado, estado por
serial, señal e importación con CLI Telnet simulada en 127.0.0.1 y REST interceptado;
prohíbe toda red externa. Solo la verificación JWT se sustituye por identidad de
prueba, sin cambiar middleware productivo ni guardas de rol. Verifica cero PATCH
sobre la fila MSTC, conserva sus campos y vínculos, y confirma que un fallo real
de la CLI simulada no genera offline ni actualizaciones de olt_onts.

También pasan las regresiones existentes de alertas, historial, importación y
aprovisionamiento/rutas contra simuladores. No se usó la base/OLT real.

TypeScript frontend: PASS. Build Vite: PASS, aviso previo de chunks grandes.
Tipado estricto de los servicios nuevos y su prueba principal: PASS.
El tsc global de backend NO está limpio: conserva exactamente los cinco errores
que ya devuelve e679d9c, sin ninguno nuevo. Comparación de ambas salidas idéntica:
- fieldInventory.test.ts: import .ts sin allowImportingTsExtensions.
- oltProvisioningService.ts: tipos serviceGemport/serviceVlan (dos errores).
- custodyRequiredMaterials.sql.test.ts: tipo de UUID (dos errores).
No se cambiaron esos archivos ajenos para ocultarlos.

Evidencia resumida: OLT-IDENTIDAD-SERIAL-PRUEBAS.json.
Logs completos: runtime/olt-identidad-evidencia-20261020/.
El .env.local y build son ficticios de laboratorio, ignorados, no publicables.

## Riesgos y límites de esta preparación

- Dos running-config completos por ciclo, además de los comandos existentes:
  más latencia y carga de lectura; no se midieron sobre hardware en esta fase.
  Las escrituras por fila condicionadas pueden costar más que el bulk anterior.
- La prueba en memoria se pierde al reiniciar; No confirmado hasta la siguiente
  lectura verificada es deliberado. Backend y frontend deberán activarse
  coordinadamente en una fase posterior; las sesiones antiguas deben recargarse.
- En ciclos sin RX/TX o con lectura fallida no se reutiliza la potencia guardada
  como actual; queda visible solo como histórica. El scheduler actual pide señal
  cada tres ciclos, por lo que puede verse — entre lecturas de potencia.
- El bloqueo es del backend, no de herramientas externas como SmartOLT. La
  comprobación antes/después detecta cambios observables; no es una transacción
  atómica con la OLT ni sustituye coordinar configuraciones externas concurrentes.
- Una OLT sin ninguna vinculación interpretable se considera lectura insuficiente,
  no una prueba para declarar ausentes todas las ONT automáticamente.
- No se incorpora un historial persistente nuevo de evidencia de identidad. Se
  conservan filas existentes, registros estructurados de discrepancia y evidencia
  temporal. Una auditoría persistente adicional requeriría diseño/autorización aparte.

## Reparación posterior de los registros contaminados — propuesta, NO ejecutada

1. Mantener primero la protección de identidad; no bastaría cambiar MSTC a offline,
   porque el algoritmo anterior volvería a copiarle el estado de 1/2/8:3.
2. Con autorización nueva, exportar una instantánea de las filas por id, serial,
   posición, enlaces, timestamps y dependencias/historial. Verificarla por hash y
   mantenerla separada de cualquier reparación. Repetir solo las lecturas precisas
   de la OLT para comprobar que las identidades no cambiaron desde el diagnóstico.
3. La fila histórica MSTC puede permanecer sin confirmar sin tocar sus campos:
   esta corrección ya impide que se muestre como online actual. Si se autoriza
   sanear la caché, guardar ANTES sus valores contaminados y cambiar únicamente su
   estado cacheado a unknown y RX/TX a null, con guardas id/serial/posición/vínculos.
   No inventar una desconexión ni una fecha de última lectura válida del serial.
4. No cambiar el serial/id de esa fila por HWTCE5C94DB6 ni transferirle el contrato
   de Janet: eso reasignaría identidad/historial. La posición tiene unicidad en el
   modelo actual. Incorporar la fila de Estiven preservando la antigua exige revisar
   FKs y una estrategia explícita de archivo/identidad; podría requerir un cambio
   de esquema separado. No hay migración para esto en esta fase.
5. No emitir comandos de configuración sobre 1/2/8:3 ni modificar la Huawei de
   Janet en 1/2/8:50. No autorizar, reiniciar ni eliminar ninguna ONT por esta reparación.

Preparación local terminada para revisión; sin push ni despliegue.
