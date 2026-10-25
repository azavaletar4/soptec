# Implementación controlada: parada por garantía de ejecutor físico

Resultado: **FAIL del requisito de ejecutor físico único entre instancias. Implementación detenida antes de cambios funcionales**, conforme a la condición del encargo. Base funcional `38cec66`, HEAD previo `1bec602` y diseños locales de baja/reactivación.

## Evidencia focalizada

Se añadió `server/tests/clientRetirement.executorBoundary.test.mjs`. Transpila sólo `server/src/services/oltTelnetLock.ts` y lo carga en dos procesos Node independientes. Cada uno solicita la misma OLT sintética. Se retiene la primera sección crítica y se comprueba que la segunda entra antes de liberarla. No carga rutas, servidor principal, Telnet, MikroTik, credenciales ni Supabase.

Comando ejecutado:

```text
node --test server/tests/clientRetirement.executorBoundary.test.mjs
```

Resultado del runner: **1/1 PASS del reproducer**. Resultado del requisito: **FAIL**, porque confirma dos secciones críticas simultáneas sobre la misma OLT. No es una prueba de una corrección ni una simulación que certifique seguridad.

## Por qué no basta limitar la coordinación a deuda

- `debtHoldService.ts` usa el mutex local, pero también `oltSyncService.ts` y las rutas OLT lo usan.
- `index.ts` arranca `startOltSyncScheduler`. El scheduler admite `OLT_SYNC_SCHEDULER_ENABLED=false`, pero ese ajuste sólo desactiva su ciclo: no impide que la instancia ejecute rutas manuales de OLT.
- `routes/olt.ts` entrega `withOltLock` y `runTelnetCommands` como dependencias al aprovisionamiento (`createOltProvisioningRoutes`). Cambiar la semántica de esa frontera compartida afecta también ese camino protegido; no sería un cambio exclusivo de deuda.
- Los archivos PM2 describen un proceso por configuración, pero no imponen exclusividad entre máquinas, configuraciones, scripts u otros procesos. No se consultó producción ni se asumió que esos archivos prueban la topología real.

El registro persistente por titular del diseño resolvería baja frente a deuda, pero por sí solo no impediría que otra instancia iniciase sincronización o aprovisionamiento sobre esa OLT. Poner un lock por dispositivo sólo en deuda tampoco lo impide. Declarar el resto protegido a partir de fixtures que lo omiten sería una garantía falsa.

## Límite de la autorización y cambio necesario

El diseño aprobado prescribe un único ejecutor físico y exige detenerse si asegurar esa exclusividad requiere intervenir caminos protegidos o módulos adicionales. El encargo mantiene «No tocar Janet–Estiven ni archivos ajenos» y ordena detenerse si alguna protección no puede garantizarse.

La solución sigue siendo técnicamente posible, pero necesita resolver una de estas fronteras antes de continuar:

1. **Ejecutor físico único verificable:** aislamiento efectivo del acceso a dispositivos y enrutamiento de todas las entradas físicas al proceso designado; instancias secundarias sin acceso físico, sin schedulers y sin fallback. Validar también ausencia de ejecutores antiguos. No basta un flag voluntario. Esto exige revisión operativa específica y no puede certificarse sólo con el laboratorio de deuda ni modificando producción bajo este encargo.
2. **Protección común en transporte:** guardas de propietario/exclusividad por OLT que cubran todas las llamadas incompatibles, antes del efecto, incluida sincronización y aprovisionamiento. Requiere revisar las consecuencias en la frontera compartida que sirve al trabajo protegido. No se implementa ni se cambia ese comportamiento sin autorización específica. Un TTL que permita sustituir un proceso pausado no constituye una solución segura.

Una vez cerrada esa frontera, continuar localmente con tabla/RPC de operaciones por titular, selector ONT contractual, contexto manual/pago, finalización atómica y recuperación sin reintentos, siguiendo los documentos de diseño. No hacen falta brokers ni un rediseño general, pero tampoco se puede omitir el control que falta.

## Estado de requisitos y pruebas

| Requisito | Estado de esta entrega |
| --- | --- |
| Ejecutor físico único entre instancias | **FAIL**, límite reproducido con el mutex real |
| Exclusión persistente por titular y carrera baja/reactivación | No implementada: parada previa; los fallos anteriores no se dan por resueltos |
| Selección ONT exacta y rechazo de ambigüedad | No implementada; sigue pendiente |
| Baja administrativa sin ONT | Diseño conservado; no se modifica la propuesta anterior |
| Pagos independientes | Sin cambios en facturación; no se certifica una corrección nueva |
| Interrupciones, recuperación y no repetición física | Diseño pendiente de implementación/pruebas; no se declara PASS |
| Solo IPTV y actividades no conflictivas | Sin cambios funcionales; no se afirma cobertura adicional |
| Nuevas pruebas de recuperación, permisos, idempotencia y fallos intermedios del coordinador | No ejecutables todavía porque el candidato se detuvo antes de implementarse |

No se repiten auditorías ni suites anteriores para presentar sus resultados como validación del coordinador nuevo. La prueba nueva es deliberadamente un diagnóstico de frontera entre procesos, no un mock de dispositivos que haga parecer seguro el sistema.

## Archivos, commit, rollback y activación

Únicamente se añaden este informe y `server/tests/clientRetirement.executorBoundary.test.mjs`. Commit local de diagnóstico, con hash informado al entregar. No se incluyen los diseños anteriores aún sin commit ni otros trabajos locales. Sin migraciones candidatas nuevas, modificaciones funcionales, datos reales, comandos físicos, push ni despliegue. Janet–Estiven permanece intacto.

Rollback de esta entrega: retirar únicamente el test y este informe si se desea; no hay objetos SQL, configuración ni datos que revertir. No activar `38cec66` como si este diagnóstico lo hubiera corregido.

Procedimiento previo a activación: resolver y revisar la frontera de ejecutor; implementar el candidato local completo; aprobar las pruebas multiproceso y de recuperación del diseño; preparar SQL y rollback revisables; drenar ejecutores antiguos y asegurar aislamiento en una fase operativa autorizada; aplicar y desplegar sólo tras aprobación separada. La activación continúa bloqueada y esta entrega no autoriza ninguno de esos pasos productivos.
