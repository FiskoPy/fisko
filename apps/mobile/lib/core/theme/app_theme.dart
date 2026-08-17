import 'package:flutter/material.dart';

/// Semantic colours that carry fiscal meaning, not decoration.
///
/// The organising idea of the Fisko palette is that Paraguayan IVA has exactly
/// two rates. So [iva5] and [iva10] are reserved: green always means 5%, amber
/// always means 10%, on every screen, chart and report. Nothing else is allowed
/// to use them, which is what makes a glance at any chart readable without a
/// legend.
@immutable
class FiskoColors extends ThemeExtension<FiskoColors> {
  const FiskoColors({
    required this.iva5,
    required this.iva10,
    required this.credito,
    required this.debito,
    required this.categories,
  });

  /// IVA 5% — always this green.
  final Color iva5;

  /// IVA 10% — always this amber.
  final Color iva10;

  /// IVA crédito (compras) and débito (ventas): the two sides of one ledger,
  /// so they read as two weights of the same blue rather than two hues.
  final Color credito;
  final Color debito;

  /// Cycled through the category breakdown, in order.
  final List<Color> categories;

  Color categoryAt(int i) => categories[i % categories.length];

  @override
  FiskoColors copyWith({
    Color? iva5,
    Color? iva10,
    Color? credito,
    Color? debito,
    List<Color>? categories,
  }) {
    return FiskoColors(
      iva5: iva5 ?? this.iva5,
      iva10: iva10 ?? this.iva10,
      credito: credito ?? this.credito,
      debito: debito ?? this.debito,
      categories: categories ?? this.categories,
    );
  }

  @override
  FiskoColors lerp(ThemeExtension<FiskoColors>? other, double t) {
    if (other is! FiskoColors) return this;
    return FiskoColors(
      iva5: Color.lerp(iva5, other.iva5, t)!,
      iva10: Color.lerp(iva10, other.iva10, t)!,
      credito: Color.lerp(credito, other.credito, t)!,
      debito: Color.lerp(debito, other.debito, t)!,
      categories: t < 0.5 ? categories : other.categories,
    );
  }
}

/// Fisko visual theme — es-PY tax app for Paraguayan contribuyentes.
class AppTheme {
  const AppTheme._();

  // Azul Ypacaraí: deep, calm azure. Institutional enough for a fiscal tool,
  // warmer than a bank navy, and deliberately not the default indigo.
  static const Color _azul = Color(0xFF14508F);
  static const Color _celeste = Color(0xFF3E8FD4);

  static const Color _verde = Color(0xFF2E8B6F); // IVA 5%
  static const Color _ambar = Color(0xFFE0A32E); // IVA 10%

  // Dark-mode variants: same hues, lifted for contrast on dark surfaces.
  static const Color _verdeDark = Color(0xFF4FBFA0);
  static const Color _ambarDark = Color(0xFFF2C05C);
  static const Color _celesteDark = Color(0xFF7FB6E8);

  /// Distinct hues for the category breakdown. Deliberately avoids the exact
  /// iva5/iva10 values so a category bar is never mistaken for a rate.
  static const List<Color> _categoriesLight = [
    Color(0xFF14508F), // azul
    Color(0xFF3E8FD4), // celeste
    Color(0xFF5B7FA6), // azul grisáceo
    Color(0xFFC2703D), // terracota
    Color(0xFF7A5EA8), // ciruela
    Color(0xFF3F8C8C), // petróleo
    Color(0xFF9A7B2F), // oliva
    Color(0xFFB8556E), // frambuesa
    Color(0xFF4E6E4A), // musgo
    Color(0xFF8C6A57), // arcilla
    Color(0xFF2F6F9E), // acero
    Color(0xFF7C8794), // pizarra
  ];

  static const List<Color> _categoriesDark = [
    Color(0xFF7FB6E8),
    Color(0xFF9CCBF0),
    Color(0xFFA3B8CE),
    Color(0xFFE3A077),
    Color(0xFFB49BDB),
    Color(0xFF6FBDBD),
    Color(0xFFD4B463),
    Color(0xFFE08CA3),
    Color(0xFF8FB089),
    Color(0xFFC0A08D),
    Color(0xFF6FA6D2),
    Color(0xFFB0B8C2),
  ];

  static ThemeData get light {
    final scheme = ColorScheme.fromSeed(seedColor: _azul).copyWith(
      primary: _azul,
      secondary: _celeste,
      tertiary: _ambar,
      surface: const Color(0xFFF4F6F9), // neblina
    );
    return _base(
      scheme,
      const FiskoColors(
        iva5: _verde,
        iva10: _ambar,
        credito: _celeste,
        debito: _azul,
        categories: _categoriesLight,
      ),
    );
  }

  static ThemeData get dark {
    final scheme = ColorScheme.fromSeed(
      seedColor: _azul,
      brightness: Brightness.dark,
    ).copyWith(secondary: _celesteDark, tertiary: _ambarDark);
    return _base(
      scheme,
      const FiskoColors(
        iva5: _verdeDark,
        iva10: _ambarDark,
        credito: _celesteDark,
        debito: Color(0xFFA8C8EC),
        categories: _categoriesDark,
      ),
    );
  }

  static ThemeData _base(ColorScheme scheme, FiskoColors fisko) {
    final base = ThemeData(useMaterial3: true, colorScheme: scheme);

    return base.copyWith(
      extensions: [fisko],
      scaffoldBackgroundColor: scheme.surface,
      appBarTheme: AppBarTheme(
        backgroundColor: scheme.surface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        centerTitle: false,
        titleTextStyle: base.textTheme.titleLarge?.copyWith(
          fontWeight: FontWeight.w600,
          letterSpacing: -0.4,
          color: scheme.onSurface,
        ),
      ),
      textTheme: base.textTheme.copyWith(
        // Headings are tightened; a fiscal screen is dense and loose tracking
        // makes it read as a marketing page rather than a ledger.
        headlineSmall: base.textTheme.headlineSmall?.copyWith(
          fontWeight: FontWeight.w600,
          letterSpacing: -0.5,
        ),
        titleLarge: base.textTheme.titleLarge?.copyWith(
          fontWeight: FontWeight.w600,
          letterSpacing: -0.4,
        ),
        titleMedium: base.textTheme.titleMedium?.copyWith(
          fontWeight: FontWeight.w600,
          letterSpacing: -0.2,
        ),
      ),
      cardTheme: CardThemeData(
        elevation: 0,
        margin: EdgeInsets.zero,
        color: scheme.surfaceContainerLowest,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(color: scheme.outlineVariant.withValues(alpha: 0.6)),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: scheme.outlineVariant),
        ),
        filled: true,
        fillColor: scheme.surfaceContainerLowest,
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size.fromHeight(50),
          textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        ),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: scheme.surfaceContainerLowest,
        surfaceTintColor: Colors.transparent,
        indicatorColor: scheme.primary.withValues(alpha: 0.14),
        elevation: 0,
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
    );
  }

  /// Monetary figures use tabular (fixed-width) digits so columns of Guaraníes
  /// line up. Costs nothing — no bundled font — and is the difference between a
  /// ledger and a list.
  static const List<FontFeature> tabularFigures = [FontFeature.tabularFigures()];
}
