import 'dart:convert';
import 'dart:io' show Platform;

import 'package:app/core/api.dart';
import 'package:app/core/app_state.dart';
import 'package:app/core/session.dart';
import 'package:app/features/vault/models.dart';
import 'package:app/features/vault/routes.dart';
import 'package:app/features/vault/vault_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:image_picker/image_picker.dart';

http.Response json(int status, Object body) => http.Response(
  jsonEncode(body),
  status,
  headers: {'content-type': 'application/json'},
);

const _unlocked = {'ok': true, 'hasPin': true, 'unlocked': true};
const _empty = {
  'ok': true,
  'documents': [],
  'usedBytes': 0,
  'documentCount': 0,
};

void main() {
  late SessionStore store;
  late List<http.Request> seen;
  late List<MethodCall> platform;

  setUp(() async {
    FlutterSecureStorage.setMockInitialValues({});
    store = SessionStore();
    await store.writeCookie('live');
    seen = [];
    platform = [];
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(const MethodChannel('parktag/platform'), (
          call,
        ) async {
          platform.add(call);
          return null;
        });
  });

  AppState appWith(Future<http.Response> Function(http.Request) handler) =>
      AppState(
        ApiClient(
          store: store,
          base: Uri.parse('https://app.parktag.me'),
          client: MockClient((req) {
            seen.add(req);
            return handler(req);
          }),
        ),
      );

  void phone(WidgetTester tester) {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
  }

  Future<void> pumpVault(
    WidgetTester tester,
    AppState app, {
    VaultPicker? picker,
  }) async {
    phone(tester);
    await tester.pumpWidget(
      AppScope(
        app: app,
        child: MaterialApp(
          home: VaultScreen(tagId: 't1', picker: picker ?? (_) async => null),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  Iterable<String> paths(String method) =>
      seen.where((r) => r.method == method).map((r) => r.url.path);

  testWidgets('a 423 from documents shows the unlock panel', (tester) async {
    final app = appWith(
      (req) async => switch (req.url.path) {
        '/api/owner/vault/status' => json(200, _unlocked),
        '/api/owner/vault/documents' => json(423, {
          'ok': false,
          'locked': true,
          'error': 'Enter your vault PIN to continue.',
        }),
        _ => json(200, {'ok': true}),
      },
    );
    await pumpVault(tester, app);
    expect(find.byKey(const ValueKey('vault-unlock')), findsOneWidget);
    expect(find.text('Enter your vault PIN'), findsOneWidget);
    expect(find.text('Unlock'), findsOneWidget);
  });

  testWidgets('an unlock 401 shows Incorrect PIN. and keeps the session', (
    tester,
  ) async {
    var expired = false;
    final app = appWith(
      (req) async => switch (req.url.path) {
        '/api/owner/vault/status' => json(200, {
          'ok': true,
          'hasPin': true,
          'unlocked': false,
        }),
        '/api/owner/vault/unlock' => json(401, {
          'ok': false,
          'error': 'Incorrect PIN.',
        }),
        '/api/session' => json(200, {
          'ok': true,
          'session': {'role': 'owner'},
        }),
        _ => json(200, {'ok': true}),
      },
    );
    app.api.onSessionExpired = () => expired = true;
    await pumpVault(tester, app);

    await tester.enterText(find.byType(TextField), '4821');
    await tester.tap(find.text('Unlock'));
    await tester.pumpAndSettle();

    expect(find.text('Incorrect PIN.'), findsOneWidget);
    expect(find.byKey(const ValueKey('vault-unlock')), findsOneWidget);
    expect(await store.readCookie(), 'live');
    expect(expired, isFalse);
  });

  testWidgets('an unlock 429 shows the wait', (tester) async {
    final app = appWith(
      (req) async => switch (req.url.path) {
        '/api/owner/vault/status' => json(200, {
          'ok': true,
          'hasPin': true,
          'unlocked': false,
        }),
        '/api/owner/vault/unlock' => json(429, {
          'ok': false,
          'error': 'Too many incorrect PIN attempts. Try again later.',
          'retryAfterSeconds': 600,
        }),
        _ => json(200, {'ok': true}),
      },
    );
    await pumpVault(tester, app);
    await tester.enterText(find.byType(TextField), '4821');
    await tester.tap(find.text('Unlock'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Wait 10 minutes.'), findsOneWidget);
  });

  testWidgets('a 6MB file is rejected before any upload request', (
    tester,
  ) async {
    final app = appWith(
      (req) async => switch (req.url.path) {
        '/api/owner/vault/status' => json(200, _unlocked),
        '/api/owner/vault/documents' => json(200, _empty),
        _ => json(200, {'ok': true}),
      },
    );
    await pumpVault(
      tester,
      app,
      picker: (_) async => XFile.fromData(
        Uint8List(6 * 1024 * 1024),
        path: ['', 'picked', 'rc.pdf'].join(Platform.pathSeparator),
        length: 6 * 1024 * 1024,
      ),
    );

    await tester.tap(find.text('Add document'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Choose a PDF'));
    await tester.pumpAndSettle();

    expect(find.text(tooBigMessage), findsOneWidget);
    expect(paths('POST'), isNot(contains('/api/owner/vault/documents')));
  });

  testWidgets(
    'upload is multipart with the cookie, fields first, typed file part',
    (tester) async {
      final app = appWith(
        (req) async => switch ((req.method, req.url.path)) {
          ('GET', '/api/owner/vault/status') => json(200, _unlocked),
          ('GET', '/api/owner/vault/documents') => json(200, _empty),
          ('POST', '/api/owner/vault/documents') => json(200, {'ok': true}),
          _ => json(200, {'ok': true}),
        },
      );
      await pumpVault(
        tester,
        app,
        picker: (_) async => XFile.fromData(
          Uint8List.fromList([0xFF, 0xD8, 0xFF, 1, 2]),
          path: ['', 'picked', 'photo.jpg'].join(Platform.pathSeparator),
          length: 5,
        ),
      );

      await tester.tap(find.text('Add document'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.widgetWithText(TextField, 'Label (optional)'),
        'My RC',
      );
      await tester.tap(find.text('Take a photo'));
      await tester.pumpAndSettle();

      final up = seen.singleWhere(
        (r) => r.method == 'POST' && r.url.path == '/api/owner/vault/documents',
      );
      expect(
        up.headers['content-type'],
        startsWith('multipart/form-data; boundary='),
      );
      expect(up.headers['cookie'], 'wavetag_session=live');

      final body = latin1.decode(up.bodyBytes);
      String field(String name) =>
          RegExp('name="$name"\\r\\n\\r\\n([^\\r]*)\\r\\n')
              .firstMatch(body)!
              .group(1)!;
      expect(field('tagId'), 't1');
      expect(field('docType'), 'rc');
      expect(field('label'), 'My RC');

      final fileAt = body.indexOf('name="file"; filename="photo.jpg"');
      expect(fileAt, greaterThan(body.indexOf('name="label"')));
      final filePart = body
          .split('--dart-http-boundary')
          .singleWhere((p) => p.contains('name="file"'));
      final partType = RegExp(
        r'content-type: ([^\r]+)',
        caseSensitive: false,
      ).firstMatch(filePart)!.group(1);
      expect([
        'image/jpeg',
        'image/png',
        'image/webp',
        'application/pdf',
      ], contains(partType));
      expect(partType, 'image/jpeg');
      expect(
        find.textContaining(RegExp(r'^Document saved, \d+ (B|KB)\.$')),
        findsOneWidget,
      );
    },
  );

  testWidgets('upload 409 shows local copy, not server upsell text', (
    tester,
  ) async {
    final app = appWith(
      (req) async => switch ((req.method, req.url.path)) {
        ('GET', '/api/owner/vault/status') => json(200, _unlocked),
        ('GET', '/api/owner/vault/documents') => json(200, _empty),
        ('POST', '/api/owner/vault/documents') => json(409, {
          'ok': false,
          'code': 'DOCUMENT_LIMIT_REACHED',
          'error': 'Upgrade to Premium for more documents.',
        }),
        _ => json(200, {'ok': true}),
      },
    );
    await pumpVault(
      tester,
      app,
      picker: (_) async => XFile.fromData(
        Uint8List(10),
        path: ['', 'picked', 'a.pdf'].join(Platform.pathSeparator),
        length: 10,
      ),
    );
    await tester.tap(find.text('Add document'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Choose a PDF'));
    await tester.pumpAndSettle();
    expect(find.textContaining('no document slots left'), findsOneWidget);
    expect(find.textContaining('Upgrade'), findsNothing);
  });

  testWidgets(
    'the vault route is FLAG_SECURE and locks and wipes the cache on leave',
    (tester) async {
      final app = appWith(
        (req) async => switch (req.url.path) {
          '/api/owner/vault/status' => json(200, _unlocked),
          '/api/owner/vault/documents' => json(200, _empty),
          _ => json(200, {'ok': true}),
        },
      );
      phone(tester);
      final router = GoRouter(
        navigatorKey: rootKey,
        initialLocation: '/tags/t1/vault',
        routes: [
          ...vaultRootRoutes,
          GoRoute(path: '/out', builder: (_, _) => const Text('out')),
        ],
      );
      await tester.pumpWidget(
        AppScope(
          app: app,
          child: MaterialApp.router(routerConfig: router),
        ),
      );
      await tester.pumpAndSettle();
      expect(platform.firstWhere((c) => c.method == 'setSecure').arguments, {
        'secure': true,
      });
      expect(find.text('No documents yet'), findsOneWidget);

      router.go('/out');
      await tester.pumpAndSettle();
      expect(
        platform.any(
          (c) => c.method == 'setSecure' && c.arguments['secure'] == false,
        ),
        isTrue,
      );
      expect(
        platform.any(
          (c) => c.method == 'wipeCache' && c.arguments['dir'] == 'vault',
        ),
        isTrue,
      );
      expect(paths('POST'), contains('/api/owner/vault/lock'));
    },
  );

  testWidgets('app pause locks, wipes the cache and shows unlock', (
    tester,
  ) async {
    final app = appWith(
      (req) async => switch (req.url.path) {
        '/api/owner/vault/status' => json(200, _unlocked),
        '/api/owner/vault/documents' => json(200, _empty),
        _ => json(200, {'ok': true}),
      },
    );
    await pumpVault(tester, app);
    expect(find.text('No documents yet'), findsOneWidget);

    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    await tester.pumpAndSettle();
    expect(paths('POST'), contains('/api/owner/vault/lock'));
    expect(
      platform.any(
        (c) => c.method == 'wipeCache' && c.arguments['dir'] == 'vault',
      ),
      isTrue,
    );
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('vault-unlock')), findsOneWidget);
  });

  testWidgets('a full vehicle hides Add document and shows the full card', (
    tester,
  ) async {
    final ends = DateTime.now().add(const Duration(days: 4, hours: 1));
    final app = appWith(
      (req) async => switch (req.url.path) {
        '/api/owner/vault/status' => json(200, {
          ..._unlocked,
          'limits': {
            'maxFileBytes': 5242880,
            'maxBytesPerOwner': 41943040,
            'tiers': {'etag': 1, 'premium': 3, 'subscribed': 10},
          },
        }),
        '/api/owner/vault/documents' => json(200, {
          'ok': true,
          'documents': [
            {
              'id': 'd1',
              'docType': 'rc',
              'label': 'RC front',
              'mimeType': 'image/jpeg',
              'size': 2048,
              'createdAt': '2026-10-03T10:00:00.000Z',
            },
          ],
          'usedBytes': 2048,
          'documentCount': 1,
          'entitlement': {
            'tier': 'premium',
            'maxDocs': 1,
            'premium': true,
            'subscribed': false,
            'trialEndsAt': ends.toUtc().toIso8601String(),
          },
        }),
        _ => json(200, {'ok': true}),
      },
    );
    await pumpVault(tester, app);
    expect(find.text('Add document'), findsNothing);
    expect(find.byKey(const ValueKey('vault-full')), findsOneWidget);
    expect(find.text('This vehicle is full'), findsOneWidget);
    expect(
      find.textContaining('1 of 1 document on this vehicle'),
      findsOneWidget,
    );
    expect(find.textContaining('of 40 MB'), findsOneWidget);
    expect(find.textContaining('free period has 5 days left'), findsOneWidget);
    expect(find.textContaining('Oct 2026'), findsOneWidget);
    expect(find.textContaining('Upgrade'), findsNothing);
  });

  testWidgets('room left keeps Add document and the trial note', (
    tester,
  ) async {
    final app = appWith(
      (req) async => switch (req.url.path) {
        '/api/owner/vault/status' => json(200, _unlocked),
        '/api/owner/vault/documents' => json(200, {
          ..._empty,
          'entitlement': {
            'tier': 'premium',
            'maxDocs': 10,
            'premium': true,
            'trialEndsAt': DateTime.now()
                .add(const Duration(days: 30))
                .toUtc()
                .toIso8601String(),
          },
        }),
        _ => json(200, {'ok': true}),
      },
    );
    await pumpVault(tester, app);
    expect(find.text('Add document'), findsOneWidget);
    expect(find.textContaining('0 of 10 documents'), findsOneWidget);
    expect(
      find.textContaining('Free with your premium tag for another'),
      findsOneWidget,
    );
  });
}
