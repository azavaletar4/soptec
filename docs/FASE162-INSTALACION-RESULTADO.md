# Fase 162 — instalación Cloud del 16/10/2026

**COMMIT CONFIRMADO. Cierre complementario BLOQUEADO por error SQL en una lectura posterior.**

Se ejecutaron exclusivamente las dos migraciones autorizadas, en este orden y dentro de **una sola transacción**:

1. `20261015180000_fase162_inventario_rutinas.sql`
2. `20261016020000_fase162_autorizacion_recibos.sql`

Ventana autorizada 21:03:18–21:13:18 UTC (16:03:18–16:13:18 Lima). Respuesta de COMMIT y postchecks recibida a las **21:04:29 UTC**. Trabajo Cloud detenido tras fallar una lectura complementaria y ventana cerrada a las **21:06:34 UTC**. No hubo reintentos ni otra transacción de instalación.

## Condiciones previas y ejecución

- Respaldo existente de 20:31 UTC: 38.350.028 bytes; SHA-256 `CB8B62949BF59A23556C7A69D9516CB1614D5EDDB5490B3488001662AD9A6C94`. Se reconfirmaron archivo, tamaño, hash y ACL privada antes del precheck y de la instalación. Su restauración aislada ya estaba aprobada y no se repitió. Conserva las limitaciones previamente documentadas de Storage, roles globales y claves externas.
- Lectura de 21:03:50 UTC: 37 funciones, 14 tablas, 31 políticas y enums coincidentes; Fase 162 ausente; cero stocks inválidos; ocho históricos sin cambios. Cero transacciones abiertas de otros clientes, locks de escritura relevantes y locks en espera.
- La conexión de instalación ejecutó nuevamente el gate de esquema/actividad y lo aprobó inmediatamente antes del baseline y del paquete SQL.
- Hashes originales intactos: primera migración `16a7d9a05dfb6b02ddce08051f7293a93bb246429ca8237229c81ac46748b225`; segunda `17f0c543b0742fb40d2992ea36238f807fe5b4fa13dbdb3e05a837a0b9d34f72`; paquete `898c34ab4d0c9f44960af346e380ba4bef5a7f9c6d6b49cf58c08b24f7dc9d1b`.
- Límites efectivos preparados: lock_timeout 2 s, statement_timeout 60 s, transaction_timeout 120 s. Transporte UTF-8 corregido y validador del commit `280c80f`.
- Se conservaron los registros del intento anterior y se utilizó un journal exclusivo de esta ventana. La instalación no se reintentó.

## Postchecks obligatorios: PASS

Se recibieron y validaron los cinco marcadores, en orden: gate, baseline, COMMIT, postchecks y snapshot posterior. Código del proceso 0, `success=true`, `commitConfirmed=true`.

**26/26 resultados aprobados** (25 controles y resultado final): huellas de seis funciones, SECURITY DEFINER/search_path y ACL; dispatcher y stock Fase 151; comprobantes privados; tres guards; dos triggers legacy; cuatro índices; siete FK RESTRICT validadas. Resultado final: `INSTALACION ESTRUCTURAL OK`. Huella normalizada de la RPC corregida: `7720f97852485732433b3f33495955e2`.

Snapshots anteriores/posteriores **idénticos** de productos/stock, unidades, eventos, movimientos, Rutinas, contratos vinculados y cuadrillas. Las ocho unidades indeterminadas conservan conteo y digest `9520c5ceb66b9f92edd269630b3e2946`. Las columnas nuevas se excluyen de la comparación de las filas históricas conforme al data-check aprobado. No se invocaron consumos, retiros, asignaciones ni operaciones reales para probar.

## Lectura complementaria fallida: detención

Después del COMMIT y de los postchecks obligatorios se intentó, desde otra conexión READ ONLY, una comparación adicional de catálogos legacy y del conteo de recibos. Esa consulta terminó con categoría `CONSULTA_SQL`. Se detuvieron las consultas y no se reintentó. **Su resultado no se da por aprobado, incluido el conteo adicional de recibos.**

La inspección exclusivamente local identificó un defecto del verificador adicional: usa `jsonb_array_elements` sobre colecciones `triggers` que contienen JSON null en `job_work_sessions` y `routine_returns`, según el snapshot previo. Ese caso no es un array. El diagnóstico original del servidor no se conservó, por lo que no se afirma SQLSTATE ni se atribuye el error a una función instalada. No se corrigió ni volvió a ejecutar la consulta al haberse ordenado detenerse ante errores.

El fallo de lectura **no revierte el COMMIT confirmado**. Las migraciones ya están instaladas; no volver a ejecutarlas. Queda pendiente corregir y verificar localmente esa consulta y repetir exclusivamente la comprobación complementaria por lectura antes de dar por cerrado ese apartado. No restaurar el dump ni ejecutar rollback destructivo como reacción a un error del verificador.

## Alcance, evidencia y pendientes

Evidencia estructurada: `docs/FASE162-INSTALACION-CLOUD-RESULTADO.json`, con los 26 controles, snapshots, hashes y distinción explícita del postcheck complementario fallido. Logs técnicos y journals preservados en runtime local ignorado; anteriores archivados sin borrar.

No se aplicaron otras migraciones ni se escribió el ledger `supabase_migrations` mediante operaciones adicionales: instalación SQL manual documentada por hashes. Ese ledger no debe utilizarse como motivo para reinstalar Fase 162 automáticamente. No hubo push, despliegue de frontend, operaciones de red ni DML sobre datos operativos. Los cambios de esquema/funciones/permisos corresponden exclusivamente a los dos SQL autorizados.

No se repitieron pruebas de negocio aprobadas. Frontend compatible, validación nativa/offline y cierre RLS administrativo global siguen separados y no se certifican por esta instalación. No se ejecutó rollback, revocación ni cambio de permisos adicional. La ventana está cerrada.
