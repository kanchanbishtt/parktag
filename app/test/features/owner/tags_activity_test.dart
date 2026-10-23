import 'dart:convert';

import 'package:app/core/api.dart';
import 'package:app/core/app_state.dart';
import 'package:app/core/session.dart';
import 'package:app/core/theme.dart';
import 'package:app/features/owner/activity_rules.dart';
import 'package:app/features/owner/owner_common.dart';
import 'package:app/features/owner/routes.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

final now = DateTime.utc(2026, 10, 19, 12);

String ago(Duration d) => now.subtract(d).toIso8601String();

Map<String, dynamic> tag(
  String id,
  String token,
  String plate, {
  bool premium = false,
  bool used = false,
  int missed = 0,
}) => {
  'id': id,
  'token': token,
  'scanUrl': 'https://app.parktag.me/tag/$token',
  'status': 'active',
  'plateNumber': plate,
  'vehicleLabel': 'Car',
  'premium': premium,
  'freeContactUsed': used,
  'freeContactsLeft': used ? 0 : 1,
  'freeContactAllowance': 1,
  'missedContacts': missed,
  'callAccess': premium
      ? {'tier': 'premium-trial', 'premium': true, 'masking': true}
      : {'tier': used ? 'etag-used' : 'etag-free', 'premium': false},
};

Map<String, dynamic> dashboard({
  String? mobile = '+919999900000',
  String? backup,
  List<Map<String, dynamic>>? requests,
}) => {
  'owner': {
    'displayName': 'Asha',
    'greetingName': 'Asha',
    'mobile': mobile,
    'backupMobile': backup,
  },
  'tags': [
    tag('t1', 'tokP', 'MH12AB1234', premium: true),
    tag('t2', 'tokE', 'KA01CD5678', used: true, missed: 2),
    tag('t3', 'tokQ', 'DL01EF9999'),
  ],
  'requests':
      requests ??
      [
        {
          'id': 'r1',
          'token': 'tokP',
          'phoneLast4': '1234',
          'hasPhone': true,
          'action': 'call',
          'reason': 'blocking_exit',
          'createdAt': ago(const Duration(minutes: 3)),
        },
        {
          'id': 'r2',
          'token': 'tokE',
          'phoneLast4': '5678',
          'hasPhone': true,
          'action': 'call',
          'reason': 'lights_on',
          'createdAt': ago(const Duration(minutes: 5)),
        },
        {
          'id': 'r3',
          'token': 'tokP',
          'phoneLast4': '1111',
          'hasPhone': true,
          'action': 'call',
          'callOutcome': 'answered',
          'answeredOn': 'backup',
          'callDuration': 42,
          'createdAt': ago(const Duration(hours: 3)),
        },
        {
          'id': 'r4',
          'token': 'tokP',
          'hasPhone': false,
          'action': 'message',
          'reason': 'old_one',
          'createdAt': ago(const Duration(hours: 50)),
        },
      ],
  'callbackWindowMs': 600000,
};

Future<void> pump(
  WidgetTester tester,
  String location,
  Map<String, dynamic> dash,
) async {
  FlutterSecureStorage.setMockInitialValues({});
  tester.view.physicalSize = const Size(800, 3000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final api = ApiClient(
    store: SessionStore(),
    client: MockClient(
      (req) async => http.Response(
        jsonEncode(req.url.path == '/api/owner/dashboard' ? dash : {}),
        200,
        headers: {'content-type': 'application/json; charset=utf-8'},
      ),
    ),
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

void main() {
  final launched = <Uri>[];
  setUp(() {
    launched.clear();
    activityNow = () => now;
    ownerLaunch = (u) async {
      launched.add(u);
      return true;
    };
  });
  tearDown(() => activityNow = DateTime.now);

  testWidgets('activity: per-row state, outcome badges, 48h window, chips', (
    tester,
  ) async {
    await pump(tester, '/activity', dashboard());

    // r1 is the newest callable row on a premium tag.
    expect(find.text('Call back'), findsOneWidget);
    // r2 arrived on a used E-Tag: plain status, no purchase link.
    expect(find.text('Premium needed to call back'), findsOneWidget);
    expect(find.textContaining('Buy'), findsNothing);
    expect(find.textContaining('₹'), findsNothing);
    // r3 was answered on the backup number, with its duration.
    expect(find.text('Answered on backup'), findsOneWidget);
    expect(find.text('42s'), findsOneWidget);
    // r4 is older than 48 hours.
    expect(find.textContaining('Old one'), findsNothing);
    // Chips only for vehicles with activity, with counts.
    expect(find.text('All  3'), findsOneWidget);
    expect(find.text('MH12AB1234  2'), findsOneWidget);
    expect(find.text('KA01CD5678  1'), findsOneWidget);
    expect(find.textContaining('DL01EF9999'), findsNothing);

    await tester.tap(find.text('KA01CD5678  1'));
    await tester.pumpAndSettle();
    expect(find.text('Premium needed to call back'), findsOneWidget);
    expect(find.text('Call back'), findsNothing);
  });

  testWidgets('activity: only old rows shows the web empty message', (
    tester,
  ) async {
    await pump(
      tester,
      '/activity',
      dashboard(
        requests: [
          {
            'id': 'r9',
            'token': 'tokP',
            'hasPhone': false,
            'action': 'message',
            'createdAt': ago(const Duration(hours: 49)),
          },
        ],
      ),
    );
    expect(find.text('No recent activity'), findsOneWidget);
    expect(find.text('Activity older than 2 days is hidden'), findsOneWidget);
  });

  testWidgets('tags: banner countdown expires live, bell badge, menu badge', (
    tester,
  ) async {
    await pump(tester, '/tags', dashboard(mobile: null));

    expect(find.text('SOMEONE WANTS YOU TO CALL BACK'), findsOneWidget);
    expect(find.text('7 min left'), findsOneWidget);
    // No owner mobile: the row says so instead of offering Call Back.
    expect(find.text('Add phone\nto call back'), findsWidgets);
    // The backup number is unset: the menu button carries the web's "1".
    expect(find.byTooltip('Menu'), findsOneWidget);
    expect(find.text('1'), findsWidgets);
    // Two contacts in the last hour.
    expect(find.text('2'), findsWidgets);
    expect(find.byTooltip('Activity, 2 new'), findsOneWidget);
    // Per-vehicle pill and missed line, no purchase copy.
    expect(find.text('Call Used'), findsOneWidget);
    expect(
      find.textContaining("2 people tried to call you and couldn't get"),
      findsOneWidget,
    );

    // The window closes 7 minutes in; the prompt goes without a refresh.
    activityNow = () => now.add(const Duration(minutes: 8));
    await tester.pump(const Duration(minutes: 7, seconds: 2));
    expect(find.text('SOMEONE WANTS YOU TO CALL BACK'), findsNothing);
  });

  testWidgets('tags: KPI tiles filter vehicles; save number opens vcf', (
    tester,
  ) async {
    await pump(tester, '/tags', dashboard(backup: '+919888800000'));
    // The prompt and the activity list both offer the free call back.
    expect(find.text('Call Back'), findsWidgets);
    expect(find.text('DL01EF9999'), findsOneWidget);

    await tester.tap(find.text('Premium Tags'));
    await tester.pumpAndSettle();
    expect(find.text('Filtered: Premium'), findsOneWidget);
    expect(find.text('DL01EF9999'), findsNothing);
    // The used E-Tag's card is gone; its plate stays in the Activity chips,
    // which the KPI filter does not touch (welcome.js applyNbFilter).
    expect(find.text('Call Used'), findsNothing);

    await tester.tap(find.text('✕ Clear'));
    await tester.pumpAndSettle();
    expect(find.text('DL01EF9999'), findsOneWidget);

    await tester.tap(find.text('Add'));
    expect(launched.single.toString(), 'https://app.parktag.me/parktag.vcf');
  });
}
