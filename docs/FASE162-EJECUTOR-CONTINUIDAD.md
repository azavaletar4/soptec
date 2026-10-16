# Fase 162 — continuidad autónoma del ejecutor

Estado: **PREPARADO LOCALMENTE; PENDIENTE DE VENTANA AUTORIZADA**.

Se continúa desde `2d330cf`. No se repitieron las 31 pruebas Unicode, los 17 prechecks Cloud ni las pruebas funcionales y de concurrencia aprobadas. No se abrió conexión a Cloud en esta intervención.

## Corrección focalizada

El ejecutor preparado evaluaba únicamente el exit code de psql. La evidencia anterior ya demostraba que `\quit 9` puede devolver 0 pese a denegar el precheck. También faltaba exigir el resultado de los postchecks y la igualdad de snapshots.

Se añadió `scripts/fase162-executor-result.ps1`, conectado al ejecutor local existente y al generador versionado `scripts/prepare-fase162-authorized-install.cjs`. Solo declara éxito con exit code 0, marcadores únicos y ordenados de gate/baseline/COMMIT/postchecks/snapshot final, ambos snapshots READ ONLY idénticos y todos los postchecks OK, incluido su resultado final. Una respuesta perdida o incompleta no se considera éxito y requiere inspección de lectura. Si el COMMIT está confirmado, cualquier fallo posterior conserva ese hecho: no se comunica un rollback que no ocurrió. Evidencia contradictoria también bloquea. Nunca hay reintento automático.

No se cambió el SQL de instalación ni ninguna migración. Se conserva la corrección UTF-8 de `2d330cf`. El generador verifica el hash del paquete aprobado, se detiene si no queda margen de 180 s en la ventana y conserva la negativa del ejecutor ante un intento previo. No crea autorización ni borra registros anteriores. El generador reutiliza los artefactos privados existentes de runtime; no constituye por sí solo autorización ni un instalador autónomo para otra máquina.

## Pruebas nuevas

**11/11**: evidencia completa, precheck denegado con exit 0, salida vacía con exit 0, error SQL, respuesta de COMMIT perdida, postcheck final fallido, postcheck individual fallido, snapshot distinto, marcadores duplicados, marcadores ausentes/desordenados y evidencia contradictoria.

Comando: `powershell -NoProfile -File scripts/tests/fase162-executor-result.test.ps1`.

También se verificaron la sintaxis Node del generador y la sintaxis PowerShell del ejecutor local. Una invocación del generador contra la ventana anterior terminó con `VENTANA_INSUFICIENTE` antes de generar archivos o abrir conexiones. No se invocó el ejecutor de instalación.

## Archivos

- `scripts/fase162-executor-result.ps1`
- `scripts/tests/fase162-executor-result.test.ps1`
- `scripts/prepare-fase162-authorized-install.cjs`
- Este documento.

Se actualizó además la copia preparada `scripts/inventory-auth-lab/runtime/fase162-authorized-install.ps1`, ignorada por Git, para cargar la validación. El generador incluido permite reproducir esa integración en una ventana nueva. Los cambios locales anteriores de otros componentes no se incluyen.

## Pendiente operativo

La ventana 20:41:46–20:51:46 UTC del 16/10/2026 está vencida. No existe autorización vigente para otra. Hace falta confirmar y autorizar una nueva pausa operativa de hasta 10 minutos; las rutinas autorizadas permiten después reconfirmar respaldo/integridad, hashes individuales, paquete, prechecks y ausencia de actividad inmediatamente antes de ejecutar. Si algo difiere o falla, detenerse sin reintento automático.

Se mantienen exclusivamente las dos migraciones revisadas y sus límites preparados 2/60/120 s en una sola transacción. No se renovó respaldo ni se repitieron prechecks prematuramente: su vigencia operativa debe comprobarse al iniciar la nueva ventana, no certificarse por esta intervención local.

Sin cambios Cloud, datos reales, RLS, migraciones aplicadas, push ni despliegue.
