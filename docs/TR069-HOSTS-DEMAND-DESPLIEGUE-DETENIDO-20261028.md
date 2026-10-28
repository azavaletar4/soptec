# Hosts bajo demanda: prueba real PASS, build detenido

Autorización del propietario: una única lectura activa sobre HWTC1D3691B7 y,
solo si todas las validaciones pasan, despliegue exclusivo de la función e2c7bf7.
Se detuvo al primer fallo de build; no se ejecutaron deploy ni verify.

## Prueba real

Preflight 23:06:54 UTC: ID GenieACS único
`00259E-HG8145X6%2D13-485754431D3691B7`, serial `485754431D3691B7`, Inform
23:03:39.300 UTC, cero tareas y cero faults; salud API OK. Imágenes reales:
- Backend `smartrayco-backend-wifitrial:d6ce2c2f578f`,
  `sha256:1e6ab34c4fae061efc4943a7fa717b88acd388eb5f06038e96de2aa8255e3001`.
- Frontend `smartrayco-frontend-consolidado:5d48a10ea497`,
  `sha256:eaa37bca78b9a3ab9006728d8794fd60b1abc9f4da75e88f59aeeb672d1c103b`.

Código exacto e2c7bf7 copiado a un directorio /tmp aislado en el backend,
con hashes SHA-256 verificados, sin sustituir /app ni habilitar su gate global.
Se ejecutó una sola llamada al servicio, con ONT fija, control de un solo POST
y registro previo persistido. El servicio usó connection_request y expiry
45 s tal como estaba preparado, sin cambiar configuración.

**Una tarea GPV, HTTP 200**, solicitada 23:07:06.758 UTC; task
`6ae2801a220eb9ba9f4c3581`. Las 35 hojas son siete por cada Host 1–5:
Active, InterfaceType, Layer2Interface, HostName, IPAddress, MACAddress,
X_HW_RSSI. Ninguna contraseña, credencial, SSID, WAN, prefijo ni comodín.

Inform **23:07:06.891 UTC**, valores **23:07:06.893 UTC** (18:07:06 Lima).
El servicio confirmó todas las fechas y devolvió `state: completed` a las
23:07:07.337 UTC. Nombre/IP/MAC también se renovaron, no solo Active.

| Dispositivo | IP | MAC | Tipo | Estado de la muestra | X_HW_RSSI crudo |
|---|---|---|---|---|---|
| REDMI-Note-15-5G | 192.168.100.37 | d2:d3:3a:8d:85:1c | WiFi | Desconectado | 0 |
| S26-Ultra-de-Warner | 192.168.100.35 | 56:b9:d2:f2:e7:c1 | WiFi | Conectado | -43 |
| iPhone | 192.168.100.38 | be:9e:54:93:df:8c | WiFi | Desconectado | 0 |
| Z2359 | 192.168.100.34 | 7e:75:b3:0a:86:76 | WiFi | Conectado | -57 |
| LAPTOP-996NPL7I | 192.168.100.32 | 00:07:29:55:35:57 | Cable | Desconectado | 0 |

RSSI tiene tipo xsd:int y fecha nueva, pero no se verificó su unidad/escala;
no convertir -43/-57 automáticamente a dBm o porcentaje. `wifiSignal` sigue
null, banda null. Son resultados de esa muestra y caducan; un Inform posterior
no los convierte en actuales indefinidamente.

GET posteriores al ensayo 23:07:07 UTC: **cero tareas y cero faults**. Trazas:
exactamente un POST de tarea, sin DELETE/retry, sin otras ONT; ningún cambio de
configuración, reinicio, migración o despliegue. Pruebas de render/panel verifican
que entrar a la página, renders o Hosts cerrado no crean solicitudes.

Evidencia íntegra: `TR069-HOSTS-DEMAND-CONTROLLED-20261028.json`.
Ejecutor `scripts/tr069-hosts-demand-controlled.cjs`: no volver a ejecutar run;
tiene guardas local y remota para impedir repetir la autorización consumida.

## Guard de alcance y release

e2c7bf7 tenía interruptor global. Para respetar «solo Huawei de prueba», se
añadió el guard **ac511d7**, sin cambiar lectura, parser ni interfaz: además
de ENABLED=true exige serial permitido en TR069_HOSTS_ON_DEMAND_SERIALS.
La lista planeada contiene solo HWTC1D3691B7; cualquier otra ONT se rechaza
antes de GET/tareas. ADMIN/SUPERADMIN y requireAuth se conservan.

El contrato admite únicamente esos dos ajustes de entorno de Hosts, no claves
arbitrarias ni ajustes de WiFi. Se inyectan en la imagen backend candidata;
se comparan hashes del entorno efectivo completo y del entorno de rollback.
La configuración Compose permanece igual salvo las imágenes declaradas.
67/67 pruebas Hosts/GPON/roles/panel/señal/render, 14/14 del contrato y tsc
backend PASS. La lectura real no se repitió para probar el guard más restrictivo.

Fuente candidata: **ac511d7c70c8a11700d3553f331af5bb2930926a** (e2c7bf7 + guard).
Scope explícito frontend y backend en deploy/consolidation-release-scope.json;
snapshot release-source.json de ese mismo commit, 305 fuentes.

`prepare` PASS: rollbackTested=true, servicesChanged=false, contra imágenes
reales activas. Respaldos:
`/opt/smartrayco-staging/frontend-consolidado-tr069-ac511d7-23790cba4f/`
(`backend-before.image.tar`, `frontend-before.image.tar`). Restauración aislada
verificada contra fuentes backend y árbol completo frontend. No se ejecutó
rollback en producción porque no se llegó a desplegar.

`build` **FAIL: NORMALIZED_ASSET_NAME_COLLISION**, al comparar el grafo de assets
normalizado. No se ignoró ni se modificó ese control. No se investigaron o
fusionaron módulos ajenos para intentar hacerlo pasar. No hay build final
válido/reproducible de esta release, ni deploy, ni verify posterior.
No se dispone todavía de los nombres concretos de los assets en colisión;
eso requiere un diagnóstico puntual del staging en una continuación autorizada.

Resultados de fases guardados localmente en
`scripts/inventory-auth-lab/runtime/consolidation-release/frontend-consolidado-tr069-ac511d7-23790cba4f/`.
Los respaldos de este intento vuelven a backend d6ce2c2 y frontend 5d48a10,
no a versiones anteriores. La función sigue sin publicar ni habilitar.

## Cierre y riesgos pendientes

La comprobación de cierre por SSH no se completó (`CONTROLLED_TEST_FAILED_NO_RETRY`);
no se reintentó ni se dispone de una causa más específica. No afirmar que
la salud/cola actuales se verificaron en ese cierre: las últimas verificaciones
satisfactorias son las del ensayo de las 23:07 UTC, salud OK y cola/faults vacíos.
Ninguna operación de este intento recreó servicios ni cambió imágenes activas.

Pendiente: resolver la colisión sin debilitar integridad; volver a comprobar
conectividad/health/cola en una continuación; retomar fases por separado solo
con indicación del propietario. **No repetir la lectura activa ya realizada**.
RSSI/unidades y banda aún sin verificación suficiente. No se midió tráfico de
navegación o uptime PPPoE; no hubo cambios de esas configuraciones.
Archivos ajenos pendientes conservados; sin push, merges ni migraciones.
