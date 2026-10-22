import 'dart:async';
import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/api.dart';
import '../../core/app_state.dart';
import '../../core/models.dart';
import '../../core/platform.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'models.dart';
import 'vault_list.dart';
import 'vault_pin.dart';
import 'vault_sheets.dart';
import 'vault_shrink.dart';

/// Picks one file. Injected in tests.
typedef VaultPicker = Future<XFile?> Function(VaultSource source);

const vaultImageMaxEdge = 2000.0;
const vaultImageQuality = 82;

Future<XFile?> pickVaultFile(VaultSource source) async {
  if (source == VaultSource.pdf) {
    final f = await FilePicker.pickFile(
      type: FileType.custom,
      allowedExtensions: const ['pdf'],
    );
    return f?.xFile;
  }
  return ImagePicker().pickImage(
    source: source == VaultSource.camera
        ? ImageSource.camera
        : ImageSource.gallery,
    // Web document-compress.js top rung: 2000px long edge, quality 0.82.
    maxWidth: vaultImageMaxEdge,
    maxHeight: vaultImageMaxEdge,
    imageQuality: vaultImageQuality,
  );
}

enum _Phase { loading, error, setPin, locked, list }

/// `/tags/:tagId/vault`: set PIN, unlock, list, upload, view, rename, delete.
/// Locks (server and cache/vault) on leave and on app pause.
class VaultScreen extends StatefulWidget {
  const VaultScreen({
    super.key,
    required this.tagId,
    this.picker = pickVaultFile,
  });

  final String tagId;
  final VaultPicker picker;

  @override
  State<VaultScreen> createState() => _VaultScreenState();
}

class _VaultScreenState extends State<VaultScreen> with WidgetsBindingObserver {
  late ApiClient _api;
  bool _started = false;

  _Phase _phase = _Phase.loading;
  Object? _loadError;
  List<VaultDoc> _docs = const [];
  int _usedBytes = 0;
  VaultEntitlement? _entitlement;
  VaultLimits? _limits;

  final _pin = TextEditingController();
  final _pin2 = TextEditingController();
  String? _pinError;
  bool _busy = false;

  // A picker or PDF viewer we opened ourselves pauses the app; that is not leaving.
  bool _away = false;
  // Clears _away if the hand-off never paused us (no viewer app, chooser
  // dismissed, multi-window), so a real background still locks.
  Timer? _awayTimer;
  Route<void>? _viewer;

  static const _docsPath = '/api/owner/vault/documents';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _api = AppScope.read(context).api;
    if (!_started) {
      _started = true;
      _loadStatus();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _awayTimer?.cancel();
    unawaited(_lockRemote());
    _pin.dispose();
    _pin2.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused) {
      // The viewer took over as expected; resumed clears _away.
      _awayTimer?.cancel();
      if (!_away) _lock();
    } else if (state == AppLifecycleState.resumed) {
      _awayTimer?.cancel();
      _away = false;
      // A PDF handed to a viewer is done with once we are back.
      _wipeCache();
    }
  }

  // ---- data ----

  Future<void> _loadStatus() async {
    setState(() => _phase = _Phase.loading);
    try {
      final s = await _api.get(
        '/api/owner/vault/status',
        query: {'tagId': widget.tagId},
      );
      if (!mounted) return;
      final limits = s['limits'];
      _limits = limits is Map<String, dynamic>
          ? VaultLimits.fromJson(limits)
          : null;
      _entitlement = _parseEntitlement(s['entitlement']) ?? _entitlement;
      if (s['hasPin'] != true) {
        setState(() => _phase = _Phase.setPin);
      } else if (s['unlocked'] != true) {
        setState(() => _phase = _Phase.locked);
      } else {
        await _loadDocs();
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _phase = _Phase.error;
        _loadError = e;
      });
    }
  }

  Future<void> _loadDocs() async {
    try {
      final r = await _api.get(_docsPath, query: {'tagId': widget.tagId});
      final list = r['documents'];
      if (!mounted) return;
      setState(() {
        _docs = [
          if (list is List)
            for (final d in list)
              if (d is Map<String, dynamic>) VaultDoc.fromJson(d),
        ];
        _usedBytes = r['usedBytes'] is num
            ? (r['usedBytes'] as num).toInt()
            : 0;
        _entitlement = _parseEntitlement(r['entitlement']);
        _phase = _Phase.list;
      });
    } catch (e) {
      if (!_handledLocked(e) && mounted) {
        setState(() {
          _phase = _Phase.error;
          _loadError = e;
        });
      }
    }
  }

  static VaultEntitlement? _parseEntitlement(Object? j) =>
      j is Map<String, dynamic> ? VaultEntitlement.fromJson(j) : null;

  /// A 423 anywhere means the grant is gone: back to unlock.
  bool _handledLocked(Object e) {
    if (e is! ApiError || e.status != 423) return false;
    _closeViewer();
    if (mounted) {
      setState(() {
        _phase = _Phase.locked;
        _pinError = null;
      });
    }
    return true;
  }

  void _closeViewer() {
    final v = _viewer;
    if (v != null && v.isActive) v.navigator?.removeRoute(v);
    _viewer = null;
  }

  Future<void> _wipeCache() async {
    try {
      await PtPlatform.wipeCache('vault');
    } catch (_) {
      // No platform channel (web, tests without a handler).
    }
  }

  Future<void> _lockRemote() async {
    await _wipeCache();
    try {
      await _api.post('/api/owner/vault/lock');
    } on ApiError {
      // The grant also expires server-side.
    }
  }

  void _lock() {
    _closeViewer();
    unawaited(_lockRemote());
    if (mounted && _phase == _Phase.list) {
      setState(() {
        _phase = _Phase.locked;
        _docs = const [];
      });
    }
  }

  // ---- PIN ----

  Future<void> _submitPin() async {
    final pin = _pin.text;
    final setting = _phase == _Phase.setPin;
    if (pin.length < 4) {
      setState(() => _pinError = 'Enter 4 to 8 digits.');
      return;
    }
    if (setting && pin != _pin2.text) {
      setState(() => _pinError = 'The PINs do not match.');
      return;
    }
    setState(() {
      _busy = true;
      _pinError = null;
    });
    try {
      await _api.post(
        setting ? '/api/owner/vault/pin' : '/api/owner/vault/unlock',
        {'pin': pin},
      );
      _pin.clear();
      _pin2.clear();
      await _loadDocs();
    } on ApiError catch (e) {
      if (mounted) {
        setState(
          () => _pinError = e.status == 429 ? rateLimitMessage(e) : e.message,
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  // ---- documents ----

  void _toast(String message) =>
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(message)));

  Future<void> _upload() async {
    final choice = await showPtSheet<(String, String, VaultSource)>(
      context,
      builder: (_) => const UploadSheet(),
    );
    if (choice == null || !mounted) return;
    final (docType, label, source) = choice;

    XFile? file;
    _away = true;
    try {
      file = await widget.picker(source);
    } catch (_) {
      if (mounted) _toast('Could not open the picker. Try again.');
      return;
    } finally {
      _away = false;
    }
    if (file == null) return;

    try {
      if (!mounted) return;
      final size = await file.length();
      var name = file.name;
      // image_picker only re-encodes JPEG, so a big PNG or WEBP can still be
      // over the limit: shrink it down the web ladder before refusing it.
      final shrink = size > maxUploadBytes && isShrinkableImage(name);
      final error = shrink ? null : checkUpload(name, size);
      if (error != null) {
        _toast(error);
        return;
      }
      setState(() => _busy = true);
      var bytes = await file.readAsBytes();
      if (shrink) {
        final s = await shrinkToFit(bytes, name);
        if (s == null) {
          if (mounted) _toast(tooBigImageMessage);
          return;
        }
        bytes = s.bytes;
        name = s.filename;
      }
      await _api.multipart(
        _docsPath,
        fields: {'tagId': widget.tagId, 'docType': docType, 'label': label},
        fileField: 'file',
        bytes: bytes,
        filename: name,
        contentType: uploadMediaType(name)!,
      );
      if (!mounted) return;
      _toast('Document saved, ${formatBytes(bytes.length)}.');
      await _loadDocs();
    } on ApiError catch (e) {
      if (_handledLocked(e) || !mounted) return;
      _toast(uploadErrorMessage(e));
      // Filled up elsewhere: reload so the server's allowance shows the full card.
      if (e.status == 409) await _loadDocs();
    } catch (_) {
      if (mounted) _toast('Could not read that file. Try again.');
    } finally {
      if (mounted) setState(() => _busy = false);
      await _deletePickerCopy(file);
    }
  }

  /// Picker copies of an ID document must not linger in the app cache. Only
  /// paths under our cache dir are touched, never the user's original file.
  Future<void> _deletePickerCopy(XFile file) async {
    if (kIsWeb) return;
    try {
      if (isPickerCopy(file.path, await PtPlatform.cacheDir())) {
        await File(file.path).delete();
      }
    } catch (_) {
      // No platform channel, or already gone.
    }
  }

  Future<void> _view(VaultDoc doc) async {
    try {
      final bytes = await _api.getBytes('$_docsPath/${doc.id}/file');
      if (!mounted) return;
      if (doc.isImage) {
        // Shown from memory only, never written to disk.
        final route = MaterialPageRoute<void>(
          fullscreenDialog: true,
          builder: (_) => ImageViewer(title: doc.title, bytes: bytes),
        );
        _viewer = route;
        await Navigator.of(context).push(route);
        _viewer = null;
        return;
      }
      final dir = Directory('${await PtPlatform.cacheDir()}/vault');
      await dir.create(recursive: true);
      final name = doc.id.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '');
      final file = File('${dir.path}/$name.pdf');
      await file.writeAsBytes(bytes, flush: true);
      _away = true;
      _awayTimer?.cancel();
      await PtPlatform.openFile(file.path, 'application/pdf');
      _awayTimer = Timer(const Duration(seconds: 3), () => _away = false);
    } on ApiError catch (e) {
      if (!_handledLocked(e) && mounted) _toast(e.message);
    } catch (_) {
      _away = false;
      _awayTimer?.cancel();
      await _wipeCache();
      if (mounted) _toast('Could not open this document. Try again.');
    }
  }

  Future<void> _rename(VaultDoc doc) async {
    final result = await showPtSheet<(String, String)>(
      context,
      builder: (_) => RenameSheet(doc: doc),
    );
    if (result == null) return;
    await _mutate(
      () => _api.patch('$_docsPath/${doc.id}', {
        'docType': result.$1,
        'label': result.$2,
      }),
    );
  }

  Future<void> _delete(VaultDoc doc) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete this document?'),
        content: Text('${doc.title} will be removed for good.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: TextButton.styleFrom(foregroundColor: PtColors.error),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    await _mutate(() => _api.delete('$_docsPath/${doc.id}'));
  }

  Future<void> _mutate(Future<Object?> Function() call) async {
    try {
      await call();
      await _loadDocs();
    } on ApiError catch (e) {
      if (!_handledLocked(e) && mounted) _toast(e.message);
    }
  }

  // ---- UI ----

  String _title(BuildContext context) {
    for (final t in AppScope.of(context).tags) {
      if (t.id == widget.tagId) return t.plateNumber ?? t.vehicleLabel;
    }
    return 'Documents';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: PtColors.bg,
      appBar: AppBar(
        title: Text(_title(context)),
        actions: [
          if (_phase == _Phase.list)
            IconButton(
              tooltip: 'Lock',
              icon: const Icon(Icons.lock_outline),
              onPressed: _lock,
            ),
        ],
      ),
      floatingActionButton:
          _phase == _Phase.list && !isVehicleFull(_docs.length, _entitlement)
          ? FloatingActionButton.extended(
              onPressed: _busy ? null : _upload,
              backgroundColor: PtColors.accent,
              foregroundColor: Colors.white,
              icon: const Icon(Icons.add),
              label: const Text('Add document'),
            )
          : null,
      body: SafeArea(child: _body()),
    );
  }

  Widget _body() {
    switch (_phase) {
      case _Phase.loading:
        return const Padding(
          padding: EdgeInsets.all(PtLayout.padX),
          child: Skeleton(),
        );
      case _Phase.error:
        return Padding(
          padding: const EdgeInsets.all(PtLayout.padX),
          child: ErrorCard.from(_loadError ?? '', onRetry: _loadStatus),
        );
      case _Phase.setPin:
      case _Phase.locked:
        return _pinPanel(setting: _phase == _Phase.setPin);
      case _Phase.list:
        return _list();
    }
  }

  Widget _pinPanel({required bool setting}) => VaultPinPanel(
    setting: setting,
    pin: _pin,
    pin2: _pin2,
    error: _pinError,
    busy: _busy,
    onSubmit: _submitPin,
  );

  Widget _list() => VaultList(
    docs: _docs,
    usedBytes: _usedBytes,
    entitlement: _entitlement,
    limits: _limits,
    onRefresh: _loadDocs,
    onView: _view,
    onRename: _rename,
    onDelete: _delete,
  );
}
