import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../core/api.dart';
import '../core/app_state.dart';
import '../core/widgets.dart';

// FCM registration tokens on purpose: the server sends with `message.token`.
// The newer FID register()/onRegistered API needs a different send target.
// ignore_for_file: deprecated_member_use

const pushTokensPath = '/api/owner/push-tokens';
const prePromptText = 'Get alerted the moment someone needs you at your car';
final _id = RegExp(r'^[A-Za-z0-9]{1,64}$');

/// Where a push tap goes. Data is `{type, tagId, requestId}`; only ids that
/// look like ids are kept. Activity resolves the tagId to a token itself.
String routeForPush(Map<String, dynamic> data) {
  final query = <String, String>{
    for (final e in const {'tag': 'tagId', 'request': 'requestId'}.entries)
      if (data[e.value] is String && _id.hasMatch(data[e.value] as String))
        e.key: data[e.value] as String,
  };
  return Uri(path: '/activity', queryParameters: query.isEmpty ? null : query)
      .toString();
}

/// Token registration and permission logic, with FCM and UI passed in so it
/// runs under test without a device.
class PushClient {
  PushClient({
    required this.api,
    required this.status,
    required this.requestPermission,
    required this.getToken,
    required this.deleteToken,
    required this.prePrompt,
  });

  final ApiClient api;
  final Future<AuthorizationStatus> Function() status;
  final Future<AuthorizationStatus> Function() requestPermission;
  final Future<String?> Function() getToken;
  final Future<void> Function() deleteToken;

  /// The explainer sheet shown once, right before the system prompt.
  final Future<void> Function() prePrompt;

  String? _posted;
  Future<void>? _registering;
  // Bumped by unregister so a register still in flight never posts after it.
  var _gen = 0;
  final _seen = <String>{};

  /// Sign-in and cold start. Shares one run when called twice at once.
  Future<void> register() =>
      _registering ??= _register().whenComplete(() => _registering = null);

  Future<void> _register() async {
    final gen = _gen;
    var s = await status();
    if (s == AuthorizationStatus.notDetermined) {
      await prePrompt();
      s = await requestPermission();
    }
    // Denied: do nothing, never nag.
    if (s != AuthorizationStatus.authorized &&
        s != AuthorizationStatus.provisional) {
      return;
    }
    final token = await getToken();
    if (token != null && gen == _gen) await _post(token);
  }

  /// FCM rotated the token. Only re-post when this run registered one.
  Future<void> onTokenRefresh(String token) async {
    if (_posted != null) await _post(token);
  }

  Future<void> _post(String token) async {
    if (token == _posted) return;
    await api.post(pushTokensPath, {'token': token, 'platform': 'android'});
    _posted = token;
  }

  /// DELETE on the server first (it needs the session), then drop the token.
  /// An in-flight register settles first and then posts nothing. deleteToken
  /// runs even when the lookup or the DELETE throws.
  Future<void> unregister() async {
    _gen++;
    try {
      await _registering?.catchError((_) {});
      final token = _posted ?? await getToken();
      _posted = null;
      if (token != null) await api.delete(pushTokensPath, {'token': token});
    } finally {
      _posted = null;
      await deleteToken();
    }
  }

  /// Session gone without [unregister] (expired): post again next sign-in.
  void forget() => _posted = null;

  /// True the first time a foreground message with this requestId arrives.
  bool firstSighting(RemoteMessage m) {
    final id = m.data['requestId'];
    return id is! String || _seen.add(id);
  }
}

/// App-wide push. `init` runs once in main after Firebase init.
class Push {
  static PushClient? _client;
  static AppState? _app;
  static AppLifecycleListener? _lifecycle;

  static Future<void> init(AppState app) async {
    _app = app;
    // Fallback while push is late or off: refresh whenever the app resumes.
    _lifecycle ??= AppLifecycleListener(onResume: _refresh);
    if (kIsWeb || Firebase.apps.isEmpty) return;
    final m = FirebaseMessaging.instance;
    final client = _client = PushClient(
      api: app.api,
      status: () async => (await m.getNotificationSettings()).authorizationStatus,
      requestPermission: () async =>
          (await m.requestPermission()).authorizationStatus,
      getToken: m.getToken,
      deleteToken: m.deleteToken,
      prePrompt: _showPrePrompt,
    );

    FirebaseMessaging.onMessage.listen(_onForeground);
    FirebaseMessaging.onMessageOpenedApp.listen(_open);
    m.onTokenRefresh.listen((t) => client.onTokenRefresh(t).catchError((_) {}));
    final initial = await m.getInitialMessage();
    if (initial != null) _open(initial);

    // Signed-in cold start (and a late splash sign-in): register once the
    // start screen is up, so the sheet does not sit on the splash.
    var wasOwner = false;
    void watch() {
      if (app.isOwner && !wasOwner) _whenReady((_) => register());
      if (!app.isOwner) client.forget();
      wasOwner = app.isOwner;
    }

    app.addListener(watch);
    watch();
  }

  static Future<void> register() async {
    try {
      await _client?.register();
    } catch (e) {
      if (kDebugMode) debugPrint('push register failed: $e');
    }
  }

  /// Before logout or account deletion. Throws on failure; callers treat it
  /// as best effort.
  static Future<void> unregister() async {
    await _client?.unregister();
  }

  static Future<String?> currentToken() async =>
      _client == null ? null : FirebaseMessaging.instance.getToken();

  static void _onForeground(RemoteMessage m) {
    if (!(_client?.firstSighting(m) ?? false)) return;
    _refresh();
    final ctx = rootKey.currentContext;
    final messenger = ctx == null ? null : ScaffoldMessenger.maybeOf(ctx);
    messenger?.showSnackBar(SnackBar(
      content: Text('New alert: ${m.notification?.title ?? 'ParkTag'}'),
      action: SnackBarAction(label: 'View', onPressed: () => _open(m)),
    ));
  }

  static void _open(RemoteMessage m) {
    final route = routeForPush(m.data);
    _whenReady((router) {
      router.go(route);
      _refresh();
    });
  }

  static void _refresh() {
    final app = _app;
    if (app == null || !app.isOwner) return;
    app.refresh().catchError((_) {});
  }

  /// Runs [fn] once the router exists and the splash has picked the start
  /// screen, so a cold-start tap is not overwritten by the splash redirect.
  static void _whenReady(void Function(GoRouter) fn) {
    final ctx = rootKey.currentContext;
    final router = ctx == null ? null : GoRouter.maybeOf(ctx);
    if (router == null) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _whenReady(fn));
      return;
    }
    final delegate = router.routerDelegate;
    void attempt() {
      if (router.state.uri.path == '/splash') return;
      delegate.removeListener(attempt);
      fn(router);
    }

    delegate.addListener(attempt);
    attempt();
  }

  static Future<void> _showPrePrompt() async {
    final ctx = rootKey.currentContext;
    if (ctx == null) return;
    await showPtSheet<void>(
      ctx,
      builder: (sheet) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Icon(Icons.notifications_active_outlined, size: 40),
          const SizedBox(height: 12),
          Text(prePromptText,
              textAlign: TextAlign.center,
              style: Theme.of(sheet).textTheme.titleMedium),
          const SizedBox(height: 8),
          const Text(
            'Alerts usually arrive in seconds. WhatsApp still reaches you if '
            'your phone delays them.',
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 20),
          FilledButton(
            onPressed: () => Navigator.of(sheet).pop(),
            child: const Text('Continue'),
          ),
        ],
      ),
    );
  }
}
