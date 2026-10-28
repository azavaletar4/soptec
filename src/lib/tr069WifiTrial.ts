export interface WifiTrialOperation {
  requestId: string;
  kind: 'change' | 'restore';
  actorId: string;
  before: string;
  after: string;
  sentAt: string;
  state: 'sending' | 'queued' | 'uncertain' | 'failed' | 'verified';
  taskId?: string;
  readTaskId?: string;
  readSentAt?: string;
  verifiedAt?: string;
  // Nunca la contraseña real: solo si se incluyó y su huella SHA-256, para evidencia sin poder
  // reconstruir el valor (regla 7, CLAUDE.md). Sin restauración automática de contraseña: ver
  // mensaje en pantalla.
  passwordChanged?: boolean;
  afterPasswordHash?: string;
}
export interface WifiTrialRecord {
  version: 1;
  serial: string;
  deviceId: string;
  contractNumber: string;
  path: string;
  originalSsid: string;
  originalTimestamp: string;
  operations: WifiTrialOperation[];
}
export interface WifiTrialStatus {
  enabled: boolean;
  record: WifiTrialRecord | null;
  message: string;
}

// El backend mantiene mensajes técnicos fijos y estables (GenieACS, Inform, tarea...) para que
// las pruebas y la evidencia operativa los puedan comparar literalmente. El panel administrativo
// no debe mostrar esa jerga (regla de usabilidad de CLAUDE.md): aquí se traduce solo lo que se
// muestra en pantalla, sin tocar los mensajes que emite el servicio.
const WIFI_TRIAL_PLAIN_MESSAGES: Record<string, string> = {
  'Sin cambios enviados. El respaldo se guardará antes del primer envío.':
    'Todavía no se envió ningún cambio. El nombre actual se guardará como respaldo antes del primer envío.',
  'Resultado incierto: no repetir ni restaurar a ciegas; requiere revisión de la tarea.':
    'No se pudo confirmar el resultado del último envío. No lo repitas ni intentes restaurar; espera revisión.',
  'GenieACS informa un fallo. No hay cambio confirmado; no acumular tareas.':
    'El equipo rechazó el cambio. No se aplicó nada; no vuelvas a enviarlo todavía.',
  'Pendiente del próximo Inform o de completar la tarea; todavía no confirmado.':
    'Pendiente de confirmación del equipo. Vuelve a comprobar en unos minutos.',
  'Tarea de cambio ya no pendiente. Pulsa Verificar resultado para leer este SSID.':
    'El envío ya terminó. Pulsa «Comprobar estado» para ver si se aplicó.',
  'Nuevo SSID verificado en GenieACS. Comprueba también la red y navegación.':
    'Nombre WiFi nuevo confirmado por el equipo. Revisa también que la red y la navegación sigan funcionando.',
  'SSID anterior verificado en GenieACS. Comprueba también la red y navegación.':
    'Nombre WiFi anterior restaurado y confirmado por el equipo. Revisa también que la red y la navegación sigan funcionando.',
  'Pendiente: falta un Inform nuevo o una lectura posterior con el SSID esperado.':
    'Pendiente: todavía no llega la confirmación del equipo con el nombre esperado.',
  'Cambio encolado, no confirmado. Espera el próximo Inform y pulsa Verificar resultado.':
    'Cambio enviado, todavía no confirmado. Espera unos minutos y pulsa «Comprobar estado».',
  'Envío incierto. No repitas el cambio; revisa el estado.':
    'No se pudo confirmar el envío. No lo repitas; solo comprueba el estado.',
  'Lectura con resultado incierto; no repetir tareas.':
    'No se pudo confirmar la comprobación. No la repitas por ahora.',
  'Lectura puntual encolada. Espera un nuevo Inform y consulta el estado.':
    'Comprobación enviada. Espera unos minutos y vuelve a revisar el estado.',
  'La prueba ya tiene un cambio. Verifica o restaura el respaldo antes de otra operación.':
    'Ya hay un cambio en curso para esta red. Compruébalo o restaura el nombre anterior antes de enviar otro.',
  'Primero verifica el cambio; no restaurar sobre una tarea pendiente':
    'Primero comprueba el cambio anterior; no se puede restaurar mientras está pendiente.',
  'La identidad, instancia o SSID actual cambió; vuelve a consultar':
    'El nombre WiFi cambió desde la última consulta. Cierra y vuelve a abrir esta ventana para intentarlo de nuevo.',
  'El SSID cambió fuera de esta prueba; no restaurar automáticamente':
    'El nombre WiFi cambió por otra vía; no se puede restaurar de forma automática.',
  'El SSID ya tiene ese nombre; no se envió tarea':
    'Ese ya es el nombre actual de la red; no se envió ningún cambio.',
  'Hay una operación en curso o bloqueo pendiente de revisión':
    'Hay otra operación en curso en este momento. Espera un instante e inténtalo de nuevo.',
  'SSID sin respaldo recuperable o capacidad anunciada de escritura':
    'No se pudo leer el nombre WiFi actual de forma confiable. Inténtalo de nuevo más tarde.',
  'Hay tareas pendientes en este equipo; no se envió otro cambio':
    'Hay otra operación pendiente en este equipo; espera a que termine antes de enviar un cambio.',
  'Hay fallos GenieACS de este equipo pendientes de revisión; no se envió cambio':
    'El equipo reportó un error pendiente de revisar; no se envió el cambio.',
  'SSID inválido: 1 a 32 bytes, sin controles':
    'Nombre de red inválido: usa hasta 32 caracteres, sin símbolos especiales de control.',
  'Identidad GenieACS distinta; detener':
    'No se pudo confirmar la identidad de este equipo. Vuelve a intentarlo.',
  'Contraseña inválida: 8 a 63 caracteres imprimibles en inglés, sin tildes ni emoji':
    'La contraseña debe tener entre 8 y 63 caracteres: solo letras, números y símbolos del teclado en inglés (sin tildes, eñes ni emoji).',
  'El SSID ya tiene ese nombre y no se indicó una contraseña nueva; no se envió nada':
    'No hay ningún cambio que aplicar: el nombre ya es ese y no escribiste una contraseña nueva.',
  'La contraseña de esta red no tiene capacidad de escritura confirmada; no se envió nada':
    'Este equipo no confirma que se pueda cambiar la contraseña de esta red. No se envió ningún cambio.',
};

/** Traduce únicamente para mostrar en pantalla; nunca cambia lo que el backend decide o registra. */
export function plainWifiTrialMessage(message: string | null | undefined): string | null {
  if (!message) return message ?? null;
  return WIFI_TRIAL_PLAIN_MESSAGES[message] ?? message;
}
