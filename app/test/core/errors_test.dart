import 'package:app/core/api.dart';
import 'package:app/core/errors.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('register-call map', () {
    expect(mapCallError(ApiError(403, code: 'GRANT_IN_USE')).backToVerify, isTrue);
    expect(mapCallError(ApiError(409, code: 'CALLS_PAUSED', message: 'Paused.')).message,
        'Paused.');
    final paid = mapCallError(ApiError(402,
        code: 'CALL_SUBSCRIPTION_REQUIRED', message: 'Subscribe to call'));
    expect(paid.message, isNot(contains('Subscribe')));
    expect(paid.hideCall, isTrue);
    expect(mapCallError(ApiError(422, code: 'OWNER_NO_PHONE')).message,
        startsWith('The owner cannot take calls.'));
    expect(mapCallError(ApiError(503)).message,
        startsWith('Calling is unavailable right now.'));
  });

  test('owner callback map never shows server 402/410 text', () {
    for (final (status, code) in [
      (402, 'NO_PHONE'),
      (402, 'PREMIUM_REQUIRED'),
      (402, 'CALL_SUBSCRIPTION_REQUIRED'),
      (410, 'CALLBACK_WINDOW_EXPIRED'),
      (410, 'CALLBACK_NOT_LATEST'),
      (402, null),
      (410, null),
    ]) {
      final r = mapOwnerCallbackError(
          ApiError(status, code: code, message: 'Subscribe or Upgrade now'));
      expect(r.message, isNot(contains('Subscribe')));
      expect(r.message, isNot(contains('Upgrade')));
    }
    expect(mapOwnerCallbackError(ApiError(402, code: 'NO_PHONE')).showProfile, isTrue);
  });
}
