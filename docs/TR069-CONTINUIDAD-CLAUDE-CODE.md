# Continuidad TR-069 para Claude Code — 27/10/2026

## Estado que prevalece

**RESPALDOS VERIFICADOS — APTO PARA RETOMAR TR-069**, previa revalidación y
confirmación expresa del propietario. La autorización anterior permanece
pendiente: no equivale a autorización para reanudar ahora.

Corrección funcional `30bbb54`, rama `diagnostico/tr069-genieacs-readonly`.
**Todavía NO desplegada. La Huawei todavía NO se ha probado.** No se ejecutaron
migraciones, despliegues, sincronizaciones manuales ni tareas sobre ONTs.
GenieACS, OLT, MikroTik, contratos y datos productivos no se modificaron.

Worktree de continuidad:
`D:/SmartRayco/scripts/inventory-auth-lab/runtime/tr069-diagnostic-worktree`.
No trabajar sobre los cambios ajenos del directorio principal `D:/SmartRayco`.
No tocar main, mezclar fases ni repetir auditorías o suites ya aprobadas.

## Corrección y pruebas aprobadas

El NBI devuelve cero CPE; la caché `tr069_devices` contiene dos equipos antiguos.
La vista confundía toda la caché con equipos actuales. La corrección separa
inventario ACS, históricos y presencia no verificada; no borra ni desvincula.
Solo una lectura NBI completa y validada acredita ausencias. Errores, timeout,
respuestas parciales o tardías no acreditan retiradas nuevas. Huawei nueva usa
identidad ACS exacta y no hereda el contrato de ZTE.

- 22 pruebas aisladas de servicio aprobadas.
- 29 comprobaciones de navegador, vista/store reales y datos ficticios, aprobadas.
- Compilación frontend, TypeScript backend modificado y diff-check aprobados.
- Verificador OCI reutilizado de A3: 5 casos aprobados.
- No requiere migraciones ni cambios de RLS.

Detalle de archivos y pruebas: [implementación local](TR069-INVENTARIO-ACTUAL-LOCAL.md).
No repetir estas pruebas salvo cambios o incidencias concretas.

## Bloqueo resuelto

El intento documentado en `d314ff9` se detuvo antes de construir/promover imágenes.
El auxiliar repetía el error resuelto en A3: comparar SHA256 de configuración
con el ID de imagen que representa el índice OCI. Son objetos distintos.
Se reutilizó `scripts/asistencia-a3-archive-verify.py`, conforme a
[la solución A3](ASISTENCIA-A3-RESPALDOS-CORREGIDOS.md): identidad de índice,
manifiestos, tamaños y digests de blobs, configuración runtime y diff_ids.

| Respaldo | Blobs íntegros | Archivos recuperados/cotejados | Resultado |
|---|---:|---:|---|
| Frontend | 20 | 498 | Recuperable |
| Backend | 19 | 406 | Recuperable |

Se copiaron ambos tar al PC, con SHA256 idéntico, se cargaron en Docker LOCAL
y recuperaron los IDs inmutables exactos. Contenedores temporales con red `none`,
sin arrancarlos; eliminados al terminar. Configuración y capas coincidentes.
Esto acredita recuperación de imágenes y archivos; no es una prueba de arranque
de la nueva aplicación ni de integración productiva posterior al despliegue.

Evidencia pública filtrada: [TR069-RESPALDOS-VERIFICADOS.json](TR069-RESPALDOS-VERIFICADOS.json).
Los manifests privados completos permanecen en `.env.tr069-release/`, ignorada
por Git. No publicar su contenido ni credenciales. Auxiliares locales corregidos:
`run.cjs`, `remote.py` y `verify-backups.cjs` en ese directorio. El modo `prepare`
de `remote.py` también prepara artefactos en VM: no ejecutarlo como verificación
de solo lectura. Usar siempre el verificador OCI de A3, no la comparación antigua.

## Producción conservada, última comprobación

Frontend: `smartrayco-campo-direccion:fc9047f-20261027T145104Z`.
Imagen `sha256:dac71cc991c71f494ba9eb9b489eb4c6ad0c11fdc4eedfaf26989c08fc2136d0`.
Contenedor `4fd954e70a8daa3958b7f84a6e10e48cabffc51c12a5df4d47ce8999fbcd56ac`.
StartedAt `2026-10-27T14:58:48.143889293Z`.

Backend: `smartrayco-backend-counters:16831c6-20261026T162650Z`.
Imagen `sha256:6631d4a124b631f7bedd3d8c2b6f6c8ab7e524e264385ae2fae2b46e3f67047e`.
Contenedor `cd577bcaa95cab290bfa2baa7d754a97a516dab94a0aa79af5db6cb34bccf154`.
StartedAt `2026-10-26T20:44:49.856235867Z`.

VM `192.168.55.201`. Cadena Compose verificada, en este orden:

1. `/opt/smartrayco/docker-compose.onprem.yml`
2. `/opt/smartrayco-staging/fase175-counters-16831c6-20261026T162650Z/backend.override.json`
3. `/opt/smartrayco-staging/asistencia-a2-full-20261027T000500Z/frontend.override.json`
4. `/opt/smartrayco-staging/asistencia-a3-71944f5-20261027T034446Z/promotion/frontend.override.json`
5. `/opt/smartrayco-staging/asistencia-visual-233f230-20261027T133357Z/promotion/frontend.override.json`
6. `/opt/smartrayco-staging/puntos-ff3077f-20261027T140327Z/promotion/frontend.override.json`
7. `/opt/smartrayco-staging/campo-direccion-fc9047f-20261027T145104Z/promotion/frontend.override.json`

Configuración efectiva e imágenes coincidieron; hashes de los siete archivos
verificados. Otros contenedores conservaron identidad y StartedAt.
Backend → NBI: `http://genieacs:7557`; lectura HTTP 200, total 0, lista vacía.
`clientLifecycle.ts` activo coincide con la dependencia local salvo finales de línea.
No confundir éxito NBI con conectividad CWMP de una ONT real.

## Respaldos y rollback

VM: `/opt/smartrayco-staging/tr069-30bbb54-20261027/recovery/`.
PC: `.env.tr069-release/frontend.tar` y `backend.tar` dentro del worktree.
Hashes de imágenes y exportación de datos en
[el registro de activación](TR069-ACTIVACION-CONTROLADA.md).
La exportación privada contiene 2 CPE, 2.175 métricas y 1 contrato asociado.
Es un snapshot de solo lectura; no se ha restaurado sobre producción ni probado
como restauración SQL completa. Las dos imágenes sí se recuperaron aisladamente.

Procedimiento de promoción previsto: conservar los siete `-f` y añadir al final
un override de imágenes candidatas; comprobar configuración efectiva y que solo
cambien backend/frontend. Usar proyecto `smartrayco` y promover por separado:
`up -d --no-deps --no-build --pull never backend`, verificar y luego equivalente
para `frontend`. No usar `down`, `--build` ni levantar dependencias.

Rollback previsto: con esa misma cadena, añadir un override final que fije
backend y frontend a los dos IDs inmutables anteriores; restaurar primero backend
y después frontend con los mismos flags, verificar salud y recursos. Si faltan
las imágenes, cargar los tar verificados mediante `docker image load -i` antes.
No restaurar contratos/datos por un rollback de imágenes ni ejecutar SQL.
La recuperación de las imágenes está verificada; la promoción y el rollback de
servicios NO se ejecutaron. El script final de rollback y override de promoción
todavía deben materializarse y validarse contra la configuración revalidada;
no asumir que ya existen por la presencia de código que los genera.

## Siguiente paso obligatorio para Claude Code

1. Leer este documento y revalidar puntualmente imágenes, contenedores,
   StartedAt, hashes de overrides, disponibilidad de respaldos y respuesta NBI.
2. **Solicitar confirmación expresa para reanudar el despliegue controlado de
   backend y frontend del commit `30bbb54`. Esperar esa respuesta.**
3. Solo con autorización: preparar backend sobre la imagen productiva vigente
   aplicando únicamente ruta/servicio TR-069 y tipos requeridos; conservar los
   cambios de backend ajenos presentes en producción. No desplegar todo el árbol
   de esta rama sobre `16831c6`. Frontend con configuración productiva conservada.
4. Preparar y revisar overrides y rollback; backend primero, frontend después.
   Ante discrepancias detenerse. Sin migraciones ni cambios ACS/equipos.
5. Comprobar por lectura API autenticada, inventario actual vacío si NBI sigue
   vacío, históricos y asociaciones intactas; no pulsar sincronizar, refresh,
   reboot o configuración como verificación. Documentar imágenes nuevas.

La prueba de registro Huawei será posterior, separada y pendiente de revisión
del despliegue. No iniciar operaciones sobre ninguna ONT ni una fase nueva.
