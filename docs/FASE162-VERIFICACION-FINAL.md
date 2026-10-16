# Fase 162 — verificación complementaria final

**VERIFICACIÓN COMPLETA**, sobre la instalación con COMMIT confirmado en `aa5c567`. No se volvieron a ejecutar migraciones ni los 26 postchecks aprobados.

## Causa y evidencia exacta disponible

La ejecución anterior conservó únicamente la categoría `CONSULTA_SQL`. El stderr original del servidor no fue archivado y no puede recuperarse de esos archivos. No se presenta una reproducción como si fuera el mensaje histórico recuperado.

La consulta fallida conservada aplicaba `jsonb_array_elements(b->'triggers')` sin distinguir JSON null. El snapshot aprobado contiene `triggers: null` para `job_work_sessions` y `routine_returns`. **JSON null es un escalar, no un array ni SQL NULL.**

En PostgreSQL aislado, la expresión original reproduce exactamente **SQLSTATE 22023, `cannot extract elements from a scalar`**. La consulta corregida pasa contra los mismos metadatos sintéticos y posteriormente contra Cloud. La causa comprobada es del verificador local, no de los objetos de Fase 162. No se modificó ninguna RPC, trigger, política o dato remoto para resolverla.

## Corrección mínima y pruebas

Las colecciones del verificador usan ahora `coalesce(nullif(valor,'null'::jsonb),'[]'::jsonb)` antes de expandirlas. Esto convierte exclusivamente JSON null/SQL NULL en un conjunto vacío; los objetos o escalares inesperados siguen provocando rechazo. No se oculta la desaparición de un trigger exigido por el baseline. Se añadieron comprobaciones de conteo de tablas y funciones para que los INNER JOIN no oculten objetos ausentes.

**8/8 pruebas nuevas**, PostgreSQL efímero con `--network none`, sin puertos, volúmenes persistentes ni datos operativos:

1. La consulta original reproduce el error 22023.
2. La corregida acepta JSON null y arrays vacíos.
3. Detecta un índice previo eliminado.
4. Detecta una columna previa cambiada.
5. Detecta un trigger requerido eliminado, aunque la colección quede null.
6. Detecta una tabla faltante.
7. Detecta una función faltante.
8. Rechaza metadatos de tipo objeto inesperado.

El contenedor se eliminó al finalizar. Evidencia: `FASE162-COMPLEMENTARIA-PRUEBAS.json`.

## Comprobación focalizada en Cloud

Una sola ejecución de la consulta corregida, a las **2026-10-16 21:11:23 UTC (16:11:23 Lima)**. TLS verify-full, conexión default_transaction_read_only=on, BEGIN READ ONLY, statement_timeout 10 s y lock_timeout 2 s. Solo catálogos y conteo de la nueva tabla de recibos. No hubo invocaciones de negocio ni cambios de rol para simular técnicos.

**11/11 comprobaciones aprobadas:** READ ONLY, presencia de `routine_inventory_operation(uuid,uuid,text,jsonb)`, conteos legacy de tablas y funciones, columnas, constraints, índices, triggers, políticas, RLS/ACL de tablas y definiciones/ACL de funciones. La modificación autorizada del dispatcher `apply_inventory_unit_event()` se excluye únicamente del cotejo con su cuerpo anterior; su huella instalada ya estaba aprobada en los 26 postchecks y no se repitió esa prueba. Las demás definiciones siguen coincidiendo con el baseline aprobado.

**Recibos existentes: 0** al momento de la lectura. Es una observación, no una prueba de consumo o idempotencia en producción. La respuesta cruda tiene SHA-256 `9415bc7ab147d48439d2ec1d44b3e380a9f49a2c4b79708aa5aa965fb29bfc9c` y está preservada en runtime local. Evidencia resumida: `FASE162-VERIFICACION-COMPLEMENTARIA.json`.

Con esta lectura se resuelve el bloqueo complementario documentado en `FASE162-INSTALACION-RESULTADO.md`. Se confirma la instalación persistente y compatibilidad estructural de base de datos, usando además los 26 postchecks previos aprobados; no se afirma una prueba funcional nueva sobre inventario real.

## Archivos y reproducción

- `scripts/tests/fase162-complementary-read.sql`: consulta complementaria corregida, sin DDL/DML.
- `scripts/tests/fase162-complementary-read.test.cjs`: reproducción y regresiones focalizadas.
- `scripts/verificar-fase162-complementaria.cjs`: prepara el SELECT y verifica resultados con las capturas aprobadas; no conecta a Cloud.
- `scripts/verificar-fase162-complementaria.ps1`: transporte READ ONLY existente reutilizado. Guarda además stderr técnico en runtime ignorado para no volver a perder diagnóstico; no imprime credenciales ni errores originales.
- Los dos JSON de evidencia y este documento.

Comandos utilizados:

```powershell
node scripts/tests/fase162-complementary-read.test.cjs
node scripts/verificar-fase162-complementaria.cjs --prepare
powershell -NoProfile -File scripts/verificar-fase162-complementaria.ps1
node scripts/verificar-fase162-complementaria.cjs --verify
```

La consulta original fallida se conserva como archivo de evidencia local, sin sobrescribirla con la corrección. No se repitió su ejecución en Cloud.

## Riesgos pendientes y alcance

No queda pendiente el error SQL del verificador. Siguen fuera de esta comprobación el despliegue del frontend, la validación nativa/offline y el cierre RLS administrativo global. El ledger de migraciones no fue modificado; no debe provocar una reinstalación automática de Fase 162. No se realizaron pruebas funcionales con datos reales.

Sin nuevas migraciones, cambios de datos/RLS/funciones, push, despliegue ni nuevas fases. La ventana de instalación sigue cerrada; esta actuación utilizó exclusivamente la autorización de lectura y trabajo local.
