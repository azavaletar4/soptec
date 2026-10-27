# WiFi Huawei — preparación local segura, 27/10/2026

Continúa `b349d68` y su informe de caché. **Implementado localmente; no
desplegado, sin push ni tareas reales. No se ha probado escribir en la Huawei.**
Asistencia, Puntos, Campo y la divergencia de main se conservan.

Validación posterior: [formulario visualmente validado en laboratorio local](TR069-WIFI-VALIDACION-VISUAL-20261027.md).
Añade banda explícita/desconocida y comparación con nuevo Inform. Las pruebas
iniciales registradas abajo corresponden a `47cea2c`; no se habilitó escritura.

## Comportamiento preparado

- Se reutiliza el formulario de `/tr069`, ahora «Consultar WiFi» y «Preparar
  sin aplicar». Se retiraron sus campos PPPoE/contraseñas. No cambia la
  asignación ACS por OLT ni se rediseña el módulo.
- GET `/api/genieacs-sync/wifi/:serial`: compara representaciones completas
  ASCII/hex del serial GPON, rechaza ambigüedad y comprueba también los
  resultados devueltos por NBI. Devuelve únicamente identidad, SSID, instancia,
  Enable conocido/desconocido, fecha y capacidad anunciada; nunca claves.
  No exige Enable=true para mostrar una red. No infiere banda.
- POST `/api/genieacs-sync/wifi/:serial/prepare`: **solo ADMIN/SUPERADMIN**, tras
  `requireAuth` y perfil real del backend. Este POST de SmartRayco hace solo GET
  hacia GenieACS; no encola tareas ni solicita connection request.
- Preparación limitada explícitamente a `HWTC1D3691B7` y el dispositivo NBI
  `00259E-HG8145X6%2D13-485754431D3691B7`. El cliente envía deviceId, path,
  ssid, expectedSsid, expectedTimestamp y confirmed=true. No se admite ningún
  campo adicional. Solo una instancia que exista en ese dispositivo, con SSID
  y fecha recuperables. Se rechaza red desactivada o marcada no escribible.
- El usuario selecciona la red, sin valor por defecto, y confirma serial,
  instancia completa, nombre actual y nuevo. El servidor vuelve a consultar
  caché y exige mismo SSID/fecha; valida 1–32 bytes UTF-8, no vacío/controles
  ni nombre igual al anterior. Un `_writable=true` no acredita aceptación real.
- Devuelve plan `preparation_only` con respaldo SSID anterior, nuevo, identidad,
  path y fechas. El formulario permite descargarlo como JSON sin claves y muestra
  el valor de reversión. **El plan vive en el modal; descargar antes de cerrar.**
  Es respaldo de un SSID cacheado, no exportación completa ni prueba de vigencia.
- «Comparar caché sin refrescar» hace GET, exige misma identidad/instancia y
  timestamp mayor que la lectura inicial y la preparación. Aunque aparezca el
  nombre propuesto, informa que falta confirmación del propietario; no demuestra
  éxito de una tarea, conectividad ni cambio causado por SmartRayco.

## Bloqueos y límites deliberados

POST WiFi antiguo, POST PPPoE, aprovisionamiento combinado y mutaciones del
proxy NBI están bloqueados: 403 para roles distintos de ADMIN/SUPERADMIN,
423 para estos dos roles. El proxy conserva solo GET/HEAD. Así no se eluden
las guardas mediante `/devices/.../tasks`. Es un cambio del código local;
**no describe un bloqueo ya aplicado en producción**.

No se invocaron reinicio, refresh, métricas ni sincronización. Esas rutas
preexistentes no se ampliaron en este trabajo. Las funciones legacy de encolado
permanecen en el servicio para no mezclar fases; el nuevo formulario y las rutas
WiFi/PPPoE/provision no las llaman. Los scripts CLI previos no forman parte de
este flujo ni están autorizados para una prueba real.

No hay endpoint habilitado para aplicar el plan ni para revertirlo. No hay
bandera de entorno que lo desbloquee. Antes de una primera escritura habrá que
implementar/revisar una vía específica y autorizada, manteniendo contrato exacto,
instancia e identidad y sin reabrir el proxy genérico o el provisionado combinado.

Esta preparación no consulta ni modifica vínculos de contratos: se limita al
dispositivo de prueba fijado. El diagnóstico anterior encontró registro TR-069
sin contrato vinculado; la discrepancia debe verificarse antes de ejecutar una
escritura. No se usará otro contrato del cliente por coincidencia de nombre.

## Procedimiento para una futura primera prueba real

1. Revisar este commit y autorizar por separado cualquier despliegue. Verificar
   el contrato exacto de la ONT y su vínculo TR-069, sin vincular automáticamente.
   Mantener acceso por cable y recuperación local con el propietario presente.
2. En el formulario, consultar la Huawei, elegir explícitamente **una** instancia
   entre las redes encontradas y confirmar que SSID/fecha corresponden a la red
   real. No asumir 2.4/5 GHz por índice o nombre. Si falta dato reciente, GET de
   caché no lo renueva; acordar y autorizar separadamente cualquier lectura al
   CPE antes de usarla. No ejecutar refresh como parte de esta preparación.
3. Introducir un SSID de prueba distinto, confirmar el resumen y descargar el
   JSON con valor anterior/nuevo/path/deviceId. Revisar el respaldo y guardar
   también el valor anterior efectivo corroborado por el propietario.
4. Obtener autorización independiente que identifique ONT, contrato, instancia,
   valor nuevo y anterior, ventana y reversión. Esta confirmación del formulario
   solo prepara: **no sustituye esa autorización**. Aún se requiere la vía de
   ejecución específica revisada, con guardas backend ADMIN/SUPERADMIN y
   revalidación de identidad/contrato/SSID/fecha al aplicar; no publicar este
   código pensando que el botón ya escribirá.
5. En esa futura vía y ventana autorizadas, enviar exactamente un
   `setParameterValues` de `<path>.SSID`, `xsd:string`, al deviceId verificado;
   ningún otro parámetro. Registrar solo taskId, estado y datos no secretos.
   Mantener bloqueados PPPoE, KeyPassphrase, ManagementServer y WAN de gestión
   VLAN 200/IP 10.15.15.200. No enviar mediante el proxy genérico.
6. Distinguir encolado de aplicado: revisar resultado/fault de esa tarea y
   comprobar valor con fecha posterior a la operación. La comparación GET
   preparada ayuda, pero si el valor no se renueva espontáneamente no declararlo
   verificado; acordar el mecanismo de lectura posterior antes del envío.
   El propietario comprueba SSID visible, conexión WiFi e Internet/PPPoE estables.
7. Revertir solo `<path>.SSID` al valor anterior corroborado, con la reversión
   incluida expresamente en la autorización. Primero resolver tareas pendientes
   para evitar una aplicación tardía después de restaurar. Verificar resultado,
   fecha nueva y red visible de nuevo. Ante pérdida de gestión, usar recuperación
   local acordada; no tocar OLT/MikroTik ni acumular cambios a ciegas.

## Validación local

Pruebas focalizadas con NBI ficticio y autenticación JWT/JWKS/perfiles ficticios
en loopback: normalización exacta, ambigüedad, Enable desconocido, secretos
ausentes, selección explícita, otro dispositivo/path, caché cambiada, respaldo,
campos prohibidos, permisos reales de middleware y bloqueo del proxy/PPPoE.
No equivalen a prueba física ni a prueba visual de navegador del formulario.
**36/36 pruebas aprobadas** (18 WiFi, incluidas rutas con auth real y servicios
ficticios, más 18 de serial GPON). `tsc -p tsconfig.server.json --noEmit` y
`vue-tsc -b --pretty false` aprobados. Sin migraciones, despliegues ni escrituras
productivas. No se consultó producción en esta entrega.
