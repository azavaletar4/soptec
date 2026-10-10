# Continuidad de SmartRayco

**Actualizado:** 10 de octubre de 2026. **La fase 2 sigue abierta.** El frontend y las correcciones de aprovisionamiento están desplegados. No se modificaron la ONU, MikroTik, asignaciones NAP ni datos de Supabase durante el ajuste visual de esta sesión.

## Estado desplegado

- La corrección de la ficha del contrato ya está en el frontend: usa el plan directo de la ONT si existe; si falta, muestra el plan del contrato solo cuando los perfiles T-CONT y de tráfico de la ONT coinciden con los perfiles OLT de ese plan. Pruebas unitarias de la función: 3/3 aprobadas.
- Se reconstruyó y recreó únicamente `frontend` con `docker-compose.onprem.yml`. El contenedor está activo; el panel por HTTPS, el índice, y el paquete JavaScript que contiene el cambio respondieron HTTP 200. El paquete servido incluye la lógica de respaldo y los perfiles OLT.
- En el contrato `CTR-2026-00214`, el plan está en `service_contracts.plan_id` (“DE SANDRO O MICHEL”); la fila de la ONT tenía `plan_id` vacío y perfiles OLT coincidentes. La ficha ya puede mostrar el plan coherente sin escribir en Supabase.
- La etiqueta NAP `7/16` indica 7 puertos ocupados de 16. La asignación del contrato está en el puerto 7. La consulta de solo lectura no encontró puertos duplicados.
- La asociación de servicio GPON para la ONT operativa y la sesión PPPoE fueron verificadas en el trabajo anterior. No se reconfiguró la ONT en esta sesión.

## Correcciones de fase 2 desplegadas

1. El backend exige un contrato válido para nuevas autorizaciones y conserva la lectura de registros históricos sin contrato.
2. Los consumidores de la ruta anterior usan las garantías del flujo común verificado e idempotente.
3. El backend valida que las referencias PPPoE correspondan al contrato. El flujo de autorización no cambia en MikroTik el nombre de usuario, contraseña, perfil ni estado.
4. La reserva de NAP es transaccional: un fallo al reservar el destino conserva la asignación de origen.
5. El transporte de servicio GPON (`service 1 gemport 1 vlan 120`) no depende del envío opcional de WAN/PPPoE. WAN manual sigue disponible.
6. La ficha muestra el plan del contrato solo cuando concuerda con los perfiles OLT configurados en la ONT.

## Pruebas y verificaciones

- La entrega de fase 2 anterior pasó 101/101 pruebas locales, nueve escenarios SQL con PostgreSQL 17, comprobaciones de tipos y build. Eran pruebas simuladas/aisladas, no una certificación completa de operaciones productivas.
- En el despliegue previo se ejecutaron las pruebas de aprovisionamiento y Telnet y se construyó el backend. En esta sesión pasaron 3/3 pruebas del resolvedor visual y `npm run build`.
- Verificación posterior del frontend: contenedor activo, panel HTTPS HTTP 200 y paquete nuevo HTTP 200.
- Supabase: el usuario confirmó que la migración 136d fue instalada con `SmartRayco_136d_instalar.sql`; `funcion_instalada`, `authenticated_permitido` y `anon_bloqueado` dieron `true`. La revisión previa encontró 136/136b/136c instaladas aunque sin filas de registro. No se repitió ninguna migración ni se cambió la base para el ajuste visual.

## Respaldos

- Frontend previo a este despliegue: `/opt/smartrayco-backups/antes-ficha-plan-20261010-003020/` (`frontend-codigo-configuracion.tar.gz`, ID de imagen y `frontend-image.tar`).
- Backend previo al cambio de servicio GEM/VLAN: `/opt/smartrayco-backups/antes-service-gem-vlan-20261010-001709/backend-codigo-configuracion.tar.gz`.
- Despliegue previo de contratos/NAP: `/opt/smartrayco-backups/antes-contratos-nap-20261009-2130/codigo-configuracion.tar.gz`.
- Respaldo anterior de fase 2: `/opt/smartrayco-backups/antes-fase2-20261009-185510` (código/configuración/imágenes; no contiene datos de Supabase).

## Pendientes reales de fase 2

1. En el SQL Editor, ejecutar solo las consultas de lectura preparadas para confirmar definición, propietario, `SECURITY DEFINER`, `search_path`, ACL efectiva de `authenticated`, `anon` y `PUBLIC`, y estado del registro de 136d. No reinstalar migraciones.
2. Revisar el panel con una sesión autenticada y roles reales: permisos, ficha de contrato/plan, estados de ONT y lectura de asignación NAP. No autorizar, eliminar ni reconfigurar equipos para esta comprobación.
3. Completar pruebas aisladas de contrato ausente/inválido, referencias PPPoE discordantes, conservación de atributos del secreto MikroTik, resultados inciertos de OLT y rollback/concurrencia NAP.
4. Probar WAN manual y el envío opcional de WAN en una ONT de laboratorio independiente. La ONT `HWTCABD21CB4` ya navega y no debe utilizarse para reprovisionar.
5. Hacer una prueba de extremo a extremo en laboratorio que compruebe contrato, OLT, asociación GEM/VLAN, referencias PPPoE y NAP sin afectar registros históricos.

La fase 2 permanece abierta hasta revisar las verificaciones autenticadas y las pruebas reales/aisladas pendientes. No avanzar a otra fase sin revisión y aprobación del usuario.
