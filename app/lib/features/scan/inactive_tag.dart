import 'package:flutter/material.dart';

import '../../core/theme.dart';

/// A tag its owner switched off (web #tag-off-card). Still theirs, so it is
/// not offered for activation: only the owner's dashboard turns it back on.
class InactiveTagCard extends StatelessWidget {
  const InactiveTagCard({
    super.key,
    required this.onGet,
    required this.onOwner,
  });

  final VoidCallback onGet;
  final VoidCallback onOwner;

  @override
  Widget build(BuildContext context) {
    const muted = TextStyle(color: PtColors.muted);
    return ListView(
      padding: const EdgeInsets.all(PtLayout.padX),
      children: [
        const SizedBox(height: 24),
        const Icon(Icons.pause_circle_outline, size: 56, color: PtColors.muted),
        const SizedBox(height: 12),
        const Text(
          'This tag is inactive',
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 8),
        const Text(
          "The owner has turned this ParkTag off for now, so it can't be used to contact them. Thank you for taking the time to scan it.",
          textAlign: TextAlign.center,
          style: muted,
        ),
        const SizedBox(height: 12),
        const Text(
          'Want a ParkTag for your own vehicle? Get yours from the link below.',
          textAlign: TextAlign.center,
          style: muted,
        ),
        const SizedBox(height: 16),
        FilledButton(onPressed: onGet, child: const Text('Get a ParkTag')),
        const SizedBox(height: 8),
        TextButton(
          onPressed: onOwner,
          child: const Text(
            'Is this your vehicle? Turn the tag back on from your dashboard.',
            textAlign: TextAlign.center,
          ),
        ),
      ],
    );
  }
}
