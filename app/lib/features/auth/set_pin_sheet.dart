import 'package:flutter/material.dart';

import '../../core/api.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'auth_flow.dart';

/// Offers a login PIN to a new owner. Skippable. Resolves true when a PIN was set.
Future<bool> showSetPinNudge(BuildContext context, ApiClient api) async {
  final set = await showPtSheet<bool>(
    context,
    builder: (_) => SetPinSheet(api: api),
  );
  return set ?? false;
}

class SetPinSheet extends StatefulWidget {
  const SetPinSheet({super.key, required this.api});

  final ApiClient api;

  @override
  State<SetPinSheet> createState() => _SetPinSheetState();
}

class _SetPinSheetState extends State<SetPinSheet> {
  final _pin = TextEditingController();
  final _confirm = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _pin.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final pin = _pin.text;
    if (pin.length < 6 || pin.length > 8) {
      return setState(() => _error = 'Use 6 to 8 digits.');
    }
    if (pin != _confirm.text) {
      return setState(() => _error = 'The two PINs do not match.');
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.api
          .post('/api/owner/login-pin', {'pin': pin, 'confirmPin': _confirm.text});
      if (mounted) Navigator.of(context).pop(true);
    } on ApiError catch (e) {
      // The server explains weak PINs and a clash with the vault PIN.
      if (mounted) setState(() => _error = errorText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text('Set a login PIN',
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
        const SizedBox(height: 6),
        const Text(
            'Sign in faster next time with your mobile number and a 6 to 8 digit PIN.',
            style: TextStyle(color: PtColors.muted)),
        const SizedBox(height: 16),
        PinField(controller: _pin, label: 'New PIN', autofocus: true),
        const SizedBox(height: 12),
        PinField(
            controller: _confirm,
            label: 'Confirm PIN',
            onSubmitted: (_) => _busy ? null : _save()),
        if (_error != null) ...[
          const SizedBox(height: 12),
          Text(_error!, style: const TextStyle(color: PtColors.error)),
        ],
        const SizedBox(height: 20),
        FilledButton(
          onPressed: _busy ? null : _save,
          child: Text(_busy ? 'Saving...' : 'Set PIN'),
        ),
        TextButton(
          onPressed: _busy ? null : () => Navigator.of(context).pop(false),
          child: const Text('Skip for now'),
        ),
      ],
    );
  }
}
