import 'package:app/core/app_state.dart';
import 'package:app/core/models.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('Tag reads the dashboard payload and keeps raw', () {
    final t = Tag.fromJson({
      'id': 'abc',
      'token': 'x' * 20,
      'serial': 'PT-0001',
      'etagId': 'E1',
      'premium': false,
      'freeContactUsed': true,
      'freeContactAllowance': 2,
      'freeContactsLeft': 0,
      'missedContacts': 3,
      'callAccess': {'tier': 'etag-used', 'masking': false},
      'membership': null,
      'extra': 1,
    });
    expect(t.serial, 'PT-0001');
    expect(t.callUsed, isTrue);
    expect(t.isLocked, isTrue);
    expect(t.missedContacts, 3);
    expect(t.callAccess!.tier, 'etag-used');
    expect(t.countdown, isNull);
    expect(t.raw['extra'], 1);
  });

  test('premium tag countdown and trial end', () {
    final t = Tag.fromJson({
      'premium': true,
      'callAccess': {
        'tier': 'premium-trial',
        'masking': true,
        'trialEndsAt': '2027-01-01T00:00:00.000Z',
      },
      'membership': {'state': 'trial', 'daysLeft': 30, 'endsAt': '2027-01-01T00:00:00.000Z'},
    });
    expect(t.isLocked, isFalse);
    expect(t.trialEndsAt, isNotNull);
    expect(t.countdown!.daysLeft, 30);
    expect(t.countdown!.state, 'trial');
  });

  test('ContactRequest drops phone and reads call fields', () {
    final created = DateTime.now().subtract(const Duration(minutes: 5));
    final r = ContactRequest.fromJson({
      'phone': '+919999999999',
      'callDuration': 42,
      'answeredOn': 'backup',
      'createdAt': created.toUtc().toIso8601String(),
    });
    expect(r.raw.containsKey('phone'), isFalse);
    expect(r.callDuration, 42);
    expect(r.answeredOn, 'backup');
    expect(r.inCallbackWindow(10 * 60 * 1000), isTrue);
    expect(r.inCallbackWindow(60 * 1000), isFalse);
    expect(r.inCallbackWindow(0), isFalse);
  });

  test('Dashboard referral', () {
    final d = Dashboard.fromJson({
      'callbackWindowMs': 900000,
      'referral': {
        'code': 'X237XC',
        'discountPaise': 7500,
        'rewardMonths': 2,
        'friends': 1,
        'monthsEarned': 2,
        'monthsWaiting': 0,
      },
    });
    expect(d.callbackWindowMs, 900000);
    expect(d.referral!.link, 'https://app.parktag.me/get?ref=X237XC');
    expect(d.referral!.monthsEarned, 2);
    expect(Referral.fromJson({'code': null}).link, isNull);
  });

  test('vault entitlement and limits', () {
    final e = VaultEntitlement.fromJson({'tier': 'etag', 'maxDocs': 2});
    expect(e.maxDocs, 2);
    final l = VaultLimits.fromJson({
      'maxFileBytes': 5,
      'tiers': {'etag': 2, 'premium': 5, 'subscribed': 10},
    });
    expect(l.tiers['subscribed'], 10);
  });

  test('referral code parsing and expiry', () {
    expect(parseReferralCode(' x237xc '), 'X237XC');
    expect(parseReferralCode('X237X1'), isNull); // 1 is not in the alphabet
    expect(parseReferralCode('ABCDEFG'), isNull);
    expect(parseReferralCode(null), isNull);
    final now = DateTime(2026, 10, 19);
    final fresh = now.subtract(const Duration(days: 1)).millisecondsSinceEpoch;
    final stale = now.subtract(const Duration(days: 8)).millisecondsSinceEpoch;
    expect(referralFromStored('X237XC|$fresh', now), 'X237XC');
    expect(referralFromStored('X237XC|$stale', now), isNull);
    expect(referralFromStored('junk', now), isNull);
    expect(referralFromStored(null, now), isNull);
  });
}
