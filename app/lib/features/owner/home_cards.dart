import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/api.dart';
import '../../core/app_state.dart';
import '../../core/models.dart';
import '../../core/theme.dart';
import 'activity_row.dart';
import 'activity_rules.dart';
import 'owner_common.dart';

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

/// Home bell with the count of contacts in the last hour.
class ActivityBell extends StatelessWidget {
  const ActivityBell({super.key});

  @override
  Widget build(BuildContext context) => ActivityTicker(
    builder: (context, view) {
      final n = view.hotCount;
      return IconButton(
        tooltip: n > 0 ? 'Activity, $n new' : 'Activity',
        color: Colors.white,
        icon: Badge(
          isLabelVisible: n > 0,
          label: Text('$n'),
          child: const Icon(Icons.notifications_none),
        ),
        onPressed: () => context.push('/activity'),
      );
    },
  );
}

/// welcome.js #callbackPrompt: the contact to ring back now, with the time
/// left on the free window. Falls back to the latest recent row.
class CallbackPrompt extends StatelessWidget {
  const CallbackPrompt({super.key});

  @override
  Widget build(BuildContext context) => ActivityTicker(
    every: const Duration(seconds: 15),
    builder: (context, view) {
      final subject = view.promptSubject;
      if (subject == null) {
        if (view.recent.isEmpty) return const SizedBox.shrink();
        return Padding(
          padding: const EdgeInsets.only(bottom: 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const HomeHeading('Latest alert'),
              ActivityRow(request: view.recent.first, view: view),
            ],
          ),
        );
      }
      final left = subject == view.target
          ? timeLeft(view.callbackDeadline(subject), view.now)
          : 'Free ${view.windowMs ~/ 60000} min over';
      return Padding(
        padding: const EdgeInsets.only(bottom: 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                const Icon(Icons.circle, size: 10, color: PtColors.accent),
                const SizedBox(width: 8),
                const Expanded(
                  child: Text(
                    'Someone wants you to call back',
                    style: TextStyle(fontWeight: FontWeight.w800),
                  ),
                ),
                Text(
                  left,
                  style: const TextStyle(
                    color: PtColors.accent,
                    fontWeight: FontWeight.w700,
                    fontSize: 12,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            ActivityRow(request: subject, view: view, highlighted: true),
          ],
        ),
      );
    },
  );
}

/// welcome.js mobile-missing-alert and the backup number badge.
List<Widget> setupNudges(BuildContext context, AppState app) {
  final owner = app.owner;
  if (owner == null) return const [];
  final declined = owner.raw['backupDeclined'];
  final firstTag = app.tags.isEmpty ? null : app.tags.first;
  return [
    if ((owner.mobile ?? '').isEmpty)
      _Nudge(
        title: 'Add your mobile number to receive call-backs',
        body: "Scanners can't call you back until you register a number.",
        onTap: () => context.push('/more/profile'),
      ),
    // The backup number is edited on a vehicle's page.
    if ((owner.backupMobile ?? '').isEmpty && firstTag != null)
      _Nudge(
        title: 'Add a backup number',
        body: declined is String && declined.isNotEmpty
            ? '$declined asked not to be your backup. Please add a '
                  'different number.'
            : 'It rings when a masked call to you goes unanswered.',
        onTap: () => context.push('/tags/${firstTag.id}'),
      ),
  ];
}

class _Nudge extends StatelessWidget {
  const _Nudge({required this.title, required this.body, required this.onTap});

  final String title;
  final String body;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Card(
    color: const Color(0xFFFFFBEB),
    margin: const EdgeInsets.only(bottom: 10),
    child: ListTile(
      leading: const Icon(Icons.info_outline, color: Color(0xFFD97706)),
      title: Text(
        title,
        style: const TextStyle(
          fontWeight: FontWeight.w700,
          color: Color(0xFF92400E),
        ),
      ),
      subtitle: Text(body, style: const TextStyle(color: Color(0xFFB45309))),
      trailing: const Icon(Icons.chevron_right),
      onTap: onTap,
    ),
  );
}

/// welcome.js .pt-ov-save: hands /parktag.vcf to the OS contact screen.
class SaveNumberCard extends StatelessWidget {
  const SaveNumberCard({super.key});

  @override
  Widget build(BuildContext context) => Card(
    margin: const EdgeInsets.only(bottom: 10),
    child: Padding(
      padding: const EdgeInsets.all(14),
      child: Row(
        children: [
          const Icon(Icons.contact_phone_outlined, color: PtColors.accent),
          const SizedBox(width: 12),
          const Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Calls about your vehicle come from this number. '
                  'Save it so you never miss one.',
                ),
                SizedBox(height: 2),
                Text(
                  parktagCallerNumber,
                  style: TextStyle(fontWeight: FontWeight.w800),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          OutlinedButton(
            style: OutlinedButton.styleFrom(minimumSize: const Size(64, 40)),
            onPressed: () => ownerLaunch(Uri.parse('$apiBase/parktag.vcf')),
            child: const Text('Add'),
          ),
        ],
      ),
    ),
  );
}

class HomeHeading extends StatelessWidget {
  const HomeHeading(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: Text(
      text,
      style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
    ),
  );
}

/// A vehicle on Home: pill, coverage line and the locked E-Tag note.
class VehicleTile extends StatelessWidget {
  const VehicleTile(this.tag, {super.key});

  final Tag tag;

  @override
  Widget build(BuildContext context) {
    final note = lockedTagNote(tag);
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: InkWell(
        borderRadius: BorderRadius.circular(PtRadii.r14),
        onTap: () => context.push('/tags/${tag.id}'),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 8, 12),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      tagTitle(tag),
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      coverageLine(tag),
                      style: const TextStyle(color: PtColors.muted),
                    ),
                    if (note != null) ...[
                      const SizedBox(height: 6),
                      Text(
                        note,
                        style: const TextStyle(
                          color: PtColors.amberDeep,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: tag.premium
                      ? const Color(0xFFFEF3C7)
                      : tag.freeContactUsed
                      ? const Color(0xFFFEE2E2)
                      : const Color(0xFFDBEAFE),
                  borderRadius: BorderRadius.circular(PtRadii.pill),
                ),
                child: Text(
                  vehiclePill(tag),
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              const Icon(Icons.chevron_right),
            ],
          ),
        ),
      ),
    );
  }
}
