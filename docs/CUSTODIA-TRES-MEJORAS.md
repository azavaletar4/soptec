# Tres mejoras locales de Custodia

Implementación sobre el estado local posterior al rediseño `689abeb`; producción permanece en `7159b7e`. Sin despliegue ni push.

- Selección inicial del primer técnico con equipos o materiales; si nadie tiene custodia, el primero disponible, y sin técnicos, ninguna selección. Actualizar conserva el técnico seleccionado mientras exista, incluso si queda sin custodia. El clic manual selecciona sin alternar a vacío.
- Cada equipo vigente muestra fecha/hora de su entrega y autor verificable desde el Kardex. Se comprueba el ciclo vigente y el destinatario: no se usa la fecha de actualización, el creador del equipo ni una entrega histórica de otro ciclo. Fechas en `America/Lima`.
- Historial separado por técnico: últimos 100 eventos de equipos vinculados explícitamente al técnico y últimos 100 eventos de materiales. Incluye entregas, solicitudes de devolución, recepciones y cambios registrados. No representa un saldo actual. El Kardex completo del equipo sigue accesible en su ficha existente.
- Serie/MAC enlaza a `/inventario/:productId?unit=:unitId&returnTo=/inventario/custodia`. Se reutiliza el modal de Kardex de `InventarioProductoView`, con validación de que la unidad pertenece al producto y retorno a Custodia. Errores de lectura del modal se muestran explícitamente.

Datos ausentes: sin evento verificable del ciclo vigente se muestra «Fecha no disponible»; sin perfil del autor, «Responsable no disponible». No se completan ni reconstruyen datos en la base. Eventos sin vínculo explícito al técnico no se atribuyen a su historial; pueden consultarse en el Kardex del equipo. No se verificaron los registros productivos de las ONT de Jadir ni se modificaron.

Validación focalizada:

- `node --import tsx --test src/lib/__tests__/technicianCustodyPresentation.test.ts`: 3 pruebas aprobadas (selección y actualización, ciclos históricos/actuales, fecha Perú y destino de navegación).
- `node scripts/tests/custodia-usability-browser.mjs`, con Vite local en puerto 5184: selección automática/manual, actualización conservando selección, historial con fecha Perú y autor, enlace abriendo el modal real del equipo: PASS. Cero excepciones de navegador y cero escrituras reales; fixtures de navegador, red de negocio bloqueada.
- `node node_modules/vue-tsc/bin/vue-tsc.js -b`: correcto.
- `node node_modules/vite/bin/vite.js build`: correcto; aviso de tamaño de chunks existente.

No se modificaron RPC, RLS, migraciones, permisos, App de Campo, Altas, Averías ni Rutinas. No se accedió a Supabase Cloud ni se cambiaron existencias, movimientos o custodias. Los cambios de documentación ajenos y los artefactos del despliegue anterior permanecen fuera de este commit.
