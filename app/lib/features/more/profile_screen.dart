import 'package:flutter/material.dart';

import '../../core/api.dart';
import '../../core/app_state.dart';
import '../../core/models.dart';
import '../../core/platform.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';

/// Values accepted by PATCH /api/owner/profile (profile-details.js GENDERS).
const genderLabels = {
  'male': 'Male',
  'female': 'Female',
  'other': 'Other',
  'prefer_not_to_say': 'Prefer not to say',
};

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  final _name = TextEditingController();
  String? _gender;
  String? _dob; // YYYY-MM-DD, as the server stores it.
  bool _saving = false;
  String? _error;

  bool _seeded = false;
  Object? _loadError;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && AppScope.read(context).owner == null) _load();
    });
  }

  Future<void> _load() async {
    setState(() => _loadError = null);
    try {
      await AppScope.read(context).refresh();
    } catch (e) {
      if (mounted) setState(() => _loadError = e);
    }
  }

  /// Seeds the form once, from the first non-null owner. Saving a blank form
  /// would erase the stored gender and DOB, so the form waits for it.
  void _seed(Owner owner) {
    _seeded = true;
    _name.text = owner.displayName;
    final g = owner.profile['gender'];
    _gender = genderLabels.containsKey(g) ? g as String : null;
    final d = owner.profile['dateOfBirth'];
    _dob = d is String ? d : null;
  }

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _pickDob() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      firstDate: DateTime(now.year - 100),
      lastDate: now,
      initialDate: DateTime.tryParse(_dob ?? '') ?? DateTime(now.year - 30),
    );
    if (picked == null) return;
    String two(int v) => v.toString().padLeft(2, '0');
    setState(() => _dob = '${picked.year}-${two(picked.month)}-${two(picked.day)}');
  }

  Future<void> _save() async {
    if (_name.text.trim().isEmpty) {
      setState(() => _error = 'Enter your name.');
      return;
    }
    final app = AppScope.read(context);
    final messenger = ScaffoldMessenger.of(context);
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      // Email and mobile are login identifiers and never go through this route.
      await app.api.patch('/api/owner/profile', {
        'displayName': _name.text.trim(),
        'gender': _gender,
        'dateOfBirth': _dob,
      });
      messenger.showSnackBar(const SnackBar(content: Text('Profile saved.')));
      await app.refresh();
    } on ApiError catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final owner = AppScope.of(context).owner;
    if (owner == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Profile')),
        body: Padding(
          padding: const EdgeInsets.all(PtLayout.padX),
          child: _loadError != null
              ? ErrorCard.from(_loadError!, onRetry: _load)
              : const Skeleton(rows: 3, height: 56),
        ),
      );
    }
    if (!_seeded) _seed(owner);
    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: ListView(
        padding: const EdgeInsets.all(PtLayout.padX),
        children: [
          TextField(
            controller: _name,
            textCapitalization: TextCapitalization.words,
            decoration: const InputDecoration(labelText: 'Your name'),
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<String?>(
            initialValue: _gender,
            decoration: const InputDecoration(labelText: 'Gender (optional)'),
            items: [
              const DropdownMenuItem(value: null, child: Text('Not set')),
              for (final e in genderLabels.entries)
                DropdownMenuItem(value: e.key, child: Text(e.value)),
            ],
            onChanged: (v) => setState(() => _gender = v),
          ),
          const SizedBox(height: 12),
          InputDecorator(
            decoration: InputDecoration(
              labelText: 'Date of birth (optional)',
              suffixIcon: _dob == null
                  ? null
                  : IconButton(
                      tooltip: 'Clear',
                      icon: const Icon(Icons.close),
                      onPressed: () => setState(() => _dob = null),
                    ),
            ),
            child: InkWell(
              onTap: _pickDob,
              child: Text(_dob ?? 'Not set'),
            ),
          ),
          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(_error!, style: const TextStyle(color: PtColors.error)),
          ],
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _saving ? null : _save,
            child: Text(_saving ? 'Saving...' : 'Save'),
          ),
          const SizedBox(height: 24),
          const Divider(),
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Email'),
            subtitle: Text(owner.email ?? 'Not added'),
          ),
          _MobileSection(current: owner.mobile),
        ],
      ),
    );
  }
}

/// Add or change the mobile: send-otp returns `{phoneHint}`, then
/// POST /api/owner/mobile `{mobile, otp}` stores it.
class _MobileSection extends StatefulWidget {
  const _MobileSection({required this.current});

  final String? current;

  @override
  State<_MobileSection> createState() => _MobileSectionState();
}

class _MobileSectionState extends State<_MobileSection> {
  final _mobile = TextEditingController();
  final _otp = TextEditingController();
  bool _editing = false;
  String? _hint;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _mobile.dispose();
    _otp.dispose();
    super.dispose();
  }

  Future<void> _run(Future<void> Function(ApiClient api) step) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await step(AppScope.read(context).api);
    } on ApiError catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _send() => _run((api) async {
        final res = await api.post(
            '/api/owner/mobile/send-otp', {'mobile': _mobile.text.trim()});
        setState(() => _hint = res['phoneHint'] as String? ?? 'your phone');
      });

  Future<void> _verify() => _run((api) async {
        final app = AppScope.read(context);
        final messenger = ScaffoldMessenger.of(context);
        await api.post('/api/owner/mobile',
            {'mobile': _mobile.text.trim(), 'otp': _otp.text.trim()});
        setState(() {
          _editing = false;
          _hint = null;
          _otp.clear();
        });
        messenger.showSnackBar(const SnackBar(content: Text('Mobile saved.')));
        await app.refresh();
      });

  @override
  Widget build(BuildContext context) {
    final current = widget.current;
    final error = _error == null
        ? const SizedBox.shrink()
        : Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(_error!, style: const TextStyle(color: PtColors.error)),
          );
    if (!_editing) {
      return ListTile(
        contentPadding: EdgeInsets.zero,
        title: const Text('Mobile'),
        subtitle: Text(current ?? 'Not added'),
        trailing: TextButton(
          onPressed: () => setState(() => _editing = true),
          child: Text(current == null ? 'Add' : 'Change'),
        ),
      );
    }
    final hint = _hint;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text('We verify it once, so a scanner can reach you without seeing it.',
            style: TextStyle(color: PtColors.muted)),
        const SizedBox(height: 8),
        TextField(
          controller: _mobile,
          enabled: hint == null,
          keyboardType: TextInputType.phone,
          decoration: const InputDecoration(labelText: 'Mobile number'),
        ),
        if (hint == null) ...[
          error,
          const SizedBox(height: 12),
          FilledButton(
            onPressed: _busy ? null : _send,
            child: const Text('Send code'),
          ),
        ] else
          SecureScreen(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const SizedBox(height: 12),
                Text('Enter the code we sent to $hint.'),
                OtpField(controller: _otp),
                error,
                const SizedBox(height: 12),
                FilledButton(
                  onPressed: _busy ? null : _verify,
                  child: const Text('Verify'),
                ),
              ],
            ),
          ),
        TextButton(
          onPressed: () => setState(() {
            _editing = false;
            _hint = null;
            _error = null;
          }),
          child: const Text('Cancel'),
        ),
      ],
    );
  }
}
