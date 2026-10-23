import 'package:flutter/material.dart';

/// A text style copied from the web's CSS. Chrome lays Inter out at 1.21em
/// where the stylesheet says `line-height: normal`; Flutter reads other
/// metrics from the same font file, so every copied style fixes its line box
/// and centres the glyphs in it, which is what the browser does.
TextStyle wt(
  double size, {
  FontWeight weight = FontWeight.w400,
  Color color = const Color(0xFF03162D),
  double height = 1.21,
  double? spacing,
  String? family,
}) => TextStyle(
  fontFamily: family,
  fontSize: size,
  fontWeight: weight,
  fontVariations: [FontVariation('wght', weight.value.toDouble())],
  color: color,
  height: height,
  leadingDistribution: TextLeadingDistribution.even,
  letterSpacing: spacing,
);
