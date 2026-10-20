# Mi Avance: despliegue detenido en fase de respaldo — 20/10/2026

Actualización: el fallo original de comparación de imagen quedó identificado
y corregido; el respaldo OCI completo y la restauración PostgreSQL pasaron.
Las comprobaciones posteriores de recuperación de contenedores y auditoría
visual siguen incompletas. **No retomar despliegue todavía.** Véase
[MI-AVANCE-RESOLUCION-RESPALDOS.md](MI-AVANCE-RESOLUCION-RESPALDOS.md).
El contenido siguiente conserva el registro de la detención inicial.

**No desplegado. No se aplicaron migraciones, no se crearon commits, no hubo
push ni cambios de servicios.** La autorización de despliegue fue recibida;
la ejecución se detuvo conforme a la condición del propietario de parar ante
una comprobación crítica fallida. El candidato de aplicación y SQL permanece
sin cambios respecto de MI-AVANCE-PERMISOS-RANKING.md.

## Estado comprobado

- origin/main y el checkout limpio de producción coinciden en
  `40cd3967b573db0d8379e2df67449584ab10051b`.
- main local está en `dceafa08d2717b643f65b3880ead020a14561648`, con un commit
  adicional de documentación de Fase 165 y numerosos cambios pendientes ajenos.
  No se incorporaron ni se modificaron esos cambios. Para una futura entrega
  corresponde preparar un checkout aislado desde el SHA de producción.
- Consulta READ ONLY actual de Supabase: cuerpo original del ranking MD5
  `e1a53bc89358018536db151da721c908`, conforme a la guarda candidata;
  custodia MD5 `c2f433b3c4d2ed628ce07ad114b98530`, EXECUTE solo para
  propietario de función y authenticated. Las RPC personales nuevas aún no
  están instaladas. El ranking conserva sus permisos históricos hasta activar
  el SQL aprobado; no se ha cerrado todavía su acceso anónimo.
- Servicios existentes observados en ejecución: frontend, backend y Caddy;
  MongoDB y GenieACS saludables según sus healthchecks. No se reiniciaron.
  No equivale a una prueba funcional de Mi Avance en producción.

## Respaldo PostgreSQL

Ubicación privada:

`C:\Users\USER\AppData\Local\SmartRaycoBackups\mi_avance_20261020_155830_e29392f9`

La exportación terminó con `DATABASE_PASS`. Incluye `completo.dump` completo,
roles sin contraseñas, catálogo de funciones/ACL/RLS, configuración de base,
huellas de filas bajo snapshot exportado e inventario del archivo. El script
generó `SHA256SUMS.json`. Toda conexión Cloud de esta operación usó
`default_transaction_read_only=on`, TLS verify-full y credenciales por stdin.
El directorio tiene ACL privada del usuario y SYSTEM; no se añadió al Git.

`pg_restore --list` y `pg_restore --file=/dev/null` finalizaron correctamente.
**No se ejecutó la restauración aislada ni el ensayo sobre datos restaurados**,
porque la comprobación independiente del respaldo anterior de imágenes falló.
Una lectura posterior del directorio privado fue denegada por el entorno;
no se escaló ni se eludió ese bloqueo. No se declara recuperación certificada.

## Comprobación que detuvo el despliegue

El exportador del despliegue anterior guardó una imagen frontend con
`docker save`, pero falló al contrastar el nombre de configuración incluido en
`manifest.json` con el ID esperado:

`AssertionError: STOP: image backup identity mismatch`

La comprobación usa el nombre de la entrada Config del archivo. Aún no se ha
determinado si el fallo corresponde al formato del archivo exportado o a una
discrepancia de identidad. **No demuestra por sí solo que la imagen ejecutada
sea distinta**: el ID del contenedor sí coincidía antes de exportarla.
No se ha corregido la comprobación ni continuado después del fallo.

La copia remota parcial quedó bajo `/opt/smartrayco-staging/mi-avance-*/backup`.
No se da por verificada: el proceso paró antes de exportar backend, generar el
manifiesto final, copiar configuración y comprobar todas las huellas. No hubo
limpieza ni eliminación de copias parciales.

## Recuperación y continuación

No hay activación que revertir. Mantener los contenedores y la base actuales.
Antes de reanudar, inspeccionar **en lectura** el archivo de imagen parcial,
identificar su formato y verificar el digest real del objeto de configuración
contra el ID del contenedor. Documentar el resultado antes de corregir el
verificador. Si existe deriva real, detener y resolver esa divergencia.

Después deben completarse y verificarse los respaldos de ambas imágenes,
configuración y código anterior, y ejecutarse la restauración PostgreSQL aislada
sin red. Los scripts de ensayo preparados son nuevos y **no ejecutados**; no
sustituyen las pruebas ya aprobadas del candidato.

Solo después de superar esas condiciones: aislar los archivos validados,
verificar sus huellas, crear el commit autorizado, push sin forzar, aplicar
únicamente el SQL aprobado y activar frontend/backend por el procedimiento
seguro, conservando los servicios de red. No ejecutar el tramo de limpieza de
imágenes ni un reset destructivo de los scripts generales.

## Rollback preparado, no ejecutado

Las imágenes observadas antes de cualquier cambio fueron:

- frontend: `sha256:21e9c2944a25660abb5611114b875d207e98e0ab779d2cfb0af759d1978b2e0c`
- backend: `sha256:0ee2ed7441fb08b66ecf437b3c1189c569449fac95a1842b692a43b4892f4466`

Comando de recuperación de contenedores preparado para revisión; requiere
confirmar que ambas imágenes siguen disponibles. **No ejecutarlo ahora**:

```sh
cd /opt/smartrayco
docker compose -f docker-compose.onprem.yml -f - up -d --no-deps --no-build --pull never frontend backend <<'JSON'
{"services":{"frontend":{"image":"sha256:21e9c2944a25660abb5611114b875d207e98e0ab779d2cfb0af759d1978b2e0c"},"backend":{"image":"sha256:0ee2ed7441fb08b66ecf437b3c1189c569449fac95a1842b692a43b4892f4466"}}}
JSON
```

No modifica Git ni recrea dependencias. El rollback SQL preparado continúa en
`docs/sql/mi-avance-rollback.sql`: restaura el cálculo mensual original,
conserva ranking compartido autenticado y bloqueo anónimo, retira RPC nuevas.
No se ejecutó en producción. Debe coordinarse con la retirada de la interfaz
que depende de esas RPC y ensayarse sobre el respaldo nuevo antes de activarlo.

## Archivos preparados en esta ejecución

- Este informe.
- `scripts/mi-avance-backup.ps1`: exportación autorizada ejecutada; fase Restore
  preparada sin ejecutar.
- `scripts/tests/mi-avance-backup-cloud.sh`: exportación READ ONLY ejecutada.
- `scripts/tests/mi-avance-backup-restore.sh`: restauración aislada, comparación
  de datos/funciones/permisos, ensayo de candidato y rollback; sin ejecutar.
- `scripts/tests/mi-avance-release-access.sql`: gate de lectura con actores
  reales, permisos anónimos, ranking por período y aislamiento propio;
  sin ejecutar. No afirmar PASS de este gate.
- Scripts auxiliares y metadatos privados en runtime ignorado por Git.

No se repitieron suites ya aprobadas ni se alteraron sus resultados. No hay
commit nuevo ni SHA desplegado de Mi Avance. El SHA anterior continúa vigente.

## Pendientes de validación

Bloqueantes: aclarar respaldo de imagen, verificar respaldo completo del
despliegue anterior, restaurar PostgreSQL en aislamiento, completar el ensayo
y posteriormente las comprobaciones READ ONLY de producción tras activación.

Android real: **no validado**. Tras un despliegue exitoso, dos técnicos deben
comprobar puntos propios Hoy/Semana/Mes, ranking compartido sin tickets ajenos,
custodia de lectura, cambio de sesión sin datos anteriores, navegación Atrás,
retorno del segundo plano y recuperación de conexión. Usar trabajos existentes;
no crear órdenes, consumos o movimientos para probar. La autorización recibida
no convierte las comprobaciones locales previas en validación de la APK real.
