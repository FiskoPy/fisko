import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/config/constants.dart';
import '../auth/application/auth_controller.dart';
import '../insights/insights_section.dart';

/// What a brand-new account sees on Inicio.
///
/// It used to be an icon and the sentence "Sin datos todavía", which reads as
/// a broken screen: the first person to open the app finds nothing, and the
/// welcome guidance the server already returns from /insights was thrown away
/// with it. This keeps that guidance and says, in one screen, the three ways
/// an invoice gets in.
class FirstRunView extends ConsumerWidget {
  const FirstRunView({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final user = ref.watch(authControllerProvider).user;
    final firstName = (user?.name ?? '').split(' ').first;

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
      children: [
        Text(
          firstName.isEmpty ? 'Bienvenido a Fisko' : 'Bienvenido, $firstName',
          style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 6),
        Text(
          'Cuando entren tus primeras facturas, acá vas a ver tu IVA 5% y 10%, '
          'tus ventas y compras, y la estimación de IRP.',
          style: TextStyle(color: theme.colorScheme.outline),
        ),
        const SizedBox(height: 20),

        // The server's own onboarding nudge, with its working action button.
        const InsightsSection(),

        Text('Cómo empezar', style: theme.textTheme.titleMedium),
        const SizedBox(height: 10),
        _StartCard(
          icon: Icons.mark_email_read_outlined,
          title: 'Conectá tu correo',
          body: 'Fisko busca solo las facturas electrónicas que te llegan como adjunto. '
              'Es la forma más cómoda: se importan sin que hagas nada.',
          cta: 'Conectar correo',
          onTap: () => context.go('${AppRoutes.perfil}/${AppRoutes.conectarEmail}'),
        ),
        const SizedBox(height: 10),
        _StartCard(
          icon: Icons.upload_file,
          title: 'Importá un XML',
          body: 'Si ya tenés el archivo XML de una factura electrónica, cargalo '
              'desde la pestaña Captura.',
          cta: 'Ir a Captura',
          onTap: () => context.go(AppRoutes.captura),
        ),
        const SizedBox(height: 10),
        _StartCard(
          icon: Icons.photo_camera_outlined,
          title: 'Sacale una foto a una factura de papel',
          body: 'En Captura, tocá el ícono de cámara arriba a la derecha y Fisko '
              'lee los datos por vos.',
          cta: 'Ir a Captura',
          onTap: () => context.go(AppRoutes.captura),
        ),

        if (user != null && user.ruc == null) ...[
          const SizedBox(height: 20),
          Card(
            color: theme.colorScheme.errorContainer,
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(Icons.badge_outlined, size: 20, color: theme.colorScheme.onErrorContainer),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Te falta cargar tu RUC',
                          style: TextStyle(
                            fontWeight: FontWeight.w600,
                            color: theme.colorScheme.onErrorContainer,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'Sin RUC no podemos separar tus ventas de tus compras: todo '
                          'cuenta como compra y el IVA débito queda en cero. '
                          'Cargalo en Perfil.',
                          style: TextStyle(
                            fontSize: 12,
                            color: theme.colorScheme.onErrorContainer,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ],
    );
  }
}

class _StartCard extends StatelessWidget {
  const _StartCard({
    required this.icon,
    required this.title,
    required this.body,
    required this.cta,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String body;
  final String cta;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 12, 14, 6),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(icon, size: 20, color: theme.colorScheme.primary),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    title,
                    style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Padding(
              padding: const EdgeInsets.only(left: 30),
              child: Text(body, style: const TextStyle(fontSize: 13)),
            ),
            Align(
              alignment: Alignment.centerRight,
              child: TextButton(onPressed: onTap, child: Text(cta)),
            ),
          ],
        ),
      ),
    );
  }
}
