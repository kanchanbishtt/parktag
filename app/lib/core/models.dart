// Thin views over the `/api/owner/dashboard` payload
// (src/backend/routes/owner/dashboard.js). Every model keeps its source JSON
// in `raw`; fields used across features are typed.

String? _str(Object? v) => v is String ? v : null;
int _int(Object? v) => v is num ? v.toInt() : 0;
int? _intOrNull(Object? v) => v is num ? v.toInt() : null;
Map<String, dynamic>? _map(Object? v) => v is Map<String, dynamic> ? v : null;
DateTime? _date(Object? v) => v is String ? DateTime.tryParse(v)?.toLocal() : null;

class Owner {
  Owner.fromJson(Map<String, dynamic> j)
      : displayName = _str(j['displayName']) ?? '',
        greetingName = _str(j['greetingName']) ?? _str(j['displayName']) ?? '',
        email = _str(j['email']),
        mobile = _str(j['mobile']),
        backupMobile = _str(j['backupMobile']),
        credits = _int(j['credits']),
        profile = _map(j['profile']) ?? const {},
        raw = j;

  final String displayName;
  final String greetingName;
  final String? email;
  final String? mobile;
  final String? backupMobile;
  final int credits;
  final Map<String, dynamic> profile;
  final Map<String, dynamic> raw;
}

/// `tags[].callAccess`: the server's verdict on masked calling (call-access.js).
/// tier: etag-free | etag-used | premium-trial | premium-subscription |
/// premium-lapsed.
class CallAccess {
  CallAccess.fromJson(Map<String, dynamic> j)
      : tier = _str(j['tier']) ?? '',
        masking = j['masking'] == true,
        premium = j['premium'] == true,
        subscribed = j['subscribed'] == true,
        trialEndsAt = _date(j['trialEndsAt']),
        raw = j;

  final String tier;
  final bool masking;
  final bool premium;
  final bool subscribed;
  final DateTime? trialEndsAt;
  final Map<String, dynamic> raw;
}

/// `tags[].membership` (membershipCountdown). Null on an E-Tag.
/// state: open | lapsed | trial | subscribed. Read-only status, never a price.
class Membership {
  Membership.fromJson(Map<String, dynamic> j)
      : state = _str(j['state']) ?? '',
        endsAt = _date(j['endsAt']),
        daysLeft = _intOrNull(j['daysLeft']),
        totalDays = _intOrNull(j['totalDays']),
        elapsedDays = _intOrNull(j['elapsedDays']),
        raw = j;

  final String state;
  final DateTime? endsAt;
  final int? daysLeft;
  final int? totalDays;
  final int? elapsedDays;
  final Map<String, dynamic> raw;
}

class Tag {
  Tag.fromJson(Map<String, dynamic> j)
      : id = _str(j['id']) ?? '',
        token = _str(j['token']) ?? '',
        etagId = _str(j['etagId']),
        serial = _str(j['serial']),
        scanUrl = _str(j['scanUrl']) ?? '',
        qrUrl = _str(j['qrUrl']),
        status = _str(j['status']) ?? '',
        plateNumber = _str(j['plateNumber']),
        vehicleType = _str(j['vehicleType']),
        vehicleLabel = _str(j['vehicleLabel']) ?? 'Vehicle',
        printStatus = _str(j['printStatus']) ?? 'not_requested',
        stickerRequested = j['stickerRequested'] == true,
        purchaseStatus = _str(j['purchaseStatus']) ?? 'none',
        premium = j['premium'] == true,
        callsPaused = j['callsPaused'] == true,
        freeContactUsed = j['freeContactUsed'] == true,
        freeContactAllowance = _int(j['freeContactAllowance']),
        freeContactsLeft = _int(j['freeContactsLeft']),
        missedContacts = _int(j['missedContacts']),
        callAccess = _map(j['callAccess']) == null
            ? null
            : CallAccess.fromJson(_map(j['callAccess'])!),
        membership = _map(j['membership']),
        emergencyContact = _str(j['emergencyContact']),
        raw = j;

  final String id;
  final String token;
  final String? etagId;
  final String? serial;
  final String scanUrl;
  final String? qrUrl;
  final String status;
  final String? plateNumber;
  final String? vehicleType;
  final String vehicleLabel;
  final String printStatus;
  final bool stickerRequested;
  final String purchaseStatus;
  final bool premium;
  final bool callsPaused;

  /// Web calls this `callUsed`: the E-Tag's free contact has been spent.
  final bool freeContactUsed;
  final int freeContactAllowance;
  final int freeContactsLeft;

  /// Scanners who reached this E-Tag after it locked. 0 on premium.
  final int missedContacts;
  final CallAccess? callAccess;
  final Map<String, dynamic>? membership;
  final String? emergencyContact;
  final Map<String, dynamic> raw;

  bool get isActive => status == 'active';
  bool get callUsed => freeContactUsed;

  /// An E-Tag with no free contacts left: scanners can no longer call.
  bool get isLocked => !premium && freeContactsLeft <= 0;
  bool get hasEmergencyContact => (emergencyContact ?? '').isNotEmpty;
  Membership? get countdown =>
      membership == null ? null : Membership.fromJson(membership!);
  DateTime? get trialEndsAt => callAccess?.trialEndsAt;
}

/// A scanner contact. Deliberately has no phone: only the last 4 digits and
/// whether a callback is possible. `raw` is copied without any `phone` key.
class ContactRequest {
  ContactRequest.fromJson(Map<String, dynamic> j)
      : id = _str(j['id']) ?? '',
        token = _str(j['token']) ?? '',
        phoneLast4 = _str(j['phoneLast4']),
        hasPhone = j['hasPhone'] == true,
        action = _str(j['action']),
        messageChannel = _str(j['messageChannel']),
        reason = _str(j['reason']),
        message = _str(j['message']),
        status = _str(j['status']),
        callResult = _str(j['callResult']),
        callOutcome = _str(j['callOutcome']),
        callDuration = _intOrNull(j['callDuration']),
        answeredOn = _str(j['answeredOn']),
        scannerLocationLabel = _str(j['scannerLocationLabel']),
        carLocationMapUrl = _str(j['carLocationMapUrl']),
        createdAt = _date(j['createdAt']),
        updatedAt = _date(j['updatedAt']),
        callbackPassExpiresAt = _date(j['callbackPassExpiresAt']),
        raw = Map.unmodifiable({...j}..remove('phone'));

  final String id;

  /// The tag's scan token. Resolve the tag id via AppState.tagForToken.
  final String token;
  final String? phoneLast4;
  final bool hasPhone;
  final String? action;
  final String? messageChannel;
  final String? reason;
  final String? message;
  final String? status;
  final String? callResult;

  /// answered | missed | failed | null.
  final String? callOutcome;

  /// Seconds, when the provider reported it.
  final int? callDuration;

  /// primary | backup | null: which owner number picked up.
  final String? answeredOn;
  final String? scannerLocationLabel;
  final String? carLocationMapUrl;
  final DateTime? createdAt;
  final DateTime? updatedAt;
  final DateTime? callbackPassExpiresAt;
  final Map<String, dynamic> raw;

  /// Inside the free callback window ([Dashboard.callbackWindowMs]).
  bool inCallbackWindow(int windowMs, [DateTime? now]) {
    final at = createdAt;
    if (at == null || windowMs <= 0) return false;
    return (now ?? DateTime.now()).difference(at).inMilliseconds < windowMs;
  }
}

/// `referral` on the dashboard. `code` is null when one could not be minted.
class Referral {
  Referral.fromJson(Map<String, dynamic> j)
      : code = _str(j['code']),
        discountPaise = _int(j['discountPaise']),
        rewardMonths = _int(j['rewardMonths']),
        prepaidOnly = j['prepaidOnly'] != false,
        friends = _int(j['friends']),
        monthsEarned = _int(j['monthsEarned']),
        monthsWaiting = _int(j['monthsWaiting']),
        raw = j;

  final String? code;
  final int discountPaise;
  final int rewardMonths;
  final bool prepaidOnly;
  final int friends;
  final int monthsEarned;
  final int monthsWaiting;
  final Map<String, dynamic> raw;

  /// Same link the web card shares (welcome.js referralMessage).
  String? get link =>
      code == null ? null : 'https://app.parktag.me/get?ref=$code';
}

/// Top-level dashboard numbers that are not per tag or per request.
class Dashboard {
  Dashboard.fromJson(Map<String, dynamic> j)
      : callbackWindowMs = _int(j['callbackWindowMs']),
        callbackPassMaxAgeMs = _int(j['callbackPassMaxAgeMs']),
        referral = _map(j['referral']) == null
            ? null
            : Referral.fromJson(_map(j['referral'])!),
        raw = j;

  final int callbackWindowMs;
  final int callbackPassMaxAgeMs;
  final Referral? referral;
  final Map<String, dynamic> raw;
}

/// `entitlement` from `/api/owner/vault/status` and `/vault/documents`
/// (documentEntitlement in src/backend/lib/core/vault.js).
class VaultEntitlement {
  VaultEntitlement.fromJson(Map<String, dynamic> j)
      : tier = _str(j['tier']) ?? '',
        maxDocs = _int(j['maxDocs']),
        premium = j['premium'] == true,
        subscribed = j['subscribed'] == true,
        trialEndsAt = _date(j['trialEndsAt']),
        raw = j;

  final String tier;
  final int maxDocs;
  final bool premium;
  final bool subscribed;
  final DateTime? trialEndsAt;
  final Map<String, dynamic> raw;
}

/// `limits` from `/api/owner/vault/status`.
class VaultLimits {
  VaultLimits.fromJson(Map<String, dynamic> j)
      : maxFileBytes = _int(j['maxFileBytes']),
        maxBytesPerOwner = _int(j['maxBytesPerOwner']),
        tiers = {
          for (final e in (_map(j['tiers']) ?? const {}).entries)
            if (e.value is num) e.key: (e.value as num).toInt(),
        },
        raw = j;

  final int maxFileBytes;
  final int maxBytesPerOwner;

  /// Docs per tag by tier: etag, premium, subscribed.
  final Map<String, int> tiers;
  final Map<String, dynamic> raw;
}
