// Detecta si el panel corre dentro del WebView de la APK Android (vs. un
// navegador normal, de escritorio o celular). mobile_app/lib/main.dart le
// agrega el sufijo "SmartRaycoApp/1.0" al User-Agent por defecto del
// WebView (sin reemplazarlo) antes de cargar el panel -- un mecanismo
// explicito, no una suposicion por ancho de pantalla (que tambien es
// angosto en un celular con navegador normal).
export const isNativeApp =
  typeof navigator !== 'undefined' && navigator.userAgent.includes('SmartRaycoApp');
