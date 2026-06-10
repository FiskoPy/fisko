import 'package:flutter/material.dart';

/// Fisko visual theme. Uses Material 3 with a teal/green fiscal palette.
class AppTheme {
  const AppTheme._();

  static const Color _seed = Color(0xFF0E7C66);

  static ThemeData get light {
    final scheme = ColorScheme.fromSeed(seedColor: _seed);
    return _base(scheme);
  }

  static ThemeData get dark {
    final scheme = ColorScheme.fromSeed(
      seedColor: _seed,
      brightness: Brightness.dark,
    );
    return _base(scheme);
  }

  static ThemeData _base(ColorScheme scheme) {
    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      inputDecorationTheme: const InputDecorationTheme(
        border: OutlineInputBorder(),
        filled: true,
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size.fromHeight(48),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        ),
      ),
    );
  }
}
