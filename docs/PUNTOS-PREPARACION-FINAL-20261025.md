# Puntos: preparación final y bloqueo de compatibilidad — 25/10/2026 Lima

## Dictamen

**No recomiendo todavía autorizar la ejecución productiva.** El artefacto quedó certificado contra el frontend realmente desplegado; las colas del cliente desplegado pasan al cliente nuevo sin pérdida; el ensayo de recuperación conserva escrituras posteriores mediante una pausa coordinada y una copia reciente B1. Se encontró, sin embargo, una incompatibilidad concreta en una creación de Alta iniciada por el módulo de Clientes, que está fuera del alcance autorizado para correcciones.

No se modificó esa funcionalidad, ni Clientes, Contratos, Deuda, Facturación, órdenes históricas o las tres migraciones. Tampoco se aplicaron migraciones ni se desplegó. El riesgo de reapertura histórica permanece aceptado y no se vuelve a tratar como bloqueo.

## Artefacto certificado

| Identidad | Resultado |
| --- | --- |
| Código base de la VM | `b3790286c65ba6a00f759e8124e073e1b6ff6018` |
| Imagen frontend activa usada como referencia | `sha256:a86447e694bc563269c4d64cf808fd94dcae20f9f9910756b920525c1ebbd632` |
| Código de puntos | Los 20 archivos ya delimitados de `c6371a4`, sin incorporar cambios funcionales posteriores |
| HEAD al preparar | `d6d06cd8bb566eb97163e851d09c1300622e8bd5`, documental respecto de `c6371a4` |
| Imagen candidata | `sha256:66ca2ea36a8caddb1f4cd1c50d4a4cd861fe356b163ca6659e45e77af3eba068` |
| SHA-256 del archivo de imagen | `bc40db0d59186d26d0892092df789321fc59ff4d9667c3285b3a0c0315db4e75` |
| Archivo PC, excluido de Git | `scripts/inventory-auth-lab/runtime/points-final-certified-20261025.image.tar` |
| Staging VM | `/opt/smartrayco-staging/points-final-20261026T001656Z` |

Se reconstruyó la base en Linux con el Dockerfile y las dependencias fijadas de la fuente desplegada, conservando la configuración pública real. Resultado: **120 de 120 archivos servidos idénticos y Nginx idéntico**. La comparación anterior de Windows/Node 24 contra Linux/Node 20, que además omitía el archivo `50x.html` de Nginx, no constituía una certificación equivalente.

El candidato se preparó en otro árbol: únicamente los 20 archivos de puntos/Campo del manifiesto previo cambiaron. Todo el resto de la fuente, dependencias y backend quedó idéntico a la base certificada. No se copiaron prototipos, retiro de clientes, cambios de deuda o trabajos de otras ramas.

La imagen final parte de la imagen productiva exacta y superpone el contenido web compilado: conserva Nginx y los archivos anteriores. Entre las rutas de archivos ya existentes solo se reemplaza `index.html`; los chunks nuevos corresponden a la compilación con los cambios de puntos. La preservación de fuentes ajenas se verificó sobre todo el árbol, sin afirmar que los nombres de chunks compartidos permanezcan iguales.

Se verificó el hash del archivo entre VM y PC y la identidad OCI de la candidata: **17 blobs**, todos sus descriptores, tamaños y hashes correctos. Los contenedores creados para inspeccionarla nunca se iniciaron; frontend/backend activos conservaron imagen y hora de inicio. Certificar el alcance de fuentes no certifica ausencia de efectos funcionales sobre sus llamadores: precisamente la comprobación siguiente detectó uno.

Incidencias de preparación resueltas solo en staging: el primer build sin red no tenía dependencias completas; se repitió con `npm ci` del lock existente. BuildKit requirió etiquetas locales nuevas para referenciar las imágenes preservadas, en vez de interpretar un digest crudo como repositorio. No se actualizaron etiquetas productivas, Dockerfiles versionados ni versiones npm/Node del producto.

## Compatibilidad: siete grupos nuevos aprobados y un bloqueo confirmado

Se usó Chrome headless con perfil nuevo, IndexedDB real, stores desplegados de `b379028`, stores del árbol acotado y el SDK Supabase real. Todo el tráfico se limitó a loopback: API PostgREST/Storage de contrato sintético y PostgreSQL 17 sin red, con restricciones representativas. No se ejecutaron las tres candidatas ni se repitieron las pruebas SQL/RPC/RLS ya aprobadas. Esta cobertura no se presenta como una nueva certificación completa de Supabase ni de Android físico.

| Caso pendiente | Evidencia |
| --- | --- |
| Formularios/stores antiguos | Avería y Alta sin puntos son rechazadas sin crear la orden; Rutina antigua con puntos explícitos funciona. Necesitan ventana y recarga, no un valor automático oculto. |
| Actualización de página con cola antigua | Los registros producidos por `offlineQueue.ts` desplegado conservaron identificador, Blob de foto, Blob de firma y GPS al navegar al cliente nuevo en el mismo origen. |
| Creación con stores nuevos | Los tres tipos rechazan puntos ausentes antes de llamar a la API y crean con puntos explícitos positivos. |
| Envío completo de cola | Se ejecutó `syncQueued` real, incluido su refresco posterior, para los tres tipos. Conservó una Alta anterior con puntos NULL, firma histórica existente y coordenadas, sin backfill de puntaje. |
| Reintento | Otra sincronización no duplicó cierres ni subidas. |
| Entrada antigua de una orden ahora confirmada | Quedó retenida con fotos/firma y error de cierre definitivo; no hubo subidas/escrituras y se conservó la entrada siguiente. No se omitió ni reabrió la orden. |
| Límite de alcance | Ningún endpoint de Clientes, Contratos, Deuda, Facturación, OLT o MikroTik fue invocado. |

Un bloqueo de archivos del perfil Chrome afectó el primer arranque del harness. Se excluyó el perfil del watcher de Vite y se detuvieron exclusivamente los procesos de ese ensayo; no se cambió código del producto ni se borraron perfiles personales.

### Bloqueo en la conversión de prospectos

La fuente certificada de `src/views/clientes/ClientesView.vue`, dentro de la conversión, contiene:

```ts
await installationsStore.createInstallation({ client_id: savedId, contract_id: contractId });
```

Ese llamador queda intacto en el artefacto acotado y omite `points`. El store nuevo exige puntos positivos y lo rechaza **incluso después de recargar el cliente**. La secuencia existente ya creó cliente y contrato antes de intentar esa Alta; puede quedar incompleta la conversión. Esto no se resuelve con vaciar caché o coordinar únicamente los formularios antiguos.

Se ejecutó un caso adicional únicamente con ese payload exacto y el store candidato, usando IDs ficticios: fallo confirmado en la validación de puntos, cero nuevas instalaciones y cero llamadas de escritura a Clientes/Contratos. No se repitieron los siete grupos anteriores para aparentar cobertura adicional.

No se añadieron puntos por defecto, no se relajó la obligatoriedad, no se modificó Clientes ni se cambió SQL para sortearlo. Resolverlo exige una decisión explícita sobre el origen de los puntos en esa creación y autorizar la integración mínima correspondiente, o aceptar expresamente un cambio operativo en esa funcionalidad. Ninguna de esas decisiones se presume autorizada por el riesgo histórico aceptado.

## Recuperación posterior al respaldo: ocho grupos nuevos aprobados

Se reutilizó el respaldo Cloud completo y su restauración ya acreditada; **no se repitieron**. El ensayo pendiente usó PostgreSQL sin red y exclusivamente fixtures de datos ficticios representativos de órdenes, ajustes, confirmaciones con reparto, cierres y objetos. No ejecutó migraciones ni pretende sustituir los ensayos aprobados de las RPC del producto.

1. Se conservó una copia B0 antes de escrituras posteriores.
2. Después de B0 se crearon Avería, Alta y Rutina nuevas, un ajuste auditado, cuatro confirmaciones con instantáneas y una foto nueva; la firma histórica quedó intacta.
3. Restaurar B0 en otra base mostró que faltan esas escrituras: control negativo que descarta usar B0 como rollback posterior sin reconciliación.
4. Se mantuvo una operación pendiente en almacenamiento durable, se bloquearon las escrituras del rol del ensayo y las del emisor de objetos. Las solicitudes posteriores fueron rechazadas sin descartar la pendiente.
5. Durante esa pausa se capturó una copia completa reciente B1 y el inventario de objetos con hashes.
6. B1 se restauró en otra base y los objetos en otro directorio: todas las filas, ajuste, confirmaciones, instantáneas y bytes coincidieron con el corte B1; el histórico y su firma coincidieron con B0.
7. El destino recuperado siguió bloqueando escritores hasta completar la verificación.
8. Al habilitarlo, la operación pendiente se ejecutó una vez y sus reintentos no duplicaron cierres, confirmaciones ni auditoría.

**Método probado: parada coordinada + copia completa reciente B1 + destino separado + verificación + reanudación controlada. No se probó ni configuró recuperación incremental, WAL/PITR o combinación automática de deltas sobre B0.**

### Condiciones operacionales de ese método

Para usarlo en una contingencia autorizada, se requiere:

- Preservar el origen y B0; impedir escrituras nuevas antes de capturar el estado reciente. No basta cerrar la pantalla de Puntos o parar únicamente Hono, porque existen llamadas directas a Cloud.
- Coordinar y comprobar la barrera de todos los escritores de la base y Storage que se recuperarían: clientes administrativos y de Campo, cachés/colas, PostgREST/RPC directas —incluidas funciones SECURITY DEFINER—, backend y workers, importaciones/integraciones, trabajos programados, Auth y operaciones de objetos/metadatos. Las transacciones y subidas en vuelo deben terminar o quedar inventariadas antes del corte. No se cambian dispositivos de internet para hacerlo.
- Registrar responsables, hora UTC del corte, canales bloqueados y pendientes durables. Verificar que cada canal afectado rechace escrituras nuevas; mantener las colas sin vaciarlas. El fence del rol del laboratorio no se presenta como un bloqueo productivo ya instalado.
- Solo entonces obtener B1 completo, catálogo/permisos y manifiesto/bytes de Storage coherentes con ese corte. Conservar también la aplicación y configuración compatibles. El método de exportación por INSERT tardó aproximadamente 45 minutos en la copia Cloud ya validada; no se promete una parada breve ni un RTO fijo.
- Restaurar en un destino vacío compatible, no encima de la información actual. Comprobar datos, auditorías, confirmaciones, permisos y todos los objetos antes de decidir un cambio de destino autorizado. No volver ciegamente al frontend anterior, cuyos formularios omiten puntos, contra la base con obligatoriedad nueva.
- Abrir el destino solo tras verificación y con clientes compatibles. Reanudar pendientes/reintentos con identificadores preservados y verificar que no dupliquen operaciones. Mantener el origen y las evidencias; no borrar confirmaciones o auditorías para simplificar la recuperación.

Si no puede demostrarse la barrera completa, o si el origen ya no permite exportar B1 y no existe un registro incremental recuperable, **este procedimiento no garantiza conservar todas las escrituras posteriores**. No se autoriza restaurar B0 como si las contuviera. Resolver ese escenario mediante PITR/replicación u otra estrategia requiere su propia validación y autorización; no se implementó en esta sesión. No se asumió disponibilidad de esa infraestructura.

## Condiciones pendientes y riesgos

El bloqueo técnico nuevo es el llamador de conversión que omite puntos. No se corrige con la recarga coordinada y no se puede resolver dentro de esta fase manteniendo simultáneamente prohibida cualquier integración en Clientes y cualquier cambio de las migraciones.

Además, una activación futura exige ventana de creación/cierre/ajuste/confirmación coordinada: congelar esas operaciones afectadas, aplicar las tres versiones verificando cada transacción y publicar únicamente el artefacto aprobado antes de habilitarlas. No se hicieron esas acciones aquí. Deben recargarse los clientes sin borrar IndexedDB/datos de aplicación; conservar y sincronizar o revisar las colas antes de confirmar definitivamente las órdenes involucradas. Una cola detenida por un cierre definitivo necesita revisión, no reapertura automática ni descarte.

Las pruebas cubren la versión desplegada identificada y su DTO de cola. No certifican cualquier versión arbitrariamente anterior ni cámara/GPS/WebView/offline físicos en Android. Siguen a cargo del propietario esas pruebas físicas. El riesgo de reapertura histórica está aceptado y permanece sin corregir.

Antes de cualquier ejecución futura, se debe comprobar que los IDs de imágenes/base, el historial de las tres versiones y la guarda compartida siguen coincidiendo con la evidencia; si hay deriva, detenerse y revisar solo esa diferencia.

## Git, SQL y evidencia

Sin cambios de código de producto. Se conservaron byte a byte las tres candidatas, con SHA-256 de checkout:

- 180000: `a8af694c54d88661a9cb36c304214d5241933027080fda833a5344ef2c75c168`.
- 190000: `5a0ebce706331b3fa92433ec9b56ddf45470b03b475b8f299c6b49e55bbc7573`.
- 200000: `a73c3d58b634fbf9f02f9294e2def3edb2969cd5f92d5c70c186388dc68db59e`.

Evidencia y herramientas locales quedan excluidas de Git en `scripts/inventory-auth-lab/runtime/`: manifiestos `points-final-*`, resultados `points-legacy-compat-result-20261025.json`, `points-conversion-compat-result-20261025.json` y `points-postwrites-result-20261025.json`. La candidata está preservada para revisión; **no está aprobada para desplegar mientras exista el bloqueo indicado**.

Se publica únicamente este informe y su referencia de continuidad. No se incorporan archivos de prueba, imágenes, secretos, datos, cambios ajenos ni los tres informes locales previos sin seguimiento. Sin push de código funcional, migraciones, despliegue, operaciones MikroTik/OLT o escrituras de datos reales.
