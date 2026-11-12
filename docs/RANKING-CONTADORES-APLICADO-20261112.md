# Contadores de ranking: aplicación autorizada

**Estado de producción: APLICADO Y VERIFICADO.**
Aplicación finalizada el 2026-11-12 a las 12:18:09 de Perú (17:18:09 UTC).
Verificación posterior: 12:18:27 de Perú. No se ejecutó rollback.

## Cambio ejecutado

Se ejecutó exclusivamente `deploy/ranking-counters-20261112/apply.sql`, íntegro,
del commit de preparación `37cf0ec5d97c42d98835b5fa09aa3f928de8032d`.
SHA-256: `8e2dfeb15ff2debd6ecf28d8077751daca6926ec29cc5b0a21bbefdd621b6990`.
La definición previa coincidió exactamente con la utilizada en las pruebas y
con el respaldo. Todas las guardas del script pasaron antes del COMMIT; psql
terminó con código 0.

Única función modificada:
`public.technician_ranking_between(timestamptz,timestamptz)`.
Se usó CREATE OR REPLACE FUNCTION. Se conservaron firma, retorno, OID 23553,
propietario `postgres`, ACL, atributos y dependencias. Las seis funciones
relacionadas conservaron exactamente sus definiciones y metadatos.

MD5 de definición anterior: `01290877f59ae43101b55a1a09d56691`.
MD5 de definición activa: `95d53cc0d5275132dae320fcf127a5fc`.

## Resultado verificado mediante solo lectura

- TCK-2026-00104: `resolved`, categoría `other`, una contribución de trabajo para
  Jadir Zavaleta, contabilizada como **una avería**, con **2 puntos** intactos.
- Noviembre de Jadir: averías **0 → 10**, rutinas **11**, Altas **17**, puntos
  **156,6**, puesto **1**.
- Los contadores de averías y rutinas de los cinco técnicos coinciden con sus
  órdenes distintas. **Cero aportes de trabajo duplicados** en la lectura de noviembre.
- Puntos, penalizaciones, Altas, reconexiones y posiciones iguales antes/después
  para los cinco técnicos. También se comprobaron día, semana, mes y la consulta
  mensual antigua.
- El script protegido comprobó además octubre, la semana que cruza el corte y
  el mes actual, comparando antes/después dentro de la misma transacción.

La evidencia resumida sin datos de clientes está en
`docs/RANKING-CONTADORES-APLICADO-20261112.json`. La verificación reproducible
local es `node scripts/tests/verify-ranking-counters-applied.mjs`; no abre red.

## Respaldo y rollback

- Respaldo conservado: `deploy/ranking-counters-20261112/backup.sql`.
- SHA-256 del respaldo:
  `904979865db3078ba75ab17d716f8ac638c7126968ca26e1f6270cfdb7502464`.
- Copia inmediata previa, verificada con la misma huella:
  `scripts/inventory-auth-lab/runtime/ranking-counters-backup-before-20261112T171806438Z.sql`.
- Rollback exacto disponible: `deploy/ranking-counters-20261112/rollback.sql`;
  conserva sus guardas contra deriva y **no fue ejecutado**.
- El preflight archivado y el log de aplicación quedan en el directorio privado
  ignorado por Git `scripts/inventory-auth-lab/runtime/`, con el sufijo
  `20261112T171806438Z`. No se guardan credenciales en los informes.

No se modificaron órdenes, clientes ni datos de negocio. No hubo migraciones
generales, `supabase db push`, cambios de otras funciones, permisos ni despliegues
de frontend/backend. El paquete SQL aprobado permanece sin modificaciones.
Los cambios preexistentes de otras tareas quedan fuera del commit de evidencia.
