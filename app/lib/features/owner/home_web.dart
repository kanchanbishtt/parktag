// The owner dashboard's Tags view (pages/owner/welcome.html, welcome.js,
// styles/owner-welcome.css), drawn natively to the page's own measurements at
// phone width: header, banner carousel, Overview, callback prompt, search,
// My Vehicles, Refer a friend and Activity. Sizes, colours and copy are the
// page's; the comments name the CSS class each widget copies.
//
// Where welcome.js branches on inAndroidApp(), this takes the app branch: no
// paid callback, no renewal prompt, no plans link.

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../../core/api.dart';
import '../../core/app_state.dart';
import '../../core/models.dart';
import '../../core/platform.dart';
import '../../core/web_text.dart';
import '../../core/widgets.dart';
import '../../core/errors.dart';
import 'activity_row.dart';
import 'activity_rules.dart';
import 'home_cards.dart'
    show VehicleFilter, VehicleFilterRule, parktagCallerNumber;
import 'owner_common.dart';
import 'tag_etag.dart';
import 'tag_rules.dart';
import 'add_vehicle_sheet.dart';

abstract final class _C {
  static const navy = Color(0xFF03162D);
  static const red = Color(0xFFFF2700);
  static const slate = Color(0xFF374151);
  static const grey = Color(0xFF6B7280);
  static const grey400 = Color(0xFF9CA3AF);
  static const grey300 = Color(0xFFD1D5DB);
  static const line = Color(0xFFE5E7EB);
  static const green = Color(0xFF10B981);
  static const amber = Color(0xFFD97706);
  static const blue = Color(0xFF2563EB);
  static const kpiRed = Color(0xFFEF4444);
  static const wa = Color(0xFF16A34A);
}

/// welcome.js VEHICLE_COLORS, by the vehicle's index in the owner's list.
const vehicleColors = <({Color bg, Color accent})>[
  (bg: Color(0xFFFFE3DD), accent: Color(0xFFFF2700)),
  (bg: Color(0xFFDBEAFE), accent: Color(0xFF2563EB)),
  (bg: Color(0xFFD1FAE5), accent: Color(0xFF059669)),
  (bg: Color(0xFFEDE9FE), accent: Color(0xFF7C3AED)),
  (bg: Color(0xFFFEF3C7), accent: Color(0xFFD97706)),
];

const _unknownVehicleColor = (bg: Color(0xFFF3F4F6), accent: Color(0xFF9CA3AF));

({Color bg, Color accent}) vehicleColor(int index) => index < 0
    ? _unknownVehicleColor
    : vehicleColors[index % vehicleColors.length];

/// welcome.js VEHICLE_ICON_SRC: the same six drawings the activation picker
/// uses, copied into assets/vehicles.
String vehicleIconAsset(String? type) => switch (type) {
  'bike' => 'assets/vehicles/bike.webp',
  'scooter' => 'assets/vehicles/scooter.png',
  'auto_rickshaw' => 'assets/vehicles/auto_rickshaw.png',
  'truck' => 'assets/vehicles/truck.png',
  'bus' => 'assets/vehicles/bus.png',
  _ => 'assets/vehicles/car.png',
};

/// welcome.js formatExactTime: "Today 11:17 AM", "Yesterday 4:05 PM" or
/// "23 Oct 11:17 AM".
String exactTime(DateTime at, DateTime now) {
  final d = at.toLocal();
  final h = d.hour % 12 == 0 ? 12 : d.hour % 12;
  final time =
      '$h:${d.minute.toString().padLeft(2, '0')} ${d.hour < 12 ? 'AM' : 'PM'}';
  final today = now.toLocal();
  bool sameDay(DateTime a, DateTime b) =>
      a.year == b.year && a.month == b.month && a.day == b.day;
  if (sameDay(d, today)) {
    return 'Today $time';
  }
  if (sameDay(d, today.subtract(const Duration(days: 1)))) {
    return 'Yesterday $time';
  }
  return '${formatDate(d).replaceAll(RegExp(r' \d{4}$'), '')} $time';
}

/// welcome.js rupees: "₹50" or "₹49.50".
String rupees(int paise) {
  final r = paise ~/ 100;
  final p = paise % 100;
  return p == 0 ? '₹$r' : '₹$r.${p.toString().padLeft(2, '0')}';
}

// ── Header (.pt-wh) ────────────────────────────────────────────────────────

/// .pt-wh: brand navy, the wordmark, a hairline, "Hi, Name!" with the
/// sign-in identifier under it, then the bell and the menu button with its
/// "1 thing to do" badge (the backup number, when unset).
class HomeHeader extends StatelessWidget {
  const HomeHeader({super.key});

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final owner = app.owner;
    final raw = owner?.raw ?? const <String, dynamic>{};
    final first = (owner?.displayName ?? '').trim().split(RegExp(r'\s+')).first;
    final greeting = (owner?.greetingName ?? '').isNotEmpty
        ? owner!.greetingName
        : first.isNotEmpty
        ? first
        : 'there';
    final id =
        raw['signInIdentifier'] as String? ??
        owner?.email ??
        owner?.mobile ??
        '';
    final hasOwnName = raw['hasOwnName'] == true;
    final needsBackup =
        (owner?.backupMobile ?? '').isEmpty && app.tags.isNotEmpty;
    // .pt-wh and .pt-wh-inner at the stylesheet's breakpoints: the outer
    // padding grows with the window, the row keeps its own 12/14, the inner
    // row is centred under a max width, and the greeting grows from 1024px.
    final viewport = MediaQuery.sizeOf(context).width;
    final (top, bottom, side, inner, hi) = viewport >= 1400
        ? (22.0, 30.0, 80.0, 1400.0, 23.2)
        : viewport >= 1024
        ? (20.0, 28.0, 60.0, 1200.0, 23.2)
        : viewport >= 640
        ? (16.0, 28.0, 28.0, 880.0, 16.0)
        : (0.0, 0.0, 18.0, 880.0, 16.0);
    return Container(
      decoration: const BoxDecoration(
        color: _C.navy,
        boxShadow: [
          BoxShadow(
            color: Color(0x52001230),
            offset: Offset(0, 6),
            blurRadius: 32,
          ),
        ],
      ),
      child: Stack(
        children: [
          // .pt-wh::after: the 2px red hairline fading out at both ends.
          const Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            height: 2,
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [
                    Color(0x00FF2700),
                    Color(0x73FF2700),
                    Color(0xB3FF2700),
                    Color(0x73FF2700),
                    Color(0x00FF2700),
                  ],
                  stops: [0, .25, .5, .75, 1],
                ),
              ),
            ),
          ),
          SafeArea(
            bottom: false,
            child: Padding(
              padding: EdgeInsets.fromLTRB(side, top + 12, side, bottom + 14),
              child: Center(
                child: ConstrainedBox(
                  constraints: BoxConstraints(maxWidth: inner),
                  child: Row(
                    children: [
                      const PtLogo(height: 42, onDark: true),
                      const SizedBox(width: 11),
                      Container(
                        width: 1,
                        height: 30,
                        color: const Color(0x2EFFFFFF),
                      ),
                      const SizedBox(width: 11),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Row(
                              children: [
                                Flexible(
                                  child: Text(
                                    'Hi, $greeting!',
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: wt(
                                      hi,
                                      weight: FontWeight.w800,
                                      color: Colors.white,
                                      height: 1.2,
                                      spacing: -0.015 * hi,
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 8),
                                _NameEdit(hasOwnName: hasOwnName),
                              ],
                            ),
                            if (id.isNotEmpty) ...[
                              const SizedBox(height: 2),
                              Text(
                                id,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: wt(
                                  11.52,
                                  weight: FontWeight.w500,
                                  color: const Color(0xFF8FAACB),
                                  height: 1.25,
                                ),
                              ),
                            ],
                          ],
                        ),
                      ),
                      const SizedBox(width: 10),
                      _HeaderButton(
                        tooltip: _bellTooltip(app),
                        icon: Icons.notifications_none_rounded,
                        onTap: () => context.push('/activity'),
                      ),
                      const SizedBox(width: 9),
                      _HeaderButton(
                        tooltip: 'Menu',
                        icon: Icons.menu_rounded,
                        badge: needsBackup ? '1' : null,
                        onTap: () => context.go('/more'),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  static String _bellTooltip(AppState app) {
    final n = activityViewOf(app).hotCount;
    return n > 0 ? 'Activity, $n new' : 'Activity';
  }
}

/// #greet-name-edit: a 22px pencil, or the pencil with "Add your name".
class _NameEdit extends StatelessWidget {
  const _NameEdit({required this.hasOwnName});

  final bool hasOwnName;

  @override
  Widget build(BuildContext context) {
    final style = wt(
      11.2,
      weight: FontWeight.w700,
      color: const Color(0xDBFFFFFF),
      height: 1.25,
      spacing: 0.112,
    );
    return Semantics(
      button: true,
      label: hasOwnName ? 'Edit your name' : 'Add your name',
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: () => context.push('/more/profile'),
        child: Container(
          height: 22,
          padding: const EdgeInsets.symmetric(horizontal: 4),
          decoration: BoxDecoration(
            color: const Color(0x1AFFFFFF),
            borderRadius: BorderRadius.circular(9),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(
                Icons.edit_outlined,
                size: 14,
                color: Color(0xDBFFFFFF),
              ),
              if (!hasOwnName) ...[
                const SizedBox(width: 5),
                Text('Add your name', style: style),
                const SizedBox(width: 2),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// .pt-wh-btn: 40px, white at 8% with a 14% hairline, 12px corners.
class _HeaderButton extends StatelessWidget {
  const _HeaderButton({
    required this.tooltip,
    required this.icon,
    required this.onTap,
    this.badge,
  });

  final String tooltip;
  final IconData icon;
  final VoidCallback onTap;
  final String? badge;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: const Color(0x14FFFFFF),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: const Color(0x24FFFFFF)),
              ),
              child: Icon(icon, size: 20, color: const Color(0xEBFFFFFF)),
            ),
            if (badge != null)
              Positioned(
                top: -4,
                right: -4,
                child: Container(
                  height: 19,
                  padding: const EdgeInsets.symmetric(horizontal: 5),
                  decoration: BoxDecoration(
                    color: _C.red,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: _C.navy, width: 2),
                    boxShadow: const [
                      BoxShadow(
                        color: Color(0x59000000),
                        offset: Offset(0, 1),
                        blurRadius: 4,
                      ),
                    ],
                  ),
                  alignment: Alignment.center,
                  child: Text(
                    badge!,
                    style: wt(
                      10.88,
                      weight: FontWeight.w800,
                      color: Colors.white,
                      height: 1,
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

// ── Banners (.pt-car-wrap) ────────────────────────────────────────────────

/// .pt-car-wrap: the three dashboard banners, 18px corners, advancing every
/// 3 s (welcome.js startAuto), with the red 22px dot under the current one.
class BannerCarousel extends StatefulWidget {
  const BannerCarousel({super.key, this.autoAdvance = true});

  final bool autoAdvance;

  static const banners = [
    'assets/banners/banner-1.webp',
    'assets/banners/banner-2.webp',
    'assets/banners/banner-3.webp',
  ];

  @override
  State<BannerCarousel> createState() => _BannerCarouselState();
}

class _BannerCarouselState extends State<BannerCarousel> {
  final _page = PageController();
  Timer? _auto;
  int _cur = 0;

  @override
  void initState() {
    super.initState();
    _start();
  }

  void _start() {
    _auto?.cancel();
    if (!widget.autoAdvance) return;
    _auto = Timer.periodic(const Duration(seconds: 3), (_) {
      if (!mounted || !_page.hasClients) return;
      _page.animateToPage(
        (_cur + 1) % BannerCarousel.banners.length,
        duration: const Duration(milliseconds: 400),
        curve: Curves.easeInOut,
      );
    });
  }

  @override
  void dispose() {
    _auto?.cancel();
    _page.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 16),
      child: Column(
        children: [
          Container(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(18),
              boxShadow: const [
                BoxShadow(
                  color: Color(0x17000000),
                  offset: Offset(0, 3),
                  blurRadius: 14,
                ),
              ],
            ),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(18),
              child: AspectRatio(
                aspectRatio: 1134 / 496,
                child: Listener(
                  onPointerDown: (_) => _auto?.cancel(),
                  onPointerUp: (_) => _start(),
                  child: PageView(
                    controller: _page,
                    onPageChanged: (i) => setState(() => _cur = i),
                    children: [
                      for (final b in BannerCarousel.banners)
                        Container(
                          color: const Color(0xFFF3F4F6),
                          child: Image.asset(b, fit: BoxFit.cover),
                        ),
                    ],
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(height: 10),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              for (var i = 0; i < BannerCarousel.banners.length; i++) ...[
                if (i > 0) const SizedBox(width: 7),
                GestureDetector(
                  onTap: () => _page.animateToPage(
                    i,
                    duration: const Duration(milliseconds: 300),
                    curve: Curves.easeInOut,
                  ),
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 200),
                    width: i == _cur ? 22 : 7,
                    height: 7,
                    decoration: BoxDecoration(
                      color: i == _cur ? _C.red : _C.grey300,
                      borderRadius: BorderRadius.circular(4),
                    ),
                  ),
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }
}

// ── Section titles ────────────────────────────────────────────────────────

/// .pt-ov-title / .pt-tags-title / .pt-act-title with the 34x3 red bar.
class SectionTitle extends StatelessWidget {
  const SectionTitle(this.text, {super.key, this.count, this.barGap = 7});

  final String text;
  final String? count;
  final double barGap;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text.rich(
          TextSpan(
            text: text,
            children: [
              if (count != null)
                TextSpan(
                  text: ' $count',
                  style: wt(
                    13.6,
                    weight: FontWeight.w600,
                    color: _C.grey400,
                    height: 1.3,
                  ),
                ),
            ],
          ),
          style: wt(20.8, weight: FontWeight.w900, height: 1.3),
        ),
        SizedBox(height: barGap),
        Container(
          width: 34,
          height: 3,
          decoration: BoxDecoration(
            color: _C.red,
            borderRadius: BorderRadius.circular(2),
          ),
        ),
      ],
    );
  }
}

// ── Overview (.pt-ov) ─────────────────────────────────────────────────────

/// welcome.js renderNoticeboard: four KPI tiles that filter the vehicle
/// list, the filter bar, the tip, and the "save this number" card.
class OverviewSection extends StatelessWidget {
  const OverviewSection({
    super.key,
    required this.tags,
    required this.filter,
    required this.onFilter,
  });

  final List<Tag> tags;
  final VehicleFilter? filter;
  final ValueChanged<VehicleFilter?> onFilter;

  @override
  Widget build(BuildContext context) {
    final total = tags.length;
    int count(VehicleFilter f) => tags.where(f.matches).length;
    final active = count(VehicleFilter.active);
    final premium = count(VehicleFilter.premium);
    final freeLeft = count(VehicleFilter.free);
    final used = count(VehicleFilter.used);
    final upgradeTip = freeLeft < total && premium == 0;
    return Padding(
      padding: const EdgeInsets.only(top: 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SectionTitle('Overview'),
          const SizedBox(height: 6),
          Text(
            '$total Vehicle${total == 1 ? '' : 's'} registered',
            style: wt(
              13.12,
              weight: FontWeight.w500,
              color: _C.grey,
              height: 1.3,
            ),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: _Kpi(
                  filter: VehicleFilter.active,
                  selected: filter == VehicleFilter.active,
                  iconBg: const Color(0xFFDCFCE7),
                  icon: const _StrokeIcon(_Glyph.check, color: _C.green),
                  value: active,
                  valueColor: _C.green,
                  label: 'Active Tags',
                  onTap: onFilter,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _Kpi(
                  filter: VehicleFilter.premium,
                  selected: filter == VehicleFilter.premium,
                  iconBg: const Color(0xFFFEF3C7),
                  icon: const _StrokeIcon(
                    _Glyph.star,
                    color: _C.amber,
                    strokeWidth: 1.7,
                  ),
                  value: premium,
                  valueColor: _C.amber,
                  label: 'Premium Tags',
                  onTap: onFilter,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: _Kpi(
                  filter: VehicleFilter.free,
                  selected: filter == VehicleFilter.free,
                  iconBg: const Color(0xFFDBEAFE),
                  icon: const Icon(
                    Icons.call_outlined,
                    size: 18,
                    color: _C.blue,
                  ),
                  value: freeLeft,
                  valueColor: _C.navy,
                  label: 'Free Calls Left',
                  onTap: onFilter,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _Kpi(
                  filter: VehicleFilter.used,
                  selected: filter == VehicleFilter.used,
                  iconBg: const Color(0xFFFEE2E2),
                  icon: const _StrokeIcon(_Glyph.cross, color: _C.kpiRed),
                  value: used,
                  valueColor: used > 0 ? _C.kpiRed : _C.navy,
                  label: 'Calls Used',
                  onTap: onFilter,
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          if (filter != null) ...[
            // .pt-ov-fbar
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
              decoration: BoxDecoration(
                color: const Color(0xFFFFF5F3),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: const Color(0xFFFECACA)),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Text.rich(
                      TextSpan(
                        text: 'Filtered: ',
                        children: [
                          TextSpan(
                            text: filter!.label,
                            style: wt(
                              12.48,
                              weight: FontWeight.w700,
                              color: _C.slate,
                            ),
                          ),
                        ],
                      ),
                      style: wt(
                        12.48,
                        weight: FontWeight.w600,
                        color: _C.slate,
                      ),
                    ),
                  ),
                  GestureDetector(
                    behavior: HitTestBehavior.opaque,
                    onTap: () => onFilter(null),
                    child: Text(
                      '✕ Clear',
                      style: wt(12, weight: FontWeight.w700, color: _C.red),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
          ],
          if (total == 0)
            // .pt-ov-empty
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 36),
              child: Text(
                'Add your first vehicle to see your overview here.',
                textAlign: TextAlign.center,
                style: wt(14.4, weight: FontWeight.w600, color: _C.grey400),
              ),
            )
          else ...[
            // .pt-ov-tip
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 13),
              decoration: BoxDecoration(
                color: const Color(0xFFF8FAFC),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: _C.line),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Padding(
                    padding: const EdgeInsets.only(top: 1),
                    child: SizedBox(
                      width: 16,
                      height: 16,
                      child: upgradeTip
                          ? const _StrokeIcon(
                              _Glyph.star,
                              color: _C.amber,
                              strokeWidth: 1.8,
                            )
                          : const _StrokeIcon(_Glyph.check, color: _C.green),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text.rich(
                      upgradeTip
                          ? TextSpan(
                              text: 'Upgrade to ',
                              children: [
                                TextSpan(
                                  text: 'Premium',
                                  style: wt(
                                    12.8,
                                    weight: FontWeight.w700,
                                    color: _C.slate,
                                    height: 1.55,
                                  ),
                                ),
                                const TextSpan(
                                  text: ' for unlimited masked calls. Your number stays hidden.',
                                ),
                              ],
                            )
                          : TextSpan(
                              text: 'Each free E-Tag includes ',
                              children: [
                                TextSpan(
                                  text: '1 free masked call',
                                  style: wt(
                                    12.8,
                                    weight: FontWeight.w700,
                                    color: _C.slate,
                                    height: 1.55,
                                  ),
                                ),
                                const TextSpan(
                                  text: ', plus unlimited WhatsApp alerts.',
                                ),
                              ],
                            ),
                      style: wt(12.8, color: _C.slate, height: 1.55),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 8),
            const _SaveNumberCard(),
          ],
        ],
      ),
    );
  }
}

/// .pt-ov-kpi: a white tile with a tinted icon, the count and its label.
/// Selected: .nb-active, a faint red wash with a 3px red halo.
class _Kpi extends StatelessWidget {
  const _Kpi({
    required this.filter,
    required this.selected,
    required this.iconBg,
    required this.icon,
    required this.value,
    required this.valueColor,
    required this.label,
    required this.onTap,
  });

  final VehicleFilter filter;
  final bool selected;
  final Color iconBg;
  final Widget icon;
  final int value;
  final Color valueColor;
  final String label;
  final ValueChanged<VehicleFilter?> onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: () => onTap(selected ? null : filter),
      child: Container(
        padding: const EdgeInsets.fromLTRB(16, 18, 16, 16),
        decoration: BoxDecoration(
          color: selected ? const Color(0xFFFFF5F3) : Colors.white,
          borderRadius: BorderRadius.circular(16),
          // The page says 1.5px; Chrome floors that to 1px at every density.
          border: Border.all(color: selected ? _C.red : _C.line),
          boxShadow: selected
              ? const [BoxShadow(color: Color(0x1AFF2700), spreadRadius: 3)]
              : null,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 34,
              height: 34,
              decoration: BoxDecoration(
                color: iconBg,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Center(
                child: SizedBox(width: 18, height: 18, child: icon),
              ),
            ),
            const SizedBox(height: 12),
            Text(
              '$value',
              style: wt(
                32,
                weight: FontWeight.w900,
                color: valueColor,
                height: 1,
              ),
            ),
            const SizedBox(height: 5),
            Text(
              label,
              style: wt(
                11.52,
                weight: FontWeight.w700,
                color: selected ? _C.red : _C.grey,
                spacing: 0.1152,
                height: 1.3,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// .pt-ov-save: hands /parktag.vcf to the OS contact screen.
class _SaveNumberCard extends StatelessWidget {
  const _SaveNumberCard();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 17, vertical: 15),
      decoration: BoxDecoration(
        color: const Color(0xFFEEF0F3),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: _C.red),
      ),
      child: Row(
        children: [
          Container(
            width: 38,
            height: 38,
            decoration: const BoxDecoration(
              color: _C.navy,
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.call_outlined,
              size: 19,
              color: Colors.white,
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Calls about your vehicle come from this number. Save it so you never miss one.',
                  style: wt(12.8, color: _C.slate, height: 1.55),
                ),
                const SizedBox(height: 4),
                Text(
                  parktagCallerNumber,
                  style: wt(
                    16.96,
                    weight: FontWeight.w700,
                    spacing: 0.848,
                    height: 1.2,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 14),
          GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: () => ownerLaunch(Uri.parse('$apiBase/parktag.vcf')),
            child: Container(
              height: 40,
              padding: const EdgeInsets.symmetric(horizontal: 18),
              decoration: BoxDecoration(
                color: _C.red,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.add, size: 14, color: Colors.white),
                  const SizedBox(width: 6),
                  Text(
                    'Add',
                    style: wt(
                      12.96,
                      weight: FontWeight.w800,
                      color: Colors.white,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ── Search (.pt-wsearch) ──────────────────────────────────────────────────

class VehicleSearch extends StatelessWidget {
  const VehicleSearch({
    super.key,
    required this.controller,
    required this.onChanged,
  });

  final TextEditingController controller;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final style = wt(14.08, color: const Color(0xFF323232));
    return Padding(
      padding: const EdgeInsets.only(top: 16),
      child: Container(
        height: 48,
        decoration: BoxDecoration(
          color: const Color(0xFFF1F1F0),
          borderRadius: BorderRadius.circular(24),
          border: Border.all(color: _C.line),
        ),
        child: Stack(
          children: [
            Positioned.fill(
              child: Padding(
                padding: const EdgeInsets.only(left: 18, right: 52),
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: TextField(
                    controller: controller,
                    onChanged: onChanged,
                    style: style,
                    textAlignVertical: TextAlignVertical.center,
                    decoration: InputDecoration(
                      isCollapsed: true,
                      filled: false,
                      border: InputBorder.none,
                      enabledBorder: InputBorder.none,
                      focusedBorder: InputBorder.none,
                      hintText: 'Search vehicles…',
                      hintStyle: style.copyWith(color: const Color(0xFF757575)),
                    ),
                  ),
                ),
              ),
            ),
            const Positioned(
              right: 6,
              top: 5,
              child: SizedBox(
                width: 36,
                height: 36,
                child: Center(
                  child: SizedBox(
                    width: 20,
                    height: 20,
                    child: _StrokeIcon(
                      _Glyph.search,
                      color: _C.red,
                      strokeWidth: 2.2,
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Vehicles (.pt-vgrid) ──────────────────────────────────────────────────

/// welcome.js vehicleCard: a .pt-vlc row with the vehicle's colour on its
/// left edge, the type icon, label, plate and serial, the pill and state,
/// and under it Download Premium Tag or the locked note with Buy Premium Tag.
class VehicleCardWeb extends StatelessWidget {
  const VehicleCardWeb({
    super.key,
    required this.tag,
    required this.colorIndex,
  });

  final Tag tag;
  final int colorIndex;

  @override
  Widget build(BuildContext context) {
    final t = tag;
    final color = vehicleColor(colorIndex);
    final pill = tagPill(t);
    final (Color pillBg, Color pillFg, String pillText) = switch (pill.kind) {
      TagPillKind.premium => (
        const Color(0xFFFEF3C7),
        const Color(0xFF92400E),
        '★ Premium',
      ),
      TagPillKind.free => (
        const Color(0xFFDCFCE7),
        const Color(0xFF14532D),
        pill.label,
      ),
      TagPillKind.used => (
        const Color(0xFFFEE2E2),
        const Color(0xFFB91C1C),
        'Call Used',
      ),
    };
    final active = t.status != 'inactive';
    final expired = trialExpired(t);
    final hasActions = (t.premium && t.id.isNotEmpty) || expired;
    return _EdgeCard(
      accent: color.accent,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          InkWell(
            onTap: () => context.push('/tags/${t.id}'),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
              child: Row(
                children: [
                  Container(
                    width: 48,
                    height: 48,
                    decoration: BoxDecoration(
                      color: color.bg,
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: Center(
                      child: Image.asset(
                        vehicleIconAsset(t.vehicleType),
                        width: 28,
                        height: 28,
                        fit: BoxFit.contain,
                      ),
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          t.vehicleLabel,
                          style: wt(15.2, weight: FontWeight.w800, height: 1.3),
                        ),
                        const SizedBox(height: 3),
                        Text(t.plateNumber ?? t.token, style: _plate),
                        if ((t.serial ?? '').isNotEmpty)
                          Text(t.serial!, style: _plate),
                      ],
                    ),
                  ),
                  const SizedBox(width: 14),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 9,
                          vertical: 3,
                        ),
                        decoration: BoxDecoration(
                          color: pillBg,
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: Text(
                          pillText,
                          style: wt(
                            10.24,
                            weight: FontWeight.w700,
                            color: pillFg,
                            height: 1.35,
                          ),
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        active ? '● Active' : '○ Inactive',
                        style: wt(
                          10.88,
                          weight: FontWeight.w600,
                          color: active ? _C.green : _C.grey400,
                          height: 1.35,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(width: 2),
                  const SizedBox(
                    width: 14,
                    height: 14,
                    child: _StrokeIcon(
                      _Glyph.chevron,
                      color: _C.grey300,
                      strokeWidth: 2.2,
                    ),
                  ),
                ],
              ),
            ),
          ),
          if (hasActions)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 13),
              child: t.premium
                  ? _ActButton(
                      label: 'Download Premium Tag',
                      color: _C.navy,
                      icon: Icons.download_rounded,
                      height: 36,
                      onTap: () => _download(context, t),
                    )
                  : Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(
                          lockedTagNote(t),
                          style: wt(
                            11.52,
                            weight: FontWeight.w600,
                            color: const Color(0xFFB31C00),
                            height: 1.4,
                          ),
                        ),
                        const SizedBox(height: 8),
                        _ActButton(
                          label: 'Buy Premium Tag',
                          color: _C.red,
                          height: 34,
                          onTap: () => context.go(replaceShopPath(t)),
                        ),
                      ],
                    ),
            ),
        ],
      ),
    );
  }

  static final _plate = wt(
    12.48,
    color: _C.grey,
    spacing: 0.624,
    height: 1.12,
    family: 'monospace',
  );

  static Future<void> _download(BuildContext context, Tag tag) async {
    try {
      final sheet = EtagSheet(tag);
      await PtPlatform.shareImage(await etagSheetPng(sheet), sheet.fileName);
    } catch (_) {
      if (context.mounted) {
        showSnack(context, 'Could not share the E-Tag. Try again.');
      }
    }
  }
}

/// .pt-vlc-act: the full-width action under a vehicle card.
class _ActButton extends StatelessWidget {
  const _ActButton({
    required this.label,
    required this.color,
    required this.onTap,
    required this.height,
    this.icon,
  });

  final String label;
  final Color color;
  final VoidCallback onTap;
  final double height;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: Container(
        height: height,
        decoration: BoxDecoration(
          color: color,
          borderRadius: BorderRadius.circular(10),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            if (icon != null) ...[
              Icon(icon, size: 14, color: Colors.white),
              const SizedBox(width: 6),
            ],
            Text(
              label,
              style: wt(12.48, weight: FontWeight.w800, color: Colors.white),
            ),
          ],
        ),
      ),
    );
  }
}

/// A white 16px card with a 1.5px hairline and a 4px colour on its left
/// edge (.pt-vlc, .pt-act-card). Flutter cannot round a border whose sides
/// differ, so the edge is a strip clipped by the card's corners.
class _EdgeCard extends StatelessWidget {
  const _EdgeCard({
    required this.accent,
    required this.child,
    this.radius = 16,
  });

  final Color accent;
  final Widget child;
  final double radius;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(radius),
      child: Stack(
        children: [
          Container(
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(radius),
              border: Border.all(
                color: _C.line,
              ), // 1.5px on the page, drawn as 1
            ),
            child: Padding(
              padding: const EdgeInsets.only(left: 3),
              child: child,
            ),
          ),
          Positioned(
            left: 0,
            top: 0,
            bottom: 0,
            child: Container(width: 4, color: accent),
          ),
        ],
      ),
    );
  }
}

/// welcome.js ADD_CARD: the dashed "Add Vehicle" row after the vehicles.
class AddVehicleCard extends StatelessWidget {
  const AddVehicleCard({super.key});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: () => showAddVehicleSheet(context),
      child: CustomPaint(
        painter: const _DashedBox(
          color: _C.red,
          width: 1, // 1.5px on the page, which Chrome draws as 1
          radius: 16,
          fill: Color(0xFFFFEDEA),
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 17, vertical: 15),
          child: Row(
            children: [
              CustomPaint(
                painter: const _DashedBox(
                  color: _C.red,
                  width: 2,
                  radius: 14,
                  fill: Color(0xFFFFD8D0),
                ),
                child: const SizedBox(
                  width: 48,
                  height: 48,
                  child: Center(
                    child: SizedBox(
                      width: 24,
                      height: 24,
                      child: _StrokeIcon(
                        _Glyph.plusCircle,
                        color: _C.red,
                        strokeWidth: 1.8,
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 14),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Add Vehicle',
                    style: wt(
                      15.2,
                      weight: FontWeight.w800,
                      color: _C.red,
                      height: 1.3,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    'Register a new vehicle',
                    style: wt(12.48, color: _C.grey400, height: 1.3),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// welcome.js EMPTY_STATE and FILTER_EMPTY in the vehicle grid.
class VehiclesEmpty extends StatelessWidget {
  const VehiclesEmpty({super.key, required this.filtered});

  final bool filtered;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 28, 16, 12),
      child: Column(
        children: [
          Container(
            width: 60,
            height: 60,
            decoration: BoxDecoration(
              color: filtered
                  ? const Color(0xFFFFF5F3)
                  : const Color(0xFFF3F4F6),
              shape: BoxShape.circle,
            ),
            child: Center(
              child: SizedBox(
                width: 26,
                height: 26,
                child: filtered
                    ? const _StrokeIcon(
                        _Glyph.search,
                        color: _C.red,
                        strokeWidth: 1.8,
                      )
                    : const _StrokeIcon(
                        _Glyph.tag,
                        color: _C.grey400,
                        strokeWidth: 1.8,
                      ),
              ),
            ),
          ),
          const SizedBox(height: 12),
          Text(
            filtered ? 'No matches' : 'No vehicles yet',
            style: wt(
              14.72,
              weight: FontWeight.w800,
              color: const Color(0xFF323232),
            ),
          ),
          const SizedBox(height: 4),
          Text(
            filtered
                ? 'Try a different filter or search term'
                : 'Add your first vehicle below',
            textAlign: TextAlign.center,
            style: wt(12.8, color: _C.grey),
          ),
        ],
      ),
    );
  }
}

// ── Refer a friend (.pt-ref) ──────────────────────────────────────────────

/// welcome.js renderReferral: the offer in the server's own figures, the
/// link, Share on WhatsApp and Copy link. Hidden without a code.
class ReferralCardWeb extends StatelessWidget {
  const ReferralCardWeb({super.key, required this.referral});

  final Referral referral;

  @override
  Widget build(BuildContext context) {
    final ref = referral;
    final code = ref.code;
    final months = ref.rewardMonths;
    if (code == null || code.isEmpty || ref.discountPaise <= 0 || months < 1) {
      return const SizedBox.shrink();
    }
    final off = rupees(ref.discountPaise);
    final link = '$apiBase/get?ref=${Uri.encodeComponent(code)}';
    final shown = link.replaceFirst(RegExp(r'^https?://'), '');
    final earned = _earnedLine(ref);
    return Container(
      margin: const EdgeInsets.only(top: 20),
      padding: const EdgeInsets.fromLTRB(16, 18, 16, 14),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF5F3),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFFECACA)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Give $off, get ${months == 1 ? 'a free month' : '$months free months'}',
            style: wt(17.6, weight: FontWeight.w900, height: 1.3),
          ),
          const SizedBox(height: 6),
          Text(
            'Your friend gets $off off when they pay online. You get $months '
            '${months == 1 ? 'month' : 'months'} of Premium for each friend who buys.',
            style: wt(
              13.12,
              weight: FontWeight.w500,
              color: _C.slate,
              height: 1.55,
            ),
          ),
          const SizedBox(height: 12),
          if (earned != null) ...[
            Padding(
              padding: const EdgeInsets.only(top: -4 + 4, bottom: 12),
              child: Text(
                earned,
                style: wt(
                  13.12,
                  weight: FontWeight.w700,
                  color: const Color(0xFF17663A),
                  height: 1.55,
                ),
              ),
            ),
          ],
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: _C.line),
            ),
            child: Text(
              shown,
              style: wt(13.12, weight: FontWeight.w700, height: 1.3),
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onTap: () {
                    final text =
                        'I use ParkTag on my car: anyone who needs to reach me scans the QR '
                        'and I get a masked call or WhatsApp, my number stays private. '
                        'Get $off off with my link: $link';
                    ownerLaunch(
                      Uri.parse(
                        'https://wa.me/?text=${Uri.encodeComponent(text)}',
                      ),
                    );
                  },
                  child: Container(
                    height: 44,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: _C.wa,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Text(
                      'Share on WhatsApp',
                      style: wt(
                        13.6,
                        weight: FontWeight.w700,
                        color: Colors.white,
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTap: () async {
                  await Clipboard.setData(ClipboardData(text: link));
                  if (context.mounted) showSnack(context, 'Link copied.');
                },
                child: Container(
                  height: 44,
                  padding: const EdgeInsets.symmetric(horizontal: 14),
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: _C.line),
                  ),
                  child: Text(
                    'Copy link',
                    style: wt(13.6, weight: FontWeight.w700),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Text(
            'Online payment only',
            style: wt(
              11.52,
              weight: FontWeight.w600,
              color: _C.grey,
              height: 1.3,
            ),
          ),
        ],
      ),
    );
  }

  /// welcome.js renderReferralEarned.
  static String? _earnedLine(Referral ref) {
    String plural(int n, String one, String many) =>
        '$n ${n == 1 ? one : many}';
    final parts = <String>[];
    if (ref.monthsEarned > 0) {
      final who = ref.friends > 0
          ? '${plural(ref.friends, 'friend has', 'friends have')} bought with your link. '
          : '';
      parts.add(
        '${who}You have earned ${plural(ref.monthsEarned, 'month', 'months')} of Premium.',
      );
    }
    if (ref.monthsWaiting > 0) {
      parts.add(
        '${plural(ref.monthsWaiting, 'month is', 'months are')} waiting, and will be added '
        'as soon as you have a Premium tag.',
      );
    }
    return parts.isEmpty ? null : parts.join(' ');
  }
}

// ── Callback prompt (#callbackPrompt) ─────────────────────────────────────

/// welcome.js renderActivity's prompt: the contact to ring back now, with
/// the time left on the free window, over an urgent activity card.
class CallbackPromptWeb extends StatelessWidget {
  const CallbackPromptWeb({super.key, required this.view});

  final ActivityView view;

  @override
  Widget build(BuildContext context) {
    final subject = view.promptSubject;
    if (subject == null) return const SizedBox.shrink();
    final isTarget = subject == view.target;
    final left = isTarget
        ? timeLeft(view.callbackDeadline(subject), view.now)
        : 'Free ${view.windowMs ~/ 60000} min over';
    return Padding(
      padding: const EdgeInsets.only(top: 20, bottom: 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Container(
                width: 8,
                height: 8,
                decoration: const BoxDecoration(
                  color: _C.red,
                  shape: BoxShape.circle,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'SOMEONE WANTS YOU TO CALL BACK',
                  style: wt(
                    12.48,
                    weight: FontWeight.w800,
                    color: _C.red,
                    spacing: 0.125,
                  ),
                ),
              ),
              Text(
                left,
                style: wt(11.52, weight: FontWeight.w700, color: _C.grey400),
              ),
            ],
          ),
          const SizedBox(height: 10),
          ActivityCardWeb(
            request: subject,
            view: view,
            urgent: true,
            radius: 14,
          ),
        ],
      ),
    );
  }
}

// ── Activity (.pt-act) ────────────────────────────────────────────────────

/// welcome.js renderActivity: the last 48 hours, newest first, with the
/// per-vehicle chips once two vehicles have activity.
class ActivitySectionWeb extends StatelessWidget {
  const ActivitySectionWeb({
    super.key,
    required this.view,
    required this.vehicleFilter,
    required this.onVehicleFilter,
  });

  final ActivityView view;
  final String? vehicleFilter;
  final ValueChanged<String?> onVehicleFilter;

  @override
  Widget build(BuildContext context) {
    final recent = view.recent;
    final hot = view.hotCount;
    final counts = <String, int>{};
    for (final r in recent) {
      counts[r.token] = (counts[r.token] ?? 0) + 1;
    }
    final withActivity = [
      for (final t in view.tags)
        if (counts.containsKey(t.token)) t,
    ];
    final orphans =
        recent.length - withActivity.fold(0, (n, t) => n + counts[t.token]!);
    final showChips = withActivity.length + (orphans > 0 ? 1 : 0) >= 2;
    final filter = vehicleFilter != null && counts.containsKey(vehicleFilter)
        ? vehicleFilter
        : null;
    final visible = filter == null
        ? recent
        : recent.where((r) => r.token == filter).toList();
    return Padding(
      padding: const EdgeInsets.only(top: 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Expanded(child: SectionTitle('Activity')),
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Row(
                  children: [
                    if (hot > 0) ...[
                      Container(
                        margin: const EdgeInsets.only(top: 4),
                        padding: const EdgeInsets.symmetric(
                          horizontal: 9,
                          vertical: 3,
                        ),
                        decoration: BoxDecoration(
                          color: _C.red,
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: Text(
                          '$hot',
                          style: wt(
                            10.08,
                            weight: FontWeight.w800,
                            color: Colors.white,
                            height: 1.5,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                    ],
                    Tooltip(
                      message:
                          'Only activity from the last 2 days is shown. '
                          'Older entries are automatically hidden.',
                      triggerMode: TooltipTriggerMode.tap,
                      child: const Padding(
                        padding: EdgeInsets.all(2),
                        child: Icon(
                          Icons.info_outline,
                          size: 17,
                          color: _C.grey400,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          if (showChips && recent.isNotEmpty) ...[
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.only(bottom: 2),
              child: Row(
                children: [
                  _VehicleChip(
                    label: 'All',
                    count: recent.length,
                    active: filter == null,
                    activeColor: _C.navy,
                    onTap: () => onVehicleFilter(null),
                  ),
                  for (final t in withActivity) ...[
                    const SizedBox(width: 8),
                    _VehicleChip(
                      label: t.plateNumber ?? t.token,
                      count: counts[t.token]!,
                      active: filter == t.token,
                      activeColor: vehicleColor(view.tags.indexOf(t)).accent,
                      icon: vehicleIconAsset(t.vehicleType),
                      onTap: () => onVehicleFilter(t.token),
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(height: 14),
          ],
          if (recent.isEmpty)
            _ActivityEmpty(
              title: view.hasAny ? 'No recent activity' : 'No activity yet',
              sub: view.hasAny
                  ? 'Activity older than 2 days is hidden'
                  : 'Contact requests from scanners will appear here',
            )
          else
            for (final (i, r) in visible.take(20).indexed) ...[
              if (i > 0) const SizedBox(height: 10),
              ActivityCardWeb(request: r, view: view),
            ],
        ],
      ),
    );
  }
}

/// .pt-act-vchip: "All 2", or a plate with its icon and count.
class _VehicleChip extends StatelessWidget {
  const _VehicleChip({
    required this.label,
    required this.count,
    required this.active,
    required this.activeColor,
    required this.onTap,
    this.icon,
  });

  final String label;
  final int count;
  final bool active;
  final Color activeColor;
  final VoidCallback onTap;
  final String? icon;

  @override
  Widget build(BuildContext context) {
    final fg = active ? Colors.white : _C.grey;
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: Container(
        height: 31,
        padding: const EdgeInsets.symmetric(horizontal: 11),
        decoration: BoxDecoration(
          color: active ? activeColor : Colors.white,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: active ? activeColor : _C.line),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (icon != null) ...[
              Image.asset(icon!, width: 14, height: 14, fit: BoxFit.contain),
              const SizedBox(width: 6),
            ],
            Text(
              label,
              style: wt(11.68, weight: FontWeight.w700, color: fg),
            ),
            const SizedBox(width: 6),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
              decoration: BoxDecoration(
                color: active
                    ? const Color(0x40FFFFFF)
                    : const Color(0xFFF3F4F6),
                borderRadius: BorderRadius.circular(20),
              ),
              child: Text(
                '$count',
                style: wt(
                  9.92,
                  weight: FontWeight.w800,
                  color: fg,
                  height: 1.5,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// .pt-act-empty: the dashed grey box with the bell.
class _ActivityEmpty extends StatelessWidget {
  const _ActivityEmpty({required this.title, required this.sub});

  final String title;
  final String sub;

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      painter: const _DashedBox(
        color: _C.line,
        width: 1,
        radius: 16,
        fill: Color(0xFFF9FAFB),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 32),
        child: Column(
          children: [
            Container(
              width: 52,
              height: 52,
              decoration: const BoxDecoration(
                color: Color(0xFFF3F4F6),
                shape: BoxShape.circle,
              ),
              child: const Icon(
                Icons.notifications_none_rounded,
                size: 24,
                color: _C.grey300,
              ),
            ),
            const SizedBox(height: 12),
            Text(
              title,
              style: wt(
                14.72,
                weight: FontWeight.w800,
                color: const Color(0xFF323232),
              ),
            ),
            const SizedBox(height: 4),
            Text(
              sub,
              textAlign: TextAlign.center,
              style: wt(12.48, color: _C.grey400),
            ),
          ],
        ),
      ),
    );
  }
}

/// .pt-act-card: who contacted, the plate chip, the channel, the outcome
/// badge and talk time, the place, the time, and the action at the right.
class ActivityCardWeb extends StatefulWidget {
  const ActivityCardWeb({
    super.key,
    required this.request,
    required this.view,
    this.urgent = false,
    this.radius = 16,
  });

  final ContactRequest request;
  final ActivityView view;
  final bool urgent;
  final double radius;

  @override
  State<ActivityCardWeb> createState() => _ActivityCardWebState();
}

class _ActivityCardWebState extends State<ActivityCardWeb> {
  bool _busy = false;

  ContactRequest get r => widget.request;

  Future<void> _callBack() async {
    setState(() => _busy = true);
    try {
      final res = await AppScope.read(context).api
          .post('/api/owner/callback/register-call', {'requestId': r.id});
      final number = res['virtualNumber'];
      if (number is String && number.isNotEmpty) {
        await ownerLaunch(Uri(scheme: 'tel', path: number));
      } else if (mounted) {
        showSnack(context, 'Calling is unavailable right now. Try again.');
      }
    } on ApiError catch (e) {
      if (!mounted) return;
      final mapped = mapOwnerCallbackError(e);
      showSnack(
        context,
        mapped.message,
        action: mapped.showProfile
            ? SnackBarAction(
                label: 'Open Profile',
                onPressed: () => context.push('/more/profile'),
              )
            : null,
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final view = widget.view;
    final now = view.now;
    final at = r.createdAt;
    final isCall = r.action == 'call';
    final within = at != null && now.difference(at) <= recentWindow;
    final urgent = widget.urgent || r.id == view.target?.id;
    final (Color edge, Color icBg, Color icFg) = urgent
        ? (_C.red, const Color(0xFFFFE3DD), _C.red)
        : isCall && within
        ? (_C.blue, const Color(0xFFDBEAFE), _C.blue)
        : !isCall
        ? (_C.wa, const Color(0xFFDCFCE7), _C.wa)
        : (_C.line, const Color(0xFFF3F4F6), _C.grey400);
    final idx = view.tags.indexWhere((t) => t.token == r.token);
    final tag = idx >= 0 ? view.tags[idx] : null;
    final plate = tag == null
        ? 'Unknown vehicle'
        : (tag.plateNumber ?? tag.token);
    final color = vehicleColor(idx);
    final masked = r.hasPhone ? '•••• ${r.phoneLast4 ?? ''}' : 'Unknown caller';
    final outcome = outcomeLabel(r);
    final good = isCall ? r.callOutcome == 'answered' : true;
    final spoken = isCall ? callDurationLabel(r.callDuration) : '';
    final loc = r.scannerLocationLabel;
    final mapUrl = r.carLocationMapUrl;
    return _EdgeCard(
      accent: edge,
      radius: widget.radius,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        child: Row(
          children: [
            Container(
              width: 42,
              height: 42,
              decoration: BoxDecoration(
                color: icBg,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(
                isCall
                    ? Icons.call_outlined
                    : Icons.chat_bubble_outline_rounded,
                size: 18,
                color: icFg,
              ),
            ),
            const SizedBox(width: 13),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '$masked contacted you',
                    style: wt(14.08, weight: FontWeight.w800, height: 1.35),
                  ),
                  const SizedBox(height: 3),
                  Wrap(
                    crossAxisAlignment: WrapCrossAlignment.center,
                    spacing: 5,
                    runSpacing: 4,
                    children: [
                      _PlateChip(
                        plate: plate,
                        color: color,
                        icon: vehicleIconAsset(tag?.vehicleType),
                      ),
                      Text(
                        isCall ? 'Call' : 'WhatsApp',
                        style: wt(11.84, color: _C.grey),
                      ),
                      if (outcome != null)
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 7,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            color: good
                                ? const Color(0xFFDCFCE7)
                                : const Color(0xFFFEE2E2),
                            borderRadius: BorderRadius.circular(20),
                          ),
                          child: Text(
                            outcome,
                            style: wt(
                              9.6,
                              weight: FontWeight.w700,
                              color: good
                                  ? const Color(0xFF14532D)
                                  : const Color(0xFFB91C1C),
                            ),
                          ),
                        ),
                      if (spoken.isNotEmpty)
                        Text(spoken, style: wt(10.72, color: _C.grey400)),
                    ],
                  ),
                  const SizedBox(height: 4), // .pt-act-det margin
                  if (loc != null && loc.isNotEmpty) ...[
                    GestureDetector(
                      onTap:
                          mapUrl != null &&
                              mapUrl.startsWith('https://www.google.com/maps/')
                          ? () => ownerLaunch(Uri.parse(mapUrl))
                          : null,
                      child: Row(
                        children: [
                          const Icon(
                            Icons.place_outlined,
                            size: 11,
                            color: _C.grey400,
                          ),
                          const SizedBox(width: 4),
                          Flexible(
                            child: Text(
                              mapUrl != null ? '$loc · Open in Maps' : loc,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: wt(11.04, color: _C.grey, height: 1.36),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 3), // .pt-act-loc margin
                  ],
                  if (at != null)
                    Text(
                      '${exactTime(at, now)} · ${timeAgo(now.difference(at))}',
                      style: wt(
                        10.72,
                        weight: FontWeight.w600,
                        color: _C.grey400,
                        height: 1.4,
                      ),
                    ),
                ],
              ),
            ),
            ?_cta(context, view.ctaFor(r)),
          ],
        ),
      ),
    );
  }

  /// welcome.js's cta, on the inAndroidApp() branches: nothing is sold here.
  Widget? _cta(BuildContext context, RowCta cta) {
    Widget note(String text, {VoidCallback? onTap}) => Padding(
      padding: const EdgeInsets.only(left: 13),
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: BoxDecoration(
            color: const Color(0xFFFEF3C7),
            borderRadius: BorderRadius.circular(9),
          ),
          child: Text(
            text,
            textAlign: TextAlign.center,
            style: wt(
              11.52,
              weight: FontWeight.w700,
              color: _C.amber,
              height: 1.25,
            ),
          ),
        ),
      ),
    );
    switch (cta) {
      case RowCta.none:
        return null;
      case RowCta.premiumNeeded:
        return note('Premium\nto call back', onTap: () => context.go('/shop'));
      case RowCta.freeTimeUsed:
        return note('Free time\nused up');
      case RowCta.addPhone:
        return note('Add phone\nto call back');
      case RowCta.renewNeeded:
        return note('Call service\nended');
      case RowCta.callBack:
        return Padding(
          padding: const EdgeInsets.only(left: 13),
          child: Opacity(
            opacity: _busy ? 0.6 : 1,
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: _busy ? null : _callBack,
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 9,
                ),
                decoration: BoxDecoration(
                  color: _C.red,
                  borderRadius: BorderRadius.circular(11),
                ),
                child: Text(
                  'Call Back',
                  style: wt(
                    12.8,
                    weight: FontWeight.w800,
                    color: Colors.white,
                    spacing: 0.256,
                  ),
                ),
              ),
            ),
          ),
        );
    }
  }
}

/// welcome.js plateChip: the plate in the vehicle's colour, with its icon.
class _PlateChip extends StatelessWidget {
  const _PlateChip({
    required this.plate,
    required this.color,
    required this.icon,
  });

  final String plate;
  final ({Color bg, Color accent}) color;
  final String icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.bg,
        borderRadius: BorderRadius.circular(7),
        border: Border.all(color: color.accent.withValues(alpha: 0.2)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Image.asset(icon, width: 13, height: 13, fit: BoxFit.contain),
          const SizedBox(width: 5),
          Text(
            plate,
            style: wt(
              10.72,
              weight: FontWeight.w800,
              color: color.accent,
              spacing: 0.536,
              height: 1.35,
              family: 'monospace',
            ),
          ),
        ],
      ),
    );
  }
}

// ── Drawing helpers ───────────────────────────────────────────────────────

enum _Glyph { check, cross, star, search, chevron, plusCircle, tag }

/// The page's small inline SVGs, drawn on their 24-unit grid.
class _StrokeIcon extends StatelessWidget {
  const _StrokeIcon(this.glyph, {required this.color, this.strokeWidth = 2});

  final _Glyph glyph;
  final Color color;
  final double strokeWidth;

  @override
  Widget build(BuildContext context) =>
      CustomPaint(painter: _GlyphPainter(glyph, color, strokeWidth));
}

class _GlyphPainter extends CustomPainter {
  const _GlyphPainter(this.glyph, this.color, this.strokeWidth);

  final _Glyph glyph;
  final Color color;
  final double strokeWidth;

  @override
  void paint(Canvas canvas, Size size) {
    final s = size.width / 24;
    final p = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth * s
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    Offset o(double x, double y) => Offset(x * s, y * s);
    switch (glyph) {
      case _Glyph.check:
        canvas.drawCircle(o(12, 12), 10 * s, p);
        canvas.drawPath(
          Path()
            ..moveTo(8 * s, 12 * s)
            ..lineTo(11 * s, 15 * s)
            ..lineTo(16 * s, 10 * s),
          p,
        );
      case _Glyph.cross:
        canvas.drawCircle(o(12, 12), 10 * s, p);
        canvas.drawLine(o(15, 9), o(9, 15), p);
        canvas.drawLine(o(9, 9), o(15, 15), p);
      case _Glyph.star:
        final path = Path()
          ..moveTo(12 * s, 2 * s)
          ..lineTo(14.4 * s, 9.4 * s)
          ..lineTo(22 * s, 9.4 * s)
          ..lineTo(16 * s, 13.8 * s)
          ..lineTo(18.3 * s, 21 * s)
          ..lineTo(12 * s, 16.6 * s)
          ..lineTo(5.7 * s, 21 * s)
          ..lineTo(8 * s, 13.8 * s)
          ..lineTo(2 * s, 9.4 * s)
          ..lineTo(9.6 * s, 9.4 * s)
          ..close();
        canvas.drawPath(path, p);
      case _Glyph.search:
        canvas.drawCircle(o(11, 11), 8 * s, p);
        canvas.drawLine(o(21, 21), o(16.65, 16.65), p);
      case _Glyph.chevron:
        canvas.drawPath(
          Path()
            ..moveTo(9 * s, 18 * s)
            ..lineTo(15 * s, 12 * s)
            ..lineTo(9 * s, 6 * s),
          p,
        );
      case _Glyph.plusCircle:
        canvas.drawCircle(o(12, 12), 10 * s, p);
        canvas.drawLine(o(12, 8), o(12, 16), p..strokeWidth = 2 * s);
        canvas.drawLine(o(8, 12), o(16, 12), p);
      case _Glyph.tag:
        final path = Path()
          ..moveTo(20.59 * s, 13.41 * s)
          ..lineTo(13.42 * s, 20.58 * s)
          ..arcToPoint(
            o(10.59, 20.58),
            radius: Radius.circular(2 * s),
            clockwise: true,
          )
          ..lineTo(2 * s, 12 * s)
          ..lineTo(2 * s, 2 * s)
          ..lineTo(12 * s, 2 * s)
          ..lineTo(20.59 * s, 10.59 * s)
          ..arcToPoint(
            o(20.59, 13.41),
            radius: Radius.circular(2 * s),
            clockwise: true,
          )
          ..close();
        canvas.drawPath(path, p);
        canvas.drawCircle(o(7, 7), 1.5 * s, Paint()..color = color);
    }
  }

  @override
  bool shouldRepaint(_GlyphPainter old) =>
      old.glyph != glyph ||
      old.color != color ||
      old.strokeWidth != strokeWidth;
}

/// A filled rounded box with a dashed outline (.pt-vadd-lc, .pt-act-empty).
class _DashedBox extends CustomPainter {
  const _DashedBox({
    required this.color,
    required this.width,
    required this.radius,
    required this.fill,
  });

  final Color color;
  final double width;
  final double radius;
  final Color fill;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = RRect.fromRectAndRadius(
      Offset.zero & size,
      Radius.circular(radius),
    );
    canvas.drawRRect(rect, Paint()..color = fill);
    final outline = Path()..addRRect(rect.deflate(width / 2));
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = width;
    // Chrome dashes a 1.5px border in roughly 4.5px dashes and gaps.
    const dash = 4.5, gap = 4.5;
    for (final metric in outline.computeMetrics()) {
      var d = 0.0;
      while (d < metric.length) {
        canvas.drawPath(metric.extractPath(d, d + dash), paint);
        d += dash + gap;
      }
    }
  }

  @override
  bool shouldRepaint(_DashedBox old) =>
      old.color != color ||
      old.width != width ||
      old.radius != radius ||
      old.fill != fill;
}
