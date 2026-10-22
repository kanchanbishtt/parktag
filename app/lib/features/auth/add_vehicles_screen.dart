import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../../core/api.dart';
import '../../core/app_state.dart';
import '../../core/theme.dart';
import '../owner/tags_screen.dart' show vehicleTypes;
import 'auth_flow.dart';

/// Indian plate: 2 letters, 1-2 digits, 1-3 letters, 1-4 digits (register.js PLATE_RE).
final _plateRe = RegExp(r'^[A-Z]{2}\s?[0-9]{1,2}\s?[A-Z]{1,3}\s?[0-9]{1,4}$');

/// Upper case with single spaces, as register.js normalises before checking.
String normalizePlate(String raw) =>
    raw.trim().toUpperCase().replaceAll(RegExp(r'\s+'), ' ');

/// Null when [plate] (already normalised) is a valid Indian vehicle number.
String? plateError(String plate) {
  if (plate.isEmpty) return 'Please enter the vehicle number.';
  return _plateRe.hasMatch(plate)
      ? null
      : 'Invalid format. Use Indian format, e.g. DL 01 AB 1234.';
}

typedef PendingVehicle = ({String type, String number});

/// `/add-vehicles`: the web /register-owner step for a brand new account.
/// Each vehicle goes through `POST /api/owner/local-vehicle`; 409 means it
/// already exists and counts as saved. Skippable.
class AddVehiclesScreen extends StatefulWidget {
  const AddVehiclesScreen({super.key});

  @override
  State<AddVehiclesScreen> createState() => _AddVehiclesScreenState();
}

class _AddVehiclesScreenState extends State<AddVehiclesScreen> {
  final _number = TextEditingController();
  final _vehicles = <PendingVehicle>[];
  String _type = 'car';
  String? _plateError;
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _number.dispose();
    super.dispose();
  }

  /// Adds the typed vehicle to the list. False when it was not valid.
  bool _add() {
    final number = normalizePlate(_number.text);
    final err =
        plateError(number) ??
        (_vehicles.any((v) => v.number == number)
            ? 'Vehicle already added.'
            : null);
    if (err != null) {
      setState(() => _plateError = err);
      return false;
    }
    _number.clear();
    setState(() {
      _vehicles.add((type: _type, number: number));
      _plateError = null;
      _error = null;
    });
    return true;
  }

  Future<void> _save() async {
    // Like the web, a typed vehicle that was never added still counts.
    if (_number.text.trim().isNotEmpty && !_add()) return;
    if (_vehicles.isEmpty) {
      return setState(() => _error = 'Add at least one vehicle.');
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final app = AppScope.read(context);
    final router = GoRouter.of(context);
    while (_vehicles.isNotEmpty) {
      final v = _vehicles.first;
      try {
        await app.api.post('/api/owner/local-vehicle', {
          'type': v.type,
          'number': v.number,
        });
      } on ApiError catch (e) {
        if (e.status != 409) {
          // Saved ones are already off the list, so a retry sends the rest.
          if (mounted) {
            setState(() {
              _busy = false;
              _error = errorText(e);
            });
          }
          return;
        }
      }
      // Left the screen mid-save: stop, or the same vehicle is re-posted forever.
      if (!mounted) return;
      setState(() => _vehicles.removeAt(0));
    }
    try {
      await app.refresh();
    } on ApiError {
      // Home shows its own error and retry.
    }
    router.go('/home');
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: !_busy,
      child: Scaffold(
        appBar: AppBar(title: const Text('Add your vehicles')),
        body: SafeArea(
          child: ListView(
            padding: const EdgeInsets.all(PtLayout.padX),
            children: [
              const Text(
                'Add the vehicles you want to protect with ParkTag.',
                style: TextStyle(color: PtColors.muted),
              ),
              const SizedBox(height: 16),
              for (final (i, v) in _vehicles.indexed)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.directions_car_outlined),
                  title: Text(v.number),
                  subtitle: Text(vehicleTypes[v.type] ?? v.type),
                  trailing: IconButton(
                    tooltip: 'Remove',
                    icon: const Icon(Icons.close),
                    onPressed: _busy
                        ? null
                        : () => setState(() => _vehicles.removeAt(i)),
                  ),
                ),
              DropdownButtonFormField<String>(
                initialValue: _type,
                decoration: const InputDecoration(labelText: 'Vehicle type'),
                items: [
                  for (final e in vehicleTypes.entries)
                    DropdownMenuItem(value: e.key, child: Text(e.value)),
                ],
                onChanged: (v) => setState(() => _type = v ?? _type),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _number,
                textCapitalization: TextCapitalization.characters,
                inputFormatters: [
                  FilteringTextInputFormatter.allow(RegExp(r'[A-Za-z0-9 ]')),
                  LengthLimitingTextInputFormatter(15),
                ],
                decoration: InputDecoration(
                  labelText: 'Vehicle number',
                  hintText: 'DL 01 AB 1234',
                  errorText: _plateError,
                ),
                onChanged: (_) {
                  if (_plateError != null) setState(() => _plateError = null);
                },
                onSubmitted: (_) => _add(),
              ),
              const SizedBox(height: 8),
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  onPressed: _busy ? null : _add,
                  icon: const Icon(Icons.add),
                  label: const Text('Add vehicle'),
                ),
              ),
              if (_error != null) ...[
                const SizedBox(height: 8),
                Text(_error!, style: const TextStyle(color: PtColors.error)),
              ],
              const SizedBox(height: 20),
              FilledButton(
                onPressed: _busy ? null : _save,
                child: Text(_busy ? 'Saving...' : 'Continue'),
              ),
              TextButton(
                onPressed: _busy ? null : () => context.go('/home'),
                child: const Text('Skip for now'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
