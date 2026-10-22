import '../../core/api.dart';

const lapsedTitle = "Calling isn't available";
const lapsedBody =
    "You can't call this vehicle's owner right now. If it's urgent, the Emergency button still works.";
const trialUsedNote =
    'This owner has already used their free masked-call trial, so Private Call is off. You can still notify them over WhatsApp.';
const pausedNote =
    'The owner has paused calls for this tag, so Private Call is off. You can still notify them over WhatsApp.';

const _lapsedCode = 'CALL_SUBSCRIPTION_REQUIRED';
const _freeUsedCode = 'FREE_USED';

/// Which contact routes are open. Port of setContactAvailability and
/// applyCallBlocked (scanner/app.js):
/// - lapsed subscription: tiles hidden, the "Calling isn't available" panel,
///   Emergency keeps its call;
/// - free trial used: tiles up, Private Call off with a note, Emergency goes
///   to the helplines;
/// - owner paused calls: Private Call off with its own note.
class CallState {
  CallState({
    required this.available,
    required this.blockedCode,
    required this.messageAlwaysOn,
    required this.paused,
    required bool emergency,
  }) : emergencyOn = emergency && (available || blockedCode == _lapsedCode);

  factory CallState.fromVerify(
    Map<String, dynamic> tag,
    Map<String, dynamic> verified,
  ) {
    final code = verified['contactBlockedCode'];
    return CallState(
      available: verified['contactAvailable'] != false && code == null,
      blockedCode: code is String ? code : null,
      messageAlwaysOn: verified['messageAlwaysOn'] != false,
      paused: verified['callsPaused'] == true || tag['callsPaused'] == true,
      emergency: tag['emergencyAvailable'] == true,
    );
  }

  bool available;
  String? blockedCode;
  final bool messageAlwaysOn;
  bool paused;

  /// Whether Emergency rings the owner's contact. Otherwise it leads to the
  /// public helplines; the button itself is always shown.
  bool emergencyOn;

  /// register-call answered 402 FREE_USED after verify.
  bool trialUsed = false;

  /// The owner has no phone on file: every retry would get the same answer.
  bool ownerNoPhone = false;
  String? noPhoneText;

  bool get lapsed => !available && blockedCode == _lapsedCode;
  bool get freeUsed =>
      trialUsed || (!available && blockedCode == _freeUsedCode);
  bool get hideTiles => !available && blockedCode != _freeUsedCode;
  bool get messageOn => !hideTiles && messageAlwaysOn;
  bool get callOff => freeUsed || paused || ownerNoPhone;

  /// The trial note wins when both apply, being the more permanent state.
  String? get callOffNote => freeUsed
      ? trialUsedNote
      : paused
      ? pausedNote
      : null;

  void lapse() {
    available = false;
    blockedCode = _lapsedCode;
  }

  /// register-call refusals that retire the tile. True when handled here.
  bool applyCallError(ApiError e) {
    if (e.status == 409 && e.code == 'CALLS_PAUSED') {
      paused = true;
      return true;
    }
    if (e.status == 402) {
      e.code == _freeUsedCode ? trialUsed = true : lapse();
      return true;
    }
    if (e.code == 'OWNER_NO_PHONE') {
      ownerNoPhone = true;
      noPhoneText = e.message;
      return true;
    }
    return false;
  }
}
