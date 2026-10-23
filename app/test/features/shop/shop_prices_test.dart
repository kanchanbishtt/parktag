import 'dart:convert';

import 'package:app/core/api.dart';
import 'package:app/core/app_state.dart';
import 'package:app/core/session.dart';
import 'package:app/features/shop/shop_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

http.Response json(int status, Object body) => http.Response(
  jsonEncode(body),
  status,
  headers: {'content-type': 'application/json'},
);

const catalogue = {
  'ok': true,
  'products': {
    'pt-car-2': {'name': 'ParkTag Car Tag (Pack of 2)', 'amountPaise': 49900},
  },
  'offers': {
    'pt-car-2': {
      'code': 'LAUNCH100',
      'productId': 'pt-car-2',
      'mrpPaise': 49900,
      'discountPaise': 10000,
      'offerPaise': 39900,
    },
  },
};

void main() {
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  Future<List<String>> open(WidgetTester tester, {required bool owner}) async {
    final paths = <String>[];
    final app = AppState(
      ApiClient(
        store: SessionStore(),
        client: MockClient((req) async {
          paths.add(req.url.path);
          return req.url.path.startsWith('/api/shop/')
              ? json(200, catalogue)
              : json(401, {});
        }),
      ),
    );
    if (owner) app.session = {'role': 'owner'};
    await tester.pumpWidget(
      AppScope(
        app: app,
        child: const MaterialApp(home: ShopScreen()),
      ),
    );
    await tester.pumpAndSettle();
    return paths;
  }

  testWidgets('an owner gets the price list and the cards show the offer', (
    tester,
  ) async {
    final paths = await open(tester, owner: true);
    expect(paths, contains('/api/shop/pricing'));
    // ₹399 with the MRP struck, 20% off, as the web card shows it.
    expect(find.text('₹399'), findsOneWidget);
    expect(find.text('20% OFF'), findsOneWidget);
  });

  testWidgets('a guest gets the public catalogue under the Sign in header', (
    tester,
  ) async {
    final paths = await open(tester, owner: false);
    expect(paths, contains('/api/shop/public-catalogue'));
    expect(paths, isNot(contains('/api/shop/pricing')));
    expect(find.text('Sign in'), findsOneWidget);
    expect(find.text('₹399'), findsOneWidget);
  });
}
