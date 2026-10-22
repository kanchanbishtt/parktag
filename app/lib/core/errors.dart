import 'api.dart';

/// What a call screen should do with a failed call request.
class CallErrorResult {
  const CallErrorResult(this.message,
      {this.backToVerify = false, this.hideCall = false, this.showProfile = false});

  final String message;

  /// The grant is gone: return to the verify gate.
  final bool backToVerify;

  /// Calls are off for this tag: hide the call tile.
  final bool hideCall;

  /// Owner callback: offer a button to `/more/profile`.
  final bool showProfile;
}

const _sendWhatsapp = 'Send a WhatsApp alert instead.';

/// Scanner `register-call`. Server text for 402 is never shown: it mentions subscribing.
CallErrorResult mapCallError(ApiError e) {
  switch (e.status) {
    case 403:
      return CallErrorResult(e.message, backToVerify: true);
    case 402:
      return const CallErrorResult('Calls are off for this tag. $_sendWhatsapp',
          hideCall: true);
    case 422:
      return const CallErrorResult(
          'The owner cannot take calls. $_sendWhatsapp', hideCall: true);
    case 503:
      return const CallErrorResult(
          'Calling is unavailable right now. $_sendWhatsapp');
    case 410:
      return const CallErrorResult('Calling is unavailable right now. Try again.');
    default:
      return CallErrorResult(e.message);
  }
}

/// Owner Call back on the newest activity row. Server text for 402 and 410
/// says "Subscribe" or "Upgrade", so it is never shown and nothing offers a purchase.
CallErrorResult mapOwnerCallbackError(ApiError e) {
  switch (e.code) {
    case 'NO_PHONE':
      return const CallErrorResult('Add your mobile number in Profile',
          showProfile: true);
    case 'PREMIUM_REQUIRED':
      return const CallErrorResult('Call back is not available for this vehicle.');
    case 'CALL_SUBSCRIPTION_REQUIRED':
      return const CallErrorResult('Call service ended for this vehicle.');
    case 'CALLBACK_WINDOW_EXPIRED':
      return const CallErrorResult('The callback window has passed.');
    case 'CALLBACK_NOT_LATEST':
      return const CallErrorResult('Only your latest alert can be called back.');
  }
  if (e.status == 402 || e.status == 410) {
    return const CallErrorResult('Call back is not available right now.');
  }
  if (e.status == 503) {
    return const CallErrorResult('Calling is unavailable right now. Try again.');
  }
  return CallErrorResult(e.message);
}
