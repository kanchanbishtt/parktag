import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../../core/app_state.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'home_cards.dart';
import 'owner_common.dart';
import 'tags_screen.dart';

/// `/home`: greeting, setup nudges, callback prompt, overview tiles that
/// filter the vehicles, the ParkTag number card, quick actions, referral.
/// Membership is read-only here: no prices and no plans link.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  VehicleFilter? _filter;

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final name = app.owner?.greetingName ?? '';
    return Scaffold(
      body: DashboardView(
        header: Container(
          color: PtColors.navy,
          padding: EdgeInsets.fromLTRB(
            18,
            MediaQuery.paddingOf(context).top + 16,
            8,
            20,
          ),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  name.isEmpty ? 'Hi' : 'Hi, $name',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 24,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              const ActivityBell(),
            ],
          ),
        ),
        builder: _body,
      ),
    );
  }

  void _toggle(VehicleFilter f) =>
      setState(() => _filter = _filter == f ? null : f);

  List<Widget> _body(BuildContext context, AppState app) {
    final tags = app.tags;
    final filter = _filter;
    final shown = filter == null ? tags : tags.where(filter.matches).toList();
    final referral = app.referral;
    final code = referral?.code;
    return [
      ...setupNudges(context, app),
      const CallbackPrompt(),
      Row(
        children: [
          for (final (i, f) in VehicleFilter.values.indexed) ...[
            if (i > 0) const SizedBox(width: 8),
            _Kpi(
              f == VehicleFilter.used ? 'Calls Used' : f.label,
              tags.where(f.matches).length,
              selected: _filter == f,
              onTap: () => _toggle(f),
            ),
          ],
        ],
      ),
      if (filter != null)
        Row(
          children: [
            Expanded(child: Text('Filtered: ${filter.label}')),
            TextButton(
              onPressed: () => setState(() => _filter = null),
              child: const Text('Clear'),
            ),
          ],
        ),
      const SizedBox(height: 16),
      if (tags.isNotEmpty) const SaveNumberCard(),
      const SizedBox(height: 6),
      const HomeHeading('Your vehicles'),
      if (tags.isEmpty)
        EmptyState(
          title: 'No vehicles yet',
          body: 'Add your first vehicle to get an E-Tag',
          icon: Icons.directions_car_outlined,
          action: FilledButton(
            onPressed: () => showAddVehicleSheet(context),
            child: const Text('Add vehicle'),
          ),
        ),
      for (final t in shown) VehicleTile(t),
      const SizedBox(height: 16),
      const HomeHeading('Quick actions'),
      GridView.count(
        crossAxisCount: 4,
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        children: [
          _Action('Scan', Icons.qr_code_scanner, () => context.go('/scan')),
          _Action(
            'Add vehicle',
            Icons.add_circle_outline,
            () => showAddVehicleSheet(context),
          ),
          _Action(
            'Shop',
            Icons.shopping_bag_outlined,
            () => context.go('/shop'),
          ),
          _Action('Help', Icons.help_outline, () => context.push('/help')),
        ],
      ),
      if (code != null && code.isNotEmpty) ...[
        const SizedBox(height: 16),
        _ReferralCard(code: code, link: referral!.link!),
      ],
    ];
  }
}

class _Kpi extends StatelessWidget {
  const _Kpi(
    this.label,
    this.value, {
    required this.selected,
    required this.onTap,
  });

  final String label;
  final int value;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Expanded(
    child: Card(
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(PtRadii.r14),
        side: BorderSide(
          color: selected ? PtColors.accent : Colors.transparent,
          width: 2,
        ),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(PtRadii.r14),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(10),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '$value',
                style: const TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w900,
                ),
              ),
              Text(
                label,
                style: const TextStyle(color: PtColors.muted, fontSize: 11),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

class _Action extends StatelessWidget {
  const _Action(this.label, this.icon, this.onTap);

  final String label;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => InkWell(
    borderRadius: BorderRadius.circular(PtRadii.r14),
    onTap: onTap,
    child: Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Icon(icon, color: PtColors.accent),
        const SizedBox(height: 6),
        Text(
          label,
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
        ),
      ],
    ),
  );
}

class _ReferralCard extends StatelessWidget {
  const _ReferralCard({required this.code, required this.link});

  final String code;
  final String link;

  @override
  Widget build(BuildContext context) {
    final text =
        'I use ParkTag so people can reach me about my car without '
        'seeing my number. Use my code $code on a sticker order: $link';
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Refer a friend',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 4),
            const Text(
              'Share your code. It works on prepaid sticker orders.',
              style: TextStyle(color: PtColors.muted),
            ),
            const SizedBox(height: 12),
            SelectableText(
              code,
              style: const TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.w900,
                letterSpacing: 2,
              ),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: FilledButton.icon(
                    style: FilledButton.styleFrom(
                      backgroundColor: PtColors.whatsappDark,
                    ),
                    icon: const Icon(Icons.share),
                    label: const Text('Share'),
                    onPressed: () => ownerLaunch(
                      Uri.parse(
                        'https://wa.me/?text=${Uri.encodeComponent(text)}',
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: OutlinedButton.icon(
                    icon: const Icon(Icons.copy),
                    label: const Text('Copy'),
                    onPressed: () async {
                      await Clipboard.setData(ClipboardData(text: code));
                      if (context.mounted) showSnack(context, 'Code copied.');
                    },
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
