import 'dart:convert';

import 'package:app/core/api.dart';
import 'package:app/core/app_state.dart';
import 'package:app/core/session.dart';
import 'package:app/core/models.dart';
import 'package:app/features/more/membership_screen.dart';
import 'package:app/features/more/referral_card.dart';
import 'package:app/features/more/routes.dart';
import 'package:app/features/more/support.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

typedef Handler = http.Response Function(http.Request req);

http.Response json(Object body, [int status = 200]) =>
    http.Response(jsonEncode(body), status,
        headers: {'content-type': 'application/json'});

class Harness {
  Harness(this.app, this.requests, this.platformCalls);

  final AppState app;
  final List<http.Request> requests;
  final List<MethodCall> platformCalls;

  http.Request last(String method, String path) => requests.lastWhere(
      (r) => r.method == method && r.url.path == path,
      orElse: () => throw StateError('no $method $path'));

  Map<String, dynamic> body(String method, String path) =>
      jsonDecode(last(method, path).body) as Map<String, dynamic>;
}

Future<Harness> pumpAt(
  WidgetTester tester,
  String location,
  Handler handler, {
  Map<String, dynamic>? dashboard,
}) async {
  FlutterSecureStorage.setMockInitialValues(
      {'wavetag_session': 'abc', 'onboarded': '1'});
  final platformCalls = <MethodCall>[];
  tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('parktag/platform'), (call) async {
    platformCalls.add(call);
    return null;
  });
  addTearDown(() => tester.binding.defaultBinaryMessenger
      .setMockMethodCallHandler(const MethodChannel('parktag/platform'), null));

  final requests = <http.Request>[];
  final app = AppState(ApiClient(
    store: SessionStore(),
    base: Uri.parse('https://app.parktag.me'),
    client: MockClient((req) async {
      requests.add(req);
      return handler(req);
    }),
  ))
    ..session = {'role': 'owner'}
    ..dashboard = dashboard;

  final router = GoRouter(
    navigatorKey: rootKey,
    initialLocation: location,
    routes: [
      ...moreBranchRoutes,
      ...moreRootRoutes,
      GoRoute(path: '/hub', builder: (_, _) => const Text('HUB')),
    ],
  );
  addTearDown(router.dispose);
  await tester.pumpWidget(
      AppScope(app: app, child: MaterialApp.router(routerConfig: router)));
  await tester.pumpAndSettle();
  return Harness(app, requests, platformCalls);
}

Future<void> tapText(WidgetTester tester, String text) async {
  await tester.ensureVisible(find.text(text));
  await tester.tap(find.text(text));
  await tester.pumpAndSettle();
}

Future<String?> storedCookie() => const FlutterSecureStorage().read(key: 'wavetag_session');

void main() {
  testWidgets('membership renders cover dates and never prices or a buy button',
      (tester) async {
    final until = DateTime.now().toUtc().add(const Duration(days: 30, hours: 1));
    await pumpAt(tester, '/more/membership', (req) {
      return json({
        'ok': true,
        'trial': {
          'months': 12,
          'value': 1,
          'unit': 'Year',
          'headline': '1 year Premium included',
          'note': 'Starts automatically when you activate your premium tag',
        },
        'plans': [
          {'id': 'year', 'label': 'Yearly', 'price': 499, 'priceLabel': 'Rs 499'},
          {'id': 'month', 'label': 'Monthly', 'price': 59, 'priceLabel': '₹59'},
        ],
        'checkoutEnabled': true,
        'subscription': {'active': true, 'currentPeriodEnd': '2027-03-12T12:00:00.000Z'},
        'tags': [
          {
            'tagId': 't1',
            'plateNumber': 'DL01AB1234',
            'vehicleLabel': 'Car',
            'coveredUntil': until.toIso8601String(),
            'trial': true,
          },
          {
            'tagId': 't2',
            'plateNumber': 'HR26CD5678',
            'vehicleLabel': 'Bike',
            'coveredUntil': null,
            'trial': false,
          },
        ],
      });
    });

    expect(find.text('1 year Premium included'), findsOneWidget);
    expect(find.text('DL01AB1234'), findsOneWidget);
    expect(find.textContaining(formatDay(until)), findsOneWidget);
    expect(find.text('31 days left'), findsOneWidget);
    expect(find.text('YEAR'), findsOneWidget);
    expect(find.byType(LinearProgressIndicator), findsOneWidget);
    expect(find.textContaining('Not covered'), findsOneWidget);

    for (final banned in ['499', '59', '₹', 'Rs ', 'Yearly', 'Monthly']) {
      expect(find.textContaining(banned), findsNothing, reason: banned);
    }
    expect(find.textContaining(RegExp('buy|subscribe|upgrade', caseSensitive: false)),
        findsNothing);
    expect(find.byType(FilledButton), findsNothing);
    expect(find.byType(ElevatedButton), findsNothing);
  });

  testWidgets('delete account with a code sends DELETE {otp}, wipes and goes to /hub',
      (tester) async {
    final h = await pumpAt(tester, '/more/delete-account', (req) {
      switch ('${req.method} ${req.url.path}') {
        case 'POST /api/owner/account/send-delete-code':
          return json({'ok': true, 'channel': 'whatsapp', 'hint': '••••3210'});
        case 'DELETE /api/owner/account':
          return json({'ok': true});
        default:
          return json({'ok': true});
      }
    });

    await tapText(tester, 'Continue');
    expect(find.textContaining('••••3210'), findsOneWidget);

    await tester.enterText(find.byType(TextField), '123456');
    await tapText(tester, 'Delete my account');

    expect(h.body('DELETE', '/api/owner/account'), {'otp': '123456'});
    expect(await storedCookie(), isNull);
    expect(await const FlutterSecureStorage().read(key: 'onboarded'), '1');
    expect(h.app.isOwner, isFalse);
    expect(find.text('HUB'), findsOneWidget);
  });

  testWidgets(
      'delete account with PASSWORD_REQUIRED sends DELETE {password}; a 401 keeps the session',
      (tester) async {
    final h = await pumpAt(tester, '/more/delete-account', (req) {
      switch ('${req.method} ${req.url.path}') {
        case 'POST /api/owner/account/send-delete-code':
          return json({
            'ok': false,
            'code': 'PASSWORD_REQUIRED',
            'error': 'Enter your password to confirm.',
          }, 400);
        case 'DELETE /api/owner/account':
          return json({'ok': false, 'error': 'Incorrect password.'}, 401);
        case 'GET /api/session':
          return json({'session': {'role': 'owner'}});
        default:
          return json({'ok': true});
      }
    });

    await tapText(tester, 'Continue');
    expect(find.widgetWithText(TextField, 'Password'), findsOneWidget);

    await tester.enterText(find.byType(TextField), 'hunter2 ');
    await tapText(tester, 'Delete my account');

    expect(h.body('DELETE', '/api/owner/account'), {'password': 'hunter2 '});
    expect(find.text('Incorrect password.'), findsOneWidget);
    expect(find.widgetWithText(TextField, 'Password'), findsOneWidget);
    expect(await storedCookie(), 'abc');
    expect(h.app.isOwner, isTrue);
    expect(find.text('HUB'), findsNothing);
  });

  testWidgets('delete account with NO_DESTINATION shows support guidance', (tester) async {
    await pumpAt(tester, '/more/delete-account', (req) {
      return json({'ok': false, 'code': 'NO_DESTINATION', 'error': 'x'}, 409);
    });
    await tapText(tester, 'Continue');
    expect(find.text("We can't send a code. Contact support."), findsOneWidget);
    expect(find.text('Contact support'), findsOneWidget);
  });

  testWidgets('revoke-others shows the revoked count', (tester) async {
    final h = await pumpAt(tester, '/more/pin', (req) {
      switch ('${req.method} ${req.url.path}') {
        case 'GET /api/owner/login-pin':
          return json({'ok': true, 'hasPin': false, 'setAt': null});
        case 'POST /api/owner/sessions/revoke-others':
          return json({'ok': true, 'revoked': 3});
        default:
          return json({'ok': true});
      }
    });

    await tapText(tester, 'Sign out other devices');
    expect(find.text('Signed out of 3 other devices.'), findsOneWidget);
    expect(h.last('POST', '/api/owner/sessions/revoke-others').body, '{}');
    expect(
        h.platformCalls.any((c) =>
            c.method == 'setSecure' && (c.arguments as Map)['secure'] == true),
        isTrue);
  });

  testWidgets('a wrong current PIN stays on screen and keeps the session',
      (tester) async {
    final h = await pumpAt(tester, '/more/pin', (req) {
      switch ('${req.method} ${req.url.path}') {
        case 'GET /api/owner/login-pin':
          return json({'ok': true, 'hasPin': true, 'setAt': '2026-01-01'});
        case 'POST /api/owner/login-pin':
          return json({'ok': false, 'error': 'Current PIN is incorrect.'}, 401);
        case 'GET /api/session':
          return json({'session': {'role': 'owner'}});
        default:
          return json({'ok': true});
      }
    });

    await tester.enterText(find.widgetWithText(TextField, 'Current PIN'), '111222');
    await tester.enterText(find.widgetWithText(TextField, 'New PIN'), '583920');
    await tester.enterText(find.widgetWithText(TextField, 'Confirm PIN'), '583920');
    await tapText(tester, 'Change PIN');

    expect(h.body('POST', '/api/owner/login-pin'),
        {'pin': '583920', 'confirmPin': '583920', 'currentPin': '111222'});
    expect(find.text('Current PIN is incorrect.'), findsOneWidget);
    expect(await storedCookie(), 'abc');
    expect(h.app.isOwner, isTrue);
  });

  testWidgets('profile save PATCHes only displayName, gender and dateOfBirth',
      (tester) async {
    final dashboard = {
      'owner': {
        'displayName': 'Asha',
        'email': 'asha@example.com',
        'mobile': '+919876543210',
        'profile': {'gender': 'female', 'dateOfBirth': '1990-04-12', 'age': 36},
      },
    };
    final h = await pumpAt(tester, '/more/profile', (req) {
      if (req.url.path == '/api/owner/dashboard') return json(dashboard);
      return json({'ok': true});
    }, dashboard: dashboard);

    await tester.enterText(find.widgetWithText(TextField, 'Your name'), 'Asha Rao');
    await tapText(tester, 'Save');

    expect(h.body('PATCH', '/api/owner/profile'), {
      'displayName': 'Asha Rao',
      'gender': 'female',
      'dateOfBirth': '1990-04-12',
    });
    expect(find.text('Profile saved.'), findsOneWidget);
  });

  testWidgets('profile waits for the owner before seeding, and blocks a blank name',
      (tester) async {
    final h = await pumpAt(tester, '/more/profile', (req) {
      if (req.url.path == '/api/owner/dashboard') {
        return json({
          'owner': {
            'displayName': 'Asha',
            'profile': {'gender': 'female', 'dateOfBirth': '1990-04-12'},
          },
        });
      }
      return json({'ok': true});
    });

    expect(h.last('GET', '/api/owner/dashboard'), isNotNull);
    expect(find.text('1990-04-12'), findsOneWidget);
    expect(find.text('Female'), findsOneWidget);

    await tester.enterText(find.widgetWithText(TextField, 'Your name'), '  ');
    await tapText(tester, 'Save');
    expect(find.text('Enter your name.'), findsOneWidget);
    expect(h.requests.where((r) => r.method == 'PATCH'), isEmpty);
  });

  testWidgets('add mobile sends the OTP, then posts {mobile, otp}', (tester) async {
    final h = await pumpAt(tester, '/more/profile', (req) {
      switch ('${req.method} ${req.url.path}') {
        case 'POST /api/owner/mobile/send-otp':
          return json({'ok': true, 'phoneHint': '••••3210'});
        case 'GET /api/owner/dashboard':
          return json({'owner': {'displayName': 'Asha'}});
        default:
          return json({'ok': true, 'mobile': '+919876543210'});
      }
    }, dashboard: {'owner': {'displayName': 'Asha'}});

    await tapText(tester, 'Add');
    await tester.enterText(
        find.widgetWithText(TextField, 'Mobile number'), '9876543210');
    await tapText(tester, 'Send code');
    expect(h.body('POST', '/api/owner/mobile/send-otp'), {'mobile': '9876543210'});
    expect(find.textContaining('••••3210'), findsOneWidget);

    await tester.enterText(find.byType(TextField).last, '654321');
    await tapText(tester, 'Verify');
    expect(h.body('POST', '/api/owner/mobile'),
        {'mobile': '9876543210', 'otp': '654321'});
  });

  group('cover countdown', () {
    final now = DateTime.utc(2026, 10, 19, 12);
    test('daysLeft rounds up and stops at zero', () {
      expect(daysLeft(now.add(const Duration(hours: 1)), now), 1);
      expect(daysLeft(now.add(const Duration(days: 10)), now), 10);
      expect(daysLeft(now.subtract(const Duration(days: 1)), now), 0);
    });
    test('trialRemaining is the share of the included months left', () {
      final until = DateTime.utc(2027, 4, 19, 12);
      expect(trialRemaining(until, 12, now)!, closeTo(0.5, 0.01));
      expect(trialRemaining(until, 0, now), isNull);
      expect(trialRemaining(now.subtract(const Duration(days: 1)), 12, now), 0);
    });
  });

  group('referral copy (welcome.js renderReferral)', () {
    Referral ref(Map<String, dynamic> extra) => Referral.fromJson({
          'code': 'AB12CD',
          'discountPaise': 5000,
          'rewardMonths': 1,
          ...extra,
        });

    test('title, sub and link', () {
      final r = ref({});
      expect(referralShown(r), isTrue);
      expect(referralTitle(r), 'Give ₹50, get a free month');
      expect(referralTitle(ref({'rewardMonths': 2})), 'Give ₹50, get 2 free months');
      expect(referralSub(r), contains('You get 1 month of Premium'));
      expect(r.link, 'https://app.parktag.me/get?ref=AB12CD');
      expect(referralMessage(r), endsWith('https://app.parktag.me/get?ref=AB12CD'));
    });

    test('hidden without a code, a discount or a reward', () {
      expect(referralShown(null), isFalse);
      expect(referralShown(ref({'code': null})), isFalse);
      expect(referralShown(ref({'discountPaise': 0})), isFalse);
      expect(referralShown(ref({'rewardMonths': 0})), isFalse);
    });

    test('earned line', () {
      expect(referralEarned(ref({})), '');
      expect(
          referralEarned(ref({'friends': 2, 'monthsEarned': 2})),
          '2 friends have bought with your link. You have earned 2 months of Premium.');
      expect(referralEarned(ref({'monthsEarned': 1, 'monthsWaiting': 1})),
          'You have earned 1 month of Premium. 1 month is waiting, and will be added as soon as you have a Premium tag.');
    });
  });

  test('legal and support links point at parktag.me, which serves them', () {
    for (final u in [termsUrl, privacyUrl, refundUrl, supportUrl]) {
      expect(u, startsWith('https://parktag.me/'));
    }
  });

  testWidgets('More is the web menu: header, rows, badge and Sign Out', (tester) async {
    // Tall enough for the whole menu, as the drawer's list is lazily built.
    tester.view.physicalSize = const Size(600, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await pumpAt(tester, '/more', (_) => json({}), dashboard: {
      'owner': {'displayName': 'Asha', 'email': 'asha@example.com'},
      'tags': [
        {
          'id': 't1',
          'token': 'tokAAAAAAAAA',
          'status': 'active',
          'callsPaused': false,
          'vehicleType': 'car',
          'vehicleLabel': 'Car',
          'plateNumber': 'MH12AB1234',
          'premium': true,
          'callAccess': {'tier': 'premium-trial', 'masking': true},
          'scanUrl': 'https://app.parktag.me/t/tokAAAAAAAAA',
        },
      ],
    });

    expect(find.text('A'), findsOneWidget); // the avatar initial
    expect(find.text('Asha'), findsOneWidget);
    expect(find.text('asha@example.com'), findsOneWidget);
    expect(find.text('User Info'), findsOneWidget);
    // No backup number: the sub-line and the "1" badge, as on the web.
    expect(find.text('Add a backup number'), findsOneWidget);
    expect(find.text('1'), findsOneWidget);
    expect(find.text('MY VEHICLE'), findsOneWidget);
    expect(find.text('Add Vehicle'), findsOneWidget);
    expect(find.text('Tags & Call'), findsOneWidget);
    expect(find.text('My Orders'), findsOneWidget);
    expect(find.text('Call Masking'), findsOneWidget);
    expect(find.text('ALERTS & NOTIFICATIONS'), findsOneWidget);
    expect(find.text('Download Premium Tag'), findsOneWidget);
    // Remove Vehicle and Sign Out are two more rows under Get a Tag
    // Replacement, not a footer pinned over the nav.
    expect(find.text('Remove Vehicle'), findsOneWidget);
    expect(find.text('Sign Out'), findsOneWidget);
    final replaceY = tester.getCenter(find.text('Get a Tag Replacement')).dy;
    final removeY = tester.getCenter(find.text('Remove Vehicle')).dy;
    final signOutY = tester.getCenter(find.text('Sign Out')).dy;
    expect(removeY, greaterThan(replaceY));
    expect(signOutY, greaterThan(removeY));
    expect(signOutY - removeY, closeTo(removeY - replaceY, 1));
    expect(find.text('PREMIUM'), findsOneWidget);
    // The web's drawer has no plans, prices or legal rows.
    expect(find.textContaining('View plans'), findsNothing);
    expect(find.text('Terms of service'), findsNothing);

    // Tags & Call opens inline with the two live switches.
    await tester.tap(find.text('Tags & Call'));
    await tester.pumpAndSettle();
    expect(find.text('Tag Active'), findsOneWidget);
    expect(find.text('Calls Active'), findsOneWidget);
  });
}
