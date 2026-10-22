import 'package:flutter/material.dart';

import '../../core/theme.dart';
import 'models.dart';

const referralRefusedText =
    'That referral code cannot be used on this order, so nothing was charged. '
    'Remove it or try another.';
const promoRefusedText =
    'That code cannot be used on this order, so nothing was charged. '
    'Remove it or try another.';
const replaceNote =
    'This order replaces your free trial tag with a premium tag for the same vehicle.';

/// address-step.js startCodCheck, word for word apart from the pincode.
String addressWarning(String pin) =>
    "We couldn't match this address to PIN $pin. Go back to check the PIN and "
    'street, or enter the code to place the order anyway.';

/// "Select Variant" from the web product sheet. The label is recorded on the
/// order; it never changes the price.
class VariantPicker extends StatelessWidget {
  const VariantPicker(
      {super.key, required this.variants, required this.selected, this.onSelected});

  final List<String> variants;
  final String selected;
  final ValueChanged<String>? onSelected;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Select variant'),
        const SizedBox(height: 6),
        Wrap(
          spacing: 8,
          children: [
            for (final v in variants)
              ChoiceChip(
                label: Text(v),
                selected: v == selected,
                onSelected: onSelected == null ? null : (_) => onSelected!(v),
              ),
          ],
        ),
      ],
    );
  }
}

/// A code box with Apply, and the note the last check left.
class CodeRow extends StatelessWidget {
  const CodeRow(
      {super.key, required this.controller, required this.label, this.onApply, this.note});

  final TextEditingController controller;
  final String label;
  final VoidCallback? onApply;
  final String? note;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: controller,
                textCapitalization: TextCapitalization.characters,
                decoration: InputDecoration(labelText: label),
              ),
            ),
            const SizedBox(width: 8),
            TextButton(onPressed: onApply, child: const Text('Apply')),
          ],
        ),
        if (note != null)
          Text(note!, style: const TextStyle(color: PtColors.muted, fontSize: 13)),
      ],
    );
  }
}

class AddressCard extends StatelessWidget {
  const AddressCard({super.key, this.address, required this.loaded, this.onTap});

  final Address? address;
  final bool loaded;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final a = address;
    return Card(
      child: ListTile(
        leading: const Icon(Icons.local_shipping_outlined),
        title: Text(!loaded
            ? 'Loading address'
            : a == null
                ? 'Add a delivery address'
                : a.fullName),
        subtitle: a == null ? null : Text('${a.oneLine}\n${a.phone}'),
        isThreeLine: a != null,
        trailing: Text(a == null ? 'Add' : 'Change'),
        onTap: onTap,
      ),
    );
  }
}
