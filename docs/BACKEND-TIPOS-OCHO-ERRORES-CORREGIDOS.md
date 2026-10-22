# Backend: corrección puntual de ocho errores de tipos

**PASS del mismo gate que bloqueó la activación; exit code 0.**
La corrección queda en un commit local separado sobre b201183; el candidato
Janet/Estiven permanece como delta local independiente. Sin push, despliegue,
migraciones, acceso productivo ni continuación automática de activación.

## Cambios funcionales limitados a cinco archivos

| Archivo | Errores corregidos | Cambio |
|---|---|---|
| server/src/mikrotik/client.ts | TS2741, TS2345 | Response de undici y opciones inferidas directamente por undiciFetch; elimina cast al RequestInit global |
| server/src/proxmox/client.ts | TS2741, TS2345 | Misma corrección de tipos reales de undici |
| server/src/routes/genieacs.ts | TS2769 | Buffer<ArrayBuffer>, acorde con Buffer.from(await request.arrayBuffer()) |
| server/src/services/oltProvisioningService.ts | Dos TS2322 | VerifyMismatch.field admite los dos valores existentes serviceGemport/serviceVlan |
| server/src/services/tr069Scheduler.ts | TS2339 | result.ok === true permite estrechar la unión discriminada con las opciones originales del gate |

No se modificaron solicitudes, bytes de cuerpos, cabeceras, comandos,
reintentos, intervalos ni reglas de negocio. Los resultados reales del
scheduler son booleanos true/false; la comparación explícita conserva ambas
ramas y permite tipar el acceso a error. No se añadieron supresiones, any,
exclusiones ni cambios de tsconfig/dependencias/opciones del gate.

## Verificaciones realizadas

Mismo comando, desde el worktree de integración:

```powershell
node ../node_modules/typescript/bin/tsc --noEmit --skipLibCheck --target ES2022 --module ESNext --moduleResolution Bundler --esModuleInterop server/src/index.ts
```

PASS, salida vacía y exit 0. Se certifica ese gate de entrada index.ts; no
se presenta como ejecución de otro comando o del proyecto tsconfig.server.

Pruebas nuevas: `server/tests/backendTypeCompatibility.test.cjs`, **36/36 PASS**.
Comparan el código real anterior de b201183 con el código corregido, usando
transportes, imports y relojes simulados. Red externa prohibida en el entorno
de las pruebas. Cubren MikroTik/Proxmox (solicitud, JSON/form, timeout, TLS,
reintentos, 4xx/5xx, error de conexión, JSON inválido y configuración ausente),
proxy GenieACS (métodos, bytes binarios, permisos, cabeceras y fallo upstream),
y TR069 (éxito/error/excepción, desactivación, tiempos configurados, exclusión
de solapamiento y liberación del guard).

La prueba también demuestra que MikroTik, Proxmox, GenieACS y
oltProvisioningService emiten JavaScript idéntico antes/después al borrar
tipos. El scheduler se valida diferencialmente con los resultados booleanos
de su contrato real, incluyendo las rutas de error y solapamiento.

Prueba pura existente verifyProvisionedOnt: **1/1 PASS**, comprueba
coincidencias y diferencias, incluidos los campos de servicio. No ejecuta
transportes. No se repitieron las suites SQL/ACL/retiro/conciliación aprobadas.

## Integridad, entrega y límites

- Los 73 hashes del manifiesto del candidato Janet/Estiven permanecen intactos.
  Los cinco archivos de esta corrección no formaban parte de aquel delta OLT.
- Commit limitado a los cinco archivos, esta documentación y la prueba nueva;
  no incluye cambios OLT pendientes ni archivos ajenos del checkout principal.
- No se actualizó el manifiesto OLT antiguo para aparentar que esta corrección
  era parte de la revisión anterior: ambos alcances se identifican por separado.
- Riesgo residual: verificaciones con mocks y una función pura; no constituyen
  pruebas reales de equipos/servicios. No se contactó OLT, MikroTik, Proxmox,
  GenieACS, Supabase ni producción.
- El bloqueo TypeScript identificado queda resuelto. La integración puede
  revisarse y luego repetir preflight fresco con este commit incluido. Toda
  activación exige autorización nueva; no se ejecuta en esta entrega.
