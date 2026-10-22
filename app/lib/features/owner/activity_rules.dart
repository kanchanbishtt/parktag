// Activity rules ported from the web owner dashboard:
// src/frontend/scripts/owner/callback-eligibility.js (callbackState) and
// welcome.js renderActivity. The server (dashboard.js register-call) is the
// authority; these only decide which controls and labels appear.

import '../../core/models.dart';

/// The clock for activity screens. Tests swap it.
DateTime Function() activityNow = DateTime.now;

const recentWindow = Duration(hours: 1);
const historyWindow = Duration(hours: 48);
const _defaultCallbackWindowMs = 48 * 60 * 60 * 1000;
const maxVisibleRows = 20;

enum CallbackState {
  callable,
  needsPayment,
  needsPremium,
  needsSubscription,
  notCallable,
}

/// Is a callback the owner bought (on the web) for this row still running?
bool hasLivePass(ContactRequest r, DateTime now) {
  final ends = r.callbackPassExpiresAt;
  return ends != null && now.isBefore(ends);
}

/// Port of callbackState() in callback-eligibility.js.
CallbackState callbackState(
  ContactRequest r, {
  required List<Tag> tags,
  required DateTime now,
  required int windowMs,
  int passMaxAgeMs = 0,
}) {
  if (!r.hasPhone) return CallbackState.notCallable;
  if (r.callOutcome == 'answered') return CallbackState.notCallable;
  if (hasLivePass(r, now)) return CallbackState.callable;
  final at = r.createdAt;
  if (at == null) return CallbackState.notCallable;
  final age = now.difference(at).inMilliseconds;

  Tag? tag;
  for (final t in tags) {
    if (t.token == r.token) {
      tag = t;
      break;
    }
  }
  final access = tag?.callAccess;

  if (age > windowMs) {
    final premiumRunning = access != null && access.premium && access.masking;
    return premiumRunning && age <= passMaxAgeMs
        ? CallbackState.needsPayment
        : CallbackState.notCallable;
  }
  if (tag == null) return CallbackState.needsPremium;
  if (access != null) {
    if (access.premium) {
      return access.masking
          ? CallbackState.callable
          : CallbackState.needsSubscription;
    }
    return CallbackState.needsPremium;
  }
  return tag.premium ? CallbackState.callable : CallbackState.needsPremium;
}

/// What one row shows in its action slot. Never a price or a purchase link.
enum RowCta {
  none,
  callBack,
  addPhone,
  premiumNeeded,
  renewNeeded,
  freeTimeUsed,
}

/// Everything renderActivity derives from the dashboard at one instant.
class ActivityView {
  ActivityView(
    Dashboard? dash,
    this.tags,
    List<ContactRequest> all,
    this.now, {
    required this.ownerHasMobile,
  }) : windowMs = (dash?.callbackWindowMs ?? 0) > 0
           ? dash!.callbackWindowMs
           : _defaultCallbackWindowMs,
       hasAny = all.isNotEmpty,
       // The horizon only counts when the server published a price, as on
       // the web; the app never shows that price.
       passMaxAgeMs = _passPaise(dash) > 0 ? dash!.callbackPassMaxAgeMs : 0,
       recent = [
         for (final r in all)
           if (r.createdAt != null &&
               now.difference(r.createdAt!) <= historyWindow)
             r,
       ] {
    target = _firstWhere(recent, (r) => stateOf(r) == CallbackState.callable);
    final seen = <String>{};
    for (final r in recent) {
      if (!r.hasPhone || r.callOutcome == 'answered' || !seen.add(r.token)) {
        continue;
      }
      if (stateOf(r) == CallbackState.needsPayment) payTargets[r.token] = r;
    }
  }

  final List<Tag> tags;
  final DateTime now;
  final bool ownerHasMobile;

  /// Any rows at all, before the 48 hour filter.
  final bool hasAny;
  final int windowMs;
  final int passMaxAgeMs;

  /// Rows from the last 48 hours, newest first (server order).
  final List<ContactRequest> recent;

  /// The one row offered a free callback: the newest callable one.
  late final ContactRequest? target;
  final payTargets = <String, ContactRequest>{};

  static int _passPaise(Dashboard? d) {
    final v = d?.raw['callbackPassPaise'];
    return v is num ? v.toInt() : 0;
  }

  CallbackState stateOf(ContactRequest r) => callbackState(
    r,
    tags: tags,
    now: now,
    windowMs: windowMs,
    passMaxAgeMs: passMaxAgeMs,
  );

  bool canCallBack(ContactRequest r) =>
      stateOf(r) == CallbackState.callable &&
      (r.id == target?.id || hasLivePass(r, now));

  RowCta ctaFor(ContactRequest r) {
    final s = stateOf(r);
    if (s == CallbackState.needsPremium) return RowCta.premiumNeeded;
    if (s == CallbackState.needsPayment && payTargets[r.token] == r) {
      return ownerHasMobile ? RowCta.freeTimeUsed : RowCta.addPhone;
    }
    if (s == CallbackState.needsSubscription) return RowCta.renewNeeded;
    if (canCallBack(r)) {
      return ownerHasMobile ? RowCta.callBack : RowCta.addPhone;
    }
    return RowCta.none;
  }

  /// Contacts in the last hour: the bell badge.
  int get hotCount =>
      recent.where((r) => now.difference(r.createdAt!) <= recentWindow).length;

  /// The banner's contact: the free callback target, else the newest paid
  /// offer still inside the hour.
  ContactRequest? get promptSubject =>
      target ??
      _firstWhere(
        payTargets.values,
        (r) => now.difference(r.createdAt!) <= recentWindow,
      );

  /// When the free callback on [r] ends.
  DateTime callbackDeadline(ContactRequest r) => hasLivePass(r, now)
      ? r.callbackPassExpiresAt!
      : r.createdAt!.add(Duration(milliseconds: windowMs));

  /// Every moment a control changes by itself (scheduleCallbackExpiry).
  DateTime? get nextDeadline {
    DateTime? next;
    void consider(DateTime d) {
      if (d.isAfter(now) && (next == null || d.isBefore(next!))) next = d;
    }

    for (final r in recent) {
      final at = r.createdAt!;
      consider(at.add(Duration(milliseconds: windowMs)));
      consider(at.add(recentWindow));
      consider(at.add(Duration(milliseconds: passMaxAgeMs)));
      consider(at.add(historyWindow));
      if (hasLivePass(r, now)) consider(r.callbackPassExpiresAt!);
    }
    return next;
  }
}

T? _firstWhere<T>(Iterable<T> items, bool Function(T) test) {
  for (final i in items) {
    if (test(i)) return i;
  }
  return null;
}

/// welcome.js formatTimeAgo.
String timeAgo(Duration d) {
  final s = d.inSeconds;
  if (s < 60) return 'just now';
  final m = s ~/ 60;
  if (m < 60) return '$m min ago';
  final h = m ~/ 60;
  if (h < 24) return '${h}h ago';
  return '${h ~/ 24}d ago';
}

/// welcome.js callbackTimeLeft, rounded up.
String timeLeft(DateTime deadline, DateTime now) {
  final ms = deadline.difference(now).inMilliseconds;
  if (ms <= 0) return '';
  if (ms < 60000) return 'less than a minute left';
  return '${(ms / 60000).ceil()} min left';
}

/// welcome.js formatCallDuration: "" for no talk time.
String callDurationLabel(int? seconds) {
  if (seconds == null || seconds <= 0) return '';
  if (seconds < 60) return '${seconds}s';
  final m = seconds ~/ 60;
  final s = seconds % 60;
  return s == 0 ? '${m}m' : '${m}m ${s}s';
}

/// The outcome badge text for a row, or null. Calls read callOutcome and
/// answeredOn; WhatsApp rows read their delivery status.
String? outcomeLabel(ContactRequest r) {
  if (r.action == 'call') {
    return switch (r.callOutcome) {
      null => null,
      'answered' =>
        r.answeredOn == 'backup' ? 'Answered on backup' : 'Answered',
      'missed' => 'Missed',
      _ => 'Failed',
    };
  }
  return switch (r.status) {
    null || '' => null,
    'delivered' => 'Delivered',
    'pending' => 'Pending',
    final s => s[0].toUpperCase() + s.substring(1),
  };
}
