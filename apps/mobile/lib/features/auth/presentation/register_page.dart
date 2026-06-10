import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../l10n/generated/app_localizations.dart';
import '../../../shared/widgets/auth_message_listener.dart';
import '../application/auth_controller.dart';
import '../domain/ruc_validator.dart';
import 'widgets/auth_form_fields.dart';

class RegisterPage extends ConsumerStatefulWidget {
  const RegisterPage({super.key});

  @override
  ConsumerState<RegisterPage> createState() => _RegisterPageState();
}

class _RegisterPageState extends ConsumerState<RegisterPage> {
  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _ruc = TextEditingController();
  final _rucDv = TextEditingController();

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _password.dispose();
    _ruc.dispose();
    _rucDv.dispose();
    super.dispose();
  }

  String? _validateRuc() {
    final ruc = _ruc.text.trim();
    final dvText = _rucDv.text.trim();
    // RUC is optional; but if provided, the check digit must be valid.
    if (ruc.isEmpty && dvText.isEmpty) return null;
    if (ruc.isEmpty || dvText.isEmpty) return 'RUC o dígito verificador inválido';
    final dv = int.tryParse(dvText);
    if (dv == null || !RucValidator.isValid(ruc, dv)) {
      return 'RUC o dígito verificador inválido';
    }
    return null;
  }

  Future<void> _submit() async {
    final rucError = _validateRuc();
    if (rucError != null) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(rucError)));
      return;
    }
    if (!_formKey.currentState!.validate()) return;

    final hasRuc = _ruc.text.trim().isNotEmpty;
    await ref.read(authControllerProvider.notifier).register(
          name: _name.text.trim(),
          email: _email.text.trim(),
          password: _password.text,
          ruc: hasRuc ? RucValidator.normalize(_ruc.text) : null,
          rucDv: hasRuc ? int.tryParse(_rucDv.text.trim()) : null,
        );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final isSubmitting =
        ref.watch(authControllerProvider.select((s) => s.isSubmitting));

    return Scaffold(
      appBar: AppBar(title: Text(l10n.register)),
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
                      PlainTextField(controller: _name, label: l10n.name),
                      const SizedBox(height: 16),
                      EmailField(controller: _email, label: l10n.email),
                      const SizedBox(height: 16),
                      PasswordField(controller: _password, label: l10n.password),
                      const SizedBox(height: 16),
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            flex: 3,
                            child: PlainTextField(
                              controller: _ruc,
                              label: l10n.ruc,
                              required: false,
                              keyboardType: TextInputType.number,
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: PlainTextField(
                              controller: _rucDv,
                              label: l10n.rucDv,
                              required: false,
                              keyboardType: TextInputType.number,
                            ),
                          ),
                        ],
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
                            : Text(l10n.register),
                      ),
                      const SizedBox(height: 12),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Text(l10n.haveAccount),
                          TextButton(
                            onPressed: () => context.pop(),
                            child: Text(l10n.login),
                          ),
                        ],
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
