import 'dart:async';
import 'dart:convert';

import 'package:app/core/api.dart';
import 'package:app/core/app_state.dart';
import 'package:app/core/session.dart';
import 'package:app/features/auth/add_vehicles_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

http.Response json(int status, Object body) => http.Response(
  jsonEncode(body),
  status,
  headers: {'content-type': 'application/json'},
);

Future<List<http.Request>> pump(
  WidgetTester tester,
  FutureOr<http.Response> Function(http.Request) handler,
) async {
  final requests = <http.Request>[];
  final api = ApiClient(
    store: SessionStore(),
    client: MockClient((req) async {
      requests.add(req);
      if (req.url.path == '/api/owner/dashboard') return json(200, {});
      return handler(req);
    }),
  );
  final router = GoRouter(
    initialLocation: '/add',
    routes: [
      GoRoute(path: '/add', builder: (_, _) => const AddVehiclesScreen()),
      GoRoute(path: '/home', builder: (_, _) => const Text('HOME')),
    ],
  );
  addTearDown(router.dispose);
  await tester.pumpWidget(
    AppScope(
      app: AppState(api),
      child: MaterialApp.router(routerConfig: router),
    ),
  );
  await tester.pumpAndSettle();
  return requests;
}

Iterable<http.Request> adds(List<http.Request> r) =>
    r.where((q) => q.url.path == '/api/owner/local-vehicle');

Future<void> type(WidgetTester tester, String plate) =>
    tester.enterText(find.widgetWithText(TextField, 'Vehicle number'), plate);

void main() {
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  test('plate rules match register.js', () {
    expect(normalizePlate('  dl 01   ab 1234 '), 'DL 01 AB 1234');
    expect(plateError('DL01AB1234'), isNull);
    expect(plateError('MH 12 A 1'), isNull);
    expect(plateError(''), 'Please enter the vehicle number.');
    expect(plateError('D 01 AB 1234'), isNotNull);
    expect(plateError('DL 01 ABCD 1234'), isNotNull);
    expect(plateError('DL 01 AB 12345'), isNotNull);
  });

  testWidgets('saves every vehicle, 409 counts as saved, then Home', (
    tester,
  ) async {
    final requests = await pump(tester, (req) {
      final number = jsonDecode(req.body)['number'];
      return number == 'KA 05 MN 77'
          ? json(409, {'ok': false, 'error': 'Vehicle already added.'})
          : json(200, {'ok': true});
    });
    await type(tester, 'dl 01 ab 1234');
    await tester.tap(find.text('Add vehicle'));
    await tester.pumpAndSettle();
    await type(tester, 'dl 01 ab 1234');
    await tester.tap(find.text('Add vehicle'));
    await tester.pumpAndSettle();
    expect(find.text('Vehicle already added.'), findsOneWidget);

    // Typed but not added: Continue still includes it.
    await type(tester, 'ka 05 mn 77');
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();

    expect(find.text('HOME'), findsOneWidget);
    expect(adds(requests).map((r) => jsonDecode(r.body)).toList(), [
      {'type': 'car', 'number': 'DL 01 AB 1234'},
      {'type': 'car', 'number': 'KA 05 MN 77'},
    ]);
  });

  testWidgets('a bad plate or an empty list never calls the server', (
    tester,
  ) async {
    final requests = await pump(tester, (_) => json(200, {}));
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(find.text('Add at least one vehicle.'), findsOneWidget);
    await type(tester, '1234');
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(
      find.text('Invalid format. Use Indian format, e.g. DL 01 AB 1234.'),
      findsOneWidget,
    );
    expect(adds(requests), isEmpty);
  });

  testWidgets('a failure keeps the unsaved vehicles for a retry', (
    tester,
  ) async {
    var fail = true;
    final requests = await pump(tester, (req) {
      final number = jsonDecode(req.body)['number'];
      if (number == 'MH 12 AB 1' && fail) {
        return json(400, {'ok': false, 'error': 'Could not add vehicle.'});
      }
      return json(200, {'ok': true});
    });
    for (final p in ['DL 01 AB 1234', 'MH 12 AB 1']) {
      await type(tester, p);
      await tester.tap(find.text('Add vehicle'));
      await tester.pumpAndSettle();
    }
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(find.text('Could not add vehicle.'), findsOneWidget);
    expect(find.widgetWithText(ListTile, 'DL 01 AB 1234'), findsNothing);
    expect(find.widgetWithText(ListTile, 'MH 12 AB 1'), findsOneWidget);

    fail = false;
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(find.text('HOME'), findsOneWidget);
    expect(adds(requests).length, 3);
  });

  testWidgets('Skip goes Home without saving', (tester) async {
    final requests = await pump(tester, (_) => json(200, {}));
    await tester.tap(find.text('Skip for now'));
    await tester.pumpAndSettle();
    expect(find.text('HOME'), findsOneWidget);
    expect(adds(requests), isEmpty);
  });

  testWidgets('leaving mid-save stops posting instead of looping', (
    tester,
  ) async {
    final held = Completer<http.Response>();
    final requests = await pump(tester, (_) => held.future);
    await type(tester, 'DL 01 AB 1234');
    await tester.tap(find.text('Continue'));
    await tester.pump();
    // Navigate away while the POST is in flight, as a router redirect would.
    GoRouter.of(tester.element(find.byType(AddVehiclesScreen))).go('/home');
    await tester.pumpAndSettle();
    held.complete(json(200, {'ok': true}));
    await tester.pumpAndSettle();
    expect(find.text('HOME'), findsOneWidget);
    expect(adds(requests).length, 1);
  });
}
