# Etapa 3 transaccional con Auth real — laboratorio, 16/10/2026

**APROBADO EN LABORATORIO. LISTO PARA REVISIÓN LOCAL.** No equivale a aprobación
de Cloud ni del cierre global de permisos. Base de aplicación: `a8afd6a`.

## Alcance y conservación

Se reutilizó el laboratorio existente, sin recrear su volumen ni usuarios previos.
Se añadieron un material (stock inicial 20), un modelo, cinco equipos, un cliente,
cuatro servicios/órdenes ficticios y una cuenta ADMIN creada por GoTrue local.
La fixture se guarda en runtime y los intentos se registran antes del envío.
No se usaron contraseñas, equipos, cuentas, clientes ni infraestructura real.

Se habilitó únicamente en el gateway del laboratorio un modo transaccional
explícito `LAB_INVENTORY_WRITES=1`. Las escrituras HTTP están limitadas a la RPC
de inventario y a un control de concurrencia local con JWT ADMIN y dos órdenes
ficticias concretas. No se modificó la migración ni la aplicación de producción.
El control usa set_current_job_crew y UPDATE reales con sus policies/triggers;
pg_sleep solo mantiene sus locks para observar el orden de ejecución.

Cinco sesiones obtenidas con login real GoTrue: líder, apoyo, ajeno, retirado y
ADMIN ficticio. JWT ES256 verificados contra JWKS local. No se fabricó ningún
JWT de técnico ni se empleó service_role para operar. SQL administrativo se
limitó a crear la fixture, mantener una barrera de lock sin cambios y auditar.

## Resultados

| Comprobación | Resultado |
| --- | --- |
| Consumo/corrección/reversión de Alta y Avería con líder/apoyo | Stock 20→17→19→20; corrección añade reversión + nuevo egreso; historial conservado |
| Alta asignar/retirar | Estados assigned→in_stock, trazabilidad por evento |
| Avería entrante y saliente | Entrante pending_approval y desvinculación; salida de equipo previamente asignado a damaged; sin aprobar directamente como técnico |
| Ajeno/retirado | 16 denegaciones 42501 en materiales/equipos, cero cambios de inventario o recibos |
| Corrección sin stock | P0001 español; rollback del par de movimientos y del recibo, sin saldo parcial |
| Respuesta descartada después de commit real | 503 de laboratorio; helper persiste UUID; siguiente petición obtiene el mismo recibo y un solo consumo |
| Dos peticiones simultáneas con la misma clave | Misma respuesta, una fila y un efecto en stock |
| Dos técnicos por stock/reversión | Solo uno consume 12; el otro falla por stock; solo una reversión del original |
| Dos técnicos por el mismo equipo | Una sola asignación; segundo intento denegado, sin otro evento |
| Reasignación/cierre concurrentes | ADMIN con JWT real confirma primero; el movimiento bloqueado termina 42501, sin escritura posterior |
| Recibo anterior tras revocar | Misma UUID no recupera ni autoriza otro movimiento; nuevo técnico legítimo sí puede revertir el consumo de su orden |
| 55P03 en navegador | Lock real de asignación, mensaje español sin nombres de tablas; rollback y reintento seguro |

- `transactions.ts`: **14 grupos aprobados** con peticiones reales Auth/API.
- `transactions-browser.mjs`: **10 escenarios aprobados** en Chrome con login
  real, helper de persistencia de producción y RPC real; cero peticiones externas
  y cero excepciones. No se interceptaron respuestas para simular autorización.
- `transactions-audit.mjs`: **correcto**; stock final **20**, reconstrucción
  desde Kardex **20**, **34 movimientos**, cero dobles reversiones, cero egresos
  pendientes. **40 recibos**, ninguno incompleto. Cinco equipos: cuatro in_stock,
  uno damaged, todos con vínculos liberados tras sus devoluciones legítimas.
- Filas anteriores del laboratorio: comparación completa por ID y contenido
  de productos/unidades/movimientos/eventos, **sin modificaciones**.
- No se repitieron las 49 comprobaciones de lectura ni las ocho de navegador
  anteriores. No se realizaron pruebas contra Cloud.

## Incidencia del comprobador de navegador

El primer intento cambió directamente el texto de estado del DOM. Tras una
corrección exitosa, el texto virtual de Vue no cambió y el comprobador agotó su
espera. No fue un fallo de stock/autorización: se verificó un único consumo activo
de cantidad 2 y stock 18, exactamente el checkpoint previsto tras corregir.

Se preservó el informe inicial en runtime, se corrigió el estado visual para usar
reactividad («Operación en curso») y se revirtió ese consumo mediante la RPC y
el JWT real del líder. No se editó stock ni se borró historial. Esa recuperación
dejó stock 20 y su recibo/evento de auditoría; los 34 movimientos y 40 recibos
finales incluyen ese intento y su reversión explícita. No se ocultó ni repitió
automáticamente una operación incierta. El segundo intento completo pasó.

## Archivos y repetición

- Nuevo directorio `scripts/inventory-auth-lab/`: se versiona la infraestructura
  local necesaria de Auth/API/frontend, que aún no tenía commit, y los nuevos
  scripts transactions-fixture, transactions, transactions-browser y auditoría.
- `recover-browser-checkpoint.mjs`: recuperación explícita, condicionada al
  checkpoint concreto del harness; no es reparación general de saldos y no
  debe repetirse sobre el estado final actual.
- Informes JSON: `INVENTARIO-LAB-TRANSACCIONES-RESULTADOS`, `-NAVEGADOR` y
  `-AUDITORIA`. Sin tokens ni contraseñas.
- README del laboratorio: arranque, parada, modo lectura y modo transaccional.

No repetir automáticamente fixture/transactions: ya existe un journal y órdenes
de control cerradas/reasignadas. El script rechaza reutilizar ese journal. Para
otro ensayo, diseñar una fixture aditiva nueva; no borrar ni resetear la actual.
La auditoría final es de solo lectura y puede volver a ejecutarse:

```powershell
node scripts/inventory-auth-lab/transactions-audit.mjs
```

Runtime (claves locales, contraseñas ficticias, sesiones y journals) queda
ignorado por Git. Los documentos antiguos de preflight/pausa y los cambios ajenos
de Fases 161/162 no se incluyen en este commit. La nota de estado permanece local
para no mezclar sus modificaciones previas.

## Límites y riesgos pendientes

La interfaz es de laboratorio, no toda la App de Campo ni su cola offline.
La pérdida de respuesta es una inyección controlada tras REST 200/commit real,
no una prueba de caída física del dispositivo o red. No se usaron cuentas
operativas: hace falta validar dispositivos y el entorno de publicación que
se autorice en el futuro. La fixture no reproduce todo el esquema Cloud.

Las policies legacy de REST directo siguen amplias; esta validación certifica
la nueva RPC contextual, no el aislamiento administrativo completo. No se
autoriza aplicar la migración ni cerrar permisos compartidos a partir de este
resultado. El gateway vuelve a modo lectura al reiniciar sin la variable de
habilitación. Parar los servicios según README conserva volumen, datos e historial.

Sin cambios en Supabase Cloud, migraciones remotas, push ni despliegue. Las ocho
unidades históricas y sus relaciones permanecen intactas. Rutinas/Fase 162 no
reciben cambios de código ni validación transaccional en este ensayo.
