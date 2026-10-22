import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/api.dart';
import '../../core/app_state.dart';
import '../../core/platform.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'support.dart';

enum _Step { start, otp, password, noDestination }

/// Re-authenticated deletion: a code for OTP-only accounts, the password for
/// accounts that have one. A wrong code or password stays on screen.
class DeleteAccountScreen extends StatefulWidget {
  const DeleteAccountScreen({super.key});

  @override
  State<DeleteAccountScreen> createState() => _DeleteAccountScreenState();
}

class _DeleteAccountScreenState extends State<DeleteAccountScreen> {
  final _secret = TextEditingController();
  _Step _step = _Step.start;
  String? _hint;
  bool _busy = false;
  String? _error;

  ApiClient get _api => AppScope.read(context).api;

  @override
  void dispose() {
    _secret.dispose();
    super.dispose();
  }

  Future<void> _guard(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
    } on ApiError catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _sendCode() => _guard(() async {
        try {
          final res = await _api.post('/api/owner/account/send-delete-code');
          setState(() {
            _step = _Step.otp;
            _hint = res['hint'] as String?;
          });
        } on ApiError catch (e) {
          if (e.code == 'PASSWORD_REQUIRED') {
            setState(() => _step = _Step.password);
          } else if (e.code == 'NO_DESTINATION') {
            setState(() => _step = _Step.noDestination);
          } else {
            rethrow;
          }
        }
      });

  Future<void> _delete() => _guard(() async {
        final app = AppScope.read(context);
        final router = GoRouter.of(context);
        await _api.delete('/api/owner/account', {
          // Passwords are sent exactly as typed; codes are trimmed.
          if (_step == _Step.password)
            'password': _secret.text
          else
            'otp': _secret.text.trim(),
        });
        // Push unregister (best effort), then the local wipe. The server row is
        // already gone, so the logout inside signOut is a harmless no-op.
        await app.signOut();
        router.go('/hub');
      });

  @override
  Widget build(BuildContext context) {
    return SecureScreen(
      child: Scaffold(
        appBar: AppBar(title: const Text('Delete account')),
        body: ListView(
          padding: const EdgeInsets.all(PtLayout.padX),
          children: [
            const Text(
              'This permanently deletes your account, your tags, documents and history. It cannot be undone.',
            ),
            const SizedBox(height: 16),
            ..._stepBody(),
            if (_error != null) ...[
              const SizedBox(height: 12),
              Text(_error!, style: const TextStyle(color: PtColors.error)),
            ],
          ],
        ),
      ),
    );
  }

  List<Widget> _stepBody() {
    final danger = FilledButton.styleFrom(backgroundColor: PtColors.error);
    switch (_step) {
      case _Step.start:
        return [
          FilledButton(
            style: danger,
            onPressed: _busy ? null : _sendCode,
            child: const Text('Continue'),
          ),
        ];
      case _Step.noDestination:
        return [
          const Text("We can't send a code. Contact support."),
          const SizedBox(height: 12),
          OutlinedButton(
            onPressed: () => PtPlatform.openCustomTab(supportUrl),
            child: const Text('Contact support'),
          ),
        ];
      case _Step.otp:
      case _Step.password:
        final otp = _step == _Step.otp;
        return [
          Text(otp
              ? 'Enter the code we sent to ${_hint ?? 'you'}.'
              : 'Enter your password to confirm.'),
          const SizedBox(height: 8),
          if (otp)
            OtpField(controller: _secret)
          else
            TextField(
              controller: _secret,
              obscureText: true,
              autofocus: true,
              decoration: const InputDecoration(labelText: 'Password'),
            ),
          const SizedBox(height: 16),
          FilledButton(
            style: danger,
            onPressed: _busy ? null : _delete,
            child: const Text('Delete my account'),
          ),
        ];
    }
  }
}
