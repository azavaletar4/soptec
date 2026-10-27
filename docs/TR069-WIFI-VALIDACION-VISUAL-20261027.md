# TR-069 WiFi — validación visual local, 27/10/2026

Continuación de `47cea2c`. **Formulario validado en Chrome local con datos y
stores ficticios. No se consultó producción ni se habilitó escritura real.**
La conexión de la Huawei permanece como hecho previamente confirmado; no se
repitió su diagnóstico. No se modificaron ONT, OLT, MikroTik, PPPoE, claves,
VLAN 120/200 ni vínculos de contratos. Sin despliegue, migración, push o merge.

## Hallazgos y ajustes confirmados

- Cada opción indica SSID, banda e instancia. Se muestra 2.4 GHz o 5 GHz solo
  ante un valor explícito conocido de `OperatingFrequencyBand`; cualquier
  ausencia/valor no reconocido produce **Banda desconocida**. Los datos reales
  previamente guardados de esta Huawei siguen sin banda confirmada: no se
  infiere del índice ni de `WirelessNet-5G`. El caso de bandas conocidas en las
  capturas es enteramente sintético, no evidencia de capacidad del firmware.
- El formulario muestra el serial GPON completo `HWTC1D3691B7`, el serial
  TR-069 y el deviceId GenieACS. Selección sin valor por defecto, instancia
  completa visible y misma validación backend exacta/única de `47cea2c`.
- Confirmación cancelable con seriales, path, SSID anterior/propuesto y aviso
  «No se enviará al equipo». Se encontró recorte horizontal de la ruta larga;
  se corrigió mediante `wrapMessage`, opt-in solo para esta confirmación,
  conservando líneas y ajustando texto largo. Los demás diálogos mantienen su
  presentación anterior. La captura final se inspeccionó sin recorte.
- El respaldo JSON descargado conserva `before=WirelessNet-5G`, `after`, path,
  serial, deviceId y fechas. Ahora añade `baselineInform` para comparación.
  Es respaldo de un nombre cacheado; no de clave WiFi ni de configuración total.
- Mensajes distinguen «Plan preparado. No aplicado», error de caché cambiada,
  pendiente por falta de Inform, falta de valor nuevo y valor propuesto observado
  con confirmación física aún pendiente. Se retiró el verde genérico del mensaje
  de comparación para no presentar un pendiente como éxito.
- Comparación exige Inform posterior a la preparación y al Inform inicial,
  además de fecha del SSID posterior a preparación/lectura inicial. Un nuevo
  Inform sin valor SSID nuevo **no confirma cambio**. Siempre hace GET de caché;
  no pide refresh ni connection request. Tampoco acredita causalidad ni éxito
  físico por sí sola; la futura ejecución debe comparar con su hora de envío.

## Prueba visual y evidencia

Fixture: `scripts/tests/tr069-wifi-visual.html`, monta el componente real
`src/views/tr069/Tr069View.vue` y la confirmación real con Pinia/Vue Router.
Stores de negocio sustituidos, fetch de negocio deshabilitado y destinos
productivos/API bloqueados en Chrome. No se ejecutaron tareas ni llamadas a
GenieACS/Supabase. La prueba visual no sustituye las pruebas backend de permisos.

Runner reproducible: Vite en `127.0.0.1:5187` y
`node scripts/tests/tr069-wifi-visual-browser.mjs`. Cerrar el laboratorio al
terminar; no usar este fixture como pantalla productiva. La etiqueta de
simulación está presente en todas las capturas. Se corrigió también el viewport
del fixture móvil para reproducir el viewport que la aplicación ya usa.

Evidencia bajo `docs/evidencias/tr069-wifi-local-20261027/`:

| Archivo | Comprobación |
|---|---|
| `01-red-instancia-desconocida.png` | SSID, banda desconocida, identidad e instancia seleccionada |
| `02-confirmacion.png` | Valores anterior/nuevo y ruta completa, sin recorte horizontal |
| `03-plan-respaldo.png` | Plan sin aplicar, respaldo descargable y reversión prevista |
| `04-pendiente.png` | Sin Inform posterior no hay confirmación |
| `05-valor-observado-no-certificado.png` | Caché nueva con SSID propuesto; falta confirmación del propietario |
| `06-error.png` | Error legible al cambiar la caché |
| `07-tecnico-solo-lectura.png` | TECNICO_RED sin botón de preparación |
| `08-bandas-explicitas-sinteticas.png` | Etiquetas 2.4/5 GHz con evidencia explícita ficticia |
| `09-movil.png` | Formulario a 390×844, datos de bandas sintéticos |
| `resultado.json` | PASS, operaciones ficticias, cero llamadas a equipos y cero excepciones |

Confirmación cancelada: cero llamadas de preparación; descarga JSON comprobada;
ADMIN prepara, SUPERADMIN ve preparación, TECNICO_RED consulta sin preparar.
Pruebas backend reales de autenticación/roles con JWT/JWKS/perfiles ficticios
complementan esos controles visuales. **37/37 pruebas aprobadas** (19 WiFi,
18 serial GPON), TypeScript backend/frontend y sintaxis del runner aprobados.
Se inspeccionaron visualmente plan, confirmación y móvil finales.

## Primera prueba real y reversión — todavía no autorizadas

1. Verificar contrato exacto de la ONT y su vínculo TR-069. Mantener cable,
   propietario presente y recuperación local. La asociación administrativa
   pendiente del diagnóstico anterior no se resolvió en esta entrega.
2. Obtener por separado aprobación del código/despliegue y de una vía específica
   para aplicar/revertir un solo SSID con guardas ADMIN/SUPERADMIN. **Este commit
   no ofrece ejecución ni reversión habilitadas**, ni bandera para desbloquearlas.
3. Elegir una red por serial completo/deviceId/path, corroborar el SSID anterior
   efectivo, preparar nombre nuevo y descargar respaldo. No tocar contraseña,
   seguridad, PPPoE, otra red, ACS ni WAN de gestión/Internet.
4. Autorización independiente debe fijar ONT, contrato, instancia, antes/después,
   ventana y reversión. Inmediatamente antes del envío futuro, revalidar identidad,
   contrato, path y SSID/fecha; registrar hora de operación y taskId. Enviar solo
   `<path>.SSID`, `xsd:string`, mediante la vía específica revisada.
5. Esperar un **Inform nuevo posterior al envío**, por el intervalo ya documentado
   de 300 s, y consultar después mediante GET el mismo deviceId/path. Revisar
   tarea/fault y que el SSID tenga fecha posterior al envío y valor esperado.
   El comparador actual usa la hora de preparación; para ejecución real, la vía
   futura debe usar la hora efectiva de envío como límite más estricto.
6. Si llega Inform pero no se renueva el valor del SSID, mantener pendiente:
   no asumir que el Inform trae todo el árbol. Acordar antes una lectura puntual
   posterior del CPE si se necesitara; también requiere autorización, pues un GET
   NBI solo lee caché. No ejecutar refresh automáticamente ni repetir escrituras
   ante timeout. Propietario comprueba SSID visible, conexión WiFi e Internet
   conservados. Sin eso no declarar éxito.
7. Resolver tarea pendiente/fault antes de restaurar para evitar aplicación tardía.
   Con la reversión autorizada, restaurar únicamente el SSID anterior efectivo en
   el mismo deviceId/path y registrar hora/taskId. Esperar otro Inform posterior
   a esa reversión y leer valor/fecha nuevos, más confirmación física. Si falta
   gestión, usar recuperación local acordada; no cambiar OLT/MikroTik ni acumular
   tareas. La reversión descrita es un procedimiento, no una función habilitada.

Riesgos vigentes: antigüedad del respaldo, bandas/seguridad reales sin confirmar,
aceptación de escritura Huawei no probada y necesidad de dato nuevo verificable.
`_writable=true` no elimina esos límites. La autorización del SSID se dará aparte.

## Archivos de esta entrega

Código: `server/src/services/tr069WifiPreparation.ts`,
`src/lib/tr069WifiPlan.ts`, `src/views/tr069/Tr069View.vue`,
`src/components/ConfirmModal.vue`, `src/components/ConfirmHost.vue`,
`src/composables/useConfirm.ts`. Pruebas:
`server/src/services/__tests__/tr069WifiPreparation.test.ts` y los dos archivos
de laboratorio visual citados arriba. Continuidad: `CLAUDE.md`,
`ESTADO_DESARROLLO.md`, `docs/TR069-CONTINUIDAD-HUAWEI-20261028.md`,
`docs/TR069-WIFI-PREPARACION-SEGURA-20261027.md`, este informe y sus evidencias.
Cambios ajenos conservados fuera del commit local.
