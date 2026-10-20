# Corrección de bloqueos OLT por serial — 2026-10-20

Resultado: **PASS funcional local** para los bloqueos del informe de validación FAIL.
No equivale a autorización ni validación productiva de despliegue. TypeScript global del backend
continúa fallando por cinco errores preexistentes, sin diferencias contra la base.

Base: `6aea8b5c99085eff0ff074eab054f09ec57cac8d`.
Rama local: `fix/olt-identidad-bloqueos-20261020`.
Worktree: `scripts/inventory-auth-lab/runtime/olt-identidad-bloqueos-worktree`.
El hash del commit final se obtiene con `git log -1` en este worktree y se entrega en el cierre.

## Causas y correcciones

### 1. Importación

El error de lectura de identidades se ignoraba y se convertía en inventario vacío.
Después, el upsert por posición podía sustituir el serial de la fila antigua.

- Se exige consulta sin error, datos presentes y conteo exacto coincidente. Un fallo o inventario
  truncado devuelve 503 antes de cualquier escritura de la importación.
- Se elimina el upsert. Para una fila existente se actualizan solo metadatos, con predicados
  atómicos de ID, OLT, serial, posición y client_id esperado. No se escriben identidad,
  telemetría, client_id ni contract_id. Cambio concurrente: 409 y detención.
- Para una posición nueva se utiliza INSERT normal: una colisión concurrente falla en lugar de
  sobrescribir la fila existente. No hay creación automática en el scheduler.
- Una posición reutilizada continúa siendo conflicto revisable: no cambia ninguna de sus
  identidades ni reasigna vínculos. Se prueban tanto `HWTC5C94DB6` de la solicitud como el serial
  real `HWTCE5C94DB6` del diagnóstico, frente a `MSTC8CCE647E`.
- Una importación correcta de metadatos ya no invalida todas las referencias ópticas verificadas.

### 2. Alertas ópticas

La potencia de comparación se tomaba de la presentación vigente. Un ciclo sin potencia dejaba
esa presentación en null y borraba de hecho la referencia para detectar el próximo cruce.

- Nueva referencia óptica en memoria, separada de la potencia que se muestra como actual.
  Se establece exclusivamente con lecturas verificadas del scheduler; nunca desde datos históricos
  de BD. Se confirma tras completar la persistencia protegida cuando corresponde.
- La clave incluye fila, dispositivo, serial normalizado y posición. Una lectura ausente o fallida
  conserva la referencia; ausencia de identidad, traslado, conflicto o ambigüedad la invalidan.
- La ventana es `2 × intervalo × ciclos_por_señal + 5 min`, acotada entre 10 min y 24 h. Admite
  un ciclo óptico perdido y evita comparar indefinidamente. Con 30 min y cada 3 ciclos: 185 min.
  La vigencia visual de estado/potencia no se amplía por esta ventana de alertas.
- Cada lectura válida posterior avanza la referencia. Repetir −30 dBm no duplica la alerta;
  recuperar −23,98 dBm produce una recuperación de señal. Tras reinicio no se inventa un cruce.
- Se contempla el cruce incluso si otra lectura manual ya había guardado el valor en BD:
  no se exige una diferencia de campos persistidos para emitir una alerta verificada nueva.

### 3. Fichas y TR-069

Las respuestas por cliente y por serial permanecían en referencias independientes del listado
OLT; su expiración no se reevaluaba mientras la pantalla seguía abierta.

- Reloj local de presentación, una vez por segundo, con limpieza al cerrar el componente.
- La ficha deriva sus ONT de la misma función `enforceOntEvidence` de la lista OLT. No muta las
  filas cargadas ni cambia acciones de plan, contratos, vínculos o equipos.
- El endpoint por serial adjunta evidencia/vencimiento y potencias proyectadas. TR-069 reevalúa
  esa evidencia con el reloj local. Ambos muestran «No confirmado» y explican en el título del
  indicador si la lectura venció o falta evidencia vigente.
- No se muestran potencias históricas como actuales. Estas pantallas no incorporan nuevos
  controles ni lecturas de potencia; la evidencia histórica sigue separada.
- No hay polling adicional, comandos TR-069, cambios de configuración ni consultas a la OLT
  causadas por el reloj.

## Pruebas

**130 PASS / 0 FAIL** en regresiones focalizadas:

- Sincronización por serial: mismo lugar, traslado, posición reutilizada, ausencia, consulta
  fallida, identidad ambigua, expiración y protección de la ONT nueva.
- Ruta real de importación con CLI/REST simulados: consulta fallida y truncada, cero escrituras;
  importación normal; colisión de INSERT; reemplazo concurrente antes de UPDATE.
- −23,98 → ciclo sin potencia → lectura óptica ausente → −30: una alerta lowSignal, solo para
  Huawei Janet; repetición sin duplicado; recuperación posterior una sola vez.
- Referencia aislada por identidad, invalidación y caducidad; configuración 30 min × 3 ciclos
  simulada: la referencia permanece a los 90 min mientras el estado visual ya está vencido.
- Reloj con tiempo simulado: una pantalla abierta pasa a unknown y potencia null sin fetch;
  no muta el dato cargado y deja de actualizar tras cerrar.
- Indicadores generales: unknown nunca se suma a desconexión real; suspensión administrativa
  y ONT sin vínculo mantienen sus categorías. Regresiones de alertas, historial y provisioning.

Además, se repitieron **las dos reproducciones originales**, con el mismo código candidato nuevo
y el mismo escenario; únicamente se adaptó el mock de REST para aportar el conteo exacto requerido:

| Reproducción original | Resultado actual |
|---|---|
| import-failure | PASS: HTTP 503, MSTC8CCE647E permanece igual, writes=[] |
| signal-gap | PASS: RX=-30, una alerta lowSignal para la fila Huawei, sin atribución a MSTC |

TypeScript frontend: PASS. Build Vite local: PASS, advertencia existente de chunks >500 kB.
Backend global: mismos cinco errores, salida idéntica a `e679d9c`; cero errores nuevos:
`fieldInventory.test.ts:4`, `oltProvisioningService.ts:225,228`,
`custodyRequiredMaterials.sql.test.ts:395,396`. No se modificaron esos archivos.

El build utiliza exclusivamente variables ficticias de laboratorio en `.env.local` ignorado.
No es una imagen productiva. Pruebas de rutas con OLT Telnet local y REST simulado que rechaza
destinos externos. No se consultaron ni escribieron servicios de producción.

Evidencia externa al commit: `scripts/inventory-auth-lab/runtime/olt-bloqueos-evidencia-20261020/`.
Contiene `focused.log`, `import-failure.log`, `signal-gap.log`, logs de TypeScript/build y JSON
de resultados. Resumen versionado: `docs/OLT-IDENTIDAD-BLOQUEOS-PRUEBAS.json`.

## Archivos exactos del commit de corrección, respecto de 6aea8b5

```text
docs/OLT-IDENTIDAD-BLOQUEOS-RESULTADO.md
docs/OLT-IDENTIDAD-BLOQUEOS-PRUEBAS.json
server/src/routes/olt.ts
server/src/services/oltTelemetry.ts
server/src/services/oltSyncService.ts
server/src/services/__tests__/oltImportDescriptionGuard.test.ts
server/src/services/__tests__/oltTelemetryIntegration.test.ts
server/src/services/__tests__/oltSignalReference.test.ts
src/composables/useOntEvidenceClock.ts
src/lib/__tests__/ontEvidenceClock.test.ts
src/stores/olt.ts
src/views/clientes/ClientServiceDetailView.vue
src/views/tr069/Tr069View.vue
```

El candidato completo incluye además los cambios del padre 6aea8b5. No se debe desplegar este
commit aislado sobre una base que carezca de esa corrección de identidad.

## Rendimiento y riesgos restantes

- Cero comandos nuevos a la OLT respecto de 6aea8b5. La referencia usa memoria O(N) y consulta
  O(1) por identidad. El reloj solo recalcula datos locales de la pantalla cada segundo.
- La importación explícita añade COUNT exacto y reemplaza lotes por escrituras condicionadas
  secuenciales por fila; puede tardar más. No altera el intervalo ni número de consultas del
  scheduler. No se midió carga sobre el equipo real ni se ejecutaron pruebas intensivas.
- Si PostgREST limita el resultado antes del conteo total (por ejemplo, más de 1000 filas), se
  aborta sin escrituras; no se interpreta el resto como posiciones nuevas. Para ese volumen
  haría falta revisar paginación consistente antes de importar.
- Las operaciones por fila no son una transacción global: un fallo concurrente detiene el
  resto y devuelve cuántas filas se importaron antes. Las identidades protegidas no se pisan.
- La referencia en memoria se pierde al reiniciar y vence tras su ventana: la primera lectura
  establece una base nueva sin alerta de transición. Tampoco sustituye una auditoría histórica.
- Permanecen los costes de dos inventarios completos del padre, los tiempos de espera del lock
  y la limitación de no tener una instantánea atómica frente a herramientas externas.
- Pendientes productivos: verificar estado remoto, configuración real, imágenes exactas,
  respaldo recuperable ensayado, rollback coordinado backend/frontend y autorización de activación.
  Se mantiene el procedimiento preparado en `OLT-IDENTIDAD-SERIAL-VALIDACION-FINAL.md`; debe
  aplicarse al candidato nuevo, nunca asumir que el respaldo anterior aún corresponde a producción.

No se detectaron nuevos fallos críticos en estas verificaciones. No se declara listo para desplegar
en producción: la validación productiva y su autorización siguen pendientes.

## Preservación y límites

Los 216 archivos protegidos del checkout principal conservan sus hashes SHA256: cero diferencias.
Main local sigue en `dceafa08d2717b643f65b3880ead020a14561648`; el worktree anterior conserva 6aea8b5.
Sin migraciones, push, merge, despliegue, configuración de OLT/MikroTik ni escrituras en producción.
No se ejecutó la reparación de MSTC8CCE647E ni se alteró la ONT de Estiven.
Se detiene tras crear el commit local, para revisión.
