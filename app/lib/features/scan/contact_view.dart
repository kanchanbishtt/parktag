import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/api.dart';
import '../../core/app_state.dart';
import '../../core/errors.dart';
import '../../core/theme.dart';
import 'call_state.dart';
import 'car_location.dart';
import 'caller_phone.dart';
import 'contact_panels.dart';
import 'scan_io.dart';
import 'sos.dart';

/// Server reason keys (src/backend/lib/core/contact-actions.js) and their chips.
const contactReasons = {
  'lights': 'Lights on',
  'towing': 'Blocking the way',
  'parking': 'Parking issue',
  'window': 'Window open',
  'suspicious': 'Something suspicious',
};

const alertedText = 'Owner alerted successfully';
const unreachableText = 'This tag cannot be reached right now.';
const dialFailedText = 'Could not open the dialler.';
const dialOpenText = 'Your phone dialer should open now.';
const reasonRequiredText = 'Please select a reason for contacting the owner.';
const alertedBody =
    'The owner has been told on WhatsApp. Your number stays private.';
const alertedCallBody =
    'You can still call the owner privately, your details stay completely private.';
const sendFailedText = 'Something went wrong. Try again.';
const locationNotice =
    'Your number stays private. The owner sees your approximate area, from your internet connection.';
final _mobile = RegExp(r'^[6-9]\d{9}$');

/// The contact screen after a successful verify. Holds the grant in memory.
class ContactView extends StatefulWidget {
  const ContactView({
    super.key,
    required this.token,
    required this.tag,
    required this.verified,
    required this.location,
    required this.onGrantLost,
    this.startSos = false,
    this.footer,
  });

  final String token;
  final Map<String, dynamic> tag;

  /// The verify response: grant, contactAvailable, contactBlockedCode,
  /// messageAlwaysOn, callsPaused.
  final Map<String, dynamic> verified;

  /// Owned by the tag screen so a fix started before verifying carries over.
  final CarLocation location;

  /// The grant expired or is in use: back to the verify gate with this note.
  final ValueChanged<String> onGrantLost;

  /// SOS was confirmed on the verify gate: place the call straight away.
  final bool startSos;
  final Widget? footer;

  @override
  State<ContactView> createState() => _ContactViewState();
}

class _ContactViewState extends State<ContactView> {
  final _callback = TextEditingController();
  late final CallState _calls = CallState.fromVerify(
    widget.tag,
    widget.verified,
  );
  String? _reason;
  bool _busy = false;
  bool _alerted = false;
  String? _status;
  bool _statusOk = false;
  String? _slow;
  String? _callNumber;
  String? _sosNumber;
  bool _sosLocationSent = false;

  String get _grant => widget.verified['grant'] as String;
  ApiClient get _api => AppScope.read(context).api;
  CarLocation get _loc => widget.location;
  bool get _blocked => _busy || _loc.pending;

  @override
  void initState() {
    super.initState();
    _loc.addListener(_relayout);
    if (widget.startSos) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        // As the web verify handler: a tag whose verify closed Emergency
        // (a used trial) goes straight to the helplines, no phone sheet.
        _calls.emergencyOn ? _sosCall() : showHelplines(context);
      });
    }
  }

  void _relayout() => setState(() {});

  @override
  void dispose() {
    _loc.removeListener(_relayout);
    _callback.dispose();
    super.dispose();
  }

  void _say(String? message, {bool ok = false}) => setState(() {
    _status = message;
    _statusOk = ok;
  });

  Map<String, dynamic> _withLocation(Map<String, dynamic> body) => {
    ...body,
    'carLocation': ?_loc.json,
  };

  /// Runs a request with the busy lock and the slow-signal note.
  Future<Map<String, dynamic>> _send(
    String path,
    Map<String, dynamic> body,
    String slowText,
  ) async {
    setState(() {
      _busy = true;
      _status = null;
      _slow = null;
    });
    try {
      return await withSlowNotice(_api.post(path, _withLocation(body)), () {
        if (mounted) setState(() => _slow = slowText);
      });
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
          _slow = null;
        });
      }
    }
  }

  Future<void> _sendMessage() async {
    // The server builds the owner's WhatsApp from the reason, so an alert
    // without one says nothing useful. Gate the send, as the web does.
    if (_reason == null) return _say(reasonRequiredText);
    final phone = _callback.text.trim();
    if (phone.isNotEmpty && !_mobile.hasMatch(phone)) {
      return _say('Enter a valid 10-digit mobile number, or leave it blank.');
    }
    try {
      await _send('/api/contact-requests', {
        'token': widget.token,
        'action': 'message',
        'messageChannel': 'whatsapp',
        'grant': _grant,
        'reason': _reason,
        if (phone.isNotEmpty) 'phone': phone,
      }, 'Still sending... signal is weak here.');
      if (mounted) setState(() => _alerted = true);
    } on ApiError catch (e) {
      if (!mounted) return;
      if (e.status == 403) return widget.onGrantLost(e.message);
      // 402 here only means a lapsed subscription: the lapsed panel says it.
      if (e.status == 402) return setState(_calls.lapse);
      _say(e.status == 404 ? 'This tag is inactive' : e.message);
    } catch (_) {
      if (mounted) _say(sendFailedText);
    }
  }

  Future<void> _privateCall() async {
    final phone = await askCallerPhone(
      context,
      title: 'Private call',
      initial: _callback.text.trim(),
    );
    if (phone == null || !mounted) return;
    try {
      final res = await _send('/api/tags/${widget.token}/register-call', {
        'phone': phone,
        'grant': _grant,
      }, 'Still setting up your line, the signal is weak here.');
      if (mounted) await _dialRegistered(res['virtualNumber'], sos: false);
    } on ApiError catch (e) {
      if (!mounted) return;
      if (_calls.applyCallError(e)) {
        return _say(_calls.noPhoneText);
      }
      if (e.isNetwork) {
        return _say('No connection, so your call could not start. Try again.');
      }
      final r = mapCallError(e);
      if (r.backToVerify) return widget.onGrantLost(r.message);
      setState(() {
        if (r.hideCall) _calls.ownerNoPhone = true;
      });
      _say(r.message);
    } catch (_) {
      if (mounted) _say(sendFailedText);
    }
  }

  Future<void> _emergency() async {
    if (!await confirmEmergency(context) || !mounted) return;
    if (!_calls.emergencyOn) return showHelplines(context);
    // The gate just said this would happen. Declining changes nothing.
    _loc.start();
    await _sosCall();
  }

  Future<void> _sosCall() async {
    final phone = await askCallerPhone(
      context,
      title: 'Emergency call',
      initial: _callback.text.trim(),
      emergency: true,
    );
    if (phone == null || !mounted) return;
    // Snapshot at send time: a fix still improving goes out as the best so far.
    final sent = _loc.json != null;
    try {
      final res = await _send(
        '/api/tags/${widget.token}/register-emergency-call',
        {'phone': phone, 'grant': _grant},
        'Still connecting, the signal is weak here.',
      );
      if (!mounted) return;
      _sosLocationSent = sent;
      await _dialRegistered(res['virtualNumber'], sos: true);
    } on ApiError catch (e) {
      if (!mounted) return;
      if (e.code == 'GRANT_IN_USE') return widget.onGrantLost(e.message);
      final note = switch (e.code) {
        'NO_EMERGENCY_CONTACT' => helplineNoteNoContact,
        'EMERGENCY_LOCKED' => helplineNoteUnavailable,
        'EMERGENCY_LIMIT' => e.message.isEmpty ? helplineNoteLimit : e.message,
        _ => e.isNetwork ? helplineNoteOffline : e.message,
      };
      if (e.code == 'NO_EMERGENCY_CONTACT' || e.code == 'EMERGENCY_LOCKED') {
        setState(() => _calls.emergencyOn = false);
      }
      // Someone may be at an accident: any failure ends at the helplines.
      await showHelplines(context, note);
    } catch (_) {
      if (mounted) await showHelplines(context, helplineNoteOffline);
    }
  }

  Future<void> _dialRegistered(Object? number, {required bool sos}) async {
    if (number is! String || number.isEmpty) {
      return _say('Calling is unavailable right now. Try again.');
    }
    setState(() => sos ? _sosNumber = number : _callNumber = number);
    final opened = await _dial(number);
    if (mounted) _say(opened ? dialOpenText : dialFailedText, ok: opened);
  }

  /// False when no dialler could be opened.
  Future<bool> _dial(String number) async {
    try {
      return await ScanIo.launch(Uri(scheme: 'tel', path: number));
    } on PlatformException {
      return false;
    }
  }

  @override
  Widget build(BuildContext context) {
    final plate =
        widget.verified['maskedPlateNumber'] ?? widget.tag['maskedPlateNumber'];
    final c = _calls;
    return ListView(
      padding: const EdgeInsets.all(PtLayout.padX),
      children: [
        if (plate is String)
          Text(
            plate,
            style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800),
          ),
        const SizedBox(height: 12),
        if (c.lapsed) const LapsedPanel(),
        if (c.hideTiles && !c.lapsed)
          const Padding(
            padding: EdgeInsets.only(bottom: 12),
            child: Text(
              unreachableText,
              style: TextStyle(fontWeight: FontWeight.w700),
            ),
          ),
        // The alert is a receipt, not an exit: call and Emergency stay live.
        if (_alerted)
          Alerted(callOpen: !c.hideTiles && !c.callOff)
        else if (c.messageOn)
          ..._messageTiles(),
        if (!c.hideTiles) ...[
          const SizedBox(height: 8),
          if (_callNumber case final n?)
            DialCard(number: n, onCall: () => _dial(n))
          else
            OutlinedButton.icon(
              onPressed: _blocked || c.callOff ? null : _privateCall,
              icon: const Icon(Icons.call_rounded),
              label: const Text('Private call'),
            ),
          if (c.callOffNote case final note?) Note(note),
          const SizedBox(height: 8),
          const Text(
            locationNotice,
            style: TextStyle(color: PtColors.muted, fontSize: 13),
          ),
        ],
        if (_slow != null || _status != null) ...[
          const SizedBox(height: 12),
          Text(
            _slow ?? _status!,
            style: TextStyle(
              color: _slow != null
                  ? PtColors.muted
                  : _statusOk
                  ? PtColors.success
                  : PtColors.error,
            ),
          ),
        ],
        const SizedBox(height: 20),
        if (_sosNumber case final n?)
          DialCard(
            number: n,
            emergency: true,
            locationShared: _sosLocationSent,
            onCall: () => _dial(n),
          )
        else
          EmergencyBlock(onPressed: _blocked ? null : _emergency),
        if (widget.footer case final f?) ...[const SizedBox(height: 16), f],
      ],
    );
  }

  List<Widget> _messageTiles() => [
    const Text(
      'What is the issue?',
      style: TextStyle(fontWeight: FontWeight.w700),
    ),
    const SizedBox(height: 8),
    Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        for (final r in contactReasons.entries)
          ChoiceChip(
            label: Text(r.value),
            selected: _reason == r.key,
            onSelected: (on) => setState(() {
              _reason = on ? r.key : null;
              if (_status == reasonRequiredText) _status = null;
            }),
          ),
      ],
    ),
    const SizedBox(height: 8),
    ShareLocationTile(location: _loc, enabled: !_busy),
    TextField(
      key: const Key('callback-phone'),
      controller: _callback,
      keyboardType: TextInputType.phone,
      inputFormatters: [
        FilteringTextInputFormatter.digitsOnly,
        LengthLimitingTextInputFormatter(10),
      ],
      decoration: const InputDecoration(
        labelText: 'Let the owner call you back (optional)',
        helperText: 'The owner sees only the last 4 digits.',
        counterText: '',
      ),
    ),
    const SizedBox(height: 12),
    FilledButton.icon(
      style: FilledButton.styleFrom(backgroundColor: PtColors.whatsappDark),
      onPressed: _blocked ? null : _sendMessage,
      icon: const Icon(Icons.chat_rounded),
      label: const Text('Send WhatsApp alert'),
    ),
  ];
}
