// Pure rules for the vehicle cards and the vehicle screen, ported from
// welcome.js (vehicleCard, lockedTagNote, _memLive, _memRow) and
// scanner/app.js (VEHICLE_TYPE_OPTIONS, CATEGORY_MEMBERS, MOUNT_COPY).
// Read-only status only: never a price, a plan or a renewal link.

import '../../core/models.dart';

enum TagPillKind { premium, free, used }

/// The card pill: "Premium", "N Free Call(s)" or "Call Used".
({String label, TagPillKind kind}) tagPill(Tag t) {
  if (t.premium) return (label: 'Premium', kind: TagPillKind.premium);
  if (t.freeContactUsed) return (label: 'Call Used', kind: TagPillKind.used);
  final left = t.raw['freeContactsLeft'] is int ? t.freeContactsLeft : 1;
  return (
    label: '$left Free Call${left == 1 ? '' : 's'}',
    kind: TagPillKind.free,
  );
}

/// A free E-Tag whose free call is spent: show the locked note and the
/// Buy Premium Tag action (a physical sticker, so allowed in the app).
bool trialExpired(Tag t) => !t.premium && t.freeContactUsed && t.id.isNotEmpty;

/// What a locked E-Tag's card says (welcome.js lockedTagNote).
String lockedTagNote(Tag t) {
  final missed = t.missedContacts < 0 ? 0 : t.missedContacts;
  if (missed > 0) {
    return '$missed ${missed == 1 ? 'person' : 'people'} tried to call you '
        "and couldn't get through. Buy a Premium tag to bring Call back. "
        'WhatsApp still reaches you.';
  }
  final many = t.freeContactAllowance > 1;
  return 'Your free ${many ? 'calls have' : 'call has'} been used. Buy a '
      'premium tag to keep Call working. WhatsApp still reaches you.';
}

/// Premium section copy on the vehicle screen (vehicle-detail.js
/// updatePremiumUI).
String premiumCopy(Tag t) {
  if (t.premium) {
    return 'This E-Tag is premium. Call and WhatsApp are always available.';
  }
  if (t.freeContactUsed) {
    return 'Your free masked-call trial has been used. Buy a premium tag to '
        'keep Call working. WhatsApp still reaches you.';
  }
  final n = t.raw['freeContactsLeft'] is int ? t.freeContactsLeft : 1;
  final left = n == 1 ? '1 free call' : '$n free calls';
  return 'This E-Tag has $left left. After that, buy a premium tag to keep '
      'Call working. WhatsApp stays available either way.';
}

/// Vehicle type to the shop's sticker variant (shop/models.dart shopVariants).
/// Truck and bus have no variant of their own, so the shop picks its default.
const _shopVariantFor = {
  'car': 'Car',
  'bike': 'Bike',
  'scooter': 'Scooter',
  'auto_rickshaw': 'Auto',
};

/// In-app shop route that replaces this spent E-Tag with a premium sticker.
String replaceShopPath(Tag t) {
  final variant = _shopVariantFor[t.vehicleType];
  return Uri(
    path: '/shop',
    queryParameters: {'replaceTagId': t.id, 'variant': ?variant},
  ).toString();
}

const _day = Duration(days: 1);

/// The countdown measured live against the server's end instant
/// (welcome.js _memLive). Only the arithmetic moves here.
Membership liveMembership(Membership m, [DateTime? now]) {
  final end = m.endsAt;
  if (end == null) return m;
  final at = now ?? DateTime.now();
  if (!end.isAfter(at)) {
    return Membership.fromJson({'state': 'lapsed', 'daysLeft': 0});
  }
  final ms = end.difference(at).inMilliseconds;
  final daysLeft = (ms / _day.inMilliseconds).ceil().clamp(1, 1 << 30);
  final total = m.totalDays;
  final elapsed = total == null
      ? m.elapsedDays
      : (total - daysLeft).clamp(0, total);
  return Membership.fromJson({
    ...m.raw,
    'daysLeft': daysLeft,
    'elapsedDays': elapsed,
  });
}

/// Big figure: "Expired", "Active", "Last day" or "N days left".
String membershipFigure(Membership m) {
  if (m.state == 'lapsed') return 'Expired';
  final d = m.daysLeft;
  if (m.state == 'open' || d == null) return 'Active';
  if (d <= 0) return 'Last day';
  return '$d ${d == 1 ? 'day' : 'days'} left';
}

/// Elapsed share of the included year, or null when there is no honest bar.
double? membershipProgress(Membership m) {
  final total = m.totalDays;
  final elapsed = m.elapsedDays;
  if (total == null || total <= 0 || elapsed == null) return null;
  return (elapsed / total).clamp(0.0, 1.0);
}

/// Sentence under the figure. In the app nothing renews, so lapsed states the
/// fact alone (welcome.js inAndroidApp branch).
String membershipSub(Membership m, String Function(DateTime) fmt) {
  final on = m.endsAt == null ? null : fmt(m.endsAt!);
  switch (m.state) {
    case 'lapsed':
      return 'Premium has ended on this tag.';
    case 'open':
      return 'Premium, with no end date on this tag.';
    case 'subscribed':
      return on == null ? 'Premium.' : 'Premium until $on.';
  }
  return on == null
      ? '1 year Premium included.'
      : '1 year Premium included, until $on.';
}

/// Picker order for every sticker (scanner/app.js VEHICLE_TYPE_OPTIONS).
const vehicleTypeOptions = <({String type, String label, String category})>[
  (type: 'car', label: 'Car', category: 'four_wheeler'),
  (type: 'bike', label: 'Bike', category: 'two_wheeler'),
  (type: 'truck', label: 'Truck', category: 'four_wheeler'),
  (type: 'bus', label: 'Bus', category: 'four_wheeler'),
  (type: 'auto_rickshaw', label: 'Auto', category: 'four_wheeler'),
  (type: 'scooter', label: 'Scooter', category: 'two_wheeler'),
];

const _mountCopy = {
  'four_wheeler': (
    sticker: 'windscreen tag',
    fits: 'the inside of a car, auto, truck or bus windscreen',
    needs: 'an exterior tag',
  ),
  'two_wheeler': (
    sticker: 'exterior tag',
    fits: 'the body of a bike or scooter',
    needs: 'a windscreen tag',
  ),
};

/// Null when [type] fits a sticker of [category] (null category fits all),
/// else the refusal title and text shown before any submit.
({String title, String text})? mountMismatch(String? category, String type) {
  if (category == null) return null;
  final members = [
    for (final o in vehicleTypeOptions)
      if (o.category == category) o.type,
  ];
  if (members.isEmpty || members.contains(type)) return null;
  final label = vehicleTypeOptions
      .firstWhere(
        (o) => o.type == type,
        orElse: () => (type: type, label: 'vehicle', category: ''),
      )
      .label;
  final copy = _mountCopy[category];
  return (
    title: "This tag won't fit a $label",
    text: copy == null
        ? ''
        : 'This is ${'aeiou'.contains(copy.sticker[0]) ? 'an' : 'a'} '
              '${copy.sticker}, made for ${copy.fits}. '
              'A $label needs ${copy.needs}.',
  );
}
