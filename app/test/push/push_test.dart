import 'dart:async';
import 'dart:convert';

import 'package:app/core/api.dart';
import 'package:app/core/session.dart';
import 'package:app/push/push.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

class _Harness {
  _Harness(this.permission, {this.afterRequest = AuthorizationStatus.authorized}) {
    FlutterSecureStorage.setMockInitialValues({'wavetag_session': 'c'});
    api = ApiClient(
      store: SessionStore(),
      base: Uri.parse('https://app.parktag.me'),
      client: MockClient((req) async {
        final body = req.body.isEmpty ? '' : ' ${req.body}';
        events.add('${req.method} ${req.url.path}$body');
        return http.Response(jsonEncode({'ok': true}), 200);
      }),
    );
    client = PushClient(
      api: api,
      status: () async => permission,
      requestPermission: () async {
        events.add('request');
        return permission = afterRequest;
      },
      getToken: () async {
        if (tokenGate != null) await tokenGate!.future;
        if (tokenFails) throw StateError('offline');
        return token;
      },
      deleteToken: () async => events.add('deleteToken'),
      prePrompt: () async => events.add('sheet'),
    );
  }

  AuthorizationStatus permission;
  final AuthorizationStatus afterRequest;
  String? token = 'tok-1';
  bool tokenFails = false;
  Completer<void>? tokenGate;
  final events = <String>[];
  late final ApiClient api;
  late final PushClient client;
}

void main() {
  test('register posts the token once per token value', () async {
    final h = _Harness(AuthorizationStatus.authorized);
    await h.client.register();
    await h.client.register();
    await h.client.onTokenRefresh('tok-1');
    await h.client.onTokenRefresh('tok-2');
    expect(h.events, [
      'POST /api/owner/push-tokens {"token":"tok-1","platform":"android"}',
      'POST /api/owner/push-tokens {"token":"tok-2","platform":"android"}',
    ]);
  });

  test('concurrent register calls share one run', () async {
    final h = _Harness(AuthorizationStatus.notDetermined);
    await Future.wait([h.client.register(), h.client.register()]);
    expect(h.events.where((e) => e == 'sheet'), hasLength(1));
    expect(h.events.where((e) => e.startsWith('POST')), hasLength(1));
  });

  test('a token refresh before any register is not posted', () async {
    final h = _Harness(AuthorizationStatus.authorized);
    await h.client.onTokenRefresh('tok-9');
    expect(h.events, isEmpty);
  });

  test('already granted: no sheet, no prompt, token posted', () async {
    final h = _Harness(AuthorizationStatus.authorized);
    await h.client.register();
    expect(h.events, isNot(contains('sheet')));
    expect(h.events, isNot(contains('request')));
    expect(h.events.single, startsWith('POST /api/owner/push-tokens'));
  });

  test('already denied: no sheet, no prompt, nothing posted', () async {
    final h = _Harness(AuthorizationStatus.denied);
    await h.client.register();
    await h.client.register();
    expect(h.events, isEmpty);
  });

  test('not determined: sheet, then system prompt, then post', () async {
    final h = _Harness(AuthorizationStatus.notDetermined);
    await h.client.register();
    expect(h.events, [
      'sheet',
      'request',
      'POST /api/owner/push-tokens {"token":"tok-1","platform":"android"}',
    ]);
  });

  test('not determined then denied in the prompt: nothing posted', () async {
    final h = _Harness(AuthorizationStatus.notDetermined,
        afterRequest: AuthorizationStatus.denied);
    await h.client.register();
    await h.client.register();
    expect(h.events, ['sheet', 'request']);
  });

  test('sign out: DELETE, deleteToken, then logout', () async {
    final h = _Harness(AuthorizationStatus.authorized);
    await h.client.register();
    h.events.clear();
    await signOut(h.api,
        unregisterPush: h.client.unregister, wipeVaultCache: () async {});
    expect(h.events, [
      'DELETE /api/owner/push-tokens {"token":"tok-1"}',
      'deleteToken',
      'POST /api/auth/logout {}',
    ]);

    // Next sign-in posts the (new) token again.
    h.events.clear();
    h.token = 'tok-3';
    await h.client.register();
    expect(h.events.single, contains('"tok-3"'));
  });

  test('unregister still deletes the local token when getToken throws', () async {
    final h = _Harness(AuthorizationStatus.authorized)..tokenFails = true;
    await expectLater(h.client.unregister(), throwsStateError);
    expect(h.events, ['deleteToken']);
  });

  test('a register in flight at sign out never posts after it', () async {
    final h = _Harness(AuthorizationStatus.authorized)
      ..tokenGate = Completer<void>();
    final reg = h.client.register();
    await Future<void>.delayed(Duration.zero);
    final unreg = h.client.unregister();
    h.tokenGate!.complete();
    await Future.wait([reg, unreg]);
    expect(h.events, [
      'DELETE /api/owner/push-tokens {"token":"tok-1"}',
      'deleteToken',
    ]);
    // Next sign-in registers normally.
    h.events.clear();
    await h.client.register();
    expect(h.events.single, startsWith('POST /api/owner/push-tokens'));
  });

  test('a message with ids maps to the activity row', () {
    expect(
      routeForPush({'type': 'contact', 'tagId': 'tag1', 'requestId': 'req9'}),
      '/activity?tag=tag1&request=req9',
    );
    expect(routeForPush({'type': 'locked', 'tagId': 'tag1'}), '/activity?tag=tag1');
    expect(routeForPush({}), '/activity');
    // Junk ids never reach the route.
    expect(routeForPush({'tagId': '../x', 'requestId': 'a&b=c'}), '/activity');
  });

  test('foreground messages are deduped by requestId', () {
    final h = _Harness(AuthorizationStatus.authorized);
    const a = RemoteMessage(data: {'requestId': 'r1'});
    const b = RemoteMessage(data: {'requestId': 'r2'});
    expect(h.client.firstSighting(a), isTrue);
    expect(h.client.firstSighting(a), isFalse);
    expect(h.client.firstSighting(b), isTrue);
  });
}
