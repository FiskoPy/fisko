import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/config/constants.dart';
import '../../../l10n/generated/app_localizations.dart';
import '../../../shared/widgets/auth_message_listener.dart';
import '../application/auth_controller.dart';
import 'widgets/auth_form_fields.dart';

/// Reached via the reset link `/reset?token=...`. If the token is missing the
/// user can still paste it manually.
class ResetPasswordPage extends ConsumerStatefulWidget {
  const ResetPasswordPage({this.token, super.key});

  final String? token;

  @override
  ConsumerState<ResetPasswordPage> createState() => _ResetPasswordPageState();
}

class _ResetPasswordPageState extends ConsumerState<ResetPasswordPage> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _token =
      TextEditingController(text: widget.token ?? '');
  final _password = TextEditingController();

  @override
  void dispose() {
    _token.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    final ok = await ref.read(authControllerProvider.notifier).resetPassword(
          token: _token.text.trim(),
          newPassword: _password.text,
        );
    if (ok && mounted) {
      context.go(AppRoutes.login);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final isSubmitting =
        ref.watch(authControllerProvider.select((s) => s.isSubmitting));

    return Scaffold(
      appBar: AppBar(title: Text(l10n.resetPasswordTitle)),
      body: AuthMessageListener(
        child: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 420),
                child: Form(
                  key: _formKey,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      PlainTextField(controller: _token, label: 'Token'),
                      const SizedBox(height: 16),
                      PasswordField(controller: _password, label: l10n.newPassword),
                      const SizedBox(height: 24),
                      FilledButton(
                        onPressed: isSubmitting ? null : _submit,
                        child: isSubmitting
                            ? const SizedBox(
                                height: 20,
                                width: 20,
                                child: CircularProgressIndicator(strokeWidth: 2),
                              )
                            : Text(l10n.resetPassword),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
