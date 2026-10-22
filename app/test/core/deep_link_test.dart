import 'package:app/core/api.dart';
import 'package:app/core/app_state.dart';
import 'package:app/core/session.dart';
import 'package:app/main.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

Future<AppState> _launch(WidgetTester tester) async {
  FlutterSecureStorage.setMockInitialValues({'onboarded': '1'});
  tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('parktag/platform'), (_) async => null);
  final app = AppState(ApiClient(
    store: SessionStore(),
    client: MockClient((_) async => http.Response('{"session":null}', 200)),
  ));
  await tester.pumpWidget(ParkTagApp(app: app));
  await tester.pumpAndSettle();
  return app;
}

void main() {
  testWidgets('unknown route shows the 404 screen', (tester) async {
    await _launch(tester);
    GoRouter.of(rootKey.currentContext!)
        .go('/no/such/page');
    await tester.pumpAndSettle();
    expect(find.text('Page not found'), findsOneWidget);
    expect(find.text('Back to Home'), findsOneWidget);
  });

  testWidgets('/get?ref= parks the referral code', (tester) async {
    final app = await _launch(tester);
    GoRouter.of(rootKey.currentContext!)
        .go('/get?ref=x237xc');
    await tester.pumpAndSettle();
    expect(app.pendingReferralCode, 'X237XC');
    expect(await app.api.store.readReferral(), startsWith('X237XC|'));
    await app.clearPendingReferralCode();
    expect(app.pendingReferralCode, isNull);
    expect(await app.api.store.readReferral(), isNull);
  });
}
