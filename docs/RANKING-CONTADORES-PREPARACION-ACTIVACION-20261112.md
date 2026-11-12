# Contadores del ranking: preparación de activación

**LISTO PARA SOLICITAR AUTORIZACIÓN DE APLICACIÓN. No aplicado.**
Lectura de producción: 2026-11-12 17:02:59 UTC. La comprobación final de solo
lectura confirmó que producción conserva la definición original y las seis
funciones relacionadas permanecen iguales.

## Función y diferencias

Solo `public.technician_ranking_between(timestamptz,timestamptz)`.
La definición actual coincide con la referencia del commit `e114fb6`.

- Averías: `count(distinct job_id)` por técnico, incluyendo `other` únicamente
  desde el corte oficial de noviembre y cuando llega como contribución `work`
  de la fuente existente. Esta exige finalización técnica y confirmación
  administrativa oficial, fecha del período y cuadrilla congelada.
- Rutinas: `count(distinct job_id)` por técnico.
- Se conserva íntegro el histórico previo al corte en las pruebas. No cambian
  sumas, penalizaciones, Altas, reconexiones, reglas de reparto ni posiciones.

**Refinamiento respecto a e114fb6:** su candidata incluía cualquier categoría
distinta de reconexión. Se restringió a `other`; `billing`, `installation`,
categorías nulas o futuras no se convierten automáticamente en averías.

## Criterio real para `other`

Las categorías técnicas explícitas siguen siendo `no_service`, `slow_speed`
y `equipment` (`src/types/domain.ts:25`). En Campo, todo cierre de ticket exige
motivo de avería; el panel permite cerrar `other` sin exigirlo. La confirmación
administrativa es la regla canónica que acredita trabajo y congela los puntos;
ni un ticket abierto ni uno terminado sin confirmar entra por esta ampliación.

Se revisaron los 20 tickets `other` acreditados de noviembre: los 20 son
atenciones técnicas y tienen motivo de avería. TCK-2026-00104 corresponde a
falta de señal, motivo `defective_equipment`, resuelto y confirmado con 2 puntos.
No se añade un requisito nuevo de motivo al ranking ni se reclasifica por texto.

Comparación READ ONLY, cinco técnicos: solo varían las averías. Jadir pasa
de **0 a 10**, conservando **156,6 puntos, 17 Altas, 11 rutinas y puesto 1**.
Puntos, penalizaciones, Altas, rutinas, reconexiones y posiciones permanecen
iguales para todos. Detalle numérico y huellas en `manifest.json`.

## Respaldo, aplicación y rollback

Paquete local: `deploy/ranking-counters-20261112/`.

- `backup.sql`: definición exacta obtenida con `pg_get_functiondef`, más el
  terminador SQL; sin datos de clientes. MD5 de la definición original:
  `01290877f59ae43101b55a1a09d56691`.
- `apply.sql`: una transacción con un único `CREATE OR REPLACE FUNCTION`.
  Verifica definición, owner y ACL antes; compara rankings de día, semana,
  noviembre, octubre, semana mixta y mes actual bajo la misma instantánea.
  Comprueba el resultado esperado, OID, firma, owner, ACL, atributos, dependencias
  registradas y seis funciones relacionadas antes del COMMIT. Un error revierte.
- `rollback.sql`: restaura exactamente el respaldo en una transacción. Solo
  acepta la definición candidata conocida o la original; rechaza deriva ajena.
- `verify-readonly.sql`: huellas, permisos, funciones relacionadas, aporte del
  ticket y ranking diario/semanal/mensual, incluido el endpoint mensual antiguo.
- `manifest.json`: metadatos, dependencias, llamadores, comparación y SHA-256 de
  archivos. `.gitattributes` conserva LF para mantener las huellas y el cuerpo SQL.

**Sí, basta CREATE OR REPLACE FUNCTION**, como owner `postgres`: misma firma,
retorno, `STABLE`, `SECURITY DEFINER` y `search_path=public`. Se conservaron OID,
owner, ACL y dependencias en el ensayo; sin DROP, GRANT, REVOKE ni cambios de otras
funciones. La función interna conserva EXECUTE solo para su owner; los dos
wrappers públicos existentes mantienen sus permisos y definiciones.

## Procedimiento posterior a una autorización expresa

1. Repetir la lectura con `powershell -NoProfile -ExecutionPolicy Bypass -File
   scripts/ranking-counters-readonly.ps1 -Scope activation`. Confirmar que no hay
   deriva respecto al manifest; si la hay, detenerse y renovar la preparación.
2. Comprobar SHA-256 de los archivos según el manifest. Coordinar ausencia de
   otro cambio DDL sobre esta función. Usar una sesión SQL del owner `postgres`.
3. Ejecutar **el archivo `apply.sql` completo**, con detención ante errores
   (`ON_ERROR_STOP=1` en psql). No ejecutar `backup.sql` como procedimiento.
4. Ejecutar la verificación READ ONLY con el mismo runner y `-Scope postcheck`.
   Debe devolver `definition_matches_candidate=true`, `helpers_unchanged=true`,
   owner/ACL originales y el aporte de 2 puntos del ticket. Revisar el ranking
   de Jadir y los contadores; los totales mensuales pueden crecer por trabajo
   nuevo, por eso la igualdad de puntos se verifica dentro de la transacción.
5. Ante una anomalía posterior al COMMIT, ejecutar `rollback.sql` completo.
   Después, `-Scope postcheck` debe mostrar `definition_matches_backup=true`.
   Si un script detecta deriva, detenerse; no eliminar su protección.

## Riesgos y validación

Riesgo acotado: `other` es una categoría genérica; futuros trámites mal
clasificados y acreditados administrativamente podrían contarse. La consulta
no inventa una clasificación por descripción ni corrige datos. La preparación
excluye facturación, instalaciones y reconexiones para evitar ampliar ese riesgo.
Hay un bloqueo breve de DDL; límites de bloqueo 2 s y sentencia 30 s. Una demora,
deriva o diferencia inesperada aborta la transacción sin aplicar el reemplazo.

- Regresiones SQL/HTTP: **11 PASS, 0 fallos**, con el criterio restringido.
- Ensayo de aplicación/rollback: **6 PASS**, PostgreSQL 17 local sin red y solo
  datos sintéticos; incluye rechazo de deriva/permisos y reversión automática
  tras un fallo deliberado anterior al COMMIT.
- Verificación remota de solo lectura del procedimiento posterior: **PASS**;
  definición original presente, candidata ausente y funciones relacionadas iguales.

No se ejecutó ninguna escritura, migración, cambio de permiso o despliegue en
Supabase/producción. El generador local no tiene conexión de red; el runner
remoto fuerza transacciones READ ONLY. Este informe reemplaza el criterio amplio
de la candidata anterior para la solicitud de aplicación.
