import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../core/api.dart';
import '../../core/app_state.dart';
import '../../core/models.dart';
import '../../core/platform.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'activity_screen.dart';
import 'owner_common.dart';
import 'tag_etag.dart';
import 'tag_number_form.dart';
import 'tag_sections.dart';

/// `/tags/:tagId`: switches, contacts, QR and E-Tag share, documents, activity.
/// [open] (etag | premium | replacement) scrolls to that section, as
/// vehicle-detail.js autoOpenSection does.
class TagDetailScreen extends StatefulWidget {
  const TagDetailScreen({super.key, required this.tagId, this.open});

  final String tagId;
  final String? open;

  @override
  State<TagDetailScreen> createState() => _TagDetailScreenState();
}

class _TagDetailScreenState extends State<TagDetailScreen> {
  bool _busy = false;
  bool _opened = false;
  final _keys = {
    'etag': GlobalKey(),
    'premium': GlobalKey(),
    'replacement': GlobalKey(),
  };

  /// Scrolls to the `?open=` section once the tag has loaded.
  void _autoOpen() {
    final key = _keys[widget.open];
    if (_opened || key == null) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_opened) return;
      // Sections sit in one non-lazy Column, so the target is built by now;
      // a missing one (no E-Tag card on a free tag) will not appear later.
      _opened = true;
      final ctx = key.currentContext;
      if (ctx == null || !ctx.mounted) return;
      Scrollable.ensureVisible(
        ctx,
        alignment: 0.3,
        duration: const Duration(milliseconds: 300),
      );
    });
  }

  /// Runs a mutation, shows server text on failure, then refreshes best effort.
  Future<bool> _run(Future<void> Function(ApiClient api) call) async {
    final app = AppScope.read(context);
    setState(() => _busy = true);
    try {
      await call(app.api);
    } catch (e) {
      if (mounted) showError(context, e);
      if (mounted) setState(() => _busy = false);
      return false;
    }
    try {
      await app.refresh();
    } on ApiError {
      // Saved; the screen catches up on the next pull.
    } finally {
      if (mounted) setState(() => _busy = false);
    }
    return true;
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final tag = app.tagById(widget.tagId);
    if (tag != null) _autoOpen();
    return Scaffold(
      appBar: AppBar(title: Text(tag == null ? 'Vehicle' : tagTitle(tag))),
      body: DashboardView(
        builder: (context, app) => tag == null
            ? [
                const EmptyState(
                  title: 'Vehicle not found',
                  body: 'It may have been deleted.',
                  icon: Icons.directions_car_outlined,
                ),
              ]
            : _sections(context, app, tag),
      ),
    );
  }

  List<Widget> _sections(BuildContext context, AppState app, Tag tag) {
    final base = '/api/owner/tags/${tag.id}';
    final backup = app.owner?.backupMobile;
    return [
      Card(
        child: Column(
          children: [
            SwitchListTile(
              title: const Text('Tag active'),
              subtitle: const Text('Scanners can reach you through this tag'),
              value: tag.isActive,
              onChanged: _busy
                  ? null
                  : (v) => _run(
                      (api) => api.post('$base/status', {
                        'status': v ? 'active' : 'inactive',
                      }),
                    ),
            ),
            const Divider(height: 1),
            SwitchListTile(
              title: const Text('Calls active'),
              subtitle: const Text(
                'Scanners can call you through a masked number',
              ),
              value: !tag.callsPaused,
              onChanged: _busy
                  ? null
                  : (v) =>
                        _run((api) => api.post('$base/calls', {'active': v})),
            ),
          ],
        ),
      ),
      const SizedBox(height: 12),
      KeyedSubtree(
        key: _keys['premium'],
        child: PremiumCard(tag: tag),
      ),
      const SizedBox(height: 12),
      MembershipStatusCard(tag: tag),
      const SizedBox(height: 12),
      VehicleInfoCard(tag: tag, owner: app.owner),
      const SizedBox(height: 12),
      Card(
        child: Column(
          children: [
            ListTile(
              leading: const Icon(
                Icons.emergency_outlined,
                color: PtColors.error,
              ),
              title: const Text('Emergency contact'),
              subtitle: Text(tag.emergencyContact ?? 'Not set'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => _editEmergency(tag),
            ),
            if (tag.hasEmergencyContact)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                child: OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(
                    foregroundColor: PtColors.error,
                  ),
                  icon: const Icon(Icons.warning_amber_outlined),
                  label: const Text('Test SOS Alert'),
                  onPressed: () => showSosTest(context, tag),
                ),
              ),
            const Divider(height: 1),
            ListTile(
              leading: const Icon(Icons.phone_forwarded_outlined),
              title: const Text('Backup number'),
              subtitle: Text(backup ?? 'Not set'),
              trailing: backup == null
                  ? const Icon(Icons.chevron_right)
                  : IconButton(
                      tooltip: 'Remove backup number',
                      icon: const Icon(Icons.delete_outline),
                      onPressed: _busy ? null : _removeBackup,
                    ),
              onTap: _editBackup,
            ),
          ],
        ),
      ),
      const SizedBox(height: 12),
      // vehicle-detail.js updatePremiumUI: Download only for premium tags.
      if (tag.premium) ...[
        Card(
          key: _keys['etag'],
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                const Text(
                  'Download Premium Tag',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 12),
                if (tag.scanUrl.isNotEmpty)
                  Container(
                    color: Colors.white,
                    child: QrImageView(data: tag.scanUrl, size: 200),
                  ),
                const SizedBox(height: 12),
                FilledButton.icon(
                  icon: const Icon(Icons.share),
                  label: const Text('Save / share E-Tag'),
                  onPressed: tag.scanUrl.isEmpty ? null : () => _share(tag),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
      ],
      ContactPageTile(tag: tag),
      const SizedBox(height: 12),
      Card(
        child: ListTile(
          leading: const Icon(Icons.folder_outlined),
          title: const Text('Documents'),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => context.push('/tags/${tag.id}/vault'),
        ),
      ),
      const SizedBox(height: 20),
      Row(
        children: [
          const Expanded(
            child: Text(
              'Activity',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
            ),
          ),
          TextButton(
            onPressed: () => context.push('/activity?tag=${tag.id}'),
            child: const Text('See all'),
          ),
        ],
      ),
      const SizedBox(height: 8),
      ActivityList(token: tag.token, limit: 3),
      const SizedBox(height: 20),
      KeyedSubtree(
        key: _keys['replacement'],
        child: ReplacementCard(tag: tag),
      ),
      const SizedBox(height: 20),
      OutlinedButton.icon(
        style: OutlinedButton.styleFrom(foregroundColor: PtColors.error),
        icon: const Icon(Icons.delete_outline),
        label: const Text('Delete vehicle'),
        onPressed: _busy ? null : () => _delete(tag),
      ),
    ];
  }

  Future<void> _share(Tag tag) async {
    try {
      final sheet = EtagSheet(tag);
      await PtPlatform.shareImage(await etagSheetPng(sheet), sheet.fileName);
    } catch (_) {
      if (mounted) showSnack(context, 'Could not share the E-Tag. Try again.');
    }
  }

  Future<void> _editEmergency(Tag tag) async {
    final saved = await showPtSheet<bool>(
      context,
      builder: (_) => TagNumberForm(
        title: 'Emergency contact',
        hint: 'Who we call if a scanner reports an accident. Not your own number.',
        initial: tag.emergencyContact,
        onSave: (api, n) => api.post(
          '/api/owner/tags/${tag.id}/emergency-contact',
          {'emergencyContact': n},
        ),
      ),
    );
    if (saved == true && mounted) {
      showSnack(context, 'Emergency contact saved.');
    }
  }

  Future<void> _editBackup() async {
    final saved = await showPtSheet<bool>(
      context,
      builder: (_) => TagNumberForm(
        title: 'Backup number',
        hint: 'We ring this number if your main phone does not answer.',
        initial: AppScope.read(context).owner?.backupMobile,
        confirmNumber: true,
        onSave: (api, n) => api.post('/api/owner/backup-mobile', {'mobile': n}),
      ),
    );
    if (saved == true && mounted) showSnack(context, 'Backup number saved.');
  }

  Future<void> _removeBackup() async {
    final yes = await confirm(
      context,
      title: 'Remove backup number?',
      body: 'Calls will only ring your main number.',
      ok: 'Remove',
    );
    if (yes) await _run((api) => api.delete('/api/owner/backup-mobile'));
  }

  Future<void> _delete(Tag tag) async {
    final yes = await confirm(
      context,
      title: 'Delete this vehicle?',
      body: 'This also deletes its documents.',
      ok: 'Delete',
    );
    if (!yes || !mounted) return;
    final ok = await _run((api) => api.delete('/api/owner/tags/${tag.id}'));
    if (ok && mounted) context.go('/tags');
  }
}
