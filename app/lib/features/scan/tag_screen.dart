import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../../core/api.dart';
import '../../core/app_state.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'activation.dart';
import 'car_location.dart';
import 'contact_view.dart';
import 'inactive_tag.dart';
import 'quick_actions.dart';
import 'scan_io.dart';
import 'sos.dart';

const tagNotFound = 'Tag not found. Scan the sticker again.';
const tagInactive = 'This tag is inactive';
const guestGetUrl = 'https://app.parktag.me/get';
const sosVerifyNotice =
    'Enter the last 4 digits of the plate. The emergency call starts right after.';

/// `/t/:token`: looks the tag up, then activation, the inactive notice, or the
/// verify gate followed by the contact screen. The grant lives only here.
class TagScreen extends StatefulWidget {
  const TagScreen({super.key, required this.token});

  final String token;

  @override
  State<TagScreen> createState() => _TagScreenState();
}

class _TagScreenState extends State<TagScreen> {
  late Future<Map<String, dynamic>> _load;
  Map<String, dynamic>? _verified;
  String? _notice;
  final _location = CarLocation();

  /// SOS confirmed before verifying: the call starts once the plate checks out.
  bool _sosAfterVerify = false;

  @override
  void initState() {
    super.initState();
    _load = _fetch();
  }

  @override
  void dispose() {
    _location.dispose();
    super.dispose();
  }

  Future<Map<String, dynamic>> _fetch() =>
      AppScope.read(context).api.get('/api/tags/${widget.token}');

  void _backToVerify(String message) => setState(() {
    _verified = null;
    _notice = message;
    _sosAfterVerify = false;
  });

  Future<void> _emergencyBeforeVerify(Map<String, dynamic> tag) async {
    if (!await confirmEmergency(context) || !mounted) return;
    if (tag['emergencyAvailable'] != true) return showHelplines(context);
    // Ask for the car's position now, while the plate is typed.
    _location.start();
    setState(() {
      _sosAfterVerify = true;
      _notice = sosVerifyNotice;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const PtLogo(height: 26, onDark: true)),
      body: FutureBuilder<Map<String, dynamic>>(
        future: _load,
        builder: (context, snap) {
          if (snap.connectionState != ConnectionState.done) {
            return const Padding(
              padding: EdgeInsets.all(18),
              child: Skeleton(),
            );
          }
          final error = snap.error;
          if (error is ApiError && error.status == 404) {
            return const EmptyState(
              title: tagNotFound,
              icon: Icons.qr_code_2_rounded,
            );
          }
          if (error != null) {
            return Padding(
              padding: const EdgeInsets.all(18),
              child: ErrorCard.from(
                error,
                onRetry: () => setState(() => _load = _fetch()),
              ),
            );
          }
          return _body(snap.data!);
        },
      ),
    );
  }

  Widget _body(Map<String, dynamic> data) {
    final tag = data['tag'] is Map<String, dynamic>
        ? data['tag'] as Map<String, dynamic>
        : const <String, dynamic>{};
    if (tag['claimable'] == true) {
      return ActivationWizard(token: widget.token, tag: tag);
    }
    if (tag['status'] != 'active') {
      return InactiveTagCard(
        onGet: () => AppScope.read(context).isOwner
            ? context.go('/shop')
            : ScanIo.customTab(guestGetUrl),
        onOwner: () =>
            context.go(AppScope.read(context).isOwner ? '/home' : '/login'),
      );
    }
    final footer = Column(
      children: [
        QuickActions(
          token: widget.token,
          maskedPlate: tag['maskedPlateNumber'] as String?,
          supportWhatsapp: data['supportWhatsapp'],
        ),
        const PrivacyNote(),
      ],
    );
    final verified = _verified;
    if (verified == null) {
      return VerifyGate(
        token: widget.token,
        tag: tag,
        notice: _notice,
        footer: footer,
        onEmergency: () => _emergencyBeforeVerify(tag),
        onVerified: (v) => setState(() {
          _verified = v;
          _notice = null;
        }),
      );
    }
    final startSos = _sosAfterVerify;
    _sosAfterVerify = false;
    return ContactView(
      token: widget.token,
      tag: tag,
      verified: verified,
      location: _location,
      startSos: startSos,
      footer: footer,
      onGrantLost: _backToVerify,
    );
  }
}

/// Last four digits of the plate, checked server-side.
class VerifyGate extends StatefulWidget {
  const VerifyGate({
    super.key,
    required this.token,
    required this.tag,
    required this.onVerified,
    this.notice,
    this.onEmergency,
    this.footer,
  });

  final String token;
  final Map<String, dynamic> tag;
  final ValueChanged<Map<String, dynamic>> onVerified;
  final String? notice;
  final VoidCallback? onEmergency;
  final Widget? footer;

  @override
  State<VerifyGate> createState() => _VerifyGateState();
}

class _VerifyGateState extends State<VerifyGate> {
  final _digits = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _digits.dispose();
    super.dispose();
  }

  Future<void> _verify() async {
    if (!RegExp(r'^\d{4}$').hasMatch(_digits.text)) {
      setState(() => _error = 'Enter the last 4 digits of the vehicle number.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final res = await AppScope.read(context).api
          .post('/api/tags/${widget.token}/verify', {'lastFour': _digits.text});
      if (!mounted) return;
      if (res['grant'] is! String) {
        setState(() => _error = fallbackError);
        return;
      }
      widget.onVerified(res);
    } on ApiError catch (e) {
      if (!mounted) return;
      setState(() => _error = verifyErrorText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final plate = widget.tag['maskedPlateNumber'];
    final label = widget.tag['vehicleLabel'];
    return ListView(
      padding: const EdgeInsets.all(PtLayout.padX),
      children: [
        Text(
          label is String ? label : 'Vehicle',
          style: const TextStyle(color: PtColors.muted),
        ),
        if (plate is String)
          Text(
            plate,
            style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800),
          ),
        const SizedBox(height: 16),
        const Text(
          'Enter the last 4 digits of the number plate to reach the owner.',
        ),
        if (widget.notice != null) ...[
          const SizedBox(height: 8),
          Text(
            widget.notice!,
            style: const TextStyle(color: PtColors.amberDeep),
          ),
        ],
        const SizedBox(height: 16),
        TextField(
          key: const Key('verify-digits'),
          controller: _digits,
          keyboardType: TextInputType.number,
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 24, letterSpacing: 8),
          inputFormatters: [
            FilteringTextInputFormatter.digitsOnly,
            LengthLimitingTextInputFormatter(4),
          ],
          decoration: const InputDecoration(hintText: '1234', counterText: ''),
          onSubmitted: (_) => _verify(),
        ),
        if (_error != null) ...[
          const SizedBox(height: 8),
          Text(_error!, style: const TextStyle(color: PtColors.error)),
        ],
        const SizedBox(height: 16),
        FilledButton(
          onPressed: _busy ? null : _verify,
          child: Text(_busy ? 'Checking' : 'Verify'),
        ),
        const SizedBox(height: 12),
        const Text(
          'Your number stays private.',
          textAlign: TextAlign.center,
          style: TextStyle(color: PtColors.muted),
        ),
        if (widget.onEmergency case final onEmergency?) ...[
          const SizedBox(height: 20),
          EmergencyBlock(onPressed: _busy ? null : onEmergency),
        ],
        if (widget.footer case final f?) ...[const SizedBox(height: 16), f],
      ],
    );
  }
}

/// 401 adds the attempts left; 423 and others show the server text as is.
String verifyErrorText(ApiError e) {
  final left = e.extra['attemptsRemaining'];
  if (e.status == 401 && left is num) {
    final n = left.toInt();
    return '${e.message} $n ${n == 1 ? 'attempt' : 'attempts'} left.';
  }
  return e.message;
}
