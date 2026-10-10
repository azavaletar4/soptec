# Registro de errores de campo

Bugs reportados por técnicos/administradores usando SmartRayco en operación
real. Antes de investigar un problema nuevo, revisar si ya está aquí.

Formato por entrada — agregar una fila nueva arriba (más reciente primero),
sin duplicar una ya existente para el mismo problema (actualizar su Estado
en vez de crear otra):

| Fecha | Módulo | Problema detectado | Causa identificada | Corrección aplicada | Prueba de regresión | Estado |
|---|---|---|---|---|---|---|
| 2026-10-10 | Prospectos CRM | "Convertir en cliente" no generaba ni cliente ni orden de Alta (caso real: prospecto "prueba2", id `3f3ec843-c8bf-43c6-a59b-6e0314d461fe`, confirmado por SQL de solo lectura — sigue `en_negociacion`, `converted_client_id` null, sin cliente ni instalación en Supabase) | El botón solo hacía `router.push` a `/clientes?prospect_id=..` para preabrir el modal "+ Nuevo cliente" — no escribe nada por sí solo. El modal exige documento (`clients.document_number` NOT NULL, el prospecto no lo trae) sin ningún aviso de que ese paso falta completar; si se cierra o no se envía, no queda rastro | `ClientesView.vue`: aviso visible en el modal mientras se convierte, aviso de teléfono duplicado antes de crear, genera la orden de Alta (mismo flujo que "Nueva instalación" en Soporte) junto con el cliente, toasts de éxito/error, navega a la ficha del cliente al terminar | Sin prueba automatizada (sin framework de componentes Vue en el proyecto) — `vue-tsc` limpio; validación end-to-end pendiente del usuario (no se ejecutó contra Supabase real para no crear datos de prueba) | pendiente de validar en campo |
