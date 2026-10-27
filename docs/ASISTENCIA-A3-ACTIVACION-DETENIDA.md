# A3 — activación autorizada, detenida en verificación de respaldo

## Estado vigente: A3 NO activada

La activación del candidato `71944f5` fue autorizada por el propietario, pero
se detuvo en el paso 2 al fallar la verificación de la imagen respaldada.
No se aplicó la migración A3, no se construyó ni promovió frontend, y no se
recreó backend. Esta nota prevalece sobre cualquier indicación de activación
completada. A3 sigue pendiente de activación y validación operativa real.

Se actualiza documentación y se sincroniza la rama A3 conforme a la autorización;
el push no representa despliegue. A0/A1 y A2/A2.1 mantienen su estado anterior.

## Evidencia y punto de detención

- Revalidación SQL productiva en modo READ ONLY, 27/10/2026 03:39:56 UTC:
  A3 ausente; dependencias A0–A2.1 presentes, funciones coincidentes con las
  fuentes locales, RLS habilitada. Horarios: Alhely sábado 08:00–13:30,
  Angie sábado 13:30–19:00; ninguna modificación de datos ni SQL productivo.
- Se preparó exclusivamente un tar y tag de la imagen frontend saliente en
  `/opt/smartrayco-staging/asistencia-a3-71944f5-20261027T034446Z/recovery/frontend.tar`.
  Tamaño: 27.967.488 bytes. SHA-256 del archivo:
  `da12ddbb50b4889e4a7ffe48138ff29709592628f1637f640c5ebfe9b321a53e`.
- Tag: `smartrayco-asistencia-a3-rollback:asistencia-a3-71944f5-20261027T034446Z`.
  El proceso se detuvo antes de copiar/verificar el tar en el PC y antes de
  completar respaldo de overrides y SQL específico. No está acreditado como
  respaldo recuperable de A3; no utilizarlo como tal hasta verificarlo.
- El verificador comparó el hash del objeto Config del tar
  (`37c1b8efbfa476f44fe047bf5c044fecb3a78d61e7ed7954f5afc5dd155c6c1a`)
  contra el ID de la imagen activa (`afb27269…`) y disparó
  `ARCHIVE_IMAGE_MISMATCH`. Estos identificadores pueden corresponder a objetos
  diferentes en OCI; la diferencia por sí sola no acredita corrupción. El
  diagnóstico adicional de manifiesto/capas no se completó satisfactoriamente;
  no se declara validado el tar ni se reanuda la activación.
- Se respetó la orden de detenerse ante cualquier fallo de verificación.
  No se ejecutó rollback ni se eliminaron registros, archivos o imágenes.

## Producción confirmada intacta tras la detención

Frontend: `smartrayco-asistencia-a2-full:7ed8dcd-20261027T000500Z`;
imagen `sha256:afb272698444096271026ff940615a8d66fa1d367b094f1182861a99e9f4418e`;
contenedor `5ed0853222f375a388ef8410843ca024445ef3015b345ccc137fd6e007fa2286`;
StartedAt `2026-10-27T02:44:18.038826098Z`, corriendo.

Backend: `smartrayco-backend-counters:16831c6-20261026T162650Z`;
imagen `sha256:6631d4a124b631f7bedd3d8c2b6f6c8ab7e524e264385ae2fae2b46e3f67047e`;
contenedor `cd577bcaa95cab290bfa2baa7d754a97a516dab94a0aa79af5db6cb34bccf154`;
StartedAt `2026-10-26T20:44:49.856235867Z`, corriendo.

Imágenes, IDs y fechas de arranque idénticos antes y después. Overrides
revalidados sin drift antes del respaldo; no se ejecutó Compose para modificar
servicios. La cadena vigente del frontend conserva el override backend Fase 175
y el frontend A2-full; no usar la cadena antigua de etiquetas del backend.

## Pendientes antes de retomar

Corregir y validar la comprobación de identidad OCI del respaldo, completar
copia PC y respaldo SQL/overrides; reportar resultado antes de reanudar la
activación detenida. Después siguen migración A3, verificación SQL, construcción
y promoción exclusivamente frontend y comprobaciones postdespliegue.
Estas comprobaciones posteriores no se ejecutaron: no hubo despliegue.

El rollback SQL solo admite cero intercambios, incluso cancelados; con datos
reales requiere recuperación específica sin borrado. Sigue pendiente la
validación funcional real de A3. No se repitieron suites ni builds ya aprobados.
Directorio principal y cambios ajenos intactos.

Evidencia: `ASISTENCIA-A3-ACTIVATION-STOPPED.json`. El ejecutor auxiliar de
activación fallido queda local, sin incluirlo en el commit documental.
