# Devoluciones — preparación final

Fecha: 2026-10-22. Base: commit `fb56057`. Estado: preparado para revisión y autorización; NO activado. No se accedió a producción. No se ejecutaron migraciones fuera de los fixtures PostgreSQL efímeros.

## Resultado de la revisión

El candidato `scripts/prepare-custody-returns-review.sql` mantiene las firmas de dos RPC existentes. No contiene UPDATE/DELETE de solicitudes, movimientos ni saldos, ni crea tablas, índices, roles o permisos. Al aplicarse solo reemplaza `request_material_return` y `my_inventory_custody`, en una transacción con límite de espera de bloqueo de 5 s y de sentencia de 30 s. El INSERT de solicitud está dentro del cuerpo de la RPC y solo se ejecuta cuando un técnico la invoca posteriormente.

La RPC bloquea la fila de custodia propia con FOR UPDATE, valida cantidad y rechaza si ya existe una solicitud pendiente del mismo técnico/producto. Se permite como máximo una pendiente; no se suman reservas nuevas sobre reservas anteriores. La consulta de custodia añade solicitudes resueltas al resultado, sin modificar registros. CREATE OR REPLACE conserva propietario, ACL e identidad de las funciones existentes, verificado en laboratorio.

Importante: solicitar NO reserva ni descuenta material. El consumo puede reducir el saldo mientras una devolución está pendiente; el flujo de recepción existente vuelve a comprobar saldo y rechaza la recepción insuficiente, sin cambios parciales. El candidato no corrige duplicados históricos. Si el preflight encuentra duplicados o pendientes superiores al saldo, detener y revisar; no borrar ni reconciliar automáticamente.

## PASS/FAIL

| Verificación | Resultado |
| --- | --- |
| Aplicación con solicitudes previas Pendiente/Recibido/Rechazado: filas idénticas antes/después | PASS |
| Movimientos, equipos, eventos, productos y custodia sin cambios al aplicar | PASS |
| Firmas, ACL, propietario, SECURITY DEFINER y search_path conservados | PASS |
| Dos conexiones simultáneas, saldo 10, solicitudes de 7 + 7 | PASS: segunda espera un bloqueo real; una pendiente por 7 |
| Solicitud no incrementa stock ni altera custodia/movimientos | PASS |
| ADMIN y SUPERADMIN reciben material y equipo con RPC existentes | PASS |
| Confirmación de material repetida y técnico intentando confirmar | PASS: bloqueadas |
| Equipo instalado desde custodia intentando devolver | PASS: bloqueado, sin cambios |
| Material consumido: solicitar por encima del remanente o con saldo cero | PASS: bloqueado |
| Consumo posterior a solicitud: recepción superior al remanente | PASS: bloqueada, solicitud sigue pendiente |
| Respaldo con script final, lectura JSON y restauración del rollback generado | PASS en PostgreSQL aislado |
| Preflight final de solo lectura | PASS en PostgreSQL aislado |
| Rechazo de equipos serializados | LIMITACIÓN mantenida; fuera de esta preparación |
| Pruebas en producción y navegador desplegado | NO EJECUTADAS; requieren autorización |

Comandos reproducibles (Docker local requerido):

```powershell
node --import tsx --test server/tests/technicianCustody.sql.test.ts
node --import tsx --test server/tests/custodyRequiredMaterials.sql.test.ts
```

Resultados finales: suite de custodia 23/23 PASS; suite de materiales consumidos 48/48 PASS. Son totales de Node incluyendo el test padre. Los procesos PostgreSQL usan `--network none`, datos ficticios y almacenamiento temporal. Las migraciones que cargan los fixtures solo construyen ese laboratorio; no son instrucciones de activación.

Durante el ensayo inicial el rollback falló porque pg_get_functiondef no incluía separador entre funciones; se corrigió la generación añadiendo punto y coma y el rollback final pasó. No hubo fallos finales pendientes.

## Archivos de esta preparación

- `scripts/prepare-custody-returns-review.sql`: solo límites de espera; cuerpos de RPC sin cambios respecto de fb56057.
- `scripts/tests/custody-returns-backup-readonly.sql`: produce SQL de rollback de las definiciones vigentes y snapshot JSON de funciones, permisos y tablas de inventario afectadas.
- `scripts/tests/custody-returns-preflight-readonly.sql`: inventario de funciones y detección de duplicados, pendientes superiores a saldo y saldos inconsistentes. No corrige datos.
- `server/tests/technicianCustody.sql.test.ts`: concurrencia, roles, preservación de datos/permisos, respaldo y rollback.
- `server/tests/custodyRequiredMaterials.sql.test.ts`: compatibilidad del candidato con consumo trazado real del fixture.
- Este documento. No se modificaron archivos de interfaz ni trabajos ajenos en esta etapa.

## Procedimiento mínimo de activación — NO ejecutar todavía

1. Obtener autorización explícita para acceso, respaldo, cambio SQL y despliegue. Confirmar entorno objetivo e identidades. Preparar una ventana breve sin operaciones de inventario para comparar snapshots sin cambios legítimos concurrentes.
2. Construir la entrega en un checkout limpio desde la base aprobada con `fb56057` y el commit de esta preparación. No construir ni publicar desde el árbol compartido con cambios pendientes. La ruta `/campo/mi-custodia` y su enlace actuales están en cambios previos ajenos de router/layout, fuera de fb56057: comprobar que la base de despliegue ya los incluye. Si faltan, detener la activación y preparar su integración mínima separada con los responsables; no arrastrar todo el trabajo local de Mi avance ni Janet–Estiven. La ruta histórica `/campo/custodia` sigue usando la vista reutilizada.
3. Preservar el artefacto frontend realmente publicado y su identificación/hash. Ejecutar preflight con `psql -X -v ON_ERROR_STOP=1 -f scripts/tests/custody-returns-preflight-readonly.sql`, con conexión configurada de forma segura. Revisar las definiciones vigentes completas contra las esperadas, ACL, propietario y funciones de consumo/recepción. Ante deriva, detener; no reemplazar una variante desconocida.
4. Generar respaldo en rutas privadas nuevas, fuera del repositorio. No colocar credenciales en argumentos ni publicar el JSON, que contiene datos reales si se ejecuta luego contra producción:

```text
psql -X -v ON_ERROR_STOP=1 -v rollback_path=/ruta/privada/returns-fecha-rollback.sql -v snapshot_path=/ruta/privada/returns-fecha-before.json -f scripts/tests/custody-returns-backup-readonly.sql
```

Validar salida/JSON, guardar hash y copia segura. El script usa una transacción REPEATABLE READ READ ONLY. No sustituye el respaldo general de la base. Restaurar el rollback en una copia aislada del esquema objetivo antes de activar. Los paths son archivos locales del cliente psql; nunca reutilizar un nombre de respaldo existente.

5. Solo con autorización, aplicar `scripts/prepare-custody-returns-review.sql` usando psql con ON_ERROR_STOP. Ante timeout/error, la transacción debe revertirse; no reintentar a ciegas. Repetir preflight y respaldo a nombres nuevos, comprobar definiciones candidatas y que los datos/ACL coinciden con el snapshot anterior durante la ventana sin actividad. Los dos scripts de lectura quedan preparados, no ejecutados aquí contra producción.
6. Publicar únicamente el artefacto revisado. Pruebas focalizadas iniciales de solo lectura: técnico ve su custodia y el botón por ítem disponible, serie/MAC, cantidades y pendientes; ADMIN/SUPERADMIN ven la pestaña Devoluciones. Verificar errores de consola/red, aislamiento entre técnicos y carga tras volver a la pestaña. La recarga automática es por consulta cada 30 s, no realtime.
7. Verificar solicitudes, doble sesión y recepción completa en staging con datos ficticios. En producción no crear/confirmar/rechazar solicitudes de prueba con inventario real. Cualquier piloto real debe tener autorización y corresponder a una devolución física auténtica; comparar antes/después: solicitud sin aumento de almacén, confirmación disminuye custodia y libera almacén, sin doble ingreso.

## Rollback mínimo

Ante fallo, detener nuevas operaciones de devolución, guardar el diagnóstico y regresar al artefacto frontend preservado. Si corresponde revertir SQL y está autorizado, ejecutar el archivo `returns-fecha-rollback.sql` generado desde el entorno objetivo, con ON_ERROR_STOP. Restituye exactamente las dos funciones, sin restaurar tablas ni borrar solicitudes/eventos posteriores. Comparar definiciones y ACL con el snapshot previo y volver a comprobar saldos. El rollback fue ensayado con los scripts finales en el laboratorio.

El rollback devuelve también el comportamiento previo: duplica solicitudes de materiales entre sesiones si se invoca directamente y omite historial resuelto. No representa una reparación de datos. No usar las definiciones antiguas de una migración como sustituto del respaldo real.

## Riesgos y decisión

- La validación local no certifica que el esquema de producción coincida; ese es un gate obligatorio tras autorización.
- Concurrencia validada con el aislamiento habitual READ COMMITTED de las RPC. Revisar también configuraciones de rol/base y PostgREST; si las RPC usan REPEATABLE READ/SERIALIZABLE, detener y volver a evaluar antes de activar. El preflight usa REPEATABLE READ únicamente para obtener su snapshot de lectura.
- Historial de materiales sin paginación conserva el contrato JSON existente, pero aumenta su tamaño según el historial del técnico.
- Solicitudes anteriores inconsistentes permanecen intactas. La confirmación evita saldo negativo con los triggers existentes.
- Sin rechazo ni historial resuelto de equipos serializados, como se acordó.
- El empaquetado de la ruta nueva depende de integrar correctamente cambios previos, sin incluir trabajos ajenos. No existe un artefacto desplegable certificado desde este árbol compartido.

Preparación local terminada. ACTIVACIÓN DETENIDA hasta autorización del usuario. Sin push, despliegue, escrituras o pruebas destructivas en inventario real.
