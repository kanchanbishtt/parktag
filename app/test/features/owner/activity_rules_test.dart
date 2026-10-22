import 'package:app/core/models.dart';
import 'package:app/features/owner/activity_rules.dart';
import 'package:app/features/owner/home_cards.dart';
import 'package:flutter_test/flutter_test.dart';

final now = DateTime.utc(2026, 10, 19, 12);
const tenMin = 10 * 60 * 1000;

Tag tag(
  String token, {
  bool premium = false,
  Map<String, dynamic>? access,
  bool used = false,
  int left = 1,
  int missed = 0,
  int allowance = 1,
  String status = 'active',
}) => Tag.fromJson({
  'id': 'id-$token',
  'token': token,
  'status': status,
  'plateNumber': 'PLATE-$token',
  'vehicleLabel': 'Car',
  'premium': premium,
  'freeContactUsed': used,
  'freeContactsLeft': left,
  'freeContactAllowance': allowance,
  'missedContacts': missed,
  'callAccess': access,
});

ContactRequest req(
  String id,
  String token,
  Duration ago, {
  bool hasPhone = true,
  String action = 'call',
  String? outcome,
  String? answeredOn,
  DateTime? passEnds,
  String? status,
}) => ContactRequest.fromJson({
  'id': id,
  'token': token,
  'hasPhone': hasPhone,
  'phoneLast4': hasPhone ? '1234' : null,
  'action': action,
  'callOutcome': outcome,
  'answeredOn': answeredOn,
  'status': status,
  'createdAt': now.subtract(ago).toIso8601String(),
  'callbackPassExpiresAt': passEnds?.toIso8601String(),
});

const premiumOn = {'tier': 'premium-trial', 'premium': true, 'masking': true};
const premiumLapsed = {
  'tier': 'premium-lapsed',
  'premium': true,
  'masking': false,
};
const etagFree = {'tier': 'etag-free', 'premium': false, 'masking': true};

CallbackState state(ContactRequest r, List<Tag> tags, {int passMaxAgeMs = 0}) =>
    callbackState(
      r,
      tags: tags,
      now: now,
      windowMs: tenMin,
      passMaxAgeMs: passMaxAgeMs,
    );

void main() {
  group('callbackState (callback-eligibility.js)', () {
    final p = tag('P', premium: true, access: premiumOn);
    test('no phone or answered is never callable', () {
      expect(
        state(req('a', 'P', const Duration(minutes: 1), hasPhone: false), [p]),
        CallbackState.notCallable,
      );
      expect(
        state(req('a', 'P', const Duration(minutes: 1), outcome: 'answered'), [
          p,
        ]),
        CallbackState.notCallable,
      );
    });

    test('premium with masking inside the window is callable', () {
      expect(
        state(req('a', 'P', const Duration(minutes: 9)), [p]),
        CallbackState.callable,
      );
      // Unknown or missed outcome keeps offering it.
      expect(
        state(req('a', 'P', const Duration(minutes: 1), outcome: 'missed'), [
          p,
        ]),
        CallbackState.callable,
      );
    });

    test('lapsed premium needs a subscription; E-Tag needs premium', () {
      final lapsed = tag('L', premium: true, access: premiumLapsed);
      final e = tag('E', access: etagFree);
      expect(
        state(req('a', 'L', const Duration(minutes: 1)), [lapsed]),
        CallbackState.needsSubscription,
      );
      expect(
        state(req('a', 'E', const Duration(minutes: 1)), [e]),
        CallbackState.needsPremium,
      );
      // A deleted tag reads as needs premium inside the window.
      expect(
        state(req('a', 'gone', const Duration(minutes: 1)), [p]),
        CallbackState.needsPremium,
      );
    });

    test('no callAccess falls back to tag.premium', () {
      expect(
        state(req('a', 'X', const Duration(minutes: 1)), [
          tag('X', premium: true),
        ]),
        CallbackState.callable,
      );
      expect(
        state(req('a', 'Y', const Duration(minutes: 1)), [tag('Y')]),
        CallbackState.needsPremium,
      );
    });

    test('after the window: payment offer only within the horizon', () {
      final old = req('a', 'P', const Duration(minutes: 30));
      expect(state(old, [p]), CallbackState.notCallable);
      expect(
        state(old, [p], passMaxAgeMs: 60 * 60 * 1000),
        CallbackState.needsPayment,
      );
      expect(
        state(old, [tag('E', access: etagFree)], passMaxAgeMs: 3600000),
        CallbackState.notCallable,
      );
    });

    test('a live pass is callable past the window; an expired one is not', () {
      final live = req(
        'a',
        'P',
        const Duration(hours: 2),
        passEnds: now.add(const Duration(minutes: 3)),
      );
      final gone = req(
        'b',
        'P',
        const Duration(hours: 2),
        passEnds: now.subtract(const Duration(seconds: 1)),
      );
      expect(state(live, [p]), CallbackState.callable);
      expect(state(gone, [p]), CallbackState.notCallable);
    });
  });

  group('ActivityView', () {
    final p = tag('P', premium: true, access: premiumOn);
    final e = tag('E', access: etagFree);
    Dashboard dash({int paise = 2000}) => Dashboard.fromJson({
      'callbackWindowMs': tenMin,
      'callbackPassMaxAgeMs': 24 * 3600000,
      'callbackPassPaise': paise,
    });

    test('hides rows older than 48 hours and counts the last hour', () {
      final v = ActivityView(
        dash(),
        [p],
        [
          req('a', 'P', const Duration(minutes: 5)),
          req('b', 'P', const Duration(minutes: 70)),
          req('c', 'P', const Duration(hours: 49)),
        ],
        now,
        ownerHasMobile: true,
      );
      expect(v.recent.map((r) => r.id), ['a', 'b']);
      expect(v.hotCount, 1);
      expect(v.hasAny, isTrue);
    });

    test('only the newest callable row gets Call back', () {
      final v = ActivityView(
        dash(),
        [p, e],
        [
          req('a', 'E', const Duration(minutes: 1)),
          req('b', 'P', const Duration(minutes: 2)),
          req('c', 'P', const Duration(minutes: 3)),
        ],
        now,
        ownerHasMobile: true,
      );
      expect(v.target?.id, 'b');
      expect(v.ctaFor(v.recent[0]), RowCta.premiumNeeded);
      expect(v.ctaFor(v.recent[1]), RowCta.callBack);
      expect(v.ctaFor(v.recent[2]), RowCta.none);
      expect(v.promptSubject?.id, 'b');
      expect(timeLeft(v.callbackDeadline(v.target!), now), '8 min left');
      // Next change is when b's window closes.
      expect(
        v.nextDeadline!.isAtSameMomentAs(now.add(const Duration(minutes: 7))),
        isTrue,
      );
    });

    test('no owner mobile shows Add phone instead of Call back', () {
      final v = ActivityView(
        dash(),
        [p],
        [req('a', 'P', const Duration(minutes: 1))],
        now,
        ownerHasMobile: false,
      );
      expect(v.ctaFor(v.recent.single), RowCta.addPhone);
    });

    test('expired free window: free time used, only when a price exists', () {
      final rows = [
        req('a', 'P', const Duration(minutes: 20)),
        req('b', 'P', const Duration(minutes: 30)),
      ];
      final v = ActivityView(dash(), [p], rows, now, ownerHasMobile: true);
      expect(v.ctaFor(v.recent[0]), RowCta.freeTimeUsed);
      expect(v.ctaFor(v.recent[1]), RowCta.none);
      expect(v.promptSubject?.id, 'a');
      final unpriced = ActivityView(
        dash(paise: 0),
        [p],
        rows,
        now,
        ownerHasMobile: true,
      );
      expect(unpriced.ctaFor(unpriced.recent[0]), RowCta.none);
      expect(unpriced.promptSubject, isNull);
    });

    test('missing callbackWindowMs falls back to 48 hours like the web', () {
      final v = ActivityView(
        Dashboard.fromJson({}),
        [p],
        [req('a', 'P', const Duration(hours: 5))],
        now,
        ownerHasMobile: true,
      );
      expect(v.windowMs, 48 * 3600000);
      expect(v.ctaFor(v.recent.single), RowCta.callBack);
    });
  });

  test('labels: time ago, time left, duration, outcome', () {
    expect(timeAgo(const Duration(seconds: 30)), 'just now');
    expect(timeAgo(const Duration(minutes: 12)), '12 min ago');
    expect(timeAgo(const Duration(hours: 3)), '3h ago');
    expect(timeAgo(const Duration(hours: 50)), '2d ago');
    expect(
      timeLeft(now.add(const Duration(seconds: 40)), now),
      'less than a minute left',
    );
    expect(timeLeft(now.add(const Duration(seconds: 61)), now), '2 min left');
    expect(timeLeft(now, now), '');
    expect(callDurationLabel(0), '');
    expect(callDurationLabel(42), '42s');
    expect(callDurationLabel(120), '2m');
    expect(callDurationLabel(125), '2m 5s');
    final d = const Duration(minutes: 1);
    expect(outcomeLabel(req('a', 'P', d, outcome: 'answered')), 'Answered');
    expect(
      outcomeLabel(req('a', 'P', d, outcome: 'answered', answeredOn: 'backup')),
      'Answered on backup',
    );
    expect(outcomeLabel(req('a', 'P', d, outcome: 'missed')), 'Missed');
    expect(outcomeLabel(req('a', 'P', d, outcome: 'busy')), 'Failed');
    expect(outcomeLabel(req('a', 'P', d)), isNull);
    expect(
      outcomeLabel(req('a', 'P', d, action: 'message', status: 'delivered')),
      'Delivered',
    );
  });

  test('vehicle pill, locked note and overview filters', () {
    final prem = tag('P', premium: true);
    final free = tag('F', left: 2, allowance: 2);
    final used = tag('U', used: true, left: 0, missed: 3);
    final usedQuiet = tag('Q', used: true, left: 0, status: 'inactive');
    expect(vehiclePill(prem), 'Premium');
    expect(vehiclePill(free), '2 Free Calls');
    expect(vehiclePill(used), 'Call Used');
    expect(lockedTagNote(prem), isNull);
    expect(lockedTagNote(free), isNull);
    expect(lockedTagNote(used), startsWith('3 people tried to call you'));
    expect(lockedTagNote(usedQuiet), startsWith('Your free call has been'));
    final all = [prem, free, used, usedQuiet];
    int n(VehicleFilter f) => all.where(f.matches).length;
    expect(n(VehicleFilter.active), 3);
    expect(n(VehicleFilter.premium), 1);
    expect(n(VehicleFilter.free), 1);
    expect(n(VehicleFilter.used), 2);
  });
}
