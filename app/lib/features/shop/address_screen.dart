import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/api.dart';
import '../../core/app_state.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'models.dart';
import 'pincode.dart';

/// `/shop/address`: the delivery address. Pops with the saved [Address].
class AddressScreen extends StatefulWidget {
  const AddressScreen({super.key, this.initial});

  final Address? initial;

  @override
  State<AddressScreen> createState() => _AddressScreenState();
}

class _AddressScreenState extends State<AddressScreen> {
  final _form = GlobalKey<FormState>();
  late final Map<String, TextEditingController> _c;
  bool _loading = true;
  bool _saving = false;
  String? _error;
  List<Map<String, dynamic>> _suggestions = const [];
  Timer? _debounce;
  // India Post's answer for the last pincode looked up, so a pincode from
  // another state is caught before the order ships.
  ({String pin, PinPlace place})? _pinPlace;

  ApiClient get _api => AppScope.read(context).api;

  @override
  void initState() {
    super.initState();
    final a = widget.initial ?? const Address();
    _c = {
      for (final e in a.toJson().entries)
        e.key: TextEditingController(text: e.value as String),
    };
    if (widget.initial == null) {
      _load();
    } else {
      _loading = false;
    }
  }

  @override
  void dispose() {
    _debounce?.cancel();
    for (final c in _c.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final a = (await _api.get('/api/owner/address'))['address'];
      if (a is Map<String, dynamic>) {
        Address.fromJson(a).toJson().forEach((k, v) => _c[k]!.text = v as String);
      }
    } on ApiError catch (e) {
      _error = e.message;
    }
    if (mounted) setState(() => _loading = false);
  }

  void _onLine1(String q) {
    _debounce?.cancel();
    if (q.trim().length < 3) {
      setState(() => _suggestions = const []);
      return;
    }
    _debounce = Timer(const Duration(milliseconds: 350), () async {
      try {
        final pin = _c['pincode']!.text.trim();
        final res = await _api.get('/api/shop/address-suggest',
            query: {'q': q.trim(), if (pin.length == 6) 'pin': pin});
        final list = res['suggestions'];
        if (!mounted) return;
        setState(() => _suggestions = list is List
            ? [for (final s in list) if (s is Map<String, dynamic>) s]
            : const []);
      } on ApiError {
        // Suggestions are a convenience; the buyer can always type.
      }
    });
  }

  void _pick(Map<String, dynamic> s) {
    _c['line1']!.text = '${s['main'] ?? ''}';
    final area = _areaFrom('${s['secondary'] ?? ''}');
    if (_c['line2']!.text.isEmpty) _c['line2']!.text = area;
    final pin = '${s['pincode'] ?? ''}';
    if (pin.isNotEmpty && _c['pincode']!.text.isEmpty) {
      _c['pincode']!.text = pin;
      _onPincode(pin);
    }
    setState(() => _suggestions = const []);
  }

  /// Street suggestions carry the locality after the street. Keep the area
  /// part, less what City, State and pincode already hold (pickSugg on web).
  String _areaFrom(String secondary) {
    final drop = {_c['city']!.text, _c['state']!.text, 'India'}
        .map((x) => x.trim().toLowerCase());
    return secondary
        .split(',')
        .map((x) => x.trim())
        .where((x) =>
            x.isNotEmpty &&
            !RegExp(r'\d{6}').hasMatch(x) &&
            !drop.contains(x.toLowerCase()) &&
            canonicalState(x) == null)
        .take(3)
        .join(', ');
  }

  /// Fills City and State from India Post, only into boxes left empty.
  Future<void> _onPincode(String pin) async {
    if (!RegExp(r'^[1-9]\d{5}$').hasMatch(pin)) return;
    final place = await lookupPin(pin);
    if (place == null || !mounted || _c['pincode']!.text != pin) return;
    setState(() {
      _pinPlace = (pin: pin, place: place);
      if (_c['city']!.text.isEmpty && place.city.isNotEmpty) _c['city']!.text = place.city;
      if (_c['state']!.text.isEmpty && place.state != null) _c['state']!.text = place.state!;
    });
  }

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    final known = _pinPlace;
    final mismatch = known != null && known.pin == _c['pincode']!.text.trim()
        ? pinStateProblem(known.place, _c['state']!.text)
        : null;
    if (mismatch != null) {
      setState(() => _error = mismatch);
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final body = {for (final e in _c.entries) e.key: e.value.text.trim()};
      final res = await _api.post('/api/owner/address', body);
      final saved = res['address'];
      if (!mounted) return;
      Navigator.of(context).pop(
          saved is Map<String, dynamic> ? Address.fromJson(saved) : Address.fromJson(body));
    } on ApiError catch (e) {
      // 400s carry the reason: bad field, or a pincode the courier does not serve.
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  String? _required(String? v) =>
      v == null || v.trim().isEmpty ? 'Required' : null;

  Widget _field(String key, String label,
      {bool required = true,
      TextInputType? keyboard,
      List<TextInputFormatter>? formatters,
      String? Function(String?)? validator,
      ValueChanged<String>? onChanged}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: TextFormField(
        controller: _c[key],
        keyboardType: keyboard,
        inputFormatters: formatters,
        decoration: InputDecoration(labelText: required ? label : '$label (optional)'),
        validator: validator ?? (required ? _required : null),
        onChanged: onChanged,
      ),
    );
  }

  Widget _stateField() {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: DropdownButtonFormField<String>(
        // Rebuilt when India Post fills it in.
        key: ValueKey(canonicalState(_c['state']!.text)),
        initialValue: canonicalState(_c['state']!.text),
        isExpanded: true,
        decoration: const InputDecoration(labelText: 'State'),
        items: [
          for (final s in indianStates) DropdownMenuItem(value: s, child: Text(s)),
        ],
        onChanged: (v) => setState(() => _c['state']!.text = v ?? ''),
        validator: (v) => v == null ? 'Select your state' : null,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Delivery address')),
      body: _loading
          ? const Padding(padding: EdgeInsets.all(PtLayout.padX), child: Skeleton())
          : Form(
              key: _form,
              child: ListView(
                padding: const EdgeInsets.all(PtLayout.padX),
                children: [
                  _field('fullName', 'Full name'),
                  _field('phone', 'Mobile number',
                      keyboard: TextInputType.phone,
                      formatters: [
                        FilteringTextInputFormatter.digitsOnly,
                        LengthLimitingTextInputFormatter(10),
                      ],
                      validator: (v) => RegExp(r'^[6-9]\d{9}$').hasMatch(v ?? '')
                          ? null
                          : 'Enter a 10-digit mobile number'),
                  _field('pincode', 'Pincode',
                      keyboard: TextInputType.number,
                      formatters: [
                        FilteringTextInputFormatter.digitsOnly,
                        LengthLimitingTextInputFormatter(6),
                      ],
                      validator: (v) => RegExp(r'^[1-9]\d{5}$').hasMatch(v ?? '')
                          ? null
                          : 'Enter a 6-digit pincode',
                      onChanged: _onPincode),
                  _field('line1', 'House, street', onChanged: _onLine1),
                  for (final s in _suggestions)
                    ListTile(
                      dense: true,
                      leading: const Icon(Icons.place_outlined),
                      title: Text('${s['main'] ?? ''}'),
                      subtitle: Text('${s['secondary'] ?? ''}'),
                      onTap: () => _pick(s),
                    ),
                  _field('line2', 'Area', required: false),
                  _field('landmark', 'Landmark', required: false),
                  _field('city', 'City'),
                  _stateField(),
                  if (_error != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: Text(_error!, style: const TextStyle(color: PtColors.error)),
                    ),
                  FilledButton(
                    onPressed: _saving ? null : _save,
                    child: const Text('Save address'),
                  ),
                ],
              ),
            ),
    );
  }
}
