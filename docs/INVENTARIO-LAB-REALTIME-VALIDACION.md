# Etapa 4 — ensayo Realtime real y bloqueo de revocación

16/10/2026. Base `d8bfab6`, aplicación `eaa4510`.

**BLOQUEADO.** Se preparó Realtime exclusivamente en el laboratorio y se
reprodujo la pérdida de autorización con una conexión abierta. Se detuvo la
integración de Campo conforme a la condición explícita del usuario. No es una
implementación aprobada de etapa 4 ni una migración preparada para producción.

## Implementación local realizada

- Imagen oficial `supabase/realtime:v2.143.3`, digest descargado
  `sha256:768b559241dd234c4e8852c5c0f504e598b80f1df2ad4dd78d5486fbed2f17a2`.
  Tenant independiente `inventory-lab`, en la red interna del laboratorio.
- Se conservaron DB/volumen/Auth/API y usuarios ficticios. Se habilitó WAL lógico
  mediante configuración y reinicio **solo del contenedor DB del laboratorio**.
  Realtime ejecutó sus migraciones internas locales en `_realtime`/`realtime`.
  No se ejecutaron migraciones de aplicación nuevas ni remotas.
- Caddy expone el servicio únicamente en `http://127.0.0.1:54385`; WebSocket
  nativo `/socket/websocket`, sin ruta ni upstream a Cloud. El gateway de Campo
  permanece en 54381 y su bloqueo de salidas externas no se alteró.
- Se añadieron los roles internos sin login `dashboard_user`, `supabase_admin`
  y `supabase_realtime_admin` exigidos por las migraciones del servicio en el
  PostgreSQL estándar del laboratorio. No se cambió ningún rol de aplicación.
- Policy SELECT experimental en `realtime.messages`: usuario activo,
  ADMIN/SUPERADMIN, o TECNICO_RED líder/apoyo asignado al tipo/ID de orden vigente
  en un estado de lectura permitido por el servicio existente. Sin policy INSERT
  para clientes: estos no reciben autorización para emitir mensajes.
- Canales privados `campo-inventory:v1:<tipo>:<id>`; evento `invalidate`, payload
  exactamente `{v:1}`. El comprobador usa un emisor administrativo local para
  señales sintéticas. **No se instalaron triggers emisores de inventario** ni
  se vinculó este transporte al frontend de Campo.
- Cuatro sesiones reales de GoTrue conservado; JWT ES256 verificados con JWKS,
  issuer, audience y sub. Se espera `setAuth(jwt)` antes de cada JOIN para evitar
  competir con la inicialización asíncrona del SDK. Ningún token de técnico fue
  fabricado. service_role local se usa para emitir la señal de servidor; el
  endpoint administrativo de salud requiere un token de control HMAC local,
  que nunca se usa para entrar como técnico ni consultar su inventario.

Credenciales de servicio/DB/Auth solo en runtime ignorado por Git o memoria.
No se imprimieron ni versionaron. Configuración original de Caddy y hashes de
inventario previos guardados en runtime. Realtime permanece preparado/ejecutándose
para diagnóstico local, sin emisor automático; todos los sockets del ensayo se
cerraron. Su policy es experimental y **no debe copiarse a Cloud**.

## Resultados comprobados

Evidencia: `INVENTARIO-LAB-REALTIME-RESULTADOS.json`.

| Comprobación | Resultado |
| --- | --- |
| Login GoTrue líder, apoyo, ajeno y futuro retirado | 4 PASS; JWT reales verificados |
| Fixture aditiva | PASS; Alta programada y Avería abierta nuevas; sin inventario nuevo |
| JOIN Alta y Avería | 2 PASS; líder/apoyo/futuro retirado aceptados, ajeno rechazado |
| Aviso y reconsulta Alta/Avería | 2 PASS; solo `{v:1}`, consulta contextual real 200 con lista vacía de su orden |
| Retirado de la Alta, mismo JWT | PASS; pertenencia eliminada y GET contextual 403 con solo `error` |
| Mismo socket después de retirar | **FAIL**; estado `joined`, contador de avisos 1→2 tras la revocación confirmada |
| Inventario conservado | Hashes de productos, unidades, movimientos, eventos y recibos iguales a los anteriores a instalar Realtime |

Total del ensayo final: **10 comprobaciones PASS y una FAIL bloqueante**.
Estado administrativo del servicio comprobado: HTTP 200, `healthy:true`,
`db_connected:true`, `replication_connected:true`. No equivale a seguridad aprobada.

Secuencia del fallo: retirar la pertenencia → confirmar cero filas de asignación
de ese usuario a esa orden → consultar con su mismo JWT y obtener 403 sin datos →
emitir otra señal privada → líder/apoyo **y el retirado** reciben la señal.
No se renovó el JWT ni se cerró el socket para ocultar el problema. No viajaron
filas de inventario; incluso la señal revela actividad posterior de una orden
para la que ya no existe autorización. La reconsulta segura no corrige esa fuga.

Esto coincide con la [documentación oficial de autorización Realtime](https://supabase.com/docs/guides/realtime/authorization):
los permisos de Broadcast se cachean durante la conexión y se reevalúan al
suscribirse o recibir un JWT nuevo. No basta con pedir al cliente que se
desconecte, renueve el token o ignore el evento: un cliente ajeno puede no hacerlo.
Referencia de configuración: [compose oficial](https://github.com/supabase/supabase/blob/master/docker/docker-compose.yml)
y [seeds del servicio fijado](https://github.com/supabase/realtime/blob/v2.143.3/priv/repo/seeds.exs).

## Incidencias de preparación conservadas

El primer arranque necesitó crear el esquema `realtime` y los roles internos
esperados por las migraciones de la imagen; se incorporaron al preparador.
La comprobación de salud de control no acepta la clave anónima ES256 por la
misma vía que el tenant: se usó exclusivamente allí HMAC administrativo local.

La primera fixture en ejecución fue rechazada por el candado existente de una
sola orden activa y su transacción hizo rollback completo. Se comprobó ausencia
de ambas órdenes/asignaciones antes de reanudar con estados programada/abierta,
ya permitidos por las lecturas contextualizadas. **No se desactivaron triggers**
ni se alteraron órdenes previas. Los siguientes intentos de JOIN incompletos se
debieron a inicialización interna y al bootstrap JWT del SDK; sus informes se
conservaron en runtime antes de reanudar. No hubo movimientos de inventario.

La fixture final conserva dos órdenes nuevas y las cuadrillas del ensayo;
`removed` quedó retirado solo de la Alta nueva. No se modifica su estado anterior
en otras fixtures. El journal impide repetir automáticamente el ensayo completo;
las opciones de reanudación solo admiten checkpoints incompletos comprobados,
**nunca** el estado final BLOCKED.

## Pendientes y límite de la entrega

No se implementaron sustitución de suscripciones en Campo, emisores derivados de
escrituras, reconexión, cambios de sesión, pérdida de conectividad ni integración
administrativa. No se probaron revocación de Avería, ADMIN/SUPERADMIN/SOPORTE/
FACTURACION, desactivación de perfil ni cierre de orden en este transporte.
El futuro retirado sí se autenticó y entró antes de ser retirado de la Alta.
No atribuir estas pruebas pendientes a los PASS anteriores.

Las vistas administrativas y sus refrescos actuales no se tocaron. No se
repitieron las pruebas de etapa 3 ni los ensayos previos de lectura/navegador.
Solo se verificó sintaxis de los cuatro scripts `.mjs` nuevos; no se ejecutó build
de la aplicación porque no cambió código de aplicación. La policy INSERT denegada
está preparada, pero no se probó aún la emisión falsificada de un técnico.

Próxima revisión, sin implementarla ahora: evaluar invalidaciones mínimas con
autorización de entrega vigente (por ejemplo, una tabla dedicada de avisos con
Postgres Changes/RLS evaluada por evento, o un emisor backend con control por
destinatario). Debe probarse la concurrencia con revocación y evitar cualquier
dependencia de la cooperación del cliente. Un Broadcast por orden con policy
evaluada solo en JOIN queda **descartado como solución suficiente**.

## Archivos y rollback local

- `scripts/inventory-auth-lab/realtime-prepare.mjs`: añadido conservador del servicio.
- `realtime-policy.mjs` / `realtime-policy.sql`: policy experimental de laboratorio.
- `realtime-status.mjs`: diagnóstico sanitizado y salud local.
- `realtime-revocation.mjs`: reproducción con JWT reales y parada ante el fallo.
- README del laboratorio, este documento y resultados JSON.
- Nota de continuidad en `ESTADO_DESARROLLO.md`, fuera del commit por sus cambios
  previos. Ficheros ajenos y Fases 161/162 excluidos.

Para detener únicamente Realtime conservando todo el laboratorio:

```powershell
docker compose --project-name smartrayco-inventory-auth-lab -f scripts/inventory-auth-lab/runtime/compose.json -f scripts/inventory-auth-lab/runtime/realtime-compose.json stop realtime
```

No ejecutar `down -v`, recrear Auth, reseed ni borrar journals. Para retirar
completamente la infraestructura, revisar por separado la restauración de Caddy
desde `Caddyfile.before-realtime`, el puerto 54385, la policy experimental y el
valor WAL previo registrado (`replica`). Revertir Git no deshace esos cambios de
runtime/DB. No borrar esquemas internos ni roles a ciegas. No se ejecutó rollback:
la instalación y evidencia se conservan como solicitó el usuario.

Sin Cloud, datos reales, producción, migraciones remotas, push ni despliegue.
Rutinas/Fase 162 y las ocho unidades históricas permanecen fuera de alcance.
