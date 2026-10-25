# Puntos: permisos, integración y validación Android — 25/10/2026

Continuación de HEAD `31fa8a1` y del informe `PUNTOS-CONTINUIDAD-PREACTIVACION-20261025.md`. Este documento cierra su pendiente de permisos en el candidato local, con las pruebas siguientes aprobadas. Las evidencias de navegador y catálogo del informe anterior siguen siendo históricas; no se ejecutaron contra producción en esta sesión.

## Causa y corrección acotada

El catálogo de la revisión anterior mostró que postgres concede ALL sobre tablas nuevas a service_role mediante privilegios predeterminados de Supabase. `20261024180000_work_order_points.sql` revocaba PUBLIC, anon y authenticated en `work_order_point_changes`, pero omitía service_role. Como este rol elude RLS, conservaba acceso directo para falsificar, editar, borrar o truncar la auditoría.

La corrección añade service_role al mismo REVOKE ALL sobre esa tabla. No se concede lectura directa al rol de servicio porque no hay consumidor autorizado que la requiera. Se mantiene SELECT para authenticated sujeto a la política administrativa y usuario activo. La RPC `adjust_work_order_points` y el trigger `guard_work_order_points`, SECURITY DEFINER, siguen escribiendo como propietario, tras comprobar ADMIN/SUPERADMIN activo, motivo, valor anterior y elegibilidad de la orden. No se cambian sus firmas, cálculos, reparto, guardas ni permisos de otros módulos.

Solo se cambia la migración candidata 180000; 190000 y 200000 permanecen intactas. La revisión anterior confirmó que las tres estaban pendientes: esta edición no sirve como actualización de una versión ya aplicada. Antes de activar se debe volver a comprobar el historial.

El propietario/superusuario conserva sus capacidades administrativas; la protección comprobada es frente a roles de aplicación, incluido service_role con BYPASSRLS. No se pretende restringir al propietario de la BD.

## Pruebas aisladas

`server/tests/workOrderPointsDefaultPrivileges.sql` reproduce los grants predeterminados sobre tablas/funciones de postgres y BYPASSRLS de service_role, basándose en los metadatos ya obtenidos. Se carga antes de las candidatas en las dos suites de puntos. No modifica la fixture compartida de otros módulos.

Las pruebas nuevas comprueban:

- Una tabla de control sí hereda INSERT de service_role; la auditoría no. Esto evita un falso positivo por omitir los defaults reales.
- Ausencia de INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES y TRIGGER para anon, authenticated y service_role en auditoría; también en confirmaciones tras instalar las tres candidatas. Sin SELECT para service_role en auditoría.
- Intentos SQL reales de inserción, falsificación, borrado y truncado por esos roles; bajo authenticated se prueban ADMIN, SUPERADMIN, líder y ayudante. Las operaciones fallan por permisos, sin alterar las instantáneas registradas.
- Ajustes ADMIN y SUPERADMIN en los tres tipos por la RPC autorizada con dos registros de auditoría correctos. Técnico y ayudante no pueden ajustar por RPC ni UPDATE directo.
- Confirmación administrativa con puntos ajustados, denegación a técnicos, reintento que devuelve el mismo ID y conservación de exactamente una confirmación y dos ajustes auditados.
- Regresiones existentes: atomicidad ante error final, doble confirmación concurrente, cierre definitivo, importes congelados, históricos y corte Lima.

Comando de validación:

```text
node --import tsx --test server/tests/workOrderPointConfirmations.sql.test.ts server/tests/workOrderPoints.sql.test.ts server/tests/closedOrders.sql.test.ts server/tests/routineReturns.sql.test.ts src/lib/__tests__/workOrderPoints.test.ts src/lib/__tests__/jobClosureIdempotency.test.ts
```

Resultado: **106 pruebas aprobadas, cero fallidas, canceladas u omitidas**, incluidas siete nuevas (cuatro de auditoría/ACL y tres de confirmación). Docker PostgreSQL 17 efímero, `--network none`, tmpfs y datos sintéticos; duración aproximada 125 s. Los límites de tiempo de las dos suites se amplían para los intentos SQL adicionales. No se repiten navegador/build porque no hay cambios en aplicación ni en cálculo; sus resultados previos no certifican el futuro candidato integrado.

## Git: diagnóstico y procedimiento propuesto, sin ejecutar integración

Base común: `40cd3967b573db0d8379e2df67449584ab10051b`.
GitHub main consultado en solo lectura: `f763d37b646a07ecbf70e354c8976ce96bae9d28`, igual a origin/main.
Antes del commit de esta corrección: 22 commits solo locales y 35 solo remotos. Después del commit local de esta entrega serán 23/35 si el remoto no cambia.

`git cherry origin/main HEAD` identifica siete parches locales equivalentes en remoto: `2aeed32`, `aa6e76a`, `e3c95aa`, `2f25873`, `05eecc1`, `cb5cab4`, `84b9af7`. Los otros quince no se marcan equivalentes; esto no demuestra que cada funcionalidad esté ausente del remoto, porque hay integraciones parciales y cambios posteriores.

Desde la base común se modificaron 156 rutas en el lado local y 283 en remoto; 69 aparecen en ambos. Es solapamiento, no una lista de conflictos de merge comprobados. Incluye `CampoTrabajoDetailView`, `CampoJobPoints`, `installations`, `ClientesView`, `domain`, `usePersonalRead` y package.json, además de cambios ajenos al sistema de puntos. En remoto `CampoJobPoints` consulta aporte acreditado con `my_field_job_points`; la versión local consulta puntaje asignado con `my_field_order_points`. La integración debe preservar esa distinción y la regla de confirmación definitiva.

Procedimiento para una sesión posterior con autorización de integración:

1. Inmovilizar referencias de respaldo para HEAD local corregido y origin/main. Respaldar historial con bundle y verificarlo. Guardar aparte diff binario del árbol e índice, inventario y copia con hashes de archivos no versionados; el bundle no incluye esos archivos. Respaldos sensibles locales/privados, nunca subir .env, credenciales ni archivos privados. No limpiar ni guardar todo indiscriminadamente en Git.
2. Actualizar origin/main con fetch sin tocar el checkout recibido. Si cambia de hash, recalcular el diagnóstico y revisar de nuevo el plan. Mantener referencias de respaldo del estado anterior.
3. Crear una rama de integración y worktree separado desde el origin/main fijado. Mantener el directorio de trabajo original y todos sus archivos sin cambios. Antes de reutilizar trabajo sin commit, clasificarlo por propietario/entrega y conservarlo en su respaldo o rama propia; no incorporarlo automáticamente.
4. En el worktree limpio, proponer un merge ordinario del HEAD local corregido con `--no-ff --no-commit`. Preserva ambos historiales y evita reescribir o hacer cherry-pick ciego de los siete parches equivalentes. No usar estrategias globales ours/theirs. Si hay conflictos, resolver por archivo con revisión de los responsables; si se abandona, abortar exclusivamente el merge del worktree aislado.
5. Revisar específicamente los cruces de Campo/puntos y las migraciones renumeradas de MikroTik y repetidas de materiales de ambas ramas. No conservar dos migraciones semánticamente iguales sin resolver su historial ni aplicar todas las pendientes. La integración de código no autoriza escrituras SQL. Los cambios de otros módulos se preservan y se remiten a sus responsables, sin auditarlos o corregirlos en esta entrega.
6. Comparar el resultado con ambos padres, revisar `git diff --check`, repetir pruebas focalizadas y construir desde un checkout limpio. Documentar qué dependencias de Mi avance vienen ahora de origin/main y cuáles siguen fuera de Git. Exigir que el candidato no dependa de archivos sueltos del árbol original.
7. Revisar commit de integración/PR y hashes de artefactos. No sustituir main local/remote ni publicar automáticamente. Push y despliegue requieren autorización posterior explícita.

No se ejecutó merge, rebase, reset, checkout, worktree de integración, fetch ni push en esta entrega. Solo lectura de grafo/diffs y el commit local acotado solicitado. El merge propuesto puede requerir resolución manual y no está certificado por este diagnóstico.

## Plan concreto de App Campo Android

Preparación pendiente; no se ejecutó en esta sesión. La app es Flutter con WebView, no una app nativa independiente de los formularios Vue. `mobile_app/lib/main.dart` fija URL y host de producción y restaura la última URL. Por eso no se debe instalar/usar la APK actual para pruebas de escritura. Chrome móvil o mocks no certifican los puentes nativos de cámara/GPS.

### Entorno y evidencia

1. Disponer frontend/backend/Supabase y Storage aislados con las tres candidatas, identidades sintéticas (ADMIN, SUPERADMIN, dos técnicos y técnico ajeno), contratos/NAP/equipos ficticios y salidas OLT/MikroTik/facturación bloqueadas o simuladas. Nunca usar órdenes, sesiones ni colas de producción.
2. Preparar, en copia separada y bajo autorización del ensayo, una APK de laboratorio con URL/host de laboratorio, aplicación identificable y almacenamiento independiente. No se modificó el módulo Android aquí. Bloquear red hacia producción y verificar destinos HTTP, Supabase y Storage antes de iniciar sesión; no basta cambiar la URL web si su configuración sigue apuntando a producción. Empezar con datos de prueba limpios para no recuperar la última URL ni IndexedDB de producción.
3. Usar un teléfono físico representativo de técnicos (incluido Xiaomi/MIUI si está en uso) y otro Android/WebView soportado. Registrar modelo, Android, versión WebView, APK/hash, commit web, versiones SQL, fecha Lima, red y permisos. Emulador solo complementario para cortes y recreación de proceso.
4. Por cada prueba registrar actor, IDs sintéticos, antes/después de BD y Storage, solicitudes, contador de colas, captura/video y error visible. No registrar tokens. Estado inicial de todos los casos: NO EJECUTADO. El responsable del ensayo debe registrar PASÓ/FALLÓ y evidencia por fila.

### Matriz de aceptación

| Caso | Acción en laboratorio | Criterio de aceptación |
| --- | --- | --- |
| A01 Puntos | Abrir Avería, Alta y Rutina como líder y ayudante; ajustar desde escritorio como administrador | Ambos ven total y parte asignada correctos; no pueden editar. La consulta operativa no se presenta como acreditación. |
| A02 Actualización | Ajustar puntos, retirar asignación, cambiar sesión; probar realtime, volver al foco y reconectar | Actualización efectiva o fallback de 15 s con pantalla visible; no se conservan datos de otra identidad/orden. No prometer puntos frescos sin conexión. |
| A03 Cámara | Tomar foto de hoja/equipo y elegir galería, cancelar selector, negar permiso y concederlo después; salir y volver de cámara | Fotos/borrador conservados, sin pantalla vacía ni duplicación; error recuperable al denegar. Probar recreación de proceso mientras la app está en segundo plano. |
| A04 GPS | Conceder ubicación, denegarla, desactivar ubicación y recuperarla; repetir en los tres formularios | Coordenadas o error visible coherentes con requisitos existentes, sin inventar GPS ni perder borrador. |
| A05 Sin firma nueva | Completar los tres formularios sin capturar firma | No aparece panel ni requisito nuevo de firma; no se crea archivo de firma nuevo. Fotos/hoja y demás requisitos existentes siguen operativos. |
| A06 Firma histórica | Sembrar cierre sintético con signature_path/archivo previo; reintentar antes de confirmación; simular fallo de lectura | Ruta y archivo previos intactos. Ante error de lectura se aborta/reintenta sin sobrescribir con NULL. No reabre captura. |
| A07 Cola heredada | Sembrar cola sintética antigua con signatureBlob, con y sin firma histórica ya guardada | Compatibilidad preservada: no sustituir firma existente; una evidencia previa pendiente se procesa sin exigir otra captura. |
| A08 Offline caliente | Cargar una orden mutable online, completar borrador, activar modo avión, enviar y reiniciar app | Cola IndexedDB contiene datos/fotos y sobrevive; no hay falsa confirmación de envío. Reapertura de la vista y conservación del borrador deben observarse en el dispositivo. |
| A09 Offline frío | Arrancar sin red después de cerrar proceso; luego recuperar conexión | No presuponer que el shell web se cargue offline: no se ha certificado caché del panel. Si no carga, aviso recuperable y cola intacta al volver online. Si se exige operación completa desde arranque frío, ese requisito queda bloqueado hasta demostrarlo. |
| A10 Reintentos | Cortar red tras subir foto, tras guardar cierre y antes de respuesta; doble toque y sincronización automática/manual simultáneas | Al recuperar red existe un cierre final, evidencias sin duplicación y cola retirada solo tras éxito; un fallo conserva ítem/error recuperable. |
| A11 Confirmación concurrente | Dejar ítem sintético en cola, confirmar administrativamente desde otra sesión y sincronizar | Guarda definitiva rechaza sin iniciar nuevas escrituras de contratos/GPS/subidas; importe, reparto, firma y materiales intactos. El ítem no se borra como éxito y muestra error; su resolución operativa requiere revisión, no reapertura. |
| A12 Permisos/periodo | Intentar ajuste/confirmación como técnico; confirmar como ADMIN y SUPERADMIN; repetir con orden de octubre y orden elegible de noviembre usando reloj de laboratorio | Técnicos rechazados, confirmación única, totales acreditados una vez, cierre inmutable, octubre excluido del oficial y fecha Lima correcta. |

Puerta de aceptación: A01–A12 con evidencia, sin pérdida de cola/firma/fotos ni acceso a producción; toda limitación de arranque frío se registra y se acepta explícitamente. Ante un fallo, detener solo ese ensayo, conservar datos/evidencia y proponer una corrección acotada antes de cambiar otros módulos.

## Bloqueos que permanecen para activar

- Integración pendiente y artefacto reproducible que preserve trabajo remoto/local y no dependa del árbol sucio.
- Sesiones reales de Supabase y prueba integral Android/realtime en aislamiento; disponer antes de una APK segura de laboratorio.
- Rollback coordinado BD/UI/artefactos después de COMMIT, ensayado con respaldo recuperable y preservación de auditoría/confirmaciones. El rollback transaccional ante error no sustituye ese plan.
- Repetición de preflight de catálogo/hash/ACL/historial y coordinación con clientes antiguos antes de instalar. El corte oficial sigue siendo 01/11/2026 00:00 America/Lima; no se cambió ni se habilitó por otra vía.
- Autorización explícita de migración/despliegue y, por separado, de publicación a GitHub. El commit local de esta entrega no autoriza ninguna de ellas.

No hubo consultas ni escrituras en Supabase productivo, cambios en órdenes reales, despliegues ni push. Archivos de esta entrega: una migración, dos suites de pruebas, una fixture de permisos y este documento. El informe previo permanece sin cambios como evidencia histórica y no se incorpora al commit acotado.
