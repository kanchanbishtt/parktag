import 'package:flutter/material.dart';

/// Design tokens from src/frontend/styles/styles.css and owner-welcome.css.
abstract final class PtColors {
  static const bg = Color(0xFFF1F1F0);
  static const panel = Color(0xFFFFFFFF);
  static const ink = Color(0xFF03162D);
  static const navy = ink;
  static const muted = Color(0xFF495B7B);
  static const line = Color(0xFFE2E8F0);
  static const accent = Color(0xFFFF2700);
  static const accentDark = Color(0xFFD92200);
  static const amberDeep = Color(0xFFC81F00);
  static const amberBg = Color(0xFFFFEDEA);
  static const whatsapp = Color(0xFF25D366);
  static const whatsappDark = Color(0xFF128C7E);
  static const error = Color(0xFFDC2626);
  static const success = Color(0xFF16A34A);
  static const navInactive = Color(0xFFB0B7C3);
}

abstract final class PtRadii {
  static const r10 = 10.0;
  static const r12 = 12.0;
  static const r14 = 14.0;
  static const r16 = 16.0;
  static const r20 = 20.0;
  static const pill = 999.0;
  static const sheet = 22.0;
}

abstract final class PtLayout {
  static const padX = 18.0;
  static const headerSide = 18.0;
  static const sheetMaxWidth = 480.0;
  static const sheetMaxHeightFactor = 0.9;
}

abstract final class PtShadows {
  static const card = [
    BoxShadow(color: Color(0x14001935), offset: Offset(0, 4), blurRadius: 24),
  ];
  static const lg = [
    BoxShadow(color: Color(0x1F001935), offset: Offset(0, 8), blurRadius: 40),
  ];
}

ThemeData buildTheme() {
  final scheme = ColorScheme.fromSeed(
    seedColor: PtColors.accent,
    primary: PtColors.accent,
    onPrimary: Colors.white,
    surface: PtColors.panel,
    onSurface: PtColors.ink,
    error: PtColors.error,
  );
  final rounded = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(PtRadii.r14));
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    fontFamily: 'Inter',
    scaffoldBackgroundColor: PtColors.bg,
    dividerColor: PtColors.line,
    appBarTheme: const AppBarTheme(
      backgroundColor: PtColors.navy,
      foregroundColor: Colors.white,
      elevation: 0,
      titleTextStyle: TextStyle(
          fontFamily: 'Inter', fontSize: 18, fontWeight: FontWeight.w700),
    ),
    cardTheme: CardThemeData(
      color: PtColors.panel,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(PtRadii.r16),
          side: const BorderSide(color: PtColors.line)),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: PtColors.accent,
        foregroundColor: Colors.white,
        minimumSize: const Size.fromHeight(52),
        shape: rounded,
        textStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: PtColors.ink,
        minimumSize: const Size.fromHeight(52),
        side: const BorderSide(color: PtColors.line),
        shape: rounded,
        textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: PtColors.panel,
      border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(PtRadii.r12),
          borderSide: const BorderSide(color: PtColors.line)),
      enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(PtRadii.r12),
          borderSide: const BorderSide(color: PtColors.line)),
      focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(PtRadii.r12),
          borderSide: const BorderSide(color: PtColors.accent, width: 1.5)),
    ),
    snackBarTheme: const SnackBarThemeData(
        behavior: SnackBarBehavior.floating, backgroundColor: PtColors.ink),
  );
}
