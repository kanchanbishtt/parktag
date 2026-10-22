import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../push/push.dart';
import 'api.dart';
import 'platform.dart';

/// Keystore-backed storage for the session cookie and the onboarding flag.
class SessionStore {
  SessionStore([FlutterSecureStorage? storage])
      : _storage = storage ?? const FlutterSecureStorage();

  static const _cookieKey = 'wavetag_session';
  static const _onboardedKey = 'onboarded';
  static const _referralKey = 'pt_ref';

  final FlutterSecureStorage _storage;

  Future<String?> readCookie() => _storage.read(key: _cookieKey);
  Future<void> writeCookie(String value) =>
      _storage.write(key: _cookieKey, value: value);
  Future<void> clearCookie() => _storage.delete(key: _cookieKey);

  Future<bool> isOnboarded() async =>
      await _storage.read(key: _onboardedKey) == '1';
  Future<void> setOnboarded() => _storage.write(key: _onboardedKey, value: '1');

  /// Pending referral as `CODE|epochMillis` (see AppState.pendingReferralCode).
  Future<String?> readReferral() => _storage.read(key: _referralKey);
  Future<void> writeReferral(String value) =>
      _storage.write(key: _referralKey, value: value);
  Future<void> clearReferral() => _storage.delete(key: _referralKey);

  /// Removes everything except the onboarding flag, so a signed-out user is
  /// not walked through the intro again.
  Future<void> wipe() async {
    final onboarded = await isOnboarded();
    await _storage.deleteAll();
    if (onboarded) await setOnboarded();
  }
}

/// Push unregister, then server logout, then the local wipe. Logout must reach
/// the server first: only the server call deletes the session row.
Future<void> signOut(
  ApiClient api, {
  Future<void> Function()? unregisterPush,
  Future<void> Function()? wipeVaultCache,
}) async {
  try {
    await (unregisterPush ?? Push.unregister)();
  } catch (_) {
    // Best effort; the server also prunes tokens by session on logout.
  }
  try {
    await api.post('/api/auth/logout');
  } on ApiError catch (e) {
    if (kDebugMode) debugPrint('logout failed: ${e.status}');
  }
  await api.store.wipe();
  api.forgetCookie();
  try {
    await (wipeVaultCache ?? () => PtPlatform.wipeCache('vault'))();
  } catch (_) {
    // No platform channel (tests, web).
  }
}
