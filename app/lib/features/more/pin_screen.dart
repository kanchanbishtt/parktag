import 'package:flutter/material.dart';

import '../../core/api.dart';
import '../../core/app_state.dart';
import '../../core/platform.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';

/// Login PIN set, change and remove, plus "sign out other devices".
/// A wrong current PIN is a 400/401 on a live session: it stays on screen.
class PinScreen extends StatefulWidget {
  const PinScreen({super.key});

  @override
  State<PinScreen> createState() => _PinScreenState();
}

class _PinScreenState extends State<PinScreen> {
  final _current = TextEditingController();
  final _pin = TextEditingController();
  final _confirm = TextEditingController();
  late Future<Map<String, dynamic>> _status;
  bool _busy = false;
  String? _error;
  String? _notice;

  ApiClient get _api => AppScope.read(context).api;

  @override
  void initState() {
    super.initState();
    _status = _fetch();
  }

  Future<Map<String, dynamic>> _fetch() => _api.get('/api/owner/login-pin');

  @override
  void dispose() {
    _current.dispose();
    _pin.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _run(Future<String> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
      _notice = null;
    });
    try {
      final notice = await action();
      if (!mounted) return;
      _current.clear();
      _pin.clear();
      _confirm.clear();
      setState(() {
        _notice = notice;
        _status = _fetch();
      });
    } on ApiError catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _save(bool hasPin) => _run(() async {
        final res = await _api.post('/api/owner/login-pin', {
          'pin': _pin.text,
          'confirmPin': _confirm.text,
          if (hasPin) 'currentPin': _current.text,
        });
        final elsewhere = res['signedOutElsewhere'];
        final saved = hasPin ? 'PIN changed.' : 'PIN set.';
        return elsewhere is num && elsewhere > 0
            ? '$saved Signed out on other devices.'
            : saved;
      });

  Future<void> _remove() => _run(() async {
        await _api.delete('/api/owner/login-pin', {'currentPin': _current.text});
        return 'PIN removed.';
      });

  Future<void> _revokeOthers() => _run(() async {
        final res = await _api.post('/api/owner/sessions/revoke-others');
        final n = res['revoked'] is num ? (res['revoked'] as num).toInt() : 0;
        return n == 1
            ? 'Signed out of 1 other device.'
            : 'Signed out of $n other devices.';
      });

  @override
  Widget build(BuildContext context) {
    return SecureScreen(
      child: Scaffold(
        appBar: AppBar(title: const Text('Login PIN & devices')),
        body: FutureBuilder<Map<String, dynamic>>(
          future: _status,
          builder: (context, snap) {
            if (snap.hasError) {
              return Padding(
                padding: const EdgeInsets.all(PtLayout.padX),
                child: ErrorCard.from(snap.error!,
                    onRetry: () => setState(() => _status = _fetch())),
              );
            }
            if (!snap.hasData) {
              return const Padding(
                padding: EdgeInsets.all(PtLayout.padX),
                child: Skeleton(rows: 3, height: 56),
              );
            }
            return _form(snap.data!['hasPin'] == true);
          },
        ),
      ),
    );
  }

  Widget _form(bool hasPin) {
    return ListView(
      padding: const EdgeInsets.all(PtLayout.padX),
      children: [
        Text(
          hasPin
              ? 'Your login PIN is set. Change it or remove it below.'
              : 'Set a 6 to 8 digit PIN to sign in faster on this phone.',
          style: const TextStyle(color: PtColors.muted),
        ),
        const SizedBox(height: 12),
        if (hasPin) PinField(controller: _current, label: 'Current PIN'),
        PinField(controller: _pin, label: hasPin ? 'New PIN' : 'PIN'),
        PinField(controller: _confirm, label: 'Confirm PIN'),
        if (_error != null) ...[
          const SizedBox(height: 12),
          Text(_error!, style: const TextStyle(color: PtColors.error)),
        ],
        if (_notice != null) ...[
          const SizedBox(height: 12),
          Text(_notice!, style: const TextStyle(color: PtColors.success)),
        ],
        const SizedBox(height: 16),
        FilledButton(
          onPressed: _busy ? null : () => _save(hasPin),
          child: Text(hasPin ? 'Change PIN' : 'Set PIN'),
        ),
        if (hasPin)
          TextButton(
            onPressed: _busy ? null : _remove,
            child: const Text('Remove PIN'),
          ),
        const SizedBox(height: 24),
        const Divider(),
        const SizedBox(height: 12),
        const Text('Devices',
            style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
        const SizedBox(height: 6),
        const Text('Signed in somewhere you no longer use? This keeps you signed in here.',
            style: TextStyle(color: PtColors.muted)),
        const SizedBox(height: 12),
        OutlinedButton(
          onPressed: _busy ? null : _revokeOthers,
          child: const Text('Sign out other devices'),
        ),
      ],
    );
  }
}
