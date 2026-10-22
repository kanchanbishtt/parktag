import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../push/push.dart';
import 'api.dart';
import 'app_state.dart';
import 'platform.dart';

const bridgeHost = 'app.parktag.me';
const _cookieName = 'wavetag_session';

// Frames the sign-in page needs: reCAPTCHA and the Firebase SMS flow.
const _frameHosts = {
  bridgeHost,
  'www.google.com',
  'www.gstatic.com',
  'www.recaptcha.net',
  'apis.google.com',
  'parktag1.firebaseapp.com',
};

enum BridgeNav { allow, external, cancel }

/// Host allowlist. Top-level pages stay on app.parktag.me; reCAPTCHA and
/// Firebase may load only as frames. `tel:` and wa.me leave the app.
/// Everything else, accounts.google.com included, is cancelled.
BridgeNav bridgeNavigation(Uri uri, {required bool mainFrame}) {
  if (uri.scheme == 'tel') return BridgeNav.external;
  if (uri.scheme == 'https' && uri.host == 'wa.me') return BridgeNav.external;
  if (uri.scheme == 'about' || (uri.scheme == 'data' && !mainFrame)) {
    return BridgeNav.allow;
  }
  if (uri.scheme != 'https' || uri.userInfo.isNotEmpty) return BridgeNav.cancel;
  if (uri.host == bridgeHost) return BridgeNav.allow;
  if (mainFrame || !_frameHosts.contains(uri.host)) return BridgeNav.cancel;
  if (uri.host == 'www.google.com' && !uri.path.startsWith('/recaptcha/')) {
    return BridgeNav.cancel;
  }
  return BridgeNav.allow;
}

/// The completion rule: a cookie AND a confirmed owner session.
bool bridgeShouldFinish(String? cookie, String? sessionRole) =>
    cookie != null && cookie.isNotEmpty && sessionRole == 'owner';

/// Checks a WebView cookie against `GET /api/session`. Stores it only when the
/// server confirms an owner; on anything else writes nothing.
Future<bool> tryCompleteBridge(ApiClient api, String? cookie) async {
  if (cookie == null || cookie.isEmpty) return false;
  String? role;
  try {
    final r = (await api.fetchSession(cookie: cookie))?['role'];
    role = r is String ? r : null;
  } on ApiError {
    return false;
  }
  if (!bridgeShouldFinish(cookie, role)) return false;
  await api.adoptCookie(cookie);
  return true;
}

/// Host-locked WebView for sign-in, SMS fallback and activation only.
/// No JavaScript handlers: the page cannot call into the app.
class WebBridgeScreen extends StatefulWidget {
  const WebBridgeScreen(
      {super.key, required this.url, this.title = 'Sign in', this.onFinished});

  /// Full https://app.parktag.me URL; `pt_app=android` is appended.
  final String url;
  final String title;

  /// Runs after the session is stored. Defaults to going to `/home`.
  final VoidCallback? onFinished;

  @override
  State<WebBridgeScreen> createState() => _WebBridgeScreenState();
}

class _WebBridgeScreenState extends State<WebBridgeScreen> {
  final _cookies = CookieManager.instance();
  bool _ready = false;
  bool _checking = false;
  bool _done = false;
  bool _left = false;

  @override
  void initState() {
    super.initState();
    _cookies.deleteAllCookies().whenComplete(() {
      if (mounted) setState(() => _ready = true);
    });
  }

  Future<bool> _check() async {
    if (_checking || _done) return _done;
    _checking = true;
    final app = AppScope.read(context);
    try {
      final cookie = await _cookies.getCookie(
          url: WebUri('https://$bridgeHost'), name: _cookieName);
      final value = cookie?.value;
      if (!await tryCompleteBridge(app.api, value is String ? value : null)) {
        return false;
      }
      _done = true;
      // The cookie is stored; nothing below may block leaving this screen.
      try {
        await _cookies.deleteAllCookies();
        await app.loadSession();
        await app.refresh();
      } catch (_) {
        // Home shows its own error and retry.
      }
      try {
        await Push.register();
      } catch (_) {
        // Push is best effort; the next launch registers again.
      }
      _finish();
      return true;
    } finally {
      _checking = false;
    }
  }

  // Once only: _close can run while _check is still finishing.
  void _finish() {
    if (_left || !mounted) return;
    _left = true;
    final finished = widget.onFinished;
    finished != null ? finished() : context.go('/home');
  }

  Future<void> _close() async {
    if (_done) return _finish();
    if (await _check()) return;
    await _cookies.deleteAllCookies();
    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _close();
      },
      child: SecureScreen(
        child: Scaffold(
          appBar: AppBar(
            title: Text(widget.title),
            leading: IconButton(
              icon: const Icon(Icons.close),
              tooltip: 'Close',
              onPressed: _close,
            ),
          ),
          body: !_ready
              ? const Center(child: CircularProgressIndicator())
              : InAppWebView(
                  initialUrlRequest:
                      URLRequest(url: WebUri.uri(withPtApp(widget.url))),
                  initialSettings: InAppWebViewSettings(
                    javaScriptEnabled: true,
                    thirdPartyCookiesEnabled: false,
                    useShouldOverrideUrlLoading: true,
                    supportMultipleWindows: false,
                    allowFileAccess: false,
                    allowContentAccess: false,
                  ),
                  shouldOverrideUrlLoading: (controller, action) async {
                    final url = action.request.url;
                    if (url == null) return NavigationActionPolicy.CANCEL;
                    switch (bridgeNavigation(url, mainFrame: action.isForMainFrame)) {
                      case BridgeNav.allow:
                        return NavigationActionPolicy.ALLOW;
                      case BridgeNav.external:
                        await launchUrl(url, mode: LaunchMode.externalApplication);
                        return NavigationActionPolicy.CANCEL;
                      case BridgeNav.cancel:
                        return NavigationActionPolicy.CANCEL;
                    }
                  },
                  onLoadStop: (controller, url) {
                    if (url?.host == bridgeHost) _check();
                  },
                ),
        ),
      ),
    );
  }
}
