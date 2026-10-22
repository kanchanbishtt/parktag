import 'dart:async';

import 'package:app/core/api.dart';
import 'package:app/features/scan/activation.dart';
import 'package:app/features/scan/call_state.dart';
import 'package:app/features/scan/car_location.dart';
import 'package:app/features/scan/caller_phone.dart';
import 'package:app/features/scan/quick_actions.dart';
import 'package:app/features/scan/scan_io.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('isDialableNumber matches the web rules', () {
    for (final ok in [
      '9876543210',
      '09876543210',
      '919876543210',
      '+919876543210',
      '+44 7700 900123',
      '0044 7700 900123',
      '98765-43210',
    ]) {
      expect(isDialableNumber(ok), isTrue, reason: ok);
    }
    for (final bad in ['', '12345', '5876543210', '+1234567', '91987654321', 'abc']) {
      expect(isDialableNumber(bad), isFalse, reason: bad);
    }
    expect(lastFourDigits('+44 7700 900123'), '0123');
  });

  group('CallState', () {
    CallState from(Map<String, dynamic> v, {bool emergency = true, bool paused = false}) =>
        CallState.fromVerify(
            {'emergencyAvailable': emergency, 'callsPaused': paused}, v);

    test('open tag', () {
      final s = from({'contactAvailable': true, 'messageAlwaysOn': true});
      expect([s.hideTiles, s.lapsed, s.callOff, s.messageOn, s.emergencyOn],
          [false, false, false, true, true]);
      expect(s.callOffNote, isNull);
    });

    test('lapsed hides tiles and keeps the emergency call', () {
      final s = from({
        'contactAvailable': false,
        'contactBlockedCode': 'CALL_SUBSCRIPTION_REQUIRED',
        'messageAlwaysOn': false,
      });
      expect([s.hideTiles, s.lapsed, s.messageOn, s.emergencyOn],
          [true, true, false, true]);
    });

    test('free trial used keeps WhatsApp, turns call and emergency call off', () {
      final s = from({'contactAvailable': false, 'contactBlockedCode': 'FREE_USED'});
      expect([s.hideTiles, s.messageOn, s.callOff, s.emergencyOn],
          [false, true, true, false]);
      expect(s.callOffNote, trialUsedNote);
    });

    test('paused from the tag, trial note wins over paused', () {
      final s = from({'contactAvailable': true}, paused: true);
      expect(s.callOffNote, pausedNote);
      expect(s.applyCallError(ApiError(402, code: 'FREE_USED')), isTrue);
      expect(s.callOffNote, trialUsedNote);
    });

    test('register-call errors', () {
      final s = from({'contactAvailable': true});
      expect(s.applyCallError(ApiError(409, code: 'CALLS_PAUSED')), isTrue);
      expect(s.paused, isTrue);
      expect(s.applyCallError(ApiError(500)), isFalse);
      expect(s.applyCallError(ApiError(402, code: 'CALL_SUBSCRIPTION_REQUIRED')), isTrue);
      expect(s.lapsed, isTrue);
    });
  });

  group('CarLocation', () {
    test('keeps the best fix and stops at 25 m', () async {
      final c = StreamController<CarFix>();
      final loc = CarLocation(source: () => c.stream)..start();
      expect(loc.pending, isTrue);
      c.add(const CarFix(1, 2, 300));
      await Future<void>.delayed(Duration.zero);
      expect(loc.pending, isFalse);
      expect(loc.busy, isTrue);
      c.add(const CarFix(1, 2, 400)); // worse, ignored
      await Future<void>.delayed(Duration.zero);
      expect(loc.best!.accuracy, 300);
      c.add(const CarFix(3, 4, 20));
      await Future<void>.delayed(Duration.zero);
      expect(loc.busy, isFalse);
      expect(loc.json, {'lat': 3, 'lng': 4, 'accuracy': 20});
      expect(loc.title, 'Car location added');
      loc.clear();
      expect(loc.json, isNull);
      await c.close();
      loc.dispose();
    });

    test('denied and no-fix states', () async {
      final loc = CarLocation(
          source: () => Stream<CarFix>.error(const LocationDenied()))
        ..start();
      await Future<void>.delayed(Duration.zero);
      expect(loc.denied, isTrue);
      expect(loc.subtitle, 'Location is off. You can still message or call.');
      loc.dispose();
    });

    testWidgets('ends with the best so far after the window', (tester) async {
      final c = StreamController<CarFix>();
      final loc = CarLocation(source: () => c.stream)..start();
      c.add(const CarFix(1, 2, 80));
      await tester.pump(const Duration(seconds: 1));
      expect(loc.busy, isTrue);
      await tester.pump(fixWindow);
      expect(loc.busy, isFalse);
      expect(loc.best!.accuracy, 80);
      loc.dispose();
    });
  });

  test('urgentSupportLink falls back to the default number', () {
    final uri = urgentSupportLink(token: 'tok', maskedPlate: null, supportWhatsapp: null);
    expect(uri.path, '/$fallbackSupportWhatsapp');
    expect(uri.queryParameters['text'], contains('vehicle unknown plate'));
  });

  test('mountBlock mirrors the server copy', () {
    expect(mountBlock(null, 'bike'), isNull);
    expect(mountBlock('four_wheeler', 'truck'), isNull);
    expect(mountBlock('two_wheeler', 'car'), (
      "This tag won't fit a Car",
      'This is an exterior tag, made for the body of a bike or scooter. A Car needs a windscreen tag.',
    ));
    expect(vehicleTypes.keys,
        ['car', 'bike', 'truck', 'bus', 'auto_rickshaw', 'scooter']);
  });

  testWidgets('withSlowNotice fires only after the threshold', (tester) async {
    var slow = 0;
    final done = Completer<int>();
    final f = withSlowNotice(done.future, () => slow++);
    await tester.pump(const Duration(seconds: 3));
    expect(slow, 0);
    await tester.pump(const Duration(seconds: 1));
    expect(slow, 1);
    done.complete(1);
    expect(await f, 1);
  });
}
