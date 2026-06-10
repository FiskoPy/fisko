import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:google_sign_in/google_sign_in.dart';

import '../../../core/config/constants.dart';
import '../../../core/config/env.dart';
import '../../../l10n/generated/app_localizations.dart';
import '../../../shared/widgets/auth_message_listener.dart';
import '../application/auth_controller.dart';
import 'widgets/auth_form_fields.dart';

class LoginPage extends ConsumerStatefulWidget {
  const LoginPage({super.key});

  @override
  ConsumerState<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends ConsumerState<LoginPage> {
  final _formKey = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    await ref.read(authControllerProvider.notifier).login(
          email: _email.text.trim(),
          password: _password.text,
        );
  }

  Future<void> _googleSignIn() async {
    if (!Env.hasGoogleClientId) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Google OAuth no está configurado.')),
      );
      return;
    }
    try {
      final googleSignIn = GoogleSignIn(
        scopes: const ['email'],
        serverClientId: Env.googleOauthClientId,
      );
      final account = await googleSignIn.signIn();
      final idToken = (await account?.authentication)?.idToken;
      if (idToken == null) return;
      await ref.read(authControllerProvider.notifier).loginWithGoogle(idToken);
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No se pudo iniciar sesión con Google.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final isSubmitting =
        ref.watch(authControllerProvider.select((s) => s.isSubmitting));

    return Scaffold(
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
                      Text(
                        l10n.appName,
                        textAlign: TextAlign.center,
                        style: Theme.of(context).textTheme.headlineMedium,
                      ),
                      const SizedBox(height: 32),
                      EmailField(controller: _email, label: l10n.email),
                      const SizedBox(height: 16),
                      PasswordField(controller: _password, label: l10n.password),
                      const SizedBox(height: 8),
                      Align(
                        alignment: Alignment.centerRight,
                        child: TextButton(
                          onPressed: () => context.push(AppRoutes.forgot),
                          child: Text(l10n.forgotPassword),
                        ),
                      ),
                      const SizedBox(height: 8),
                      FilledButton(
                        onPressed: isSubmitting ? null : _submit,
                        child: isSubmitting
                            ? const _ButtonSpinner()
                            : Text(l10n.login),
                      ),
                      const SizedBox(height: 12),
                      OutlinedButton.icon(
                        onPressed: isSubmitting ? null : _googleSignIn,
                        icon: const Icon(Icons.login),
                        label: Text(l10n.continueWithGoogle),
                      ),
                      const SizedBox(height: 16),
                      Wrap(
                        alignment: WrapAlignment.center,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          Text(l10n.noAccount),
                          TextButton(
                            onPressed: () => context.push(AppRoutes.register),
                            child: Text(l10n.register),
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

class _ButtonSpinner extends StatelessWidget {
  const _ButtonSpinner();

  @override
  Widget build(BuildContext context) {
    return const SizedBox(
      height: 20,
      width: 20,
      child: CircularProgressIndicator(strokeWidth: 2),
    );
  }
}
