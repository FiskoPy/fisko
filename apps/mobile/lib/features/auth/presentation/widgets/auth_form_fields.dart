import 'package:flutter/material.dart';

bool _looksLikeEmail(String value) {
  return RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(value);
}

class EmailField extends StatelessWidget {
  const EmailField({required this.controller, required this.label, super.key});

  final TextEditingController controller;
  final String label;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: controller,
      keyboardType: TextInputType.emailAddress,
      autofillHints: const [AutofillHints.email],
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
    super.key,
  });

  final TextEditingController controller;
  final String label;
  final int minLength;

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
