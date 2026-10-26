# Validación final para activación — 25/10/2026

Actualización de continuidad: el propietario aceptó el riesgo de reapertura histórica sin cambiar esa funcionalidad. Se completó un respaldo lógico recuperable y su restauración aislada; resultados, límites y pendientes vigentes en [Riesgo aceptado y recuperación](PUNTOS-RIESGO-ACEPTADO-Y-RECUPERACION-20261025.md). El informe siguiente conserva la evidencia y el dictamen de su sesión original.

Base limpia `e644158940a3a640a5dfc940c56d02ca00921808`; GitHub consultado directamente y sin avance al preparar esta entrega. Se reutiliza el [procedimiento](PUNTOS-ACTIVACION-PROCEDIMIENTO-20261026.md), la [validación de Campo](PUNTOS-CAMPO-VALIDACION-20261025.md) y la evidencia previa. No se repitieron integración Git, las 139 pruebas anteriores ni las 87 comprobaciones de navegador ya acreditadas.

## Prueba nueva ejecutada

Comando: `node server/tests/pointAuthRest.lab.mjs`. Resultado final: **15 grupos PASS**. No son 15 pruebas físicas ni una certificación integral de Supabase.

Se utilizaron imágenes locales `postgres:17`, `supabase/gotrue:v2.197.0`, `postgrest/postgrest:v14.18` y `caddy:2`, sin descargar imágenes. Base, Auth y REST permanecieron en una red Docker interna; solo el proxy tuvo acceso desde localhost (54492/54493). Credenciales efímeras nuevas, seis cuentas ficticias y tres órdenes sintéticas. No se cargaron variables productivas ni se consultó producción. Los contenedores se detuvieron y conservaron; no se borraron datos. Configuración con secretos y resultado detallado quedan excluidos de Git en `scripts/inventory-auth-lab/runtime/points-auth-final/`; nunca publicar esa carpeta. Cada ejecución usa recursos nuevos y puertos fijos que deben estar libres.

| Comprobación nueva | Resultado |
| --- | --- |
| Instalar SQL sin cambios 180000 → 190000 → 200000 y respetar guarda de fuente | PASS |
| Crear cuenta, login real y verificar firma, sub, issuer y audience del JWT para ADMIN/SUPERADMIN/líder/ayudante/ajeno/inactivo | PASS, seis grupos |
| Avería/Alta/Rutina: líder y ayudante leen puntos; ajeno recibe null; inactivo es rechazado; técnicos no ajustan ni confirman | PASS, tres grupos |
| Avería/Alta/Rutina: ajuste ADMIN, reintento obsoleto rechazado, una auditoría, lectura actualizada; confirmación concurrente ADMIN/SUPERADMIN y reintento devuelven el mismo ID con un registro; ajuste posterior bloqueado; propietario SQL tampoco reabre ni elimina cuadrilla | PASS, tres grupos |
| Escritura directa INSERT de service_role en auditoría y confirmaciones, mediante PostgREST | Rechazada, dos grupos |

La prueba distingue la respuesta 204 de la RPC de ajuste y los contratos diferentes de orden ajena (null) y técnico inactivo (403). Durante la preparación fallaron expectativas del harness y su arranque: exposición de puertos en red interna, espera del servidor temporal PostgreSQL, expectativa HTTP uniforme y fechas históricas para ajustes. Se corrigió exclusivamente el ensayo. El rechazo «No se modifican puntos históricos de octubre» fue una protección existente, no un defecto nuevo del producto.

Para probar ajustes se emplean fechas de creación/cierre sintéticas de noviembre. Para la exclusión oficial se fija únicamente en esta base de laboratorio `confirmed_at` en octubre usando el propietario SQL: cero contribuciones en noviembre. Esto no cambia el reloj productivo ni demuestra por sí solo todos los cruces de fechas; las fronteras de creación/cierre/confirmación, corte 01/11/2026 00:00 Lima y reparto oficial conservan la evidencia SQL anterior. No se debe copiar esa modificación de fecha a producción.

## Alcance que sigue pendiente

- Este laboratorio usa Auth y PostgREST reales sobre PostgreSQL 17 con tablas/funciones basales sintéticas. **No es una instancia completa de Supabase representativa del proyecto.** Se prueban ACL de objetos nuevos y comprobaciones de identidad/autorización de las RPC; no se certifica aquí el catálogo completo de políticas RLS de tablas operativas, el backend Hono, Storage ni Realtime reales. Esos recorridos deben ejecutarse en un Supabase aislado representativo antes de activar.
- Las tres migraciones no se modificaron. Instalación/RPC real pasan. Se reutiliza el ensayo aprobado de recuperación de `86f25fa`: cinco pruebas, aborto transaccional por deriva, recuperación previa y posterior, auditoría/confirmación conservadas y reintento sin duplicación. No se repitió ni se presenta como rollback integral de Supabase. Falta respaldo productivo verificable y ensayo compatible de Auth/Storage/configuración sin perder escrituras posteriores.
- Android: `D:\Android\platform-tools\adb.exe devices -l` completó correctamente, **cero dispositivos**. No se instaló ni abrió APK. La revisión focalizada conserva los callbacks nativos de geolocalización y selección cámara/galería, y los permisos de ubicación/cámara declarados; su existencia no acredita funcionamiento físico.
- La app Flutter continúa apuntando al panel productivo. Faltan APK/entorno aislados y dispositivo para cámara/GPS reales, permisos denegados/cancelación, fotos/evidencias, segundo plano/muerte del proceso, desconexión durante subida, arranque frío offline y colas antiguas. No se declara Android validado.
- Se reutiliza la evidencia de Campo de `591df76`/`86f25fa`: puntos para líder/ayudante y refresco de crédito cada 15 segundos con pantalla visible, foco/reconexión, separación asignación/acreditación, cierre sin firma nueva y conservación histórica, IndexedDB y reintentos, solicitudes de devolución sin descuento prematuro. Cámara/GPS/Storage reales y entrega efectiva Realtime siguen pendientes; no se volvió a escribir inventario para ensayarlos.

## Dictamen y publicación

**BLOQUEADO para activar producción.** No apareció un error de producto que requiera corrección. Se agrega únicamente el ensayo focalizado y este informe, con commit específico y publicación normal autorizada, condicionada a que GitHub siga en la base y el avance sea fast-forward. Los hashes finales se informan al terminar; no se incluyen secretos ni archivos experimentales.

Para levantar el bloqueo: completar Supabase representativo y Android físico aislados; aprobar artefactos/configuración, respaldos recuperables y compatibilidad de clientes/colas; ejecutar el preflight productivo de solo lectura autorizado antes de solicitar migraciones. El orden y la contingencia permanecen en el procedimiento existente. No restaurar una copia antigua sobre datos actuales ni eliminar auditorías/confirmaciones después de uso.

Sin migraciones productivas, despliegues, órdenes/puntos reales, movimientos de inventario, contratos/facturación ni acceso OLT/MikroTik. Publicar pruebas no autoriza activar.
