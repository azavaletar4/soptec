# Modalidad IPTV con Campo detenido — preparación de ventana

> Actualización posterior: persistencia, cola y compatibilidad mínima corregidas;
> paquete local preparado y certificación física modular Android 26/26 PASS. Procedimiento
> vigente: [resolución de bloqueos](ALTAS-IPTV-BLOQUEOS-RESUELTOS-20261111.md).
> La posibilidad de omitir compatibilidad descrita abajo fue reemplazada por
> rechazo temprano recuperable del cliente antiguo. Se conserva el antecedente.

**Estado: NO APTO todavía para ejecutar la publicación.** Se preparó la
secuencia; no se aplicó SQL, hizo push, desplegó ni modificó datos reales.
Fuentes: implementación `8086fba` y revisión `127fa37`. La ventana aceptada
sustituye el requisito anterior de cero interrupciones, pero no corrige los
defectos de persistencia ni prepara por sí sola el paquete de release.

## Comprobaciones actuales y procedencia

El propietario informó que los técnicos no deben abrir Campo y confirmó en
esta conversación: **todos los celulares verificados y sin pendientes**.
Se acepta esa confirmación operativa; no se presenta como una consulta del
servidor ni como verificación automática del esquema IndexedDB.

Consultas con TLS verify-full y transacción REPEATABLE READ / READ ONLY.
Muestras del 11/11/2026 a las 14:14:11 y 14:14:45 UTC; última ampliada:
**14:32:57 UTC, 09:32:57 Lima**. Evidencia:
`ALTAS-IPTV-MANTENIMIENTO-LECTURA-20261111.json`.

| Comprobación | Resultado de la última muestra | Interpretación |
|---|---|---|
| Órdenes `in_progress` | 0 | Sin ejecución registrada por estado. |
| Recibos Campo/Rutinas con `result` incompleto | 0 | Ninguna intención incompleta visible y confirmada en BD. No revela transacciones aún sin commit ni respuestas perdidas en celulares. |
| Rechazos materiales `pending` | 0 | Tanto en órdenes abiertas como cerradas/sin padre. |
| Sentencias activas de Campo identificadas / locks en espera | 0 / 0 | Fotografía temporal; no es un bloqueo de mantenimiento ni prueba de que nadie pueda iniciar una nueva llamada. |
| Transacciones identificadas abiertas, incluso idle / locks de filas o escritura | 0 / 0 | Complementa los recibos confirmados sin exponer consultas ni payloads de otras sesiones. |
| Altas abiertas | 0 | 86 completadas y 6 canceladas; no se modificó ninguna. |
| Otras órdenes abiertas | 9 | 7 rutinas programadas, 1 ticket abierto y 1 reprogramado; ninguna `in_progress`. No cerrarlas/cancelarlas para fabricar un cero. |
| Sesiones de trabajo sin `ended_at` | 4 | Sus `job_id` no encuentran orden asociada; no prueban ejecución actual. Registros huérfanos a conservar y revisar aparte, sin cierre automático. |
| Unidades de Campo pendientes | 1 `pending_approval` | Vinculada al ticket **resuelto** `843e326b-0363-41af-998f-51287833e8a5`, última actualización 02/11. Pendiente administrativo histórico, no operación en ejecución. No aprobar, liberar o regularizar por esta publicación. |
| Modalidad SQL aplicada / cuerpo de cierre | No / `e452ec213962f70d8db289ac17ed361f` | Coincide con el prerrequisito del candidato. |

Por tanto, hay evidencia de **Campo sin ejecución registrada**; no se afirma
que el servidor carezca de todo pendiente administrativo. Los cuatro
huérfanos y la aprobación histórica quedan documentados, no se eliminan.
Las muestras dejan de ser vigentes si comienza otra operación. Repetir el
preflight inmediatamente antes de la intervención autorizada.

## Qué resuelve la ventana y qué no

**Puede evitarse implementar compatibilidad adicional para sesiones
antiguas**, si se mantiene Campo detenido, los celulares están sin trabajos
locales —confirmado por el propietario— y todos recargan completamente el
frontend correcto **antes de reabrir el servicio**. Navegar por la SPA o
cerrar/abrir la APK no demuestra por sí solo que se reemplazó el JS.
La coordinación sustituye la coexistencia de versiones; el código antiguo
sigue siendo incompatible con Altas nuevas versión 1.

El servidor no puede enumerar ni recuperar IndexedDB/localStorage de los
celulares: borradores, fotos/Blobs, cierres en cola, inventario sin confirmar,
versión JS en memoria ni respuesta perdida de una operación ya confirmada.
No borrar caché/datos, reinstalar ni cerrar sesión como método de actualización.
Si reaparece un pendiente, detener su dispositivo, preservarlo y reconciliar
su orden/recibo antes de cualquier reenvío; no descartar ni sobrescribirlo.

**Bloqueos que la pausa no soluciona:**

- `draftHasContent` ignora una modalidad IPTV aislada y puede borrar esa
  selección del borrador antes de tener NAP/notas/fotos.
- El inicializador IndexedDB previo puede crear solo `drafts` o solo
  `closures`; el otro store falla con `NotFoundError`. Vaciar una cola no
  crea el store faltante. Se requiere una solución no destructiva o una
  alternativa explícitamente validada; limpiar la BD no es aceptable.
- Sigue sin prepararse el alcance de release IPTV: el contrato existente
  apunta a OLT (`40e43c1`). Tampoco está certificada la prueba en Android/
  System WebView real. No atribuir a la APK el PASS de Chrome de escritorio.

Estos puntos mantienen el **NO APTO** del candidato actual para uso normal
futuro. Esta tarea no autoriza corregirlos ni aplicar una solución provisional
que acepte pérdida de trabajo. La necesidad de resolver persistencia es
independiente de la compatibilidad con sesiones antiguas.

## Orden exacto de publicación — preparado, no ejecutado

1. **Admisión:** obtener autorización de los cambios pendientes de persistencia
   y validar su solución. Registrar commit candidato, pruebas y Android real.
   Mantener Campo detenido; confirmar que las 9 órdenes no arrancarán durante
   la ventana y dejar huérfanos/aprobación histórica intactos. Repetir
   `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/iptv-maintenance-readonly.ps1`
   y `node --test scripts/tests/iptv-maintenance-preflight.test.mjs`.
   En la prueba, `IPTV_REVIEWED_COMMIT` identifica el candidato revisado
   (por defecto `8086fba` en esta entrega); tras autorizar correcciones,
   fijarlo al commit nuevo validado, sin comparar contra fuentes ajenas.
   Si aparecen ejecuciones/recibos incompletos o se pierde confirmación de
   los celulares, detener, sin modificar sus estados automáticamente.
2. **Fuentes y respaldos:** checkout/commit limpio, solo cambios autorizados.
   Revalidar SQL/trigger/ACL. Respaldar esquema y funciones por el canal
   privado; no incluir secretos en argumentos/logs. Preparar el manifiesto
   existente con el commit candidato, `backendSources: []`, fuentes y assets
   frontend exactos; regenerar snapshot con
   `node scripts/frontend-release-build.mjs --export-snapshot`.
3. **Paquete:** ejecutar separadamente
   `node scripts/frontend-consolidation-release.cjs prepare` y después
   `node scripts/frontend-consolidation-release.cjs build`. Exigir imágenes
   anteriores respaldadas, reversión probada y doble build reproducible,
   sin fuentes/artefactos ajenos. Cualquier drift detiene el procedimiento.
4. **Frontend compatible primero**, solo con autorización de push/deploy:
   publicar exclusivamente commits autorizados; ejecutar
   `node scripts/frontend-consolidation-release.cjs deploy` y luego
   `node scripts/frontend-consolidation-release.cjs verify`. Verificar
   manifest/HTML/assets y backend Hono intacto. **No hay despliegue de
   backend HTTP:** el cambio de backend es la migración PostgreSQL del paso 6.
5. **Verificación con Campo aún cerrado:** cargar el candidato en WebView
   de prueba aislada y confirmar su versión real, autenticación y ambas
   colecciones IndexedDB preservadas. Probar borrador solo con modalidad,
   fotos, recarga y cola sin pérdida. La prueba debe pasar con la solución
   de persistencia, no con una BD borrada. No liberar todavía a los técnicos.
6. **SQL autorizado:** repetir lectura inmediata y comprobar hash esperado.
   Aplicar únicamente el archivo SQL revisado por canal privado:
   `psql -X -v ON_ERROR_STOP=1 -f <migración-exacta>`.
   Para el candidato actual es `20261111140000_installation_iptv_mode.sql`;
   si cambia el candidato, revisar y probar el archivo exacto de nuevo.
   No usar `supabase db push` para arrastrar otras fases. Confirmar commit,
   transacción, columnas/defaults, triggers, ACL, recarga PostgREST y registro
   de migración. No escribir backfills ni cierres de prueba sobre históricos.
7. **Validación funcional:** ejecutar primero el plan sintético de abajo;
   verificar modo y versión en una Alta nueva del entorno aislado. Para
   una futura Alta real, observar solo su operación normal expresamente
   autorizada, sin alternar modalidades como experimento ni reabrirla.
8. **Reapertura:** cada técnico realiza una recarga completa con conectividad
   y confirma el frontend nuevo antes de usar Campo. No permitir reentrada
   con JS anterior. Si se detecta almacenamiento pendiente, preservar y
   detener ese caso. Monitorear cierres, errores/colas e inventario, registrar
   evidencia y actualizar continuidad; no declarar éxito solo por `verify`.

## Prueba funcional controlada de futura Alta Dúo

Preparada, no ejecutada contra clientes reales:

| Caso aislado, orden distinta en cada fila | Resultado exigido |
|---|---|
| Smart TV, ONT legítima, sin TV Box entregado | Modalidad explícita, cierre completo, stock/unidades/eventos/custodia TV Box idénticos antes/después. |
| Dispositivo propio, mismas validaciones restantes | Mismo resultado; no registrar el equipo del cliente como unidad Rayco. |
| Rayco entrega TV Box con serie o MAC y evento desde custodia propia | Cierre permitido; un solo evento real de asignación, sin descuento adicional por cerrar/reintentar. |
| Rayco sin equipo, sin serie/MAC o sin custodia; unidad de otra orden/contrato | Rechazo sin mutar datos. |
| Modo ausente, ONT/Zona/NAP/controles existentes incompletos | Rechazo; nada se omite por elegir dispositivo propio. |
| Borrador nuevo/antiguo con fotos, modalidad sola, cola y reconexión | Persistencia no destructiva y reintento exacto. Debe dejar de reproducir los fallos conocidos. |

Piloto real futuro, solo con autorización: una **Alta creada después** del
SQL, contrato exacto con IPTV vinculada y equipo receptor real. Comprobar
`iptv_policy_version=1`, ONT y materiales genuinos, Zona/NAP, código y
evidencias habituales; seleccionar la modalidad que realmente corresponde.
Capturar inventario TV Box antes/después sin modificarlo para probar.
Completar una vez y releer estado/modalidad; confirmar Internet/IPTV y ficha
en solo lectura. Reintentos y carreras se prueban con sintéticos, no usando
clientes reales. Rosita nunca es piloto ni objeto de reapertura/corrección.

## Recuperación si falla la publicación

- Antes del SQL: mantener Campo cerrado, restaurar frontend del **mismo stage**
  con `node scripts/frontend-consolidation-release.cjs rollback` y verificar
  imágenes/artefactos originales. SQL sigue anterior. Conservar almacenamiento.
- Fallo de migración/lock timeout/guarda: detener; transacción aborta. Confirmar
  estado original y ausencia de habilitación parcial. No forzar locks ni
  ejecutar partes sueltas; no escribir en órdenes para hacer pasar la guarda.
- Después del SQL: detener nuevos envíos y sincronización antes de revertir.
  Preservar borradores/colas y cierres ya confirmados. Con autorización,
  restaurar frontend previo y ejecutar `scripts/rollback-installation-iptv-mode.sql`
  por canal privado; verificar función original, RPC retiradas y DEFAULT/
  trigger INSERT retirados. Columnas, modalidades, guarda UPDATE e inventario
  permanecen: no se borran ni recalculan.
- El rollback de datos es conservador, pero un Dúo nuevo por app sin TV Box
  vuelve a bloquear con la regla previa. No inventar equipos ni poner NULL
  a su versión. Mantener ese caso preservado hasta recuperación/reaplicación
  autorizada del paquete coherente, probada localmente. Si aún no hubo Altas
  posteriores al SQL, ese caso no existe; comprobarlo, no asumirlo.

## Evidencia y preservación

Se verificaron las 68 comprobaciones anteriores y que `src`, Flutter, SQL y
rollback no cambiaron respecto de `8086fba`; por eso no se repitieron builds
ni la investigación resuelta. **5/5 comprobaciones locales nuevas PASS** de
lectura/integridad con `scripts/tests/iptv-maintenance-preflight.test.mjs`.
No equivalen a autorización ni solucionan IndexedDB. Las 68 previas incluyen
caracterizaciones que confirman defectos, no 68 criterios de aprobación.

Las consultas de esta tarea solo leen estados, contadores, referencias y
metadatos. No cambiaron órdenes, contratos, stock, custodia ni movimientos;
no se abrió la ficha de Rosita. Migración y rollback tampoco contienen DML
retroactivo. Los pasos de publicación/respaldos/piloto siguen **sin ejecutar**.
Todos los pendientes de otras fases se conservan fuera del alcance.
