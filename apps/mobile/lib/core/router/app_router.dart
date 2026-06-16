import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/auth/application/auth_controller.dart';
import '../../features/auth/application/auth_state.dart';
import '../../features/auth/presentation/forgot_password_page.dart';
import '../../features/auth/presentation/login_page.dart';
import '../../features/auth/presentation/register_page.dart';
import '../../features/auth/presentation/reset_password_page.dart';
import '../../features/dashboard/dashboard_page.dart';
import '../../features/email/presentation/conectar_email_page.dart';
import '../../features/invoices/presentation/captura_page.dart';
import '../../features/invoices/presentation/invoice_detail_page.dart';
import '../../features/perfil/perfil_page.dart';
import '../../features/relatorios/relatorios_page.dart';
import '../../features/shell/app_shell.dart';
import '../config/constants.dart';

/// Bridges a Riverpod listenable into go_router's [refreshListenable].
class _RouterRefresh extends ChangeNotifier {
  _RouterRefresh(Ref ref) {
    ref.listen(
      authControllerProvider.select((s) => s.status),
      (_, __) => notifyListeners(),
    );
  }
}

final goRouterProvider = Provider<GoRouter>((ref) {
  final refresh = _RouterRefresh(ref);

  final shellNavKey = GlobalKey<NavigatorState>();

  return GoRouter(
    initialLocation: '/',
    refreshListenable: refresh,
    redirect: (context, state) {
      final status = ref.read(authControllerProvider).status;
      final loc = state.matchedLocation;
      const publicRoutes = {
        AppRoutes.login,
        AppRoutes.register,
        AppRoutes.forgot,
        AppRoutes.reset,
      };
      final isPublic = publicRoutes.contains(loc);

      if (status == AuthStatus.unknown) {
        return loc == '/' ? null : '/';
      }
      if (status == AuthStatus.unauthenticated) {
        return isPublic ? null : AppRoutes.login;
      }
      // authenticated
      if (loc == '/' || isPublic) return AppRoutes.dashboard;
      return null;
    },
    routes: [
      GoRoute(
        path: '/',
        builder: (_, __) => const _SplashPage(),
      ),
      GoRoute(path: AppRoutes.login, builder: (_, __) => const LoginPage()),
      GoRoute(path: AppRoutes.register, builder: (_, __) => const RegisterPage()),
      GoRoute(path: AppRoutes.forgot, builder: (_, __) => const ForgotPasswordPage()),
      GoRoute(
        path: AppRoutes.reset,
        builder: (_, state) => ResetPasswordPage(token: state.uri.queryParameters['token']),
      ),
      ShellRoute(
        navigatorKey: shellNavKey,
        builder: (_, __, child) => AppShell(child: child),
        routes: [
          GoRoute(path: AppRoutes.dashboard, builder: (_, __) => const DashboardPage()),
          GoRoute(
            path: AppRoutes.captura,
            builder: (_, __) => const CapturaPage(),
            routes: [
              GoRoute(
                path: ':id',
                builder: (_, state) => InvoiceDetailPage(id: state.pathParameters['id']!),
              ),
            ],
          ),
          GoRoute(path: AppRoutes.relatorios, builder: (_, __) => const RelatoriosPage()),
          GoRoute(
            path: AppRoutes.perfil,
            builder: (_, __) => const PerfilPage(),
            routes: [
              GoRoute(
                path: AppRoutes.conectarEmail,
                builder: (_, __) => const ConectarEmailPage(),
              ),
            ],
          ),
        ],
      ),
    ],
  );
});

class _SplashPage extends StatelessWidget {
  const _SplashPage();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(body: Center(child: CircularProgressIndicator()));
  }
}
