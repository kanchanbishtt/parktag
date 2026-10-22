import 'package:firebase_app_check/firebase_app_check.dart';
import 'package:google_sign_in/google_sign_in.dart';

import '../../core/api.dart';
import '../../core/app_state.dart';
import '../../push/push.dart';

/// The web sign-in page the bridge opens (`pt_app=android` is appended there).
const bridgeLoginUrl = 'https://app.parktag.me/owner-login';

const notOwnerError = 'Sign-in did not complete. Try again.';

/// Password reset stays on the web (email link flow).
const forgotPasswordUrl = 'https://app.parktag.me/forgot-password';

/// Where a brand new account lands after sign-in (web /register-owner).
const addVehiclesPath = '/add-vehicles';

/// A limited-use App Check token, or null when App Check is unavailable
/// (no Play Integrity, debug build against production). Without one the
/// server falls back to reCAPTCHA and answers 400, which opens the bridge.
typedef AppCheckTokenFn = Future<String?> Function();

/// A Google ID token for [serverClientId], or null when the user cancelled.
typedef GoogleIdTokenFn = Future<String?> Function(String serverClientId);

Future<String?> defaultAppCheckToken() async {
  try {
    return await FirebaseAppCheck.instance.getLimitedUseToken();
  } catch (_) {
    return null;
  }
}

Future<void>? _googleInit;

Future<String?> defaultGoogleIdToken(String serverClientId) async {
  final google = GoogleSignIn.instance;
  try {
    await (_googleInit ??= google.initialize(serverClientId: serverClientId));
  } catch (_) {
    _googleInit = null;
    rethrow;
  }
  try {
    final account = await google.authenticate();
    return account.authentication.idToken;
  } on GoogleSignInException catch (e) {
    if (e.code == GoogleSignInExceptionCode.canceled ||
        e.code == GoogleSignInExceptionCode.interrupted) {
      return null;
    }
    rethrow;
  }
}

/// `+91XXXXXXXXXX` from a typed Indian mobile number, or null when it is not one.
/// Accepts spaces, dashes and a leading +91, 91 or 0.
String? normalizeMobile(String raw) {
  var digits = raw.replaceAll(RegExp(r'[\s\-()]'), '');
  if (digits.startsWith('+91')) {
    digits = digits.substring(3);
  } else if (digits.length == 12 && digits.startsWith('91')) {
    digits = digits.substring(2);
  } else if (digits.length == 11 && digits.startsWith('0')) {
    digits = digits.substring(1);
  }
  return RegExp(r'^[6-9]\d{9}$').hasMatch(digits) ? '+91$digits' : null;
}

final _emailRe = RegExp(r'^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$');

/// The trimmed email, or null when it does not look like one (login.js
/// detectIdentifierType).
String? normalizeEmail(String raw) {
  final v = raw.trim();
  return _emailRe.hasMatch(v) ? v : null;
}

/// Email or `+91` mobile for `/api/auth/login`; an `@` decides which.
String? normalizeIdentifier(String raw) =>
    raw.contains('@') ? normalizeEmail(raw) : normalizeMobile(raw);

/// Server text plus the wait, for a 429 that carries retry-after.
String errorText(ApiError e) {
  final wait = e.retryAfter;
  if (e.status != 429 || wait == null) return e.message;
  final m = wait.inMinutes;
  final s = (wait.inSeconds % 60).toString().padLeft(2, '0');
  return '${e.message} Wait $m:$s.';
}

/// Local copy for `POST /api/auth/google/credential` failures. The server
/// sends bare codes such as `no_account`, never user-facing text.
String googleErrorText(ApiError e) {
  if (e.isNetwork) return offlineError;
  switch (e.message) {
    case 'no_account':
      return 'No ParkTag account for this Google email. Use your mobile number.';
    case 'email_unverified':
      return 'Your Google email is not verified. Use your mobile number.';
  }
  if (e.status == 429) return errorText(e);
  return 'Google sign-in failed. Try again.';
}

/// After any sign-in: the session must be an owner, then refresh, then push.
/// Returns false when the server did not confirm an owner session.
Future<bool> finishSignIn(AppState app) async {
  await app.loadSession();
  if (!app.isOwner) return false;
  try {
    await app.refresh();
  } catch (_) {
    // Home shows its own error and retry.
  }
  try {
    await Push.register();
  } catch (_) {
    // Best effort; the next launch registers again.
  }
  return true;
}
