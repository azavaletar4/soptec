# Fase 162: deadlock corregido — LISTO PARA REVISIÓN LOCAL

16/10/2026. Continúa `7e6abd5` y `FASE162-INSTALACION-PREPARADA.md`.
No es autorización de instalación ni aprobación del cierre RLS administrativo.

## Causa y cambio mínimo

La RPC retenía la Rutina y esperaba `FOR UPDATE` sobre la cuadrilla. El DELETE
legacy retenía la asignación y su trigger real `lock_job_crew_parent` esperaba
esa Rutina: ciclo padre↔hijo, SQLSTATE `40P01`.

La segunda migración ahora toma **solo la asignación propia** con
`FOR SHARE NOWAIT`, exigiendo rol leader/support. Si DELETE/UPDATE la retiene,
`55P03` aborta la RPC sin publicar recibos ni confirmar movimientos. No espera
al hijo mientras retiene al padre. Si la RPC obtiene SHARE primero, DELETE
debe esperar su COMMIT; una vez confirmada la retirada, la próxima llamada
encuentra la asignación ausente y deniega recibos y movimientos nuevos.

No se cambiaron triggers, reglas de cuadrilla, roles de oficina, estados,
funciones de saldo, cuerpos de escritura ni migración original Fase 162.
Se conserva autorización anterior al retorno de recibos y el reintento tras
cierre para técnicos activos que siguen asignados.

El helper frontend conserva el UUID pendiente ante 55P03 y muestra:
«Hay otra operación en curso sobre esta rutina. Reintenta la operación pendiente
de forma segura». Una recuperación ya pendiente también conserva su UUID ante
una denegación posterior: ese error no revierte un posible COMMIT anterior con
respuesta perdida. Así, si recupera autorización, pide el recibo original y no
consume otra vez. Una petición nueva rechazada por SQL sigue limpiándose como
antes; un pendiente no resoluble requiere revisión administrativa, no un UUID
nuevo ni un borrado automático.

## Pruebas afectadas, sin Cloud

Se reutilizaron las capturas previas de políticas/triggers/helpers, sin nuevas
consultas Cloud ni auditoría. Contenedores PG17 efímeros sin red ni puertos,
con roles SQL y `auth.uid()` ficticios; no se simulan como JWT reales.

`node scripts/tests/fase162-installation-compatibility.cjs`: **9/9 grupos**:

1. Reproducción de 7e6abd5: `40P01`, inventario intacto.
2. Parche, postchecks y comparación de tablas/políticas/otras funciones.
3. Misma carrera de recibo: `55P03` y retirada confirmada, sin deadlock.
4. Tras retirada: recibo anterior y operación nueva denegados sin datos.
5. Operación nueva en carrera: rollback sin recibo; reintento revocado denegado.
6. Dos sesiones del mismo UUID y repetición tras respuesta descartada: un consumo.
7. RPC autorizada primero: DELETE espera COMMIT; después el recibo se deniega.
8. DELETE primero: RPC espera al padre y luego deniega, sin consumo posterior.
9. Apoyo autorizado y recibo estable; stock y Kardex 97, tres consumos y tres
   recibos; unidades/eventos, otras funciones y políticas intactos.

Se observan barreras mediante pg_stat_activity; pausa deliberada de 1,5 s,
deadlock_timeout 100 ms y statement_timeout 6 s. El baseline tardó 1766 ms y
falló con 40P01; los casos NOWAIT 1654–1655 ms incluyendo esa pausa, con 55P03;
las sesiones de retirada confirmaron sin error. No hubo timeout en esos casos.

`node scripts/tests/fase162-installation-compatibility.cjs --bundle-only`:
**2/2 grupos**. Instalación de ambas migraciones actuales en una única
transacción, diez tablas previas y ocho históricos ficticios idénticos,
políticas intactas, cero recibos nuevos y postchecks aprobados.

`node --import tsx --test src/lib/__tests__/routineInventoryRequest.test.ts`:
**3/3** del helper directamente modificado: respuesta perdida→55P03→revocación→
recuperación con el mismo UUID/un solo commit, rechazo SQL inicial y fallo de
persistencia. `vue-tsc -p tsconfig.app.json --noEmit`: aprobado.

Primer intento del ensayo: el PostgreSQL temporal aceptó conexiones por socket
durante su inicialización y reinició antes de cargar la fixture. Se corrigió
la espera usando TCP loopback interno. Ese intento no ejecutó pruebas de
negocio; no fue un fallo de la corrección ni acceso a datos reales.

Evidencia: `FASE162-DEADLOCK-CORRECCION-ENSAYO.json` y
`FASE162-DEADLOCK-INSTALACION-ENSAYO.json`. El resultado bloqueado anterior se
conserva en `FASE162-INSTALACION-ENSAYO.json`. No se repitieron suites completas
de Rutinas, Campo, búsqueda, JWT o Realtime.

## Procedimiento vigente de instalación: dos migraciones, una transacción

**Preparado, no ejecutado.** Usar exclusivamente los contenidos de este commit:

1. `20261015180000_fase162_inventario_rutinas.sql` original, SHA-256
   `16a7d9a05dfb6b02ddce08051f7293a93bb246429ca8237229c81ac46748b225`.
2. `20261016020000_fase162_autorizacion_recibos.sql` actualizada, SHA-256
   `17f0c543b0742fb40d2992ea36238f807fe5b4fa13dbdb3e05a837a0b9d34f72`.

Ambas dentro de un único BEGIN/COMMIT, retirando solo sus BEGIN/COMMIT externos,
con lock_timeout 2 s y statement_timeout 60 s. Nunca confirmar primero la RPC
original sin corregir. El artefacto ensayado se conserva en
`scripts/inventory-auth-lab/runtime/fase162-installation-bundle.sql`, SHA-256
`898c34ab4d0c9f44960af346e380ba4bef5a7f9c6d6b49cf58c08b24f7dc9d1b`.
El modo `--bundle-only` lo reconstruye y valida solo instalación/postchecks.

Antes de pedir aplicar: respaldo actualizado y restauración aislada verificados
mediante el procedimiento privado existente, responsables y ventana sin
escrituras acordados, y contraste acotado de dependencias si Cloud cambió. Las
guardas deben coincidir: Fase 151 y RPC base Fase 162; no relajar huellas ni
reinstalar Fases 151/161 ni aplicar todo el directorio. No aplicar la segunda
migración sola si falta la primera o sobre la RPC del parche anterior.

Después de una aplicación futura autorizada: ejecutar el postcheck actualizado
`scripts/tests/fase162-installation-postcheck.sql` (huella RPC
`7720f97852485732433b3f33495955e2`) y comparar antes/después el resultado de
`fase162-installation-data-check.sql` durante la ventana. Ocho históricos,
saldos, contratos y órdenes deben permanecer iguales. No probar consumos reales.
Frontend compatible se autoriza por separado; no desplegar todo HEAD para eso.

## Rollback y riesgos pendientes

- Error durante instalación: ROLLBACK de ambas migraciones, sin frontend nuevo.
- Fallo antes de habilitar uso: mantener frontend anterior y no habilitar RPC;
  conservar evidencia, sin reejecutar migraciones a ciegas.
- Tras uso real: congelar operaciones; con autorización, revocar EXECUTE de la
  RPC a authenticated y coordinar atención de oficina, que también quedaría
  bloqueada. Conservar columnas, recibos, guards y Kardex. No DROP, no restituir
  saldos ni cambiar al dispatcher viejo con equipos de Rutinas vinculados.
- Respaldo actualizado y ventana de instalación siguen pendientes. El fixture
  no clona todos los grants y constraints externos de Cloud: valida esta carrera
  con sus definiciones capturadas. No se declara cobertura de toda concurrencia
  del sistema ni carga de flota.
- Flutter físico/arranque offline documentados y el cierre RLS administrativo
  global siguen separados. El laboratorio Auth anterior quedó intacto.

Solo corrección local, pruebas y procedimiento. Sin Cloud DDL/DML, permisos
remotos, datos reales, ocho equipos históricos reales, push ni despliegue.
