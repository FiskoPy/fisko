import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../l10n/generated/app_localizations.dart';
import '../auth/application/auth_controller.dart';

// Marco 1: minimal profile showing the logged-in user + logout. Fiscal
// settings come later.
class PerfilPage extends ConsumerWidget {
  const PerfilPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final user = ref.watch(authControllerProvider.select((s) => s.user));

    return Scaffold(
      appBar: AppBar(title: Text(l10n.perfil)),
      body: ListView(
        children: [
          const SizedBox(height: 16),
          if (user != null) ...[
            ListTile(
              leading: const Icon(Icons.person),
              title: Text(user.name),
              subtitle: Text(user.email),
            ),
            if (user.ruc != null)
              ListTile(
                leading: const Icon(Icons.badge_outlined),
                title: Text(l10n.ruc),
                subtitle: Text('${user.ruc}-${user.rucDv ?? ''}'),
              ),
            const Divider(),
          ],
          ListTile(
            leading: const Icon(Icons.logout),
            title: Text(l10n.logout),
            onTap: () => ref.read(authControllerProvider.notifier).logout(),
          ),
        ],
      ),
    );
  }
}
