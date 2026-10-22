import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'api.dart';
import 'theme.dart';

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
  const EmptyState(
      {super.key, required this.title, this.body, this.icon, this.action});

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
          Text(title,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
          if (body != null) ...[
            const SizedBox(height: 6),
            Text(body!,
                textAlign: TextAlign.center,
                style: const TextStyle(color: PtColors.muted)),
          ],
          if (action != null) ...[const SizedBox(height: 16), action!],
        ],
      ),
    );
  }
}

/// Bottom sheet with 22px top corners, max width 480 and max height 90%.
Future<T?> showPtSheet<T>(BuildContext context,
    {required WidgetBuilder builder}) {
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
        borderRadius: BorderRadius.vertical(top: Radius.circular(PtRadii.sheet))),
    builder: (ctx) => Padding(
      padding: EdgeInsets.only(
          left: 20,
          right: 20,
          top: 20,
          bottom: 20 + MediaQuery.viewInsetsOf(ctx).bottom),
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
  const OtpField(
      {super.key, required this.controller, this.onCompleted, this.autofocus = true});

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
          fontSize: 24, letterSpacing: 8, fontWeight: FontWeight.w700),
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
                    Text(title,
                        style: const TextStyle(
                            fontSize: 16, fontWeight: FontWeight.w800)),
                    Text(subtitle, style: const TextStyle(color: PtColors.muted)),
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
          color: bg, borderRadius: BorderRadius.circular(PtRadii.pill)),
      child: Text(label,
          style: TextStyle(color: fg, fontSize: 12, fontWeight: FontWeight.w700)),
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

/// Floating pill nav: the active tab is filled accent with a white label,
/// inactive tabs show the icon only.
class PtNavBar extends StatelessWidget {
  const PtNavBar(
      {super.key, required this.items, required this.index, required this.onTap});

  final List<PtNavItem> items;
  final int index;
  final ValueChanged<int> onTap;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      minimum: const EdgeInsets.fromLTRB(16, 0, 16, 12),
      child: Container(
        height: 64,
        padding: const EdgeInsets.all(6),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.92),
          borderRadius: BorderRadius.circular(PtRadii.pill),
          boxShadow: PtShadows.lg,
        ),
        child: Row(
          children: [
            for (var i = 0; i < items.length; i++)
              Expanded(
                flex: i == index ? 2 : 1,
                child: Semantics(
                  button: true,
                  selected: i == index,
                  label: items[i].label,
                  child: GestureDetector(
                    behavior: HitTestBehavior.opaque,
                    onTap: () => onTap(i),
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 180),
                      decoration: BoxDecoration(
                        color: i == index ? PtColors.accent : Colors.transparent,
                        borderRadius: BorderRadius.circular(PtRadii.pill),
                      ),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(items[i].icon,
                              color: i == index
                                  ? Colors.white
                                  : PtColors.navInactive),
                          if (i == index) ...[
                            const SizedBox(width: 6),
                            Flexible(
                              child: Text(items[i].label,
                                  overflow: TextOverflow.fade,
                                  softWrap: false,
                                  style: const TextStyle(
                                      color: Colors.white,
                                      fontWeight: FontWeight.w700)),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
