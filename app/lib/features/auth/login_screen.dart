import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../../core/api.dart';
import '../../core/app_state.dart';
import '../../core/platform.dart';
import '../../core/theme.dart';
import 'auth_flow.dart';
import 'otp_panel.dart';

enum _Mode { mobile, pin, google }

/// Opens a web page in a Custom Tab.
typedef OpenUrlFn = Future<bool> Function(String url);

/// `/login`: Code (WhatsApp or email OTP) | PIN or password | Google.
/// FLAG_SECURE while open.
class LoginScreen extends StatefulWidget {
  const LoginScreen({
    super.key,
    this.appCheckToken = defaultAppCheckToken,
    this.googleIdToken = defaultGoogleIdToken,
    this.openUrl = PtPlatform.openCustomTab,
  });

  final AppCheckTokenFn appCheckToken;
  final GoogleIdTokenFn googleIdToken;
  final OpenUrlFn openUrl;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  _Mode _mode = _Mode.mobile;

  @override
  Widget build(BuildContext context) {
    return SecureScreen(
      child: Scaffold(
        appBar: AppBar(title: const Text('Sign in')),
        body: SafeArea(
          child: ListView(
            padding: const EdgeInsets.all(PtLayout.padX),
            children: [
              const Text('Sign in to manage your tags',
                  style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
              const SizedBox(height: 16),
              SegmentedButton<_Mode>(
                segments: const [
                  ButtonSegment(value: _Mode.mobile, label: Text('Code')),
                  ButtonSegment(value: _Mode.pin, label: Text('PIN')),
                  ButtonSegment(value: _Mode.google, label: Text('Google')),
                ],
                selected: {_mode},
                showSelectedIcon: false,
                onSelectionChanged: (s) => setState(() => _mode = s.first),
              ),
              const SizedBox(height: 20),
              switch (_mode) {
                _Mode.mobile => OtpPanel(appCheckToken: widget.appCheckToken),
                _Mode.pin => _PinPanel(openUrl: widget.openUrl),
                _Mode.google => _GooglePanel(idToken: widget.googleIdToken),
              },
            ],
          ),
        ),
      ),
    );
  }
}

/// Email or mobile plus a login PIN or, for accounts that have one, a
/// password. The server decides which it matched (login.js loginWithPassword).
class _PinPanel extends StatefulWidget {
  const _PinPanel({required this.openUrl});

  final OpenUrlFn openUrl;

  @override
  State<_PinPanel> createState() => _PinPanelState();
}

class _PinPanelState extends State<_PinPanel> {
  final _id = TextEditingController();
  final _pin = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _id.dispose();
    _pin.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final identifier = normalizeIdentifier(_id.text);
    if (identifier == null) {
      return setState(() => _error = _id.text.contains('@')
          ? 'Enter a valid email address.'
          : 'Enter a valid 10-digit mobile number.');
    }
    final secret = _pin.text.trim();
    if (secret.isEmpty) {
      return setState(() => _error = 'Enter your PIN or password.');
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final app = AppScope.read(context);
    try {
      await app.api
          .post('/api/auth/login', {'identifier': identifier, 'pin': secret});
      if (!await finishSignIn(app)) {
        if (mounted) setState(() => _error = notOwnerError);
        return;
      }
      if (mounted) context.go('/home');
    } on ApiError catch (e) {
      if (!mounted) return;
      _pin.clear();
      setState(() => _error =
          e.status == 401 ? 'Wrong details or PIN. Try again.' : errorText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          controller: _id,
          keyboardType: TextInputType.emailAddress,
          autofillHints: const [AutofillHints.username],
          autocorrect: false,
          inputFormatters: [LengthLimitingTextInputFormatter(254)],
          decoration:
              const InputDecoration(labelText: 'Email or mobile number'),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _pin,
          obscureText: true,
          autofillHints: const [AutofillHints.password],
          decoration: const InputDecoration(labelText: 'PIN or password'),
          onSubmitted: (_) => _busy ? null : _submit(),
        ),
        if (_error != null) ...[
          const SizedBox(height: 12),
          Text(_error!, style: const TextStyle(color: PtColors.error)),
        ],
        const SizedBox(height: 20),
        FilledButton(
          onPressed: _busy ? null : _submit,
          child: Text(_busy ? 'Signing in...' : 'Sign in'),
        ),
        const SizedBox(height: 8),
        TextButton(
          onPressed: () => widget.openUrl(forgotPasswordUrl),
          child: const Text('Forgot password?'),
        ),
        const Text('No PIN yet? Sign in with a code, then set one.',
            textAlign: TextAlign.center, style: TextStyle(color: PtColors.muted)),
      ],
    );
  }
}

class _GooglePanel extends StatefulWidget {
  const _GooglePanel({required this.idToken});

  final GoogleIdTokenFn idToken;

  @override
  State<_GooglePanel> createState() => _GooglePanelState();
}

class _GooglePanelState extends State<_GooglePanel> {
  bool _busy = false;
  String? _error;

  Future<void> _signIn() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    final app = AppScope.read(context);
    try {
      final config = await app.api.get('/api/auth/google/config');
      final clientId = config['clientId'];
      if (clientId is! String || clientId.isEmpty) {
        if (mounted) {
          setState(() => _error =
              'Google sign-in is not available. Use your mobile number.');
        }
        return;
      }
      final idToken = await widget.idToken(clientId);
      if (idToken == null) return; // cancelled
      // 200 {redirect} is success; there is no `ok` field.
      await app.api.post('/api/auth/google/credential', {'credential': idToken});
      if (!await finishSignIn(app)) {
        if (mounted) setState(() => _error = notOwnerError);
        return;
      }
      if (mounted) context.go('/home');
    } on ApiError catch (e) {
      if (mounted) setState(() => _error = googleErrorText(e));
    } catch (_) {
      // Plugin failures: misconfigured client, no Play services.
      if (mounted) setState(() => _error = 'Google sign-in failed. Try again.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text(
            'For owners who already use Google with ParkTag. New here? Use Mobile.',
            style: TextStyle(color: PtColors.muted)),
        if (_error != null) ...[
          const SizedBox(height: 12),
          Text(_error!, style: const TextStyle(color: PtColors.error)),
        ],
        const SizedBox(height: 20),
        FilledButton.icon(
          onPressed: _busy ? null : _signIn,
          icon: const Icon(Icons.account_circle_outlined),
          label: Text(_busy ? 'Signing in...' : 'Continue with Google'),
        ),
      ],
    );
  }
}
