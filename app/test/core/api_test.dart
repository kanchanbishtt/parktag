import 'dart:convert';
import 'dart:io';

import 'package:app/core/api.dart';
import 'package:app/core/session.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:http_parser/http_parser.dart';

final base = Uri.parse('https://app.parktag.me');

http.Response json(int status, Object body, {Map<String, String> headers = const {}}) =>
    http.Response(jsonEncode(body), status,
        headers: {'content-type': 'application/json', ...headers});

void main() {
  late SessionStore store;
  late List<http.Request> seen;

  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    store = SessionStore();
    seen = [];
  });

  ApiClient client(Future<http.Response> Function(http.Request) handler) =>
      ApiClient(
        store: store,
        base: base,
        client: MockClient((req) {
          seen.add(req);
          return handler(req);
        }),
      );

  test('captures the cookie and replays it only to the API origin', () async {
    final api = client((req) async => req.url.path == '/api/auth/login'
        ? json(200, {'ok': true},
            headers: {'set-cookie': 'wavetag_session=abc123; Path=/; HttpOnly; Secure'})
        : json(200, {}));
    await api.post('/api/auth/login', {'identifier': 'x', 'pin': '1'});
    expect(await store.readCookie(), 'abc123');

    await api.get('/api/owner/dashboard');
    expect(seen.last.headers['cookie'], 'wavetag_session=abc123');

    for (final other in [
      'https://evil.com/x',
      'http://app.parktag.me/x',
      'https://app.parktag.me:8443/x',
      'https://api.app.parktag.me/x',
    ]) {
      await api.get(other);
      expect(seen.last.url.toString(), other);
      expect(seen.last.headers.containsKey('cookie'), isFalse, reason: other);
    }
  });

  test('a cookie from another origin is never stored', () async {
    final api = client((req) async =>
        json(200, {}, headers: {'set-cookie': 'wavetag_session=stolen; Path=/'}));
    await api.get('https://evil.com/x');
    expect(await store.readCookie(), isNull);
  });

  test('a cleared cookie wipes the stored one', () async {
    await store.writeCookie('old');
    final api = client((req) async => json(200, {}, headers: {
          'set-cookie':
              'wavetag_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0'
        }));
    await api.post('/api/auth/logout');
    expect(await store.readCookie(), isNull);
  });

  test('never sends Origin or Referer', () async {
    await store.writeCookie('c');
    final api = client((req) async => json(200, {}));
    await api.get('/api/session');
    await api.post('/api/owner/vault/lock');
    await api.patch('/api/owner/profile', {'displayName': 'A'});
    await api.delete('/api/owner/backup-mobile');
    for (final r in seen) {
      final keys = r.headers.keys.map((k) => k.toLowerCase());
      expect(keys, isNot(contains('origin')));
      expect(keys, isNot(contains('referer')));
    }
  });

  test('success is decided by status, not by ok', () async {
    final api = client((req) async => req.url.path == '/api/shop/razorpay-key'
        ? json(200, {'keyId': 'rzp_test'})
        : json(404, {'error': 'no_account'}));
    expect((await api.get('/api/shop/razorpay-key'))['keyId'], 'rzp_test');

    await expectLater(
      api.post('/api/auth/google/credential', {'credential': 't'}),
      throwsA(isA<ApiError>()
          .having((e) => e.status, 'status', 404)
          .having((e) => e.message, 'message', 'no_account')),
    );
  });

  test('a vault 401 with a live session keeps the cookie', () async {
    await store.writeCookie('live');
    var expired = false;
    final api = client((req) async => req.url.path == '/api/session'
        ? json(200, {'ok': true, 'session': {'role': 'owner'}})
        : json(401, {'error': 'Incorrect PIN.'}))
      ..onSessionExpired = () => expired = true;

    await expectLater(api.post('/api/owner/vault/unlock', {'pin': '0000'}),
        throwsA(isA<ApiError>().having((e) => e.message, 'message', 'Incorrect PIN.')));
    expect(await store.readCookie(), 'live');
    expect(expired, isFalse);
    expect(seen.map((r) => r.url.path), ['/api/owner/vault/unlock', '/api/session']);
  });

  test('a 401 with session:null clears the cookie', () async {
    await store.writeCookie('dead');
    var expired = false;
    final api = client((req) async => req.url.path == '/api/session'
        ? json(200, {'ok': true, 'session': null})
        : json(401, {'error': 'Unauthorized'}))
      ..onSessionExpired = () => expired = true;

    await expectLater(api.get('/api/owner/vault/status'), throwsA(isA<ApiError>()));
    expect(await store.readCookie(), isNull);
    expect(expired, isTrue);
  });

  test('session:null on the stored cookie clears it (cold start)', () async {
    await store.writeCookie('dead');
    var expired = false;
    final api = client((req) async => json(200, {'ok': true, 'session': null}))
      ..onSessionExpired = () => expired = true;

    expect(await api.fetchSession(), isNull);
    expect(await store.readCookie(), isNull);
    expect(await api.hasCookie(), isFalse);
    expect(expired, isTrue);
  });

  test('session:null for a cookie under test leaves storage alone', () async {
    await store.writeCookie('keep');
    final api = client((req) async => json(200, {'ok': true, 'session': null}));
    expect(await api.fetchSession(cookie: 'probe'), isNull);
    expect(await store.readCookie(), 'keep');
  });

  test('a TLS or body-read failure becomes a status 0 ApiError', () async {
    final api = client((req) async => throw const HandshakeException('bad cert'));
    await expectLater(
        api.get('/api/session'),
        throwsA(isA<ApiError>().having((e) => e.isNetwork, 'isNetwork', isTrue)));
  });

  test('a 401 outside /api/owner does not re-check the session', () async {
    final api = client((req) async => json(401, {'error': 'Wrong number or PIN.'}));
    await expectLater(api.post('/api/auth/login', {}), throwsA(isA<ApiError>()));
    expect(seen, hasLength(1));
  });

  test('429 exposes retry-after (header, then body)', () async {
    final api = client((req) async => req.url.path == '/a'
        ? json(429, {'error': 'Too many tries.'}, headers: {'retry-after': '42'})
        : json(429, {'error': 'Slow down.', 'retryAfterSeconds': 30}));
    await expectLater(
        api.post('/a'),
        throwsA(isA<ApiError>()
            .having((e) => e.retryAfter, 'retryAfter', const Duration(seconds: 42))
            .having((e) => e.message, 'message', 'Too many tries.')));
    await expectLater(
        api.post('/b'),
        throwsA(isA<ApiError>()
            .having((e) => e.retryAfter, 'retryAfter', const Duration(seconds: 30))));
  });

  test('a POST with no body sends {} as JSON; GET sends no content-type', () async {
    final api = client((req) async => json(200, {}));
    await api.post('/api/auth/logout');
    expect(seen.last.body, '{}');
    expect(seen.last.headers['content-type'], startsWith('application/json'));
    await api.delete('/api/owner/backup-mobile');
    expect(seen.last.body, '{}');
    await api.get('/api/session');
    expect(seen.last.headers.containsKey('content-type'), isFalse);
  });

  test('extra headers reach the request (App Check on send-otp)', () async {
    final api = client((req) async => json(200, {'ok': true}));
    await api.post('/api/auth/send-otp', {'identifier': '+91'},
        {'X-Firebase-AppCheck': 'tok'});
    expect(seen.last.headers['X-Firebase-AppCheck'], 'tok');
  });

  test('network failure becomes a status 0 ApiError', () async {
    final api = client((req) async => throw http.ClientException('down'));
    await expectLater(
        api.get('/api/session'),
        throwsA(isA<ApiError>()
            .having((e) => e.isNetwork, 'isNetwork', isTrue)
            .having((e) => e.message, 'message', offlineError)));
  });

  test('multipart carries the cookie and the file part MediaType', () async {
    await store.writeCookie('c');
    late String body;
    late Map<String, String> headers;
    final api = ApiClient(
      store: store,
      base: base,
      client: MockClient.streaming((req, stream) async {
        headers = req.headers;
        body = latin1.decode(await stream.toBytes());
        return http.StreamedResponse(
            Stream.value(utf8.encode('{"id":"d1"}')), 200);
      }),
    );
    final res = await api.multipart(
      '/api/owner/vault/documents',
      fields: {'tagId': 't1', 'docType': 'rc', 'label': 'RC'},
      fileField: 'file',
      bytes: utf8.encode('%PDF-1.4'),
      filename: 'rc.pdf',
      contentType: MediaType('application', 'pdf'),
    );
    expect(res['id'], 'd1');
    expect(headers['cookie'], 'wavetag_session=c');
    expect(body, contains('content-type: application/pdf'));
    expect(body.indexOf('name="tagId"'), lessThan(body.indexOf('name="file"')));
  });

  test('parseSessionCookie', () {
    expect(parseSessionCookie('other=1; Path=/'), isNull);
    expect(parseSessionCookie('a=1; Expires=Thu, 01 Jan 2099 00:00:00 GMT, wavetag_session=v; Path=/'), 'v');
    expect(parseSessionCookie('wavetag_session=v; Max-Age=0'), '');
    expect(parseSessionCookie('wavetag_session=v; Max-Age=15552000; Path=/'), 'v');
    expect(parseSessionCookie('wavetag_session=; Path=/'), '');
  });
}
