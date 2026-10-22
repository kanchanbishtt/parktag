import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../../core/api.dart';
import '../../core/app_state.dart';
import '../../core/platform.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import '../../push/push.dart';
import '../owner/tag_rules.dart' show mountMismatch, vehicleTypeOptions;
import 'scan_io.dart';

/// Values accepted by `/activate`, in the web picker's fixed order
/// (VEHICLE_TYPE_OPTIONS in scanner/app.js).
final vehicleTypes = {for (final o in vehicleTypeOptions) o.type: o.label};

/// Null when [type] fits a sticker of [category] (or the tag predates mount
/// types); otherwise the (title, text) of the refusal. The server refuses the
/// same pairings; this only decides how early the owner finds out.
(String, String)? mountBlock(Object? category, String type) {
  final m = mountMismatch(category is String ? category : null, type);
  return m == null ? null : (m.title, m.text);
}

const whatsappSendFailed = 'WhatsApp could not send the code';
final _plateRe = RegExp(r'^[A-Z0-9-]{4,16}$');
final _mobile = RegExp(r'^[6-9]\d{9}$');

/// Upper-cased with spaces stripped, the shape the server stores.
String normalizePlate(String raw) =>
    raw.replaceAll(RegExp(r'\s+'), '').toUpperCase();

enum ActStep { type, plate, name, phone, code }

/// Claimable tag: type, plate, name, phone, send-otp, code, then activate.
class ActivationWizard extends StatefulWidget {
  const ActivationWizard({super.key, required this.token, required this.tag});

  final String token;
  final Map<String, dynamic> tag;

  @override
  State<ActivationWizard> createState() => _ActivationWizardState();
}

class _ActivationWizardState extends State<ActivationWizard> {
  final _plate = TextEditingController();
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _code = TextEditingController();
  ActStep _step = ActStep.type;
  String? _type;

  /// The refused pick, shown in place of the picker until another is chosen.
  (String, String)? _mount;
  bool _busy = false;
  bool _codeSent = false;
  bool _offerSms = false;
  String? _error;

  ApiClient get _api => AppScope.read(context).api;
  String get _identifier => '+91${_phone.text}';

  // Nothing is preselected: the mount type narrows the category, not the
  // vehicle, and a confident wrong guess gets tapped past (web, same rule).
  void _pickType(String type) => setState(() {
    _mount = mountBlock(widget.tag['vehicleCategory'], type);
    _type = _mount == null ? type : null;
    _error = null;
  });

  @override
  void dispose() {
    for (final c in [_plate, _name, _phone, _code]) {
      c.dispose();
    }
    super.dispose();
  }

  void _go(ActStep step) => setState(() {
    _step = step;
    _error = null;
  });

  void _fail(String message) => setState(() => _error = message);

  void _next() {
    switch (_step) {
      case ActStep.type:
        if (_type == null) return _fail('Choose the type of vehicle.');
        // After a mount mismatch the code is still unspent: go straight back.
        _go(_codeSent ? ActStep.code : ActStep.plate);
      case ActStep.plate:
        if (!_plateRe.hasMatch(normalizePlate(_plate.text))) {
          return _fail('Enter a valid number plate.');
        }
        _go(ActStep.name);
      case ActStep.name:
        if (_name.text.trim().length < 2) return _fail('Enter your full name.');
        _go(ActStep.phone);
      case ActStep.phone:
        _sendOtp();
      case ActStep.code:
        _activate();
    }
  }

  Future<void> _sendOtp() async {
    if (!_mobile.hasMatch(_phone.text)) {
      return _fail('Enter a valid 10-digit mobile number.');
    }
    setState(() {
      _busy = true;
      _error = null;
      _offerSms = false;
    });
    try {
      final appCheck = await ScanIo.appCheckToken();
      await _api.post(
        '/api/auth/send-otp',
        {'identifier': _identifier, 'recaptchaToken': ''},
        {'X-Firebase-AppCheck': ?appCheck},
      );
      if (!mounted) return;
      _codeSent = true;
      _go(ActStep.code);
    } on ApiError catch (e) {
      if (!mounted) return;
      // The number is validated above, so a 400 is the captcha check.
      if (e.status == 400) return _openBridge();
      if (e.status == 500) {
        setState(() {
          _error = whatsappSendFailed;
          _offerSms = true;
        });
        return;
      }
      _fail(e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _activate() async {
    if (_code.text.length != OtpField.length) {
      return _fail('Enter the 6-digit code.');
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final app = AppScope.read(context);
    try {
      // The session cookie is captured from this response by ApiClient.
      await _api.post('/api/tags/${widget.token}/activate', {
        'displayName': _name.text.trim(),
        'phone': _identifier,
        'code': _code.text,
        'plateNumber': normalizePlate(_plate.text),
        'vehicleType': _type,
      });
    } on ApiError catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      if (e.code == 'mount_type_mismatch') {
        _go(ActStep.type);
        return _fail(e.message);
      }
      return _fail(e.message);
    }
    try {
      await app.loadSession();
      await app.refresh();
    } catch (_) {
      // Home shows its own error and retry.
    }
    try {
      await Push.register();
    } catch (_) {
      // Best effort; the next launch registers again.
    }
    if (mounted) context.go('/home');
  }

  void _openBridge() => context.push('/t/${widget.token}/web');

  @override
  Widget build(BuildContext context) {
    return SecureScreen(
      child: ListView(
        padding: const EdgeInsets.all(PtLayout.padX),
        children: [
          const Text(
            'Activate your ParkTag',
            style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 4),
          Text(
            'Step ${_step.index + 1} of ${ActStep.values.length}',
            style: const TextStyle(color: PtColors.muted),
          ),
          const SizedBox(height: 16),
          ..._fields(),
          if (_error != null) ...[
            const SizedBox(height: 8),
            Text(_error!, style: const TextStyle(color: PtColors.error)),
          ],
          const SizedBox(height: 16),
          if (_mount == null || _step != ActStep.type)
            FilledButton(
              onPressed: _busy ? null : _next,
              child: Text(switch (_step) {
                ActStep.phone => _busy ? 'Sending' : 'Send code on WhatsApp',
                ActStep.code => _busy ? 'Activating' : 'Activate',
                _ => 'Next',
              }),
            ),
          if (_offerSms || _step == ActStep.code)
            TextButton(
              onPressed: _busy ? null : _openBridge,
              child: const Text('Get the code by SMS'),
            ),
          if (_step != ActStep.type)
            TextButton(
              onPressed: _busy
                  ? null
                  : () => _go(ActStep.values[_step.index - 1]),
              child: const Text('Back'),
            ),
        ],
      ),
    );
  }

  List<Widget> _fields() {
    switch (_step) {
      case ActStep.type:
        if (_mount case (final title, final text)) {
          return [
            Text(title, style: const TextStyle(fontWeight: FontWeight.w800)),
            const SizedBox(height: 4),
            Text(text),
            TextButton(
              onPressed: () => setState(() => _mount = null),
              child: const Text('Choose another vehicle'),
            ),
          ];
        }
        return [
          const Text('What is this tag going on?'),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final t in vehicleTypes.entries)
                ChoiceChip(
                  label: Text(t.value),
                  selected: _type == t.key,
                  onSelected: (_) => _pickType(t.key),
                ),
            ],
          ),
        ];
      case ActStep.plate:
        return [
          TextField(
            key: const Key('act-plate'),
            controller: _plate,
            textCapitalization: TextCapitalization.characters,
            decoration: const InputDecoration(labelText: 'Number plate'),
          ),
        ];
      case ActStep.name:
        return [
          TextField(
            key: const Key('act-name'),
            controller: _name,
            textCapitalization: TextCapitalization.words,
            decoration: const InputDecoration(labelText: 'Your name'),
          ),
        ];
      case ActStep.phone:
        return [
          TextField(
            key: const Key('act-phone'),
            controller: _phone,
            keyboardType: TextInputType.phone,
            inputFormatters: [
              FilteringTextInputFormatter.digitsOnly,
              LengthLimitingTextInputFormatter(10),
            ],
            decoration: const InputDecoration(
              labelText: 'Mobile number',
              prefixText: '+91 ',
              counterText: '',
            ),
          ),
        ];
      case ActStep.code:
        return [
          Text('Enter the code sent on WhatsApp to +91 ${_phone.text}.'),
          const SizedBox(height: 8),
          OtpField(controller: _code),
        ];
    }
  }
}
