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
    http.Response(
      jsonEncode(body),
      status,
      headers: {'content-type': 'application/json', ...?headers},
    );

const _owner = {
  'session': {'role': 'owner'},
};

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

  Future<void> pump(
    WidgetTester tester, {
    String? appCheck = 'ac-token',
  }) async {
    // Tall enough for the whole card, like a phone: the links at the foot of
    // the code step must be on screen to be tapped.
    tester.view.physicalSize = const Size(412, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('parktag/platform'),
      (call) async {
        if (call.method == 'setSecure') {
          secureCalls.add((call.arguments as Map)['secure'] as bool);
        }
        return null;
      },
    );
    final router = GoRouter(
      navigatorKey: rootKey,
      initialLocation: '/login',
      routes: [
        GoRoute(
          path: '/login',
          builder: (_, _) => LoginScreen(appCheckToken: () async => appCheck),
        ),
        GoRoute(
          path: '/add-vehicles',
          builder: (_, _) => const Text('VEHICLES'),
        ),
        GoRoute(path: '/login/web', builder: (_, _) => const Text('BRIDGE')),
        GoRoute(path: '/home', builder: (_, _) => const Text('HOME')),
      ],
    );
    addTearDown(router.dispose);
    await tester.pumpWidget(
      AppScope(
        app: app,
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();
  }

  List<http.Request> to(String path) =>
      requests.where((r) => r.url.path == path).toList();
}

Future<void> tapText(WidgetTester tester, String text) async {
  await tester.tap(find.text(text));
  await tester.pumpAndSettle();
}

Future<void> typeAndContinue(WidgetTester tester, String value) async {
  await tester.enterText(find.byType(TextField).first, value);
  await tapText(tester, 'Continue');
}

Handler whatsappOk({bool isNew = false, String cookie = 'otp1'}) =>
    (req) => switch (req.url.path) {
      '/api/auth/send-otp' => json(200, {'ok': true}),
      '/api/auth/verify-otp' => json(
        200,
        {'ok': true, 'isNewUser': isNew},
        {'set-cookie': 'wavetag_session=$cookie; Path=/; HttpOnly'},
      ),
      '/api/auth/login' => json(
        200,
        {'ok': true},
        {'set-cookie': 'wavetag_session=$cookie; Path=/; HttpOnly'},
      ),
      '/api/owner/login-pin' => json(200, {'ok': true}),
      '/api/owner/set-password' => json(200, {'ok': true}),
      '/api/session' => json(200, _owner),
      _ => json(404, {}),
    };

void main() {
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  group('the page', () {
    testWidgets('opens as the web Owner Sign In card, mobile first', (
      tester,
    ) async {
      final h = Harness((req) => json(404, {}));
      await h.pump(tester);
      expect(find.text('Owner Sign In'), findsOneWidget);
      expect(
        find.text('Choose WhatsApp or SMS to receive your sign-in code.'),
        findsOneWidget,
      );
      expect(find.text('Mobile number'), findsOneWidget);
      expect(find.text('10-digit mobile number'), findsOneWidget);
      expect(find.text('Continue'), findsOneWidget);
      expect(find.text('Use email address instead'), findsOneWidget);
      // Nothing the web page does not have.
      expect(find.text('Google'), findsNothing);
      expect(find.text('Forgot password?'), findsNothing);
      expect(find.byType(AppBar), findsNothing);
    });

    testWidgets('the toggle switches to the email wording and back', (
      tester,
    ) async {
      final h = Harness((req) => json(404, {}));
      await h.pump(tester);
      await tapText(tester, 'Use email address instead');
      expect(find.text('Email address'), findsOneWidget);
      expect(find.text('name@example.com'), findsOneWidget);
      expect(
        find.text(
          "Enter your email address and we'll send you a verification code.",
        ),
        findsOneWidget,
      );
      await tapText(tester, 'Use mobile number instead');
      expect(find.text('Mobile number'), findsOneWidget);
    });

    testWidgets('typing an @ while asked for a number switches to email', (
      tester,
    ) async {
      final h = Harness((req) => json(404, {}));
      await h.pump(tester);
      await tester.enterText(find.byType(TextField).first, 'a@');
      await tester.pumpAndSettle();
      expect(find.text('Email address'), findsOneWidget);
      expect(find.text('Use mobile number instead'), findsOneWidget);
    });

    testWidgets(
      'empty and invalid identifiers show the web status lines and never call the server',
      (tester) async {
        final h = Harness((req) => json(200, {}));
        await h.pump(tester);
        await tapText(tester, 'Continue');
        expect(find.text('Please enter your mobile number.'), findsOneWidget);
        await typeAndContinue(tester, '12345');
        expect(
          find.text(
            'Invalid phone number. Enter a 10-digit Indian mobile number.',
          ),
          findsOneWidget,
        );
        await typeAndContinue(tester, 'a@b');
        expect(
          find.text('Invalid email address. Please check and try again.'),
          findsOneWidget,
        );
        expect(h.requests, isEmpty);
      },
    );

    testWidgets('turns FLAG_SECURE on and off', (tester) async {
      final h = Harness((req) => json(404, {}));
      await h.pump(tester);
      expect(h.secureCalls, [true]);
      await tester.pumpWidget(const SizedBox());
      expect(h.secureCalls, [true, false]);
    });
  });

  group('WhatsApp code', () {
    testWidgets(
      'Continue sends with App Check, then the code step mirrors the page',
      (tester) async {
        final h = Harness(whatsappOk());
        await h.pump(tester);
        await typeAndContinue(tester, '98765 43210');

        final send = h.to('/api/auth/send-otp').single;
        expect(send.headers['X-Firebase-AppCheck'], 'ac-token');
        expect(jsonDecode(send.body), {
          'identifier': '+919876543210',
          'recaptchaToken': '',
        });
        expect(find.text('Owner Sign In'), findsOneWidget);
        expect(
          find.textContaining('Enter the 6-digit code sent by WhatsApp to'),
          findsOneWidget,
        );
        expect(find.textContaining('+XXXXXXXX3210'), findsOneWidget);
        expect(find.text('Verification code'), findsOneWidget);
        expect(find.text('000000'), findsOneWidget);
        expect(find.text('Verify'), findsOneWidget);
        expect(find.text('Resend'), findsOneWidget);
        expect(find.text('Sign in with PIN'), findsOneWidget);
        expect(find.text('← Back to sign in'), findsOneWidget);
        expect(find.text('BRIDGE'), findsNothing);

        // The SMS fallback appears 10 s after the send, as on the web.
        expect(find.text('Try SMS OTP verification'), findsNothing);
        await tester.pump(smsOfferDelay);
        await tester.pumpAndSettle();
        expect(find.text("Don't have WhatsApp?"), findsOneWidget);
        await tapText(tester, 'Try SMS OTP verification');
        expect(find.text('BRIDGE'), findsOneWidget);
      },
    );

    testWidgets('the code signs in and stores the cookie', (tester) async {
      final h = Harness(whatsappOk());
      await h.pump(tester);
      await typeAndContinue(tester, '9876543210');
      await tester.enterText(find.byType(TextField).first, '123456');
      await tapText(tester, 'Verify');

      expect(find.text('HOME'), findsOneWidget);
      expect(await SessionStore().readCookie(), 'otp1');
      expect(h.app.isOwner, isTrue);
      expect(jsonDecode(h.to('/api/auth/verify-otp').single.body), {
        'identifier': '+919876543210',
        'code': '123456',
      });
      expect(
        h.to('/api/session').single.headers['cookie'],
        'wavetag_session=otp1',
      );
      expect(h.to('/api/owner/dashboard'), isNotEmpty);
      await tester.pump(
        smsOfferDelay,
      ); // the timer was cancelled with the screen
    });

    testWidgets('a short code is refused locally', (tester) async {
      final h = Harness(whatsappOk());
      await h.pump(tester);
      await typeAndContinue(tester, '9876543210');
      await tester.enterText(find.byType(TextField).first, '123');
      await tapText(tester, 'Verify');
      expect(find.text('Enter the 6-digit code.'), findsOneWidget);
      expect(h.to('/api/auth/verify-otp'), isEmpty);
      await tester.pump(smsOfferDelay);
    });

    testWidgets('a wrong code shows the server text', (tester) async {
      final h = Harness(
        (req) => switch (req.url.path) {
          '/api/auth/send-otp' => json(200, {'ok': true}),
          '/api/auth/verify-otp' => json(400, {
            'ok': false,
            'error': 'Invalid or expired code.',
          }),
          _ => json(404, {}),
        },
      );
      await h.pump(tester);
      await typeAndContinue(tester, '9876543210');
      await tester.enterText(find.byType(TextField).first, '123456');
      await tapText(tester, 'Verify');
      expect(find.text('Invalid or expired code.'), findsOneWidget);
      expect(find.text('HOME'), findsNothing);
      await tester.pump(smsOfferDelay);
    });

    testWidgets('Resend sends again and says so', (tester) async {
      final h = Harness(whatsappOk());
      await h.pump(tester);
      await typeAndContinue(tester, '9876543210');
      await tapText(tester, 'Resend');
      expect(h.to('/api/auth/send-otp'), hasLength(2));
      expect(
        find.text('A new code has been sent by WhatsApp.'),
        findsOneWidget,
      );
      await tester.pump(smsOfferDelay);
    });

    testWidgets('Back to sign in returns to the number form', (tester) async {
      final h = Harness(whatsappOk());
      await h.pump(tester);
      await typeAndContinue(tester, '9876543210');
      await tapText(tester, '← Back to sign in');
      expect(find.text('Mobile number'), findsOneWidget);
      expect(
        find.text('Choose WhatsApp or SMS to receive your sign-in code.'),
        findsOneWidget,
      );
    });

    testWidgets('send-otp 400 with CAPTCHA_REQUIRED opens the bridge', (
      tester,
    ) async {
      final h = Harness(
        (req) => json(400, {
          'ok': false,
          'code': 'CAPTCHA_REQUIRED',
          'error': "We couldn't verify this request.",
        }),
      );
      await h.pump(tester);
      await typeAndContinue(tester, '9876543210');
      expect(find.text('BRIDGE'), findsOneWidget);
      expect(h.requests.single.headers['X-Firebase-AppCheck'], 'ac-token');
    });

    testWidgets('send-otp 400 without App Check opens the bridge', (
      tester,
    ) async {
      final h = Harness((req) => json(400, {'ok': false, 'error': 'x'}));
      await h.pump(tester, appCheck: null);
      await typeAndContinue(tester, '9876543210');
      expect(find.text('BRIDGE'), findsOneWidget);
      expect(
        h.requests.single.headers.containsKey('X-Firebase-AppCheck'),
        isFalse,
      );
    });

    testWidgets(
      'a failed WhatsApp send opens the code step and offers SMS at once',
      (tester) async {
        await Harness((req) => json(500, {'ok': false, 'error': 'failed'}))
            .pump(tester);
        await typeAndContinue(tester, '9876543210');
        expect(
          find.text('WhatsApp could not send the code. Please try SMS below.'),
          findsOneWidget,
        );
        expect(find.text('Verification code'), findsOneWidget);
        expect(find.text('BRIDGE'), findsNothing);
        await tapText(tester, 'Try SMS OTP verification');
        expect(find.text('BRIDGE'), findsOneWidget);
      },
    );

    testWidgets('a 429 on send carries the wait', (tester) async {
      await Harness(
        (req) => http.Response(
          jsonEncode({'ok': false, 'error': 'Too many attempts.'}),
          429,
          headers: {'content-type': 'application/json', 'retry-after': '125'},
        ),
      ).pump(tester);
      await typeAndContinue(tester, '9876543210');
      expect(find.text('Too many attempts. Wait 2:05.'), findsOneWidget);
    });
  });

  group('PIN', () {
    testWidgets('Sign in with PIN posts the number the code went to', (
      tester,
    ) async {
      final h = Harness(whatsappOk(cookie: 'pin1'));
      await h.pump(tester);
      await typeAndContinue(tester, '9876543210');
      await tapText(tester, 'Sign in with PIN');
      expect(find.text('PIN'), findsOneWidget);
      expect(find.text('Enter your PIN'), findsOneWidget);
      expect(find.text('← Back to verification code'), findsOneWidget);
      await tester.enterText(find.byType(TextField).first, '482915');
      await tapText(tester, 'Sign in');

      expect(find.text('HOME'), findsOneWidget);
      expect(await SessionStore().readCookie(), 'pin1');
      expect(jsonDecode(h.to('/api/auth/login').single.body), {
        'identifier': '+919876543210',
        'pin': '482915',
      });
      await tester.pump(smsOfferDelay);
    });

    testWidgets('an empty PIN, then a wrong one, show the web status lines', (
      tester,
    ) async {
      final h = Harness(
        (req) => switch (req.url.path) {
          '/api/auth/send-otp' => json(200, {'ok': true}),
          '/api/auth/login' => json(401, {
            'ok': false,
            'error': 'Invalid credentials',
          }),
          _ => json(404, {}),
        },
      );
      await h.pump(tester);
      await typeAndContinue(tester, '9876543210');
      await tapText(tester, 'Sign in with PIN');
      await tapText(tester, 'Sign in');
      expect(find.text('Enter your PIN.'), findsOneWidget);
      expect(h.to('/api/auth/login'), isEmpty);
      await tester.enterText(find.byType(TextField).first, '111111');
      await tapText(tester, 'Sign in');
      expect(find.text('Invalid credentials'), findsOneWidget);
      expect(find.text('HOME'), findsNothing);
      expect(await SessionStore().readCookie(), isNull);
      await tapText(tester, '← Back to verification code');
      expect(find.text('Verification code'), findsOneWidget);
      await tester.pump(smsOfferDelay);
    });
  });

  testWidgets('a new user gets the set-PIN nudge before Add your vehicles', (
    tester,
  ) async {
    final h = Harness(whatsappOk(isNew: true, cookie: 'new1'));
    await h.pump(tester);
    await typeAndContinue(tester, '9876543210');
    await tester.enterText(find.byType(TextField).first, '123456');
    await tapText(tester, 'Verify');

    expect(find.text('Set a login PIN'), findsOneWidget);
    await tester.enterText(find.widgetWithText(TextField, 'New PIN'), '482915');
    await tester.enterText(
      find.widgetWithText(TextField, 'Confirm PIN'),
      '482915',
    );
    await tapText(tester, 'Set PIN');

    expect(find.text('VEHICLES'), findsOneWidget);
    final set = h.to('/api/owner/login-pin').single;
    expect(jsonDecode(set.body), {'pin': '482915', 'confirmPin': '482915'});
    expect(set.headers['cookie'], 'wavetag_session=new1');
    await tester.pump(smsOfferDelay);
  });

  group('Email code', () {
    testWidgets('Continue sends the email and shows the verify page look', (
      tester,
    ) async {
      final h = Harness(whatsappOk(isNew: true, cookie: 'em1'));
      await h.pump(tester);
      await tapText(tester, 'Use email address instead');
      await typeAndContinue(tester, ' a@b.co ');

      final send = h.to('/api/auth/send-otp').single;
      expect(send.headers['X-Firebase-AppCheck'], 'ac-token');
      expect(jsonDecode(send.body), {
        'identifier': 'a@b.co',
        'recaptchaToken': '',
      });
      expect(find.text('Check your email'), findsOneWidget);
      expect(find.text('We sent a 6-digit code to a@b.co.'), findsOneWidget);
      expect(find.text("Didn't receive a code? "), findsOneWidget);
      expect(find.text('Sign in using PIN'), findsOneWidget);
      await tester.pump(smsOfferDelay);
      expect(find.text('Try SMS OTP verification'), findsNothing);

      await tester.enterText(find.byType(TextField).first, '123456');
      await tapText(tester, 'Verify');
      expect(jsonDecode(h.to('/api/auth/verify-otp').single.body), {
        'identifier': 'a@b.co',
        'code': '123456',
      });

      expect(find.text('Set a password'), findsOneWidget);
      await tester.enterText(
        find.widgetWithText(TextField, 'New password'),
        'short',
      );
      await tapText(tester, 'Set password');
      expect(
        find.text('Password must be at least 8 characters.'),
        findsOneWidget,
      );
      await tester.enterText(
        find.widgetWithText(TextField, 'New password'),
        'longpass1',
      );
      await tapText(tester, 'Set password');

      expect(find.text('VEHICLES'), findsOneWidget);
      expect(jsonDecode(h.to('/api/owner/set-password').single.body), {
        'password': 'longpass1',
      });
    });

    testWidgets('Sign in using PIN on the email step posts the email', (
      tester,
    ) async {
      final h = Harness(whatsappOk(cookie: 'em2'));
      await h.pump(tester);
      await tapText(tester, 'Use email address instead');
      await typeAndContinue(tester, 'a@b.co');
      await tapText(tester, 'Sign in using PIN');
      expect(
        find.text('Registered with a password? Enter that here instead.'),
        findsOneWidget,
      );
      await tester.enterText(find.byType(TextField).first, 'longpass1');
      await tapText(tester, 'Sign in');
      expect(find.text('HOME'), findsOneWidget);
      expect(jsonDecode(h.to('/api/auth/login').single.body), {
        'identifier': 'a@b.co',
        'pin': 'longpass1',
      });
    });

    testWidgets('a failed email send stays on the form with the server text', (
      tester,
    ) async {
      await Harness((req) => json(500, {'ok': false, 'error': 'Email failed.'}))
          .pump(tester);
      await tapText(tester, 'Use email address instead');
      await typeAndContinue(tester, 'a@b.co');
      expect(find.text('Email failed.'), findsOneWidget);
      expect(find.text('Email address'), findsOneWidget);
      expect(find.text('Try SMS OTP verification'), findsNothing);
    });
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

    test('maskMobile keeps the last four digits, as login.js does', () {
      expect(maskMobile('+919876543210'), '+XXXXXXXX3210');
    });

    test('errorText adds the wait to a 429', () {
      final e = ApiError(
        429,
        message: 'Too many attempts.',
        retryAfter: const Duration(seconds: 125),
      );
      expect(errorText(e), 'Too many attempts. Wait 2:05.');
      expect(errorText(ApiError(400, message: 'Bad.')), 'Bad.');
    });

    test('googleErrorText maps server codes to local copy', () {
      expect(
        googleErrorText(ApiError(403, message: 'email_unverified')),
        'Your Google email is not verified. Use your mobile number.',
      );
      expect(
        googleErrorText(ApiError(500, message: 'auth_failed')),
        'Google sign-in failed. Try again.',
      );
    });
  });
}
