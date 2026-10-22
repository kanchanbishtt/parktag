import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/api.dart';
import '../../core/app_state.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'owner_common.dart';
import 'tag_card.dart';
import 'tag_rules.dart';

/// `/tags`: "My Vehicles (n)", one card per tag, then the Add card.
class TagsScreen extends StatelessWidget {
  const TagsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final count = AppScope.of(context).tags.length;
    return Scaffold(
      appBar: AppBar(title: Text('My Vehicles ($count)')),
      body: DashboardView(
        builder: (context, app) => [
          if (app.tags.isEmpty)
            const EmptyState(
              title: 'No vehicles yet',
              body: 'Add your first vehicle below',
              icon: Icons.directions_car_outlined,
            ),
          for (final t in app.tags) ...[
            TagCard(tag: t),
            const SizedBox(height: 12),
          ],
          const _AddCard(),
        ],
      ),
    );
  }
}

class _AddCard extends StatelessWidget {
  const _AddCard();

  @override
  Widget build(BuildContext context) {
    return Card(
      clipBehavior: Clip.antiAlias,
      child: ListTile(
        leading: const Icon(Icons.add_circle_outline, color: PtColors.accent),
        title: const Text(
          'Add vehicle',
          style: TextStyle(fontWeight: FontWeight.w700),
        ),
        subtitle: const Text('Get an E-Tag for another vehicle'),
        onTap: () => showAddVehicleSheet(context),
      ),
    );
  }
}

/// Same order as the scanner picker (tag_rules.dart vehicleTypeOptions).
final vehicleTypes = {for (final o in vehicleTypeOptions) o.type: o.label};

Future<void> showAddVehicleSheet(BuildContext context) =>
    showPtSheet(context, builder: (_) => const AddVehicleForm());

/// `POST /api/owner/local-vehicle {type, number}`, then refresh.
class AddVehicleForm extends StatefulWidget {
  const AddVehicleForm({super.key});

  @override
  State<AddVehicleForm> createState() => _AddVehicleFormState();
}

class _AddVehicleFormState extends State<AddVehicleForm> {
  final _number = TextEditingController();
  String _type = 'car';
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _number.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final number = _number.text.trim().toUpperCase();
    if (number.isEmpty) {
      setState(() => _error = 'Enter the vehicle number.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final app = AppScope.read(context);
    try {
      await app.api.post('/api/owner/local-vehicle', {
        'type': _type,
        'number': number,
      });
    } on ApiError catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = e.status == 409 ? 'Vehicle already added.' : e.message;
        });
      }
      return;
    }
    try {
      await app.refresh();
    } on ApiError {
      // Added; the list catches up on the next pull.
    }
    if (mounted) Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text(
          'Add vehicle',
          style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 16),
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
          inputFormatters: [LengthLimitingTextInputFormatter(15)],
          decoration: const InputDecoration(
            labelText: 'Vehicle number',
            hintText: 'MH12AB1234',
          ),
          onSubmitted: (_) => _save(),
        ),
        if (_error != null) ...[
          const SizedBox(height: 10),
          Text(_error!, style: const TextStyle(color: PtColors.error)),
        ],
        const SizedBox(height: 16),
        FilledButton(
          onPressed: _busy ? null : _save,
          child: Text(_busy ? 'Adding...' : 'Add vehicle'),
        ),
      ],
    );
  }
}
