import 'package:flutter/material.dart';

bool _looksLikeEmail(String value) {
  return RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(value);
}

class EmailField extends StatelessWidget {
  const EmailField({
    required this.controller,
    required this.label,
    this.textInputAction,
    this.onSubmitted,
    super.key,
  });

  final TextEditingController controller;
  final String label;
  final TextInputAction? textInputAction;
  final VoidCallback? onSubmitted;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: controller,
      keyboardType: TextInputType.emailAddress,
      // `username` as well as `email`: Android's password manager keys a saved
      // credential on the username field, and without it the password below is
      // never offered back.
      autofillHints: const [AutofillHints.username, AutofillHints.email],
      textInputAction: textInputAction,
      onFieldSubmitted: onSubmitted == null ? null : (_) => onSubmitted!(),
      autocorrect: false,
      textCapitalization: TextCapitalization.none,
      decoration: InputDecoration(labelText: label),
      validator: (v) {
        final value = (v ?? '').trim();
        if (value.isEmpty) return 'Este campo es obligatorio';
        if (!_looksLikeEmail(value)) return 'Correo electrónico inválido';
        return null;
      },
    );
  }
}

class PasswordField extends StatefulWidget {
  const PasswordField({
    required this.controller,
    required this.label,
    this.minLength = 8,
    this.autofillHint = AutofillHints.newPassword,
    this.textInputAction,
    this.onSubmitted,
    super.key,
  });

  final TextEditingController controller;
  final String label;

  /// Strength rule. Only meaningful where a password is being *chosen*; a login
  /// screen must pass 1, because the stored password is whatever it already is.
  final int minLength;

  /// `newPassword` where one is being chosen (sign-up, reset) so Android offers
  /// to generate and save it; `password` when signing in, so it is offered back.
  final String autofillHint;
  final TextInputAction? textInputAction;
  final VoidCallback? onSubmitted;

  @override
  State<PasswordField> createState() => _PasswordFieldState();
}

class _PasswordFieldState extends State<PasswordField> {
  bool _obscure = true;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: widget.controller,
      obscureText: _obscure,
      autofillHints: [widget.autofillHint],
      textInputAction: widget.textInputAction,
      onFieldSubmitted:
          widget.onSubmitted == null ? null : (_) => widget.onSubmitted!(),
      // Flutter suppresses autocorrect and the suggestion strip only while
      // obscureText is true. Tapping the eye turns the field into a plain text
      // input, at which point the keyboard can silently rewrite what is typed.
      // Set them explicitly so the field behaves the same either way.
      autocorrect: false,
      enableSuggestions: false,
      keyboardType: TextInputType.visiblePassword,
      textCapitalization: TextCapitalization.none,
      decoration: InputDecoration(
        labelText: widget.label,
        suffixIcon: IconButton(
          icon: Icon(_obscure ? Icons.visibility : Icons.visibility_off),
          onPressed: () => setState(() => _obscure = !_obscure),
        ),
      ),
      validator: (v) {
        final value = v ?? '';
        if (value.isEmpty) return 'Este campo es obligatorio';
        if (value.length < widget.minLength) {
          return 'La contraseña debe tener al menos ${widget.minLength} caracteres';
        }
        return null;
      },
    );
  }
}

class PlainTextField extends StatelessWidget {
  const PlainTextField({
    required this.controller,
    required this.label,
    this.required = true,
    this.keyboardType,
    super.key,
  });

  final TextEditingController controller;
  final String label;
  final bool required;
  final TextInputType? keyboardType;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: controller,
      keyboardType: keyboardType,
      decoration: InputDecoration(labelText: label),
      validator: required
          ? (v) => (v ?? '').trim().isEmpty ? 'Este campo es obligatorio' : null
          : null,
    );
  }
}
