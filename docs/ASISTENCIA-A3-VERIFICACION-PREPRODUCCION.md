# A3 — verificación focalizada previa a producción

**Resultado: APTO para activación selectiva controlada**, una vez autorizada y
completados los respaldos específicos de A3. Candidato `71944f5`, rama
`feature/asistencia-a3-local`. Consulta productiva: 27/10/2026 03:28–03:30 UTC
(26/10, 22:28–22:30 Perú). Sin cambios funcionales, pruebas repetidas, push,
migraciones ni despliegues. Solo lecturas; SQL con `transaction_read_only=on`.

## Comprobaciones

- Todas las tablas requeridas A0/A1/A2/A2.1 existen; RLS vigente habilitada.
  Las nueve funciones examinadas coinciden con las fuentes locales desplegadas
  mediante MD5 de cuerpos normalizados sin espacios: rol, auditoría, historial,
  novedades crear/cancelar y las cuatro RPC de marcación. A3 aún no está aplicada.
- La migración A3 agrega tabla/RPC/guards; conserva marcaciones y no escribe
  `asistencia_horarios_personales`. El rollback restaura el ingreso A2.1 exacto,
  también coincidente con producción. No exige modificar backend.
- Lunes libre y domingo trabajado: revisión de integración y evidencia ya aprobada
  de 11 escenarios SQL, 5 navegador y 3 unitarios. El reporte retira el lunes del
  calendario obligatorio y añade el domingo; el ingreso dominical solo se habilita
  para su titular y usa su horario compensatorio. Almuerzo/salida reutilizados.
  Sin cambios relevantes en ese código: no se repitieron suites ni build.
- Horarios productivos confirmados: Alhely Lozano, sábado mañana 08:00–13:30;
  Angie Laguna, sábado tarde 13:30–19:00. A3 no modifica estas filas.
- Tabla A3: lectura propia para ADMIN/TECNICO_RED y total SUPERADMIN, sin DML
  directo del usuario. Crear/cancelar verifica SUPERADMIN dentro de la RPC;
  SUPERADMIN sigue exento como trabajador. El resumen administrativo permite
  SUPERADMIN/ADMIN consultar calendario multiusuario sin motivos privados,
  necesario para el tablero, siguiendo A1/A2; TECNICO_RED no accede a ese resumen.

## Estado productivo comprobado

- Frontend: `smartrayco-asistencia-a2-full:7ed8dcd-20261027T000500Z`,
  imagen `sha256:afb272698444096271026ff940615a8d66fa1d367b094f1182861a99e9f4418e`.
- Backend: `smartrayco-backend-counters:16831c6-20261026T162650Z`,
  imagen `sha256:6631d4a124b631f7bedd3d8c2b6f6c8ab7e524e264385ae2fae2b46e3f67047e`;
  contenedor `cd577bcaa95cab290bfa2baa7d754a97a516dab94a0aa79af5db6cb34bccf154`,
  `StartedAt=2026-10-26T20:44:49.856235867Z`. Ambos servicios corriendo.
- Cadena efectiva vigente: base `/opt/smartrayco/docker-compose.onprem.yml`,
  override backend de Fase 175 y override frontend A2-full. Todos existen;
  `docker compose config` resuelve las dos imágenes exactas anteriores.
- Advertencia concreta: las etiquetas del contenedor backend todavía incluyen
  un override frontend A0/A1 antiguo. No utilizar esa cadena antigua para A3;
  partir de la cadena vigente del frontend. Conservar ID/imagen/StartedAt backend.
- Existe el archivo de recuperación previo de A2-full (27.962.880 bytes),
  documentado como imagen anterior `070c777`; no es el nuevo respaldo requerido
  de la imagen ACTUAL A2/A2.1 para revertir A3. No se verificó su contenido ni
  se creó un respaldo remoto nuevo en esta revisión.

## Activación selectiva, únicamente después de autorización

1. Revalidar ausencia de drift y capturar respaldo específico: imagen frontend
   activa A2-full en tar y tag recuperable, manifiesto de hashes, Compose/overrides,
   definición SQL/ACL/triggers y datos de Asistencia afectados. Copia verificable
   fuera de la VM. No reutilizar el respaldo antiguo hacia `070c777` como base A3.
2. Preparar frontend desde `71944f5`, que conserva la base productiva `7ed8dcd`;
   diff de aplicación limitado a cinco archivos de Asistencia, incluida su prueba
   unitaria. Construir candidato frontend únicamente y verificarlo antes de promover.
3. Orden SQL: A0/A1 `20261027010000`, A2 `20261028000000`, A2.1 `20261028010000`
   ya existentes; aplicar solo A3 `20261029000000_asistencia_a3_intercambios.sql`.
   No ejecutar un push masivo de migraciones ni reaplicar las fases cerradas.
4. Agregar un override NUEVO que solo cambie `services.frontend.image`; conservar
   los tres archivos actuales y validar configuración efectiva antes de promover:

```sh
docker compose \
  -f /opt/smartrayco/docker-compose.onprem.yml \
  -f /opt/smartrayco-staging/fase175-counters-16831c6-20261026T162650Z/backend.override.json \
  -f /opt/smartrayco-staging/asistencia-a2-full-20261027T000500Z/frontend.override.json \
  -f <stage-A3>/frontend.override.json config --format json
# Solo tras verificar imágenes/entorno; misma cadena completa:
docker compose <los mismos cuatro -f> up -d --no-build --no-deps frontend
```

5. Verificar API/panel y assets A3; backend con mismo ID/imagen/StartedAt y
   overrides íntegros. No usar despliegue completo desde main ni reconstruir
   backend. Confirmar SQL/RLS sin crear intercambios ficticios en producción;
   validación operativa real A3 queda posterior, con programación legítima.

## Reversión y límites

`scripts/sql/asistencia-a3-rollback.sql` solo admite tabla sin intercambios,
incluso cancelados. Con cero filas: pausar programación y sesiones concurrentes,
restaurar frontend A2-full desde respaldo nuevo y ejecutar rollback SQL; conserva
estructura/auditoría y requiere reactivación específica si se retoma A3.
Con cualquier intercambio real: detener reversión genérica, conservar A3 y
preparar recuperación específica; un frontend anterior ignoraría descansos y
compensaciones históricos. No borrar registros para forzar el rollback.

Evidencia local: `ASISTENCIA-A3-PREFLIGHT-CLOUD.json` y
`ASISTENCIA-A3-PREFLIGHT-VM.json`. Las consultas auxiliares quedan locales sin
commit; `HEAD` sigue en `71944f5`. El directorio principal no fue modificado.
