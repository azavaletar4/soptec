# Certificación Android/WebView IPTV — preparada, pendiente de celular

**NO APTO para publicación. Cero pruebas físicas ejecutadas.** ADB no detecta
un celular conectado/autorizado. Modelo, versión Android, proveedor/versión
WebView y UA del dispositivo siguen sin evidencia; no se completan por inferencia.

Base documental `8b6f1af`; candidato de aplicación conservado:
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
  separado. La APK de laboratorio aún no se instaló en ningún celular.
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

Estas doce pruebas certifican la preparación de la sonda; **no se suman a
pruebas físicas Android ni sustituyen las 118 previas**. El receptor HTTP
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
- `desktop-check.json`: doce resultados, marcados `desktopOnly: true`.
- `device-readonly.json`: muestra ADB sin dispositivos, sin abrir aplicaciones.
- `apk-badging.txt` y `apk-network-security.txt`: inspección del APK compilado.
- `synthetic-server.json` / `events.jsonl`: datos y eventos solo de escritorio.
- `phone/prepared.json`: configuración para la sesión física; sus estados y
  eventos se guardarán en `phone/`, sin sobrescribir los de escritorio.

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
node scripts/android-iptv-lab/audit-apk.mjs <runtime>/prepared.json
node scripts/android-iptv-lab/desktop-check.mjs <runtime>/prepared.json
node scripts/android-iptv-lab/device-readonly.mjs <runtime>/device-readonly.json
```

Si falta caché, no cambiar versiones para compilar. La compilación de esta
entrega tuvo que permitir descarga de artefactos fijados; quedó documentado.

## Intervención necesaria ahora

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

### Matriz pendiente de ejecución física

| Caso | Acción y evidencia necesaria | Estado actual |
|---|---|---|
| Modalidad sola | Guardar una selección sin otros campos; esperar confirmación IDB; cerrar/reabrir APK y verificar selección idéntica. | PENDIENTE |
| Cámara/galería | Elegir Tomar foto con el selector nativo, aceptar permiso si se pide y fotografiar papel; guardar foto y nota. | PENDIENTE |
| Proceso Android detenido | Con guardado confirmado, llevar LAB a segundo plano, ejecutar `am force-stop com.smartrayco.iptvlab`, abrirla de nuevo y comparar hash/tamaño/nota/modalidad. Solo LAB. | PENDIENTE |
| Cola tras reinicio | Encolar sin red simulada, guardar evidencia, detener/reabrir LAB; verificar mismos IDs/Blobs, sin borrar ni duplicar filas. | PENDIENTE |
| Reconexión/reintento | Restablecer transporte, sincronizar y releer recibo. Probar también cambio real de conectividad Android, diferenciándolo del fallo simulado y de CDP offline; USB reverse puede mantener accesible loopback aunque se apaguen radios. | PENDIENTE |
| Respuesta perdida | Confirmación sintética seguida de corte de respuesta, reinicio y reintento; mismo recibo, contador de escrituras no aumenta por segunda vez. | PENDIENTE |
| Incompatible seguido de otro | Primera orden sin modalidad conservada; segunda independiente se confirma; corrección humana de primera conserva notas/fotos. | PENDIENTE |
| Smart TV / dispositivo propio | Selecciones reales se guardan/envían sin introducir un TV Box. Evidencia de UI/cola/transporte, separada de pruebas SQL. | PENDIENTE |
| Rayco | Propagar rechazo de preflight por serie/MAC/custodia y aceptar respuesta válida con modalidad/recibo, sin crear movimientos ficticios. El receptor es un fixture, no inventario real. | PENDIENTE |
| Upgrade con conexión antigua | Reproducir store legado y conexión retenida en **otro perfil LAB nuevo**, preservando registros/Blobs; comprobar bloqueo y recuperación al cerrar esa vista. No destruir la BD de esta sesión ni la habitual para fabricar la condición. | PENDIENTE |

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

**Se mantiene NO APTO:** faltan dispositivo, pruebas físicas y cierre de sus
evidencias. Para solicitar publicación deben quedar claros el alcance físico
realmente aprobado y cualquier verificación integrada pendiente; después
siguen las guardas y respaldos del procedimiento de publicación autorizado.
No se ejecutaron migraciones, consultas/escrituras productivas, push ni deploy;
Rosita, las 9 órdenes y 4 sesiones históricas permanecen fuera de esta prueba.

Archivos nuevos de preparación: `scripts/android-iptv-lab/prepare.mjs`,
`server.mjs`, `lab.html`, `lab.js`, `desktop-check.mjs`, `device-readonly.mjs`,
`audit-apk.mjs`, este informe y la evidencia JSON. Código/producto y paquete
IPTV anterior permanecen iguales. Cambios ajenos conservados sin incluirlos.
