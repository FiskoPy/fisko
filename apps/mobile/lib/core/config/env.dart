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

  /// Host serving the public legal pages, derived from [apiBaseUrl] by dropping
  /// the /api/v1 suffix — they are mounted at the root, not under the API.
  static String get _origin {
    final i = apiBaseUrl.indexOf('/api/');
    return i > 0 ? apiBaseUrl.substring(0, i) : apiBaseUrl;
  }

  static String get privacyUrl => '$_origin/privacidad';
  static String get deleteAccountUrl => '$_origin/eliminar-cuenta';
}
