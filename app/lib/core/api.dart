import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';

import 'session.dart';

/// API base URL. `--dart-define=API=http://10.0.2.2:4000` for a local backend.
const apiBase = String.fromEnvironment(
  'API',
  defaultValue: 'https://app.parktag.me',
);
const appVersion = String.fromEnvironment('APP_VERSION', defaultValue: '1.0.0');
const _cookieName = 'wavetag_session';
const _timeout = Duration(seconds: 15);
const fallbackError = 'Something went wrong. Try again.';
const offlineError = 'No connection. Try again.';

/// Any non-2xx response, or a network failure (status 0).
class ApiError implements Exception {
  ApiError(
    this.status, {
    this.code,
    String? message,
    this.retryAfter,
    this.extra = const {},
  }) : message = message ?? fallbackError;

  final int status;
  final String? code;
  final String message;
  final Duration? retryAfter;
  final Map<String, dynamic> extra;

  bool get isNetwork => status == 0;

  @override
  String toString() => 'ApiError($status, $code)';
}

class ApiClient {
  ApiClient({
    required this.store,
    http.Client? client,
    Uri? base,
    this.onSessionExpired,
  })  : _client = client ?? http.Client(),
        base = base ?? Uri.parse(apiBase);

  final SessionStore store;
  final http.Client _client;
  final Uri base;

  /// Called when a 401 turns out to be a dead session (`session:null`).
  VoidCallback? onSessionExpired;

  String? _cookie;
  bool _loaded = false;

  Future<Map<String, dynamic>> get(String path, {Map<String, String>? query}) =>
      _send('GET', path, query: query);
  Future<Map<String, dynamic>> post(String path,
          [Object? body, Map<String, String>? headers]) =>
      _send('POST', path, body: body, headers: headers);
  Future<Map<String, dynamic>> patch(String path, [Object? body]) =>
      _send('PATCH', path, body: body);
  Future<Map<String, dynamic>> delete(String path, [Object? body]) =>
      _send('DELETE', path, body: body);

  /// Raw bytes, for vault file views. Same cookie and error rules.
  Future<Uint8List> getBytes(String path) async {
    final res = await _run('GET', path, () async {
      final req = http.Request('GET', _resolve(path));
      await _headers(req.url, req.headers);
      return _sendRaw(req);
    });
    return res.bodyBytes;
  }

  /// Multipart upload. Fields go first, then one file part carrying [contentType].
  Future<Map<String, dynamic>> multipart(
    String path, {
    required Map<String, String> fields,
    required String fileField,
    required Uint8List bytes,
    required String filename,
    required MediaType contentType,
  }) async {
    final res = await _run('POST', path, () async {
      final req = http.MultipartRequest('POST', _resolve(path))
        ..fields.addAll(fields)
        ..files.add(http.MultipartFile.fromBytes(fileField, bytes,
            filename: filename, contentType: contentType));
      await _headers(req.url, req.headers);
      return _sendRaw(req);
    });
    return _json(res);
  }

  /// `GET /api/session`. Returns the session map or null. [cookie] overrides
  /// the stored one (the WebView bridge checks a cookie before adopting it).
  Future<Map<String, dynamic>?> fetchSession({String? cookie}) async {
    final url = _resolve('/api/session');
    final req = http.Request('GET', url);
    await _headers(url, req.headers, cookieOverride: cookie);
    // A cookie under test is never stored from this response.
    final res = await _sendRaw(req, capture: cookie == null);
    if (res.statusCode < 200 || res.statusCode >= 300) throw _error(res);
    final session = _json(res)['session'];
    if (session is Map<String, dynamic>) return session;
    // The stored cookie is dead: wipe it so nothing replays it.
    if (cookie == null && _cookie != null) await _expire();
    return null;
  }

  /// Stores a cookie captured elsewhere (the WebView bridge).
  Future<void> adoptCookie(String value) async {
    _cookie = value;
    _loaded = true;
    if (!kIsWeb) await store.writeCookie(value);
  }

  /// Drops the in-memory copy after storage was wiped.
  void forgetCookie() {
    _cookie = null;
    _loaded = true;
  }

  Future<bool> hasCookie() async {
    await _loadCookie();
    return _cookie != null;
  }

  Future<Map<String, dynamic>> _send(String method, String path,
      {Map<String, String>? query, Object? body, Map<String, String>? headers}) async {
    final res = await _run(method, path, () {
      final req = http.Request(method, _resolve(path, query));
      if (method != 'GET') {
        req.headers['content-type'] = 'application/json';
        req.body = jsonEncode(body ?? const <String, dynamic>{});
      }
      if (headers != null) req.headers.addAll(headers);
      return _headers(req.url, req.headers).then((_) => _sendRaw(req));
    });
    return _json(res);
  }

  Future<http.Response> _run(
      String method, String path, Future<http.Response> Function() send) async {
    final res = await send();
    if (kDebugMode) debugPrint('$method ${Uri.parse(path).path} ${res.statusCode}');
    if (res.statusCode >= 200 && res.statusCode < 300) return res;
    if (res.statusCode == 401 && path.startsWith('/api/owner/')) {
      await _recheckSession();
    }
    throw _error(res);
  }

  Future<http.Response> _sendRaw(http.BaseRequest req, {bool capture = true}) async {
    try {
      final res = await _client
          .send(req)
          .then(http.Response.fromStream)
          .timeout(_timeout);
      if (capture) await _captureCookie(req.url, res.headers['set-cookie']);
      return res;
    } on ApiError {
      rethrow;
    } on Exception {
      // Timeouts, ClientException, TLS (HandshakeException) and body-read errors.
      throw ApiError(0, code: 'NETWORK', message: offlineError);
    }
  }

  // A 401 on an owner route is often a wrong secret on a live session. Only a
  // confirmed dead session clears storage.
  // fetchSession clears it on `session:null`.
  Future<void> _recheckSession() async {
    try {
      await fetchSession();
    } on ApiError {
      // Offline or server error: keep the cookie.
    }
  }

  Future<void> _expire() async {
    await store.clearCookie();
    _cookie = null;
    onSessionExpired?.call();
  }

  Uri _resolve(String path, [Map<String, String>? query]) {
    final url = base.resolve(path);
    return query == null ? url : url.replace(queryParameters: query);
  }

  bool _sameOrigin(Uri url) =>
      url.scheme == base.scheme && url.host == base.host && url.port == base.port;

  Future<void> _loadCookie() async {
    if (_loaded || kIsWeb) return;
    _cookie = await store.readCookie();
    _loaded = true;
  }

  // Never Origin or Referer: the server's CSRF check passes requests with neither.
  Future<void> _headers(Uri url, Map<String, String> headers,
      {String? cookieOverride}) async {
    if (kIsWeb) return;
    headers['user-agent'] = 'ParkTagApp/$appVersion';
    if (!_sameOrigin(url)) return;
    await _loadCookie();
    final cookie = cookieOverride ?? _cookie;
    if (cookie != null) headers['cookie'] = '$_cookieName=$cookie';
  }

  Future<void> _captureCookie(Uri url, String? header) async {
    if (kIsWeb || header == null || !_sameOrigin(url)) return;
    final parsed = parseSessionCookie(header);
    if (parsed == null) return;
    if (parsed.isEmpty) {
      _cookie = null;
      await store.clearCookie();
    } else {
      _cookie = parsed;
      await store.writeCookie(parsed);
    }
    _loaded = true;
  }

  ApiError _error(http.Response res) {
    final body = _json(res);
    final header = int.tryParse(res.headers['retry-after'] ?? '');
    final bodyRetry = body['retryAfterSeconds'];
    final seconds = header ?? (bodyRetry is num ? bodyRetry.toInt() : null);
    final message = body['error'];
    final code = body['code'];
    return ApiError(
      res.statusCode,
      code: code is String ? code : null,
      message: message is String && message.isNotEmpty ? message : null,
      retryAfter: seconds == null ? null : Duration(seconds: seconds),
      extra: body,
    );
  }

  Map<String, dynamic> _json(http.Response res) {
    if (res.bodyBytes.isEmpty) return {};
    try {
      final decoded = jsonDecode(utf8.decode(res.bodyBytes));
      return decoded is Map<String, dynamic> ? decoded : {'data': decoded};
    } on FormatException {
      return {};
    }
  }
}

/// Reads `wavetag_session` out of a (possibly comma-joined) Set-Cookie header.
/// Returns null when it is absent, '' when the server cleared it, else the value.
String? parseSessionCookie(String header) {
  // Split between cookies, not inside an Expires date ("Thu, 01 Jan ...").
  for (final cookie in header.split(RegExp(r',(?=\s*[A-Za-z0-9_\-]+=)'))) {
    final parts = cookie.split(';').map((p) => p.trim()).toList();
    if (!parts.first.startsWith('$_cookieName=')) continue;
    final value = parts.first.substring(_cookieName.length + 1);
    for (final attr in parts.skip(1)) {
      final lower = attr.toLowerCase();
      if (lower.startsWith('max-age=') &&
          (int.tryParse(lower.substring(8)) ?? 1) <= 0) {
        return '';
      }
      if (lower.startsWith('expires=')) {
        try {
          if (parseHttpDate(attr.substring(8)).isBefore(DateTime.now())) return '';
        } on FormatException {
          // Unparseable date: judge by value alone.
        }
      }
    }
    return value;
  }
  return null;
}
