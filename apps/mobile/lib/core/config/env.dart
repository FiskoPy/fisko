/// Compile-time configuration provided via --dart-define.
///
/// Example:
///   flutter run \
///     --dart-define=API_BASE_URL=http://10.0.2.2:3000/api/v1 \
///     --dart-define=GOOGLE_OAUTH_CLIENT_ID=<client-id>
class Env {
  const Env._();

  /// Base URL of the API, including the /api/v1 prefix.
  /// 10.0.2.2 is the Android emulator alias for the host machine's localhost.
  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://10.0.2.2:3000/api/v1',
  );

  /// Google OAuth web/server client id used to obtain an idToken.
  static const String googleOauthClientId = String.fromEnvironment(
    'GOOGLE_OAUTH_CLIENT_ID',
    defaultValue: '',
  );

  static bool get hasGoogleClientId => googleOauthClientId.isNotEmpty;

  /// Whether [url] names a host only reachable from a developer's own machine
  /// or LAN.
  ///
  /// A release build made without `--dart-define=API_BASE_URL=...` silently
  /// keeps the emulator default below. On a real phone that address routes
  /// nowhere, so every call dies at the socket and the app tells the tester to
  /// check their internet — blaming them for our build mistake. This is what
  /// lets the app say "mal configurada" instead. Matched on the parsed host,
  /// not as a substring, so a public host like `10-0-2-2.example.com` is fine.
  static bool isLocalApiBaseUrl(String url) {
    if (url.trim().isEmpty) return true;

    final host = Uri.tryParse(url)?.host.toLowerCase() ?? '';
    if (host.isEmpty) return true;
    if (host == 'localhost' || host == '::1' || host == '10.0.2.2') return true;

    final octets = host.split('.');
    if (octets.length == 4 && octets.every((o) => int.tryParse(o) != null)) {
      final a = int.parse(octets[0]);
      final b = int.parse(octets[1]);
      // Loopback and the RFC 1918 private ranges: unreachable off that network.
      if (a == 127 || a == 10) return true;
      if (a == 192 && b == 168) return true;
      if (a == 172 && b >= 16 && b <= 31) return true;
    }
    return false;
  }

  /// Whether THIS build points somewhere a real device cannot reach.
  static bool get isLocalApiBase => isLocalApiBaseUrl(apiBaseUrl);

  /// Host serving the public legal pages, derived from [apiBaseUrl] by dropping
  /// the /api/v1 suffix — they are mounted at the root, not under the API.
  static String get _origin {
    final i = apiBaseUrl.indexOf('/api/');
    return i > 0 ? apiBaseUrl.substring(0, i) : apiBaseUrl;
  }

  static String get privacyUrl => '$_origin/privacidad';
  static String get deleteAccountUrl => '$_origin/eliminar-cuenta';
}
