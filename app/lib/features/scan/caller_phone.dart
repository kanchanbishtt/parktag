import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/theme.dart';
import '../../core/widgets.dart';

final _indianMobile = RegExp(r'^[6-9]\d{9}$');

/// Whether the server will accept this as the number a masked call rings
/// back. Port of isDialableNumber (scanner/app.js), which mirrors
/// isMobileIdentifier and toE164 on the server: Indian mobiles with or
/// without 0 or 91, and international numbers written with + or 00.
bool isDialableNumber(String raw) {
  final shape = raw.trim().replaceAll(RegExp(r'[\s\-()]'), '');
  if (!RegExp(r'^\+?\d{7,15}$').hasMatch(shape)) return false;
  if (shape.startsWith('+')) return shape.length - 1 >= 8;
  if (shape.startsWith('00')) return shape.length - 2 >= 8;
  if (shape.length == 11 && shape.startsWith('0')) {
    return _indianMobile.hasMatch(shape.substring(1));
  }
  if (shape.length == 12 && shape.startsWith('91')) {
    return _indianMobile.hasMatch(shape.substring(2));
  }
  return _indianMobile.hasMatch(shape);
}

/// Last four digits, for the same-SIM note.
String lastFourDigits(String raw) {
  final d = raw.replaceAll(RegExp(r'\D'), '');
  return d.length <= 4 ? d : d.substring(d.length - 4);
}

/// Asks the caller's own number. The masked route only connects calls from
/// this number, so the same-SIM note shows before dialling.
Future<String?> askCallerPhone(
  BuildContext context, {
  required String title,
  String initial = '',
  bool emergency = false,
}) {
  return showPtSheet<String>(
    context,
    builder: (ctx) => _PhoneSheet(title, initial, emergency),
  );
}

class _PhoneSheet extends StatefulWidget {
  const _PhoneSheet(this.title, this.initial, this.emergency);

  final String title;
  final String initial;
  final bool emergency;

  @override
  State<_PhoneSheet> createState() => _PhoneSheetState();
}

class _PhoneSheetState extends State<_PhoneSheet> {
  late final _ctrl = TextEditingController(text: widget.initial);

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final text = _ctrl.text.trim();
    final valid = isDialableNumber(text);
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          widget.title,
          style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 12),
        TextField(
          key: const Key('caller-phone'),
          controller: _ctrl,
          autofocus: true,
          keyboardType: TextInputType.phone,
          inputFormatters: [
            FilteringTextInputFormatter.allow(RegExp(r'[\d+\s\-()]')),
            LengthLimitingTextInputFormatter(20),
          ],
          decoration: InputDecoration(
            labelText: 'Your mobile number',
            helperText: widget.emergency
                ? "So the emergency contact's call can reach you."
                : "So the owner's call can reach you.",
            counterText: '',
          ),
          onChanged: (_) => setState(() {}),
        ),
        if (valid) ...[
          const SizedBox(height: 8),
          Text(
            'Call from the SIM with number ending ${lastFourDigits(text)}.',
            style: const TextStyle(color: PtColors.amberDeep),
          ),
        ],
        const SizedBox(height: 16),
        FilledButton(
          onPressed: valid ? () => Navigator.pop(context, text) : null,
          child: const Text('Call'),
        ),
      ],
    );
  }
}

/// The receipt for a registered call: the virtual number on screen in case
/// the dialler did not open, and a Tap to Call retry.
class DialCard extends StatelessWidget {
  const DialCard({
    super.key,
    required this.number,
    required this.onCall,
    this.emergency = false,
    this.locationShared = false,
  });

  final String number;
  final VoidCallback onCall;
  final bool emergency;
  final bool locationShared;

  @override
  Widget build(BuildContext context) {
    const muted = TextStyle(color: PtColors.muted);
    return Card(
      color: emergency ? PtColors.amberBg : null,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              emergency
                  ? "Emergency number: dial this if your phone doesn't open automatically"
                  : "Virtual number: dial this if your phone doesn't open automatically",
            ),
            const SizedBox(height: 4),
            SelectableText(
              number,
              style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 8),
            Text(
              emergency
                  ? "Connecting you to the owner's emergency contact. Your number stays private."
                  : 'Your number stays completely private throughout the call.',
              style: muted,
            ),
            if (emergency && locationShared)
              const Text(
                'Car location shared with the emergency contact.',
                style: muted,
              ),
            if (!emergency)
              const Text(
                "This number connects you to this vehicle's owner for the next few minutes. To call again later, scan the sticker again.",
                style: muted,
              ),
            const SizedBox(height: 12),
            FilledButton.icon(
              style: emergency
                  ? FilledButton.styleFrom(backgroundColor: PtColors.error)
                  : null,
              onPressed: onCall,
              icon: const Icon(Icons.call_rounded),
              label: const Text('Tap to Call'),
            ),
          ],
        ),
      ),
    );
  }
}
