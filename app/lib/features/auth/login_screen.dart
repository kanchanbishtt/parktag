import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../../core/api.dart';
import '../../core/app_state.dart';
import '../../core/platform.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'auth_flow.dart';
import 'set_password_sheet.dart';
import 'set_pin_sheet.dart';

/// `/login`: the web Owner Sign In page (pages/owner/login.html, login.js and
/// the email step on verify.html), drawn natively to the same measurements
/// as the page at phone width. Same card, copy, order and spacing, so the app
/// and the browser look alike.
///
/// Three steps, as on the web: identifier (mobile by default, email on the
/// toggle), code (WhatsApp or email), PIN. The WhatsApp code and the PIN are
/// native. "Try SMS OTP verification" opens the web page inside the app, as
/// Firebase phone auth needs its own captcha. FLAG_SECURE while open.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, this.appCheckToken = defaultAppCheckToken});

  final AppCheckTokenFn appCheckToken;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

enum _Step { identifier, code, pin }

enum _Tone { info, success, error }

/// login.js reveals the SMS fallback 10 s after a WhatsApp send.
const smsOfferDelay = Duration(seconds: 10);

class _LoginScreenState extends State<LoginScreen> {
  final _id = TextEditingController();
  final _code = TextEditingController();
  final _pin = TextEditingController();
  _Step _step = _Step.identifier;
  bool _emailMode = false; // what the form asks for (applyIdentifierMode)
  String? _identifier; // the one a code was sent to
  bool _byEmail = false; // that code went by email (verify.html look)
  bool _busy = false;
  String? _status;
  _Tone _tone = _Tone.info;
  bool _smsOffer = false;
  Timer? _smsTimer;

  @override
  void dispose() {
    _smsTimer?.cancel();
    _id.dispose();
    _code.dispose();
    _pin.dispose();
    super.dispose();
  }

  void _setStatus(String? text, [_Tone tone = _Tone.info]) => setState(() {
    _status = (text == null || text.isEmpty) ? null : text;
    _tone = tone;
  });

  void _openBridge() => context.push('/login/web');

  void _offerSms({Duration after = Duration.zero}) {
    _smsTimer?.cancel();
    if (after == Duration.zero) return setState(() => _smsOffer = true);
    _smsTimer = Timer(after, () {
      if (mounted) setState(() => _smsOffer = true);
    });
  }

  Future<void> _post(String path, Map<String, Object?> body) async {
    final api = AppScope.read(context).api;
    final token = await widget.appCheckToken();
    await api.post(path, body, {'X-Firebase-AppCheck': ?token});
  }

  // login.js loginOwner
  Future<void> _continue() async {
    if (_busy) return;
    final raw = _id.text.trim();
    if (raw.isEmpty) {
      return _setStatus(
        _emailMode
            ? 'Please enter your email address.'
            : 'Please enter your mobile number.',
        _Tone.error,
      );
    }
    final email = raw.contains('@');
    final identifier = email ? normalizeEmail(raw) : normalizeMobile(raw);
    if (identifier == null) {
      return _setStatus(
        email
            ? 'Invalid email address. Please check and try again.'
            : 'Invalid phone number. Enter a 10-digit Indian mobile number.',
        _Tone.error,
      );
    }
    setState(() {
      _busy = true;
      _status = null;
    });
    try {
      await _post('/api/auth/send-otp', {
        'identifier': identifier,
        'recaptchaToken': '',
      });
      if (!mounted) return;
      _code.clear();
      setState(() {
        _identifier = identifier;
        _byEmail = email;
        _step = _Step.code;
        _smsOffer = false;
      });
      if (!email) _offerSms(after: smsOfferDelay);
    } on ApiError catch (e) {
      if (!mounted) return;
      // The identifier was validated above, so a 400 is the captcha gate
      // (CAPTCHA_REQUIRED): no App Check token reached the server. The web
      // page can pass that gate.
      if (e.status == 400) return _openBridge();
      if (email) return _setStatus(errorText(e), _Tone.error);
      // A failed WhatsApp send keeps the number, opens the code step and
      // offers SMS right away (login.js loginOwner catch).
      setState(() {
        _identifier = identifier;
        _byEmail = false;
        _step = _Step.code;
      });
      _offerSms();
      _setStatus(
        e.status == 500
            ? 'WhatsApp could not send the code. Please try SMS below.'
            : errorText(e),
        _Tone.error,
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  // login.js resendWhatsappOtp, verify.js resend
  Future<void> _resend() async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await _post('/api/auth/send-otp', {
        'identifier': _identifier,
        'recaptchaToken': '',
      });
      if (!mounted) return;
      _setStatus(
        _byEmail
            ? 'A new code has been sent.'
            : 'A new code has been sent by WhatsApp.',
        _Tone.success,
      );
      if (!_byEmail) _offerSms(after: smsOfferDelay);
    } on ApiError catch (e) {
      if (mounted) _setStatus(errorText(e), _Tone.error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  // login.js verifyWhatsappOtp, verify.js verify
  Future<void> _verify() async {
    if (_busy) return;
    final code = _code.text.trim();
    if (!RegExp(r'^[0-9]{6}$').hasMatch(code)) {
      return _setStatus(
        _byEmail ? 'Please enter the 6-digit code.' : 'Enter the 6-digit code.',
        _Tone.error,
      );
    }
    setState(() {
      _busy = true;
      _status = null;
    });
    final app = AppScope.read(context);
    try {
      final res = await app.api.post('/api/auth/verify-otp', {
        'identifier': _identifier,
        'code': code,
      });
      // The cookie is stored; the session is not loaded yet, so the guard
      // leaves this screen in place while the nudge is open. Email sign-ups
      // get the web's set-password step, mobile ones the login PIN.
      final isNew = res['isNewUser'] == true || res['isNew'] == true;
      if (isNew && mounted) {
        // The sheet covers the button; its ring would otherwise spin under it.
        setState(() => _busy = false);
        await (_byEmail ? showSetPasswordNudge : showSetPinNudge)(
          context,
          app.api,
        );
        if (!mounted) return;
        setState(() => _busy = true);
      }
      if (!mounted) return;
      // Captured now: once the session loads, the guard may move off /login
      // and unmount this screen before the new owner reaches Add your vehicles.
      final router = GoRouter.of(context);
      if (!await finishSignIn(app)) {
        if (mounted) _setStatus(notOwnerError, _Tone.error);
        return;
      }
      router.go(isNew ? addVehiclesPath : '/home');
    } on ApiError catch (e) {
      // 409 ACCOUNT_EXISTS and a wrong code both carry server text.
      if (mounted) _setStatus(errorText(e), _Tone.error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  // login.js loginWithPassword, verify.js loginWithPassword. One field, a
  // login PIN or a password; the server decides which it matched.
  Future<void> _signInWithPin() async {
    if (_busy) return;
    final secret = _pin.text.trim();
    if (secret.isEmpty) return _setStatus('Enter your PIN.', _Tone.error);
    setState(() {
      _busy = true;
      _status = null;
    });
    final app = AppScope.read(context);
    try {
      await app.api.post('/api/auth/login', {
        'identifier': _identifier,
        'pin': secret,
      });
      if (!await finishSignIn(app)) {
        if (mounted) _setStatus(notOwnerError, _Tone.error);
        return;
      }
      if (mounted) context.go('/home');
    } on ApiError catch (e) {
      if (!mounted) return;
      _pin.clear();
      _setStatus(errorText(e), _Tone.error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _toggleMode() {
    if (_busy) return;
    _id.clear();
    setState(() {
      _emailMode = !_emailMode;
      _status = null;
    });
  }

  void _backToSignIn() {
    if (_busy) return;
    _smsTimer?.cancel();
    _code.clear();
    _pin.clear();
    setState(() {
      _step = _Step.identifier;
      _identifier = null;
      _smsOffer = false;
      _status = null;
    });
  }

  void _backToCode() {
    if (_busy) return;
    _pin.clear();
    setState(() {
      _step = _Step.code;
      _status = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    return SecureScreen(
      child: Scaffold(
        backgroundColor: _Web.bg,
        body: Column(
          children: [
            const _Header(),
            Expanded(
              child: SingleChildScrollView(
                keyboardDismissBehavior:
                    ScrollViewKeyboardDismissBehavior.onDrag,
                padding: const EdgeInsets.fromLTRB(12, 24, 12, 16),
                child: Center(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 400),
                    child: _Card(child: _card()),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _card() {
    final emailLook = _step != _Step.identifier && _byEmail;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _CardIcon(envelope: emailLook),
        const SizedBox(height: 12),
        Text(
          emailLook ? 'Check your email' : 'Owner Sign In',
          style: _Web.title,
        ),
        _subtitle(),
        ...switch (_step) {
          _Step.identifier => _identifierStep(),
          _Step.code => _codeStep(),
          _Step.pin => _pinStep(),
        },
      ],
    );
  }

  Widget _subtitle() {
    if (_step == _Step.identifier) {
      return Padding(
        padding: const EdgeInsets.only(bottom: 20),
        child: Text(
          _emailMode
              ? "Enter your email address and we'll send you a verification code."
              : 'Choose WhatsApp or SMS to receive your sign-in code.',
          style: _Web.sub,
        ),
      );
    }
    if (_byEmail) {
      return Padding(
        padding: const EdgeInsets.only(bottom: 20),
        child: Text('We sent a 6-digit code to $_identifier.', style: _Web.sub),
      );
    }
    return Text.rich(
      TextSpan(
        children: [
          const TextSpan(text: 'Enter the 6-digit code sent by WhatsApp to '),
          TextSpan(text: maskMobile(_identifier!), style: _Web.subStrong),
          const TextSpan(text: '.'),
        ],
      ),
      style: _Web.sub,
    );
  }

  Widget _statusLine() {
    if (_status == null) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Text(
        _status!,
        textAlign: TextAlign.center,
        style: _Web.status(_tone),
      ),
    );
  }

  List<Widget> _identifierStep() => [
    _Field(
      label: _emailMode ? 'Email address' : 'Mobile number',
      child: _Input(
        key: ValueKey(_emailMode ? 'email' : 'mobile'),
        controller: _id,
        hint: _emailMode ? 'name@example.com' : '10-digit mobile number',
        keyboardType: _emailMode
            ? TextInputType.emailAddress
            : TextInputType.phone,
        autofillHints: [
          _emailMode ? AutofillHints.username : AutofillHints.telephoneNumber,
        ],
        onChanged: (v) {
          // Somebody typing an "@" while the form asks for a number is
          // telling us which identifier they have (login.js input listener).
          if (!_emailMode && v.contains('@')) setState(() => _emailMode = true);
          if (_status != null) _setStatus(null);
        },
        onSubmitted: (_) => _continue(),
      ),
    ),
    // Grid gap 12 + button margin 4, plus the 2px the inline input leaves
    // under itself in its wrapper on the page.
    const SizedBox(height: 18),
    _Button('Continue', busy: _busy, onPressed: _continue),
    // Grid gap 12 + the toggle line margin 14, plus the 2px its inline button
    // adds to the line on the page.
    const SizedBox(height: 28),
    _Link(
      _emailMode ? 'Use mobile number instead' : 'Use email address instead',
      onTap: _toggleMode,
    ),
    _statusLine(),
  ];

  List<Widget> _codeStep() {
    final codeField = _Field(
      label: 'Verification code',
      child: _Input(
        key: const ValueKey('code'),
        controller: _code,
        hint: '000000',
        keyboardType: TextInputType.number,
        autofillHints: const [AutofillHints.oneTimeCode],
        inputFormatters: [
          FilteringTextInputFormatter.digitsOnly,
          LengthLimitingTextInputFormatter(6),
        ],
        code: true,
        onSubmitted: (_) => _verify(),
      ),
    );
    if (_byEmail) {
      // verify.html
      return [
        codeField,
        const SizedBox(height: 16),
        _Button('Verify', busy: _busy, onPressed: _verify),
        _statusLine(),
        const SizedBox(height: 12),
        _InlineRow("Didn't receive a code? ", _Link('Resend', onTap: _resend)),
        const SizedBox(height: 6),
        _InlineRow(
          'Have a login PIN? ',
          _Link(
            'Sign in using PIN',
            onTap: () => setState(() => _step = _Step.pin),
          ),
        ),
        const SizedBox(height: 8),
        _Link(
          '← Back to sign in',
          weight: FontWeight.w600,
          onTap: _backToSignIn,
        ),
      ];
    }
    // login.html #phone-step2
    return [
      _statusLine(),
      const SizedBox(height: 4),
      codeField,
      const SizedBox(height: 8),
      _Button('Verify', busy: _busy, onPressed: _verify),
      const SizedBox(height: 12),
      _InlineRow("Didn't receive the code? ", _Link('Resend', onTap: _resend)),
      const SizedBox(height: 8),
      _InlineRow(
        'Have a login PIN? ',
        _Link(
          'Sign in with PIN',
          onTap: () => setState(() => _step = _Step.pin),
        ),
      ),
      if (_smsOffer) ...[
        const SizedBox(height: 16),
        Container(
          padding: const EdgeInsets.only(top: 14),
          decoration: const BoxDecoration(
            border: Border(top: BorderSide(color: Color(0xFFE5E7EB))),
          ),
          child: Column(
            children: [
              Text(
                "Don't have WhatsApp?",
                textAlign: TextAlign.center,
                style: _Web.smallLh,
              ),
              const SizedBox(height: 4),
              _Link('Try SMS OTP verification', onTap: _openBridge),
            ],
          ),
        ),
      ],
      // 8px margin on the page, plus the empty captcha slot and the 16px line
      // the link sits in: its text starts 23px under the SMS block.
      const SizedBox(height: 23),
      _Link('← Back to sign in', weight: FontWeight.w600, onTap: _backToSignIn),
    ];
  }

  List<Widget> _pinStep() {
    final pinField = _Field(
      label: 'PIN',
      child: _Input(
        key: const ValueKey('pin'),
        controller: _pin,
        hint: 'Enter your PIN',
        obscureText: true,
        autofillHints: const [AutofillHints.password],
        onSubmitted: (_) => _signInWithPin(),
      ),
    );
    if (_byEmail) {
      // verify.html #password-step
      return [
        const SizedBox(height: 12),
        pinField,
        const SizedBox(height: 8),
        const Text(
          'Registered with a password? Enter that here instead.',
          style: _Web.note,
        ),
        const SizedBox(height: 8),
        _Button('Sign in', busy: _busy, onPressed: _signInWithPin),
        _statusLine(),
        const SizedBox(height: 12),
        _InlineRow("Didn't receive a code? ", _Link('Resend', onTap: _resend)),
        const SizedBox(height: 8),
        _Link(
          '← Back to sign in',
          weight: FontWeight.w600,
          onTap: _backToSignIn,
        ),
      ];
    }
    // login.html #password-step
    return [
      _statusLine(),
      const SizedBox(height: 4),
      pinField,
      const SizedBox(height: 8),
      const Text(
        'Registered with a password? Enter that here instead. '
        'No PIN yet? Sign in with a code, then set one from Profile.',
        style: _Web.note,
      ),
      const SizedBox(height: 12),
      _Button('Sign in', busy: _busy, onPressed: _signInWithPin),
      const SizedBox(height: 14), // 12px margin plus the taller line it sits in
      _Link(
        '← Back to verification code',
        weight: FontWeight.w600,
        onTap: _backToCode,
      ),
    ];
  }
}

/// `+91XXXXXX3210`: every digit but the last four (login.js sendWhatsappOtp).
String maskMobile(String phone) {
  final head = phone
      .substring(0, phone.length - 4)
      .replaceAll(RegExp(r'[0-9]'), 'X');
  return head + phone.substring(phone.length - 4);
}

/// Measured on app.parktag.me/owner-login at phone width (styles.css: .pt-header,
/// .pt-auth-card, .pt-card-*, .pt-field, .pt-input, .pt-btn-primary, .pt-status).
abstract final class _Web {
  /// Chrome lays Inter out at 1.21em where the CSS says line-height: normal.
  /// Flutter reads different metrics from the same file, so every style
  /// fixes its line box explicitly and centres the glyphs in it, as CSS does.
  static const lh = 1.21;
  static const bg = Color(0xFFF1F1F0);
  static const ink = PtColors.ink;
  static const sub = TextStyle(
    fontSize: 14.4,
    height: 1.6,
    leadingDistribution: TextLeadingDistribution.even,
    color: PtColors.muted,
  );
  static const subStrong = TextStyle(
    color: Color(0xFF323232),
    fontWeight: FontWeight.w800,
    fontVariations: [FontVariation('wght', 800)],
  );
  static const title = TextStyle(
    fontSize: 22.4,
    fontWeight: FontWeight.w900,
    fontVariations: [FontVariation('wght', 900)],
    height: 1.1,
    leadingDistribution: TextLeadingDistribution.even,
    letterSpacing: -0.672,
    color: ink,
  );
  static const label = TextStyle(
    fontSize: 14.08,
    height: lh,
    leadingDistribution: TextLeadingDistribution.even,
    fontWeight: FontWeight.w600,
    fontVariations: [FontVariation('wght', 600)],
    color: ink,
  );
  static const input = TextStyle(
    fontSize: 15.2,
    height: lh,
    leadingDistribution: TextLeadingDistribution.even,
    fontWeight: FontWeight.w600,
    fontVariations: [FontVariation('wght', 600)],
    color: ink,
  );
  static const placeholder = Color(0xFF757575);
  static const codeInput = TextStyle(
    fontSize: 22.4,
    height: lh,
    leadingDistribution: TextLeadingDistribution.even,
    fontWeight: FontWeight.w700,
    fontVariations: [FontVariation('wght', 700)],
    letterSpacing: 5.6,
    color: ink,
  );
  static const field = Color(0xFFF1F1F0);
  static const line = PtColors.line;
  static const button = TextStyle(
    fontSize: 15.2,
    height: lh,
    leadingDistribution: TextLeadingDistribution.even,
    fontWeight: FontWeight.w700,
    fontVariations: [FontVariation('wght', 700)],
    color: Colors.white,
  );
  static const small = TextStyle(
    fontSize: 13.6,
    height: lh,
    leadingDistribution: TextLeadingDistribution.even,
    color: Color(0xFF6B7280),
  );
  static const smallLh = TextStyle(
    fontSize: 13.6,
    height: 1.5,
    leadingDistribution: TextLeadingDistribution.even,
    color: Color(0xFF6B7280),
  );
  static const note = TextStyle(
    fontSize: 12.48,
    height: 1.45,
    leadingDistribution: TextLeadingDistribution.even,
    color: Color(0xFF6B7280),
  );
  static TextStyle link(FontWeight weight) => TextStyle(
    fontSize: 13.6,
    height: lh,
    leadingDistribution: TextLeadingDistribution.even,
    fontWeight: weight,
    fontVariations: [FontVariation('wght', weight.value.toDouble())],
    color: PtColors.accent,
  );
  static TextStyle status(_Tone tone) => TextStyle(
    fontSize: 13.12,
    height: lh,
    leadingDistribution: TextLeadingDistribution.even,
    fontWeight: FontWeight.w600,
    fontVariations: const [FontVariation('wght', 600)],
    color: switch (tone) {
      _Tone.info => PtColors.muted,
      _Tone.success => PtColors.accentDark,
      _Tone.error => Color(0xFFDC2626),
    },
  );
}

/// .pt-header: 64px of brand navy, the wordmark 42px tall at the left.
class _Header extends StatelessWidget {
  const _Header();

  @override
  Widget build(BuildContext context) {
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light.copyWith(
        statusBarColor: Colors.transparent,
      ),
      child: Container(
        decoration: const BoxDecoration(
          color: PtColors.navy,
          boxShadow: [
            BoxShadow(
              color: Color(0x2E000000),
              offset: Offset(0, 2),
              blurRadius: 12,
            ),
          ],
        ),
        child: SafeArea(
          bottom: false,
          child: Container(
            height: 64,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            alignment: Alignment.centerLeft,
            child: const PtLogo(height: 42, onDark: true),
          ),
        ),
      ),
    );
  }
}

/// .pt-auth-card at phone width.
class _Card extends StatelessWidget {
  const _Card({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 24),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: _Web.line),
        boxShadow: PtShadows.lg,
      ),
      child: child,
    );
  }
}

/// .pt-card-icon.pt-icon-tag with the page's inline SVG: a person on the sign-in
/// page, an envelope on the email verify page.
class _CardIcon extends StatelessWidget {
  const _CardIcon({required this.envelope});

  final bool envelope;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        width: 48,
        height: 48,
        decoration: BoxDecoration(
          color: const Color(0xFFFFE3DD),
          borderRadius: BorderRadius.circular(14),
        ),
        child: Center(
          child: CustomPaint(
            size: const Size(22, 22),
            painter: _IconPainter(envelope: envelope),
          ),
        ),
      ),
    );
  }
}

class _IconPainter extends CustomPainter {
  const _IconPainter({required this.envelope});

  final bool envelope;

  @override
  void paint(Canvas canvas, Size size) {
    final s = size.width / 24; // the SVG viewBox is 24 units
    final paint = Paint()
      ..color = PtColors.accent
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2 * s
      ..strokeCap = StrokeCap.round;
    if (envelope) {
      canvas.drawRRect(
        RRect.fromRectAndRadius(
          Rect.fromLTWH(2 * s, 4 * s, 20 * s, 16 * s),
          Radius.circular(2 * s),
        ),
        paint,
      );
      canvas.drawLine(Offset(7 * s, 9 * s), Offset(17 * s, 9 * s), paint);
      canvas.drawLine(Offset(7 * s, 13 * s), Offset(13 * s, 13 * s), paint);
      return;
    }
    canvas.drawCircle(Offset(12 * s, 8 * s), 4 * s, paint);
    final body = Path()
      ..moveTo(4 * s, 20 * s)
      ..relativeCubicTo(0, -4 * s, 3.6 * s, -7 * s, 8 * s, -7 * s)
      ..relativeCubicTo(4.4 * s, 0, 8 * s, 3 * s, 8 * s, 7 * s);
    canvas.drawPath(body, paint);
  }

  @override
  bool shouldRepaint(_IconPainter old) => old.envelope != envelope;
}

/// .pt-field: label, 6px, input.
class _Field extends StatelessWidget {
  const _Field({required this.label, required this.child});

  final String label;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(label, style: _Web.label),
        const SizedBox(height: 6),
        child,
      ],
    );
  }
}

/// .pt-input: 43px, #F1F1F0 fill, 1px #E2E8F0 border, radius 10; the code
/// variant is 51px with the page's 0.25em tracking.
class _Input extends StatelessWidget {
  const _Input({
    super.key,
    required this.controller,
    required this.hint,
    this.keyboardType,
    this.obscureText = false,
    this.autofillHints,
    this.inputFormatters,
    this.code = false,
    this.onChanged,
    this.onSubmitted,
  });

  final TextEditingController controller;
  final String hint;
  final TextInputType? keyboardType;
  final bool obscureText;
  final Iterable<String>? autofillHints;
  final List<TextInputFormatter>? inputFormatters;
  final bool code;
  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onSubmitted;

  @override
  Widget build(BuildContext context) {
    final style = code ? _Web.codeInput : _Web.input;
    // The box is drawn here, not by InputDecorator: a fixed 43px (51px for the
    // code) with the line centred in it, so engine font metrics cannot change
    // the field height the page has.
    return Container(
      height: code ? 51 : 43,
      padding: const EdgeInsets.symmetric(horizontal: 13),
      alignment: Alignment.centerLeft,
      decoration: BoxDecoration(
        color: _Web.field,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: _Web.line),
      ),
      child: TextField(
        controller: controller,
        keyboardType: keyboardType,
        obscureText: obscureText,
        autofillHints: autofillHints,
        inputFormatters: inputFormatters,
        autocorrect: false,
        textAlign: code ? TextAlign.center : TextAlign.start,
        textAlignVertical: TextAlignVertical.center,
        style: style,
        cursorColor: _Web.ink,
        decoration: InputDecoration(
          isCollapsed: true,
          // The theme fills fields white and outlines them; this box is drawn
          // above, so the inner field paints nothing of its own.
          filled: false,
          border: InputBorder.none,
          enabledBorder: InputBorder.none,
          focusedBorder: InputBorder.none,
          disabledBorder: InputBorder.none,
          hintText: hint,
          hintStyle: style.copyWith(color: _Web.placeholder),
          counterText: '',
        ),
        onChanged: onChanged,
        onSubmitted: onSubmitted,
      ),
    );
  }
}

/// .pt-btn.pt-btn-primary.pt-btn-full: 47px, #D92200, radius 14, red glow.
/// Busy: 60% opacity and the 18px ring at the left (.pt-btn-loading).
class _Button extends StatelessWidget {
  const _Button(this.label, {required this.busy, required this.onPressed});

  final String label;
  final bool busy;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Opacity(
      opacity: busy ? 0.6 : 1,
      child: DecoratedBox(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(14),
          boxShadow: const [
            BoxShadow(
              color: Color(0x59FF2700),
              offset: Offset(0, 4),
              blurRadius: 16,
            ),
          ],
        ),
        child: FilledButton(
          onPressed: busy ? null : onPressed,
          style: FilledButton.styleFrom(
            backgroundColor: PtColors.accentDark,
            disabledBackgroundColor: PtColors.accentDark,
            foregroundColor: Colors.white,
            disabledForegroundColor: Colors.white,
            elevation: 0,
            minimumSize: const Size.fromHeight(47),
            maximumSize: const Size.fromHeight(47),
            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            padding: const EdgeInsets.symmetric(horizontal: 20),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(14),
            ),
            textStyle: _Web.button,
          ),
          child: Stack(
            alignment: Alignment.center,
            children: [
              Text(label, style: _Web.button),
              if (busy)
                const Positioned(
                  left: 0,
                  child: SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                      backgroundColor: Colors.white38,
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The page's bare red text buttons and links, 13.6px, centred.
class _Link extends StatelessWidget {
  const _Link(this.text, {required this.onTap, this.weight = FontWeight.w700});

  final String text;
  final VoidCallback onTap;
  final FontWeight weight;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Semantics(
        button: true,
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 4),
            child: Text(
              text,
              textAlign: TextAlign.center,
              style: _Web.link(weight),
            ),
          ),
        ),
      ),
    );
  }
}

/// "Didn't receive the code? Resend": grey lead-in, red action, one centred line.
class _InlineRow extends StatelessWidget {
  const _InlineRow(this.lead, this.link);

  final String lead;
  final _Link link;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      alignment: WrapAlignment.center,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        Text(lead, style: _Web.small),
        GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: link.onTap,
          child: Text(link.text, style: _Web.link(link.weight)),
        ),
      ],
    );
  }
}
