import 'dart:convert';

import 'package:app/core/api.dart';
import 'package:app/core/session.dart';
import 'package:app/core/web_bridge.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  group('bridgeShouldFinish', () {
    test('no cookie stays (for example on /owner-verify)', () {
      expect(bridgeShouldFinish(null, null), isFalse);
      expect(bridgeShouldFinish('', 'owner'), isFalse);
    });
    test('a cookie with a null session stays', () {
      expect(bridgeShouldFinish('c', null), isFalse);
    });
    test('a cookie with a non-owner role stays', () {
      expect(bridgeShouldFinish('c', 'admin'), isFalse);
    });
    test('a cookie with role owner finishes', () {
      expect(bridgeShouldFinish('c', 'owner'), isTrue);
    });
  });

  group('tryCompleteBridge', () {
    late SessionStore store;
    setUp(() {
      FlutterSecureStorage.setMockInitialValues({});
      store = SessionStore();
    });

    ApiClient api(Object? session, List<http.Request> seen) => ApiClient(
          store: store,
          base: Uri.parse('https://app.parktag.me'),
          client: MockClient((req) async {
            seen.add(req);
            return http.Response(jsonEncode({'ok': true, 'session': session}), 200);
          }),
        );

    test('no cookie makes no request and writes nothing', () async {
      final seen = <http.Request>[];
      expect(await tryCompleteBridge(api({'role': 'owner'}, seen), null), isFalse);
      expect(seen, isEmpty);
      expect(await store.readCookie(), isNull);
    });

    test('cookie with session null stays and writes nothing', () async {
      final seen = <http.Request>[];
      expect(await tryCompleteBridge(api(null, seen), 'web'), isFalse);
      expect(seen.single.headers['cookie'], 'wavetag_session=web');
      expect(await store.readCookie(), isNull);
    });

    test('cookie with role owner finishes and stores it', () async {
      final seen = <http.Request>[];
      expect(await tryCompleteBridge(api({'role': 'owner'}, seen), 'web'), isTrue);
      expect(await store.readCookie(), 'web');
    });
  });

  group('bridgeNavigation', () {
    BridgeNav nav(String url, {bool main = true}) =>
        bridgeNavigation(Uri.parse(url), mainFrame: main);

    test('app.parktag.me is allowed', () {
      expect(nav('https://app.parktag.me/owner-welcome'), BridgeNav.allow);
    });
    test('reCAPTCHA and Firebase only as frames', () {
      expect(nav('https://www.google.com/recaptcha/api2/anchor', main: false),
          BridgeNav.allow);
      expect(nav('https://www.gstatic.com/x', main: false), BridgeNav.allow);
      expect(nav('https://www.google.com/recaptcha/api2/anchor'), BridgeNav.cancel);
      expect(nav('https://www.google.com/search', main: false), BridgeNav.cancel);
    });
    test('everything else is cancelled', () {
      expect(nav('https://accounts.google.com/o/oauth2'), BridgeNav.cancel);
      expect(nav('https://accounts.google.com/o/oauth2', main: false),
          BridgeNav.cancel);
      expect(nav('http://app.parktag.me/'), BridgeNav.cancel);
      expect(nav('https://app.parktag.me.evil.com/'), BridgeNav.cancel);
      expect(nav('intent://x#Intent;end'), BridgeNav.cancel);
    });
    test('tel and wa.me leave the app', () {
      expect(nav('tel:+911234567890'), BridgeNav.external);
      expect(nav('https://wa.me/911234567890'), BridgeNav.external);
    });
  });
}
