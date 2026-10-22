import 'package:app/core/api.dart';
import 'package:app/core/app_state.dart';
import 'package:app/core/session.dart';
import 'package:app/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

AppState _app(http.Response Function(http.Request) handler) =>
    AppState(ApiClient(
      store: SessionStore(),
      client: MockClient((req) async => handler(req)),
    ));

Future<void> _launch(WidgetTester tester, AppState app) async {
  tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('parktag/platform'), (_) async => null);
  await app.bootstrap();
  await tester.pumpWidget(ParkTagApp(app: app));
  await tester.pumpAndSettle();
}

http.Response _guest(http.Request _) => http.Response('{"session":null}', 200);

void main() {
  testWidgets('first launch shows onboarding once, then the hub', (tester) async {
    FlutterSecureStorage.setMockInitialValues({});
    await _launch(tester, _app(_guest));

    expect(find.text('Masked call with your ParkTag'), findsOneWidget);
    for (final title in [
      'Emergency (SOS) contact',
      'Manage your tags',
      'Pause calls any time',
    ]) {
      await tester.tap(find.text('Next'));
      await tester.pumpAndSettle();
      expect(find.text(title), findsOneWidget);
    }
    await tester.tap(find.text('Get started'));
    await tester.pumpAndSettle();

    expect(find.text('Scan a tag'), findsOneWidget);
    expect(await SessionStore().isOnboarded(), isTrue);

    // A later launch skips the intro.
    await tester.pumpWidget(const SizedBox());
    await _launch(tester, _app(_guest));
    expect(find.text('Masked call with your ParkTag'), findsNothing);
    expect(find.text('Scan a tag'), findsOneWidget);
  });

  testWidgets('Skip also sets the flag', (tester) async {
    FlutterSecureStorage.setMockInitialValues({});
    await _launch(tester, _app(_guest));
    await tester.tap(find.text('Skip'));
    await tester.pumpAndSettle();
    expect(find.text('Scan a tag'), findsOneWidget);
    expect(await SessionStore().isOnboarded(), isTrue);
  });

  testWidgets('a signed-in owner goes straight to /home', (tester) async {
    FlutterSecureStorage.setMockInitialValues({'wavetag_session': 'c1'});
    await _launch(
        tester,
        _app((req) => req.url.path == '/api/session'
            ? http.Response('{"session":{"role":"owner"}}', 200)
            : http.Response('{}', 200)));
    expect(find.text('Masked call with your ParkTag'), findsNothing);
    expect(find.text('Scan a tag'), findsNothing);
    expect(find.text('Home'), findsWidgets);
  });

  testWidgets('offline with a stored cookie shows retry', (tester) async {
    FlutterSecureStorage.setMockInitialValues(
        {'wavetag_session': 'c1', 'onboarded': '1'});
    var online = false;
    await _launch(
        tester,
        _app((req) => online
            ? http.Response('{"session":null}', 200)
            : throw http.ClientException('offline')));
    expect(find.text(offlineError), findsOneWidget);

    online = true;
    await tester.tap(find.text('Retry'));
    await tester.pumpAndSettle();
    expect(find.text('Scan a tag'), findsOneWidget);
  });

  testWidgets('hub tiles open sign-in and help', (tester) async {
    FlutterSecureStorage.setMockInitialValues({'onboarded': '1'});
    await _launch(tester, _app(_guest));

    await tester.tap(find.text('How it works'));
    await tester.pumpAndSettle();
    expect(find.text('Your privacy'), findsOneWidget);
    await tester.pageBack();
    await tester.pumpAndSettle();

    await tester.tap(find.text('Sign in'));
    await tester.pumpAndSettle();
    expect(find.text('Sign in to manage your tags'), findsOneWidget);
  });

  testWidgets('hub tile opens public order tracking', (tester) async {
    FlutterSecureStorage.setMockInitialValues({'onboarded': '1'});
    await _launch(tester, _app(_guest));
    await tester.ensureVisible(find.text('Track an order'));
    await tester.tap(find.text('Track an order'));
    await tester.pumpAndSettle();
    expect(find.widgetWithText(AppBar, 'Track an order'), findsOneWidget);
  });

  testWidgets('help lists the FAQ and expands an answer', (tester) async {
    FlutterSecureStorage.setMockInitialValues({'onboarded': '1'});
    await _launch(tester, _app(_guest));
    await tester.tap(find.text('How it works'));
    await tester.pumpAndSettle();

    const q = 'Will my phone number be shared?';
    await tester.dragUntilVisible(
        find.text(q), find.byType(ListView).last, const Offset(0, -200));
    await tester.drag(find.byType(ListView).last, const Offset(0, -300));
    await tester.pumpAndSettle();
    expect(find.textContaining('Your name, number, and address'), findsNothing);
    await tester.tap(find.text(q));
    await tester.pumpAndSettle();
    expect(find.textContaining('Your name, number, and address', skipOffstage: false),
        findsOneWidget);
    expect(find.textContaining('extend Premium'), findsNothing);
  });
}
