import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/models.dart';
import '../../core/theme.dart';
import '../owner/owner_common.dart' show ownerLaunch, showSnack;
import '../shop/models.dart' show formatRupees;

// Ported from welcome.js renderReferral / renderReferralEarned. Every figure
// comes from the dashboard `referral` block, never a literal here.

/// The web hides the card without a code, a discount or a reward.
bool referralShown(Referral? r) =>
    r != null && r.code != null && r.discountPaise > 0 && r.rewardMonths >= 1;

String referralTitle(Referral r) {
  final m = r.rewardMonths;
  return 'Give ${formatRupees(r.discountPaise)}, get '
      '${m == 1 ? 'a free month' : '$m free months'}';
}

String referralSub(Referral r) {
  final off = formatRupees(r.discountPaise);
  final m = r.rewardMonths;
  return 'Your friend gets $off off when they pay online. You get $m '
      '${m == 1 ? 'month' : 'months'} of Premium for each friend who buys.';
}

String _plural(int n, String one, String many) => '$n ${n == 1 ? one : many}';

/// Empty until a friend has actually bought.
String referralEarned(Referral r) {
  final friends = r.friends < 0 ? 0 : r.friends;
  final parts = <String>[];
  if (r.monthsEarned > 0) {
    final who = friends > 0
        ? '${_plural(friends, 'friend has', 'friends have')} bought with your link. '
        : '';
    parts.add('${who}You have earned ${_plural(r.monthsEarned, 'month', 'months')} of Premium.');
  }
  if (r.monthsWaiting > 0) {
    parts.add('${_plural(r.monthsWaiting, 'month is', 'months are')} waiting, '
        'and will be added as soon as you have a Premium tag.');
  }
  return parts.join(' ');
}

String referralMessage(Referral r) =>
    'I use ParkTag on my car: anyone who needs to reach me scans the QR and I '
    'get a masked call or WhatsApp, my number stays private. Get '
    '${formatRupees(r.discountPaise)} off with my link: ${r.link}';

/// Refer a friend card. Renders nothing when [referralShown] is false.
class ReferralCard extends StatelessWidget {
  const ReferralCard(this.referral, {super.key});

  final Referral? referral;

  @override
  Widget build(BuildContext context) {
    final r = referral;
    if (r == null || !referralShown(r)) return const SizedBox.shrink();
    final link = r.link!;
    final earned = referralEarned(r);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(referralTitle(r),
                style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
            const SizedBox(height: 4),
            Text(referralSub(r), style: const TextStyle(color: PtColors.muted)),
            if (earned.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(earned,
                  style: const TextStyle(
                      color: PtColors.success, fontWeight: FontWeight.w600)),
            ],
            const SizedBox(height: 12),
            SelectableText(link.replaceFirst(RegExp(r'^https?://'), ''),
                style: const TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: FilledButton.icon(
                    style: FilledButton.styleFrom(
                        backgroundColor: PtColors.whatsappDark),
                    icon: const Icon(Icons.share),
                    label: const Text('Share'),
                    onPressed: () => ownerLaunch(Uri.parse(
                        'https://wa.me/?text=${Uri.encodeComponent(referralMessage(r))}')),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: OutlinedButton.icon(
                    icon: const Icon(Icons.copy),
                    label: const Text('Copy link'),
                    onPressed: () async {
                      await Clipboard.setData(ClipboardData(text: link));
                      if (context.mounted) showSnack(context, 'Link copied');
                    },
                  ),
                ),
              ],
            ),
            if (r.prepaidOnly) ...[
              const SizedBox(height: 8),
              const Text('Online payment only',
                  style: TextStyle(color: PtColors.muted, fontSize: 12)),
            ],
          ],
        ),
      ),
    );
  }
}
