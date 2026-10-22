import 'package:flutter/widgets.dart';

import 'api.dart';
import 'models.dart';
import 'session.dart' as session_lib;

/// The root navigator. Every `*RootRoutes` entry uses `parentNavigatorKey: rootKey`.
final rootKey = GlobalKey<NavigatorState>();

/// Session plus the last `/api/owner/dashboard` payload. Screens read it via
/// [AppScope.of] and call [refresh] after any mutation.
class AppState extends ChangeNotifier {
  AppState(this.api) {
    api.onSessionExpired = _clear;
  }

  final ApiClient api;

  Map<String, dynamic>? session;
  Map<String, dynamic>? dashboard;

  bool get isOwner => session?['role'] == 'owner';

  Owner? get owner {
    final o = dashboard?['owner'];
    return o is Map<String, dynamic> ? Owner.fromJson(o) : null;
  }

  Dashboard? get dashboardData {
    final d = dashboard;
    return d == null ? null : Dashboard.fromJson(d);
  }

  Referral? get referral => dashboardData?.referral;

  List<Tag> get tags => _list('tags', Tag.fromJson);
  List<ContactRequest> get requests => _list('requests', ContactRequest.fromJson);

  /// Activity rows carry the tag token, not its id; resolve through the tags.
  String? tokenForTagId(String tagId) {
    for (final t in tags) {
      if (t.id == tagId) return t.token;
    }
    return null;
  }

  Tag? tagById(String tagId) {
    for (final t in tags) {
      if (t.id == tagId) return t;
    }
    return null;
  }

  /// Contact requests reference their tag by scan token.
  Tag? tagForToken(String token) {
    for (final t in tags) {
      if (t.token == token) return t;
    }
    return null;
  }

  /// Referral code parked from a `/get?ref=CODE` link, read by the shop at
  /// checkout and sent as `ref`. The server decides whether it applies.
  String? get pendingReferralCode => _pendingReferral;
  String? _pendingReferral;

  /// Parks [raw] if it is a well-formed code; junk is ignored.
  Future<void> setPendingReferralCode(String? raw) async {
    final code = parseReferralCode(raw);
    if (code == null) return;
    // No notifyListeners: this runs inside a router redirect, and the
    // router listens to AppState. Readers fetch it at checkout.
    _pendingReferral = code;
    try {
      await api.store
          .writeReferral('$code|${DateTime.now().millisecondsSinceEpoch}');
    } catch (_) {
      // Memory still holds it for this run.
    }
  }

  /// Call after an order is placed so the code is not spent twice.
  Future<void> clearPendingReferralCode() async {
    _pendingReferral = null;
    try {
      await api.store.clearReferral();
    } catch (_) {}
  }

  Future<void> _loadPendingReferral() async {
    try {
      _pendingReferral = referralFromStored(await api.store.readReferral());
      if (_pendingReferral == null) await api.store.clearReferral();
    } catch (_) {
      _pendingReferral = null;
    }
  }

  /// Cold start: ask the server whether the stored cookie is still an owner.
  /// Offline leaves the app signed out for this run; the splash retries.
  Future<void> bootstrap() async {
    await _loadPendingReferral();
    if (!await api.hasCookie()) return;
    try {
      await loadSession();
    } on ApiError {
      // Keep the cookie; only `session:null` clears it.
    }
  }

  /// `GET /api/session`. Call after any sign-in, before [refresh].
  Future<void> loadSession() async {
    session = await api.fetchSession();
    if (!isOwner) dashboard = null;
    notifyListeners();
  }

  Future<void> refresh() async {
    dashboard = await api.get('/api/owner/dashboard', query: {'qr': '0'});
    notifyListeners();
  }

  Future<void> signOut() async {
    await session_lib.signOut(api);
    _clear();
  }

  void _clear() {
    session = null;
    dashboard = null;
    notifyListeners();
  }

  List<T> _list<T>(String key, T Function(Map<String, dynamic>) from) {
    final v = dashboard?[key];
    if (v is! List) return const [];
    return [for (final e in v) if (e is Map<String, dynamic>) from(e)];
  }
}

/// Makes [AppState] reachable from any widget and rebuilds dependents on change.
class AppScope extends InheritedNotifier<AppState> {
  const AppScope({super.key, required AppState app, required super.child})
      : super(notifier: app);

  static AppState of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<AppScope>()!.notifier!;

  /// Without subscribing to rebuilds (for callbacks).
  static AppState read(BuildContext context) =>
      context.getInheritedWidgetOfExactType<AppScope>()!.notifier!;
}

/// Same shape the server validates (src/frontend/scripts/referral-link.js).
final _referralCode = RegExp(r'^[2-9A-HJKMNP-TVWXYZ]{6}$');

/// Normalised code, or null for anything the server would refuse anyway.
String? parseReferralCode(String? raw) {
  final code = raw?.trim().toUpperCase();
  return code != null && _referralCode.hasMatch(code) ? code : null;
}

/// The web keeps a code for one visit only. The app has no visits, so a parked
/// code lapses after [referralTtl] instead of riding on an order months later.
const referralTtl = Duration(days: 7);

String? referralFromStored(String? stored, [DateTime? now]) {
  final parts = stored?.split('|');
  if (parts == null || parts.length != 2) return null;
  final at = int.tryParse(parts[1]);
  if (at == null) return null;
  final age = (now ?? DateTime.now())
      .difference(DateTime.fromMillisecondsSinceEpoch(at));
  return age.isNegative || age > referralTtl ? null : parseReferralCode(parts[0]);
}
