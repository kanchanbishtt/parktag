import 'dart:async';
import 'dart:convert';

import 'package:app/core/api.dart';
import 'package:app/core/app_state.dart';
import 'package:app/core/session.dart';
import 'package:app/features/scan/activation.dart';
import 'package:app/features/scan/call_state.dart';
import 'package:app/features/scan/contact_view.dart';
import 'package:app/features/scan/routes.dart';
import 'package:app/features/scan/scan_io.dart';
import 'package:app/features/scan/sos.dart';
import 'package:app/features/scan/tag_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

const token = 'abcdefghijkl1234';
const activeTag = {
  'token': token,
  'status': 'active',
  'vehicleLabel': 'Car',
  'maskedPlateNumber': 'DL ** ** 1234',
  'emergencyAvailable': true,
  'callsPaused': false,
  'claimable': false,
};
const verifyOk = {
  'grant': 'g-1',
  'maskedPlateNumber': 'DL ** ** 1234',
  'contactAvailable': true,
  'contactBlockedCode': null,
  'messageAlwaysOn': true,
  'callsPaused': false,
};

http.Response res(int status, Object body, [Map<String, String> headers = const {}]) =>
    http.Response(jsonEncode(body), status,
        headers: {'content-type': 'application/json', ...headers});

typedef Handler = http.Response? Function(http.Request req);

late List<http.Request> seen;
late List<Uri> launched;
late int locationAsks;
late List<String> tabs;

Future<AppState> pumpTag(WidgetTester tester, Handler handler,
    {Map<String, dynamic> tag = activeTag, String? support}) async {
  // Tall enough that the whole contact list is built, not lazily cut off.
  tester.view.physicalSize = const Size(800, 3200);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final app = AppState(ApiClient(
    store: SessionStore(),
    base: Uri.parse('https://app.parktag.me'),
    client: MockClient((req) async {
      seen.add(req);
      if (req.method == 'GET' && req.url.path == '/api/tags/$token') {
        return res(200, {'ok': true, 'tag': tag, 'supportWhatsapp': ?support});
      }
      return handler(req) ?? res(200, {});
    }),
  ));
  final router = GoRouter(
    navigatorKey: rootKey,
    initialLocation: '/t/$token',
    routes: [
      ...scanRootRoutes,
      GoRoute(path: '/home', builder: (_, _) => const Text('HOME')),
      GoRoute(path: '/scan', builder: (_, _) => const Text('SCAN')),
    ],
  );
  addTearDown(router.dispose);
  await tester.pumpWidget(
      AppScope(app: app, child: MaterialApp.router(routerConfig: router)));
  await tester.pumpAndSettle();
  return app;
}

Future<void> verify(WidgetTester tester) async {
  await tester.enterText(find.byKey(const Key('verify-digits')), '1234');
  await tester.tap(find.text('Verify'));
  await tester.pumpAndSettle();
}

Map<String, dynamic> lastBody(String path) =>
    jsonDecode(seen.lastWhere((r) => r.url.path == path).body) as Map<String, dynamic>;

ButtonStyleButton buttonOf(WidgetTester tester, String label) =>
    tester.widget<ButtonStyleButton>(find.ancestor(
        of: find.text(label), matching: find.bySubtype<ButtonStyleButton>()));

Future<void> tapVisible(WidgetTester tester, Finder f) async {
  await tester.ensureVisible(f);
  await tester.pumpAndSettle();
  await tester.tap(f);
  await tester.pumpAndSettle();
}

/// Ticks the genuine-emergency box and continues.
Future<void> confirmSos(WidgetTester tester) async {
  await tapVisible(tester, find.text('Emergency'));
  final go = find.text('View emergency contacts');
  expect(tester.widget<ButtonStyleButton>(
          find.ancestor(of: go, matching: find.bySubtype<ButtonStyleButton>()))
      .onPressed, isNull);
  await tester.tap(find.byKey(const Key('sos-confirm-check')));
  await tester.pumpAndSettle();
  await tester.tap(go);
  await tester.pumpAndSettle();
}

Future<void> callWith(WidgetTester tester, String button) async {
  if (button == 'Emergency') {
    await confirmSos(tester);
  } else {
    await tapVisible(tester, find.text(button));
  }
  await tester.enterText(find.byKey(const Key('caller-phone')), '9876543210');
  await tester.pumpAndSettle();
  expect(find.text('Call from the SIM with number ending 3210.'), findsOneWidget);
  await tester.tap(find.text('Call'));
  await tester.pumpAndSettle();
}

void main() {
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    seen = [];
    launched = [];
    locationAsks = 0;
    tabs = [];
    ScanIo.launch = (uri) async {
      launched.add(uri);
      return true;
    };
    ScanIo.customTab = (url) async {
      tabs.add(url);
      return true;
    };
    ScanIo.appCheckToken = () async => 'ac-token';
    ScanIo.shareText = (_) async => throw StateError('no share sheet');
    ScanIo.positions = () {
      locationAsks++;
      return Stream.value(const CarFix(28.6, 77.2, 10));
    };
  });

  testWidgets('verify 401 shows attempts left, 423 shows the server text',
      (tester) async {
    var n = 0;
    await pumpTag(tester, (req) {
      if (!req.url.path.endsWith('/verify')) return null;
      return n++ == 0
          ? res(401, {
              'error': 'Those last 4 digits do not match this vehicle.',
              'attemptsRemaining': 2
            })
          : res(423, {'error': 'Too many incorrect attempts. Try again in 12 minute(s).'});
    });
    await verify(tester);
    expect(find.text('Those last 4 digits do not match this vehicle. 2 attempts left.'),
        findsOneWidget);
    expect(lastBody('/api/tags/$token/verify'), {'lastFour': '1234'});
    await verify(tester);
    expect(find.text('Too many incorrect attempts. Try again in 12 minute(s).'),
        findsOneWidget);
  });

  testWidgets('message success, phone only when the callback field is filled',
      (tester) async {
    await pumpTag(tester, (req) {
      if (req.url.path.endsWith('/verify')) return res(200, verifyOk);
      return null;
    });
    await verify(tester);
    await tapVisible(tester, find.text('Send WhatsApp alert'));
    expect(find.text(reasonRequiredText), findsOneWidget);
    expect(seen.where((r) => r.url.path == '/api/contact-requests'), isEmpty);
    await tapVisible(tester, find.text('Window open'));
    await tapVisible(tester, find.text('Send WhatsApp alert'));
    expect(find.text(alertedText), findsOneWidget);
    // A receipt, not an exit: the call and Emergency stay live.
    expect(find.text(alertedCallBody), findsOneWidget);
    expect(find.text('Send WhatsApp alert'), findsNothing);
    expect(buttonOf(tester, 'Private call').onPressed, isNotNull);
    expect(buttonOf(tester, 'Emergency').onPressed, isNotNull);
    expect(lastBody('/api/contact-requests'), {
      'token': token,
      'action': 'message',
      'messageChannel': 'whatsapp',
      'grant': 'g-1',
      'reason': 'window',
    });
  });

  testWidgets('message body carries reason, location and callback phone',
      (tester) async {
    await pumpTag(tester, (req) {
      if (req.url.path.endsWith('/verify')) return res(200, verifyOk);
      return null;
    });
    await verify(tester);
    expect(locationAsks, 0);
    await tapVisible(tester, find.text('Lights on'));
    await tapVisible(tester, find.byKey(const Key('share-location')));
    expect(locationAsks, 1);
    await tester.enterText(find.byKey(const Key('callback-phone')), '9876543210');
    await tapVisible(tester, find.text('Send WhatsApp alert'));
    final body = lastBody('/api/contact-requests');
    expect(body.keys.toSet(), {
      'token', 'action', 'messageChannel', 'grant', 'reason', 'carLocation', 'phone'
    });
    expect(body['phone'], '9876543210');
    expect(body['reason'], 'lights');
    expect(body['carLocation'], {'lat': 28.6, 'lng': 77.2, 'accuracy': 10});
    expect(locationAsks, 1);
  });

  testWidgets('sends wait until the first fix, then carry the best so far',
      (tester) async {
    final loc = StreamController<CarFix>();
    ScanIo.positions = () => loc.stream;
    await pumpTag(tester, (req) {
      if (req.url.path.endsWith('/verify')) return res(200, verifyOk);
      return null;
    });
    await verify(tester);
    await tapVisible(tester, find.byKey(const Key('share-location')));
    expect(find.text('Allow location when your phone asks'), findsOneWidget);
    for (final label in ['Send WhatsApp alert', 'Private call', 'Emergency']) {
      final b = tester.widget<ButtonStyleButton>(find.ancestor(
          of: find.text(label), matching: find.bySubtype<ButtonStyleButton>()));
      expect(b.onPressed, isNull, reason: label);
    }
    loc.add(const CarFix(28.6, 77.2, 300));
    await tester.pumpAndSettle();
    expect(find.text('Accurate to ~300 m, improving...'), findsOneWidget);
    await tapVisible(tester, find.text('Lights on'));
    await tapVisible(tester, find.text('Send WhatsApp alert'));
    expect(lastBody('/api/contact-requests')['carLocation'],
        {'lat': 28.6, 'lng': 77.2, 'accuracy': 300});
    await loc.close();
  });

  testWidgets('a dialler that fails to open leaves the number and Tap to Call',
      (tester) async {
    ScanIo.launch = (uri) async {
      launched.add(uri);
      return false;
    };
    await pumpTag(tester, (req) {
      if (req.url.path.endsWith('/verify')) return res(200, verifyOk);
      if (req.url.path.endsWith('-call')) {
        return res(200, {'ok': true, 'virtualNumber': '08047123456'});
      }
      return null;
    });
    await verify(tester);
    await callWith(tester, 'Private call');
    expect(find.text(dialFailedText), findsOneWidget);
    expect(find.text('08047123456'), findsOneWidget);
    expect(find.text('Private call'), findsNothing);
    await tapVisible(tester, find.text('Tap to Call'));
    expect(launched.last, Uri(scheme: 'tel', path: '08047123456'));
    await callWith(tester, 'Emergency');
    expect(find.text(dialFailedText), findsOneWidget);
    expect(find.text('Tap to Call'), findsNWidgets(2));
    expect(find.text('Car location shared with the emergency contact.'),
        findsOneWidget);
    expect(lastBody('/api/tags/$token/register-emergency-call')['carLocation'],
        {'lat': 28.6, 'lng': 77.2, 'accuracy': 10});
  });

  testWidgets('message 402 shows the lapsed panel, 403 returns to verify',
      (tester) async {
    var n = 0;
    await pumpTag(tester, (req) {
      if (req.url.path.endsWith('/verify')) return res(200, verifyOk);
      if (req.url.path == '/api/contact-requests') {
        return n++ == 0
            ? res(402, {'code': 'CALL_SUBSCRIPTION_REQUIRED', 'error': 'Subscribe to keep calls on.'})
            : res(403, {'error': 'Your verification expired. Please verify the vehicle again.'});
      }
      return null;
    });
    await verify(tester);
    await tapVisible(tester, find.text('Lights on'));
    await tapVisible(tester, find.text('Send WhatsApp alert'));
    expect(find.text(lapsedTitle), findsOneWidget);
    expect(find.text('Send WhatsApp alert'), findsNothing);
    expect(find.text('Emergency'), findsOneWidget);
    expect(find.textContaining('Subscribe'), findsNothing);
  });

  testWidgets('message 403 returns to verify', (tester) async {
    await pumpTag(tester, (req) {
      if (req.url.path.endsWith('/verify')) return res(200, verifyOk);
      if (req.url.path == '/api/contact-requests') {
        return res(403, {'error': 'Your verification expired. Please verify the vehicle again.'});
      }
      return null;
    });
    await verify(tester);
    await tapVisible(tester, find.text('Lights on'));
    await tapVisible(tester, find.text('Send WhatsApp alert'));
    expect(find.byKey(const Key('verify-digits')), findsOneWidget);
  });

  testWidgets('register-call 402 FREE_USED retires the call with the trial note',
      (tester) async {
    await pumpTag(tester, (req) {
      if (req.url.path.endsWith('/verify')) return res(200, verifyOk);
      if (req.url.path.endsWith('/register-call')) {
        return res(402, {'code': 'FREE_USED', 'error': 'Upgrade to call.'});
      }
      return null;
    });
    await verify(tester);
    await callWith(tester, 'Private call');
    expect(find.text(trialUsedNote), findsOneWidget);
    expect(buttonOf(tester, 'Private call').onPressed, isNull);
    expect(find.text('Send WhatsApp alert'), findsOneWidget);
    expect(find.textContaining('Upgrade'), findsNothing);
    expect(launched, isEmpty);
  });

  testWidgets('register-call 403 GRANT_IN_USE returns to verify', (tester) async {
    await pumpTag(tester, (req) {
      if (req.url.path.endsWith('/verify')) return res(200, verifyOk);
      if (req.url.path.endsWith('/register-call')) {
        return res(403, {'code': 'GRANT_IN_USE', 'error': 'This verification is already in use.'});
      }
      return null;
    });
    await verify(tester);
    await callWith(tester, 'Private call');
    expect(find.byKey(const Key('verify-digits')), findsOneWidget);
    expect(find.text('This verification is already in use.'), findsOneWidget);
  });

  testWidgets('register-call success dials the virtual number', (tester) async {
    await pumpTag(tester, (req) {
      if (req.url.path.endsWith('/verify')) return res(200, verifyOk);
      if (req.url.path.endsWith('/register-call')) {
        return res(200, {'ok': true, 'virtualNumber': '08047123456'});
      }
      return null;
    });
    await verify(tester);
    await callWith(tester, 'Private call');
    expect(launched, [Uri(scheme: 'tel', path: '08047123456')]);
    expect(lastBody('/api/tags/$token/register-call'),
        {'phone': '9876543210', 'grant': 'g-1'});
  });

  for (final (status, code) in [(409, 'CALLER_IN_USE'), (503, null)]) {
    testWidgets('SOS $status shows the helplines with the server text', (tester) async {
      await pumpTag(tester, (req) {
        if (req.url.path.endsWith('/verify')) return res(200, verifyOk);
        if (req.url.path.endsWith('/register-emergency-call')) {
          return res(status, {'code': ?code, 'error': 'Server says $status.'});
        }
        return null;
      });
      await verify(tester);
      await callWith(tester, 'Emergency');
      expect(find.text('Server says $status.'), findsOneWidget);
      for (final (_, n) in helplines) {
        expect(find.text(n), findsOneWidget);
      }
      await tapVisible(tester, find.text('112'));
      expect(launched, [Uri(scheme: 'tel', path: '112')]);
    });
  }

  testWidgets('SOS GRANT_IN_USE returns to verify', (tester) async {
    await pumpTag(tester, (req) {
      if (req.url.path.endsWith('/verify')) return res(200, verifyOk);
      if (req.url.path.endsWith('/register-emergency-call')) {
        return res(403, {'code': 'GRANT_IN_USE', 'error': 'In use.'});
      }
      return null;
    });
    await verify(tester);
    await callWith(tester, 'Emergency');
    expect(find.text('112'), findsNothing);
    expect(find.byKey(const Key('verify-digits')), findsOneWidget);
  });

  testWidgets('inactive tag card offers a ParkTag and the owner link',
      (tester) async {
    await pumpTag(tester, (_) => null, tag: {...activeTag, 'status': 'inactive'});
    expect(find.text(tagInactive), findsOneWidget);
    expect(find.textContaining('Thank you for taking the time'), findsOneWidget);
    await tapVisible(tester, find.text('Get a ParkTag'));
    expect(tabs, [guestGetUrl]);
    expect(find.text('Is this your vehicle? Turn the tag back on from your dashboard.'),
        findsOneWidget);
  });

  testWidgets('calls paused at verify: tile off with the paused note',
      (tester) async {
    await pumpTag(tester, (req) {
      if (req.url.path.endsWith('/verify')) {
        return res(200, {...verifyOk, 'callsPaused': true});
      }
      return null;
    });
    await verify(tester);
    expect(find.text(pausedNote), findsOneWidget);
    expect(buttonOf(tester, 'Private call').onPressed, isNull);
    expect(find.text('Send WhatsApp alert'), findsOneWidget);
  });

  testWidgets('register-call 409 CALLS_PAUSED and OWNER_NO_PHONE retire the tile',
      (tester) async {
    var n = 0;
    await pumpTag(tester, (req) {
      if (req.url.path.endsWith('/verify')) return res(200, verifyOk);
      if (req.url.path.endsWith('/register-call')) {
        return n++ == 0
            ? res(422, {'code': 'OWNER_NO_PHONE', 'error': 'Owner has not set a phone number. Call unavailable.'})
            : res(409, {'code': 'CALLS_PAUSED', 'error': 'Paused.'});
      }
      return null;
    });
    await verify(tester);
    await callWith(tester, 'Private call');
    expect(find.text('Owner has not set a phone number. Call unavailable.'), findsOneWidget);
    expect(buttonOf(tester, 'Private call').onPressed, isNull);
  });

  testWidgets('lapsed at verify: panel instead of tiles, Emergency still calls',
      (tester) async {
    await pumpTag(tester, (req) {
      if (req.url.path.endsWith('/verify')) {
        return res(200, {
          ...verifyOk,
          'contactAvailable': false,
          'contactBlockedCode': 'CALL_SUBSCRIPTION_REQUIRED',
          'messageAlwaysOn': false,
        });
      }
      if (req.url.path.endsWith('/register-emergency-call')) {
        return res(200, {'ok': true, 'virtualNumber': '08047000000'});
      }
      return null;
    });
    await verify(tester);
    expect(find.text(lapsedTitle), findsOneWidget);
    expect(find.text(lapsedBody), findsOneWidget);
    expect(find.text('Send WhatsApp alert'), findsNothing);
    expect(find.text('Private call'), findsNothing);
    expect(find.text(locationNotice), findsNothing);
    await callWith(tester, 'Emergency');
    expect(launched, [Uri(scheme: 'tel', path: '08047000000')]);
  });

  testWidgets('free trial used at verify: Emergency leads to the helplines',
      (tester) async {
    await pumpTag(tester, (req) {
      if (req.url.path.endsWith('/verify')) {
        return res(200, {
          ...verifyOk,
          'contactAvailable': false,
          'contactBlockedCode': 'FREE_USED',
        });
      }
      return null;
    });
    await verify(tester);
    expect(find.text(trialUsedNote), findsOneWidget);
    expect(find.text('Send WhatsApp alert'), findsOneWidget);
    await confirmSos(tester);
    expect(find.text(helplineNoteUnavailable), findsOneWidget);
    expect(seen.where((r) => r.url.path.endsWith('-call')), isEmpty);
  });

  testWidgets('SOS before verify on a used trial goes straight to the helplines',
      (tester) async {
    await pumpTag(tester, (req) {
      if (req.url.path.endsWith('/verify')) {
        return res(200, {
          ...verifyOk,
          'contactAvailable': false,
          'contactBlockedCode': 'FREE_USED',
        });
      }
      return null;
    });
    await confirmSos(tester);
    await verify(tester);
    expect(find.byKey(const Key('caller-phone')), findsNothing);
    expect(find.text(helplineNoteUnavailable), findsOneWidget);
    expect(seen.where((r) => r.url.path.endsWith('-call')), isEmpty);
  });

  testWidgets('SOS with an unexpected failure still ends at the helplines',
      (tester) async {
    ScanIo.launch = (uri) async => throw StateError('no dialler');
    await pumpTag(tester, (req) {
      if (req.url.path.endsWith('/verify')) return res(200, verifyOk);
      if (req.url.path.endsWith('/register-emergency-call')) {
        return res(200, {'ok': true, 'virtualNumber': '08047000002'});
      }
      return null;
    });
    await verify(tester);
    await callWith(tester, 'Emergency');
    expect(find.text(helplineNoteOffline), findsOneWidget);
  });

  testWidgets('SOS 422 NO_EMERGENCY_CONTACT says no contact was added',
      (tester) async {
    await pumpTag(tester, (req) {
      if (req.url.path.endsWith('/verify')) return res(200, verifyOk);
      if (req.url.path.endsWith('/register-emergency-call')) {
        return res(422, {'code': 'NO_EMERGENCY_CONTACT', 'error': 'x'});
      }
      return null;
    });
    await verify(tester);
    await callWith(tester, 'Emergency');
    expect(find.text(helplineNoteNoContact), findsOneWidget);
  });

  testWidgets('no emergency contact: helplines before verifying, no call',
      (tester) async {
    await pumpTag(tester, (_) => null,
        tag: {...activeTag, 'emergencyAvailable': false});
    await confirmSos(tester);
    expect(find.text(helplineNoteUnavailable), findsOneWidget);
    for (final label in ['Ambulance', 'Police', 'Fire', 'Women Helpline']) {
      expect(find.text(label), findsOneWidget);
    }
    expect(locationAsks, 0);
  });

  testWidgets('SOS confirmed before verifying starts location, then the call',
      (tester) async {
    await pumpTag(tester, (req) {
      if (req.url.path.endsWith('/verify')) return res(200, verifyOk);
      if (req.url.path.endsWith('/register-emergency-call')) {
        return res(200, {'ok': true, 'virtualNumber': '08047000001'});
      }
      return null;
    });
    await confirmSos(tester);
    expect(locationAsks, 1);
    expect(find.text(sosVerifyNotice), findsOneWidget);
    await verify(tester);
    await tester.enterText(find.byKey(const Key('caller-phone')), '+44 7700 900123');
    await tester.pumpAndSettle();
    expect(find.text('Call from the SIM with number ending 0123.'), findsOneWidget);
    await tester.tap(find.text('Call'));
    await tester.pumpAndSettle();
    expect(lastBody('/api/tags/$token/register-emergency-call')['phone'],
        '+44 7700 900123');
    expect(launched, [Uri(scheme: 'tel', path: '08047000001')]);
  });

  testWidgets('quick actions: support WhatsApp, report and share', (tester) async {
    String? copied;
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform, (call) async {
      if (call.method == 'Clipboard.setData') {
        copied = (call.arguments as Map)['text'] as String;
      }
      return null;
    });
    await pumpTag(tester, (_) => null, support: '+91 99999 00000');
    await tapVisible(tester, find.text('Urgent, WhatsApp us'));
    expect(launched.single.host, 'wa.me');
    expect(launched.single.path, '/919999900000');
    expect(launched.single.queryParameters['text'],
        'Urgent: I scanned a ParkTag on vehicle DL ** ** 1234 and need help right away.\nTag: $token');
    await tapVisible(tester, find.text('Report wrong info'));
    expect(tabs.single, contains('/report-tag?tag=$token'));
    await tapVisible(tester, find.text('Share'));
    expect(copied, 'https://app.parktag.me/tag/$token');
    expect(find.text('Link copied.'), findsOneWidget);
    expect(find.text('Your privacy is protected. No personal details shared.'),
        findsOneWidget);

    // With the native channel present, Share opens the system sheet instead.
    String? shared;
    ScanIo.shareText = (text) async => shared = text;
    copied = null;
    await tapVisible(tester, find.text('Share'));
    expect(shared, 'https://app.parktag.me/tag/$token');
    expect(copied, isNull);
  });

  group('activation', () {
    const claimable = {
      'token': token,
      'status': 'assigned',
      'claimable': true,
      'suggestedVehicleType': 'car',
    };

    Future<void> fillToCode(WidgetTester tester) async {
      await tapVisible(tester, find.text('Car')); // nothing is preselected
      await tapVisible(tester, find.text('Next'));
      await tester.enterText(find.byKey(const Key('act-plate')), 'dl 3c ab 1234');
      await tapVisible(tester, find.text('Next'));
      await tester.enterText(find.byKey(const Key('act-name')), 'Asha Rao');
      await tapVisible(tester, find.text('Next'));
      await tester.enterText(find.byKey(const Key('act-phone')), '9876543210');
      await tapVisible(tester, find.text('Send code on WhatsApp'));
      await tester.enterText(find.byType(TextField), '123456');
      await tapVisible(tester, find.text('Activate'));
    }

    testWidgets('a type the sticker cannot fit is refused at the tap',
        (tester) async {
      await pumpTag(tester, (_) => null,
          tag: {...claimable, 'vehicleCategory': 'four_wheeler'});
      await tapVisible(tester, find.text('Bike'));
      expect(find.text("This tag won't fit a Bike"), findsOneWidget);
      expect(find.text('Next'), findsNothing);
      await tapVisible(tester, find.text('Choose another vehicle'));
      await tapVisible(tester, find.text('Truck'));
      await tapVisible(tester, find.text('Next'));
      expect(find.byKey(const Key('act-plate')), findsOneWidget);
    });

    testWidgets('409 mount_type_mismatch shows the server sentence',
        (tester) async {
      const sentence =
          'This is a windscreen sticker, made for cars. A Bike needs an exterior sticker.';
      await pumpTag(tester, (req) {
        if (req.url.path.endsWith('/activate')) {
          return res(409, {'code': 'mount_type_mismatch', 'error': sentence});
        }
        return null;
      }, tag: claimable);
      await fillToCode(tester);
      expect(find.text(sentence), findsOneWidget);
      final send = seen.firstWhere((r) => r.url.path == '/api/auth/send-otp');
      expect(send.headers['X-Firebase-AppCheck'] ?? send.headers['x-firebase-appcheck'],
          'ac-token');
      expect(jsonDecode(send.body), {'identifier': '+919876543210', 'recaptchaToken': ''});
    });

    testWidgets('success stores the cookie and goes home', (tester) async {
      final app = await pumpTag(tester, (req) {
        if (req.url.path.endsWith('/activate')) {
          return res(200, {'ok': true, 'isNewOwner': true},
              {'set-cookie': 'wavetag_session=sess42; Path=/; HttpOnly; Secure'});
        }
        if (req.url.path == '/api/session') {
          return res(200, {'session': {'role': 'owner'}});
        }
        return null;
      }, tag: claimable);
      await fillToCode(tester);
      expect(await app.api.store.readCookie(), 'sess42');
      expect(app.isOwner, isTrue);
      expect(find.text('HOME'), findsOneWidget);
      expect(lastBody('/api/tags/$token/activate'), {
        'displayName': 'Asha Rao',
        'phone': '+919876543210',
        'code': '123456',
        'plateNumber': 'DL3CAB1234',
        'vehicleType': 'car',
      });
      final activate = seen.lastWhere((r) => r.url.path.endsWith('/activate'));
      expect(activate.headers.keys.map((k) => k.toLowerCase()),
          isNot(contains('x-firebase-appcheck')));
    });

    testWidgets('send-otp 500 offers the SMS bridge', (tester) async {
      await pumpTag(tester, (req) {
        if (req.url.path == '/api/auth/send-otp') return res(500, {'error': 'x'});
        return null;
      }, tag: claimable);
      await tapVisible(tester, find.text('Car'));
      await tapVisible(tester, find.text('Next'));
      await tester.enterText(find.byKey(const Key('act-plate')), 'DL3CAB1234');
      await tapVisible(tester, find.text('Next'));
      await tester.enterText(find.byKey(const Key('act-name')), 'Asha Rao');
      await tapVisible(tester, find.text('Next'));
      await tester.enterText(find.byKey(const Key('act-phone')), '9876543210');
      await tapVisible(tester, find.text('Send code on WhatsApp'));
      expect(find.text(whatsappSendFailed), findsOneWidget);
      expect(find.text('Get the code by SMS'), findsOneWidget);
    });
  });

  test('verifyErrorText and normalizePlate', () {
    expect(
        verifyErrorText(ApiError(401, message: 'No match.', extra: {'attemptsRemaining': 1})),
        'No match. 1 attempt left.');
    expect(verifyErrorText(ApiError(423, message: 'Locked.')), 'Locked.');
    expect(normalizePlate(' dl 3c ab 1234 '), 'DL3CAB1234');
    expect(contactReasons.keys,
        ['lights', 'towing', 'parking', 'window', 'suspicious']);
  });
}
