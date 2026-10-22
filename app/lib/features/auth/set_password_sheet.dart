import 'package:flutter/material.dart';

import '../../core/api.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'auth_flow.dart';

/// Offers a password to a new email owner, like the web /owner-verify
/// set-password step. Skippable. Resolves true when a password was set.
Future<bool> showSetPasswordNudge(BuildContext context, ApiClient api) async {
  final set = await showPtSheet<bool>(
    context,
    builder: (_) => SetPasswordSheet(api: api),
  );
  return set ?? false;
}

class SetPasswordSheet extends StatefulWidget {
  const SetPasswordSheet({super.key, required this.api});

  final ApiClient api;

  @override
  State<SetPasswordSheet> createState() => _SetPasswordSheetState();
}

class _SetPasswordSheetState extends State<SetPasswordSheet> {
  final _password = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _password.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final password = _password.text.trim();
    if (password.length < 8) {
      return setState(() => _error = 'Password must be at least 8 characters.');
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.api.post('/api/owner/set-password', {'password': password});
      if (mounted) Navigator.of(context).pop(true);
    } on ApiError catch (e) {
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
        const Text('Set a password',
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
        const SizedBox(height: 6),
        const Text('Sign in next time with your email and password, no code needed.',
            style: TextStyle(color: PtColors.muted)),
        const SizedBox(height: 16),
        TextField(
          controller: _password,
          autofocus: true,
          obscureText: true,
          autofillHints: const [AutofillHints.newPassword],
          decoration: const InputDecoration(labelText: 'New password'),
          onSubmitted: (_) => _busy ? null : _save(),
        ),
        if (_error != null) ...[
          const SizedBox(height: 12),
          Text(_error!, style: const TextStyle(color: PtColors.error)),
        ],
        const SizedBox(height: 20),
        FilledButton(
          onPressed: _busy ? null : _save,
          child: Text(_busy ? 'Saving...' : 'Set password'),
        ),
        TextButton(
          onPressed: _busy ? null : () => Navigator.of(context).pop(false),
          child: const Text('Skip for now'),
        ),
      ],
    );
  }
}
