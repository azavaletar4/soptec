# Clientes — despliegue controlado autorizado

**Resultado: PASS.** Frontend activado el **23/10/2026 a las 13:06:15 Lima / 18:06:15 UTC**. Autorización del usuario limitada a Clientes vigentes/retirados/Prospectos de `e3c95aa` y `2f25873`. Sin push, migraciones, cambios RLS ni escrituras operativas.

## Versión y archivos publicados

- Versión funcional: **`2f25873`**, sobre `e3c95aa`.
- Imagen activa: `smartrayco-frontend:clientes-2f25873-e3b07db`.
- ID: `sha256:a1f9defba1bca3aa20b111bf1a2a680b649eb125b452693357d99184ce9c56f7`.
- Tar aprobado: SHA-256 `e3b07dba31b7f5b4796e0157e93fa3e903b88d63e3f4d50fe6d1674351d833b2`.
- Índice HTTPS: SHA-256 `33166438c2db387512fe3abd4055789299e54b034114bfba2929d8390697fd44`.
- **118 archivos estáticos** publicados en `/usr/share/nginx/html`; todos sus hashes coinciden en la imagen activa y por HTTPS. Listado individual en [CLIENTES-DESPLIEGUE-HTTPS.json](CLIENTES-DESPLIEGUE-HTTPS.json).

Se publicó exclusivamente el tar ya aprobado, sin volver a compilar el workspace. La imagen nueva conserva las capas de runtime de la imagen anterior y la configuración nginx. No se incluyeron los trabajos locales ajenos. No se hizo checkout, pull ni push del repositorio de producción, cuya base permanece `c01b3ee29b7956925cf9face2ae718b88a038a05`.

Los únicos cambios funcionales de fuente son los seis declarados en [CLIENTES-ARTEFACTO.json](CLIENTES-ARTEFACTO.json): `clientLifecycle.ts`, stores `clients/contracts/installations/dashboard` y `ClientesView.vue`. Los archivos de Prospectos y sus handlers comerciales permanecen intactos. Los tres archivos que ya estaban desplegados de devoluciones se conservaron como parte de la base aprobada, sin incluir modificaciones locales adicionales.

## Revalidación y activación

1. PASS: hashes del artefacto, fuente aprobada, siete archivos de respaldo PC/VM, archivos Compose efectivos, imagen y contenedor frontend anteriores.
2. PASS: 117 archivos de la entrega anterior y contenedores protegidos sin divergencia respecto del respaldo.
3. PASS: imagen construida sin red, con el tar aprobado. Se comprobaron sus 118 archivos y nginx mediante un contenedor temporal que nunca se inició; se eliminó después de la comprobación.
4. PASS: recreación limitada a `frontend`, con `--no-deps --no-build --pull never` y override exclusivo de imagen. Backend, Caddy, Mongo y GenieACS conservan IDs, imágenes y tiempos de inicio.
5. PASS: imagen activa, archivos servidos, nginx y ausencia de errores críticos nuevos en frontend/backend. Evidencias: [activación](CLIENTES-DESPLIEGUE-ACTIVATE.json) y [verificación](CLIENTES-DESPLIEGUE-VERIFY.json).

Los scripts de activación detienen el proceso ante divergencias previas. Si una comprobación inmediata posterior a la recreación falla, restauran sólo el frontend previo y detienen la ejecución. Ese rollback automático no fue necesario.

## Datos y RLS: consultas exclusivamente de lectura

La referencia anterior era 697 abonados + 1 retirado. **Antes de activar**, a las 13:02:10 Lima, Supabase ya mostraba una ficha/servicio adicional y una alta abierta. La lectura posterior a las 13:06:32 Lima conserva los mismos valores que la inmediatamente anterior:

| Concepto | Antes | Después |
| --- | ---: | ---: |
| Fichas registradas | 699 | 699 |
| Abonados vigentes | **698** | **698** |
| Retirados definitivos | **1** | **1** |
| Titulares con servicio activo | 681 | 681 |
| Titulares suspendidos | 17 | 17 |
| Titulares con múltiples servicios | 15 | 15 |
| Altas abiertas | 1 | 1 |
| Fichas con etiqueta `prospect` | 4 | 4 |
| Prospectos comerciales separados | 3 | 3 |
| Seguimientos comerciales | 1 | 1 |

La variación respecto de la referencia ocurrió antes del despliegue. No se la atribuye al despliegue ni se afirma quién la originó: no se efectuó ninguna escritura en clientes, contratos, instalaciones o prospectos. La validación se limitó a los agregados y estados necesarios.

El clasificador del frontend coincide con el snapshot de Supabase. Los 17 suspendidos siguen vigentes; los 15 titulares con varios servicios aparecen una sola vez y conservan un servicio activo. El retirado definitivo queda excluido del contador principal. Actualmente no hay un titular con un servicio activo y otro cancelado; ese escenario conserva su prueba sintética previa, sin fabricar datos reales.

RLS conserva exactamente la huella `e8db0a0ea7e4098103d02fb0ab069ede285a18a55255cf5741e1c18e462c6dee` antes/después y desde la preparación aprobada. Se mantuvo la política preexistente amplia de Clientes: no se corrigió ni se aplicó ningún cambio de permisos. Las consultas se ejecutaron en `REPEATABLE READ READ ONLY`, con rollback final. Evidencia agregada sin identificadores de clientes: [CLIENTES-DESPLIEGUE-DATOS.json](CLIENTES-DESPLIEGUE-DATOS.json).

## HTTPS, API e interfaz

- PASS: certificado HTTPS verificado por curl, sin deshabilitar validación TLS. Rutas `/`, `/clientes`, `/clientes/prospectos`, `/soporte/instalaciones`, `/campo/mi-custodia`, `/inventario/custodia`, `/facturacion` sirven el índice nuevo exacto.
- PASS: `/api/health` responde `200` con `status: ok`; la API protegida de ranking sigue respondiendo `401` al acceso anónimo. No se invocaron comandos de OLT/MikroTik, generación de facturas ni operaciones de inventario.
- PASS: los 118 archivos públicos se descargaron por HTTPS y compararon por SHA-256, incluyendo módulos existentes.
- PASS: navegador con **bundle HTTPS real**, sesión efímera simulada y respuestas construidas del snapshot mínimo sin nombres/IDs reales. Supabase real bloqueado y todas las escrituras HTTP prohibidas. Confirmó 698 abonados, 1 retirado, filtros de 17 suspendidos y 15 titulares con varios servicios sin duplicación.
- PASS: el botón original **Prospectos**, navegación a su pantalla y el modal **+ Nuevo cliente** siguen disponibles. No se guardó ningún formulario. Reincorporar sólo abre el diálogo de preparación.

Evidencia de interfaz: [CLIENTES-DESPLIEGUE-NAVEGADOR.json](CLIENTES-DESPLIEGUE-NAVEGADOR.json). Esta prueba valida el JavaScript publicado; **no equivale a un login real de operador ni certifica persistencia de conversión en producción**. Los módulos existentes se comprobaron mediante rutas/assets, salud/autorización API y conservación de servicios, sin hacer una regresión operativa con escrituras.

## Respaldos y rollback

Respaldo verificado de la imagen previa `sha256:314269b263dcfa8987f95caf9b458e4792efc187e8aa9dc1594793c1a2a6ca2c`:

- PC: `D:\SmartRayco\scripts\inventory-auth-lab\runtime\clientes-backup-clientes-20261023T163256Z`.
- VM: `/opt/smartrayco-staging/clientes-20261023T163256Z/backup`.
- Incluye imagen OCI exacta, HTML, nginx, estado anterior, override de rollback y archivos Compose efectivos. Siete archivos verificados en ambos destinos; comprobación OCI de todos los blobs. [Manifiesto](CLIENTES-RESPALDO.json).

Comprobación sin cambios operativos:

```sh
python3 /opt/smartrayco-staging/clientes-20261023T163256Z/rollback-check.py /opt/smartrayco-staging/clientes-20261023T163256Z
```

Restauración exclusiva del frontend, si resulta necesaria:

```sh
docker load -i /opt/smartrayco-staging/clientes-20261023T163256Z/backup/frontend.image.tar
docker compose -f /opt/smartrayco/docker-compose.onprem.yml -f /opt/smartrayco-staging/custody-returns-20261022T171559Z/deploy.override.json -f /opt/smartrayco-staging/clientes-20261023T163256Z/backup/rollback.override.json up -d --no-deps --no-build --pull never frontend
```

Los comandos de restauración no se ejecutaron. Tras restaurar, comprobar imagen anterior, HTML/nginx y servicios protegidos; no hay rollback SQL porque no se cambió esquema, permisos ni datos. El restablecimiento del frontend es la única operación de recuperación contemplada.

## Pendientes funcionales y límites

- Validación por un operador con sesión real: visibilidad según su rol, búsqueda real y navegación por históricos sin guardar.
- No se prueba la persistencia de conversión ni creación de clientes/contratos en producción por la restricción de no modificar datos reales. Su flujo conserva las pruebas sintéticas aprobadas.
- SOPORTE/FACTURACION no tienen actores activos para un ensayo real de sus políticas; se conserva la validación previa de catálogo/UI.
- La reincorporación operativa sigue **sin implementar ni activar**. No activa servicios ni asigna equipos.
- Los contadores pueden cambiar por operaciones legítimas posteriores; 698/1 corresponde al snapshot fechado, no a un valor fijo programado.

No se modificaron clientes, contratos, prospectos, inventario, OLT, MikroTik, facturación ni RLS. Sin migraciones ni push. Los scripts y documentos nuevos son evidencia local del despliegue, no cambios funcionales adicionales publicados.
