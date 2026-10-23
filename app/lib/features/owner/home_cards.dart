import '../../core/models.dart';

/// ParkTag's masked-call line, as served in /parktag.vcf (backend app.js).
const parktagCallerNumber = '08047284348';

/// Overview tile filters on the vehicle list (welcome.js applyNbFilter).
enum VehicleFilter { active, premium, free, used }

extension VehicleFilterRule on VehicleFilter {
  String get label => switch (this) {
    VehicleFilter.active => 'Active',
    VehicleFilter.premium => 'Premium',
    VehicleFilter.free => 'Free Calls Left',
    VehicleFilter.used => 'Call Used',
  };

  bool matches(Tag t) => switch (this) {
    VehicleFilter.active => t.status != 'inactive',
    VehicleFilter.premium => t.premium,
    VehicleFilter.free => !t.premium && !t.freeContactUsed,
    VehicleFilter.used => !t.premium && t.freeContactUsed,
  };
}

/// welcome.js vehicleCard pill: Premium, N Free Calls, or Call Used.
String vehiclePill(Tag t) {
  if (t.premium) return 'Premium';
  if (t.freeContactUsed) return 'Call Used';
  final n = t.freeContactsLeft;
  return '$n Free Call${n == 1 ? '' : 's'}';
}

/// welcome.js lockedTagNote, without the purchase line (Play policy).
/// Null while the E-Tag still has its free call, and on premium tags.
String? lockedTagNote(Tag t) {
  if (t.premium || !t.freeContactUsed) return null;
  final missed = t.missedContacts < 0 ? 0 : t.missedContacts;
  if (missed > 0) {
    return '$missed ${missed == 1 ? 'person' : 'people'} tried to call you '
        "and couldn't get through. WhatsApp still reaches you.";
  }
  final many = t.freeContactAllowance > 1;
  return 'Your free ${many ? 'calls have' : 'call has'} been used. '
      'WhatsApp still reaches you.';
}
