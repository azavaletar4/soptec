# App de Campo — "Failed to write blobs (InvalidBlob)" al cerrar con fotos (24/11/2026)

## Síntoma real

Un técnico intenta resolver una avería (o completar una Alta/Rutina — las
tres comparten la misma pantalla) con fotos de evidencia y aparece:

> Failed to write blobs (InvalidBlob)

Si elimina las fotos, el cierre pasa. Eso estaba provocando cierres sin
evidencia fotográfica.

## Causa raíz (confirmada por lectura del código, no supuesta)

El mensaje es el texto nativo exacto que Chromium/Android WebView emite
cuando `IDBObjectStore.put()` falla al intentar persistir un `Blob`/`File`
cuyo origen ya no es legible. Esto **no es un problema de Supabase** —
Supabase nunca se llega a tocar en este camino.

En `src/views/campo/CampoTrabajoDetailView.vue`, el `<input type="file"
accept="image/*" capture="environment">` entrega un `File` que, en Android,
puede seguir respaldado por un URI de contenido **temporal** de la cámara
nativa. Ese `File` se guardaba **directo**, sin materializar sus bytes, en
dos sitios que escriben a IndexedDB:

1. **Borrador automático del cierre** (`persistDraft` → `saveDraft`,
   `src/lib/formDrafts.ts`): se dispara 600 ms después de CADA foto
   capturada, y también de inmediato en cada `visibilitychange`/`pagehide`
   — exactamente el momento en que el técnico vuelve de la app de cámara
   nativa a la WebView. Antes de esta corrección, este guardado atrapaba el
   error (`draftStorageError`) pero no bloqueaba nada — no es la causa del
   cierre bloqueado por sí solo.
2. **Cola offline de cierres** (`enqueueClosure`, `src/lib/offlineQueue.ts`):
   se invoca como respaldo dentro de `submitClosure` (`src/stores/campo.ts`)
   cuando la subida directa a Supabase Storage falla con un error
   clasificado como de red (`isNetworkError`) — algo mucho más probable
   justo en la foto más pesada de la subida, con señal débil en campo. Esta
   llamada **no estaba envuelta en try/catch** dentro de `submitClosure`:
   si `enqueueClosure` fallaba por el mismo motivo (File con origen ya no
   legible), la excepción nativa salía cruda hasta la pantalla — el mensaje
   exacto reportado — sin encolar nada y sin indicar qué hacer.

La compresión de imagen (`compressImage`, `src/lib/imageCompression.ts`) ya
materializa un Blob nuevo vía `canvas.toBlob()` — pero eso ocurre recién
**justo antes de subir** (`performClosureSubmitInner`), nunca antes del
guardado en IndexedDB. Por eso el camino de subida directa online casi
nunca mostraba este error, pero el borrador y la cola offline sí.

## Reproducción (entorno aislado, sin tocar producción)

No es posible reproducir en este equipo la race exacta de Android (el
sistema operativo liberando el archivo temporal de la cámara) — eso
requiere un dispositivo Android real. Sí se reprodujo la **clase exacta de
fallo** que ese problema produce: un `File` cuyo origen ya no es legible
(`arrayBuffer()` rechaza), igual síntoma que reporta Chromium para un
content:// URI ya liberado. Con el código **anterior** a esta corrección,
pasar un `File` así a `enqueueClosure` (simulando la ruta real de
`submitClosure`) hacía fallar la escritura a IndexedDB sin ningún mensaje
comprensible y sin encolar nada — confirmado antes de aplicar el fix.

## Corrección (cambios mínimos)

- **Nuevo** `src/lib/safeBlob.ts`: `toSafeFile`/`toSafeBlob` — leen los
  bytes del origen (`arrayBuffer()`) y construyen un `File`/`Blob` nuevo,
  puramente en memoria, sin ninguna referencia al origen. Nunca atrapan el
  error de lectura — quien llama decide qué mostrar.
- `src/views/campo/CampoTrabajoDetailView.vue`: `onPhotoChange` y
  `onEquipmentFileChange` ahora materializan la foto con `toSafeFile`
  **apenas se captura**, antes de guardarla en `closurePhotos`/
  `equipmentEntries` — el único cambio que de verdad corrige la causa raíz,
  porque a partir de ahí TODO lo que sigue (vista previa, borrador
  automático, compresión, subida, cola offline) ya trabaja con un archivo
  seguro. Si la lectura falla (origen ya no disponible), se muestra
  `photoCaptureError` ("Vuelve a capturarla — no se perdió ninguna otra foto
  ni dato del formulario") y **no** se toca nada más del formulario.
- `src/lib/offlineQueue.ts` (`enqueueClosure`), defensa en profundidad:
  sanitiza también `photos[].blob`, `equipmentPhotos[].blob` y
  `signatureBlob` justo antes de escribir a IndexedDB — cubre cualquier
  llamador futuro, no solo esta pantalla. Si la sanitización falla, lanza
  un mensaje claro ("Vuelve a capturar esa foto — el resto del formulario
  no se perdió") en vez de la excepción nativa. Si falla la escritura misma
  (ej. `QuotaExceededError` — almacenamiento lleno), distingue ese caso con
  un mensaje específico de espacio, y en cualquier otro caso un mensaje
  genérico con el detalle técnico como dato secundario — nunca solo el
  texto crudo. Ningún caso deja una entrada a medio escribir en la cola.

Nada de esto cambia el comportamiento ya existente que preserva el
formulario ante cualquier error (`handleCloseSubmit` en
`CampoTrabajoDetailView.vue` nunca limpia `closurePhotos`/`equipmentEntries`/
`closureForm` en su `catch` — eso ya estaba bien, solo el MENSAJE era
incomprensible).

## Por qué cubre Altas y Rutinas sin tocar su lógica

Las tres órdenes (avería, alta, rutina) comparten la **misma** pantalla y
los mismos handlers (`/campo/:tipo/:id` → `CampoTrabajoDetailView.vue`,
confirmado en `src/router/index.ts`). No existe un segundo mecanismo de
captura para Altas/Rutinas — un solo fix cubre las tres sin duplicar código
ni tocar su lógica funcional propia.

## Pruebas

- `src/lib/__tests__/safeBlob.test.ts` — **5/5 PASS** (bytes/nombre/tipo
  intactos, copia independiente, origen ilegible rechaza, foto de 3 MB
  íntegra).
- `scripts/tests/photo-evidence-invalidblob-browser.mjs` (patrón ya usado
  en el proyecto: Vite + Chrome headless vía CDP, IndexedDB real, red
  externa bloqueada) — **19/19 PASS**: materialización sin corrupción;
  rechazo claro de un origen ilegible (foto, equipo, firma) sin dejar
  basura en la cola; varias fotos y una foto grande (3 MB) íntegras byte a
  byte; reinicio real de la app (recarga) conserva las fotos; simulación
  real de `QuotaExceededError` del navegador con mensaje específico de
  espacio y sin perder nada.
- Regresión de la cola offline ya existente, sin cambios de comportamiento:
  `scripts/tests/iptv-mode-browser.mjs` **30/30 PASS**,
  `scripts/tests/work-order-finality-browser.mjs` **20/20 PASS**.
- `npm run test:fetch-timeout` (toda la suite `src/lib/__tests__`) —
  **576/576 PASS**.
- `vue-tsc -p tsconfig.app.json --noEmit` limpio. `vite build` exitoso
  (aviso preexistente de tamaño de chunk, no relacionado).

## Riesgos y límites conocidos

- **No se reprodujo la race exacta de Android** (el sistema liberando el
  URI de contenido temporal de la cámara) — eso exige un dispositivo
  Android real. Se reprodujo la clase de fallo equivalente (origen
  ilegible) y se corrigió su causa estructural; falta la confirmación de
  un técnico cerrando con fotos reales en su dispositivo.
- Leer cada foto completa a memoria (`arrayBuffer()`) al capturarla agrega
  un paso async pequeño por foto; probado hasta 3 MB sin problema. Fotos
  excepcionalmente más pesadas (cámaras de muy alta resolución sin
  compresión) tomarían algo más, pero siguen acotadas por el tamaño típico
  de una foto de celular.
- La sanitización dentro de `enqueueClosure` es una copia adicional sobre
  un Blob que, viniendo de esta pantalla, ya es seguro — costo extra
  mínimo, intencional como defensa en profundidad para cualquier llamador
  futuro de la cola offline.
- Sin cambios de backend, Storage, RLS ni migraciones. Ninguna avería real
  fue tocada; toda la prueba usó datos 100% sintéticos en un entorno
  aislado (worktree/branch separada, IndexedDB efímera de Chrome headless).

## Archivos de esta corrección

- `src/lib/safeBlob.ts` (nuevo)
- `src/lib/offlineQueue.ts`
- `src/views/campo/CampoTrabajoDetailView.vue`
- `src/lib/__tests__/safeBlob.test.ts` (nuevo)
- `scripts/tests/photo-evidence-invalidblob-browser.html`, `.mjs` (nuevos)
- Este documento.

## Estado

**Implementado y probado localmente únicamente.** Rama aislada
`fix/campo-evidencias-invalidblob-20261124` (no se mezcló con los cambios
pendientes de otras fases ya presentes en el árbol de trabajo). **No
desplegado, no validado en un dispositivo Android real.** No confundir
estos tres estados.
