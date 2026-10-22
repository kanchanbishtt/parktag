import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../../core/theme.dart';
import 'models.dart';

enum VaultSource { camera, gallery, pdf }

class DocTypeField extends StatelessWidget {
  const DocTypeField({super.key, required this.value, required this.onChanged});

  final String value;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return DropdownButtonFormField<String>(
      initialValue: value,
      decoration: const InputDecoration(labelText: 'Document type'),
      items: [
        for (final e in docTypes.entries)
          DropdownMenuItem(value: e.key, child: Text(e.value)),
      ],
      onChanged: (v) => onChanged(v ?? value),
    );
  }
}

/// Type and label, then where the file comes from. Pops (docType, label, source).
class UploadSheet extends StatefulWidget {
  const UploadSheet({super.key});

  @override
  State<UploadSheet> createState() => _UploadSheetState();
}

class _UploadSheetState extends State<UploadSheet> {
  String _type = 'rc';
  final _label = TextEditingController();

  @override
  void dispose() {
    _label.dispose();
    super.dispose();
  }

  void _pick(VaultSource s) =>
      Navigator.pop(context, (_type, _label.text.trim(), s));

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        const Text(
          'Add a document',
          style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 4),
        const Text(
          'PDF, JPG, PNG or WEBP, up to 5MB.',
          style: TextStyle(color: PtColors.muted),
        ),
        const SizedBox(height: 16),
        DocTypeField(value: _type, onChanged: (v) => setState(() => _type = v)),
        const SizedBox(height: 12),
        TextField(
          controller: _label,
          maxLength: 60,
          decoration: const InputDecoration(labelText: 'Label (optional)'),
        ),
        const SizedBox(height: 8),
        OutlinedButton.icon(
          onPressed: () => _pick(VaultSource.camera),
          icon: const Icon(Icons.photo_camera_outlined),
          label: const Text('Take a photo'),
        ),
        const SizedBox(height: 8),
        OutlinedButton.icon(
          onPressed: () => _pick(VaultSource.gallery),
          icon: const Icon(Icons.photo_library_outlined),
          label: const Text('Choose a photo'),
        ),
        const SizedBox(height: 8),
        OutlinedButton.icon(
          onPressed: () => _pick(VaultSource.pdf),
          icon: const Icon(Icons.picture_as_pdf_outlined),
          label: const Text('Choose a PDF'),
        ),
      ],
    );
  }
}

/// Pops (docType, label).
class RenameSheet extends StatefulWidget {
  const RenameSheet({super.key, required this.doc});

  final VaultDoc doc;

  @override
  State<RenameSheet> createState() => _RenameSheetState();
}

class _RenameSheetState extends State<RenameSheet> {
  late String _type = docTypes.containsKey(widget.doc.docType)
      ? widget.doc.docType
      : 'other';
  late final _label = TextEditingController(text: widget.doc.label);

  @override
  void dispose() {
    _label.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        const Text(
          'Rename document',
          style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 16),
        DocTypeField(value: _type, onChanged: (v) => setState(() => _type = v)),
        const SizedBox(height: 12),
        TextField(
          controller: _label,
          maxLength: 60,
          decoration: const InputDecoration(labelText: 'Label'),
        ),
        const SizedBox(height: 8),
        FilledButton(
          onPressed: () => Navigator.pop(context, (_type, _label.text.trim())),
          child: const Text('Save'),
        ),
      ],
    );
  }
}

class ImageViewer extends StatelessWidget {
  const ImageViewer({super.key, required this.title, required this.bytes});

  final String title;
  final Uint8List bytes;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: Text(title),
      ),
      body: InteractiveViewer(
        maxScale: 5,
        child: Center(child: Image.memory(bytes, gaplessPlayback: true)),
      ),
    );
  }
}
