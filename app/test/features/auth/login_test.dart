import 'dart:convert';

import 'package:app/core/api.dart';
import 'package:app/core/app_state.dart';
import 'package:app/core/session.dart';
import 'package:app/features/auth/auth_flow.dart';
import 'package:app/features/auth/login_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

typedef Handler = http.Response Function(http.Request req);

http.Response json(int status, Object body, [Map<String, String>? headers]) =>
    http.Response(jsonEncode(body), status,
        headers: {'content-type': 'application/json', ...?headers});

const _owner = {'session': {'role': 'owner'}};

class Harness {
  Harness(Handler handler) {
    api = ApiClient(
      store: SessionStore(),
      client: MockClient((req) async {
        requests.add(req);
        if (req.url.path == '/api/owner/dashboard') return json(200, {});
        return handler(req);
      }),
    );
    app = AppState(api);
  }

  late final ApiClient api;
  late final AppState app;
  final requests = <http.Request>[];
  final secureCalls = <bool>[];
  final opened = <String>[];

  Future<void> pump(WidgetTester tester,
      {String? appCheck = 'ac-token', String? googleToken = 'g-id'}) async {
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        const MethodChannel('parktag/platform'), (call) async {
      if (call.method == 'setSecure') {
        secureCalls.add((call.arguments as Map)['secure'] as bool);
      }
      return null;
    });
    final router = GoRouter(
      navigatorKey: rootKey,
      initialLocation: '/login',
      routes: [
        GoRoute(
          path: '/login',
          builder: (_, _) => LoginScreen(
            appCheckToken: () async => appCheck,
            googleIdToken: (_) async => googleToken,
            openUrl: (url) async {
              opened.add(url);
              return true;
            },
          ),
        ),
        GoRoute(path: '/add-vehicles', builder: (_, _) => const Text('VEHICLES')),
        GoRoute(path: '/login/web', builder: (_, _) => const Text('BRIDGE')),
        GoRoute(path: '/home', builder: (_, _) => const Text('HOME')),
      ],
    );
    addTearDown(router.dispose);
    await tester.pumpWidget(
        AppScope(app: app, child: MaterialApp.router(routerConfig: router)));
    await tester.pumpAndSettle();
  }
}

Future<void> tapText(WidgetTester tester, String text) async {
  await tester.tap(find.text(text));
  await tester.pumpAndSettle();
}

void main() {
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  group('PIN', () {
    testWidgets('success stores the cookie and routes to /home', (tester) async {
      final h = Harness((req) => switch (req.url.path) {
            '/api/auth/login' => json(200, {'ok': true, 'user': {}},
                {'set-cookie': 'wavetag_session=abc123; Path=/; HttpOnly'}),
            '/api/session' => json(200, _owner),
            _ => json(404, {}),
          });
      await h.pump(tester);
      await tapText(tester, 'PIN');
      await tester.enterText(find.byType(TextField).at(0), '98765 43210');
      await tester.enterText(find.byType(TextField).at(1), '482915');
      await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
      await tester.pumpAndSettle();

      expect(find.text('HOME'), findsOneWidget);
      expect(await SessionStore().readCookie(), 'abc123');
      expect(h.app.isOwner, isTrue);
      final login = h.requests.firstWhere((r) => r.url.path == '/api/auth/login');
      expect(jsonDecode(login.body),
          {'identifier': '+919876543210', 'pin': '482915'});
      final session = h.requests.firstWhere((r) => r.url.path == '/api/session');
      expect(session.headers['cookie'], 'wavetag_session=abc123');
      expect(h.requests.any((r) => r.url.path == '/api/owner/dashboard'), isTrue);
    });

    testWidgets('401 shows the wrong PIN copy and stores nothing', (tester) async {
      final h = Harness((req) => json(401, {'ok': false, 'error': 'Invalid credentials'}));
      await h.pump(tester);
      await tapText(tester, 'PIN');
      await tester.enterText(find.byType(TextField).at(0), '9876543210');
      await tester.enterText(find.byType(TextField).at(1), '111111');
      await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
      await tester.pumpAndSettle();

      expect(find.text('Wrong details or PIN. Try again.'), findsOneWidget);
      expect(find.text('HOME'), findsNothing);
      expect(await SessionStore().readCookie(), isNull);
    });
  });

  group('Mobile', () {
    Future<Harness> sendWith(WidgetTester tester, http.Response res,
        {String? appCheck = 'ac-token'}) async {
      final h = Harness((req) => res);
      await h.pump(tester, appCheck: appCheck);
      await tester.enterText(find.byType(TextField).first, '9876543210');
      await tester.tap(find.widgetWithText(FilledButton, 'Send code'));
      await tester.pumpAndSettle();
      return h;
    }

    testWidgets('send-otp 400 with CAPTCHA_REQUIRED opens the bridge',
        (tester) async {
      final h = await sendWith(
          tester,
          json(400, {
            'ok': false,
            'code': 'CAPTCHA_REQUIRED',
            'error': "We couldn't verify this request."
          }));
      expect(find.text('BRIDGE'), findsOneWidget);
      final send = h.requests.single;
      expect(send.headers['X-Firebase-AppCheck'], 'ac-token');
      expect(jsonDecode(send.body),
          {'identifier': '+919876543210', 'recaptchaToken': ''});
    });

    testWidgets('send-otp 400 without a code opens the bridge', (tester) async {
      final h = await sendWith(tester, json(400, {'ok': false, 'error': 'x'}),
          appCheck: null);
      expect(find.text('BRIDGE'), findsOneWidget);
      expect(h.requests.single.headers.containsKey('X-Firebase-AppCheck'), isFalse);
    });

    testWidgets('send-otp 500 offers SMS, which opens the bridge', (tester) async {
      await sendWith(tester, json(500, {'ok': false, 'error': 'failed'}));
      expect(find.text('WhatsApp could not send the code.'), findsOneWidget);
      expect(find.text('BRIDGE'), findsNothing);
      await tapText(tester, 'Get the code by SMS');
      expect(find.text('BRIDGE'), findsOneWidget);
    });

    testWidgets('an invalid number never calls the server', (tester) async {
      final h = Harness((req) => json(200, {}));
      await h.pump(tester);
      await tester.enterText(find.byType(TextField).first, '12345');
      await tester.tap(find.widgetWithText(FilledButton, 'Send code'));
      await tester.pumpAndSettle();
      expect(find.text('Enter a valid 10-digit mobile number.'), findsOneWidget);
      expect(h.requests, isEmpty);
    });

    testWidgets('code verifies, then SMS fallback appears after the timer',
        (tester) async {
      final h = Harness((req) => switch (req.url.path) {
            '/api/auth/send-otp' => json(200, {'ok': true}),
            '/api/auth/verify-otp' => json(200, {'ok': true, 'isNewUser': false},
                {'set-cookie': 'wavetag_session=otp1; Path=/; HttpOnly'}),
            '/api/session' => json(200, _owner),
            _ => json(404, {}),
          });
      await h.pump(tester);
      await tester.enterText(find.byType(TextField).first, '9876543210');
      await tester.tap(find.widgetWithText(FilledButton, 'Send code'));
      await tester.pumpAndSettle();

      expect(find.text("Didn't get it? Use SMS"), findsNothing);
      await tester.pump(const Duration(seconds: 31));
      expect(find.text("Didn't get it? Use SMS"), findsOneWidget);

      await tester.enterText(find.byType(TextField).first, '123456');
      await tester.pumpAndSettle();
      expect(find.text('HOME'), findsOneWidget);
      expect(await SessionStore().readCookie(), 'otp1');
    });
  });

  testWidgets('a new user gets the set-PIN nudge before Home', (tester) async {
    final h = Harness((req) => switch (req.url.path) {
          '/api/auth/send-otp' => json(200, {'ok': true}),
          '/api/auth/verify-otp' => json(200, {'ok': true, 'isNewUser': true},
              {'set-cookie': 'wavetag_session=new1; Path=/; HttpOnly'}),
          '/api/owner/login-pin' => json(200, {'ok': true}),
          '/api/session' => json(200, _owner),
          _ => json(404, {}),
        });
    await h.pump(tester);
    await tester.enterText(find.byType(TextField).first, '9876543210');
    await tester.tap(find.widgetWithText(FilledButton, 'Send code'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, '123456');
    await tester.pumpAndSettle();

    expect(find.text('Set a login PIN'), findsOneWidget);
    await tester.enterText(find.widgetWithText(TextField, 'New PIN'), '482915');
    await tester.enterText(find.widgetWithText(TextField, 'Confirm PIN'), '482915');
    await tapText(tester, 'Set PIN');

    expect(find.text('VEHICLES'), findsOneWidget);
    final set = h.requests.firstWhere((r) => r.url.path == '/api/owner/login-pin');
    expect(jsonDecode(set.body), {'pin': '482915', 'confirmPin': '482915'});
    expect(set.headers['cookie'], 'wavetag_session=new1');
    // The 30s resend timer was cancelled with the screen.
    await tester.pump(const Duration(seconds: 31));
  });

  group('Email and password', () {
    testWidgets('email + password posts the email identifier', (tester) async {
      final h = Harness((req) => switch (req.url.path) {
            '/api/auth/login' => json(200, {'ok': true},
                {'set-cookie': 'wavetag_session=pw1; Path=/; HttpOnly'}),
            '/api/session' => json(200, _owner),
            _ => json(404, {}),
          });
      await h.pump(tester);
      await tapText(tester, 'PIN');
      await tester.enterText(find.byType(TextField).at(0), ' a@b.co ');
      await tester.enterText(find.byType(TextField).at(1), 'longpass1');
      await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
      await tester.pumpAndSettle();

      expect(find.text('HOME'), findsOneWidget);
      final login = h.requests.firstWhere((r) => r.url.path == '/api/auth/login');
      expect(jsonDecode(login.body), {'identifier': 'a@b.co', 'pin': 'longpass1'});
    });

    testWidgets('a bad email never calls the server', (tester) async {
      final h = Harness((req) => json(200, {}));
      await h.pump(tester);
      await tapText(tester, 'PIN');
      await tester.enterText(find.byType(TextField).at(0), 'a@b');
      await tester.enterText(find.byType(TextField).at(1), 'x');
      await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
      await tester.pumpAndSettle();
      expect(find.text('Enter a valid email address.'), findsOneWidget);
      expect(h.requests, isEmpty);
    });

    testWidgets('Forgot password opens the web page', (tester) async {
      final h = Harness((req) => json(404, {}));
      await h.pump(tester);
      await tapText(tester, 'PIN');
      await tapText(tester, 'Forgot password?');
      expect(h.opened, ['https://app.parktag.me/forgot-password']);
    });

    testWidgets('email OTP for a new account sets a password, then vehicles',
        (tester) async {
      final h = Harness((req) => switch (req.url.path) {
            '/api/auth/send-otp' => json(200, {'ok': true}),
            '/api/auth/verify-otp' => json(200, {'ok': true, 'isNewUser': true},
                {'set-cookie': 'wavetag_session=em1; Path=/; HttpOnly'}),
            '/api/owner/set-password' => json(200, {'ok': true}),
            '/api/session' => json(200, _owner),
            _ => json(404, {}),
          });
      await h.pump(tester);
      await tapText(tester, 'Use email address instead');
      await tester.enterText(find.byType(TextField).first, 'a@b.co');
      await tester.tap(find.widgetWithText(FilledButton, 'Send code'));
      await tester.pumpAndSettle();

      final send = h.requests.firstWhere((r) => r.url.path == '/api/auth/send-otp');
      expect(send.headers['X-Firebase-AppCheck'], 'ac-token');
      expect(jsonDecode(send.body), {'identifier': 'a@b.co', 'recaptchaToken': ''});
      expect(find.text('Enter the code sent to a@b.co'), findsOneWidget);
      await tester.pump(const Duration(seconds: 31));
      expect(find.text("Didn't get it? Use SMS"), findsNothing);

      await tester.enterText(find.byType(TextField).first, '123456');
      await tester.pumpAndSettle();
      final verify =
          h.requests.firstWhere((r) => r.url.path == '/api/auth/verify-otp');
      expect(jsonDecode(verify.body), {'identifier': 'a@b.co', 'code': '123456'});

      expect(find.text('Set a password'), findsOneWidget);
      await tester.enterText(find.widgetWithText(TextField, 'New password'), 'short');
      await tapText(tester, 'Set password');
      expect(find.text('Password must be at least 8 characters.'), findsOneWidget);
      await tester.enterText(
          find.widgetWithText(TextField, 'New password'), 'longpass1');
      await tapText(tester, 'Set password');

      expect(find.text('VEHICLES'), findsOneWidget);
      final set =
          h.requests.firstWhere((r) => r.url.path == '/api/owner/set-password');
      expect(jsonDecode(set.body), {'password': 'longpass1'});
    });

    testWidgets('email send 500 shows the server text, no SMS offer',
        (tester) async {
      final h = Harness((req) => json(500, {'ok': false, 'error': 'Email failed.'}));
      await h.pump(tester);
      await tapText(tester, 'Use email address instead');
      await tester.enterText(find.byType(TextField).first, 'a@b.co');
      await tester.tap(find.widgetWithText(FilledButton, 'Send code'));
      await tester.pumpAndSettle();
      expect(find.text('Email failed.'), findsOneWidget);
      expect(find.text('Get the code by SMS'), findsNothing);
    });
  });

  group('Google', () {
    testWidgets('404 no_account shows the mobile-number guidance', (tester) async {
      final h = Harness((req) => switch (req.url.path) {
            '/api/auth/google/config' => json(200, {'clientId': 'web-client'}),
            '/api/auth/google/credential' => json(404, {'error': 'no_account'}),
            _ => json(404, {}),
          });
      await h.pump(tester);
      await tapText(tester, 'Google');
      await tapText(tester, 'Continue with Google');

      expect(
          find.text(
              'No ParkTag account for this Google email. Use your mobile number.'),
          findsOneWidget);
      final cred = h.requests
          .firstWhere((r) => r.url.path == '/api/auth/google/credential');
      expect(jsonDecode(cred.body), {'credential': 'g-id'});
    });

    testWidgets('200 {redirect} without ok is success', (tester) async {
      final h = Harness((req) => switch (req.url.path) {
            '/api/auth/google/config' => json(200, {'clientId': 'web-client'}),
            '/api/auth/google/credential' => json(200, {'redirect': '/owner-welcome'},
                {'set-cookie': 'wavetag_session=g1; Path=/; HttpOnly'}),
            '/api/session' => json(200, _owner),
            _ => json(404, {}),
          });
      await h.pump(tester);
      await tapText(tester, 'Google');
      await tapText(tester, 'Continue with Google');
      expect(find.text('HOME'), findsOneWidget);
      expect(h.app.isOwner, isTrue);
    });
  });

  testWidgets('login screen turns FLAG_SECURE on and off', (tester) async {
    final h = Harness((req) => json(404, {}));
    await h.pump(tester);
    expect(h.secureCalls, [true]);
    await tester.pumpWidget(const SizedBox());
    expect(h.secureCalls, [true, false]);
  });

  group('helpers', () {
    test('normalizeMobile', () {
      expect(normalizeMobile('9876543210'), '+919876543210');
      expect(normalizeMobile('+91 98765-43210'), '+919876543210');
      expect(normalizeMobile('919876543210'), '+919876543210');
      expect(normalizeMobile('09876543210'), '+919876543210');
      expect(normalizeMobile('5876543210'), isNull);
      expect(normalizeMobile('987654321'), isNull);
      expect(normalizeMobile('98765432101'), isNull);
      expect(normalizeMobile('+1 9876543210'), isNull);
    });

    test('normalizeEmail and normalizeIdentifier', () {
      expect(normalizeEmail(' a@b.co '), 'a@b.co');
      expect(normalizeEmail('a@b'), isNull);
      expect(normalizeEmail('a b@c.co'), isNull);
      expect(normalizeIdentifier('a@b.co'), 'a@b.co');
      expect(normalizeIdentifier('09876543210'), '+919876543210');
      expect(normalizeIdentifier('12345'), isNull);
    });

    test('errorText adds the wait to a 429', () {
      final e = ApiError(429,
          message: 'Too many attempts.', retryAfter: const Duration(seconds: 125));
      expect(errorText(e), 'Too many attempts. Wait 2:05.');
      expect(errorText(ApiError(400, message: 'Bad.')), 'Bad.');
    });

    test('googleErrorText maps server codes to local copy', () {
      expect(googleErrorText(ApiError(403, message: 'email_unverified')),
          'Your Google email is not verified. Use your mobile number.');
      expect(googleErrorText(ApiError(500, message: 'auth_failed')),
          'Google sign-in failed. Try again.');
    });
  });
}
