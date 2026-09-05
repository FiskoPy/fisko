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

  /// The code is 64 hex chars in one line, which is exactly the kind of string
  /// a chat app breaks across lines or a finger selects half of. Strip anything
  /// that is not hex before validating, and say *how many* characters are
  /// missing so the user knows to re-copy rather than assume the code expired.
  static String _cleanCode(String raw) =>
      raw.replaceAll(RegExp(r'[^0-9a-fA-F]'), '').toLowerCase();

  String? _validateCode(String? v) {
    final c = _cleanCode(v ?? '');
    if (c.isEmpty) return 'Pegá el código de recuperación';
    if (c.length != 64) {
      return 'El código está incompleto (${c.length} de 64 caracteres). '
          'Volvé a copiarlo entero.';
    }
    return null;
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    final ok = await ref.read(authControllerProvider.notifier).resetPassword(
          token: _cleanCode(_token.text),
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
                      TextFormField(
                        controller: _token,
                        validator: _validateCode,
                        autovalidateMode: AutovalidateMode.onUserInteraction,
                        keyboardType: TextInputType.visiblePassword,
                        autocorrect: false,
                        enableSuggestions: false,
                        maxLines: 2,
                        style: const TextStyle(fontFamily: 'monospace', fontSize: 13),
                        decoration: const InputDecoration(
                          labelText: 'Código de recuperación',
                          helperText: '64 caracteres. Pegalo entero, sin espacios.',
                        ),
                      ),
                      const SizedBox(height: 16),
                      AutofillGroup(
                        child: PasswordField(
                          controller: _password,
                          label: l10n.newPassword,
                          textInputAction: TextInputAction.done,
                          onSubmitted: _submit,
                        ),
                      ),
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
