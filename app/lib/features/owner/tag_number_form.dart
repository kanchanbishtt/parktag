import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/api.dart';
import '../../core/app_state.dart';
import '../../core/theme.dart';
import 'owner_common.dart';

/// One phone field. Server text is shown inline (400 "cannot be your own number").
class TagNumberForm extends StatefulWidget {
  const TagNumberForm({
    super.key,
    required this.title,
    required this.hint,
    required this.onSave,
    this.initial,
    this.confirmNumber = false,
  });

  final String title;
  final String hint;
  final String? initial;
  final bool confirmNumber;
  final Future<Object?> Function(ApiClient api, String number) onSave;

  @override
  State<TagNumberForm> createState() => _TagNumberFormState();
}

class _TagNumberFormState extends State<TagNumberForm> {
  late final _ctrl = TextEditingController(text: widget.initial);
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final number = _ctrl.text.trim();
    if (number.replaceAll(RegExp(r'\D'), '').length < 7) {
      setState(() => _error = 'Enter a valid mobile number.');
      return;
    }
    if (widget.confirmNumber &&
        !await confirm(
          context,
          title: 'Is this number right?',
          body: number,
          ok: 'Yes, save',
        )) {
      return;
    }
    if (!mounted) return;
    final app = AppScope.read(context);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.onSave(app.api, number);
    } on ApiError catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = e.message;
        });
      }
      return;
    }
    try {
      await app.refresh();
    } on ApiError {
      // Saved; the screen catches up on the next pull.
    }
    if (mounted) Navigator.pop(context, true);
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          widget.title,
          style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 6),
        Text(widget.hint, style: const TextStyle(color: PtColors.muted)),
        const SizedBox(height: 16),
        TextField(
          controller: _ctrl,
          keyboardType: TextInputType.phone,
          inputFormatters: [
            FilteringTextInputFormatter.allow(RegExp(r'[0-9+ ]')),
            LengthLimitingTextInputFormatter(16),
          ],
          decoration: const InputDecoration(labelText: 'Mobile number'),
          onSubmitted: (_) => _save(),
        ),
        if (_error != null) ...[
          const SizedBox(height: 10),
          Text(_error!, style: const TextStyle(color: PtColors.error)),
        ],
        const SizedBox(height: 16),
        FilledButton(
          onPressed: _busy ? null : _save,
          child: Text(_busy ? 'Saving...' : 'Save'),
        ),
      ],
    );
  }
}
