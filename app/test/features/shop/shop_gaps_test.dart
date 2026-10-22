import 'dart:convert';

import 'package:app/core/api.dart';
import 'package:app/core/app_state.dart';
import 'package:app/core/session.dart';
import 'package:app/features/shop/address_screen.dart';
import 'package:app/features/shop/cart_store.dart';
import 'package:app/features/shop/checkout.dart';
import 'package:app/features/shop/models.dart';
import 'package:app/features/shop/orders_screen.dart';
import 'package:app/features/shop/pay.dart';
import 'package:app/features/shop/pincode.dart';
import 'package:app/features/shop/track_order_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

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
    codSurchargePaise: 4900);
const tagId = '64b7f0c2a1b2c3d4e5f60718';

void main() {
  late List<http.Request> seen;
  late OrderConfirmation? done;

  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    seen = [];
    done = null;
    pinLookup = (_) async => null;
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

  Future<void> pump(WidgetTester tester, AppState app, Widget child) async {
    await tester.pumpWidget(AppScope(app: app, child: MaterialApp(home: child)));
    await tester.pumpAndSettle();
  }

  Widget sheet({String? variant, String? replace}) => Scaffold(
        body: SingleChildScrollView(
          child: CheckoutSheet(
            product: pricing.products.first,
            pricing: pricing,
            initialVariant: variant,
            replaceTagId: replace,
            onAddress: (_) async => null,
            onDone: (c) => done = c,
          ),
        ),
      );

  Map<String, dynamic> body(String path) =>
      jsonDecode(seen.singleWhere((r) => r.url.path == path).body) as Map<String, dynamic>;

  group('rules', () {
    test('variants per pack match the web', () {
      expect(variantsFor('pt-car-2'), ['Car', 'Auto']);
      expect(variantsFor('pt-bike-1'), ['Bike', 'Scooter', 'Helmet']);
      expect(variantsFor('pt-car-1-bike'), ['Car', 'Bike', 'Scooter']);
      expect(variantsFor('pt-combo'), ['Car', 'Bike', 'Scooter']);
    });

    test('product photos are the web storefront files', () {
      expect(productImageUrl('pt-car-1'), endsWith('/images/shop-car-900.webp'));
      expect(productImageUrl('pt-car-4'), endsWith('/images/shop-car-2-v2-900.webp'));
      expect(productImageUrl('unknown'), isNull);
    });

    test('replaceTagId only takes an ObjectId', () {
      expect(parseReplaceTagId(tagId), tagId);
      expect(parseReplaceTagId('abc'), isNull);
      expect(parseReplaceTagId(null), isNull);
    });

    test('India Post answer gives district and canonical state', () {
      final place = parsePostOffice([
        {
          'Status': 'Success',
          'PostOffice': [
            {'District': 'Pune', 'State': 'MAHARASHTRA'}
          ]
        }
      ]);
      expect(place?.city, 'Pune');
      expect(place?.state, 'Maharashtra');
      expect(parsePostOffice([{'Status': 'Error', 'PostOffice': null}]), isNull);
      expect(parsePostOffice('junk'), isNull);
      expect(pinStateProblem(place, 'Maharashtra'), isNull);
      expect(pinStateProblem(place, 'Goa'), contains('in Maharashtra, not Goa'));
    });

    test('a saved cart expires after a day', () {
      final now = DateTime(2026, 10, 19, 12);
      Map<String, Object?> at(DateTime t) =>
          {'productId': 'pt-car-1', 'quantity': 3, 'variant': 'Auto', 'savedAt': t.toIso8601String()};
      final fresh = SavedCart.fromJson(at(now.subtract(const Duration(hours: 2))), now: now);
      expect(fresh?.quantity, 3);
      expect(fresh?.variant, 'Auto');
      expect(SavedCart.fromJson(at(now.subtract(const Duration(hours: 25))), now: now), isNull);
      expect(SavedCart.fromJson({'productId': 'pt-car-1'}, now: now), isNull);
    });

    test('track status labels match track-order.js', () {
      expect(trackStatusLabel(null), 'Preparing to ship');
      expect(trackStatusLabel('booked'), 'Booked with courier');
      expect(trackStatusLabel('in_transit'), 'in transit');
    });
  });

  testWidgets('online order sends variant, replaceTagId and the parked referral, then clears it',
      (tester) async {
    final app = appWith((req) async => switch (req.url.path) {
          '/api/owner/address' => json(200, {'ok': true, 'address': address}),
          '/api/shop/referral/check' => json(200, {'ok': true, 'discountPaise': 5000}),
          '/api/shop/razorpay-key' => json(200, {'keyId': 'rzp_test_x'}),
          '/api/shop/create-order' =>
            json(200, {'orderId': 'order_1', 'orderNumber': 'PT-3', 'amount': 24900}),
          '/api/shop/verify-payment' => json(200, {'ok': true}),
          _ => json(404, {'error': 'unexpected'}),
        });
    await app.setPendingReferralCode('FRND23');
    await pump(tester, app, sheet(replace: tagId));

    expect(find.text(replaceNote), findsOneWidget);
    expect(body('/api/shop/referral/check')['code'], 'FRND23');
    await tester.tap(find.widgetWithText(ChoiceChip, 'Auto'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Pay online'));
    await tester.tap(find.text('Pay online'));
    await tester.pumpAndSettle();

    final create = body('/api/shop/create-order');
    expect(create['variant'], 'Auto');
    expect(create['replaceTagId'], tagId);
    expect(create['ref'], 'FRND23');
    expect(done?.orderNumber, 'PT-3');
    expect(app.pendingReferralCode, isNull);
  });

  testWidgets('COD shows the address-check warning and sends the variant', (tester) async {
    final app = appWith((req) async => switch (req.url.path) {
          '/api/owner/address' => json(200, {'ok': true, 'address': address}),
          '/api/shop/cod-otp/send' => json(200, {'ok': true, 'phoneHint': '1234'}),
          '/api/shop/address-check' => json(200, {'ok': true, 'validated': false}),
          '/api/shop/place-cod' => json(200, {'ok': true, 'orderNumber': 'PT-4'}),
          _ => json(404, {'error': 'unexpected'}),
        });
    await pump(tester, app, sheet(variant: 'Auto'));
    await tester.ensureVisible(find.text('Cash on Delivery'));
    await tester.tap(find.text('Cash on Delivery'));
    await tester.pumpAndSettle();

    expect(body('/api/shop/address-check')['address']['pincode'], '411001');
    expect(find.text(addressWarning('411001')), findsOneWidget);

    await tester.enterText(find.byType(TextField).last, '123456');
    await tester.ensureVisible(find.text('Place order'));
    await tester.tap(find.text('Place order'));
    await tester.pumpAndSettle();
    final place = body('/api/shop/place-cod');
    expect(place['variant'], 'Auto');
    expect(place.containsKey('replaceTagId'), isTrue);
    expect(done?.orderNumber, 'PT-4');
  });

  testWidgets('pincode lookup fills empty city and state', (tester) async {
    pinLookup = (_) async => (city: 'Pune', state: 'Maharashtra');
    final app = appWith((req) async => json(200, {'ok': true, 'address': null}));
    await pump(tester, app, const AddressScreen());

    await tester.enterText(find.widgetWithText(TextFormField, 'Pincode'), '411001');
    await tester.pumpAndSettle();
    expect(find.widgetWithText(TextFormField, 'Pune'), findsOneWidget);
    expect(find.text('Maharashtra'), findsOneWidget);
  });

  testWidgets('a pincode from another state blocks saving', (tester) async {
    pinLookup = (_) async => (city: 'North Goa', state: 'Goa');
    final app = appWith((req) async => json(200, {'ok': true, 'suggestions': []}));
    await pump(tester, app, AddressScreen(initial: Address.fromJson({...address, 'pincode': ''})));

    await tester.enterText(find.widgetWithText(TextFormField, 'Pincode'), '403001');
    await tester.pumpAndSettle();
    expect(find.widgetWithText(TextFormField, 'Pune'), findsOneWidget); // typed city kept
    await tester.scrollUntilVisible(find.text('Save address'), 200,
        scrollable: find.byType(Scrollable).first);
    await tester.tap(find.text('Save address'));
    await tester.pumpAndSettle();

    expect(find.textContaining('in Goa, not Maharashtra'), findsOneWidget);
    expect(seen.where((r) => r.method == 'POST'), isEmpty);
  });

  testWidgets('only trackable orders open tracking', (tester) async {
    final app = appWith((_) async => json(200, {
          'orders': [
            {'id': 'a1', 'orderNumber': 'PT-1', 'productName': 'Shipped', 'trackable': true},
            {'id': 'b2', 'orderNumber': 'PT-2', 'productName': 'Waiting', 'trackable': false},
          ]
        }));
    await pump(tester, app, const OrdersScreen());
    ListTile tile(String name) =>
        tester.widget<ListTile>(find.widgetWithText(ListTile, name));
    expect(tile('Shipped').onTap, isNotNull);
    expect(tile('Waiting').onTap, isNull);
  });

  testWidgets('public tracking posts order and last four and shows the courier link',
      (tester) async {
    final app = appWith((_) async => json(200, {
          'ok': true,
          'order': {
            'orderNumber': 'PT-260728-00042',
            'productName': 'ParkTag Car Tag (Pack of 1)',
            'shippingStatus': 'booked',
            'trackingUrl': 'https://www.delhivery.com/track/package/123',
            'scans': [
              {'status': 'Picked up', 'location': 'Pune'}
            ],
          }
        }))
      ..session = null;
    await pump(tester, app, const TrackOrderScreen());

    await tester.tap(find.text('Track order'));
    await tester.pumpAndSettle();
    expect(find.text('Enter your order ID to continue.'), findsOneWidget);
    expect(seen, isEmpty);

    await tester.enterText(find.widgetWithText(TextField, 'Order ID'), 'PT-260728-00042');
    await tester.enterText(
        find.widgetWithText(TextField, 'Last 4 digits of the delivery phone number'), '1234');
    await tester.tap(find.text('Track order'));
    await tester.pumpAndSettle();

    expect(jsonDecode(seen.single.body), {'orderNumber': 'PT-260728-00042', 'lastFour': '1234'});
    expect(find.text('Booked with courier'), findsOneWidget);
    expect(find.text('Picked up'), findsOneWidget);
    expect(find.text('Open on Delhivery'), findsOneWidget);
  });
}
