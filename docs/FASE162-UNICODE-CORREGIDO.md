# Fase 162 — transporte UTF-8 corregido

Estado: **LISTO PARA NUEVA AUTORIZACIÓN**. Exclusivamente corrección del transporte; Fase 162 continúa sin instalarse en Cloud. La autorización de la ventana anterior está vencida y no se reutilizó.

## Causa y corrección

En Windows PowerShell 5.1.19041.6456, el `StreamWriter` de `Process.StandardInput` usaba **ibm850**. La llamada anterior `$p.StandardInput.Write($inputText)` convertía `📦` (UTF-8 `f09f93a6`) en `??` (`3f3f`) antes de llegar a Docker. El ensayo aislado reprodujo exactamente esa conversión. Los archivos SQL y las definiciones de Cloud no eran el origen del fallo.

`Invoke-PrivateDocker`, en `scripts/verificar-supabase-privado.ps1`, ahora codifica mediante `UTF8Encoding(false,true)` y escribe los bytes directamente en `StandardInput.BaseStream`: sin BOM, sin normalización Unicode y sin sustituciones. Los surrogates inválidos se rechazan antes de iniciar el proceso. stdout/stderr se decodifican también como UTF-8 estricto y el buffer de entrada se borra al finalizar. Se conservan argumentos, límites existentes, TLS verify-full y manejo privado de credenciales por stdin/DPAPI. Los ejecutores de Fase 162 que cargan esta función reciben la corrección sin editar el contenido SQL ni reactivar la ventana anterior.

El verificador específico lee SQL con UTF-8 estricto y conserva la respuesta JSON cruda en UTF-8 en runtime local, evitando su paso por impresión de consola. Las comparaciones se realizan sobre JSON, bytes hexadecimales y hashes, sin copiar caracteres desde la pantalla.

## Evidencia focalizada

- **31/31 comprobaciones locales**, Docker y PostgreSQL nuevo con `--network none`, sin puertos, volúmenes persistentes ni datos operativos. Incluyen reproducción de la pérdida anterior; roundtrip exacto y SHA-256 de ASCII, español, caracteres suplementarios, chino/árabe, formas Unicode compuesta/descompuesta, comillas, dólares, barras y CRLF; stderr; rechazo de surrogate inválido; hashes de ambos SQL y del paquete; y literales/hex/SHA-256 en PostgreSQL READ ONLY. El contenedor temporal fue eliminado al finalizar. Las migraciones se enviaron únicamente a `sha256sum`, nunca se ejecutaron en estas pruebas.
- **17/17 verificaciones Cloud**, una conexión con TLS verify-full, default_transaction_read_only=on, BEGIN READ ONLY, statement_timeout=10 s y lock_timeout=2 s. Solo SELECT de catálogos y constantes, sin lecturas de filas operativas. Fecha del servidor: **2026-10-16 20:55:28 UTC**.
- Coinciden localmente y dentro de PostgreSQL **37 funciones/ACL, 14 tablas con columnas, índices, constraints, triggers y RLS, 31 políticas y enums**, reutilizando las capturas aprobadas. Las definiciones de funciones se cotejan con el MD5 UTF-8 del texto aprobado, normalizando únicamente CR conforme al precheck anterior.
- `inventory_categories.icon` conserva exactamente `'📦'::text`: hex `27f09f93a6273a3a74657874`; SHA-256 `5ebfb2ff608e2b0a22762ee0497719e576e5a1d8757c59c0db8ab418b747ffff`. Ya coincide tanto en el servidor como en el verificador local.
- El literal de prueba Unicode coincide en texto, hex y SHA-256 de extremo a extremo. Cloud confirma **Fase 162 ausente**.

No se repitieron pruebas funcionales, concurrencia, idempotencia ni regresiones aprobadas.

## SQL aprobado intacto

| Artefacto | SHA-256 confirmado en origen y al recibirlo Docker |
|---|---|
| `20261015180000_fase162_inventario_rutinas.sql` | `16a7d9a05dfb6b02ddce08051f7293a93bb246429ca8237229c81ac46748b225` |
| `20261016020000_fase162_autorizacion_recibos.sql` | `17f0c543b0742fb40d2992ea36238f807fe5b4fa13dbdb3e05a837a0b9d34f72` |
| Paquete de instalación ya aprobado | `898c34ab4d0c9f44960af346e380ba4bef5a7f9c6d6b49cf58c08b24f7dc9d1b` |

`git diff f50914c --` para ambas migraciones no muestra cambios.

## Archivos de esta corrección

- `scripts/verificar-supabase-privado.ps1`: transporte corregido y dependencia privada reutilizada. Este archivo preexistía sin seguimiento; se incorpora para versionar la corrección, sin credenciales ni cambios en sus operaciones de diagnóstico.
- `scripts/verificar-fase162-unicode.ps1`: ejecución exclusivamente de los prechecks de lectura con el transporte corregido y credencial DPAPI existente.
- `scripts/tests/fase162-unicode-transport.test.ps1`: pruebas aisladas del transporte.
- `scripts/tests/fase162-unicode-catalog.sql`: SELECT de catálogos ya delimitados en los prechecks anteriores.
- `scripts/tests/fase162-unicode-precheck.cjs`: preparación y comprobación local de comparaciones, bytes y hashes; no abre conexiones ni ejecuta migraciones.
- `docs/FASE162-UNICODE-PRUEBAS.json` y `docs/FASE162-UNICODE-CLOUD-VALIDACION.json`: resultados sin secretos ni datos operativos.
- Este documento.

Comandos ejecutados:

```powershell
powershell -NoProfile -File scripts/tests/fase162-unicode-transport.test.ps1
node scripts/tests/fase162-unicode-precheck.cjs --prepare
powershell -NoProfile -File scripts/verificar-fase162-unicode.ps1
node scripts/tests/fase162-unicode-precheck.cjs --verify
```

## Límites y siguiente paso

La corrección de codificación está validada; esto **no autoriza ni ejecuta la instalación**. No se reabrió la ventana, no se borró el registro del intento detenido ni se ejecutó el antiguo instalador. No se modificaron datos, funciones, políticas, ocho históricos, Fase 161 ni código funcional de Rutinas. Sin push ni despliegue. Los demás cambios locales anteriores quedan fuera del commit.

Tras autorización expresa nueva: establecer una ventana nueva; reconfirmar respaldo y hashes; verificar pausa y esquema inmediatamente antes; conservar una sola transacción y límites 2/60/120 s, y ejecutar los postchecks previstos. Una lectura de las 20:55 UTC no certifica una pausa futura. Los marcadores de gate/COMMIT/postchecks y la verificación de Cloud son obligatorios: el antiguo `\quit 9` puede producir exit code 0 y este no prueba instalación correcta. Este detalle se conserva documentado sin cambiar el flujo de instalación en la presente corrección.

No hay bloqueo pendiente de Unicode. Se requiere autorización expresa para cualquier nueva ejecución de migraciones.
