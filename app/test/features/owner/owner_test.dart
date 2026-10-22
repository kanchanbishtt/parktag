import 'dart:convert';

import 'package:app/core/api.dart';
import 'package:app/core/app_state.dart';
import 'package:app/core/models.dart';
import 'package:app/core/session.dart';
import 'package:app/core/theme.dart';
import 'package:app/features/owner/activity_rules.dart';
import 'package:app/features/owner/owner_common.dart';
import 'package:app/features/owner/routes.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

Map<String, dynamic> _tag(
  String id,
  String token,
  String plate, {
  String status = 'active',
  Map<String, dynamic>? membership,
}) => {
  'id': id,
  'token': token,
  'scanUrl': 'https://app.parktag.me/tag/$token',
  'status': status,
  'plateNumber': plate,
  'vehicleLabel': 'Car',
  'premium': membership != null,
  'callsPaused': false,
  'freeContactsLeft': 1,
  'missedContacts': 0,
  'membership': membership,
};

Map<String, dynamic> dashboard() => {
  'owner': {
    'displayName': 'Asha',
    'greetingName': 'Asha',
    'mobile': '+919999900000',
  },
  'tags': [
    _tag(
      't1',
      'tokAAAAAAAAA',
      'MH12AB1234',
      membership: {'state': 'trial', 'endsAt': '2027-03-01T00:00:00.000Z'},
    ),
    _tag('t2', 'tokBBBBBBBBB', 'KA01CD5678'),
  ],
  'requests': [
    {
      'id': 'r1',
      'token': 'tokAAAAAAAAA',
      'phone': '+919876501234',
      'phoneLast4': '1234',
      'hasPhone': true,
      'action': 'call',
      'reason': 'blocking_exit',
      'scannerLocationLabel': 'Near City Mall',
      'carLocationMapUrl':
          'https://www.google.com/maps/search/?api=1&query=18.5,73.8',
      'createdAt': '2026-10-19T10:00:00.000Z',
    },
    {
      'id': 'r2',
      'token': 'tokBBBBBBBBB',
      'phoneLast4': null,
      'hasPhone': false,
      'action': 'message',
      'reason': 'lights_on',
      'createdAt': '2026-10-19T09:00:00.000Z',
    },
  ],
  'referral': {'code': 'ASHA50', 'discountPaise': 5000},
  'callbackWindowMs': 600000,
};

class Harness {
  Harness(this.handler);

  /// Returns (status, body) for a request.
  (int, Object) Function(http.Request req) handler;
  final calls = <http.Request>[];

  int count(String method, String path) =>
      calls.where((r) => r.method == method && r.url.path == path).length;

  http.Request last(String path) => calls.lastWhere((r) => r.url.path == path);

  Future<void> pump(WidgetTester tester, String location) async {
    FlutterSecureStorage.setMockInitialValues({});
    tester.view.physicalSize = const Size(800, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final api = ApiClient(
      store: SessionStore(),
      client: MockClient((req) async {
        calls.add(req);
        final (status, body) = handler(req);
        return http.Response(
          jsonEncode(body),
          status,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      }),
    );
    final app = AppState(api)..session = {'role': 'owner'};
    final router = GoRouter(
      navigatorKey: rootKey,
      initialLocation: location,
      routes: [
        ...homeBranchRoutes,
        ...tagsBranchRoutes,
        ...ownerRootRoutes,
        GoRoute(
          path: '/more/profile',
          builder: (_, _) => const Scaffold(body: Text('PROFILE SCREEN')),
        ),
        GoRoute(
          path: '/tags/:tagId/vault',
          builder: (_, _) => const Scaffold(body: Text('VAULT')),
        ),
      ],
    );
    await tester.pumpWidget(
      AppScope(
        app: app,
        child: MaterialApp.router(theme: buildTheme(), routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();
  }
}

(int, Object) okDashboard(http.Request req) =>
    req.url.path == '/api/owner/dashboard'
    ? (200, dashboard())
    : (200, {'ok': true});

void main() {
  final launched = <Uri>[];
  setUp(() {
    activityNow = () => DateTime.utc(2026, 10, 19, 10, 5);
    launched.clear();
    ownerLaunch = (u) async {
      launched.add(u);
      return true;
    };
  });

  testWidgets('toggling Tag active posts inactive and refreshes', (
    tester,
  ) async {
    final h = Harness(okDashboard);
    await h.pump(tester, '/tags/t1');
    expect(h.count('GET', '/api/owner/dashboard'), 1);

    await tester.tap(find.widgetWithText(SwitchListTile, 'Tag active'));
    await tester.pumpAndSettle();

    final post = h.last('/api/owner/tags/t1/status');
    expect(post.method, 'POST');
    expect(jsonDecode(post.body), {'status': 'inactive'});
    expect(h.count('GET', '/api/owner/dashboard'), 2);
  });

  testWidgets('Calls active posts to the calls endpoint', (tester) async {
    final h = Harness(okDashboard);
    await h.pump(tester, '/tags/t1');
    await tester.tap(find.widgetWithText(SwitchListTile, 'Calls active'));
    await tester.pumpAndSettle();
    expect(jsonDecode(h.last('/api/owner/tags/t1/calls').body), {
      'active': false,
    });
  });

  testWidgets('Add vehicle posts local-vehicle; 409 shows already added', (
    tester,
  ) async {
    final h = Harness(
      (req) => req.url.path == '/api/owner/local-vehicle'
          ? (409, {'ok': false, 'error': 'Vehicle already added.'})
          : okDashboard(req),
    );
    await h.pump(tester, '/tags');
    expect(find.text('My Vehicles (2)'), findsOneWidget);

    await tester.tap(find.text('Add vehicle').first);
    await tester.pumpAndSettle();
    await tester.enterText(
      find.widgetWithText(TextField, 'Vehicle number'),
      'mh12ab1234',
    );
    await tester.tap(find.widgetWithText(FilledButton, 'Add vehicle'));
    await tester.pumpAndSettle();

    final post = h.last('/api/owner/local-vehicle');
    expect(jsonDecode(post.body), {'type': 'car', 'number': 'MH12AB1234'});
    expect(find.text('Vehicle already added.'), findsOneWidget);
  });

  testWidgets('Add vehicle success refreshes and closes', (tester) async {
    final h = Harness(
      (req) => req.url.path == '/api/owner/local-vehicle'
          ? (200, {'ok': true, 'id': 't3', 'token': 'tokCCCCCCCCC'})
          : okDashboard(req),
    );
    await h.pump(tester, '/tags');
    await tester.tap(find.text('Add vehicle').first);
    await tester.pumpAndSettle();
    await tester.enterText(
      find.widgetWithText(TextField, 'Vehicle number'),
      'DL1A9',
    );
    await tester.tap(find.widgetWithText(FilledButton, 'Add vehicle'));
    await tester.pumpAndSettle();
    expect(h.count('GET', '/api/owner/dashboard'), 2);
    expect(find.widgetWithText(TextField, 'Vehicle number'), findsNothing);
  });

  testWidgets('activity row shows last 4 only; no Call back without a phone', (
    tester,
  ) async {
    final h = Harness(okDashboard);
    await h.pump(tester, '/activity');

    expect(find.text('•••• 1234'), findsOneWidget);
    expect(find.textContaining('9876501234'), findsNothing);
    expect(find.textContaining('+91'), findsNothing);
    expect(find.text('Near City Mall'), findsOneWidget);
    // Only r1 has a phone, so exactly one Call back.
    expect(find.text('Call back'), findsOneWidget);

    await tester.tap(find.text('Car location'));
    expect(launched.single.host, 'www.google.com');
  });

  testWidgets('/activity?tag= shows only that tag rows', (tester) async {
    final h = Harness(okDashboard);
    await h.pump(tester, '/activity?tag=t2');
    expect(find.text('Lights on · Message'), findsOneWidget);
    expect(find.text('Blocking exit · Call'), findsNothing);
    expect(find.text('Call back'), findsNothing);
  });

  testWidgets('Call back registers the call then dials', (tester) async {
    final h = Harness(
      (req) => req.url.path == '/api/owner/callback/register-call'
          ? (200, {'ok': true, 'virtualNumber': '08047000000'})
          : okDashboard(req),
    );
    await h.pump(tester, '/activity');
    await tester.tap(find.text('Call back'));
    await tester.pumpAndSettle();
    expect(jsonDecode(h.last('/api/owner/callback/register-call').body), {
      'requestId': 'r1',
    });
    expect(launched.single.toString(), 'tel:08047000000');
  });

  group('callback errors use local copy', () {
    Future<void> run(WidgetTester tester, int status, String code) async {
      final h = Harness(
        (req) => req.url.path == '/api/owner/callback/register-call'
            ? (
                status,
                {
                  'ok': false,
                  'code': code,
                  'error': 'Subscribe to Premium to call back. Upgrade now.',
                },
              )
            : okDashboard(req),
      );
      await h.pump(tester, '/activity');
      await tester.tap(find.text('Call back'));
      await tester.pumpAndSettle();
      expect(find.textContaining('Subscribe'), findsNothing);
      expect(find.textContaining('Upgrade'), findsNothing);
      expect(find.textContaining('₹'), findsNothing);
      expect(launched, isEmpty);
    }

    testWidgets('402 NO_PHONE links to Profile', (tester) async {
      await run(tester, 402, 'NO_PHONE');
      expect(find.text('Add your mobile number in Profile'), findsOneWidget);
      await tester.tap(find.text('Open Profile'));
      await tester.pumpAndSettle();
      expect(find.text('PROFILE SCREEN'), findsOneWidget);
    });

    testWidgets('402 CALL_SUBSCRIPTION_REQUIRED', (tester) async {
      await run(tester, 402, 'CALL_SUBSCRIPTION_REQUIRED');
      expect(find.text('Call service ended for this vehicle.'), findsOneWidget);
      expect(find.text('Open Profile'), findsNothing);
    });

    testWidgets('410 CALLBACK_NOT_LATEST', (tester) async {
      await run(tester, 410, 'CALLBACK_NOT_LATEST');
      expect(
        find.text('Only your latest alert can be called back.'),
        findsOneWidget,
      );
    });
  });

  testWidgets('Save / share E-Tag sends PNG bytes to shareImage', (
    tester,
  ) async {
    final shared = <MethodCall>[];
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('parktag/platform'),
      (call) async {
        shared.add(call);
        return null;
      },
    );
    addTearDown(
      () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        const MethodChannel('parktag/platform'),
        null,
      ),
    );

    final h = Harness(okDashboard);
    await h.pump(tester, '/tags/t1');
    final button = find.text('Save / share E-Tag');
    await tester.runAsync(() async {
      await tester.tap(button);
      for (var i = 0; i < 50 && shared.isEmpty; i++) {
        await Future<void>.delayed(const Duration(milliseconds: 20));
      }
    });

    final call = shared.single;
    expect(call.method, 'shareImage');
    expect(call.arguments['name'], 'parktag-MH12AB1234.png');
    final bytes = call.arguments['bytes'] as Uint8List;
    expect(bytes.sublist(0, 4), [0x89, 0x50, 0x4E, 0x47]);
  });

  testWidgets('delete confirms, calls DELETE and refreshes', (tester) async {
    final h = Harness(okDashboard);
    await h.pump(tester, '/tags/t1');
    final button = find.text('Delete vehicle');
    await tester.tap(button);
    await tester.pumpAndSettle();
    expect(find.text('This also deletes its documents.'), findsOneWidget);
    await tester.tap(find.widgetWithText(FilledButton, 'Delete'));
    await tester.pumpAndSettle();
    expect(h.count('DELETE', '/api/owner/tags/t1'), 1);
    expect(find.textContaining('My Vehicles'), findsOneWidget);
  });

  testWidgets('empty dashboard shows No vehicles yet', (tester) async {
    final h = Harness(
      (req) => (
        200,
        {
          'owner': {'greetingName': 'Asha'},
          'tags': [],
          'requests': [],
        },
      ),
    );
    await h.pump(tester, '/tags');
    expect(find.text('No vehicles yet'), findsOneWidget);
    await h.pump(tester, '/home');
    expect(find.text('No vehicles yet'), findsOneWidget);
  });

  testWidgets('load error shows the retry card', (tester) async {
    var fail = true;
    final h = Harness(
      (req) => fail
          ? (500, {'ok': false, 'error': 'Could not load. Try again.'})
          : okDashboard(req),
    );
    await h.pump(tester, '/tags');
    expect(find.text('Could not load. Try again.'), findsOneWidget);
    fail = false;
    await tester.tap(find.text('Retry'));
    await tester.pumpAndSettle();
    expect(find.text('MH12AB1234'), findsOneWidget);
  });

  testWidgets('Home: greeting, coverage, referral, no prices or plans', (
    tester,
  ) async {
    final h = Harness(okDashboard);
    await h.pump(tester, '/home');
    expect(find.text('Hi, Asha'), findsOneWidget);
    expect(find.text('Covered until 1 Mar 2027'), findsOneWidget);
    expect(find.text('E-Tag. No membership cover.'), findsOneWidget);
    expect(find.text('ASHA50'), findsOneWidget);
    expect(find.textContaining('View plans'), findsNothing);
    expect(find.textContaining('₹'), findsNothing);
    expect(find.textContaining('Rs '), findsNothing);
    expect(find.textContaining('plans', findRichText: true), findsNothing);
  });

  test('coverageLine handles open, lapsed, trial and E-Tag', () {
    Tag t(Map<String, dynamic>? m) =>
        Tag.fromJson(_tag('x', 'tokXXXXXXXXX', 'P', membership: m));
    expect(coverageLine(t(null)), 'E-Tag. No membership cover.');
    expect(
      coverageLine(t({'state': 'open', 'endsAt': null})),
      'Covered, no end date',
    );
    expect(coverageLine(t({'state': 'lapsed', 'endsAt': null})), 'Cover ended');
    expect(
      coverageLine(
        t({'state': 'subscribed', 'endsAt': '2027-01-05T00:00:00Z'}),
      ),
      'Covered until 5 Jan 2027',
    );
  });
}
