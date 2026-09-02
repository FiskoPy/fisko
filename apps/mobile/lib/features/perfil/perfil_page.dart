import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/config/constants.dart';
import '../../core/config/env.dart';
import '../../l10n/generated/app_localizations.dart';
import '../auth/application/auth_controller.dart';
import '../auth/domain/ruc_validator.dart';
import '../subscriptions/data/subscription_api.dart';

class PerfilPage extends ConsumerWidget {
  const PerfilPage({super.key});

  Future<void> _openPrivacy(BuildContext context) async {
    final uri = Uri.parse(Env.privacyUrl);
    final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!ok && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('No se pudo abrir ${Env.privacyUrl}')),
      );
    }
  }

  /// Two-step confirmation: deleting is irreversible and cascades to every
  /// invoice and mailbox credential, so a single tap must not be enough.
  /// Asks for the RUC and its check digit, validating the digit locally so an
  /// obvious typo never costs a round trip.
  Future<void> _editRuc(
    BuildContext context,
    WidgetRef ref,
    String? currentRuc,
    int? currentDv,
  ) async {
    final rucCtrl = TextEditingController(text: currentRuc ?? '');
    final dvCtrl = TextEditingController(text: currentDv?.toString() ?? '');
    final formKey = GlobalKey<FormState>();

    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Tu RUC'),
        content: Form(
          key: formKey,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                'Lo usamos para separar tus ventas de tus compras. '
                'Cargá el número sin el dígito verificador, y el dígito aparte.',
                style: TextStyle(fontSize: 13),
              ),
              const SizedBox(height: 14),
              TextFormField(
                controller: rucCtrl,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(labelText: 'RUC', hintText: '80175384'),
                validator: (v) {
                  final r = RucValidator.normalize(v ?? '');
                  if (r.length < 3) return 'Ingresá tu RUC';
                  return null;
                },
              ),
              const SizedBox(height: 10),
              TextFormField(
                controller: dvCtrl,
                keyboardType: TextInputType.number,
                maxLength: 1,
                decoration: const InputDecoration(
                  labelText: 'Dígito verificador',
                  hintText: '8',
                  counterText: '',
                ),
                validator: (v) {
                  final dv = int.tryParse((v ?? '').trim());
                  if (dv == null) return 'Ingresá el dígito';
                  final r = RucValidator.normalize(rucCtrl.text);
                  if (r.length >= 3 && !RucValidator.isValid(r, dv)) {
                    return 'No corresponde a ese RUC';
                  }
                  return null;
                },
              ),
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
          FilledButton(
            onPressed: () {
              if (formKey.currentState?.validate() ?? false) Navigator.pop(ctx, true);
            },
            child: const Text('Guardar'),
          ),
        ],
      ),
    );

    if (ok != true) return;
    await ref.read(authControllerProvider.notifier).setRuc(
          ruc: RucValidator.normalize(rucCtrl.text),
          rucDv: int.parse(dvCtrl.text.trim()),
        );
  }

  Future<void> _confirmDelete(BuildContext context, WidgetRef ref) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Eliminar mi cuenta'),
        content: const Text(
          'Se borrarán tu cuenta, todas las facturas que importaste y las casillas '
          'de correo conectadas.\n\nEsta acción no se puede deshacer.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(ctx).colorScheme.error,
              foregroundColor: Theme.of(ctx).colorScheme.onError,
            ),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Eliminar'),
          ),
        ],
      ),
    );
    if (confirmed != true || !context.mounted) return;

    final ok = await ref.read(authControllerProvider.notifier).deleteAccount();
    if (!context.mounted) return;
    if (ok) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Tu cuenta fue eliminada.')),
      );
      return;
    }
    // Perfil is outside the auth screens, so AuthMessageListener is not mounted
    // here — show the reason ourselves instead of failing silently.
    final reason = ref.read(authControllerProvider).errorMessage;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(reason ?? 'No se pudo eliminar la cuenta.'),
        backgroundColor: Theme.of(context).colorScheme.error,
      ),
    );
    ref.read(authControllerProvider.notifier).clearMessages();
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final user = ref.watch(authControllerProvider.select((s) => s.user));
    final busy = ref.watch(authControllerProvider.select((s) => s.isSubmitting));
    final scheme = Theme.of(context).colorScheme;
    final sub = ref.watch(mySubscriptionProvider);

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
            // Always shown. It used to appear only when a RUC existed, so a
            // user who skipped it at sign-up had no way back — and without a
            // RUC the server counts every invoice as a purchase.
            ListTile(
              leading: Icon(
                Icons.badge_outlined,
                color: user.ruc == null ? scheme.error : null,
              ),
              title: Text(l10n.ruc),
              subtitle: Text(
                user.ruc != null
                    ? '${user.ruc}-${user.rucDv ?? ''}'
                    : 'Sin cargar — tus ventas no se separan de tus compras',
                style: user.ruc == null ? TextStyle(color: scheme.error) : null,
              ),
              trailing: const Icon(Icons.edit_outlined, size: 18),
              onTap: busy ? null : () => _editRuc(context, ref, user.ruc, user.rucDv),
            ),
            const Divider(),
          ],
          ListTile(
            leading: const Icon(Icons.workspace_premium_outlined),
            title: const Text('Mi plan'),
            subtitle: Text(
              sub.when(
                loading: () => 'Cargando…',
                error: (_, __) => 'Ver planes disponibles',
                data: (s) => s.isActive ? 'Plan ${s.planName}' : 'Plan Gratis',
              ),
            ),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.go('${AppRoutes.perfil}/${AppRoutes.planes}'),
          ),
          const Divider(),
          ListTile(
            leading: const Icon(Icons.mark_email_read_outlined),
            title: const Text('Conectar correo'),
            subtitle: const Text('Importar facturas automáticamente'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.go('${AppRoutes.perfil}/${AppRoutes.conectarEmail}'),
          ),
          const Divider(),
          ListTile(
            leading: const Icon(Icons.privacy_tip_outlined),
            title: const Text('Política de privacidad'),
            trailing: const Icon(Icons.open_in_new, size: 18),
            onTap: () => _openPrivacy(context),
          ),
          ListTile(
            leading: const Icon(Icons.logout),
            title: Text(l10n.logout),
            onTap: busy ? null : () => ref.read(authControllerProvider.notifier).logout(),
          ),
          const Divider(),
          ListTile(
            leading: Icon(Icons.delete_forever_outlined, color: scheme.error),
            title: Text('Eliminar mi cuenta', style: TextStyle(color: scheme.error)),
            subtitle: const Text('Borra tu cuenta y todos tus datos'),
            onTap: busy ? null : () => _confirmDelete(context, ref),
          ),
          const SizedBox(height: 24),
          const _VersionLabel(),
          const SizedBox(height: 16),
        ],
      ),
    );
  }
}

/// Which build is this. During testing it is the only way to tell a report
/// about the current APK from one about the previous one; in the stores it is
/// what a user quotes to support.
class _VersionLabel extends StatelessWidget {
  const _VersionLabel();

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<PackageInfo>(
      future: PackageInfo.fromPlatform(),
      builder: (context, snap) {
        final info = snap.data;
        if (info == null) return const SizedBox(height: 18);
        return Center(
          child: Text(
            'Fisko ${info.version} (${info.buildNumber})',
            style: TextStyle(
              fontSize: 12,
              color: Theme.of(context).colorScheme.outline,
            ),
          ),
        );
      },
    );
  }
}
