# SmartRayco — continuidad de fase 2

10 de octubre de 2026, Lima. **Lista para revisión y aprobación del usuario con los límites indicados. No iniciar fase 3.**

## Aplicado

- Contrato obligatorio para nuevas autorizaciones; históricos consultables.
- PPPoE existente como referencia, sin modificar usuario, contraseña, perfil ni estado en MikroTik.
- Servicio GEM/VLAN independiente de la WAN manual u opcional. VLAN de prueba: 120.
- Reserva NAP transaccional y recuperación de operaciones sin altas duplicadas.
- Plan visible desde la ONT o el contrato cuando coinciden sus perfiles OLT.
- Autorización exclusiva para ADMIN y SUPERADMIN.

## Resultados finales

- WAN manual: HWTCABD21CB4 reautorizada; navegación confirmada por el usuario sin resincronizar ni enviar credenciales desde la OLT.
- WAN opcional: HWTCE5AFB8B6 sustituyó a la ONT de prueba anterior. Panel confirmó registro/verificación, vínculo a CTR-2026-00214 y envío WAN/PPPoE; usuario confirmó internet el 10/10 a las 08:54.
- Capturas: plan DE SANDRO O MICHEL, ONT anterior en línea y NAP SM-01 seleccionada; menú restringido a soporte para técnico/soporte.
- Revisión independiente del ZIP: 105/105 pruebas aprobadas y compilación correcta. Incluyen contratos, referencias PPPoE, idempotencia, recuperación y guardas de roles con identidad simulada.
- Nueve escenarios SQL NAP aprobados según Codex local; código de pruebas revisado sin repetir ejecución aquí. Supabase 136d instalada y verificada mediante consulta aportada. No repetir migraciones.

## Límites de aceptación

No se hicieron peticiones directas con JWT reales de cada rol ni una nueva consulta del puerto NAP tras el último reemplazo. El puerto 7 sin duplicados se verificó antes; “7/16” es ocupación. La conservación de atributos MikroTik está cubierta por código/simulaciones, sin comparación independiente antes/después en la última prueba real. No se certifican todos los modelos ONT ni todos los escritores NAP.

## Guardado y respaldos

- Base revisada: caabb99, sobre 66d86f5; captura local con main y origin/main alineados. Este cierre necesita un nuevo commit y push.
- Frontend: /opt/smartrayco-backups/antes-ficha-plan-20261010-003020/
- Backend: /opt/smartrayco-backups/antes-service-gem-vlan-20261010-001709/backend-codigo-configuracion.tar.gz
- Contratos/NAP: /opt/smartrayco-backups/antes-contratos-nap-20261009-2130/codigo-configuracion.tar.gz
- Estos respaldos no contienen los datos remotos de Supabase.

Siguiente paso: guardar la documentación y recibir aprobación explícita sobre este alcance. No repetir pruebas satisfechas ni modificar equipos para el cierre documental. Conservar archivos ajenos y secretos fuera del commit.
