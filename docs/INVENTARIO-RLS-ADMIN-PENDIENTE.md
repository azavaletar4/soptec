# Cierre RLS administrativo — pendiente separado, sin implementación

16/10/2026. Referencia: evidencia ya obtenida en
`INVENTARIO-ACCESO-CONTROLADO.md`; no se volvió a consultar Cloud.
La etapa 4 integrada no cambia tablas, políticas, publicaciones ni grants.

El mínimo cierre pendiente debe tratar estos objetos existentes:

1. `inventory_products`, `inventory_categories`, `inventory_units`,
   `inventory_movements` e `inventory_unit_events`: sustituir las políticas
   amplias por acceso administrativo ADMIN/SUPERADMIN activo y preservar
   exclusivamente las operaciones contextualizadas de Campo. Una política
   restrictiva nueva no basta si se mantienen políticas permisivas amplias.
   `inventory_products_staff_only` es una de las políticas amplias identificadas.
2. `inventory_get_albums`: su SECURITY DEFINER y EXECUTE público permiten
   eludir el filtrado de tablas. Necesita validación administrativa estricta
   interna y revisar EXECUTE para PUBLIC/anon/authenticated. No basta ocultar
   menú o ruta. Conservar funcionamiento ADMIN/SUPERADMIN.
3. Lecturas backend y RPC de etapa 3: conservar validación activa de actor,
   asignación vigente, estado y contexto en servidor; devolver DTO mínimo.
   Los privilegios internos estrictamente necesarios no deben transformarse
   en SELECT/INSERT/UPDATE generales para técnicos.
4. **Dependencia aún incompatible:** RoutineInventory/Fase 162 y cualquier
   consumidor pendiente de lecturas/escrituras directas. No retirar ahora sus
   accesos ni mezclar su adaptación con esta entrega. El inventario compartido
   exige resolver esa compatibilidad antes de un cierre global de políticas.

No se demuestra necesidad de tablas ni columnas nuevas para el reloj genérico;
no necesita RLS, publicación ni RPC de notificaciones. No se preparó otra
migración para cerrar accesos sin resolver los consumidores pendientes.

Antes de proponer la aplicación de permisos: revisar el diff concreto de
políticas/grants sobre los objetos anteriores, validar JWT reales de todos los
roles afectados y RETURNING/reintentos/consumidores conservados en laboratorio,
y preparar restauración exacta de sus definiciones/ACL. Esta lista es una
dependencia de seguridad para revisión, no una autorización ni una nueva fase.
