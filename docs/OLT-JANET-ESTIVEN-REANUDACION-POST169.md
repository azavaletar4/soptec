# Janet / Estiven: preparación retomada después de Fase 169

**Preparación PASS; activación NO ejecutada.** No se ejecutaron migraciones,
conciliación, push, despliegues, reinicios ni comandos físicos OLT/MikroTik.
Solo lecturas de producción y creación/verificación de respaldos privados.

## Candidato y compatibilidad

- Reutilizado íntegro: `1da360de999fad64ac0a82a5be170c3812bdc6c6`, sobre
  `6c5579c9a8ff65e3f2f50f6843ceb0d573a33e9f`. Los 43 hashes originales
  verificados; `e358599` era cierre documental, no otro candidato funcional.
- Nueva integración SIN COMMIT en
  `D:/smartrayco-fase168/revision-olt-janet-estiven`, base detached
  `b201183d9324a855f72ee2e2c8cae8ba9ab45edf`. Aplicación del delta aprobado
  sin conflictos. Fases 166/167/169 conservadas; 168 permanece en su historia.
  Las diferencias de fin de línea Windows se cotejaron normalizando CRLF.
- origin/main comprobado en `b201183`; producción limpia en `3cf2596`.
  La única diferencia entre ambos es ESTADO_DESARROLLO.md. No desplegar el
  antiguo candidato sobre su base 44c2adb, pues perdería los cambios posteriores.
- La expansión y los scripts de conciliación son los mismos aprobados.
  No ejecutar db push global: sus versiones son anteriores a las últimas
  migraciones ya instaladas y solo deben aplicarse por nombre exacto.

## Identidades y esquema: lectura actual

Captura Cloud REPEATABLE READ READ ONLY con TLS verify-full, DPAPI por stdin,
sin secretos en argv/log/Git. Evidencia en `preflight.private.json` del respaldo.

| Fila | Resultado actual | Acción futura preparada |
|---|---|---|
| MSTC8CCE647E / a1f0b671-a1e2-482c-b24e-7e584bf0e4ed | 1/2/8:3, cliente/contrato NULL | Solo retired_at; preservar identidad e historial |
| HWTCDEB847B6 / 74d586e3-3a0a-40c2-aba3-46294adcf095 | Janet, 1/2/8:50, cliente a563d740-a060-417e-852a-5153edeefb18, contrato cb2ee4ae-3301-44cc-b44c-939cca819e3b | No modificar |
| HWTCE5C94DB6 / nuevo UUID 76701eb5-405e-462f-862d-384a469cadac | Aún no existe como ONT; unidad f4c174ef-9136-4ee6-83e7-4082d8a47140 asignada, serial inventario 48575443E5C94DB6 | Insertar fila independiente para Estiven, cliente 3f01013e-ad20-44bb-ad15-443416e14d63, contrato 91f25111-758a-4f5a-9b79-196065509cde |

Clientes/contratos esperados activos; sin divergencias de identidad/vínculos.
retired_at y guard ausentes; UNIQUE original presente; índices parciales
ausentes; cero duplicados por OLT/serial normalizado o posición. Ledger sin
20261021170000/20261021171000 y con 166/167/169 instaladas. Los dos lectores
SQL afectados conservan cuerpo, propietario y estructura esperados.
Funciones 166/167: MD5 normalizados 4201e9cb13b8b93d2ae80a0cc44035c2 y
e452ec213962f70d8db289ac17ed361f; función 169: MD5 prosrc
f9b1fea0855798d6dcf7ef9392d21903.

La identidad física HWTCE5C94DB6 en 1/2/8:3 y Janet en 1/2/8:50 sigue siendo
la evidencia directa previamente aprobada; no se repitió el escaneo OLT.
Su vigencia debe reconfirmarse con lectura acotada inmediatamente antes de
la conciliación, no se afirma una lectura física nueva en esta preparación.

## Bloqueo ACL corregido

El intento anterior de expansión abortó antes del COMMIT porque
exact_expected_permissions comparó como texto los mismos aclitem en distinto
orden. El rollback transaccional anterior sigue confirmado; no se reintentó.

Ahora `scripts/sql/olt-catalog-acl-canonical.sql` interpreta los arrays con
el tipo aclitem[] y aclexplode de PostgreSQL y ordena por otorgante,
beneficiario, privilegio y grant option. Conserva PUBLIC, distingue NULL de
ACL vacía y aborta ante ACL inválida. Los demás campos JSON y el orden de
arrays ajenos a ACL se conservan. No se relajan privilegios ni guardas.

`scripts/olt-janet-estiven/finalize-expansion.cjs` sustituye únicamente la
comparación de permisos por esta forma canónica y exige configuración nueva
explícita. El helper vive en pg_temp dentro de la transacción; no cambia
funciones persistentes ni concesiones. Los SQL de ambas migraciones siguen
intactos. El lanzador generado apunta al config nuevo y no al intento anterior.

Wrapper revisable: `scripts/olt-janet-estiven/execution/apply-guarded.sql`.
Controles: catálogo previo exacto, filas ONT y guardas de negocio intactas,
UNIQUE original conservada, índices activos ausentes, cuerpos SQL previstos,
ACL semánticamente exactas y única entrada de expansión en ledger con hash
exacto de fuente, todo antes del COMMIT. No ejecutar el viejo
olt-stage2-apply.cjs: aún tiene referencias/SHA y respaldos de la sesión anterior.

## Pruebas focalizadas

| Verificación | Resultado |
|---|---|
| Comparador real PostgreSQL, ambos órdenes del incidente; permisos ausentes/adicionales, PUBLIC, otorgante, grant option, ACL vacía/NULL/inválida y metadatos ajenos | 12/12 PASS |
| Migraciones, conciliación específica, rollback, identidad, fallos atómicos, rutas, caché y alertas | 26/26 PASS |
| vue-tsc y build de integración sobre Fase 169 | PASS; advertencia habitual de tamaño de chunks |
| Restauración fresca, red none | 68 tablas, 108 funciones, 80 triggers, 79 políticas RLS; 0 errores pg_restore |
| Expansión sobre restauración actual y wrapper corregido con COMMIT LOCAL | PASS; 12 controles devuelven 1, errores SQL vacíos |
| Integridad candidato original | 43/43 hashes PASS |

Los casos de alertas prueban que una retirada invalida caché online y no se
proyecta como activa; mantienen evento/fecha/detalle y no sustituyen identidad
por la nueva ONT de la misma posición. En producción todavía no está desplegada
esa corrección: validación de pantalla real y Android queda pendiente.
No se repitieron auditorías generales ni suites ajenas. Persisten los cuatro
diagnósticos de tipos backend ya documentados; no se declara limpio ese gate
global ni se corrigen archivos ajenos.

Incidencias solo locales preservadas: caso ACL vacía requirió evitar
aclexplode sobre array de dimensión cero; ensayo de restauración se detuvo
por nombre de base local en una llamada añadida, corregido antes del ensayo
definitivo en otra carpeta. No hubo error ni rollback nuevo en producción.

## Respaldo doble y recuperación

Nuevo respaldo: `olt_janet_estiven_20261022_024040_47b5a5ac`.

- PC: `C:/Users/USER/AppData/Local/SmartRaycoBackups/olt_janet_estiven_20261022_024040_47b5a5ac`.
- VM: `/root/smartrayco-backups/olt_janet_estiven_20261022_024040_47b5a5ac`.
- 88 archivos por copia, SHA-256 cotejados tras transferencia; permisos PC
  usuario+SYSTEM y VM directorios 700/archivos 600. Respaldos previos intactos.
- Dump completo snapshot 2026-10-22T02:41:53.064238Z, roles sin contraseñas,
  captura selectiva y catálogo, evidencia de restauración, scripts de rollback,
  imágenes actuales frontend/backend y configuración privada.
- Dump SHA-256: `25da5d67a696ec7c36d6c2cfc471c783c6f0ef32e2e7bb2a9f26c2c4e8773a6f`.
- Manifiesto SHA-256: `1bb0473e4102532af7e9ebaac793850af452250660fae547a5c4beca405b1d53`.
- Evidencia definitiva del wrapper: `restore-verify-20261022_040652`.
  Sin errores pg_restore/expansión; roles de plataforma tienen las limitaciones
  ya documentadas del restore aislado. No se certifica réplica de privilegios
  de administración propios de Supabase ni backup de blobs Storage.
- Archivo de imágenes íntegro: 2 imágenes y 31 blobs SHA256 verificados.
  No se arrancaron esas imágenes con configuración productiva en laboratorio.
  Configuración con secretos solo en archivo protegido; nunca imprimirla.

Rollback compatible, probado con fixtures: antes de retiradas, contract-down
(solo si se aplicó unicidad parcial), aplicación anterior y expand-down en el
orden documentado. Con expansión sola y UNIQUE original, omitir contract-down.
Después de la conciliación, mantener esquema/aplicación compatibles y usar
solo compensación autorizada: `olt-janet-estiven-reconcile-rollback.sql`
retira también la fila nueva, preserva ambos UUID, vínculos e historiales y
no reactiva MSTC ni toca equipos. La aplicación queda sin fila activa de
Estiven hasta otra corrección autorizada; el servicio físico no cambia.
No volver a imágenes productivas 3cf2596 que ignoren retired_at tras reutilizar
la posición. No restaurar tablas completas ni borrar historias para bajar esquema.

## Secuencia mínima futura: requiere autorización nueva

1. Revalidar SHA productivo/remoto, identidades/vínculos, hashes, duplicados,
   operaciones en vuelo y respaldo fresco. Regenerar los snapshots/guardas del
   wrapper si cambian; no ejecutar wrappers de otra ventana por comodidad.
2. Aplicar solo expansión 20261021170000 con wrapper corregido y ledger
   transaccional; comprobar columna/guardas/lectores/permisos, sin retirar filas.
3. Publicar normalmente una revisión nueva de la integración sobre main actual
   y desplegar backend/frontend compatibles, preservando configuración, volumen
   y checkpoint OLT. Resolver el gate de tipos exigido por la publicación.
4. Confirmar todos los lectores/escritores compatibles; aplicar únicamente
   20261021171000 con smartrayco.olt_retirement_application_ready=v1, registrando
   la versión exacta. No arrastrar migraciones previas ni pendientes ajenas.
5. Lectura física puntual nueva, captura selectiva nueva PC+VM y coordinación
   sin comandos/aprovisionamiento/perfiles OLT o MikroTik en vuelo. No pausar
   servicios/schedulers sin autorización. En sesión autorizada fijar
   smartrayco.approve_ont_reconciliation=janet-estiven-v1 y ejecutar el SQL
   candidato exacto: MSTC retirada, Estiven UUID independiente, Janet intacta.
6. Solo lectura: activo HWTCE5C94DB6 en 1/2/8:3, MSTC solo historial, Janet
   sin cambios, alertas/operaciones y guardas protegidas intactas. Refrescar
   pantallas y esperar telemetría normal; sin Eliminar, importación o sync
   forzada, ni cambios físicos de VLAN/plan/PPPoE para validar.

Esta entrega se detiene antes de modificar producción. No constituye
autorización para ejecutar ninguno de los pasos anteriores.
