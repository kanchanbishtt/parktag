import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../core/widgets.dart';

/// Create-PIN (with confirm) or unlock panel.
class VaultPinPanel extends StatelessWidget {
  const VaultPinPanel({
    super.key,
    required this.setting,
    required this.pin,
    required this.pin2,
    required this.error,
    required this.busy,
    required this.onSubmit,
  });

  final bool setting;
  final TextEditingController pin;
  final TextEditingController pin2;
  final String? error;
  final bool busy;
  final VoidCallback onSubmit;

  @override
  Widget build(BuildContext context) {
    return ListView(
      key: ValueKey(setting ? 'vault-set-pin' : 'vault-unlock'),
      padding: const EdgeInsets.all(PtLayout.padX),
      children: [
        const Icon(Icons.lock_rounded, size: 48, color: PtColors.navy),
        const SizedBox(height: 12),
        Text(
          setting ? 'Create a vault PIN' : 'Enter your vault PIN',
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 6),
        Text(
          setting
              ? 'Use 4 to 8 digits. Avoid easy ones like 1234. It protects your RC, insurance and licence.'
              : 'Your documents stay locked until you enter it.',
          textAlign: TextAlign.center,
          style: const TextStyle(color: PtColors.muted),
        ),
        const SizedBox(height: 20),
        PinField(
          controller: pin,
          label: 'Vault PIN',
          autofocus: true,
          onSubmitted: setting ? null : (_) => onSubmit(),
        ),
        if (setting) ...[
          const SizedBox(height: 12),
          PinField(
            controller: pin2,
            label: 'Confirm PIN',
            onSubmitted: (_) => onSubmit(),
          ),
        ],
        if (error != null) ...[
          const SizedBox(height: 12),
          Text(error!, style: const TextStyle(color: PtColors.error)),
        ],
        const SizedBox(height: 20),
        FilledButton(
          onPressed: busy ? null : onSubmit,
          child: Text(setting ? 'Set PIN' : 'Unlock'),
        ),
      ],
    );
  }
}
