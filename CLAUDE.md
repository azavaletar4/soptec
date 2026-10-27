# SmartRayco — guía para Claude Code

## Antes de empezar

**Base vigente — frontend consolidado y WiFi desplegados (27/10, 17:08 Perú).**
Usar `integration/frontend-productivo-tr069-20261027`, worktree
`scripts/inventory-auth-lab/runtime/frontend-productivo-tr069-worktree`.
Código publicado: **`288f2d8ac3c4ed0d2279b9a01618885bcfb02b9f`**. No compilar un
checkout raíz/VM atrasado: el estado real está en `/release-manifest.json` del panel.
Integrados Asistencia A0–A3/pestañas, Puntos noviembre, Campo dirección/GPS,
inventario ACS actual/histórico y WiFi posterior. 93 unitarias (incluidas las 42
TR-069), navegadores focalizados, doble build reproducible y rollback aislado PASS.
Frontend `smartrayco-frontend-consolidado:288f2d8ac3c4`, backend selectivo
`smartrayco-backend-wifitrial:288f2d8ac3c4`; otros servicios intactos. «Configurar»
habilita solo WLAN 5.SSID de HWTC1D3691B7/CTR-2026-00214 para ADMIN/SUPERADMIN,
con respaldo/confirmación/verificación/restauración. **Prueba manual real pendiente;
Codex envió cero tareas.** Se preservó la configuración efectiva de custodia nula,
sin activar la fecha de Compose que no estaba compilada. Main remoto `88dec40`
conservado; la rama integra sus 4 commits pendientes sin forzar historial.
Continuidad técnica/futuros builds: `docs/FRONTEND-CONSOLIDACION-CONTINUIDAD-20261027.md`.
Este estado prevalece sobre la parada anterior, conservada abajo como antecedente.
Git: rama de integración publicada con push normal; main local alineado por
fast-forward, 21 archivos pendientes previos respaldados/conservados. Main remoto
sigue `88dec40`; incorporarlo por PR revisada, sin force ni nuevos merges amplios.

Lee primero `ESTADO_DESARROLLO.md` (raíz del repo) — tiene el estado real
(implementado/desplegado/pendiente), la arquitectura, el último commit
desplegado y los riesgos/trabajos pendientes conocidos. Evita repetir
análisis ya hecho. Mantenlo actualizado al final de cada sesión relevante
(qué cambió, qué quedó pendiente, próximo paso recomendado) — es la
referencia compartida entre Claude Code y ChatGPT para este proyecto.

Después consulta `docs/REGISTRO-VERSIONES-PRODUCTIVAS.md` para las versiones
reales por servicio y `docs/FASE175-CONTADORES-ACTIVADOS-20261026.md` para la
evidencia de Fase 175. **Fase 175 está desplegada y operativa:** backend
`16831c6`, muestreo automático recuperado con 360 registros nuevos del
Administrador. El HTTP 400 por URL excesiva está corregido con lotes de 100;
los errores y rollbacks anteriores son antecedentes, no incidentes activos.
Seguimiento de ciclos y certificación integral de 3.000 clientes siguen
pendientes, pero no invalidan la recuperación real ya confirmada.

## TR-069 Huawei (HWTC1D3691B7) — gestión independiente operativa, corrección de identificación DESPLEGADA (27/10/2026)

**Último resultado WiFi — prevalece (continuación con Claude Code, 27/10/2026):**
la primera prueba manual real del propietario quedó bloqueada con
«La identidad, instancia o SSID actual cambió; vuelve a consultar». Causa
encontrada y corregida en candidato local: GenieACS refresca `_timestamp` en
cada Inform que reporta el parámetro (incluido el periódico de 300s ya
confirmado real en esta ONT) aunque el valor no cambie; exigir que ese
timestamp coincidiera byte a byte con el que vio el panel bloqueaba casi
cualquier envío real con solo el paso normal del tiempo. Se quitó esa
comparación en `server/src/services/tr069WifiTrial.ts`; la comparación real
de seguridad —el SSID vigente contra el esperado— sigue intacta y se
revalida en vivo justo antes de escribir. También se simplificó el
formulario (estilo SmartOLT): seleccionar red, nuevo nombre, nueva
contraseña (opcional, **bloqueada** hasta validar compatibilidad real — el
backend tampoco acepta ese campo) y «Aplicar cambios»; rutas TR-069,
deviceId, serial largo y mensajes con jerga se movieron a "Detalles
técnicos" (plegado), nunca se eliminaron. 6/6 + 19/19 + 3/3 pruebas
focalizadas PASS, 272/272 y 480/480 de las suites completas de servidor/lib
sin regresión, TypeScript limpio. **Candidato local únicamente: sin push, sin
despliegue, cero tareas enviadas a GenieACS durante la corrección.** Detalle
completo: `ESTADO_DESARROLLO.md` (sección al inicio del archivo).

**Resultado WiFi anterior (27/10, 16:26 Perú):** el propietario
autorizó implementar/desplegar, reservando el cambio SSID para su clic manual.
Candidato de escritura/restauración de solo WLAN 5.SSID implementado local,
42/42 pruebas y TypeScript PASS; 6 capturas con stores ficticios. **Despliegue
DETENIDO, botón real NO disponible:** la base frontend reconstruida no reproduce
el HTML activo (`BASELINE_FRONTEND_NOT_REPRODUCIBLE`). No forzar promoción ni
mezclar fases. Imágenes/configuración respaldadas; 5 contenedores verificados
sin cambios y `deployAttempted=false`. Cero tareas reales enviadas por Codex.
No reabrir diagnóstico de conexión. Detalle, rollback y siguiente paso:
`docs/TR069-WIFI-DESPLIEGUE-DETENIDO-20261027.md`.

**Comunicación TR-069 real CONFIRMADA.** La interfaz de gestión OMCI
independiente (VLAN 200, IP `10.15.15.200`, patrón tomado de 6 Huawei
GPT-2741GNAC reales ya configuradas en la OLT) quedó aplicada y
operativa en la ONT de prueba `HWTC1D3691B7` (1/2/2:24): GenieACS recibió
**3 Informs reales**. Internet (VLAN 120) y PPPoE del cliente se
conservaron durante toda la prueba — hubo un incidente de navegación
reportado por el propietario que se recuperó al reconectar el cable de
red del equipo de prueba; no se atribuye causa definitiva a TR-069 (ni
la sesión PPPoE ni los Informs mostraron ninguna interrupción durante la
ventana del incidente).

**Hallazgo e identificación:** GenieACS reporta el serial de esta Huawei
como `485754431D3691B7` (16 hex, vendor ID también hex-codificado),
mientras la OLT usa `HWTC1D3691B7` (ASCII + hex) — es el mismo serial
GPON de 8 bytes (ITU-T G.984.3), otra representación. La comparación
literal que ya existía nunca encontraba la coincidencia. **Corregido en
local, commit `5104253`**: nuevo `src/lib/gponSerial.ts`
(`normalizeGponSerial`/`matchTr069Device`, comparación exacta completa,
nunca parcial; inválido/ambiguo nunca vincula solo), aplicado a los 2
consumidores reales (`GET .../tr069/status` y `GET /onts/status` en
`server/src/routes/olt.ts`). 26 pruebas nuevas + 452 frontend + 247
backend, todas en verde; verificado con datos reales de Supabase
(solo lectura) que el panel ya derivaría "Conectado" en vez de
"Esperando conexión" con esta corrección.

**Estado preciso: corrección de identificación DESPLEGADA en
producción** (2026-10-27 ~20:18 UTC, autorización expresa). Backend
`smartrayco-backend-tr069fix:5104253-20261027T201808Z` (sobre
`...tr069enable:516faba-...`, solo `olt.ts`/`gponVendorId.ts`/
`gponSerial.ts` nuevo); frontend sin cambios (el commit no lo requiere).
Verificado con el código REAL desplegado y datos reales de Supabase:
`matchTr069Device` ya resuelve `HWTC1D3691B7` ↔ `485754431D3691B7`.
Rollback preparado, no usado (imagen anterior respaldada con SHA256).
Publicado en GitHub en rama propia (no `main`, ver nota de
sincronización en el doc consolidado) y en
`diagnostico/tr069-genieacs-readonly` (commits `7105679`/`8968e69`, ya
en producción). Commits en `main`: `516faba` (botón guiado), `5a1cfc0`
(gestión independiente OMCI), `f61f771` (sintaxis de reversión más
segura), `877bec6` (preparación final), `94d447e` (incidente y
recuperación), `5104253` (corrección de identificación de serial),
`83f06b4` (sincronización de continuidad).

**Confirmación visual completada por el propietario**, comunicada al retomar
desde Claude: `HWTC1D3691B7` muestra «TR-069: Conectado», el botón
«Administrar TR-069» está habilitado y GenieACS muestra el equipo en línea.
Esta evidencia no implica que se haya probado modificar WiFi.
**Pendiente**: autorizar una prueba controlada aparte de cambio de WiFi desde
SmartRayco sobre esta ONT, acordar el cambio y su reversión, y comprobar su
aplicación real y la continuidad de internet/PPPoE. No intentada todavía.
La retoma de confirmación visual (`1ae1603`) fue solo documental.
**Diagnóstico posterior de administración, solo lectura (27/10):** GET de caché
GenieACS confirma raíz `InternetGatewayDevice`, SSID/KeyPassphrase en WLAN 1 y
5; `_writable=true` no acredita escritura probada. Enable, banda y seguridad
sin valores; WANPPPConnection anunciado sin instancia/usuario legible. La lectura
WiFi actual exige Enable=true y oculta estas redes. Antes de probar: identidad
normalizada en administración, path validado, contrato exacto, solo ADMIN/SUPERADMIN
(incluido proxy) y operación WiFi separada de PPPoE. «Administrar TR-069» aún abre
asignación de ACS en OLT. Sin cambios productivos ni tareas de GenieACS.
Detalle y preparación reversible: `docs/TR069-ADMINISTRACION-HUAWEI-SOLO-LECTURA-20261027.md`.
**Preparación WiFi posterior implementada SOLO LOCAL:** formulario reutilizado
para un SSID, serial normalizado único, Enable desconocido visible, preparación
solo ADMIN/SUPERADMIN y Huawei HWTC1D3691B7/deviceId exacto. Respaldo descargable
del SSID y comparación GET de caché; sin contraseñas ni PPPoE. Escrituras WiFi,
PPPoE, provisionado combinado y proxy NBI bloqueados en este candidato. No está
desplegado, no escribió nada y aún no tiene vía habilitada de aplicar/revertir.
Prueba física requiere autorización independiente y contrato exacto verificado.
Procedimiento: `docs/TR069-WIFI-PREPARACION-SEGURA-20261027.md`.
**Validación visual local posterior completada:** Chrome con stores ficticios,
9 capturas etiquetadas como simulación, escritorio/móvil, respaldo descargado,
confirmación cancelable y mensajes pendiente/error. Banda explícita o «Banda
desconocida» por red; no inferir 5 GHz por SSID. Comparación exige nuevo Inform
y fecha nueva de SSID; Inform solo no confirma. 37/37 pruebas y TypeScript PASS.
Sin tareas, producción ni habilitación de escritura. Evidencia/procedimiento:
`docs/TR069-WIFI-VALIDACION-VISUAL-20261027.md`.
**Preflight puntual real posterior (27/10 16:05 Perú, solo GET):** serial único
confirmado, ONT→cliente prueba zava→contrato activo CTR-2026-00214 concordantes;
registro TR-069 único pero service_contract_id sigue null. Cero tareas pendientes.
SSID RAYCO 18 (WLAN 1) y WirelessNet-5G (WLAN 5), ambos banda/Enable desconocidos,
writable anunciado true; valores de 15:37 Perú, no renovados por el Inform 16:02.
Propuesta no autorizada: WLAN 5.SSID → WirelessNet-5G-PRUEBA. **Todavía no lista:**
confirmar selección/SSID efectivo, tratamiento del vínculo nulo sin cambiarlo y
vía de ejecución/reversión aún bloqueada. Plan, respaldo y autorización puntual:
`docs/TR069-WIFI-PRIMERA-PRUEBA-PREFLIGHT-20261027.md`. Sin cambios productivos.
Detalle completo y consolidado:
[TR069-CONTINUIDAD-HUAWEI-20261028.md](docs/TR069-CONTINUIDAD-HUAWEI-20261028.md).
Equipos seriados, custodia, devoluciones, Asistencia y Puntos permanecen
cerrados tal como están documentados abajo — esta sección no los reabre.

## Devoluciones de App de Campo — estado vigente (26/10/2026)

Acceso implementado y desplegado en `/campo/mi-custodia`: «Solicitar devolución»
para materiales y equipos bajo custodia. El artefacto anterior conservaba una
vista de solo consulta; se incorporó selectivamente el código ya aprobado
`fb56057`, con publicación `c11f6a8`. Frontend `smartrayco-campo-returns:c11f6a8-20261026T171151Z`;
backend `16831c6` conservado sin reinicio. Sin SQL ni permisos nuevos.
Pruebas de navegador del candidato/publicado con datos ficticios PASS;
25/25 SQL/unitarias previas conservadas. **Devoluciones de materiales y
equipos seriados implementadas, desplegadas y validadas funcionalmente**.
El propietario confirmó expresamente el **26/10/2026** que probó
satisfactoriamente la devolución desde App de Campo en Android y su recepción
administrativa. **Ambas pruebas COMPLETADAS; flujo probado y cerrado.**
No volver a registrarlas como pendientes ni repetir pruebas anteriores.
Frontend `c11f6a8`, backend `16831c6` sin cambios; antecedentes publicados:
`c11f6a8` y documentación `6a8dadd`. Este cierre prevalece sobre las notas
de aceptación pendiente de informes anteriores, conservadas como antecedentes.
Sin pruebas nuevas ni operaciones productivas en esta actualización.
Detalle/rollback: `docs/CUSTODIA-DEVOLUCIONES-CORRECCION-LOCAL.md`;
versiones exactas en `docs/REGISTRO-VERSIONES-PRODUCTIVAS.md`.

## Equipos seriados, custodia e instalación — fase cerrada operativamente

El propietario confirma que el **25/10/2026** se realizaron **tres instalaciones
reales exitosas** con instalación de equipos desde App de Campo. El circuito
está implementado y desplegado: **entrega al técnico → custodia → instalación
y devolución**, operativo y **sin defectos reportados**. Devolución y recepción
administrativa ya fueron validadas y cerradas por el propietario el 26/10/2026.
No volver a tratar esta fase como desarrollo pendiente ni exigir repetir las
pruebas anteriores para reconocer su cierre operativo.

Alcance de la evidencia: es la confirmación expresa del propietario sobre las
tres instalaciones. No acredita por separado cada categoría ONT, Mesh y TV Box,
ni verificaciones individuales de serie/MAC, contrato o movimientos de custodia.
No inventar esos detalles ni confundir cierre operativo con certificación
individual por categoría. Versiones productivas documentadas conservadas:
frontend `c11f6a8`, backend `16831c6`. La meta permanente de estabilidad y
rendimiento para al menos **3.000 clientes** se mantiene como requisito
transversal; no reabre esta fase operativa.

Esta actualización es solo documental: sin pruebas, auditorías, código,
consultas productivas, migraciones ni cambios de inventario/contratos.

## Capacidad mínima (requisito permanente)

SmartRayco debe soportar al menos **3.000 clientes** con estabilidad y
rendimiento. Distinguir pruebas simuladas de escalabilidad y certificación
integral con carga real; no declarar una como sustituto de la otra.

## Contexto

SmartRayco está en fase de pruebas operativas reales (octubre 2026). Técnicos y
administradores lo usan en campo. Clientes, servicios y datos son reales —
protegerlos siempre (ver regla 13).

## Usabilidad para personal administrativo (regla permanente)

SmartRayco lo usa a diario personal administrativo **sin conocimientos
técnicos de redes** — toda interfaz debe ser intuitiva, clara y
comprensible para ese usuario, no solo correcta para quien conoce el
dominio técnico. Aplica a corrección y desarrollo en **Clientes,
Contratos, OLT, Soporte, Rutinas, Altas, Inventario, Facturación y App
Campo** — no solo al módulo en que se trabaje puntualmente.

Requisitos obligatorios:

1. Mostrar nombre del cliente, código y contrato cuando estén
   vinculados y **verificados** — nunca inferidos por nombre,
   descripción o posición física (ver regla 6 de la migración OLT).
2. Mostrar fecha y hora **real** del evento (nunca la hora de
   renderizado) en horario de Perú (`America/Lima`, sin asumir la zona
   horaria del dispositivo de quien mira la pantalla).
3. Ofrecer acceso directo a la ficha del cliente o del servicio/contrato
   correspondiente — no obligar a buscarlo aparte.
4. Mensajes de error y alertas en lenguaje sencillo: qué ocurrió y qué
   debe hacer el usuario — no un mensaje técnico crudo (código, log,
   jerga de red) como única explicación.
5. Los datos técnicos (serial, slot/puerto, señal, mensajes crudos)
   siguen disponibles, pero como información **secundaria** — nunca lo
   primero que se lee.
6. No obligar al personal a buscar manualmente un dato que el sistema
   ya tiene y puede resolver solo (mismo cliente, mismo contrato, misma
   zona ya cargados en otra parte del mismo panel).
7. Sin vínculo verificable, mostrar **"Pendiente de vincular"** — nunca
   inventar ni asumir un dato para rellenar el hueco.
8. Respetar siempre los 3 roles operativos reales (regla 9 de la
   migración OLT: SUPERADMIN, ADMIN, TECNICO_RED).

Precedente ya implementado siguiendo esta regla (referencia de patrón,
no repetir su investigación): Fase B de discrepancias PON↔zona↔contrato
(`src/lib/ontZoneDiscrepancy.ts`, `OntZoneDiscrepancyModal.vue`), las
alertas operativas de OLT (`src/lib/oltAlertPresentation.ts`,
`ESTADO_DESARROLLO.md` 13as) y su historial (`GET /:id/alert-log`,
sección "Historial de alertas" dentro de la misma tarjeta en
`OltDetailView.vue`, 13at/13au — tabla `olt_alert_log` ya **aplicada y
desplegada en producción**, migración `20261014150451`) — mismo
criterio de vínculo verificable (en el historial, un *snapshot* al
momento del evento, nunca el vínculo de hoy), hora real en horario de
Perú con la distinción explícita entre "hora de detección" y hora real
del evento, acceso directo a la ficha, datos técnicos como secundarios.

Fase 5 (`src/lib/oltConnectionStatus.ts`, pestañas "Estado
actual"/"Historial de alertas" en la misma tarjeta de
`OltDetailView.vue`, `ESTADO_DESARROLLO.md` 13aw, DESPLEGADA) es el
ejemplo más reciente de esta regla aplicada **sin ningún backend
nuevo**: todos los conteos/listas/avisos se derivan de datos ya
cargados en el panel (`oltStore.onts`, `summary`, el propio
`GET /:id/alert-log`) — útil como referencia de que mejorar la
visualización para personal administrativo no siempre requiere
tabla/endpoint/servicio nuevo, solo agregación pura y bien probada
sobre lo que ya existe.

**Admin-disabled ≠ desconectado, y admin-disabled ≠ deuda (13ax, ver
`ESTADO_DESARROLLO.md`)**: una ONU con `admin_state='disable'` (mismo
dato que SmartOLT reporta como "admin-disabled mode") NUNCA debe
contarse ni mostrarse como "sin conexión" — `admin_state` manda
SIEMPRE sobre `status`, incluso si `status` quedó en `'online'` de
antes de suspenderse. Caso real confirmado (Danner Ávalos Ventura,
CTR-2026-00356): admin-disabled con `debt_hold_status='none'` en su
contrato — pese a que el operador afirmaba que era "por deuda", el
propio sistema no lo corrobora. Por eso el motivo "por deuda/mora"
**solo** se muestra si hay evidencia confiable
(`service_contracts.debt_hold_status='suspended'`, ya cruzado por
`GET /:id/onts/disabled`/`suspensionReasonLabel` en
`oltConnectionStatus.ts`) — nunca inferido del admin-state solo.

**El cruce de mora es SIEMPRE por `contract_id` exacto, nunca por
`client_id` (13ay)**: un cliente con 2+ contratos, donde solo uno está
en mora, no debe "contagiar" ese motivo a sus demás servicios al día.
Ver `server/src/services/oltDisabledReason.ts`
(`resolveDisabledReason`, puro) — si se vuelve a tocar
`GET /:id/onts/disabled`, mantener el cruce por `contract_id`, no
retroceder a `client_id`.

## Modo de desarrollo y validación eficiente

Objetivo: detectar, corregir y validar problemas sin auditorías completas en
cada modificación — reducir trabajo/tokens redundantes, no bajar el estándar
de calidad.

1. Antes de modificar código, identifica únicamente el módulo y los archivos
   relacionados (usa Grep/Glob dirigido, no una exploración amplia).
2. No leas todo el repositorio si el problema está localizado.
3. No repitas análisis que ya estén documentados — revisa primero
   `docs/ERRORES-CAMPO.md` y la memoria de proyecto.
4. Usa primero las pruebas automatizadas existentes (`npm pkg get scripts`
   para ver las disponibles: `test:telnet`, `test:provisioning`,
   `test:fetch-timeout`, `test:nap-sql`, `test:single-active-job-sql`, etc.)
   antes de escribir pruebas nuevas desde cero.
5. Al corregir un error funcional, crea una prueba de regresión pequeña y
   reutilizable — para RPCs/triggers de Supabase, sigue el patrón de
   `server/tests/*.sql.test.ts` (Postgres real en Docker, aislado, con el
   archivo de migración real cargado tal cual).
6. Usa mocks y datos sintéticos para pruebas que puedan modificar
   información real. Nunca ejecutes escrituras de prueba contra Supabase de
   producción, la OLT real ni MikroTik real.
7. Evita generar documentación HTML o informes extensos para correcciones
   menores — un resumen de texto alcanza.
8. No repitas compilaciones (`vue-tsc`, `tsc`, `npm run build`) si los
   archivos relevantes no cambiaron desde la última corrida.
9. No ejecutes suites completas salvo que el alcance o el riesgo lo
   justifique — corre primero solo el/los scripts de prueba del módulo
   tocado.
10. Resume resultados en un máximo de 10 líneas, salvo errores importantes.
11. No muestres logs completos si basta con indicar el resultado y las
    líneas relevantes del error.
12. No hagas preguntas cuando el problema se pueda resolver con la
    arquitectura existente — pregunta solo ante una decisión que de verdad
    requiera al usuario (dato ambiguo, cambio que afecte datos/equipos
    reales, alcance fuera de lo pedido).
13. Datos reales protegidos siempre: nunca un `UPDATE`/`DELETE` de prueba
    contra Supabase de producción, la OLT real (10.15.15.2) ni MikroTik
    real. Confirmar el destino antes de cualquier escritura en vivo.
14. Revisar primero si una funcionalidad ya existe (y cómo) antes de
    implementarla — buscar en el código, no asumir desde memoria ni desde
    un prompt anterior. No duplicar funciones/componentes ya existentes.
15. Comentarios/commits en español, consistente con el resto del proyecto.
    Commit solo después de pasar las pruebas correspondientes al cambio.
16. **Nunca aplicar una migración en Supabase de producción ni ejecutar
    `bash deploy/update.sh` en la VM sin que el usuario lo pida
    explícitamente en ese mismo turno** — "implementa esto" o "corrige
    esto" NO es autorización para migrar/desplegar; esperar un pedido
    explícito tipo "aplica la migración y despliega". Esto aplica incluso
    si ya se desplegó algo similar antes en la misma sesión.

## Validación por niveles

- **Nivel 1** (cambio cosmético/UI acotado): prueba localizada + comprobación
  visual.
- **Nivel 2** (cambio funcional de un módulo): pruebas del módulo + validación
  backend + comprobación en campo (pedir al usuario que lo pruebe si aplica).
- **Nivel 3** (cambio estructural/BD/multi-módulo): pruebas de integración +
  respaldo + revisión de riesgos + reversión preparada antes de aplicar.

Elige el nivel según el riesgo real del cambio, no automáticamente el más alto.

## Migración OLT — vínculo cliente/contrato/ONT (permanente)

SmartRayco está migrando gradualmente la administración desde SmartOLT y
registros anteriores — faltan ~400 abonados por registrar (2026-10-13).
Mientras dure esa migración, **toda sesión debe consultar esto antes de
tocar flujos de OLT, clientes o aprovisionamiento** — ver el caso real
documentado en `ESTADO_DESARROLLO.md` (Violeta García Silva / Clara
Caballero Valderrama / Mayco Paredes Rodríguez) para el precedente
completo.

**Tres situaciones posibles, permanentes mientras dure la migración:**

- **A — ONT online sin cliente/contrato en SmartRayco**: el abonado puede
  ser real y estar navegando normalmente; su info administrativa
  simplemente no se migró todavía. **Nunca asumir** que es una ONT
  abandonada, duplicada o disponible para eliminar.
- **B — Cliente y contrato registrados, pero sin ONT vinculada**: el
  abonado existe en SmartRayco, falta relacionar su ONT física. No
  implica necesariamente que esté sin servicio — verificar serial,
  posición, contrato y PPPoE antes de vincular.
- **C — Cliente, contrato y ONT correctamente vinculados**: igual hay que
  distinguir el estado real de la OLT del último `last_synced_at` de
  SmartRayco — no son lo mismo.

**Reglas permanentes:**

1. La OLT real es la referencia para serial, posición y estado físico
   — siempre que la consulta sea actual y verificable (no asumir desde
   una lectura vieja).
2. Supabase es la referencia para clientes, contratos y sus relaciones
   administrativas.
3. Nunca eliminar ni desautorizar una ONT solo porque aparece sin
   cliente vinculado (Situación A) — eliminar su fila en `olt_onts`
   también manda `no onu` a la OLT real y corta el servicio.
4. No duplicar clientes, contratos, usuarios PPPoE ni equipos durante
   la migración — buscar primero si ya existe (por nombre, documento,
   serial) antes de crear algo nuevo.
5. No reprovisionar una ONT que ya navega solo para completar
   información administrativa — vincular `client_id`/`contract_id` es
   una escritura de metadatos en Supabase, nunca requiere volver a
   autorizar/registrar en la OLT.
6. No sobrescribir nombres o descripciones administrativas sin
   comprobar su procedencia — un `description` puede venir de la OLT
   (texto libre, no confiable) o de una edición administrativa real.
   **Ya implementado**: "Importar ONTs desde la OLT" deja de pisar
   `description` en cuanto una ONT queda vinculada a un cliente **y el
   serial sigue siendo el mismo** — si el serial cambia en una posición
   ya vinculada (ONT reemplazada/trasladada), esa fila no se toca en
   absoluto y se reporta como conflicto para revisión manual, nunca se
   resuelve sola (ver `oltImportDescriptionGuard.ts` y 13ai/13aj en
   `ESTADO_DESARROLLO.md`) — si se toca ese import, mantener esa
   protección de 3 vías (sin vincular / vinculada mismo serial /
   conflicto), no volver a la versión que solo miraba la posición.
7. Mantener intactos los servicios existentes durante toda la
   migración — cualquier corrección se valida de solo lectura primero.
8. Si hay discrepancia entre lo que dice la OLT y lo que dice
   Supabase, **detener la operación y pedir verificación** — no
   adivinar cuál de las dos fuentes tiene razón.
9. Solo usamos 3 roles operativos reales: **SUPERADMIN, ADMIN y
   TECNICO_RED** — SOPORTE/FACTURACION no se usan; no desarrollar
   funcionalidades nuevas para ellos ni tocar sus políticas existentes.
10. **Ingresar un dato una sola vez, reutilizarlo en todos los módulos**
    — nunca pedir el mismo dato dos veces en formularios distintos si ya
    existe una fuente confiable (ver Fase 3 OLT, PON↔zona↔contrato↔App
    Campo, `ESTADO_DESARROLLO.md` 13ak-13am): `zones.name` codifica el
    número de PON oficial (`src/lib/ponZoneMapping.ts`); cada ONT se
    compara contra su cliente/contrato real por `contract_id`, nunca por
    nombre/posición (`src/lib/ontZoneDiscrepancy.ts`); al cerrar un
    traslado desde App Campo, la zona se deriva de la caja NAP que el
    técnico ya eligió en vez de pedírsela de nuevo, y la sincronización
    de NAP+zona de la ONT reutiliza SIEMPRE la transacción de Fase 158
    (`assign_contract_nap_sync_ont_zone`, ver `src/lib/ontZoneSync.ts`
    `canSyncOltZone`/`resolveClosureTargetZoneId`) — nunca una escritura
    paralela nueva. Ante una discrepancia entre fuentes, se informa (nunca
    se calla ni se adivina) y se deja para revisión humana — regla 8.

**"Traslado de servicio" en Rutinas (2026-10-13, ver `ESTADO_DESARROLLO.md`
13an-13ap)**: `routines.contract_id` (Fase 159) ya está aplicada en
Supabase producción — `routines` ahora identifica el contrato/servicio
EXACTO que se traslada (nunca por `client_id` solo). El selector de
contrato (`RutinasView.vue`), la sección de traslado en App Campo
(`CampoTrabajoDetailView.vue`) y el cierre vía Fase 158
(`campo.ts`/`ontZoneSync.ts`) están implementados y probados con pruebas
unitarias (`routineTraslado.ts`). El historial "anterior→nuevo" se
congela con el mismo mecanismo de borradores que `closureForm`
(`resolveTrasladoAnteriorSnapshot`) — **nunca recalcularlo desde
`activeContract` directo**, un reintento podría ya tener el contrato
mutado. **Todavía no se probó con un traslado real de punta a punta** ni
se desplegó — no declarar esta funcionalidad "terminada" ante el usuario
sin esa verificación real.

## Registro de errores de campo

Todo bug reportado desde campo (técnicos/administradores usando el sistema
real) se registra en `docs/ERRORES-CAMPO.md` — ver ese archivo por el
formato. Revisarlo antes de investigar un problema nuevo: puede que ya esté
documentado.
