# Cambio manual de SSID — candidato local y despliegue detenido

## Resultado vigente

El propietario autorizó implementar y desplegar la función, pero reservó el
envío del cambio real para su prueba manual. Se implementó el candidato y pasó
las pruebas locales. **NO se desplegó: el botón real nuevo no está disponible.**
Se detuvo por `BASELINE_FRONTEND_NOT_REPRODUCIBLE` antes de recrear servicios.
No se intentó resolverlo fusionando ramas, sustituyendo el frontend completo
desde main ni forzando Git. No se enviaron tareas reales de cambio o lectura.

## Función implementada solo local

- Botón «Configurar» → selección de instancia 5, SSID cacheado actual, nuevo
  nombre y confirmación explícita «Enviar cambio». La instancia 1 es consulta.
- Escritura fijada en servidor a
  `InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.SSID`, Huawei
  `HWTC1D3691B7`, deviceId `00259E-HG8145X6%2D13-485754431D3691B7`.
- Solo ADMIN/SUPERADMIN con autenticación y perfil del backend. POST antiguo,
  PPPoE, provisionado combinado y proxy siguen bloqueados. No recibe una lista
  de parámetros ni acepta password, WAN, VLAN u otras instancias/equipos.
- Revalida ONT no retirada y única del contrato exacto
  `bf6b0f88-3c55-4c9b-aca2-5dfa739e738c` / CTR-2026-00214, cliente concordante
  y registro TR-069 único. Admite `service_contract_id=null` exclusivamente
  después de verificar esa cadena exacta; otro vínculo se rechaza. No modifica
  asociaciones ni adivina por nombre del cliente.
- Antes de escribir, coteja SSID/fecha/deviceId/path confirmados, exige capacidad
  anunciada, rechaza tareas/faults previos y persiste el respaldo mediante
  archivo temporal, fsync y rename. Un bloqueo exclusivo evita envíos concurrentes.
- Registro previsto en el volumen existente:
  `/var/lib/smartrayco-olt/tr069-wifi-trial.json`. Conserva SSID original,
  instancia, actor, requestId, hora y taskId sin contraseñas. Sobrevive a recrear
  el backend. Un requestId repetido no reenvía. Resultado de red incierto o
  bloqueo tras caída impiden repetir/restaurar a ciegas.
- «Verificar resultado» es una acción explícita del operador: cuando la tarea
  de escritura deja de estar pendiente y no hay faults, puede encolar una
  lectura `getParameterValues` exclusivamente del mismo SSID. «Consultar estado»
  solo hace GET; nunca encola. No usa connection request ni refresh general.
- Solo verifica con tareas finalizadas, sin faults, Inform posterior al envío
  y SSID esperado con fecha posterior a solicitar la lectura. HTTP 202 no es
  éxito. El mensaje pide comprobar red y navegación también.
- «Restaurar SSID anterior» usa exclusivamente el respaldo persistido, requiere
  cambio verificado y otra confirmación. Rechaza tareas pendientes o SSID
  modificado fuera de la prueba. La prueba admite un cambio y una restauración;
  no permite encadenar cambios arbitrarios.
- Desactivado por defecto. El candidato requeriría en backend
  `TR069_WIFI_TRIAL_ENABLED=HWTC1D3691B7:CTR-2026-00214`. Esa configuración
  **no se aplicó**. No hay activación automática por entrar al panel.

API nueva bajo `/api/genieacs-sync/wifi/:serial/trial/`:
GET `status`, POST `change`, POST `verify`, POST `restore`. Toda acción está
protegida por permisos de backend. Referencia del transporte:
[API oficial GenieACS](https://docs.genieacs.com/en/latest/api-reference.html)
(tareas específicas, espera al Inform y posterior lectura NBI).

## Pruebas

- **42/42**: 19 preparación/roles, 18 serial GPON, 5 ciclo de cambio/restauración,
  persistencia, idempotencia, fallo de red, faults, contrato inyectado inválido,
  payload/ruta/serial ajenos y cero tareas desde GET. Autenticación real del
  middleware con JWT/JWKS/perfiles ficticios; rutas nuevas rechazan otros roles.
- `tsc -p tsconfig.server.json --noEmit` y `vue-tsc -b --pretty false`: PASS.
- Chrome local con componente real y stores ficticios: confirmación cancelable,
  instancia 1 bloqueada, aceptación pendiente, restauración bloqueada hasta
  verificar, restauración al valor original. **6 capturas**, inspeccionadas,
  bajo `docs/evidencias/tr069-wifi-habilitado-local-20261027/`, resultado PASS,
  cero llamadas a equipos reales.
- No se probó escritura/lectura activa sobre la ONT productiva. `_writable=true`
  continúa siendo capacidad anunciada, no compatibilidad físicamente probada.

## Respaldo y motivo concreto de parada

Staging privado: **`/opt/smartrayco-staging/tr069-wifi-manual-20261027/`**.
Se guardaron imágenes Docker completas y configuración privada con permisos
restrictivos. No copiar configuración/inspect privados a Git o informes.

| Respaldo | SHA256 del archivo |
|---|---|
| `backend-before.image.tar` | `93f88d04e7af7895d11bfe414dce4e33a12fd5b735963f17fe687524f6c6abdc` |
| `frontend-before.image.tar` | `3cd6b1dd31c2465cb927160c9e4c8ce3b03465d7d0e382dfa39e60b945823e0b` |

Los archivos se abrieron como tar y se verificó manifest/configuración rootfs.
Etiquetas locales de recuperación preparadas:
`smartrayco-wifi-backend-rollback:20261027` y
`smartrayco-wifi-frontend-rollback:20261027`. Definición de recuperación local:
`TR069-WIFI-ROLLBACK-20261027.json`, para usar solo si fuese necesario y tras
revisar la cadena compose guardada. **No se ejecutó rollback, porque no hubo
promoción.** No restaurar SSID como parte del rollback de software.

La preparación quiso reproducir la base del frontend desde `0480b3a` usando
dependencias de la imagen backend activa y los argumentos configurados. El
HTML generado **no coincide** con el HTML de la imagen frontend activa
`smartrayco-tr069enable:516faba-20261027T181713Z`. La causa exacta de la
diferencia no se investigó después de la parada solicitada; no se afirma que
ya se haya identificado código perdido o una fase concreta afectada.

Sin esa reproducibilidad no se puede garantizar que el candidato preserve las
entregas reales de Asistencia, Puntos y Campo. Por instrucción del propietario
de detenerse ante riesgo concreto, **no se promovió** ni se intentó una sustitución
amplia desde main. El bloqueo se limita a construir/promover el artefacto correcto;
no reabre el diagnóstico TR-069 ni requiere cambios en la ONT.

Hubo antes un error de referencia Docker `FROM sha256:...` en el build candidato,
corregido usando etiquetas locales respaldadas. No cambió servicios. La parada
definitiva es la diferencia de HTML de la base, no aquel error de sintaxis de build.

## Estado productivo confirmado al detenerse

Comprobación solo lectura **27/10/2026 21:26:46 UTC / 16:26:46 Perú**:

- Frontend conserva imagen `sha256:902b127b24626500b41463c79010561856a4016cb16fb7605b50d68946780958`.
- Backend conserva `sha256:b3d27b540141954bf5164bb2b716bcd98f0bd973dc8fabf3caa099233580f9eb`.
- Frontend, backend, Caddy, Mongo y GenieACS mantienen sus mismos IDs de
  contenedor, imágenes y horas de inicio; todos siguen ejecutándose.
- `deployAttempted=false`; no existe archivo de intento de promoción.
- **Tareas reales enviadas por Codex: 0.** Sin cambio de SSID, contraseña,
  PPPoE, WAN, VLAN, asociaciones ni otras ONT; sin migraciones ni push/merge.

Evidencia saneada: `TR069-WIFI-DESPLIEGUE-DETENIDO-20261027.json`.
Siguiente paso pendiente: alinear el proceso de compilación/base del frontend
con el artefacto activo antes de reintentar una promoción selectiva. El botón
de escritura real aún no está disponible para la prueba manual del propietario.
