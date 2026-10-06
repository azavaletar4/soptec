# Registro de cambios visuales — SmartRayco

Este archivo lleva la cuenta de cada cambio **visual/UI** que se aplica al panel (colores,
layout, componentes, iconos, textos de interfaz). No incluye cambios de backend/lógica que no
se ven en pantalla — para eso está el historial de git.

Pensado para poder pegarlo en otra conversación (ej. Claude web) y dar contexto rápido de cómo
se ve el panel hoy, sin tener que compartir el código.

**Sistema de diseño base (no cambia, referencia):** Tailwind CSS, tema claro (sin modo oscuro en
ningún lado del panel), tarjetas blancas con borde `slate-200` y esquinas redondeadas (clase
`.surface`), tablas con encabezado gris claro (`.table-shell`), badges de estado en cápsulas de
color (`.badge`), botones `.btn-primary` (azul sólido), `.btn-secondary` (borde gris),
`.btn-ghost` (sin fondo). Colores de estado: verde `emerald-500` = bien/activo, ámbar `amber-500`
= atención, rojo `red-500` = crítico/error, azul `sky-500` = informativo/neutro.

---

## 2026-09-28

### OLT (Red & OLTs → detalle de una OLT)
- Estado de cada ONT traducido al español: **"En línea"** (verde) / **"Sin conexión"** (rojo) en
  vez de "online"/"offline".
- Botones "Activar/Desactivar" y "Eliminar" de una ONT ahora muestran texto de progreso
  ("Aplicando...", "Eliminando...") y se deshabilitan junto con el resto de botones de la
  pantalla (Sincronizar/Importar/Registrar) mientras corre cualquier acción — evita que se vean
  varios botones "activos" a la vez.
- Tabla de ONTs rediseñada para que quepa mejor:
  - Columnas secundarias (Posición, Zona, VLAN, Tipo, Registrado) se ocultan en pantallas
    angostas (celular) — quedan visibles Serial, Cliente, Estado, Señal, TR-069 y Acciones.
  - Encabezado "SHELF/SLOT/PORT/ID" acortado a **"Posición"** (con tooltip del detalle completo).
  - Se sacaron los botones "Señal"/"Zona"/"TR-069" de cada fila (estaban duplicados con el panel
    de detalle que ya se abre al tocar la fila) — quedan solo "Activar/Desactivar" y "Eliminar".
  - Menos espacio en blanco por columna (padding reducido).
  - La tabla ahora tiene alto máximo con scroll propio y encabezado fijo (`sticky`) arriba, para
    que la barra de desplazamiento horizontal quede siempre alcanzable aunque haya cientos de
    filas (antes quedaba al final de toda la tabla).

### Facturación
- Los cuadros de confirmación nativos del navegador (`confirm()`/`alert()`) al **cancelar** o
  **eliminar** una factura se reemplazaron por una ventana propia del diseño del panel
  (componente nuevo `ConfirmModal`, reutilizable — ver más abajo).
- "Cancelar factura" (acción reversible) quedó en **gris neutro**; "Eliminar factura" (acción
  irreversible) quedó en **rojo**, con una pequeña línea divisoria entre los botones "Editar" y
  "Eliminar" de la tabla para que no queden pegados.
- Nuevo estado de factura **"Exonerada"** (para servicios de cortesía) con su propio badge en
  **azul cielo** (`sky-500`), y nueva pestaña/filtro "Exoneradas" en la lista.
- En el formulario de nueva factura: si el estado es "Exonerada", el campo "Monto" se pone en 0
  automáticamente y queda deshabilitado (fondo gris, texto gris) — no se puede editar a mano.

### Ficha de cliente → pestaña "Datos del servicio"
- Nueva casilla **"Servicio gratuito (cortesía)"** con campo de texto para el motivo (ej. "Módem
  de oficina"), dentro de una tarjeta con borde propio.

### App de Campo (técnicos, celular)
- En el cierre de una instalación, la etiqueta "Firma del cliente" ahora lleva un **asterisco
  rojo** cuando el trabajo es una instalación (obligatoria); sin asterisco en averías/soporte
  (sigue opcional).

### Componente nuevo: `ConfirmModal`
- Reemplaza los `confirm()`/`alert()` nativos del navegador en toda la app (se usa primero en
  Facturación, pensado para ir aplicándose en más pantallas).
- Diseño: ventana centrada estilo modal ya existente en el panel (fondo oscuro semitransparente +
  tarjeta blanca centrada), título, mensaje, y dos botones — uno neutro ("Cancelar") y uno de
  acción que cambia a **rojo** si la acción es irreversible (`danger: true`) o **azul** si no.

### Menú lateral (Planta Interna)
- Nueva entrada **"Servidores"** (ícono de rack de servidores, mismo estilo que el resto de
  íconos SVG a mano del menú — sin librerías de íconos externas).

### Módulo nuevo: Servidores (monitoreo de Proxmox VE)
Pantalla nueva completa, dentro del mismo lenguaje visual claro del resto del panel (tarjetas
`rounded-2xl`, sin modo oscuro):

- **Encabezado del nodo:** nombre del servidor + punto verde con animación de "pulso"
  (`animate-ping`) cuando está en línea / punto rojo fijo si no responde, badge de tiempo
  encendido, y chips de texto gris con el modelo de CPU, versión de kernel y versión de Proxmox.
- **4 tarjetas de métricas** (grid responsive, se acomodan solas según el ancho de pantalla):
  CPU, Memoria RAM, Disco local, y una cuarta que combina Retardo I/O + SWAP. Cada una con número
  grande + barra de progreso horizontal de color: **verde** (`emerald-500`) por debajo de 60%,
  **ámbar** (`amber-500`) entre 60-85%, **rojo** (`red-500`) por encima de 85%.
- **2 gráficas de área** (ApexCharts, mismo estilo visual que ya usaba "Analítica de Tráfico":
  relleno con degradado, línea suave, grilla gris punteada, sin eje truncado — siempre 0-100%
  para no exagerar variaciones chicas):
  - "CPU y retardo I/O — última hora": dos series, azul (`#0ea5e9`) y ámbar (`#f59e0b`).
  - "Memoria RAM — última hora": una serie, violeta (`#8b5cf6`).
- **Tarjetas de VM/contenedor** (grid responsive): nombre, badge de tipo (VM/LXC) y número,
  badge de estado (verde "Encendida" / rojo "Apagada" / ámbar "Pausada"), barras de CPU y RAM,
  texto de red acumulada y tiempo encendido, botones "Iniciar"/"Reiniciar"/"Apagar" (con
  `ConfirmModal` antes de ejecutar) y enlace "Abrir consola ↗" a la derecha.
  - La barra de RAM de una VM se pinta en **violeta neutro** (no en la escala verde/ámbar/rojo)
    cuando el dato es solo "lo que el hypervisor tiene reservado" y no un uso real confirmado —
    con una notita gris chica debajo explicando por qué. Si en el futuro se activa el Memory
    Balloon de esa VM, la barra pasa a usar la escala normal de colores porque ahí sí es un dato
    real.
  - Si el nombre de la VM sugiere que aloja el propio panel SmartRayco, aparece un aviso ámbar
    chico antes de los botones de apagar/reiniciar.

### Componente `ConfirmModal` — accesibilidad y nuevo botón `.btn-destructive`
- Nueva clase `.btn-destructive` en `style.css`: botón rojo **sólido** (`bg-red-600` → hover
  `bg-red-700`, texto blanco) para la acción principal de un modal irreversible — distinta de la
  ya existente `.btn-danger` (texto rojo sin relleno, para acciones sueltas en tablas). El botón
  de confirmar del modal ahora usa `.btn-destructive` cuando `danger=true` y `.btn-primary`
  cuando no, sin clases inline sueltas.
- El panel del modal ahora tiene `max-h-[90vh] overflow-y-auto` (evita que un mensaje largo se
  salga de la pantalla).
- Accesibilidad (no cambia el look, pero sí cómo se navega con teclado): al abrir, el foco va al
  botón "Cancelar" si es una acción `danger`, o al de confirmar si no; con Tab el foco queda
  atrapado dentro del modal (no se escapa hacia el resto de la página); Escape cierra el modal
  (salvo mientras está `loading`); al cerrar, el foco vuelve al botón que lo abrió.

### Sistema nuevo: avisos (toast) y confirmaciones globales
- **`<ToastHost>`** (montado una vez en `AppLayout.vue` y `CampoLayout.vue`): reemplaza los
  `alert()` nativos del navegador. Los avisos se apilan **abajo a la derecha** en pantallas
  grandes; en **celular** se centran y ocupan el ancho, respetando el espacio de la barra/
  home-indicator del teléfono. Colores: rojo (`bg-red-600`) para error, verde (`bg-emerald-600`)
  para éxito, gris oscuro (`bg-slate-800`) para informativo. Se cierran solos — 8 segundos los
  errores, 6 segundos el resto — o con la "✕" de cada uno.
- **`<ConfirmHost>`** (montado igual, una vez en cada layout): un solo `ConfirmModal` global que
  cualquier pantalla puede pedir con `useConfirm()`, en vez del `confirm()` nativo del navegador.
  Mismo diseño que el `ConfirmModal` ya existente (ver entrada anterior).
- Se reemplazaron **todos** los `alert()`/`confirm()` nativos en: Servidores (el error de
  encender/apagar/reiniciar una VM ahora es un toast, no un cartel fijo propio), Cortes por
  deuda, TR-069, Usuarios, Zonas, Mapa de Red, Importar mapa y el diagrama de empalmes (fusiones
  de fibra).

### Contraste: badges y texto chico de verde/ámbar/azul, un tono más oscuro
- En **badges** (`.badge`, pastillas de color `bg-X-500/15 text-X-600`) y en cualquier texto
  `text-xs`/`text-[11px]`, los colores `text-emerald-600`, `text-amber-600` y `text-sky-600` se
  cambiaron a `text-emerald-700`/`text-amber-700`/`text-sky-700` (un tono más oscuro, más
  contraste sobre fondo blanco). Aplicado en **114 lugares** de **26 pantallas/componentes**.
  Textos grandes (KPIs en `text-xl`/`text-2xl`/`text-3xl`/`text-4xl`) y texto normal
  (`text-sm` sin badge) se dejaron en `-600` a propósito — no estaban en el pedido.
- **Dashboard**: las tarjetas de resumen (`.kpi-tile`) de color ámbar ("Prospectos", "Tickets
  abiertos") y naranja ("Señales bajas") pasaron de `bg-amber-600/80`/`bg-orange-600/80`
  (semitransparentes) a **sólidas** `bg-amber-700`/`bg-orange-700`.

### Tabla de ONTs (OLT → detalle): pulido de scroll y toque
- Cada `<th>` del encabezado (que ya era `sticky`) ahora tiene una sombra fina de 1px abajo
  (`shadow-[0_1px_0_0_var(--color-slate-200)]`) — separa visualmente el encabezado fijo de las
  filas que se deslizan debajo al hacer scroll.
- El alto máximo de la tabla pasó de `max-h-[70vh]` a `max-h-[70dvh]` (unidad de viewport
  "dinámica" — en celular, `vh` no descuenta la barra de direcciones del navegador que aparece/
  desaparece al hacer scroll, así que la tabla podía quedar más alta de lo que realmente cabía;
  `dvh` sí se ajusta a eso).
- Nueva columna final angosta con un **"›"** gris en cada fila: como en celular no existe el
  ":hover" que en desktop sugiere "esto se puede tocar", el "›" cumple ese rol — indica que la
  fila abre el detalle de la ONT.

### Servidores: confirmaciones más claras, color de gráfica, animación y botones táctiles
- Reiniciar una VM ahora también pide confirmación en **rojo** (antes solo Apagar) — reiniciar
  corta el servicio igual que apagar, aunque sea por un momento.
- Si la VM parece ser la del propio panel, el mensaje de confirmación ahora dice explícitamente
  **"perderás acceso al panel unos minutos"**, no solo "podría ser la VM del panel".
- La serie "Retardo I/O" de la gráfica CPU pasó de ámbar (`#f59e0b`) a **teal** (`#14b8a6`).
  ⚠️ *Nota:* validé este color contra el azul de la otra serie y no pasa la prueba de contraste
  para daltonismo — quedan demasiado parecidos. Aplicado igual porque así se pidió, pendiente de
  decidir si se cambia a algo con más contraste.
- El punto verde "En línea" ya no parpadea si el visitante tiene activado "reducir movimiento" en
  su sistema (`motion-safe:animate-ping`).
- Los botones de cada tarjeta de VM (Iniciar/Reiniciar/Apagar/Abrir consola) ahora tienen una
  altura mínima de 40px — objetivo táctil más cómodo en celular.

### Firma del cliente (App de Campo): más robusta y accesible
- **SignaturePad**: si el técnico gira el celular a mitad de firmar (o cualquier cambio de
  tamaño), el trazo ya dibujado se conserva en vez de perderse — antes quedaba en blanco.
  También reacciona bien si el sistema cancela el trazo a mitad de camino (ej. una notificación
  interrumpe el toque).
- En instalaciones, la etiqueta ahora dice **"Firma del cliente * (obligatoria)"** (antes solo el
  asterisco rojo, sin la palabra). El recuadro de firma tiene `aria-required` cuando es
  obligatoria.
- Si se intenta completar la instalación sin firmar, el recuadro se pinta con **borde rojo**
  (`border-red-400`) y la pantalla hace scroll automático hasta la firma, en vez de solo mostrar
  el mensaje de error arriba sin más contexto de dónde corregirlo.

### Cierre de averías con motivo (Soporte + App de Campo)
- **App de Campo** (`CampoTrabajoDetailView.vue`, sección "Cierre de trabajo"): en trabajos de
  tipo avería (no instalaciones) se agregó un selector obligatorio **"Motivo de la avería"** con
  5 opciones (Mala instalación, Deterioro de material, Daño provocado por el cliente, Factor
  externo, Equipo defectuoso), justo antes del campo de firma.
- Si el motivo elegido es "Daño provocado por el cliente" o "Factor externo", aparece un campo de
  texto **"Justificación"** obligatorio (borde rojo `border-red-400` si falta al intentar
  guardar) y se exige al menos una foto en "Evidencia 1"/"Evidencia 2" (ya existían como campos
  opcionales, ahora se vuelven obligatorios solo en este caso).
- **Soporte** (`TicketDetailView.vue`): al cambiar el estado de una avería a "Resuelto" o
  "Cerrado" desde el panel de oficina, en vez de guardar directo se abre un modal **"Liquidar
  avería"** con el mismo selector de motivo (y justificación obligatoria si aplica) — mismo
  estilo que el modal existente "Asignar técnico".
- Nueva tarjeta debajo de "Descripción" (visible solo si ya tiene motivo registrado): muestra el
  motivo elegido y una insignia **"Imputable al técnico"** (ámbar) o **"No imputable al técnico"**
  (verde), la justificación si la hay, y un botón **"📷 Ver evidencia"** si se adjuntó foto.

---

## 2026-09-30

### Inventario (Equipos por Recoger vs Averiados/En Reparación)
- El álbum virtual único que antes mezclaba todo bajo **"Equipos por Recoger / Averiados"** se
  separó en **dos tarjetas** en la vista principal de Inventario:
  - **"Equipos por Recoger"** 🔄 (rosa): solo equipos con recojo pendiente por baja de servicio.
  - **"Averiados / En Reparación"** 🛠️ (ámbar): equipos dañados, en reparación o dados de baja
    (mismo grupo de antes, sin "Por Recoger" mezclado).
- El botón único **"Devolución"** que aparecía sobre un equipo asignado a un cliente (en la ficha
  del producto, en Devoluciones y en la ficha de servicio del cliente) se separó en dos acciones:
  - **"🔁 Marcar para Recupero"**: abre un modal nuevo con Cliente origen (autocompletado, solo
    lectura), Técnico asignado al recojo (selector, solo técnicos de red), Motivo (Baja de
    servicio / Falta de pago / Migración de equipo) y Estado del equipo al recoger
    (Funcional/Dañado). Al guardar, el equipo pasa al estado **"Por Recoger"** y entra
    automáticamente a esa bandeja (separada de "Averiados / En Reparación").
  - **"⚠ Averiado / Mantenimiento"**: mismo modal de siempre (ahora con ese título), para cuando el
    equipo falló estando con el cliente — sigue soportando también "Buen estado (retorno directo a
    bodega)" para devoluciones sin baja de servicio.
- Nueva pestaña **"Por Recoger"** en Devoluciones (separada de "Dañados"/"En reparación"), y la
  ficha de producto ahora tiene dos tarjetas KPI en vez de una: **"Por Recoger"** y **"Averiados /
  En Reparación"**.
- El selector "🔀 Cambiar estado" del álbum virtual y el historial (Kardex) de cada equipo también
  reconocen el nuevo estado "Por Recoger", mostrando el técnico asignado al recojo cuando
  corresponde.
- En la bandeja **"Equipos por Recoger"**, cada tarjeta ahora muestra el **cliente enlazado**
  (click lleva directo a su ficha) y el **técnico asignado al recojo** — antes el nombre del
  cliente aparecía como texto plano y sin enlace, para que técnicos y administradores ubiquen más
  rápido a quién le corresponde ir a recoger cada equipo.

---

## 2026-10-02

### Instalaciones (modal "Completar instalación")
- Nuevo bloque **"Datos de red / Planta externa"** agregado justo encima de "Fotos de
  instalación", marcado como obligatorio (`* (obligatorio)`): dos selectores en grid de 2
  columnas (1 en móvil) — **"Zona / Sector"** (todas las zonas registradas) y **"Caja NAP"**
  (se habilita solo tras elegir Zona, filtrada a las cajas de esa zona, mostrando ocupación
  `usados/capacidad` y "(LLENA)" cuando corresponde).
- Si el contrato del cliente ya tenía Zona/NAP asignada (por administración), el modal la
  precarga en ambos selectores — quedan editables por si el técnico tuvo que mover al cliente a
  otra caja NAP. Si estaban en blanco, el técnico debe elegirlas ahí mismo: sin ambas, el botón
  "Completar" rechaza el guardado (mensaje de error en rojo bajo el formulario, mismo estilo que
  el aviso de equipo faltante).

---

## 2026-10-05

### Detalle de Ticket (Soporte) — vista de solo lectura para rol Técnico
- Rol Técnico ahora ve el detalle de ticket congelado: selects de Estado y Prioridad
  deshabilitados, banner ámbar arriba de la ficha ("📱 Para gestionar este ticket, utiliza la App
  de Campo"), y en "Seguimiento" la caja de comentario se reemplaza por el mismo mensaje.
- "Materiales usados" perdió el formulario de selector de producto + botón "+ Usar" en el panel
  web — para **todos** los roles queda solo como lista de solo lectura ("Registrado por el técnico
  desde la App de Campo").

### Histórico de Atendidos
- Columna "Atendido" pasa a mostrar dos líneas: "Creado: DD/MM/YYYY hh:mm a.m./p.m." y
  "Atendido: ...".
- Nueva columna **"Tiempo de respuesta"** con badge "⏱️ Xh Ym" de color según el tiempo: **verde**
  (menos de 4h), **amarillo** (4h-24h), **rojo** (más de 24h).
- Nuevo selector "Todos los técnicos" junto a los chips de tipo (Averías/Altas/Rutinas).
- Nuevo botón **"⬇️ Exportar a CSV"** arriba a la derecha (descarga el listado filtrado).
- Nueva columna **"Evidencias"** con botón "📷 Evidencias" por fila — abre el visor de fotos a
  pantalla completa (mismo `PhotoLightbox` reusado en el resto del panel) con todas las fotos de
  campo de esa orden.

### Operaciones de Hoy — tarjetas de "Técnicos activos"
- Cada tarjeta es ahora un botón interactivo: un clic filtra y resalta (anillo celeste) el ticket
  activo del técnico en la tabla de abajo, o sus órdenes de hoy si está "Disponible"; doble clic
  sobre una orden activa abre su detalle directo.
- Nuevo badge verde **"✓ N hoy"** con el conteo de órdenes resueltas/cerradas hoy por ese técnico.
- El cronómetro de la orden activa cambia de gris a **naranja** (más de 60 min) o **rojo** con ⚠️
  (más de 120 min), en vez de quedarse siempre del mismo color.
- Nuevos iconos **💬 WhatsApp** / **📞 Llamar** en la esquina de la tarjeta (solo si el técnico
  tiene teléfono registrado).
- Chip **"👷 Filtrando por [técnico] · [modo] ✕ Quitar filtro"** aparece sobre la tabla cuando hay
  un técnico seleccionado.

### Instalaciones / Detalle de Ticket — modal al reabrir una orden
- Nuevo modal de confirmación ("⚠️ ¿Estás seguro de reabrir esta orden? Se mantendrán guardados
  los equipos y materiales previamente asignados.") antes de bajar el estado de una orden
  Completada/Resuelta a un estado anterior — mismo estilo que el resto de modales del panel.

### Operaciones de Hoy — cabecera y pestañas
- Nuevo selector de pestañas destacado **"📋 Operaciones de Hoy" / "📁 Histórico de Atendidos"**
  arriba de todo (componente `SoporteTabs`, reusado en ambas pantallas) — reemplaza el link de
  texto chico "📁 Histórico de Atendidos →" y el botón "← Volver a Operaciones de Hoy".
- Se eliminó la fila de filtros de fecha (Hoy/Esta semana/Este mes/Calendario) de **Operaciones de
  Hoy** — esos filtros quedan exclusivos de Histórico de Atendidos.

---

## 2026-10-06

### Navegación general — logo y migas de pan
- El isotipo + "SmartRayco / Panel de gestión" del sidebar (y del header en celular) ahora es un
  enlace al Dashboard (o a Soporte si el rol es Técnico, que no tiene Dashboard propio), con una
  leve opacidad y un glow celeste alrededor del ícono al pasar el mouse.
- Nueva barra de **migas de pan** ("Inicio › Sección › Página") debajo del logo, en la cabecera de
  **todos** los módulos del panel. En el detalle de un ticket suma un último nivel dinámico con el
  número real (ej. "Inicio › Soporte › Operaciones de Hoy › TCK-2026-00026").

### Operaciones de Hoy — tarjetas de "Técnicos activos": telemetría de campo
- Cada tarjeta suma dos indicadores nuevos: **🔋 porcentaje de batería** (texto rojo si es menor a
  20%, "—" si el técnico nunca reportó) y **📍 "hace N min"** desde el último reporte GPS (texto
  ámbar "⚠️ Sin señal" si pasan más de 15 minutos sin reportar, o si nunca reportó ubicación).
- Clic en el indicador de GPS abre un modal con un mapa (Leaflet/OpenStreetMap, mismo estilo que
  Mapa de Red/Mapa de Clientes) centrado en la última ubicación del técnico — el marcador y el
  centro del mapa se mueven solos si llega una ubicación más reciente mientras el modal sigue
  abierto (en vivo, vía Supabase Realtime).

### App de Campo — borrador local del cierre de trabajo
- Si Android mata el proceso en 2do plano (el técnico abre WhatsApp o la cámara a mitad de un
  cierre), al reabrir la orden aparece un toast informativo **"Se recuperó un borrador guardado de
  este cierre de trabajo"** y el formulario completo queda restaurado: notas, causa técnica,
  justificación, dBm, caja NAP, fotos del Censo/Cierre (con su miniatura) y la firma del cliente
  (se repinta como imagen fija sobre el lienzo).

### Inventario — nuevo módulo "Activos y Herramientas"
- Botón nuevo en la cabecera de Inventario (`🧰 Activos y Herramientas`) que lleva a
  `/inventario/activos-fijos`, pantalla nueva con el mismo estilo que Flota vehicular.
- 3 tarjetas de categoría clicables (filtran la tabla): **📱 Celulares Corporativos**, **🛠️
  Herramientas de Campo**, **🥾 Indumentaria y EPP**.
- Banner rojo arriba de la tabla cuando hay activos con vida útil agotada ("🔁 Elegible para
  renovación por empresa"), mismo estilo que el aviso de vehículos urgentes.
- Tabla con badge de **Estado** (Nuevo/En uso — Buen estado/En uso — Desgastado/Dañado-Reparación/
  Dado de baja) y badge de **Vida útil** con semáforo rojo/ámbar/verde (`ALERTA_BADGE_CLASS`,
  reutilizado de Flota) — en activos dañados o dados de baja muestra además "Repos. sugerida: S/
  X.XX" (costo depreciado).
- Modal de alta/edición con secciones "Datos del activo", "Asignación" y "Cargo de recepción"
  (subida de PDF/foto del cargo firmado, mismo patrón que el SOAT de Flota).

### Soporte — "Nuevo ticket": técnico ya no es obligatorio al reservar turno
- El modal de creación de ticket ya no bloquea con "Elegiste un turno — selecciona también el
  técnico" — se puede reservar fecha/turno dejando "Sin asignar" y asignar el técnico después. El
  texto de ayuda bajo el selector de técnico se actualizó para explicarlo.

### Histórico de Atendidos — deep link a lo que llenó el técnico
- Al hacer clic en una fila "Alta" ya completada, ahora lleva directo a la ficha del cliente,
  pestaña "Fotos" (`?tab=fotos`), en vez de al listado de instalaciones filtrado por nombre.

### Nuevo módulo "Control de Asistencia"
- **App de Campo** (home del técnico, `/campo`): tarjeta nueva arriba de todo, "🕐 Marcación de
  Jornada" — banner "📌 Hoy Lunes: Reunión Semanal — Ingreso 7:30 AM" (ámbar/celeste) o "⏰ Ingreso
  8:00 AM" el resto de días, botones secuenciales 🟢 Marcar Ingreso → 🍲 Iniciar Almuerzo (2h) →
  🛠️ Fin Almuerzo → 🔴 Marcar Salida, badge de estado (Puntual/Tardanza/En Almuerzo/Finalizado) y
  cronómetro inverso grande (mono, rojo si se excede) durante el almuerzo.
- **Panel Web**: ícono de reloj nuevo al pie del sidebar ("Marcar asistencia") que abre un modal
  compacto con el mismo widget — disponible para todo el staff, no solo técnicos.
- **Nueva página** `/asistencia` (menú Configuración → "Control de Asistencia", solo
  SUPERADMIN/ADMIN): tablero en vivo del día (badges resumen Puntuales/Tardanzas/En almuerzo/
  Faltas), tabla por colaborador con mapa flotante de ubicación (Leaflet, círculo celeste =
  geocerca de oficina, pines verde/celeste/rojo = ingreso/fin de almuerzo/salida), reporte mensual
  con exportar a CSV, gestión de feriados y configuración de geocerca/horarios/tolerancia.

### App de Campo — "Disponibles" ahora incluye Altas y Rutinas
- Antes solo mostraba Averías sin técnico (Fase 98); una Alta o Rutina sin asignar quedaba
  invisible para todos los técnicos. Ahora la pestaña "Disponibles" suma las 3, y la ficha de una
  orden sin técnico muestra el botón "🙋‍♂️ Tomar esta instalación" / "🙋‍♂️ Tomar esta rutina"
  (mismo candado amarillo que ya tenían las averías libres, bloqueando materiales/cierre hasta
  tomarla).

### App de Campo — conflicto de UX en "Firma del cliente"
- El botón "Borrar" (ahora "🗑️ Limpiar firma") se movió de la esquina inferior derecha del
  recuadro de firma a la cabecera, junto al label "Firma del cliente *(obligatoria)" — quedaba
  tapado por los FAB nativos de Inicio/Actualizar del APK, justo donde el cliente apoya el dedo
  para firmar.
- `CampoLayout.vue`: padding inferior de la página de `pb-8` a `pb-32`, para que el botón
  principal (Completar instalación / Resolver avería...) nunca quede bajo esos FAB al hacer
  scroll hasta el final.
- APK (`mobile_app/lib/main.dart`): los FAB de Inicio/Actualizar pasaron de la esquina inferior
  derecha (default de Flutter) a la inferior izquierda. APK reconstruido y copiado a
  `C:\Users\USER\Desktop\SmartRayco.apk`.

### Ficha del cliente — día de emisión hasta 31
- "Nuevo servicio" (modal) y "Edición de servicio" (pestaña Datos del servicio): el campo "Fecha
  de emisión (día del mes)" aceptaba máximo 28. Ahora acepta 1-31, con una nota debajo
  ("En meses más cortos se emite el último día del mes") y mensaje propio si se sale de rango.

### Detalle de Ticket (Panel Web) — título y descripción editables
- Botón nuevo "✏️ Editar" junto al título (solo admin/soporte, no técnico) — convierte el `<h1>`
  en un input y la tarjeta "Descripción" en un `<textarea>`, con "Guardar cambios"/"Cancelar"
  debajo de la descripción. Al guardar: toast de éxito ("Descripción del ticket actualizada
  correctamente") y una nota automática en "Seguimiento" (ej. "Actualizó el título y la
  descripción del ticket.", con el autor ya identificado ahí mismo por el timeline existente).

---

## Cómo se sigue actualizando este archivo

Cada vez que se aplique un cambio visual nuevo (color, layout, componente, texto de interfaz,
ícono), se agrega una entrada bajo la fecha correspondiente (nueva sección `## AAAA-MM-DD` si es
un día distinto al último registrado), con el mismo nivel de detalle que arriba: qué pantalla,
qué cambió exactamente, y los valores de color/clase relevantes si aplica.
