# Activación controlada de baja administrativa

**PASS técnico. Módulo pendiente de confirmación visual del usuario; no se declara terminado.**

Activación frontend: `2026-10-24T05:37:24.780360Z` (00:37, Lima). Autorización expresa para la corrección **2620ed7**, exclusivamente baja administrativa y visualización comercial NAP.

## Versión publicada y alcance

- Revisión funcional: `2620ed7`, aplicada como parche aislado sobre la fuente del frontend previamente publicado. No se publicó el working tree ni se cambió el checkout productivo.
- Imagen: `sha256:51fb41c01d8412d270bcd23d84de1804eead9c74d89eb9ba4e464668db200db6`.
- Tag: `smartrayco-frontend:administrative-2620ed7-37ccd55`.
- Tar aprobado: SHA256 `37ccd55e18d5bd369b047122e39130254bc7df27cbda202ab2e842772e239ceb`.
- Archivos estáticos publicados y verificados: **118**, inventariados con hashes en `CLIENTES-BAJA-ACTIVACION-ARCHIVOS.json`.

Sólo cambian los siete archivos fuente declarados en la preparación: `napOccupancy.ts`, stores `contracts.ts`/`foFibra.ts`, `domain.ts`, `ClientDetailView.vue`, `ClientServiceDetailView.vue` y `ZonasView.vue`. Los tests/documentos no se publican como aplicación. El backend y los demás servicios conservan IDs, imágenes y tiempos de inicio; nginx y las capas anteriores del runtime frontend se conservaron.

El Git de la VM continúa en `c01b3ee29b7956925cf9face2ae718b88a038a05`, limpio: la versión efectiva se identifica por la imagen y el parche 2620ed7, no por un checkout de todo el branch local. No hubo push.

## SQL aplicado

Se aplicó **sólo** `contract-administrative-cancellation-proposal.sql` aprobado, SHA256:

```text
adac9608cf1f068673fcb715fc43d7c32d42c8bb1d6e5d5b0b08e0ce15820ba3
```

Instala tres funciones:

1. `contract_cancel_administrative(uuid,timestamptz,boolean)`.
2. `contract_administrative_guard()`.
3. `contract_administrative_installation_guard()`.

Y dos triggers de guarda correspondientes en contratos e instalaciones. Ningún UPDATE/DELETE/INSERT de registros de negocio fue ejecutado por la instalación. No se invocó una cancelación confirmada para probar.

Verificación posterior: cuerpos de las tres funciones idénticos al candidato aprobado, propietario postgres, search_path fijado y triggers habilitados. RPC SECURITY DEFINER con EXECUTE sólo para authenticated entre los roles de aplicación comprobados; anon/service_role rechazados. La RPC conserva su validación interna de perfil activo ADMIN/SUPERADMIN. Funciones trigger sin EXECUTE para authenticated/anon/service_role. Las políticas RLS existentes mantienen su huella exacta.

PostgREST reconoce la RPC: GET anónimo con UUID sintético y `p_confirm=false` rechazado con HTTP 401 y SQLSTATE `42501`, sin ejecución de negocio. Esto verifica reconocimiento/permisos, **no una cancelación real exitosa**. No se aplicó la propuesta de baja global ni coordinación OLT; `client_retire_atomic` sigue ausente.

## Comprobaciones y datos reales de solo lectura

| Comprobación | Resultado |
| --- | --- |
| Esquema, permisos, artefacto y respaldo PC/VM antes de actuar | PASS |
| Visual local del artefacto antes de instalar SQL | PASS con sesión/datos sintéticos, cero escrituras |
| Imagen preparada sin activación: runtime/nginx y assets exactos | PASS |
| Aplicación del único SQL autorizado | PASS |
| Integridad tras SQL y tras publicación | PASS, huellas exactas sin cambios |
| 118 archivos por HTTPS y dentro de imagen/contenedor | PASS |
| Rutas /clientes, /zonas, /clientes/prospectos y salud API | PASS |
| Prospectos y Nuevo cliente disponibles en bundle publicado | PASS |
| Visual del bundle HTTPS y rechazo de confirmación | PASS, datos sintéticos, cero escrituras y cero excepciones |
| Políticas RLS y permisos efectivos nuevos | PASS |
| Servicios protegidos y proyecto productivo | PASS, sin cambios ajenos |
| Confirmación visual del usuario en su sesión real | **PENDIENTE** |
| Cancelación de un contrato real | **NO EJECUTADA**, necesita autorización individual si se decide validar posteriormente |

Lecturas relevantes antes `05:35:21Z` y final `05:40:50Z`:

- Fichas: **702**.
- Contratos: **721**, incluidos **17 suspendidos** y **2 cancelados**.
- Vínculos NAP con contrato: **695**.
- Ocupación comercial por caja/contrato: **676 activos + 17 suspendidos = 693**.
- Historial NAP: **2 cancelados**, sin ocupación; sin vínculos de ocupación de estado no verificable en esta lectura.

Las huellas de todas las filas de clientes, contratos, NAP, instalaciones y facturas son idénticas entre ambas lecturas. No se alteraron los cuatro casos reales revisados ni historiales, pagos/deudas, órdenes o equipos mediante esta tarea. La instalación sólo añade definiciones; no modifica inventario ni automatiza acciones físicas.

Los scripts de revisión visual interceptan todos los accesos de datos: muestran el **bundle publicado real** con datos explícitamente sintéticos. Las capturas `BAJA-ADMIN-VISUAL-PRE.png` y `BAJA-ADMIN-VISUAL-POST.png` fueron inspeccionadas. Verde/ámbar/gris e historial se ven correctamente; la confirmación nativa tiene el texto aprobado y se descartó. Esto no sustituye la confirmación del operador con su sesión real ni certifica una cancelación productiva.

## Respaldo y rollback

Imagen anterior: `sha256:a1f9defba1bca3aa20b111bf1a2a680b649eb125b452693357d99184ce9c56f7`.

- PC: `scripts/inventory-auth-lab/runtime/contract-administrative-backup-clientes-20261024T051917Z`.
- VM: `/opt/smartrayco-staging/clientes-20261024T051917Z/backup`.
- Ocho archivos de respaldo contrastados por hash; OCI verificado (20 blobs), HTML, nginx, estado previo y tres Compose efectivos conservados.
- Override listo: `/opt/smartrayco-staging/clientes-20261024T051917Z/backup/rollback.override.json`.
- Rollback SQL preparado: `contract-administrative-cancellation-rollback.sql`, SHA256 `46971c56a90007616e38832fc49f76c2d7b78725b8fdaa56ec7b9bc0e8834bef`.

No se ejecutó rollback. Si se autoriza: pausar confirmaciones de baja, esperar transacciones en curso, verificar/cargar imagen respaldada si hiciera falta y recrear **sólo frontend** con los Compose originales registrados y el override de rollback, `--no-deps --no-build --pull never`. Mantener la acción fuera de uso mientras se retira SQL. El rollback de definiciones elimina sólo los dos triggers y tres funciones nuevos; no reactiva contratos ni restaura masivamente datos. No utilizar el guardado genérico anterior como sustituto operativo sin revisión.

## Evidencias y pendientes

- `CLIENTES-BAJA-ACTIVACION.json`: versión, alcance y estado pendiente de usuario.
- `CLIENTES-BAJA-ACTIVACION-ARCHIVOS.json`: lista de los 118 assets y siete fuentes.
- `CLIENTES-BAJA-ACTIVACION-DATOS.json`: integridad, conteos y permisos.
- `CLIENTES-BAJA-ACTIVACION-HTTPS.json`: HTTPS, rutas, API y reconocimiento/rechazo anónimo de RPC.
- `BAJA-ADMIN-VISUAL-PRE/POST.json` y capturas: comprobaciones visuales automatizadas con datos sintéticos.

No se canceló ningún contrato real ni se ejecutaron comandos OLT, MikroTik, PPPoE o TR-069. No se alteró Janet–Estiven ni se activó la automatización anterior de bajas. Sin push, cambios de backend ni migraciones adicionales. El commit funcional local sigue en 2620ed7; no se mezcló la evidencia con trabajos ajenos.

**Pendiente: confirmación visual expresa del usuario en Operaciones → Zonas y en la ficha de línea. Hasta recibirla, el módulo permanece abierto.**
