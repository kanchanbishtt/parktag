import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../../core/api.dart';
import '../../core/app_state.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'auth_flow.dart';
import 'set_password_sheet.dart';
import 'set_pin_sheet.dart';

const resendDelay = Duration(seconds: 30);

/// Code sign-in: WhatsApp OTP to a mobile, or an email code after "Use email
/// address instead" (login.js applyIdentifierMode). Both send an App Check
/// token. Captcha rejections, failed WhatsApp delivery and "Use SMS" hand over
/// to the web bridge.
class OtpPanel extends StatefulWidget {
  const OtpPanel({super.key, required this.appCheckToken});

  final AppCheckTokenFn appCheckToken;

  @override
  State<OtpPanel> createState() => _OtpPanelState();
}

class _OtpPanelState extends State<OtpPanel> {
  final _mobile = TextEditingController();
  final _code = TextEditingController();
  String? _identifier; // set once a code was sent
  bool _email = false;
  bool _busy = false;
  bool _deliveryFailed = false;
  String? _error;
  int _wait = 0;
  Timer? _timer;

  @override
  void dispose() {
    _timer?.cancel();
    _mobile.dispose();
    _code.dispose();
    super.dispose();
  }

  void _openBridge() => context.push('/login/web');

  void _startTimer() {
    _timer?.cancel();
    setState(() => _wait = resendDelay.inSeconds);
    _timer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) return t.cancel();
      setState(() => _wait--);
      if (_wait <= 0) t.cancel();
    });
  }

  Future<void> _send() async {
    final raw = _identifier ?? _mobile.text;
    final identifier = _email ? normalizeEmail(raw) : normalizeMobile(raw);
    if (identifier == null) {
      return setState(() => _error = _email
          ? 'Enter a valid email address.'
          : 'Enter a valid 10-digit mobile number.');
    }
    setState(() {
      _busy = true;
      _error = null;
      _deliveryFailed = false;
    });
    final app = AppScope.read(context);
    try {
      final token = await widget.appCheckToken();
      await app.api.post(
        '/api/auth/send-otp',
        {'identifier': identifier, 'recaptchaToken': ''},
        {'X-Firebase-AppCheck': ?token},
      );
      if (!mounted) return;
      _code.clear();
      setState(() => _identifier = identifier);
      _startTimer();
    } on ApiError catch (e) {
      if (!mounted) return;
      // The identifier was validated above, so any 400 is a captcha rejection
      // (CAPTCHA_REQUIRED once App Check ships). The web page can pass it.
      if (e.status == 400) return _openBridge();
      setState(() {
        if (e.status == 500 && !_email) {
          _deliveryFailed = true;
        } else {
          _error = errorText(e);
        }
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _verify() async {
    final code = _code.text;
    if (code.length != OtpField.length) {
      return setState(() => _error = 'Enter the 6-digit code.');
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final app = AppScope.read(context);
    try {
      final res = await app.api
          .post('/api/auth/verify-otp', {'identifier': _identifier, 'code': code});
      // The cookie is stored; the session is not loaded yet, so the guard
      // leaves this screen in place while the nudge is open. Email sign-ups
      // get the web's set-password step, mobile ones the login PIN.
      final isNew = res['isNewUser'] == true || res['isNew'] == true;
      if (isNew && mounted) {
        await (_email ? showSetPasswordNudge : showSetPinNudge)(context, app.api);
      }
      if (!mounted) return;
      // Captured now: once the session loads, the guard may move off /login
      // and unmount this panel before the new owner reaches Add your vehicles.
      final router = GoRouter.of(context);
      if (!await finishSignIn(app)) {
        if (mounted) setState(() => _error = notOwnerError);
        return;
      }
      router.go(isNew ? addVehiclesPath : '/home');
    } on ApiError catch (e) {
      // 409 ACCOUNT_EXISTS and a wrong code both carry server text.
      if (mounted) setState(() => _error = errorText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _toggleMode() {
    _mobile.clear();
    setState(() {
      _email = !_email;
      _error = null;
      _deliveryFailed = false;
    });
  }

  void _changeNumber() {
    _timer?.cancel();
    setState(() {
      _identifier = null;
      _wait = 0;
      _error = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final sent = _identifier != null;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (!sent) ...[
          if (_email)
            TextField(
              key: const ValueKey('email'),
              controller: _mobile,
              keyboardType: TextInputType.emailAddress,
              autofillHints: const [AutofillHints.email],
              autocorrect: false,
              decoration: const InputDecoration(labelText: 'Email address'),
              onSubmitted: (_) => _busy ? null : _send(),
            )
          else
            TextField(
              key: const ValueKey('mobile'),
              controller: _mobile,
              keyboardType: TextInputType.phone,
              autofillHints: const [AutofillHints.telephoneNumber],
              inputFormatters: [
                FilteringTextInputFormatter.allow(RegExp(r'[0-9+\s\-]')),
                LengthLimitingTextInputFormatter(16),
              ],
              decoration: const InputDecoration(
                  labelText: 'Mobile number', prefixText: '+91 '),
              onSubmitted: (_) => _busy ? null : _send(),
            ),
          const SizedBox(height: 8),
          Text(
              _email
                  ? 'We send a sign-in code to your email.'
                  : 'We send a sign-in code on WhatsApp.',
              style: const TextStyle(color: PtColors.muted)),
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton(
              onPressed: _busy ? null : _toggleMode,
              child: Text(_email
                  ? 'Use mobile number instead'
                  : 'Use email address instead'),
            ),
          ),
        ] else ...[
          Text(
              _email
                  ? 'Enter the code sent to $_identifier'
                  : 'Enter the code sent on WhatsApp to $_identifier',
              style: const TextStyle(color: PtColors.muted)),
          const SizedBox(height: 12),
          OtpField(controller: _code, onCompleted: (_) => _busy ? null : _verify()),
        ],
        if (_error != null) ...[
          const SizedBox(height: 12),
          Text(_error!, style: const TextStyle(color: PtColors.error)),
        ],
        if (_deliveryFailed) ...[
          const SizedBox(height: 12),
          const Text('WhatsApp could not send the code.',
              style: TextStyle(color: PtColors.error)),
          const SizedBox(height: 8),
          OutlinedButton(
              onPressed: _openBridge, child: const Text('Get the code by SMS')),
        ],
        const SizedBox(height: 20),
        FilledButton(
          onPressed: _busy ? null : (sent ? _verify : _send),
          child: Text(_busy
              ? 'Please wait...'
              : sent
                  ? 'Verify and sign in'
                  : 'Send code'),
        ),
        if (sent) ...[
          const SizedBox(height: 8),
          if (_wait > 0)
            Text('Resend in ${_wait}s',
                textAlign: TextAlign.center,
                style: const TextStyle(color: PtColors.muted))
          else ...[
            TextButton(
                onPressed: _busy ? null : _send, child: const Text('Resend code')),
            if (!_email)
              TextButton(
                  onPressed: _openBridge,
                  child: const Text("Didn't get it? Use SMS")),
          ],
          TextButton(
              onPressed: _busy ? null : _changeNumber,
              child: Text(_email ? 'Change email' : 'Change number')),
        ],
      ],
    );
  }
}
