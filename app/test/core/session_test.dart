import 'dart:convert';

import 'package:app/core/api.dart';
import 'package:app/core/session.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test('signOut: push unregister, then logout, then wipe', () async {
    FlutterSecureStorage.setMockInitialValues({});
    final store = SessionStore();
    await store.writeCookie('c');
    await store.setOnboarded();
    final events = <String>[];

    final api = ApiClient(
      store: store,
      base: Uri.parse('https://app.parktag.me'),
      client: MockClient((req) async {
        events.add('${req.method} ${req.url.path} cookie=${req.headers['cookie']}');
        return http.Response(jsonEncode({'ok': true}), 200);
      }),
    );

    await signOut(api,
        unregisterPush: () async => events.add('push'),
        wipeVaultCache: () async => events.add('vault'));

    expect(events, [
      'push',
      'POST /api/auth/logout cookie=wavetag_session=c',
      'vault',
    ]);
    expect(await store.readCookie(), isNull);
    expect(await store.isOnboarded(), isTrue);
    expect(await api.hasCookie(), isFalse);
  });

  test('signOut still wipes when logout fails', () async {
    FlutterSecureStorage.setMockInitialValues({});
    final store = SessionStore();
    await store.writeCookie('c');
    final api = ApiClient(
      store: store,
      base: Uri.parse('https://app.parktag.me'),
      client: MockClient((req) async => http.Response('', 500)),
    );
    await signOut(api, unregisterPush: () async {}, wipeVaultCache: () async {});
    expect(await store.readCookie(), isNull);
  });
}
