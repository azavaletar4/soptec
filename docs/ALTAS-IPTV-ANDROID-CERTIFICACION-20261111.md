# Certificación Android/WebView IPTV — resultado físico

**APTO para solicitar autorización de publicación controlada del candidato
`bcb3ec4`.** Se completaron **26/26 comprobaciones físicas** en un OPPO CPH2579,
Android 15 / API 35, `com.google.android.webview` **156.0.8078.47**. El APK
independiente se instaló y ejecutó sin abrir ni modificar Campo habitual.
Esta aprobación combina la certificación de plataforma con las pruebas
frontend/SQL previas; **no declara un E2E de toda la vista Campo contra
PostgreSQL**, ni certifica otros celulares/versiones. Publicar sigue requiriendo
autorización explícita y el preflight/respaldos remotos ya documentados.

Preparación `1f9474e`, base documental `8b6f1af`; candidato conservado:
`bcb3ec4c432c6baa39f175cca115795d5ae1cd45`. No se repitieron auditorías ni
consultas productivas. Evidencia actual:
`ALTAS-IPTV-ANDROID-EVIDENCIA-20261111.json`.

## Preparado y ejecutado desde esta computadora

- Flutter **3.47.5**, Dart **3.13.4**, SDK Android disponible y ADB
  **1.0.41 / 37.0.1-15733141**, consultados localmente.
- La APK normal tiene URL de producción fija; no permite cambiar a un entorno
  aislado por configuración de usuario. **No se abrió ni reemplazó**.
- Se extrajo la fuente Flutter del candidato a un directorio ignorado de
  laboratorio. Sus únicas diferencias nativas son URL/host loopback, ID/etiqueta
  separados, bloqueo de navegación externa, depuración WebView y permiso HTTP
  limitado a `127.0.0.1`. Cámara, selector de archivos, permisos, persistencia
  de última URL, UA y plugins reutilizan la implementación original.
- Nueva APK **`com.smartrayco.iptvlab`**, etiqueta **IPTV LAB - NO PRODUCCION**.
  La aplicación habitual `com.smartrayco.app` conserva su almacenamiento por
  separado. La instalación LAB fue nueva, sin `-r`, sin desinstalar ni borrar.
- Compilación Gradle local **BUILD SUCCESSFUL**; el primer intento offline
  encontró dependencias Kotlin ausentes. Se resolvieron las versiones fijadas
  desde sus repositorios de compilación, sin actualizar dependencias.
  `pubspec.lock` y Flutter de producción verificados sin cambios.
- `aapt` verificó ID, etiqueta, actividad, minSdk **24**, targetSdk **36** y
  bibliotecas `arm64-v8a`, `armeabi-v7a`, `x86_64`. La configuración compilada
  permite cleartext únicamente en `127.0.0.1`. `apksigner verify --verbose`:
  firma APK v2 válida, un firmante. Es un APK debug de pruebas, no un release.
- Sonda Vue compilada con selector, store de instalaciones y librerías reales
  de IndexedDB, borradores, cola, locks y recibos. Solo claves ficticias y
  datos `LAB-*`; no credenciales productivas. HTTP enlazado exclusivamente a
  `127.0.0.1:4176`, CSP `connect-src 'self'` y navegación externa bloqueada.
  No hay proxy, cliente PostgreSQL ni conexión a servicios reales.
- **12/12 comprobaciones nuevas de la sonda en Chrome de escritorio**, perfil
  efímero y red externa bloqueada: carga/capacidades/selector, guardado de
  modalidad-nota-foto, recarga conservando bytes, fallo de red, respuesta
  perdida tras confirmar, recuperación por recibo sin duplicar cierre,
  continuación de otra orden, corrección explícita de modalidad, mensajes y
  envío Rayco sintéticos, rechazo de IDs reales y ausencia de excepciones JS.

Las doce pruebas se repitieron después de ajustar la sonda y pasaron **12/12**;
**se cuentan aparte de las 26 físicas y de las 118 previas**. El receptor HTTP
persiste cierres sintéticos para simular respuesta perdida después del commit.
La sesión destinada al celular tiene archivos de datos separados de la sesión
Chrome; no se borraron los datos de ninguna de las dos.

### Artefactos reales

Directorio preparado:
`scripts/inventory-auth-lab/runtime/android-iptv-1794411550984/`.

APK: `mobile_app/build/app/outputs/apk/debug/app-debug.apk` dentro de ese
directorio. SHA-256:
`e057299c84f8eaff756f6a17254523fe13806ae327b5579de9100b0fce5aa28f`.

- `prepared.json`: ruta/hash APK y metadatos verificados.
- `desktop-check.json`: regresión actual de doce resultados, `desktopOnly: true`.
- `device-readonly.json`: Android/WebView autorizados, ambas APK presentes.
- `apk-badging.txt` y `apk-network-security.txt`: inspección del APK compilado.
- `synthetic-server.json` / `events.jsonl`: datos y eventos solo de escritorio.
- `phone/prepared.json`: configuración para la sesión física; sus estados y
  eventos se guardan en `phone/`, separados de escritorio.
- `phone/physical-check.json`: 26 comprobaciones, evidencias y notas de herramienta.
- `phone/production-before.json`: metadatos/hash de la APK habitual; comparados
  sin cambios después de las pruebas. No se leyó su almacenamiento privado.
- `phone/camera-recovery.png`, `flows-completed.png`, `legacy-upgrade.png`:
  capturas del WebView LAB. Permanecen en runtime privado, fuera de Git.

La foto real tiene **1.276.704 bytes**. Su hash de evidencia, que incluye sus
bytes y metadatos, fue idéntico antes/después de detener el proceso:
véase JSON, `physicalCertification.realPhoto`. Al finalizar hay **14 cierres
sintéticos y 14 órdenes completadas únicas** (incluye casos de ajuste de la
sonda), una respuesta perdida y cero pendientes en la cola principal tras
confirmación. La BD separada de legado conserva **un pendiente sintético**,
sus Blobs y un store adicional: no se eliminó para fabricar un cero.

UA real: `Mozilla/5.0 (Linux; Android 15; CPH2579 Build/AP3A.240617.008; wv)`
`AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/156.0.8078.47`
`Mobile Safari/537.36 SmartRaycoApp/1.0`.

Servidor iniciado en esta preparación: `127.0.0.1:4176`. Si ya no está activo
al retomar, iniciar **solo si el puerto no pertenece a otro proceso**:

```powershell
node scripts/android-iptv-lab/server.mjs scripts/inventory-auth-lab/runtime/android-iptv-1794411550984/phone/prepared.json
```

Preparación reproducible y consultas de herramientas, sin producción:

```powershell
node scripts/android-iptv-lab/prepare.mjs
# El comando anterior entrega un directorio NUEVO; usar su ruta en los siguientes.
C:/flutter/bin/flutter.bat pub get --offline
# Ejecutar pub get dentro de <runtime>/mobile_app, no en mobile_app productivo.
# Dentro de <runtime>/mobile_app/android, con JAVA_HOME del JBR instalado:
./gradlew.bat --offline --no-daemon --max-workers=2 assembleDebug -Ptarget-platform=android-arm64
node scripts/android-iptv-lab/build-web.mjs <runtime>/prepared.json
node scripts/android-iptv-lab/audit-apk.mjs <runtime>/prepared.json
node scripts/android-iptv-lab/desktop-check.mjs <runtime>/prepared.json
node scripts/android-iptv-lab/device-readonly.mjs <runtime>/device-readonly.json
```

Si falta caché, no cambiar versiones para compilar. La compilación de esta
entrega tuvo que permitir descarga de artefactos fijados; quedó documentado.

## Intervención física realizada

El teléfono primero apareció como `unauthorized`; tras refrescar la conexión
quedó autorizado. El usuario proporcionó la foto mediante el selector nativo.
Los reinicios, lectura de evidencias, cola y reintentos se automatizaron.
**No se necesita otra acción física para cerrar esta fase.** Los pasos
siguientes quedan como procedimiento reproducible, no como pedido pendiente.

1. Conectar un celular Android de prueba por **USB de datos** y desbloquearlo.
2. En Opciones de desarrollador activar **Depuración USB**. Si no aparecen esas
   opciones: Ajustes → Acerca del teléfono → tocar siete veces Número de
   compilación (en algunos fabricantes, Versión de software/MIUI); volver a
   Ajustes y buscar Opciones de desarrollador.
3. Aceptar **Permitir depuración USB** para esta computadora en el celular.
4. Mantener cerrada la App de Campo habitual. **No** borrar almacenamiento,
   caché, desinstalar, cerrar sesión ni regularizar pendientes para esta prueba.
   Avisar al agente cuando esté conectado; no hace falta ejecutar comandos.

Después solo se solicitarán las confirmaciones Android que realmente aparezcan
y **una fotografía de un papel u objeto sin datos personales** para comprobar
el selector nativo. El agente puede automatizar lectura de versiones, campos,
recarga, cierre del proceso de la APK de laboratorio, reintentos y evidencia.
No pedir al usuario que realice manualmente lo que pueda ejecutar ADB/CDP.

## Secuencia para retomar al conectar el celular

1. Ejecutar `device-readonly.mjs`. Debe existir **un único dispositivo físico
   autorizado**. Si hay varios, seleccionar uno antes de cualquier instalación.
   Registrar fabricante/modelo, Android/API/ABI, `dumpsys webviewupdate`, UA y
   capacidades efectivas. No abrir Campo normal para inspeccionar sus pendientes.
2. Comparar el SHA APK con la evidencia. Consultar
   `adb -s <serial> shell pm path com.smartrayco.iptvlab`.
   Si ya existe la APK de laboratorio, **no** actualizarla ni reinstalarla a
   ciegas: primero identificar build y leer/preservar sus borradores/colas.
   No utilizar `pm clear`, `uninstall`, ni instalar sobre `com.smartrayco.app`.
3. En un perfil de laboratorio nuevo y vacío por su propia creación, ejecutar:

   ```powershell
   D:/Android/platform-tools/adb.exe -s <serial> reverse tcp:4176 tcp:4176
   D:/Android/platform-tools/adb.exe -s <serial> install <APK-verificada>
   D:/Android/platform-tools/adb.exe -s <serial> shell am start -n com.smartrayco.iptvlab/com.smartrayco.app.MainActivity
   ```

   Sin `-r`, sin desinstalar y sin limpiar datos. Si Android solicita aprobación
   de instalación por USB, pedir únicamente esa confirmación física. El host es
   loopback mediante USB, sin DNS, certificados de prueba ni cambio de producción.
4. Comprobar título de laboratorio, URL, `isSecureContext`, `navigator.locks`,
   IndexedDB y Web Crypto. Enlazar únicamente el socket `webview_devtools_remote`
   del **PID de laboratorio**, nunca el de la aplicación habitual. No guardar
   identificadores/credenciales privados del dispositivo en documentación pública.
5. Seguir la matriz física; capturar JSON por caso y pantallas **del laboratorio**.
   Antes/después de detener el proceso, registrar IDs de cola, modalidad, notas,
   tamaño/hash de fotos y recibos del receptor sintético. Cada ejecución debe
   llevar versión Android/WebView, commit fuente y hash APK.

### Matriz de resultados físicos

| Caso | Acción y evidencia necesaria | Estado actual |
|---|---|---|
| Modalidad sola | Selección sin nota/foto, guardado confirmado y force-stop/reapertura; selección idéntica. | PASS |
| Selector nativo/foto | Foto real recibida por el puente nativo y guardada en IndexedDB. No se distingue aquí una certificación separada de cámara y galería. | PASS |
| Proceso Android detenido | Force-stop solo LAB; foto de 1.276.704 bytes, hash, nota y modalidad idénticos al reabrir. | PASS |
| Cola tras reinicio | Mismos IDs, modalidad y foto después de force-stop, sin pérdida ni duplicación. | PASS |
| Reconexión real | Retirada/restauración de `adb reverse`, con conexiones HTTP cerradas: error real de fetch, cola retenida y una confirmación al reconectar. No se tocaron radios. | PASS |
| Offline WebView | CDP fuerza `navigator.onLine=false`, cola conservada; al volver online confirma una vez. Es emulación CDP, no cambio de Wi‑Fi/datos. | PASS |
| Respuesta perdida | Corte de respuesta después de confirmar, reinicio y reintento; recibo reconocido y ninguna segunda escritura. | PASS |
| Incompatible seguido de otro | Se conserva el primero sin modalidad; el segundo independiente confirma; corrección explícita recupera el primero. | PASS |
| Smart TV / dispositivo propio | Modalidades transmitidas sin introducir TV Box. Alcance físico: selector/cola/store/transporte; reglas SQL en pruebas previas. | PASS |
| Rayco | Mensaje de rechazo serie/MAC/custodia visible y pendiente retenido; respuesta válida sintética transmite modalidad/recibo. No certifica inventario real desde el celular. | PASS |
| Concurrencia | Dos sincronizaciones simultáneas y reintento vacío: un envío confirmado y sin incremento duplicado. | PASS |
| Upgrade con conexión antigua | 8 comprobaciones en **BD LAB de nombre separado**, redirigiendo solo el nombre pedido por las librerías reales. Bloqueo recuperable; versión 1→2 aditiva, Blobs/store extra preservados, lectura antigua compatible. BD principal sin cambios. No se borró ninguna BD ni se creó otro perfil productivo. | PASS |

### Ajustes de la herramienta durante la ejecución

- El borrador ya persistía en IDB, pero el marcador auxiliar LAB en
  `localStorage` podía perderse con un force-stop inmediato. Se guardó también
  en IDB y se repitió la prueba; los dos borradores iniciales quedaron intactos.
  **No es un cambio de `src/lib/formDrafts.ts` ni de la aplicación candidata.**
- Se corrigieron esperas de arranque Android y de finalización del guardado de
  nuevas órdenes sintéticas en el driver. Se restablecen flags del fixture
  al repetir un caso; las filas anteriores se conservan.
- Quitar el túnel USB no cerraba conexiones HTTP keep-alive existentes. La
  primera tentativa llegó a confirmar exactamente una vez; no fue pérdida de
  cola. Se ajustó solo el servidor LAB a `Connection: close` y se probó el
  corte efectivo. El archivo de datos del receptor se conservó al reiniciarlo.
- El probe legado se compiló dentro de función async por el target Vite.
  El preparador conserva assets anteriores y sustituye solo tras build válido;
  nunca borra bases de datos del teléfono. Una lectura CDP final auxiliar se
  interrumpió al no responder; no invalida las 26 aserciones terminadas ni
  las comparaciones previas de metadatos/APK.

## Límites y criterio de salida

Esta sonda usa componentes y librerías del candidato, pero **no monta toda la
vista Campo ni una instancia PostgreSQL**. El fixture Rayco demuestra que el
cliente transmite modalidad y muestra rechazos; no certifica custodia real.
Las tres modalidades, inventario sin descuento adicional, ONT/NAP, materiales,
permisos, concurrencia y rollback ya tienen 22 pruebas PostgreSQL sintéticas
registradas en el informe anterior; no se atribuyen al celular ni se repiten
como auditoría. Para declarar una prueba de cierre integrada Android→SQL hay
que ejecutarla en un backend aislado real, con datos sintéticos y el flujo
Campo completo; no convertir una respuesta simulada en aprobación E2E.

No se certifican la versión nativa instalada en los celulares de técnicos,
su almacenamiento productivo, su sesión autenticada real ni la caché servida
por producción a partir de la sonda. La información del servidor no prueba
que esos celulares carezcan de pendientes. Si aparecen trabajos locales,
conservarlos y reconciliarlos antes de actualizar o reenviar.

**Resultado de esta fase: APTO para solicitar publicación controlada**, con
el alcance modular y dispositivo descritos. Supera el bloqueo de certificación
de plataforma pendiente; no convierte el transporte ficticio en un E2E ni
autoriza un despliegue. Quedan sin ejecutar: toda la vista Campo→PostgreSQL
en un entorno integrado, radios Wi‑Fi/datos, otros modelos/versiones y piloto
real autorizado. Las reglas contractuales/de inventario dependen de las
pruebas SQL previas, no de simular custodia en esta sonda. Mantener las guardas,
respaldos y primer uso controlado del procedimiento publicado.
No se ejecutaron migraciones, consultas/escrituras productivas, push ni deploy;
Rosita, las 9 órdenes y 4 sesiones históricas permanecen fuera de esta prueba.

Archivos nuevos de preparación: `scripts/android-iptv-lab/prepare.mjs`,
`server.mjs`, `lab.html`, `lab.js`, `desktop-check.mjs`, `device-readonly.mjs`,
`audit-apk.mjs`; se añadieron `physical-device.mjs`, `physical-check.mjs`,
`build-web.mjs`, `legacy.html` y `legacy.js`. Este informe/evidencia actualizan
el resultado. Código/producto y paquete
IPTV anterior permanecen iguales. Cambios ajenos conservados sin incluirlos.
