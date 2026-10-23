import 'package:app/core/api.dart';
import 'package:app/core/app_state.dart';
import 'package:app/core/session.dart';
import 'package:app/core/widgets.dart';
import 'package:app/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  testWidgets('guest launch shows the 5-tab shell on the hub', (tester) async {
    FlutterSecureStorage.setMockInitialValues({'onboarded': '1'});
    // The /login screen turns FLAG_SECURE on over this channel.
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('parktag/platform'),
      (_) async => null,
    );
    final app = AppState(
      ApiClient(
        store: SessionStore(),
        client: MockClient((_) async => http.Response('{"session":null}', 200)),
      ),
    );
    await tester.pumpWidget(ParkTagApp(app: app));
    await tester.pumpAndSettle();

    expect(find.byType(PtLogo), findsOneWidget); // hub wordmark, not text
    for (final icon in [
      Icons.home_rounded,
      Icons.qr_code_scanner_rounded,
      Icons.shopping_bag_rounded,
      Icons.directions_car_rounded,
      Icons.menu_rounded,
    ]) {
      expect(find.byIcon(icon), findsOneWidget);
    }

    await tester.tap(find.byIcon(Icons.qr_code_scanner_rounded));
    await tester.pumpAndSettle();
    expect(find.text('Scan'), findsWidgets);

    // Tags is owner-only: a guest lands on sign-in.
    await tester.tap(find.byIcon(Icons.directions_car_rounded));
    await tester.pumpAndSettle();
    expect(find.text('Sign in'), findsWidgets);
  });

  testWidgets('owner launch lands on Home', (tester) async {
    FlutterSecureStorage.setMockInitialValues({'onboarded': '1'});
    final app = AppState(
      ApiClient(
        store: SessionStore(),
        client: MockClient((_) async => http.Response('{}', 200)),
      ),
    )..session = {'role': 'owner'};
    await tester.pumpWidget(ParkTagApp(app: app));
    await tester.pumpAndSettle();
    expect(find.text('Home'), findsWidgets);
  });
}
