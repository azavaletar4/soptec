# Retiro histórico OLT y conciliación Janet / Estiven — candidato local

Estado: **PASS de preparación y pruebas focalizadas. SIN aplicar, push o despliegue.** Rama aislada `fix/olt-retiro-historico-20261021`, base funcional `44c2adb791f76cddd490d6fd52df06633bc9bfc9`. No se mezclan cambios del checkout principal. La lista exacta de archivos y sus SHA256 se entrega en `OLT-RETIRO-HISTORICO-ARCHIVOS.json` (el manifiesto se excluye de su propio hash).

## Identidad y alcance exactos

Se conserva el diagnóstico de solo lectura `../olt-janet-estiven-2026-10-21T15-40-01-937Z/DIAGNOSTICO-Y-CONCILIACION.md` dentro del runtime original. No se repitió el escaneo físico para desarrollar este candidato.

El serial físico es **HWTCE5C94DB6**, con E adicional, confirmado en `1/2/8:3`. `HWTC5C94DB6` no fue encontrado. Inventario lo representa como `48575443E5C94DB6` (vendor HWTC codificado en hexadecimal); corresponde al equipo ya asignado de Estiven y no se crea ni reasigna inventario.

| Futura acción | UUID | Identidad / vínculos |
|---|---|---|
| Retirar como histórico | `a1f0b671-a1e2-482c-b24e-7e584bf0e4ed` | MSTC8CCE647E; última posición 1/2/8:3; vínculos actuales NULL. Solo cambia retired_at y el updated_at del trigger. |
| Insertar fila independiente | `76701eb5-405e-462f-862d-384a469cadac` | HWTCE5C94DB6, 1/2/8:3; cliente `3f01013e-ad20-44bb-ad15-443416e14d63`; contrato `91f25111-758a-4f5a-9b79-196065509cde` / CTR-2026-00566. |
| Proteger sin modificar | `74d586e3-3a0a-40c2-aba3-46294adcf095` | HWTCDEB847B6 de Janet, 1/2/8:50; cliente `a563d740-a060-417e-852a-5153edeefb18`; contrato `cb2ee4ae-3301-44cc-b44c-939cca819e3b` / CTR-2026-00270. |

La nueva fila registra los metadatos observados de Estiven: GPT-2741GNAC, VLAN 200, perfiles SMARTOLT-VOIPMNG-10M; estado unknown, potencia y last_synced_at NULL. No copia VLAN 120, señal, plan, zona o perfiles de Janet. Esto es un registro en la aplicación, no un cambio del servicio físico. No reintenta las operaciones históricas `7d231878-5d63-4e7b-823b-b3b6b3b4537e` y `07a898cd-a617-44b5-af65-d3c17e425ee0`.

## Diseño mínimo y migraciones candidatas

`retired_at` separa identidad histórica de ocupación activa. No se anulan ni inventan coordenadas: la fila retirada conserva su última posición, UUID, serial, descripción, mediciones históricas y referencias a clientes/contratos/alertas/operaciones. Una fila nueva siempre obtiene otro UUID. Las referencias preservadas en una retirada son históricas; no autorizan operaciones sobre una posición física.

1. `supabase/migrations/20261021170000_olt_retirement_expand.sql`: añade retired_at y el trigger de protección. Conserva la UNIQUE original; todavía no permite reutilizar la posición. Impide modificar identidad, metadatos, vínculos o telemetría de una retirada, incluso al restaurarla; solo admite transición de retired_at y updated_at. Impide borrarla, también por cascada de eliminación de OLT.
2. `supabase/migrations/20261021171000_olt_retirement_active_positions.sql`: después de la aplicación compatible, sustituye la UNIQUE incondicional por índice único de posición activa y otro de serial activo normalizado por OLT. Aborta ante duplicados; no los corrige. Requiere la marca explícita de sesión `smartrayco.olt_retirement_application_ready=v1`.

Ambas usan transacciones y lock_timeout 2s. La expansión también adapta únicamente los SELECT de `assign_contract_nap_sync_ont_zone` y `crear_descuento_compensacion_masivo` para excluir retiradas: así un vínculo histórico no participa en sincronización de zona/NAP o compensación comercial. No ejecuta esas funciones ni modifica clientes, contratos, descuentos o inventario. CREATE OR REPLACE conserva propietario y permisos existentes; se probó esa conservación.

Se consultaron en Cloud **solo las definiciones/permisos de esas dos funciones**, con transacción READ ONLY. Coinciden con las fuentes base; `OLT-RETIRO-FUNCIONES-BASE.json` contiene firmas, permisos y huellas. La expansión aborta si cambia cualquiera de los dos cuerpos; el rollback comprueba también que no hayan cambiado tras aplicar el candidato. Ninguna función ajena fue reemplazada o investigada.

## Aplicación preparada

- Listado activo, estado por serial, búsqueda para vincular, ONT por cliente, deshabilitadas, resumen fallback, importación y sincronización excluyen retired_at.
- La importación ignora históricos retirados, preserva conflictos de identidades activas e inserta sin sobrescribir. La clasificación mantiene historias y UUID independientes.
- Aprovisionamiento deja de usar el antiguo ON CONFLICT por la constraint eliminada. Lee una identidad activa y realiza UPDATE con predicados de serial/posición/vínculos/retired_at o INSERT simple. Un conflicto concurrente falla, nunca toma una rama de sobrescritura. Los índices protegen duplicados de posición y serial activo.
- Una operación pendiente referida a una ONT retirada se detiene antes de OLT/MikroTik. Los reintentos completados tampoco presentan una retirada como una ONT activa válida.
- Señal/telemetría no convierte una retirada en online ni reutiliza su caché óptica. La persistencia incluye retired_at IS NULL como predicado atómico.
- Las rutas operativas por UUID rechazan retiradas antes de contactar al equipo; scripts de mantenimiento que escriben y selección de ONT para perfiles por deuda excluyen retiradas.
- GET `/:id/onts/retired`, bajo las mismas comprobaciones de autenticación/rol de lectura OLT, muestra historial sin estado/potencia vigentes. Nueva pestaña «Retiradas · historial» muestra serial y última posición histórica, sin botones de activar, autorizar, eliminar o TR-069. El listado activo/ocupación no incluye esas filas. Eventos de una retirada eliminan esa identidad del listado activo en memoria.

Los scripts de auditoría puramente de lectura pueden seguir inspeccionando las filas históricas como tales. No son motores de ocupación ni de acciones.

## Conciliación y respaldo preparados, no ejecutados

- `scripts/sql/olt-janet-estiven-backup-readonly.sql`: captura selectiva READ ONLY de filas, referencias, alertas, operaciones y guardas de clientes/contratos/inventario. En activación guardar salida en archivo nuevo protegido y calcular SHA256; nunca restaurar tablas completas de negocio.
- `scripts/sql/olt-janet-estiven-reconcile-candidate.sql`: transacción separada de las migraciones. Requiere `smartrayco.approve_ont_reconciliation=janet-estiven-v1`. Verifica esquema compatible, seriales y UUID, identidad de Janet, MSTC sin vínculos, ausencia global de duplicados y equipo asignado a Estiven. Bloquea filas acotadas y comprueba antes/después que Janet, cliente, contrato e inventario sigan idénticos. Si el INSERT falla después del retiro, toda la transacción revierte.
- El trigger existente de activación de clientes puede activar un prospect al insertar una ONT vinculada. Por ello el script exige que Estiven y su contrato sigan activos; si no, aborta. No desactiva triggers ni toca clientes para sortear el rechazo.

La captura real anterior permanece intacta, fuera del candidato, en `D:/SmartRayco/scripts/inventory-auth-lab/runtime/olt-janet-estiven-2026-10-21T15-40-01-937Z/LECTURA-PRIVADA.json`, SHA256 `d356b0a550f31c22d60c090d45146ecd56d23e3c8ff04d76a2cac3a4a6c726f1`. Es evidencia del diagnóstico; **no sustituye un respaldo fresco inmediatamente antes de aplicar**.

## Pruebas y evidencia

Validación final en `docs/olt-retirement-validation-2026-10-21T16-12-28-674Z/RESULTADO.json`:

| Control | Resultado |
|---|---|
| PostgreSQL 17 local, red none, datos tmpfs, fixtures sintéticas | 21/21 (20 subpruebas + prueba contenedora) |
| Regresiones de importación, telemetría, seguridad y aprovisionamiento OLT | 47/47 |
| vue-tsc -b | PASS |
| Build frontend local | PASS; advertencia existente de tamaño de chunks |
| Tipos ampliados del backend frente a la base intacta | Mismos 4 errores preexistentes, cero nuevos |

Se probaron las migraciones reales candidatas, unicidad, conservación de UUID/FK, importación con históricos, store real con PostgreSQL mediante adaptador REST local, telemetría obsoleta, caché, rutas Hono autenticadas con JWKS local, rechazo de acciones sobre retirada antes de transporte, NAP/compensación excluyendo históricos, rollback de datos, rollback de esquema previo al retiro, rechazo seguro de downgrade posterior, fracaso atómico del INSERT y abortos por divergencias. Janet y los registros de clientes, contratos, inventario, alertas y operaciones permanecen idénticos en las pruebas de conciliación y compensación.

No hay OLT, MikroTik, Supabase o credenciales productivas en estas pruebas. Los comandos del backend se simulan con servidores locales. La comprobación global adicional de tipos sigue fallando en dos diagnósticos de `mikrotik/client.ts` y dos de `oltProvisioningService.ts` idénticos a la base 44c2adb; no se reparan como parte de este alcance. No se afirma que el backend completo esté limpio de tipos.

Incidencias del laboratorio conservadas fuera del candidato: espera inicial del socket temporal de PostgreSQL (se cambió a TCP final), mocks REST antiguos sin soporte de .single/.is (se corrigieron), ejecución restringida de tsx y una guardia de rollback con escape de dólar incorrecto (corregida y probada). Evidencias anteriores preservadas en `D:/SmartRayco/scripts/inventory-auth-lab/runtime/olt-retirement-preparation-earlier-evidence`; la evidencia final anterior es la vigente.

## Rollback y límites de reversibilidad

**Antes del commit de conciliación:** ROLLBACK devuelve exactamente el estado transaccional previo. **Antes de retirar/reutilizar posiciones:** el esquema es reversible; `olt-retirement-contract-down.sql` restaura la UNIQUE original y después de retirar la aplicación compatible se puede ejecutar `olt-retirement-expand-down.sql`, restaurando las dos funciones originales y quitando el campo/trigger.

Si solo se aplicó expansión y la UNIQUE original sigue presente, omitir contract-down. No quitar retired_at mientras la aplicación compatible siga utilizándolo. Ambas rutas de downgrade rechazan historia retirada y cambios de versión; no borran datos para forzar una reversión.

**Después de confirmar la conciliación:** `olt-janet-estiven-reconcile-rollback.sql`, con marca explícita `rollback-janet-estiven-v1`, retira la nueva fila de Estiven y mantiene ambas filas como historial con UUID y vínculos intactos. No reactiva MSTC, ausente físicamente, ni inventa una ocupación activa. No altera OLT, servicios, clientes, contratos o inventario. Durante esa compensación la app queda sin vínculo ONT activo para Estiven hasta una corrección posterior autorizada; el servicio físico continúa igual. Rechaza vínculos o posiciones que hayan cambiado desde el plan.

No es una vuelta exacta al esquema viejo después de reutilizar una posición: **sería incompatible con conservar ambas historias**. Tras ese punto se mantiene la aplicación compatible y el soporte de retiro; no se despliega una versión vieja que ignore retired_at. El rollback de esquema se bloquea y se prepara una corrección hacia adelante. Ese límite se probó, no se oculta como rollback completo.

## Propuesta de activación por etapas — requiere nueva autorización

1. **Preflight y respaldo:** confirmar nuevo HEAD remoto/productivo y derivar integración limpia si avanzaron; revalidar los 216 hashes, catálogo/funciones/ACL/triggers, duplicados y filas. Nueva lectura física bracketed confirma HWTCE5C94DB6 en 1/2/8:3, HWTCDEB847B6 en 1/2/8:50 y MSTC ausente. Guardar respaldo fresco selectivo y de esquema, código e imágenes/configuración exactos; verificar recuperación aislada. Nada de ello se ejecuta automáticamente desde este informe.
2. **Expansión solamente:** aplicar únicamente 20261021170000, con aprobación específica. No retirar filas; conservar constraint anterior. No usar un db push genérico que arrastre ambas migraciones u otros pendientes.
3. **Aplicación compatible:** construir/verificar/desplegar backend y frontend con imágenes exactas y conservación de configuración/volumen OLT. Este despliegue es un alcance nuevo respecto al anterior frontend exclusivo, y requiere autorización propia. Verificar lista activa/historial con datos sintéticos y lectura real sin operaciones de clientes.
4. **Unicidad activa:** comprobar versión compatible de todos los escritores y scripts, fijar la marca application_ready en la sesión autorizada y aplicar solo 20261021171000. Sin conciliación aún. Abortar ante duplicados, timeout, cambios de funciones o escritor antiguo.
5. **Conciliación acotada:** nueva autorización, respaldo/identidad frescos y ventana coordinada sin acciones OLT/MikroTik, aprovisionamientos o cambios de perfil en curso. Los locks Telnet del backend son por proceso y no bloquean una intervención SQL externa: **no ejecutar la conciliación en paralelo con comandos ya iniciados**. No pausar servicios o schedulers sin autorización separada. Ejecutar el script transaccional aprobado, refrescar los listados abiertos y comprobar las dos filas, Janet y guardas de datos. No forzar sync ni enviar configuraciones a la OLT.
6. **Observación:** esperar la telemetría automática normal; verificar que el nuevo UUID tiene identidad válida y MSTC solo figura en historial. No cambiar VLAN, plan, ONT, MikroTik o PPPoE para «hacer pasar» la prueba.

Persisten como riesgos: serial abreviado incorrecto en solicitudes humanas; duplicados activos previos aún no evaluados para ejecutar índices en producción; frescura de datos al aplicar; los cuatro errores de tipos preexistentes; coordinación contra acciones OLT en vuelo; refresco de pantallas/cachés y compatibilidad de todos los escritores; y la reversibilidad condicionada tras conservar historia. La vista nueva está compilada y las rutas probadas, pero no se realizó aceptación visual en navegador/Android ni prueba de servicio físico en producción.

No se aplicó ninguna migración o dato real, no se ejecutó push/despliegue, no se reinició ningún servicio y no se enviaron comandos a OLT/MikroTik durante esta preparación. Los 216 pendientes se vuelven a verificar al cierre. Detenido antes de cualquier cambio en producción.
