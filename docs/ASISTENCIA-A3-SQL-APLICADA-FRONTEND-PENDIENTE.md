# A3 — migración aplicada; despliegue frontend detenido

## Estado vigente: SQL A3 aplicada y verificada; frontend A3 NO desplegado

La migración `20261029000000_asistencia_a3_intercambios.sql` del candidato
`71944f5` se aplicó exclusivamente al proyecto `mzupdnjegfwmpajywckd` el
27/10/2026 a las 04:19:31 UTC (26/10, 23:19 Perú). Su verificación posterior
está completada. La activación se detuvo antes de construir/promover frontend
por un fallo del parser de verificación, corregido después solo para comprobar
el SQL. **El frontend sigue en A2/A2.1 `7ed8dcd`; A3 NO está activada de punta
a punta.** Esta nota prevalece sobre los estados anteriores de A3 sin migrar
o lista para activación completa. No reaplicar la migración.

## Revalidación y aplicación autorizada

- HEAD inicial `6af43cd`: contiene el verificador OCI corregido. El código de
  aplicación y la migración siguen idénticos a `71944f5`; diff respecto a la
  base productiva `7ed8dcd` limitado a cinco archivos de Asistencia.
- Los 16 blobs OCI del respaldo y las copias SQL/funciones conservan sus hashes,
  tanto en PC como VM. Datos y definiciones productivas coincidían con el
  respaldo verificado de 04:04 UTC; sin drift de contenedores ni overrides.
- Se ejecutó solo el SQL A3 original, con guards de vigencia dentro de su propia
  transacción y locks breves sobre las ocho tablas de Asistencia/configuración.
  No se ejecutó un push masivo de migraciones ni se reescribieron marcaciones.
- SHA-256 de la migración original:
  `24a4495d8b22526527e81e664aedc2a68ba4e33626963d3fa881caa0bc22cdc9`.
  SHA-256 del SQL con guards:
  `18571feb934320d8560ca07a6f68744f59c7dd61c31dac93696afbe58510a39e`.

## Motivo de detención y diagnóstico

El nuevo verificador posterior esperaba siete funciones pero su expresión
regular aceptaba solo letras y guiones bajos: omitía los tres nombres con
dígito `a3`, contando cuatro. Fue un defecto del verificador preparado en esta
sesión, no una discrepancia de las definiciones productivas. Se detuvo antes de
construcción/promoción y no se ejecutó rollback. El intento de preparar build
también quedó bloqueado por la condición de SQL aún no verificada; no creó fuente
ni imagen candidata. Se corrigió el parser para aceptar dígitos y se completaron
solo lecturas de verificación. El despliegue no se reanudó después del fallo.

Resultado posterior: siete cuerpos SQL A3/ingreso coinciden con la migración;
las otras 14 funciones conservan sus cuerpos originales. Conteos/hashes de las
ocho tablas anteriores idénticos al respaldo, incluidas las 113 marcaciones.
No se repitieron suites funcionales ni build.

## Seguridad, horarios y disponibilidad

Tabla de intercambios con RLS habilitada y una política de lectura propia o
SUPERADMIN; authenticated solo tiene SELECT, sin INSERT/UPDATE/DELETE directo;
anon no tiene SELECT. Las siete RPC examinadas (tres A3 y cuatro marcaciones)
siguen accesibles a authenticated, cerradas a anon, SECURITY DEFINER con
search_path=public. Crear/cancelar conserva la guarda exclusiva SUPERADMIN,
confirmada por el cuerpo exacto ya aprobado. SUPERADMIN sigue exento.
**Cero intercambios registrados; no se creó ninguno de prueba.**

Horarios preservados: Alhely Lozano sábado 08:00–13:30; Angie Laguna sábado
13:30–19:00. GET públicos de `/api/health`, `/`, `/asistencia` y `/campo`:
HTTP 200. Estos resultados confirman disponibilidad técnica; no acreditan la
interfaz A3, que todavía no está publicada, ni una validación funcional real.

Frontend activo: `smartrayco-asistencia-a2-full:7ed8dcd-20261027T000500Z`, imagen
`sha256:afb272698444096271026ff940615a8d66fa1d367b094f1182861a99e9f4418e`;
contenedor `5ed0853222f375a388ef8410843ca024445ef3015b345ccc137fd6e007fa2286`,
StartedAt `2026-10-27T02:44:18.038826098Z`.

Backend activo: `smartrayco-backend-counters:16831c6-20261026T162650Z`, imagen
`sha256:6631d4a124b631f7bedd3d8c2b6f6c8ab7e524e264385ae2fae2b46e3f67047e`;
contenedor `cd577bcaa95cab290bfa2baa7d754a97a516dab94a0aa79af5db6cb34bccf154`,
StartedAt `2026-10-26T20:44:49.856235867Z`.
Mismos IDs/imágenes/arranques y hashes de overrides antes y después.
Sin ejecución de Compose para modificar servicios; backend nunca recreado.

## Próximo paso y riesgos

Pendiente únicamente la fase de construcción, validación y promoción selectiva
del frontend A3 `71944f5`, con revalidación de drift, sin reaplicar SQL ni repetir
pruebas funcionales cerradas. Conservar el override backend Fase 175 y el frontend
A2-full en la cadena; añadir solo un override frontend A3. La validación funcional
real de intercambios queda pendiente después de publicar su interfaz.

No ejecutar rollback automático si aparecen intercambios reales, incluso
cancelados; requiere recuperación específica sin borrado. Aunque actualmente la
tabla está vacía, no se ejecutó reversión. Directorio principal y cambios ajenos
intactos; sin operaciones OLT/MikroTik ni cambios de otros módulos.

Evidencia: `ASISTENCIA-A3-RELEASE.json`, `ASISTENCIA-A3-SQL-APPLIED-CHECKS.json`
y `ASISTENCIA-A3-BACKUPS-FINAL-CHECK.json`. Snapshots privados y SQL de aplicación
con guards están excluidos de Git en `.env.a3-recovery/`.
