import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/models.dart';
import '../../core/platform.dart';
import '../../core/theme.dart';
import '../more/support.dart' show supportWhatsApp;
import 'owner_common.dart';
import 'tag_rules.dart';

/// Opens the public tag page in a Custom Tab. Tests swap it.
Future<bool> Function(String url) tagCustomTab = PtPlatform.openCustomTab;

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.children, this.icon});

  final String title;
  final IconData? icon;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                if (icon != null) ...[
                  Icon(icon, color: PtColors.navy, size: 20),
                  const SizedBox(width: 8),
                ],
                Text(
                  title,
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            ...children,
          ],
        ),
      ),
    );
  }
}

/// vehicle-detail.html User Info: plate, type, owner, Tag ID and serial.
class VehicleInfoCard extends StatelessWidget {
  const VehicleInfoCard({super.key, required this.tag, this.owner});

  final Tag tag;
  final Owner? owner;

  @override
  Widget build(BuildContext context) {
    final o = owner;
    final name = o == null
        ? '-'
        : (o.displayName.isNotEmpty ? o.displayName : (o.email ?? '-'));
    final rows = <(String, String)>[
      ('Vehicle number', tag.plateNumber ?? '-'),
      ('Vehicle type', tag.vehicleLabel),
      ('Owner', name),
      ('Mobile', o?.mobile ?? 'Not set'),
      ('Tag ID', tag.token.isEmpty ? '-' : tag.token),
      if ((tag.etagId ?? '').isNotEmpty) ('E-Tag ID', tag.etagId!),
      if ((tag.serial ?? '').isNotEmpty) ('Sticker serial', tag.serial!),
    ];
    return _Section(
      title: 'Vehicle info',
      icon: Icons.info_outline,
      children: [
        for (final (k, v) in rows)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(
                  width: 130,
                  child: Text(k, style: const TextStyle(color: PtColors.muted)),
                ),
                Expanded(
                  child: SelectableText(
                    v,
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

/// Read-only membership countdown for this vehicle. No prices, no renew link.
class MembershipStatusCard extends StatelessWidget {
  const MembershipStatusCard({super.key, required this.tag, this.now});

  final Tag tag;
  final DateTime? now;

  @override
  Widget build(BuildContext context) {
    final c = tag.countdown;
    if (c == null) {
      return const _Section(
        title: 'Membership',
        icon: Icons.workspace_premium_outlined,
        children: [Text('E-Tag. No membership cover.')],
      );
    }
    final m = liveMembership(c, now);
    final progress = membershipProgress(m);
    final lapsed = m.state == 'lapsed';
    return _Section(
      title: 'Membership',
      icon: Icons.workspace_premium_outlined,
      children: [
        Text(
          membershipFigure(m),
          style: TextStyle(
            fontSize: 22,
            fontWeight: FontWeight.w900,
            color: lapsed ? PtColors.error : PtColors.navy,
          ),
        ),
        if (progress != null) ...[
          const SizedBox(height: 8),
          Semantics(
            label: 'Days used of your included Premium year',
            child: LinearProgressIndicator(
              value: progress,
              minHeight: 6,
              borderRadius: BorderRadius.circular(PtRadii.pill),
            ),
          ),
        ],
        const SizedBox(height: 8),
        Text(
          membershipSub(m, formatDate),
          style: const TextStyle(color: PtColors.muted),
        ),
      ],
    );
  }
}

/// vehicle-detail.html "Premium & Official Sticker". Buy Premium Tag only on
/// a spent E-Tag, and it opens the in-app shop for a physical sticker.
class PremiumCard extends StatelessWidget {
  const PremiumCard({super.key, required this.tag});

  final Tag tag;

  @override
  Widget build(BuildContext context) {
    return _Section(
      title: 'Premium and official sticker',
      icon: Icons.star_outline,
      children: [
        Text(premiumCopy(tag)),
        if (tag.premium) ...[
          const SizedBox(height: 8),
          const Text(
            'Premium active. Unlimited private contact enabled.',
            style: TextStyle(
              color: PtColors.accent,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
        if (trialExpired(tag)) ...[
          if (tag.missedContacts > 0) ...[
            const SizedBox(height: 8),
            Text(lockedTagNote(tag)),
          ],
          const SizedBox(height: 12),
          FilledButton.icon(
            icon: const Icon(Icons.shopping_bag_outlined),
            label: const Text('Buy Premium Tag'),
            onPressed: () => context.go(replaceShopPath(tag)),
          ),
        ],
      ],
    );
  }
}

/// vehicle-detail.html "Get a Tag Replacement". The web button has no
/// handler; here it opens a WhatsApp chat with support.
class ReplacementCard extends StatelessWidget {
  const ReplacementCard({super.key, required this.tag});

  final Tag tag;

  @override
  Widget build(BuildContext context) {
    final text =
        'Hi ParkTag, my sticker is lost or damaged and I need a replacement.\n'
        'Vehicle: ${tagTitle(tag)}\nTag: ${tag.token}';
    return _Section(
      title: 'Get a tag replacement',
      icon: Icons.autorenew,
      children: [
        const Text(
          'If your ParkTag sticker is lost, damaged, or stolen, you can '
          'request a replacement. Your vehicle and settings will transfer '
          'automatically.',
        ),
        const SizedBox(height: 12),
        OutlinedButton(
          onPressed: () => ownerLaunch(
            Uri.parse(
              'https://wa.me/$supportWhatsApp?text=${Uri.encodeComponent(text)}',
            ),
          ),
          child: const Text('Request Replacement Tag'),
        ),
      ],
    );
  }
}

/// "View contact page": what scanners see, in a Custom Tab.
class ContactPageTile extends StatelessWidget {
  const ContactPageTile({super.key, required this.tag});

  final Tag tag;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        leading: const Icon(Icons.visibility_outlined),
        title: const Text('View contact page'),
        subtitle: const Text('See what people see when they scan your tag'),
        trailing: const Icon(Icons.open_in_new),
        enabled: tag.scanUrl.isNotEmpty,
        onTap: () async {
          final ok = await tagCustomTab(tag.scanUrl).catchError((_) => false);
          if (!ok && context.mounted) {
            showSnack(context, 'Could not open the contact page.');
          }
        },
      ),
    );
  }
}

/// vehicle-detail.js sos-test-btn: how to test the live SOS call.
Future<void> showSosTest(BuildContext context, Tag tag) {
  final n = tag.emergencyContact;
  if (n == null || n.isEmpty) {
    showSnack(context, 'Save an emergency contact first.');
    return Future.value();
  }
  return showDialog<void>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: const Text('Test SOS alert'),
      content: Text(
        'Emergency contact is set to $n.\n\n'
        "To test the live call, scan this vehicle's QR, verify the plate, "
        'then use the Emergency button on the contact page, which places a '
        'real masked call.',
      ),
      actions: [
        FilledButton(
          onPressed: () => Navigator.pop(ctx),
          child: const Text('OK'),
        ),
      ],
    ),
  );
}
