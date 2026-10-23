import 'dart:async';
import 'dart:convert';

import 'package:app/core/api.dart';
import 'package:app/core/app_state.dart';
import 'package:app/core/session.dart';
import 'package:app/features/shop/checkout.dart';
import 'package:app/features/shop/models.dart';
import 'package:app/features/shop/pay.dart';
import 'package:app/features/shop/shop_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

http.Response json(int status, Object body) => http.Response(jsonEncode(body), status,
    headers: {'content-type': 'application/json'});

const tagId = '64b7f0c2a1b2c3d4e5f60718';
const address = {
  'fullName': 'Asha Rao',
  'phone': '9876501234',
  'line1': '12 MG Road',
  'city': 'Pune',
  'state': 'Maharashtra',
  'pincode': '411001',
};
const product = {
  'name': 'ParkTag Car Tag (Pack of 1)',
  'amountPaise': 29900,
};

void main() {
  late List<http.Request> seen;

  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    seen = [];
    payLauncher = (_) async => const PayResult('order_1', 'pay_1', 'sig');
  });

  AppState appWith(Future<http.Response> Function(http.Request) handler) =>
      AppState(ApiClient(
        store: SessionStore(),
        client: MockClient((req) {
          seen.add(req);
          return handler(req);
        }),
      ))
        ..session = {'role': 'owner'};

  Future<http.Response> shop(http.Request req) async => switch (req.url.path) {
        '/api/shop/pricing' => json(200, {
            'ok': true,
            'products': {'pt-car-1': product},
            'codSurchargePaise': 4900,
          }),
        '/api/owner/address' => json(200, {'ok': true, 'address': address}),
        '/api/shop/razorpay-key' => json(200, {'keyId': 'rzp_test_x'}),
        '/api/shop/create-order' =>
          json(200, {'orderId': 'order_1', 'orderNumber': 'PT-3', 'amount': 29900}),
        '/api/shop/verify-payment' => json(200, {'ok': true}),
        _ => json(404, {'error': 'unexpected'}),
      };

  List<Map<String, dynamic>> creates() => [
        for (final r in seen.where((r) => r.url.path == '/api/shop/create-order'))
          jsonDecode(r.body) as Map<String, dynamic>
      ];

  testWidgets('the replace link is spent by the first order', (tester) async {
    final app = appWith(shop);
    final router = GoRouter(initialLocation: '/shop', routes: [
      GoRoute(path: '/shop', builder: (_, _) => const ShopScreen(replaceTagId: tagId)),
      GoRoute(path: '/shop/confirmed', builder: (_, _) => const Text('confirmed')),
    ]);
    await tester.pumpWidget(AppScope(app: app, child: MaterialApp.router(routerConfig: router)));
    await tester.pumpAndSettle();

    Future<void> buy() async {
      await tester.tap(find.text('ParkTag Car Tag (Pack of 1)'));
      await tester.pumpAndSettle();
      // The web product sheet first; BUY NOW opens the pack step.
      await tester.ensureVisible(find.text('BUY NOW'));
      await tester.tap(find.text('BUY NOW'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Pay online'));
      await tester.tap(find.text('Pay online'));
      await tester.pumpAndSettle();
      expect(find.text('confirmed'), findsOneWidget);
      router.pop();
      await tester.pumpAndSettle();
    }

    await buy();
    await buy();
    expect(creates().map((c) => c['replaceTagId']), [tagId, null]);
  });

  testWidgets('a sheet gone before verify returns still confirms the order', (tester) async {
    final verified = Completer<http.Response>();
    final app = appWith((req) => req.url.path == '/api/shop/verify-payment'
        ? verified.future
        : shop(req));
    OrderConfirmation? done;
    const pricing = Pricing([Product('pt-car-1', 'ParkTag Car Tag (Pack of 1)', 29900)]);
    await tester.pumpWidget(AppScope(
      app: app,
      child: MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: CheckoutSheet(
              product: pricing.products.first,
              pricing: pricing,
              onAddress: (_) async => null,
              onDone: (c) => done = c,
            ),
          ),
        ),
      ),
    ));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Pay online'));
    await tester.tap(find.text('Pay online'));
    await tester.pump();
    await tester.pump();

    // The sheet is torn down while verify-payment is in flight.
    await tester.pumpWidget(AppScope(app: app, child: const MaterialApp(home: SizedBox())));
    verified.complete(json(200, {'ok': true}));
    await tester.pumpAndSettle();
    expect(done?.orderNumber, 'PT-3');
  });
}
