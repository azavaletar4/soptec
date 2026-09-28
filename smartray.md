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

---

## Cómo se sigue actualizando este archivo

Cada vez que se aplique un cambio visual nuevo (color, layout, componente, texto de interfaz,
ícono), se agrega una entrada bajo la fecha correspondiente (nueva sección `## AAAA-MM-DD` si es
un día distinto al último registrado), con el mismo nivel de detalle que arriba: qué pantalla,
qué cambió exactamente, y los valores de color/clase relevantes si aplica.
