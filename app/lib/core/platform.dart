import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:url_launcher/url_launcher.dart';

/// The `parktag/platform` channel implemented in MainActivity.kt.
class PtPlatform {
  static const _channel = MethodChannel('parktag/platform');

  static bool get _android =>
      !kIsWeb && defaultTargetPlatform == TargetPlatform.android;

  /// FLAG_SECURE on or off for the whole window. Never throws: callers fire
  /// and forget from initState/dispose, where an error would go uncaught.
  static Future<void> setSecure(bool secure) async {
    if (!_android) return;
    try {
      await _channel.invokeMethod('setSecure', {'secure': secure});
    } catch (e) {
      debugPrint('setSecure failed: $e');
    }
  }

  /// Opens a file under cache/vault or cache/share with an external viewer.
  static Future<void> openFile(String path, String mime) =>
      _channel.invokeMethod('openFile', {'path': path, 'mime': mime});

  /// ACTION_SEND of a PNG through the FileProvider cache/share path.
  static Future<void> shareImage(Uint8List bytes, String name) =>
      _channel.invokeMethod('shareImage', {'bytes': bytes, 'name': name});

  /// ACTION_SEND of plain text through the system share sheet.
  static Future<void> shareText(String text) =>
      _channel.invokeMethod('shareText', {'text': text});

  /// The app cache directory (no path_provider).
  static Future<String> cacheDir() async =>
      (await _channel.invokeMethod<String>('cacheDir'))!;

  /// Deletes cache/vault or cache/share.
  static Future<void> wipeCache(String dir) async {
    if (_android) await _channel.invokeMethod('wipeCache', {'dir': dir});
  }

  /// Every Custom Tab goes through here so pwa.js hides plans.
  static Future<bool> openCustomTab(String url) =>
      launchUrl(withPtApp(url), mode: LaunchMode.inAppBrowserView);
}

/// Appends `pt_app=android`, keeping any existing query.
Uri withPtApp(String url) {
  final uri = Uri.parse(url);
  return uri.replace(
      queryParameters: {...uri.queryParameters, 'pt_app': 'android'});
}

/// FLAG_SECURE while this widget is mounted. Wrap vault, OTP, PIN and login screens.
class SecureScreen extends StatefulWidget {
  const SecureScreen({super.key, required this.child});

  final Widget child;

  @override
  State<SecureScreen> createState() => _SecureScreenState();
}

class _SecureScreenState extends State<SecureScreen> {
  // Counted, so a secure screen pushed over another keeps the flag on when it closes.
  static int _depth = 0;

  @override
  void initState() {
    super.initState();
    if (_depth++ == 0) PtPlatform.setSecure(true);
  }

  @override
  void dispose() {
    if (--_depth == 0) PtPlatform.setSecure(false);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
