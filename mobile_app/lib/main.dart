import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';

// URL del panel SmartRayco que esta app empaqueta. Si alguna vez cambia de
// dominio, este es el unico lugar que hay que tocar (coincide con _panelHost).
const String _panelUrl = 'https://panel.rayconetworks.com/';
const String _panelHost = 'panel.rayconetworks.com';

// MIUI (Xiaomi) mata el proceso de la app muy seguido en segundo plano (ej.
// el tecnico sale a tomar una foto o a WhatsApp) — al volver, Android recrea
// todo desde cero y el WebView pierde su historial. No hay forma de recuperar
// un formulario a medio llenar sin codigo nativo Android (el plugin no expone
// WebView.saveState/restoreState), pero si se puede volver a la MISMA pagina
// en la que estaba en vez de reiniciar desde el login/dashboard.
const String _lastUrlPrefsKey = 'smartrayco_last_url';

void main() {
  runApp(const SmartRaycoApp());
}

class SmartRaycoApp extends StatelessWidget {
  const SmartRaycoApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'SmartRayco',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorSchemeSeed: const Color(0xFF0EA5E9), // sky-500, el mismo acento del panel web
        useMaterial3: true,
      ),
      home: const PanelWebView(),
    );
  }
}

class PanelWebView extends StatefulWidget {
  const PanelWebView({super.key});

  @override
  State<PanelWebView> createState() => _PanelWebViewState();
}

class _PanelWebViewState extends State<PanelWebView> {
  late final WebViewController _controller;
  bool _loading = true;
  String? _loadError;

  // Controla la franja de Inicio/Recargar (_buildNavBar): debe ocultarse en
  // pantallas publicas sin sesion (hoy solo /login -- /cambiar-password
  // siempre exige sesion en el router de Vue, asi que nunca se alcanza "sin
  // sesion"). Se infiere de la ruta real que ya decide el router del panel
  // (el mismo requiresAuth que usa el panel web), no de un sistema de auth
  // propio del lado de Flutter. Empieza en true para no mostrar la franja
  // un instante antes de saber en que pantalla se entra.
  bool _isPublicRoute = true;

  @override
  void initState() {
    super.initState();
    _controller = _buildController();
    _loadInitialUrl();
  }

  void _updatePublicRoute(String? url) {
    final path = Uri.tryParse(url ?? '')?.path ?? '';
    final isPublic = path.isEmpty || path == '/' || path == '/login';
    if (isPublic != _isPublicRoute) {
      setState(() => _isPublicRoute = isPublic);
    }
  }

  Future<void> _loadInitialUrl() async {
    final prefs = await SharedPreferences.getInstance();
    final lastUrl = prefs.getString(_lastUrlPrefsKey);
    final target = lastUrl != null && Uri.tryParse(lastUrl)?.host == _panelHost ? lastUrl : _panelUrl;
    _updatePublicRoute(target);
    await _controller.loadRequest(Uri.parse(target));
  }

  WebViewController _buildController() {
    final controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(Colors.white)
      ..setNavigationDelegate(
        NavigationDelegate(
          onPageStarted: (url) {
            _updatePublicRoute(url);
            setState(() {
              _loading = true;
              _loadError = null;
            });
          },
          onPageFinished: (url) {
            _updatePublicRoute(url);
            setState(() => _loading = false);
            // Para que, si Android mata el proceso en segundo plano, la app
            // vuelva a abrir en la misma pagina en vez de desde cero.
            if (Uri.tryParse(url)?.host == _panelHost) {
              SharedPreferences.getInstance().then((p) => p.setString(_lastUrlPrefsKey, url));
            }
          },
          // El panel es una SPA (Vue Router en modo history): navegar de
          // /login a /dashboard tras iniciar sesion NO dispara una carga de
          // pagina nueva (onPageStarted/onPageFinished no se enteran), solo
          // cambia la URL via pushState. onUrlChange si se entera de eso --
          // es la unica forma de que la franja reaccione a un login/logout
          // sin recargar la pagina.
          onUrlChange: (change) => _updatePublicRoute(change.url),
          onWebResourceError: (error) {
            // Solo los errores de navegacion principal (no un recurso suelto,
            // como un icono o un script de terceros que falle) deben tapar la
            // pantalla con el aviso de "sin conexion".
            if (error.isForMainFrame ?? true) {
              setState(() {
                _loading = false;
                _loadError = error.description;
              });
            }
          },
          // El panel tiene enlaces "externos" normales (<a href="https://wa.me/...">,
          // Google Maps, Waze, tel:) pensados para que el navegador se los pase al
          // sistema operativo. El WebView no sabe hacer eso solo: sin esto, intenta
          // cargarlos el mismo, no puede (no existe un "navegador" dentro de
          // whatsapp:// o tras la redireccion de wa.me) y se ve como si el panel
          // entero se hubiera caido ("No se pudo cargar el panel").
          onNavigationRequest: (request) {
            final uri = Uri.tryParse(request.url);
            if (uri == null) return NavigationDecision.navigate;

            final isHttp = uri.scheme == 'http' || uri.scheme == 'https';
            final isOwnDomain = uri.host == _panelHost || uri.host.endsWith('.$_panelHost');
            if (isHttp && isOwnDomain) return NavigationDecision.navigate;

            launchUrl(uri, mode: LaunchMode.externalApplication).catchError((_) => false);
            return NavigationDecision.prevent;
          },
        ),
      );
    // La carga inicial la dispara _loadInitialUrl() (initState), no aqui:
    // primero hay que leer la ultima pagina guardada en SharedPreferences.

    // Lo de abajo (geolocalizacion, selector de archivos/camara) depende de
    // la API especifica de Android: webview_flutter mantiene una superficie
    // minima multiplataforma y expone el resto via el controller nativo.
    final androidController = controller.platform as AndroidWebViewController;

    // El panel pide GPS al registrar instalaciones/tickets — se pide el
    // permiso nativo recien cuando el sitio lo solicita, no al arrancar.
    androidController.setGeolocationPermissionsPromptCallbacks(
      onShowPrompt: (request) async {
        final granted = await _ensurePermission(Permission.locationWhenInUse);
        return GeolocationPermissionsResponse(allow: granted, retain: true);
      },
    );

    // <input type="file"> en el panel (fotos de instalaciones/averias): deja
    // elegir entre camara y galeria en vez del selector generico de Android,
    // que en varios fabricantes no ofrece la camara como opcion directa.
    androidController.setOnShowFileSelector(_onShowFileSelector);

    return controller;
  }

  Future<bool> _ensurePermission(Permission permission) async {
    final status = await permission.status;
    if (status.isGranted) return true;
    final result = await permission.request();
    return result.isGranted;
  }

  Future<List<String>> _onShowFileSelector(FileSelectorParams params) async {
    final source = await _pickImageSource();
    if (source == null) return [];

    if (source == ImageSource.camera && !await _ensurePermission(Permission.camera)) {
      return [];
    }

    final picked = await ImagePicker().pickImage(source: source, imageQuality: 85);
    if (picked == null) return [];
    return [Uri.file(picked.path).toString()];
  }

  Future<ImageSource?> _pickImageSource() {
    return showModalBottomSheet<ImageSource>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        child: Wrap(
          children: [
            ListTile(
              leading: const Icon(Icons.photo_camera_outlined),
              title: const Text('Tomar foto'),
              onTap: () => Navigator.pop(sheetContext, ImageSource.camera),
            ),
            ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: const Text('Elegir de la galería'),
              onTap: () => Navigator.pop(sheetContext, ImageSource.gallery),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _reload() async {
    setState(() {
      _loading = true;
      _loadError = null;
    });
    await _controller.reload();
  }

  // Botón "Inicio": vuelve siempre a la raíz del panel sin depender del
  // historial interno del WebView (que un tecnico puede perder facil si
  // Android mata el proceso en segundo plano). El propio panel decide a que
  // pantalla mandar a cada rol ya autenticado (dashboard, campo, etc.).
  Future<void> _goHome() async {
    setState(() {
      _loading = true;
      _loadError = null;
    });
    await _controller.loadRequest(Uri.parse(_panelUrl));
  }

  Future<void> _handleBack(bool didPop, Object? result) async {
    if (didPop) return;
    if (await _controller.canGoBack()) {
      await _controller.goBack();
    } else {
      // Sin esto, PopScope(canPop: false) se traga el "Atras" para siempre
      // una vez que ya no queda historial dentro del WebView.
      SystemNavigator.pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: _handleBack,
      child: Scaffold(
        // Sin AppBar de Flutter (58dp fijos, con titulo/logo) -- el panel ya
        // trae su propia cabecera. En vez de eso, una franja angosta propia
        // de solo 2 iconos (sin logo/titulo, cero duplicacion) que vive en
        // su PROPIO espacio por encima del WebView. A diferencia de los FAB
        // flotantes anteriores (que tapaban el perfil del tecnico y los
        // botones inferiores del sidebar cuando estaba abierto, y el
        // recuadro de firma del cliente), esta franja nunca se superpone a
        // nada del panel porque no flota sobre el contenido -- le resta su
        // propia altura fija, chica, al WebView.
        body: SafeArea(
          child: Column(
            children: [
              if (!_isPublicRoute) _buildNavBar(),
              Expanded(
                child: Stack(
                  children: [
                    WebViewWidget(controller: _controller),
                    if (_loading)
                      const Positioned.fill(
                        child: ColoredBox(
                          color: Color(0x11000000),
                          child: Center(child: CircularProgressIndicator()),
                        ),
                      ),
                    if (_loadError != null) _buildErrorOverlay(),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // Franja compacta (36dp) con Inicio/Recargar -- reemplaza a los FAB
  // flotantes. Mismas funciones (_goHome/_reload), ningun sistema de
  // navegacion nuevo. Solo iconos (sin logo ni texto "SmartRayco": eso ya
  // lo muestra la cabecera del panel debajo, evita duplicarlo).
  Widget _buildNavBar() {
    return Container(
      height: 36,
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(bottom: BorderSide(color: Color(0xFFE2E8F0))),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.end,
        children: [
          _NavBarButton(icon: Icons.home_outlined, tooltip: 'Inicio', onPressed: _goHome),
          _NavBarButton(icon: Icons.refresh, tooltip: 'Recargar', onPressed: _reload),
          const SizedBox(width: 4),
        ],
      ),
    );
  }

  Widget _buildErrorOverlay() {
    return Positioned.fill(
      child: ColoredBox(
        color: Colors.white,
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.wifi_off_rounded, size: 48, color: Colors.grey),
                const SizedBox(height: 12),
                const Text(
                  'No se pudo cargar el panel. Revisa tu conexión a internet.',
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 16),
                FilledButton.icon(
                  onPressed: _reload,
                  icon: const Icon(Icons.refresh),
                  label: const Text('Reintentar'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// Boton chico de icono solo (sin el padding/tamaño de un IconButton
// default de Material, pensado para caber en una franja de 36dp).
class _NavBarButton extends StatelessWidget {
  const _NavBarButton({required this.icon, required this.tooltip, required this.onPressed});

  final IconData icon;
  final String tooltip;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: InkWell(
        onTap: onPressed,
        customBorder: const CircleBorder(),
        child: Padding(
          padding: const EdgeInsets.all(8),
          child: Icon(icon, size: 20, color: const Color(0xFF0EA5E9)),
        ),
      ),
    );
  }
}
