import 'dart:ui' show ImageFilter;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'api.dart';
import 'theme.dart';

/// The ParkTag wordmark, the same artwork as the web dashboard header. Use
/// [onDark] on navy (app bars, the splash); the dark cut carries its own navy
/// field, which merges with PtColors.navy. Never set the name in text instead.
class PtLogo extends StatelessWidget {
  const PtLogo({super.key, this.height = 28, this.onDark = false});

  final double height;
  final bool onDark;

  @override
  Widget build(BuildContext context) {
    return Image.asset(
      onDark
          ? 'assets/brand/logo-on-dark.png'
          : 'assets/brand/logo-on-light.png',
      height: height,
      fit: BoxFit.contain,
      alignment: Alignment.centerLeft,
      semanticLabel: 'ParkTag',
    );
  }
}

/// Grey placeholder rows shown before a list loads.
class Skeleton extends StatelessWidget {
  const Skeleton({super.key, this.rows = 3, this.height = 72});

  final int rows;
  final double height;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        for (var i = 0; i < rows; i++)
          Container(
            height: height,
            margin: const EdgeInsets.only(bottom: 12),
            decoration: BoxDecoration(
              color: PtColors.line,
              borderRadius: BorderRadius.circular(PtRadii.r16),
            ),
          ),
      ],
    );
  }
}

/// "What failed. Try again." with a Retry button.
class ErrorCard extends StatelessWidget {
  const ErrorCard({super.key, required this.message, this.onRetry});

  /// Builds the message from an error: server text for ApiError, else a fallback.
  ErrorCard.from(Object error, {super.key, this.onRetry})
    : message = error is ApiError ? error.message : fallbackError;

  final String message;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            const Icon(Icons.error_outline, color: PtColors.error),
            const SizedBox(width: 12),
            Expanded(child: Text(message)),
            if (onRetry != null)
              TextButton(onPressed: onRetry, child: const Text('Retry')),
          ],
        ),
      ),
    );
  }
}

class EmptyState extends StatelessWidget {
  const EmptyState({
    super.key,
    required this.title,
    this.body,
    this.icon,
    this.action,
  });

  final String title;
  final String? body;
  final IconData? icon;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 32, horizontal: 24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon ?? Icons.inbox_outlined, size: 40, color: PtColors.muted),
          const SizedBox(height: 12),
          Text(
            title,
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
          ),
          if (body != null) ...[
            const SizedBox(height: 6),
            Text(
              body!,
              textAlign: TextAlign.center,
              style: const TextStyle(color: PtColors.muted),
            ),
          ],
          if (action != null) ...[const SizedBox(height: 16), action!],
        ],
      ),
    );
  }
}

/// Bottom sheet with 22px top corners, max width 480 and max height 90%.
Future<T?> showPtSheet<T>(
  BuildContext context, {
  required WidgetBuilder builder,
}) {
  final height = MediaQuery.sizeOf(context).height;
  return showModalBottomSheet<T>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: PtColors.panel,
    constraints: BoxConstraints(
      maxWidth: PtLayout.sheetMaxWidth,
      maxHeight: height * PtLayout.sheetMaxHeightFactor,
    ),
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(PtRadii.sheet)),
    ),
    builder: (ctx) => Padding(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 20,
        bottom: 20 + MediaQuery.viewInsetsOf(ctx).bottom,
      ),
      child: SingleChildScrollView(child: builder(ctx)),
    ),
  );
}

/// Obscured numeric PIN (login PIN 6-8 digits, vault PIN).
class PinField extends StatelessWidget {
  const PinField({
    super.key,
    required this.controller,
    this.label = 'PIN',
    this.maxLength = 8,
    this.onSubmitted,
    this.autofocus = false,
  });

  final TextEditingController controller;
  final String label;
  final int maxLength;
  final ValueChanged<String>? onSubmitted;
  final bool autofocus;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      autofocus: autofocus,
      obscureText: true,
      keyboardType: TextInputType.number,
      inputFormatters: [
        FilteringTextInputFormatter.digitsOnly,
        LengthLimitingTextInputFormatter(maxLength),
      ],
      decoration: InputDecoration(labelText: label, counterText: ''),
      onSubmitted: onSubmitted,
    );
  }
}

/// 6-digit one-time code with SMS autofill hint.
class OtpField extends StatelessWidget {
  const OtpField({
    super.key,
    required this.controller,
    this.onCompleted,
    this.autofocus = true,
  });

  final TextEditingController controller;
  final ValueChanged<String>? onCompleted;
  final bool autofocus;

  static const length = 6;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      autofocus: autofocus,
      keyboardType: TextInputType.number,
      autofillHints: const [AutofillHints.oneTimeCode],
      textAlign: TextAlign.center,
      style: const TextStyle(
        fontSize: 24,
        letterSpacing: 8,
        fontWeight: FontWeight.w700,
      ),
      inputFormatters: [
        FilteringTextInputFormatter.digitsOnly,
        LengthLimitingTextInputFormatter(length),
      ],
      decoration: const InputDecoration(hintText: '••••••', counterText: ''),
      onChanged: (v) {
        if (v.length == length) onCompleted?.call(v);
      },
    );
  }
}

/// Plate, label and a status chip, used by Tags and Home.
class VehicleCard extends StatelessWidget {
  const VehicleCard({
    super.key,
    required this.title,
    required this.subtitle,
    this.active = true,
    this.premium = false,
    this.onTap,
  });

  final String title;
  final String subtitle;
  final bool active;
  final bool premium;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              const Icon(Icons.directions_car_filled, color: PtColors.navy),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    Text(
                      subtitle,
                      style: const TextStyle(color: PtColors.muted),
                    ),
                  ],
                ),
              ),
              if (premium) ...[
                const _Chip('Premium', PtColors.amberBg, PtColors.amberDeep),
                const SizedBox(width: 6),
              ],
              active
                  ? const _Chip('Active', Color(0xFFDCFCE7), PtColors.success)
                  : const _Chip('Inactive', PtColors.line, PtColors.muted),
            ],
          ),
        ),
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip(this.label, this.bg, this.fg);

  final String label;
  final Color bg;
  final Color fg;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(PtRadii.pill),
      ),
      child: Text(
        label,
        style: TextStyle(color: fg, fontSize: 12, fontWeight: FontWeight.w700),
      ),
    );
  }
}

/// Stand-in for a screen a feature unit has not built yet.
class PlaceholderScreen extends StatelessWidget {
  const PlaceholderScreen(this.title, {super.key});

  final String title;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: Center(child: Text(title)),
    );
  }
}

class PtNavItem {
  const PtNavItem(this.label, this.icon);

  final String label;
  final IconData icon;
}

/// Floating glass capsule nav. A real backdrop blur frosts whatever scrolls
/// underneath (the shell extends the body behind the bar for this), under a
/// translucent white gradient with a thin light edge and a tight navy shadow.
/// Every tab shows its icon over a small label; the active tab's icon sits in
/// a red rounded indicator and its label turns red.
///
/// The shadow is deliberately tight. A wide soft one under a near-full-width
/// capsule reads as a grey band across the page, which looks exactly like the
/// blur leaking out of the clip (it is not: the blur stays inside the capsule
/// on every renderer, checked in isolation).
class PtNavBar extends StatelessWidget {
  const PtNavBar({
    super.key,
    required this.items,
    required this.index,
    required this.onTap,
  });

  final List<PtNavItem> items;
  final int index;
  final ValueChanged<int> onTap;

  static const _blur = 28.0;
  static const _height = 58.0;

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(PtRadii.pill);
    final capsule = Container(
      height: _height,
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
      decoration: BoxDecoration(
        borderRadius: radius,
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Colors.white.withValues(alpha: 0.55),
            Colors.white.withValues(alpha: 0.32),
          ],
        ),
        border: Border.all(color: Colors.white.withValues(alpha: 0.7)),
      ),
      child: Row(
        children: [
          for (var i = 0; i < items.length; i++)
            Expanded(
              child: _NavTab(
                item: items[i],
                active: i == index,
                onTap: () => onTap(i),
              ),
            ),
        ],
      ),
    );
    return SafeArea(
      minimum: const EdgeInsets.fromLTRB(20, 0, 20, 12),
      child: DecoratedBox(
        // The shadow sits outside the clip so it is not cut off. It is kept
        // tight (small blur, pulled in by the negative spread): a wide soft
        // shadow under a near-full-width capsule read as a grey band across
        // the page, dimming the cards beside and below the bar.
        decoration: BoxDecoration(
          borderRadius: radius,
          boxShadow: [
            BoxShadow(
              color: PtColors.ink.withValues(alpha: 0.12),
              blurRadius: 16,
              spreadRadius: -6,
              offset: const Offset(0, 6),
            ),
          ],
        ),
        child: ClipRRect(
          borderRadius: radius,
          child: BackdropFilter(
            filter: ImageFilter.blur(sigmaX: _blur, sigmaY: _blur),
            child: capsule,
          ),
        ),
      ),
    );
  }
}

class _NavTab extends StatelessWidget {
  const _NavTab({
    required this.item,
    required this.active,
    required this.onTap,
  });

  final PtNavItem item;
  final bool active;
  final VoidCallback onTap;

  static const _motion = Duration(milliseconds: 220);
  static const _curve = Curves.easeOutCubic;

  @override
  Widget build(BuildContext context) {
    final inkSoft = PtColors.ink.withValues(alpha: 0.62);
    return Semantics(
      button: true,
      selected: active,
      label: item.label,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          mainAxisSize: MainAxisSize.min,
          children: [
            // The indicator: a red rounded pill behind the active icon. It is
            // always laid out at the same size so the icon never jumps, and
            // only its colour and glow animate in.
            AnimatedContainer(
              duration: _motion,
              curve: _curve,
              width: 44,
              height: 26,
              decoration: BoxDecoration(
                color: active ? PtColors.accent : Colors.transparent,
                borderRadius: BorderRadius.circular(PtRadii.pill),
                boxShadow: active
                    ? [
                        BoxShadow(
                          color: PtColors.accent.withValues(alpha: 0.38),
                          blurRadius: 12,
                          offset: const Offset(0, 4),
                        ),
                      ]
                    : const [],
              ),
              child: AnimatedScale(
                scale: active ? 1.0 : 0.94,
                duration: _motion,
                curve: _curve,
                child: Icon(
                  item.icon,
                  size: 19,
                  color: active ? Colors.white : inkSoft,
                ),
              ),
            ),
            const SizedBox(height: 2),
            AnimatedDefaultTextStyle(
              duration: _motion,
              curve: _curve,
              style: TextStyle(
                fontFamily: 'Inter',
                fontSize: 10,
                height: 1.1,
                letterSpacing: 0.1,
                fontWeight: active ? FontWeight.w700 : FontWeight.w600,
                color: active ? PtColors.accent : inkSoft,
              ),
              child: Text(
                item.label,
                maxLines: 1,
                overflow: TextOverflow.fade,
                softWrap: false,
                // The semantics node above already carries the label.
                semanticsLabel: '',
              ),
            ),
          ],
        ),
      ),
    );
  }
}
