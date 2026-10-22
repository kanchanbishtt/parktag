import 'package:flutter/material.dart';

import '../../core/theme.dart';
import 'call_state.dart';
import 'contact_view.dart' show alertedBody, alertedCallBody, alertedText;

/// The WhatsApp alert receipt. Sits where the alert form was.
class Alerted extends StatelessWidget {
  const Alerted({super.key, required this.callOpen});

  final bool callOpen;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: PtColors.success.withValues(alpha: 0.1),
      borderRadius: BorderRadius.circular(PtRadii.r12),
    ),
    child: Row(
      children: [
        const Icon(Icons.check_circle_rounded, color: PtColors.success),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                alertedText,
                style: TextStyle(fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 4),
              Text(callOpen ? alertedCallBody : alertedBody),
            ],
          ),
        ),
      ],
    ),
  );
}

class Note extends StatelessWidget {
  const Note(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.only(top: 8),
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: PtColors.amberBg,
      borderRadius: BorderRadius.circular(PtRadii.r12),
    ),
    child: Text(text),
  );
}

/// A lapsed subscription. Says nothing about payment: the reader is a
/// stranger at a car who can do nothing about it.
class LapsedPanel extends StatelessWidget {
  const LapsedPanel({super.key});

  @override
  Widget build(BuildContext context) => const Padding(
    padding: EdgeInsets.only(bottom: 12),
    child: Column(
      children: [
        Icon(Icons.phone_disabled_rounded, size: 40, color: PtColors.muted),
        SizedBox(height: 8),
        Text(
          lapsedTitle,
          style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
        ),
        SizedBox(height: 4),
        Text(lapsedBody, textAlign: TextAlign.center),
      ],
    ),
  );
}
