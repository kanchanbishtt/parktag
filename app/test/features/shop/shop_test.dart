import 'dart:convert';

import 'package:app/core/api.dart';
import 'package:app/core/app_state.dart';
import 'package:app/core/session.dart';
import 'package:app/core/widgets.dart';
import 'package:app/features/shop/address_screen.dart';
import 'package:app/features/shop/checkout.dart';
import 'package:app/features/shop/models.dart';
import 'package:app/features/shop/pay.dart';
import 'package:app/features/shop/pincode.dart';
import 'package:app/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
// Transitive through url_launcher; only the test swaps the platform.
// ignore: depend_on_referenced_packages
import 'package:plugin_platform_interface/plugin_platform_interface.dart';
// ignore: depend_on_referenced_packages
import 'package:url_launcher_platform_interface/url_launcher_platform_interface.dart';

http.Response json(int status, Object body) => http.Response(jsonEncode(body), status,
    headers: {'content-type': 'application/json'});

const address = {
  'fullName': 'Asha Rao',
  'phone': '9876501234',
  'line1': '12 MG Road',
  'line2': '',
  'landmark': '',
  'city': 'Pune',
  'state': 'Maharashtra',
  'pincode': '411001',
};

const pricing = Pricing([Product('pt-car-1', 'ParkTag Car Tag (Pack of 1)', 29900)],
    codSurchargePaise: 4900, flashDiscountPaise: 4900);

class _FakeLauncher extends Fake
    with MockPlatformInterfaceMixin
    implements UrlLauncherPlatform {
  final urls = <String>[];

  @override
  Future<bool> launchUrl(String url, LaunchOptions options) async {
    urls.add(url);
    return true;
  }

  @override
  Future<bool> canLaunch(String url) async => true;
}

void main() {
  late List<http.Request> seen;
  late int payOpens;
  late OrderConfirmation? done;

  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    pinLookup = (_) async => null;
    seen = [];
    payOpens = 0;
    done = null;
    payLauncher = (_) async {
      payOpens++;
      return const PayResult('order_1', 'pay_1', 'sig');
    };
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

  Future<void> pumpSheet(WidgetTester tester, AppState app) async {
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
  }

  test('formatRupees', () {
    expect(formatRupees(29900), '₹299');
    expect(formatRupees(29950), '₹299.50');
    expect(formatRupees(5), '₹0.05');
    expect(formatRupees(0), '₹0');
  });

  test('pricing uses the website offer per quantity', () {
    final p = Pricing.fromJson({
      'products': {
        'pt-car-1': {'name': 'One', 'amountPaise': 29900},
        'pt-bike-1': {'name': 'Bike', 'amountPaise': 49900, 'soldOut': true},
      },
      'offers': {
        'pt-car-1': {'payableByQuantity': [24900, 49800]},
      },
      'codSurchargePaise': 4900,
    });
    final car = p.products.first;
    expect(car.payableFor(1), 24900);
    expect(car.payableFor(2), 49800);
    expect(car.payableFor(3), 89700); // beyond the offer list: catalogue price
    expect(p.products.last.soldOut, isTrue);
    expect(p.codSurchargePaise, 4900);
  });

  testWidgets('create-order with referralRefused does not open Razorpay', (tester) async {
    final app = appWith((req) async => switch (req.url.path) {
          '/api/owner/address' => json(200, {'ok': true, 'address': address}),
          '/api/shop/referral/check' => json(200, {'ok': true, 'discountPaise': 5000}),
          '/api/shop/razorpay-key' => json(200, {'keyId': 'rzp_test_x'}),
          '/api/shop/create-order' => json(200, {
              'ok': true,
              'orderId': 'order_1',
              'orderNumber': 'PT-1',
              'amount': 29900,
              'currency': 'INR',
              'referralRefused': 'self',
              'promoRefused': null,
            }),
          _ => json(404, {'error': 'unexpected'}),
        });
    await pumpSheet(tester, app);

    await tester.enterText(find.widgetWithText(TextField, 'Referral code'), 'FRIEND1');
    await tester.tap(find.text('Apply').last);
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Pay online'));
    await tester.tap(find.text('Pay online'));
    await tester.pumpAndSettle();

    final create = seen.singleWhere((r) => r.url.path == '/api/shop/create-order');
    expect(jsonDecode(create.body)['ref'], 'FRIEND1');
    expect(payOpens, 0);
    expect(seen.any((r) => r.url.path == '/api/shop/verify-payment'), isFalse);
    expect(find.text(referralRefusedText), findsOneWidget);
    expect(done, isNull);
  });

  testWidgets('a bare {error} 400 from create-order shows that message', (tester) async {
    final app = appWith((req) async => switch (req.url.path) {
          '/api/owner/address' => json(200, {'ok': true, 'address': address}),
          '/api/shop/razorpay-key' => json(200, {'keyId': 'rzp_test_x'}),
          '/api/shop/create-order' => json(400, {'error': 'productId required.'}),
          _ => json(404, {'error': 'unexpected'}),
        });
    await pumpSheet(tester, app);
    await tester.ensureVisible(find.text('Pay online'));
    await tester.tap(find.text('Pay online'));
    await tester.pumpAndSettle();
    expect(find.text('productId required.'), findsOneWidget);
    expect(payOpens, 0);
  });

  testWidgets('online pay verifies the signed payment', (tester) async {
    final app = appWith((req) async => switch (req.url.path) {
          '/api/owner/address' => json(200, {'ok': true, 'address': address}),
          '/api/shop/razorpay-key' => json(200, {'keyId': 'rzp_test_x'}),
          '/api/shop/create-order' => json(200, {
              'orderId': 'order_1',
              'orderNumber': 'PT-9',
              'amount': 29900,
              'currency': 'INR',
              'referralRefused': null,
            }),
          '/api/shop/verify-payment' => json(200, {'ok': true}),
          _ => json(404, {'error': 'unexpected'}),
        });
    await pumpSheet(tester, app);
    await tester.ensureVisible(find.text('Pay online'));
    await tester.tap(find.text('Pay online'));
    await tester.pumpAndSettle();
    expect(payOpens, 1);
    final verify = seen.singleWhere((r) => r.url.path == '/api/shop/verify-payment');
    expect(jsonDecode(verify.body), {
      'razorpay_order_id': 'order_1',
      'razorpay_payment_id': 'pay_1',
      'razorpay_signature': 'sig',
    });
    expect(done?.orderNumber, 'PT-9');
    expect(done?.cod, isFalse);
  });

  testWidgets('a failed verify after payment says paid and blocks paying again',
      (tester) async {
    final app = appWith((req) async => switch (req.url.path) {
          '/api/owner/address' => json(200, {'ok': true, 'address': address}),
          '/api/shop/razorpay-key' => json(200, {'keyId': 'rzp_test_x'}),
          '/api/shop/create-order' => json(200, {
              'orderId': 'order_1',
              'orderNumber': 'PT-9',
              'amount': 29900,
              'currency': 'INR',
            }),
          '/api/shop/verify-payment' => json(500, {'error': 'boom'}),
          _ => json(404, {'error': 'unexpected'}),
        });
    await pumpSheet(tester, app);
    await tester.ensureVisible(find.text('Pay online'));
    await tester.tap(find.text('Pay online'));
    await tester.pumpAndSettle();
    expect(payOpens, 1);
    expect(find.text(paidPendingText), findsOneWidget);
    expect(done, isNull);
    final pay = tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Pay online'));
    expect(pay.onPressed, isNull);
  });

  testWidgets('COD shows the masked phone hint and posts place-cod with the otp',
      (tester) async {
    final app = appWith((req) async => switch (req.url.path) {
          '/api/owner/address' => json(200, {'ok': true, 'address': address}),
          '/api/shop/cod-otp/send' => json(200, {'ok': true, 'phoneHint': '••••1234'}),
          '/api/shop/place-cod' =>
            json(200, {'ok': true, 'orderNumber': 'PT-7', 'flashOfferSeconds': 60}),
          _ => json(404, {'error': 'unexpected'}),
        });
    await pumpSheet(tester, app);
    await tester.ensureVisible(find.text('Cash on Delivery'));
    await tester.tap(find.text('Cash on Delivery'));
    await tester.pumpAndSettle();
    expect(find.textContaining('••••1234'), findsOneWidget);

    await tester.enterText(find.byType(TextField).last, '123456');
    await tester.ensureVisible(find.text('Place order'));
    await tester.tap(find.text('Place order'));
    await tester.pumpAndSettle();

    final place = seen.singleWhere((r) => r.url.path == '/api/shop/place-cod');
    final body = jsonDecode(place.body) as Map<String, dynamic>;
    expect(body['otp'], '123456');
    expect(body['productId'], 'pt-car-1');
    expect(payOpens, 0);
    expect(done?.orderNumber, 'PT-7');
    expect(done?.cod, isTrue);
    expect(done?.flashSeconds, 60);
  });

  testWidgets('an unserviceable pincode shows the server message', (tester) async {
    pinLookup = (_) async => (city: 'Leh', state: 'Ladakh');
    const msg = "Sorry, we can't currently deliver to that pincode. "
        "Please check it is your area's postal code.";
    final app = appWith((req) async => switch ((req.method, req.url.path)) {
          ('GET', '/api/owner/address') => json(200, {'ok': true, 'address': null}),
          ('POST', '/api/owner/address') => json(400, {'ok': false, 'error': msg}),
          _ => json(200, {'ok': true, 'suggestions': []}),
        });
    await tester.pumpWidget(AppScope(
        app: app, child: const MaterialApp(home: AddressScreen())));
    await tester.pumpAndSettle();

    Future<void> fill(String label, String v) =>
        tester.enterText(find.widgetWithText(TextFormField, label), v);
    await fill('Full name', 'Asha Rao');
    await fill('Mobile number', '9876501234');
    await fill('House, street', '12 MG Road');
    await fill('City', 'Leh');
    await fill('Pincode', '194101');
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pumpAndSettle(); // India Post fills State
    await tester.scrollUntilVisible(find.text('Save address'), 200,
        scrollable: find.byType(Scrollable).first);
    await tester.tap(find.text('Save address'));
    await tester.pumpAndSettle();

    expect(find.text(msg), findsOneWidget);
    final post = seen.singleWhere((r) => r.method == 'POST');
    expect(jsonDecode(post.body)['pincode'], '194101');
  });

  testWidgets('the guest Shop tab opens the Custom Tab with pt_app=android',
      (tester) async {
    FlutterSecureStorage.setMockInitialValues({'onboarded': '1'});
    final launcher = _FakeLauncher();
    UrlLauncherPlatform.instance = launcher;
    final app = AppState(ApiClient(
      store: SessionStore(),
      client: MockClient((_) async => json(200, {'session': null})),
    ));
    await tester.pumpWidget(ParkTagApp(app: app));
    await tester.pumpAndSettle();

    await tester.tap(find.descendant(
        of: find.byType(PtNavBar), matching: find.byIcon(Icons.shopping_bag_rounded)));
    await tester.pumpAndSettle();

    expect(launcher.urls, hasLength(1));
    final url = Uri.parse(launcher.urls.single);
    expect(url.host, 'app.parktag.me');
    expect(url.path, '/get');
    expect(url.queryParameters['pt_app'], 'android');
  });
}
