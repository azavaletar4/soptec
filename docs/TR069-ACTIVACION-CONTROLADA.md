# TR-069: activación controlada detenida antes del despliegue

Fecha: 27/10/2026. Corrección autorizada: `30bbb54`.
Rama: `diagnostico/tr069-genieacs-readonly`.

## Estado posterior: bloqueo resuelto, despliegue aún pendiente

Ambos respaldos ya fueron validados y recuperados en Docker local: frontend
20 blobs/498 archivos; backend 19 blobs/406 archivos. El error era comparar
configuración con índice OCI, ya resuelto en A3. No hubo despliegue ni prueba
Huawei. El bloqueo descrito abajo es el antecedente histórico, no un pendiente
de integridad actual. Continuidad vigente y confirmación requerida:
[TR069-CONTINUIDAD-CLAUDE-CODE.md](TR069-CONTINUIDAD-CLAUDE-CODE.md).

## Resultado del intento inicial

NO DESPLEGADO. Se respetó la instrucción de detenerse ante discrepancias.
La prevalidación y exportación de respaldos concluyeron, pero falló una
comprobación de recuperabilidad antes de construir o promover imágenes.
No se ejecutaron migraciones, SQL, sincronizaciones manuales ni tareas de ONTs.
No se modificaron GenieACS, OLT, MikroTik, contratos ni datos productivos.

## Versiones activas verificadas

- Frontend: `smartrayco-campo-direccion:fc9047f-20261027T145104Z`.
  Imagen `sha256:dac71cc991c71f494ba9eb9b489eb4c6ad0c11fdc4eedfaf26989c08fc2136d0`.
  Contenedor `4fd954e70a8daa3958b7f84a6e10e48cabffc51c12a5df4d47ce8999fbcd56ac`.
  StartedAt `2026-10-27T14:58:48.143889293Z`.
- Backend: `smartrayco-backend-counters:16831c6-20261026T162650Z`.
  Imagen `sha256:6631d4a124b631f7bedd3d8c2b6f6c8ab7e524e264385ae2fae2b46e3f67047e`.
  Contenedor `cd577bcaa95cab290bfa2baa7d754a97a516dab94a0aa79af5db6cb34bccf154`.
  StartedAt `2026-10-26T20:44:49.856235867Z`.

Ambos permanecen sin cambios: no hubo operaciones de promoción o reinicio.
La configuración efectiva de Compose coincidió con las imágenes activas.
Se conservan sus siete archivos: base onprem, backend counters, frontend A2,
A3, visual 233f230, puntos ff3077f y dirección fc9047f; no se modificaron.
La dependencia real `clientLifecycle.ts` coincide con la local ignorando
finales de línea. La corrección no requiere migraciones.

## Respaldos y discrepancia

Directorio privado de VM:
`/opt/smartrayco-staging/tr069-30bbb54-20261027/recovery/`.

- `frontend.tar`: SHA256
  `61a19559e60529788cc32c2c3cd8e5599066a9d56a1454b235e1b74b0f0bddae`.
- `backend.tar`: SHA256
  `a470af78a26149f565621ccdfe615b47e285487cb26192b8bdca2a6a2f87e423`.
- `data.private.json`: SHA256
  `b533d8f15c39132b89c719980946dfb18cdb356c0689acaa1518d9a127b25df4`.
  Exportación de solo lectura: 2 CPE, 2.175 métricas y 1 contrato asociado.
  No publicar su contenido.
- También se guardaron inspect privados, configuración efectiva, fuentes
  backend y recursos frontend. `record.json` contiene referencias y hashes.

En la validación de `frontend.tar` pasó su hash de archivo y la lectura de
`manifest.json`, pero falló la igualdad entre SHA256 del fichero `Config`
referenciado por ese manifiesto y el identificador de imagen inspeccionado.
Se detuvo en ese punto: no se completó la validación de todos los blobs,
la validación posterior del backend ni la preparación del script de rollback.
No se afirma corrupción: queda por determinar si existe una diferencia de
representación del archivo Docker/OCI o un problema del respaldo.
No debe calificarse todavía como respaldo recuperable validado.

## Verificaciones y pendiente

NBI respondió HTTP 200, cabecera total 0 y lista vacía desde el backend activo.
La caché conserva 2 registros; no se hicieron escrituras sobre ellos ni sus
asociaciones. No hay comprobaciones posteriores a un despliegue porque no hubo
despliegue. Las 22 pruebas de servicio y 29 de navegador previas siguen siendo
evidencia local, descrita en `TR069-INVENTARIO-ACTUAL-LOCAL.md`.

Pendiente: revisar la discrepancia del respaldo y verificar recuperación y
rollback antes de retomar. Después, preparar imágenes sobre las versiones
activas, promover backend y frontend y verificar lista/históricos por lectura.
La prueba de registro Huawei continúa expresamente pendiente; no se inició.
