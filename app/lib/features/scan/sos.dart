import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'scan_io.dart';

/// The public numbers, as on the web (#sos-helplines).
const helplines = [
  ('National Emergency', '112'),
  ('Ambulance', '102'),
  ('Police', '100'),
  ('Fire', '101'),
  ('Women Helpline', '1091'),
];

const helplineNoteNoContact =
    'No emergency contact added for this tag. Use the All India helplines below.';
const helplineNoteUnavailable =
    'Emergency calling is not available on this tag. Use the All India helplines below.';
const helplineNoteLimit =
    "This vehicle's emergency contact has already been called several times today. Use the All India helplines below.";
const helplineNoteOffline =
    'No connection, so the emergency call could not start. You can still dial the All India helplines below directly.';

/// Always shown with a resolved tag. Leads to the owner's emergency contact
/// or, when there is none, the helplines. 112 is not ours to withhold.
class EmergencyBlock extends StatelessWidget {
  const EmergencyBlock({super.key, required this.onPressed});

  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text(
          "Do you think the vehicle has had an accident and the owner's family or emergency contact needs to be reached?",
          style: TextStyle(color: PtColors.muted),
        ),
        const SizedBox(height: 8),
        OutlinedButton.icon(
          style: OutlinedButton.styleFrom(
            foregroundColor: PtColors.error,
            side: const BorderSide(color: PtColors.error),
          ),
          onPressed: onPressed,
          icon: const Icon(Icons.warning_amber_rounded),
          label: const Text('Emergency'),
        ),
      ],
    );
  }
}

/// The gate before a stranger's phone rings. Re-armed on every open.
Future<bool> confirmEmergency(BuildContext context) async {
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => const _SosConfirm(),
  );
  return ok == true;
}

class _SosConfirm extends StatefulWidget {
  const _SosConfirm();

  @override
  State<_SosConfirm> createState() => _SosConfirmState();
}

class _SosConfirmState extends State<_SosConfirm> {
  bool _checked = false;

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Emergency'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              "Using emergency info for spam or prank is a punishable offence. Please use this only in case of a real emergency (e.g. accident, medical need, or to reach the vehicle owner's family).",
            ),
            const SizedBox(height: 8),
            const Text(
              'If this vehicle has an emergency contact, we will ask for your location so they can find the car. Your phone number stays private.',
            ),
            CheckboxListTile(
              key: const Key('sos-confirm-check'),
              contentPadding: EdgeInsets.zero,
              controlAffinity: ListTileControlAffinity.leading,
              value: _checked,
              onChanged: (v) => setState(() => _checked = v == true),
              title: const Text(
                'I confirm this is a genuine emergency and I need to contact the owner or emergency services.',
              ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context, false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          style: FilledButton.styleFrom(backgroundColor: PtColors.error),
          onPressed: _checked ? () => Navigator.pop(context, true) : null,
          child: const Text('View emergency contacts'),
        ),
      ],
    );
  }
}

Future<void> showHelplines(BuildContext context, [String? note]) =>
    showPtSheet<void>(
      context,
      builder: (_) => HelplineCard(note: note ?? helplineNoteUnavailable),
    );

/// Dialled directly: nothing is registered, so a helpline never depends on
/// our backend being up.
class HelplineCard extends StatelessWidget {
  const HelplineCard({super.key, required this.note});

  final String note;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text(
          'Emergency contacts',
          style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 8),
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: PtColors.amberBg,
            borderRadius: BorderRadius.circular(PtRadii.r12),
          ),
          child: Text(note),
        ),
        const SizedBox(height: 12),
        const Text(
          'All India emergency helplines',
          style: TextStyle(fontWeight: FontWeight.w700),
        ),
        const Text(
          "Use these if the owner's contacts are not available.",
          style: TextStyle(color: PtColors.muted),
        ),
        for (final (label, number) in helplines)
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(label),
            trailing: FilledButton.icon(
              style: FilledButton.styleFrom(backgroundColor: PtColors.error),
              onPressed: () => ScanIo.launch(Uri(scheme: 'tel', path: number)),
              icon: const Icon(Icons.call_rounded, size: 18),
              label: Text(number),
            ),
          ),
      ],
    );
  }
}
