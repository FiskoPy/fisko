/// App-wide constants and route paths.
class AppRoutes {
  const AppRoutes._();

  static const String login = '/login';
  static const String register = '/register';
  static const String forgot = '/forgot';
  static const String reset = '/reset';

  static const String dashboard = '/dashboard';
  static const String captura = '/captura';
  static const String relatorios = '/relatorios';
  static const String perfil = '/perfil';
  static const String conectarEmail = 'email'; // nested under /perfil
}

class StorageKeys {
  const StorageKeys._();

  static const String accessToken = 'fisko.access_token';
  static const String refreshToken = 'fisko.refresh_token';
}
