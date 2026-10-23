// The More tab: the web owner dashboard's burger-menu drawer (welcome.html
// #menuDrawer, owner-welcome.css "Burger menu drawer"), drawn to its
// measurements at phone width as a full tab rather than a slide-in panel.
//
// Profile header, the sticky vehicle label, the User Info accordion, the
// My Vehicle / Alerts & Notifications / Contact & Safety / Location /
// Tag & Shop sections with the same rows, toggles and sub-panels, then the
// Remove Vehicle and Sign Out rows after Get a Tag Replacement (the web pins
// them under the list as buttons; here they are two more rows so nothing sits
// over the floating nav). The menu is scoped to one vehicle, chosen with the
// chips, as the web's is (welcome.js _fillMenu / selectV).
//
// Tag Active, Calls Active and the SOS number write to the same endpoints the
// web calls; the other switches are remembered on the device only, as the web
// keeps them in localStorage (saveSw).

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../../core/api.dart';
import '../../core/app_state.dart';
import '../../core/models.dart';
import '../../core/platform.dart';
import '../../core/web_text.dart';
import '../../core/widgets.dart';
import '../owner/add_vehicle_sheet.dart';
import '../owner/home_web.dart' show vehicleColors, vehicleIconAsset;
import '../owner/owner_common.dart';
import '../owner/tag_etag.dart';
import '../shop/models.dart';

abstract final class _C {
  static const navy = Color(0xFF03162D);
  static const navy2 = Color(0xFF1A3A6E);
  static const red = Color(0xFFFF2700);
  static const slate = Color(0xFF374151);
  static const ink = Color(0xFF323232);
  static const grey = Color(0xFF6B7280);
  static const grey400 = Color(0xFF9CA3AF);
  static const grey300 = Color(0xFFD1D5DB);
  static const line = Color(0xFFE5E7EB);
  static const hair = Color(0xFFF3F4F6);
  static const panel = Color(0xFFFAFAFA);
  static const rose = Color(0xFF9F1239);
  static const roseBg = Color(0xFFFFF1F2);
  static const roseLine = Color(0xFFFECDD3);
  static const danger = Color(0xFFDC2626);
  static const dangerBg = Color(0xFFFEE2E2);
  static const id = Color(0xFF8CA4C4);
}

/// The switches the web keeps in localStorage (welcome.js _loadSw), with its
/// defaults. Remembered for this run only.
class _Switches {
  bool pushNotif = true;
  bool emailAlerts = true;
  bool whatsapp = false;
  bool location = true;
  bool callMasking = true;
}

/// welcome.js _maskingNote.
String maskingNote(Tag t) {
  final ca = t.callAccess;
  if (ca == null) {
    return "Call masking starts once this vehicle's tag is active.";
  }
  if (ca.masking) {
    return 'Hides your real number from callers. Disable to expose your actual phone number.';
  }
  if (ca.tier == 'premium-lapsed') {
    return "Call masking has ended for this tag. It continues on a subscription. We'll let you know when that's available.";
  }
  return "This E-Tag's one free masked contact has been used. Get the official ParkTag sticker to keep your number hidden.";
}

/// welcome.js ORDER_STATUS_LABELS / humanizeOrderStatus.
String menuOrderStatus(String status) => switch (status) {
  'processing' || '' => 'Preparing to ship',
  'cod_confirmed' => 'Confirmed · Cash on delivery',
  'booking_failed' => "Couldn't book courier yet. We'll retry",
  'booked' => 'Booked with courier',
  _ => status.replaceAll('_', ' '),
};

class MoreScreen extends StatefulWidget {
  const MoreScreen({super.key});

  @override
  State<MoreScreen> createState() => _MoreScreenState();
}

class _MoreScreenState extends State<MoreScreen> {
  int _sel = 0;
  String? _open; // the one open accordion, as on the web
  final _switches = <String, _Switches>{};
  Future<List<ShopOrder>>? _orders;
  final _sos = TextEditingController();
  String? _sosFor; // which tag the field was seeded for
  Object? _error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && AppScope.read(context).dashboard == null) _load();
    });
  }

  @override
  void dispose() {
    _sos.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      await AppScope.read(context).refresh();
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<bool> _run(Future<void> Function(ApiClient api) step) async {
    final app = AppScope.read(context);
    try {
      await step(app.api);
      return true;
    } catch (e) {
      if (mounted) showError(context, e);
      return false;
    }
  }

  void _refreshIf(bool ok) {
    if (ok && mounted) AppScope.read(context).refresh().catchError((_) {});
  }

  void _toggle(String key) => setState(() => _open = _open == key ? null : key);

  _Switches _sw(Tag t) => _switches.putIfAbsent(t.id, _Switches.new);

  Future<void> _signOut() async {
    final app = AppScope.read(context);
    await app.signOut();
    if (mounted) context.go('/hub');
  }

  Future<void> _removeVehicle(Tag tag) async {
    final plate = tag.plateNumber ?? 'this vehicle';
    final yes = await confirm(
      context,
      title: 'Remove $plate?',
      body: 'This cannot be undone.',
      ok: 'Remove',
    );
    if (!yes || !mounted) return;
    final ok = await _run((api) => api.delete('/api/owner/tags/${tag.id}'));
    if (!ok || !mounted) return;
    setState(() {
      _sel = 0;
      _open = null;
    });
    showSnack(context, '$plate removed.');
    AppScope.read(context).refresh().catchError((_) {});
  }

  Future<void> _saveSos(Tag tag) async {
    final num = _sos.text.trim();
    if (num.isEmpty) {
      showSnack(context, 'Please enter an emergency contact number.');
      return;
    }
    final ok = await _run(
      (api) => api.post('/api/owner/tags/${tag.id}/emergency-contact', {
        'emergencyContact': num,
      }),
    );
    if (!ok || !mounted) return;
    showSnack(context, 'Emergency contact saved.');
    await AppScope.read(context).refresh().catchError((_) {});
  }

  Future<void> _download(Tag tag) async {
    final sheet = EtagSheet(tag);
    await PtPlatform.shareImage(await etagSheetPng(sheet), sheet.fileName);
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final tags = app.tags;
    if (_sel >= tags.length) _sel = 0;
    final tag = tags.isEmpty ? null : tags[_sel];
    final color = tags.isEmpty
        ? vehicleColors.first
        : vehicleColors[_sel % vehicleColors.length];
    final owner = app.owner;
    final raw = owner?.raw ?? const <String, dynamic>{};
    final backupSet = (owner?.backupMobile ?? '').isNotEmpty;
    final bottomInset = MediaQuery.paddingOf(context).bottom;
    return Scaffold(
      backgroundColor: Colors.white,
      body: Column(
        children: [
          _ProfileHeader(owner: owner, accent: color.accent),
          Expanded(
            child: app.dashboard == null
                ? (_error != null
                      ? ListView(
                          padding: const EdgeInsets.all(16),
                          children: [ErrorCard.from(_error!, onRetry: _load)],
                        )
                      : const Padding(
                          padding: EdgeInsets.all(16),
                          child: Skeleton(),
                        ))
                : ListView(
                    // The web's 8px spacer, then room for the floating nav.
                    padding: EdgeInsets.only(bottom: bottomInset + 8),
                    children: [
                      if (tag != null) _StickyVehicle(tag: tag, color: color),
                      _Accordion(
                        open: _open == 'user-info',
                        onTap: () => _toggle('user-info'),
                        iconBg: const Color(0xFFFFE3DD),
                        iconColor: _C.red,
                        icon: Icons.person_outline_rounded,
                        label: 'User Info',
                        sub: backupSet ? null : 'Add a backup number',
                        badge: backupSet ? null : '1',
                        child: _UserInfoPanel(
                          tag: tag,
                          owner: owner,
                          backupDeclined: raw['backupDeclined'] as String?,
                          run: _run,
                        ),
                      ),
                      const _SectionLabel('My Vehicle'),
                      if (tags.length > 1)
                        _Chips(
                          tags: tags,
                          selected: _sel,
                          onSelect: (i) => setState(() {
                            _sel = i;
                            _open = null;
                          }),
                        ),
                      if (tag != null) _VehicleSummary(tag: tag, color: color),
                      _LinkRow(
                        iconBg: const Color(0xFFFFEDEA),
                        iconColor: _C.red,
                        icon: Icons.add_circle_outline_rounded,
                        label: 'Add Vehicle',
                        onTap: () => showAddVehicleSheet(context),
                      ),
                      if (tag != null) ...[
                        _Accordion(
                          open: _open == 'tags-call',
                          onTap: () => _toggle('tags-call'),
                          iconBg: const Color(0xFFF0FDF4),
                          iconColor: const Color(0xFF16A34A),
                          icon: Icons.phone_outlined,
                          label: 'Tags & Call',
                          child: Column(
                            children: [
                              if ((owner?.mobile ?? '').isEmpty)
                                const _MobileMissingAlert(),
                              _ToggleRow(
                                label: 'Tag Active',
                                sub: 'Enable your ParkTag sticker',
                                value: tag.isActive,
                                onChanged: (v) => _run(
                                  (api) => api.post(
                                    '/api/owner/tags/${tag.id}/status',
                                    {'status': v ? 'active' : 'inactive'},
                                  ),
                                ).then(_refreshIf),
                              ),
                              _ToggleRow(
                                label: 'Calls Active',
                                sub: 'Allow callers to reach you via tag',
                                value: !tag.callsPaused,
                                first: false,
                                onChanged: (v) => _run(
                                  (api) => api.post(
                                    '/api/owner/tags/${tag.id}/calls',
                                    {'active': v},
                                  ),
                                ).then(_refreshIf),
                              ),
                            ],
                          ),
                        ),
                        _Accordion(
                          open: _open == 'orders',
                          onTap: () {
                            _toggle('orders');
                            _orders ??= _loadOrders();
                          },
                          iconBg: const Color(0xFFEFF6FF),
                          iconColor: const Color(0xFF2563EB),
                          icon: Icons.local_shipping_outlined,
                          label: 'My Orders',
                          child: _OrdersPanel(
                            orders: _orders,
                            onRetry: () =>
                                setState(() => _orders = _loadOrders()),
                          ),
                        ),
                        _Accordion(
                          open: _open == 'masking',
                          onTap: () => _toggle('masking'),
                          iconBg: _C.hair,
                          iconColor: _C.grey,
                          icon: Icons.phone_disabled_outlined,
                          label: 'Call Masking',
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              _Note(maskingNote(tag)),
                              _ToggleRow(
                                label: 'Keep number private',
                                sub: 'Your number stays hidden from callers',
                                value:
                                    (tag.callAccess?.masking ?? false) &&
                                    _sw(tag).callMasking,
                                locked: !(tag.callAccess?.masking ?? false),
                                onChanged: (v) =>
                                    setState(() => _sw(tag).callMasking = v),
                              ),
                            ],
                          ),
                        ),
                        const _SectionLabel('Alerts & Notifications'),
                        _Accordion(
                          open: _open == 'notif',
                          onTap: () => _toggle('notif'),
                          iconBg: const Color(0xFFFFE3DD),
                          iconColor: _C.red,
                          icon: Icons.notifications_none_rounded,
                          label: 'Notifications',
                          child: Column(
                            children: [
                              _ToggleRow(
                                label: 'Push Notifications',
                                sub: 'Alert when someone scans your tag',
                                value: _sw(tag).pushNotif,
                                onChanged: (v) =>
                                    setState(() => _sw(tag).pushNotif = v),
                              ),
                              _ToggleRow(
                                label: 'Email Alerts',
                                sub: 'Receive scan reports by email',
                                value: _sw(tag).emailAlerts,
                                first: false,
                                onChanged: (v) =>
                                    setState(() => _sw(tag).emailAlerts = v),
                              ),
                            ],
                          ),
                        ),
                        _Accordion(
                          open: _open == 'whatsapp',
                          onTap: () => _toggle('whatsapp'),
                          iconBg: const Color(0xFFDCFCE7),
                          iconColor: const Color(0xFF16A34A),
                          icon: Icons.chat_bubble_outline_rounded,
                          label: 'WhatsApp Notifications',
                          child: _ToggleRow(
                            label: 'WhatsApp Alerts',
                            sub:
                                'Get notified via WhatsApp when tag is scanned',
                            value: _sw(tag).whatsapp,
                            onChanged: (v) =>
                                setState(() => _sw(tag).whatsapp = v),
                          ),
                        ),
                        const _SectionLabel('Contact & Safety'),
                        _LinkRow(
                          iconBg: const Color(0xFFEFF6FF),
                          iconColor: const Color(0xFF2563EB),
                          icon: Icons.chat_bubble_outline_rounded,
                          label: 'View Contact Page',
                          external: true,
                          onTap: () => tag.scanUrl.isEmpty
                              ? showSnack(
                                  context,
                                  'Contact page not yet available for this tag.',
                                )
                              : PtPlatform.openCustomTab(tag.scanUrl),
                        ),
                        _Accordion(
                          open: _open == 'sos',
                          onTap: () => _toggle('sos'),
                          iconBg: _C.roseBg,
                          iconColor: const Color(0xFFE11D48),
                          icon: Icons.warning_amber_rounded,
                          label: 'Emergency / SOS',
                          required: true,
                          pill: tag.hasEmergencyContact ? null : 'Required',
                          child: _SosPanel(
                            tag: tag,
                            controller: _sosFor == tag.id
                                ? _sos
                                : (_sos
                                    ..text = tag.emergencyContact ?? ''
                                    ..selection = TextSelection.collapsed(
                                      offset:
                                          (tag.emergencyContact ?? '').length,
                                    )),
                            onSave: () {
                              _sosFor = tag.id;
                              _saveSos(tag);
                            },
                          ),
                        ),
                        const _SectionLabel('Location'),
                        _Accordion(
                          open: _open == 'location',
                          onTap: () => _toggle('location'),
                          iconBg: _C.dangerBg,
                          iconColor: _C.danger,
                          icon: Icons.place_outlined,
                          label: 'Location Access',
                          child: _ToggleRow(
                            label: 'Check Scan Locations',
                            sub: 'See where your tag was scanned',
                            value: _sw(tag).location,
                            onChanged: (v) =>
                                setState(() => _sw(tag).location = v),
                          ),
                        ),
                        const _SectionLabel('Tag & Shop'),
                        _LinkRow(
                          iconBg: const Color(0xFFFFE3DD),
                          iconColor: _C.red,
                          icon: Icons.download_outlined,
                          label: tag.premium
                              ? 'Download Premium Tag'
                              : 'Download E-Tag',
                          onTap: () => _download(tag),
                        ),
                        _LinkRow(
                          iconBg: const Color(0xFFFEF3C7),
                          iconColor: const Color(0xFFB45309),
                          icon: Icons.star_outline_rounded,
                          label: 'Premium & Official Sticker',
                          trailing: tag.premium ? const _PremiumBadge() : null,
                          onTap: () => context.go('/shop'),
                        ),
                        _LinkRow(
                          iconBg: const Color(0xFFFFE3DD),
                          iconColor: _C.red,
                          icon: Icons.autorenew_rounded,
                          label: 'Get a Tag Replacement',
                          onTap: () =>
                              context.push('/tags/${tag.id}?open=replacement'),
                        ),
                        _LinkRow(
                          iconBg: _C.dangerBg,
                          iconColor: _C.danger,
                          icon: Icons.delete_outline_rounded,
                          label: 'Remove Vehicle',
                          onTap: () => _removeVehicle(tag),
                        ),
                      ],
                      _LinkRow(
                        iconBg: _C.hair,
                        iconColor: _C.slate,
                        icon: Icons.logout_rounded,
                        label: 'Sign Out',
                        onTap: _signOut,
                      ),
                    ],
                  ),
          ),
        ],
      ),
    );
  }

  Future<List<ShopOrder>> _loadOrders() async {
    final res = await AppScope.read(context).api.get('/api/owner/orders');
    final list = res['orders'];
    return [
      if (list is List)
        for (final o in list)
          if (o is Map<String, dynamic>) ShopOrder.fromJson(o),
    ];
  }
}

/// `.pt-menu-ph`: gradient header with the avatar initial, name, id and the
/// close button; its 3px bottom edge takes the vehicle's colour.
class _ProfileHeader extends StatelessWidget {
  const _ProfileHeader({required this.owner, required this.accent});

  final Owner? owner;
  final Color accent;

  @override
  Widget build(BuildContext context) {
    final name = (owner?.displayName ?? '').trim();
    final initial = name.isNotEmpty ? name[0].toUpperCase() : '?';
    final id = owner?.email ?? owner?.mobile ?? '';
    return Container(
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [_C.navy, _C.navy2],
        ),
        border: Border(bottom: BorderSide(color: accent, width: 3)),
      ),
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 18, 16, 18),
          child: Row(
            children: [
              Container(
                width: 46,
                height: 46,
                alignment: Alignment.center,
                decoration: const BoxDecoration(
                  color: _C.red,
                  shape: BoxShape.circle,
                ),
                child: Text(
                  initial,
                  style: wt(
                    18.4,
                    weight: FontWeight.w800,
                    color: Colors.white,
                    height: 1.2,
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      name.isNotEmpty ? name : 'ParkTag User',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: wt(
                        15.2,
                        weight: FontWeight.w700,
                        color: Colors.white,
                        height: 20 / 15.2,
                      ),
                    ),
                    const SizedBox(height: 3),
                    ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 170),
                      child: Text(
                        id,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: wt(11.68, color: _C.id, height: 16 / 11.68),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              Material(
                color: const Color(0x26FFFFFF),
                shape: const CircleBorder(),
                child: InkWell(
                  customBorder: const CircleBorder(),
                  onTap: () => context.go('/home'),
                  child: const SizedBox(
                    width: 30,
                    height: 30,
                    child: Icon(
                      Icons.close_rounded,
                      size: 16,
                      color: Color(0xD9FFFFFF),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// `.pt-sticky-veh`: the selected vehicle, tinted with its colour.
class _StickyVehicle extends StatelessWidget {
  const _StickyVehicle({required this.tag, required this.color});

  final Tag tag;
  final ({Color bg, Color accent}) color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
      decoration: BoxDecoration(
        color: color.bg.withValues(alpha: .8),
        border: Border(
          left: BorderSide(color: color.accent, width: 4),
          bottom: const BorderSide(color: _C.hair),
        ),
      ),
      child: Row(
        children: [
          Container(
            width: 9,
            height: 9,
            decoration: BoxDecoration(
              color: color.accent,
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: 9),
          Text(
            tag.plateNumber ?? '-',
            style: wt(
              14.08,
              weight: FontWeight.w800,
              height: 19 / 14.08,
              spacing: .2816,
            ),
          ),
          const SizedBox(width: 9),
          Text(
            '·',
            style: wt(12.48, color: _C.grey300, height: 16 / 12.48),
          ),
          const SizedBox(width: 9),
          Text(
            tag.vehicleLabel,
            style: wt(
              11.68,
              weight: FontWeight.w600,
              color: _C.grey,
              height: 16 / 11.68,
            ),
          ),
        ],
      ),
    );
  }
}

/// `.pt-msec`: an uppercase section label.
class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 6),
      child: Text(
        text.toUpperCase(),
        style: wt(
          10.88,
          weight: FontWeight.w800,
          color: _C.grey400,
          height: 21 / 10.88,
          spacing: .9792,
        ),
      ),
    );
  }
}

/// `.pt-mchips`: one pill per vehicle, the chosen one in its colour.
class _Chips extends StatelessWidget {
  const _Chips({
    required this.tags,
    required this.selected,
    required this.onSelect,
  });

  final List<Tag> tags;
  final int selected;
  final ValueChanged<int> onSelect;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 6),
      child: Row(
        children: [
          for (var i = 0; i < tags.length; i++) ...[
            if (i > 0) const SizedBox(width: 7),
            _Chip(
              label: tags[i].plateNumber ?? '?',
              active: i == selected,
              accent: vehicleColors[i % vehicleColors.length].accent,
              onTap: () => onSelect(i),
            ),
          ],
        ],
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({
    required this.label,
    required this.active,
    required this.accent,
    required this.onTap,
  });

  final String label;
  final bool active;
  final Color accent;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: active ? accent : Colors.white,
        border: Border.all(color: active ? accent : _C.line),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Material(
        type: MaterialType.transparency,
        child: InkWell(
          borderRadius: BorderRadius.circular(20),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 5),
            child: Text(
              label,
              style: wt(
                12.16,
                weight: FontWeight.w700,
                color: active ? Colors.white : _C.slate,
                height: 14 / 12.16,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// `.pt-mvsm`: the vehicle summary pill under the chips.
class _VehicleSummary extends StatelessWidget {
  const _VehicleSummary({required this.tag, required this.color});

  final Tag tag;
  final ({Color bg, Color accent}) color;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 4, 16, 8),
      padding: const EdgeInsets.fromLTRB(14, 11, 14, 11),
      decoration: BoxDecoration(
        color: const Color(0xFFF9FAFB),
        border: Border.all(color: color.accent.withValues(alpha: .33)),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        children: [
          Container(
            width: 36,
            height: 36,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: color.bg,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Image.asset(
              vehicleIconAsset(tag.vehicleType),
              width: 22,
              height: 22,
              fit: BoxFit.contain,
            ),
          ),
          const SizedBox(width: 11),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  tag.plateNumber ?? '-',
                  style: wt(14.4, weight: FontWeight.w800, height: 20 / 14.4),
                ),
                const SizedBox(height: 2),
                Text(
                  tag.vehicleLabel,
                  style: wt(11.52, color: _C.grey, height: 15 / 11.52),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// `.pt-mi-r` / `.pt-mi-a`: the row itself: icon box, label (with its
/// optional red sub-line, badge or "Required" pill) and the chevron.
class _MenuRow extends StatelessWidget {
  const _MenuRow({
    required this.iconBg,
    required this.iconColor,
    required this.icon,
    required this.label,
    required this.onTap,
    this.sub,
    this.badge,
    this.pill,
    this.required = false,
    this.trailing,
    this.external = false,
    this.open = false,
  });

  final Color iconBg;
  final Color iconColor;
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final String? sub;
  final String? badge;
  final String? pill;
  final bool required;
  final Widget? trailing;
  final bool external;
  final bool open;

  @override
  Widget build(BuildContext context) {
    final labelStyle = wt(
      14.08,
      weight: FontWeight.w600,
      color: _C.slate,
      height: 19 / 14.08,
    );
    return Material(
      color: Colors.white,
      child: InkWell(
        onTap: onTap,
        child: Container(
          constraints: const BoxConstraints(minHeight: 58),
          padding: const EdgeInsets.fromLTRB(16, 13, 16, 13),
          decoration: const BoxDecoration(
            border: Border(bottom: BorderSide(color: _C.hair)),
          ),
          child: Row(
            children: [
              Container(
                width: 36,
                height: 36,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: iconBg,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(icon, size: 18, color: iconColor),
              ),
              const SizedBox(width: 11),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(label, style: labelStyle),
                    if (required) ...[
                      const SizedBox(height: 2),
                      Padding(
                        padding: const EdgeInsets.only(left: 3),
                        child: Text(
                          '*',
                          style: wt(
                            14.08,
                            weight: FontWeight.w800,
                            color: _C.red,
                            height: 19 / 14.08,
                          ),
                        ),
                      ),
                    ],
                    if (pill != null) ...[
                      const SizedBox(height: 2),
                      Padding(
                        padding: const EdgeInsets.only(left: 8),
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 7,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            color: _C.roseBg,
                            border: Border.all(color: _C.roseLine),
                            borderRadius: BorderRadius.circular(20),
                          ),
                          child: Text(
                            pill!,
                            style: wt(
                              10.24,
                              weight: FontWeight.w800,
                              color: _C.rose,
                              height: 12 / 10.24,
                              spacing: .2048,
                            ),
                          ),
                        ),
                      ),
                    ],
                    if (sub != null) ...[
                      const SizedBox(height: 2),
                      Text(
                        sub!,
                        style: wt(
                          11.52,
                          weight: FontWeight.w600,
                          color: _C.red,
                          height: 15 / 11.52,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              ?trailing,
              if (badge != null) ...[
                const SizedBox(width: 11),
                Container(
                  constraints: const BoxConstraints(minWidth: 20),
                  height: 20,
                  padding: const EdgeInsets.symmetric(horizontal: 6),
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: _C.red,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    badge!,
                    style: wt(
                      11.2,
                      weight: FontWeight.w800,
                      color: Colors.white,
                      height: 1,
                    ),
                  ),
                ),
              ],
              const SizedBox(width: 11),
              AnimatedRotation(
                turns: open ? .25 : 0,
                duration: const Duration(milliseconds: 220),
                child: Icon(
                  external
                      ? Icons.open_in_new_rounded
                      : Icons.chevron_right_rounded,
                  size: 14,
                  color: external ? const Color(0xFF2563EB) : _C.grey400,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// `.pt-mi-a`: a row that goes somewhere.
class _LinkRow extends StatelessWidget {
  const _LinkRow({
    required this.iconBg,
    required this.iconColor,
    required this.icon,
    required this.label,
    required this.onTap,
    this.trailing,
    this.external = false,
  });

  final Color iconBg;
  final Color iconColor;
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final Widget? trailing;
  final bool external;

  @override
  Widget build(BuildContext context) => _MenuRow(
    iconBg: iconBg,
    iconColor: iconColor,
    icon: icon,
    label: label,
    onTap: onTap,
    trailing: trailing,
    external: external,
  );
}

/// `.pt-mi` with its `.pt-mi-s` sub-panel: a row that opens inline.
class _Accordion extends StatelessWidget {
  const _Accordion({
    required this.open,
    required this.onTap,
    required this.iconBg,
    required this.iconColor,
    required this.icon,
    required this.label,
    required this.child,
    this.sub,
    this.badge,
    this.pill,
    this.required = false,
  });

  final bool open;
  final VoidCallback onTap;
  final Color iconBg;
  final Color iconColor;
  final IconData icon;
  final String label;
  final Widget child;
  final String? sub;
  final String? badge;
  final String? pill;
  final bool required;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _MenuRow(
          iconBg: iconBg,
          iconColor: iconColor,
          icon: icon,
          label: label,
          onTap: onTap,
          sub: sub,
          badge: badge,
          pill: pill,
          required: required,
          open: open,
        ),
        AnimatedSize(
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeInOut,
          alignment: Alignment.topCenter,
          child: open
              ? Container(
                  width: double.infinity,
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 14),
                  decoration: const BoxDecoration(
                    color: _C.panel,
                    border: Border(
                      top: BorderSide(color: _C.hair),
                      bottom: BorderSide(color: _C.hair),
                    ),
                  ),
                  child: child,
                )
              : const SizedBox(width: double.infinity, height: 1),
        ),
      ],
    );
  }
}

/// `.pt-tog` with the iOS-style `.pt-sw` switch.
class _ToggleRow extends StatelessWidget {
  const _ToggleRow({
    required this.label,
    required this.sub,
    required this.value,
    required this.onChanged,
    this.first = true,
    this.locked = false,
  });

  final String label;
  final String sub;
  final bool value;
  final ValueChanged<bool> onChanged;
  final bool first;
  final bool locked;

  @override
  Widget build(BuildContext context) {
    final muted = locked ? _C.grey400 : _C.slate;
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 9),
      decoration: BoxDecoration(
        border: first ? null : const Border(top: BorderSide(color: _C.hair)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  label,
                  style: wt(
                    13.44,
                    weight: FontWeight.w600,
                    color: muted,
                    height: 18 / 13.44,
                  ),
                ),
                const SizedBox(height: 2),
                Text(sub, style: wt(11.2, color: _C.grey400, height: 1.4)),
              ],
            ),
          ),
          const SizedBox(width: 12),
          Opacity(
            opacity: locked ? .55 : 1,
            child: _Switch(value: value, onChanged: locked ? null : onChanged),
          ),
        ],
      ),
    );
  }
}

/// `.pt-sw`: 44x25, grey or red track, 19px white knob 3px in.
class _Switch extends StatelessWidget {
  const _Switch({required this.value, required this.onChanged});

  final bool value;
  final ValueChanged<bool>? onChanged;

  @override
  Widget build(BuildContext context) {
    final track = onChanged == null
        ? _C.line
        : value
        ? _C.red
        : _C.grey300;
    return GestureDetector(
      onTap: onChanged == null ? null : () => onChanged!(!value),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        width: 44,
        height: 25,
        decoration: BoxDecoration(
          color: track,
          borderRadius: BorderRadius.circular(25),
        ),
        child: AnimatedAlign(
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeInOut,
          alignment: value ? Alignment.centerRight : Alignment.centerLeft,
          child: Container(
            width: 19,
            height: 19,
            margin: const EdgeInsets.symmetric(horizontal: 3),
            decoration: const BoxDecoration(
              color: Colors.white,
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color: Color(0x33000000),
                  offset: Offset(0, 1),
                  blurRadius: 3,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// `.pt-snote`.
class _Note extends StatelessWidget {
  const _Note(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 11),
    child: Text(text, style: wt(12.64, color: _C.grey, height: 1.6)),
  );
}

/// `.pt-irow`: an uppercase key on the left, a bold value on the right.
class _InfoRow extends StatelessWidget {
  const _InfoRow(this.label, this.value);

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 8),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: _C.hair)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          _Key(label),
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.right,
              style: wt(
                13.12,
                weight: FontWeight.w700,
                color: _C.ink,
                height: 17 / 13.12,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// `.pt-ik`.
class _Key extends StatelessWidget {
  const _Key(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Text(
    text.toUpperCase(),
    style: wt(
      11.2,
      weight: FontWeight.w700,
      color: _C.grey400,
      height: 15 / 11.2,
      spacing: .56,
    ),
  );
}

/// The User Info sub-panel: vehicle facts, the phone number (with the OTP
/// flow for an owner without one), the backup number and Delete Account.
class _UserInfoPanel extends StatefulWidget {
  const _UserInfoPanel({
    required this.tag,
    required this.owner,
    required this.backupDeclined,
    required this.run,
  });

  final Tag? tag;
  final Owner? owner;
  final String? backupDeclined;
  final Future<bool> Function(Future<void> Function(ApiClient api)) run;

  @override
  State<_UserInfoPanel> createState() => _UserInfoPanelState();
}

class _UserInfoPanelState extends State<_UserInfoPanel> {
  final _mobile = TextEditingController();
  final _otp = TextEditingController();
  final _backup = TextEditingController();
  String? _pendingMobile;
  bool _sending = false;
  bool _editingBackup = false;
  bool _savingBackup = false;
  String? _mobileStatus;
  bool _mobileErr = false;
  String? _backupStatus;
  bool _backupErr = false;

  @override
  void dispose() {
    _mobile.dispose();
    _otp.dispose();
    _backup.dispose();
    super.dispose();
  }

  String _digits(String s) => s.replaceAll(RegExp(r'\D'), '');

  Future<void> _sendCode() async {
    final d = _digits(_mobile.text);
    if (!RegExp(r'^[6-9]\d{9}$').hasMatch(d)) {
      setState(() {
        _mobileStatus = 'Enter a valid 10-digit number.';
        _mobileErr = true;
      });
      return;
    }
    final mobile = '+91$d';
    setState(() => _sending = true);
    final api = AppScope.read(context).api;
    try {
      await api.post('/api/owner/mobile/send-otp', {'mobile': mobile});
      setState(() {
        _pendingMobile = mobile;
        _mobileStatus = 'Code sent to $mobile. Enter it below to confirm.';
        _mobileErr = false;
      });
    } on ApiError catch (e) {
      setState(() {
        _mobileStatus = e.message;
        _mobileErr = true;
      });
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _verify() async {
    final otp = _otp.text.trim();
    final mobile = _pendingMobile;
    if (mobile == null) return;
    if (!RegExp(r'^\d{6}$').hasMatch(otp)) {
      setState(() {
        _mobileStatus = 'Enter the 6-digit code.';
        _mobileErr = true;
      });
      return;
    }
    final app = AppScope.read(context);
    try {
      await app.api.post('/api/owner/mobile', {'mobile': mobile, 'otp': otp});
      setState(() {
        _pendingMobile = null;
        _mobileStatus = 'Phone number verified and saved.';
        _mobileErr = false;
      });
      await app.refresh().catchError((_) {});
      if (mounted) {
        showSnack(context, 'Phone number verified. Call Back is now enabled.');
      }
    } on ApiError catch (e) {
      setState(() {
        _mobileStatus = e.message;
        _mobileErr = true;
      });
    }
  }

  Future<void> _saveBackup() async {
    final d = _digits(_backup.text);
    if (!RegExp(r'^[6-9]\d{9}$').hasMatch(d)) {
      setState(() {
        _backupStatus = 'Enter a valid 10-digit mobile number.';
        _backupErr = true;
      });
      return;
    }
    final yes = await confirm(
      context,
      title: 'Is this number right?',
      body: '+91 $d will be rung when your own phone does not answer.',
      ok: 'Yes, save it',
    );
    if (!yes || !mounted) return;
    setState(() => _savingBackup = true);
    final ok = await widget.run(
      (api) => api.post('/api/owner/backup-mobile', {'mobile': '+91$d'}),
    );
    if (!mounted) return;
    setState(() {
      _savingBackup = false;
      _editingBackup = false;
      _backupStatus = ok ? 'Backup number saved.' : null;
      _backupErr = false;
    });
    if (ok) AppScope.read(context).refresh().catchError((_) {});
  }

  Future<void> _removeBackup() async {
    final yes = await confirm(
      context,
      title: 'Remove backup number?',
      body: 'Calls will only ring your main number.',
      ok: 'Remove',
    );
    if (!yes || !mounted) return;
    final ok = await widget.run(
      (api) => api.delete('/api/owner/backup-mobile'),
    );
    if (ok && mounted) AppScope.read(context).refresh().catchError((_) {});
  }

  @override
  Widget build(BuildContext context) {
    final tag = widget.tag;
    final owner = widget.owner;
    final mobile = owner?.mobile ?? '';
    final backup = owner?.backupMobile ?? '';
    final backupSet = backup.isNotEmpty;
    final editing = _editingBackup || !backupSet;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _InfoRow('Vehicle Number', tag?.plateNumber ?? '-'),
        _InfoRow('Vehicle Type', tag?.vehicleLabel ?? '-'),
        _InfoRow(
          'Owner',
          owner == null
              ? '-'
              : owner.displayName.isNotEmpty
              ? owner.displayName
              : (owner.email ?? owner.mobile ?? '-'),
        ),
        _InfoRow('Tag ID', tag?.token ?? '-'),
        // Phone Number
        Container(
          padding: const EdgeInsets.symmetric(vertical: 8),
          decoration: const BoxDecoration(
            border: Border(bottom: BorderSide(color: _C.hair)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const _Key('Phone Number'),
                  Text(
                    mobile.isNotEmpty ? mobile : 'Not set',
                    style: wt(
                      13.12,
                      weight: FontWeight.w700,
                      color: mobile.isNotEmpty ? _C.navy : _C.grey,
                      height: 17 / 13.12,
                    ),
                  ),
                ],
              ),
              if (mobile.isEmpty) ...[
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: _PhoneField(
                        controller: _mobile,
                        hint: 'Enter mobile number',
                      ),
                    ),
                    const SizedBox(width: 8),
                    _SmallButton(
                      _sending ? 'Sending…' : 'Send code',
                      onTap: _sending ? null : _sendCode,
                    ),
                  ],
                ),
                if (_pendingMobile != null) ...[
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      Expanded(
                        child: _PlainField(
                          controller: _otp,
                          hint: '6-digit code',
                          maxLength: 6,
                          spacing: 1.97,
                        ),
                      ),
                      const SizedBox(width: 8),
                      _SmallButton(
                        'Verify & save',
                        color: const Color(0xFF16A34A),
                        onTap: _verify,
                      ),
                    ],
                  ),
                ],
                if (_mobileStatus != null) ...[
                  const SizedBox(height: 8),
                  Text(
                    _mobileStatus!,
                    style: wt(
                      11.68,
                      color: _mobileErr
                          ? const Color(0xFFDC2626)
                          : const Color(0xFF16A34A),
                      height: 1.3,
                    ),
                  ),
                ],
              ],
            ],
          ),
        ),
        // Backup Number
        Container(
          padding: const EdgeInsets.symmetric(vertical: 8),
          decoration: const BoxDecoration(
            border: Border(bottom: BorderSide(color: _C.hair)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    children: [
                      const _Key('Backup Number'),
                      if (!backupSet) ...[
                        const SizedBox(width: 6),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 7,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            color: _C.roseBg,
                            border: Border.all(color: _C.roseLine),
                            borderRadius: BorderRadius.circular(20),
                          ),
                          child: Text(
                            'Recommended',
                            style: wt(
                              9.6,
                              weight: FontWeight.w800,
                              color: _C.rose,
                              height: 12 / 9.6,
                              spacing: .192,
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                  Text(
                    backupSet ? backup : 'Not set',
                    style: wt(
                      13.12,
                      weight: FontWeight.w700,
                      color: backupSet ? _C.navy : _C.grey,
                      height: 17 / 13.12,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Text(
                'If your phone is switched off or busy, the call rings this number next.',
                style: wt(11.68, color: _C.grey, height: 1.5),
              ),
              const SizedBox(height: 8),
              if (editing)
                Row(
                  children: [
                    Expanded(
                      child: _PhoneField(
                        controller: _backup,
                        hint: '10-digit mobile',
                        maxLength: 10,
                      ),
                    ),
                    const SizedBox(width: 8),
                    _SmallButton(
                      'Save',
                      height: 38,
                      onTap: _savingBackup ? null : _saveBackup,
                    ),
                    if (_editingBackup && backupSet) ...[
                      const SizedBox(width: 8),
                      _TextLink(
                        'Cancel',
                        onTap: () => setState(() => _editingBackup = false),
                      ),
                    ],
                  ],
                )
              else
                Row(
                  children: [
                    _TextLink(
                      'Change',
                      onTap: () => setState(() {
                        _editingBackup = true;
                        _backup.text = backup.replaceFirst('+91', '');
                      }),
                    ),
                    const SizedBox(width: 14),
                    _TextLink('Remove', muted: true, onTap: _removeBackup),
                  ],
                ),
              if (_backupStatus != null ||
                  (!backupSet && widget.backupDeclined != null)) ...[
                const SizedBox(height: 8),
                Text(
                  _backupStatus ??
                      '${widget.backupDeclined} asked not to be your backup. Please add a different number.',
                  style: wt(
                    11.68,
                    weight: FontWeight.w600,
                    color: _backupErr || _backupStatus == null
                        ? const Color(0xFFB91C1C)
                        : const Color(0xFF047857),
                    height: 1.3,
                  ),
                ),
              ],
            ],
          ),
        ),
        // Delete Account
        Container(
          margin: const EdgeInsets.only(top: 6),
          padding: const EdgeInsets.fromLTRB(0, 12, 0, 8),
          decoration: const BoxDecoration(
            border: Border(top: BorderSide(color: _C.hair)),
          ),
          child: Align(
            alignment: Alignment.centerLeft,
            child: _TextLink(
              'Delete Account',
              color: _C.danger,
              onTap: () => context.push('/more/delete-account'),
            ),
          ),
        ),
      ],
    );
  }
}

/// `.pt-input-phone-wrap`: the "+91" prefix cell and the number field.
class _PhoneField extends StatelessWidget {
  const _PhoneField({
    required this.controller,
    required this.hint,
    this.maxLength,
  });

  final TextEditingController controller;
  final String hint;
  final int? maxLength;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 35,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: const Color(0xFFF1F1F0),
        border: Border.all(color: _C.line),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8),
            color: _C.hair,
            alignment: Alignment.center,
            height: double.infinity,
            child: Row(
              children: [
                const _Flag(),
                const SizedBox(width: 6),
                Text(
                  '+91',
                  style: wt(12.8, weight: FontWeight.w600, height: 1.3),
                ),
              ],
            ),
          ),
          Expanded(
            child: _PlainField(
              controller: controller,
              hint: hint,
              maxLength: maxLength,
              keyboard: TextInputType.phone,
              digitsOnly: true,
              padding: const EdgeInsets.fromLTRB(12, 0, 10, 0),
            ),
          ),
        ],
      ),
    );
  }
}

/// The 14x10 tricolour before "+91".
class _Flag extends StatelessWidget {
  const _Flag();

  @override
  Widget build(BuildContext context) => ClipRRect(
    borderRadius: BorderRadius.circular(1),
    child: const SizedBox(
      width: 14,
      height: 10,
      child: Column(
        children: [
          Expanded(child: ColoredBox(color: Color(0xFFFF9933))),
          Expanded(child: ColoredBox(color: Colors.white)),
          Expanded(child: ColoredBox(color: Color(0xFF138808))),
        ],
      ),
    ),
  );
}

/// A bare text field with the web's `.pt-input` sizes.
class _PlainField extends StatelessWidget {
  const _PlainField({
    required this.controller,
    required this.hint,
    this.maxLength,
    this.keyboard,
    this.digitsOnly = false,
    this.spacing,
    this.padding = const EdgeInsets.fromLTRB(10, 0, 10, 0),
  });

  final TextEditingController controller;
  final String hint;
  final int? maxLength;
  final TextInputType? keyboard;
  final bool digitsOnly;
  final double? spacing;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    final style = wt(13.12, height: 1.3, spacing: spacing);
    return Container(
      height: 35,
      alignment: Alignment.centerLeft,
      padding: padding,
      child: TextField(
        controller: controller,
        keyboardType: keyboard ?? (digitsOnly ? TextInputType.number : null),
        inputFormatters: [
          if (digitsOnly) FilteringTextInputFormatter.digitsOnly,
          if (maxLength != null) LengthLimitingTextInputFormatter(maxLength),
        ],
        style: style,
        decoration: InputDecoration(
          isCollapsed: true,
          filled: false,
          border: InputBorder.none,
          enabledBorder: InputBorder.none,
          focusedBorder: InputBorder.none,
          contentPadding: EdgeInsets.zero,
          hintText: hint,
          hintStyle: style.copyWith(color: _C.grey400),
        ),
      ),
    );
  }
}

/// The small red (or green) action button beside a field.
class _SmallButton extends StatelessWidget {
  const _SmallButton(
    this.label, {
    required this.onTap,
    this.color = _C.red,
    this.height = 35,
  });

  final String label;
  final VoidCallback? onTap;
  final Color color;
  final double height;

  @override
  Widget build(BuildContext context) {
    return Opacity(
      opacity: onTap == null ? .6 : 1,
      child: Material(
        color: color,
        borderRadius: BorderRadius.circular(10),
        child: InkWell(
          borderRadius: BorderRadius.circular(10),
          onTap: onTap,
          child: Container(
            height: height,
            padding: const EdgeInsets.symmetric(horizontal: 14),
            alignment: Alignment.center,
            child: Text(
              label,
              style: wt(
                12.48,
                weight: FontWeight.w700,
                color: Colors.white,
                height: 1.3,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// `.pt-bk-link`.
class _TextLink extends StatelessWidget {
  const _TextLink(
    this.label, {
    required this.onTap,
    this.muted = false,
    this.color,
  });

  final String label;
  final VoidCallback onTap;
  final bool muted;
  final Color? color;

  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    child: Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Text(
        label,
        style: wt(
          12.48,
          weight: FontWeight.w700,
          color: color ?? (muted ? _C.grey : _C.red),
          height: 16 / 12.48,
        ),
      ),
    ),
  );
}

/// The amber "Add your mobile number" alert at the top of Tags & Call.
class _MobileMissingAlert extends StatelessWidget {
  const _MobileMissingAlert();

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
      decoration: BoxDecoration(
        color: const Color(0xFFFFFBEB),
        border: Border.all(color: const Color(0xFFFCD34D)),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Padding(
            padding: EdgeInsets.only(top: 1),
            child: Icon(
              Icons.error_outline_rounded,
              size: 15,
              color: Color(0xFFD97706),
            ),
          ),
          const SizedBox(width: 9),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Add your mobile number to receive call-backs',
                  style: wt(
                    12.16,
                    weight: FontWeight.w700,
                    color: const Color(0xFF92400E),
                    height: 1.3,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  "Scanners can't call you back until you register a number.",
                  style: wt(11.2, color: const Color(0xFFB45309), height: 1.45),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// The My Orders sub-panel (welcome.js loadOrdersOnce).
class _OrdersPanel extends StatelessWidget {
  const _OrdersPanel({required this.orders, required this.onRetry});

  final Future<List<ShopOrder>>? orders;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<ShopOrder>>(
      future: orders,
      builder: (context, snap) {
        if (snap.hasError) {
          return InkWell(
            onTap: onRetry,
            child: const _Note("Couldn't load orders. Try again later."),
          );
        }
        if (!snap.hasData) return const _Note('Loading…');
        final list = snap.data!;
        if (list.isEmpty) return const _Note('No orders yet.');
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (var i = 0; i < list.length; i++)
              _OrderRow(list[i], last: i == list.length - 1),
          ],
        );
      },
    );
  }
}

class _OrderRow extends StatelessWidget {
  const _OrderRow(this.o, {required this.last});

  final ShopOrder o;
  final bool last;

  @override
  Widget build(BuildContext context) {
    var amount = '₹${(o.amountPaise / 100).round()}';
    if (o.cod) amount += ' · COD';
    final at = o.orderedAt;
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', //
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', //
    ];
    final date = at == null
        ? ''
        : '${at.toLocal().day} ${months[at.toLocal().month - 1]} ${at.toLocal().year}';
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 10),
      decoration: BoxDecoration(
        border: last ? null : const Border(bottom: BorderSide(color: _C.hair)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Text(
                  o.productName.isNotEmpty ? o.productName : 'ParkTag order',
                  style: wt(
                    16,
                    weight: FontWeight.w700,
                    color: const Color(0xFF0E1220),
                    height: 1.3,
                  ),
                ),
              ),
              Text(amount, style: wt(12.48, color: _C.grey, height: 1.3)),
            ],
          ),
          const SizedBox(height: 2),
          Text(
            menuOrderStatus(o.status),
            style: wt(12.48, color: _C.slate, height: 1.3),
          ),
          if (o.orderNumber.isNotEmpty) ...[
            const SizedBox(height: 2),
            Text(
              'Order ${o.orderNumber}',
              style: wt(11.52, color: _C.grey400, height: 1.3),
            ),
          ],
          if (o.trackable) ...[
            const SizedBox(height: 2),
            _TextLink(
              'Track order →',
              onTap: () => context.push('/shop/orders/${o.id}'),
            ),
          ],
          if (date.isNotEmpty) ...[
            const SizedBox(height: 2),
            Text(
              'Ordered $date',
              style: wt(11.2, color: _C.grey400, height: 1.3),
            ),
          ],
        ],
      ),
    );
  }
}

/// The Emergency / SOS sub-panel: note, the missing banner, field, Save.
class _SosPanel extends StatelessWidget {
  const _SosPanel({
    required this.tag,
    required this.controller,
    required this.onSave,
  });

  final Tag tag;
  final TextEditingController controller;
  final VoidCallback onSave;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const _Note(
          'Required. Scanners can call this number directly in an accident, so a vehicle without one has no SOS.',
        ),
        if (!tag.hasEmergencyContact)
          Container(
            margin: const EdgeInsets.only(bottom: 10),
            padding: const EdgeInsets.fromLTRB(11, 8, 11, 8),
            decoration: BoxDecoration(
              color: _C.roseBg,
              border: Border.all(color: _C.roseLine),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Row(
              children: [
                Container(
                  width: 16,
                  height: 16,
                  alignment: Alignment.center,
                  decoration: const BoxDecoration(
                    color: Color(0xFFE11D48),
                    shape: BoxShape.circle,
                  ),
                  child: Text(
                    '!',
                    style: wt(
                      10.88,
                      weight: FontWeight.w800,
                      color: Colors.white,
                      height: 1,
                    ),
                  ),
                ),
                const SizedBox(width: 7),
                Expanded(
                  child: Text(
                    'No emergency contact set for this vehicle.',
                    style: wt(
                      12.48,
                      weight: FontWeight.w700,
                      color: _C.rose,
                      height: 1.4,
                    ),
                  ),
                ),
              ],
            ),
          ),
        Container(
          height: 42,
          margin: const EdgeInsets.only(bottom: 9),
          padding: const EdgeInsets.symmetric(horizontal: 13),
          alignment: Alignment.centerLeft,
          decoration: BoxDecoration(
            color: Colors.white,
            border: Border.all(color: _C.line),
            borderRadius: BorderRadius.circular(11),
          ),
          child: TextField(
            controller: controller,
            keyboardType: TextInputType.phone,
            style: wt(14.08, color: _C.ink, height: 1.3),
            decoration: InputDecoration(
              isCollapsed: true,
              filled: false,
              border: InputBorder.none,
              enabledBorder: InputBorder.none,
              focusedBorder: InputBorder.none,
              contentPadding: EdgeInsets.zero,
              hintText: 'Emergency contact number',
              hintStyle: wt(14.08, color: _C.grey400, height: 1.3),
            ),
          ),
        ),
        Material(
          color: _C.red,
          borderRadius: BorderRadius.circular(11),
          child: InkWell(
            borderRadius: BorderRadius.circular(11),
            onTap: onSave,
            child: Container(
              height: 42,
              alignment: Alignment.center,
              child: Text(
                'Save Emergency Contact',
                style: wt(
                  13.6,
                  weight: FontWeight.w700,
                  color: Colors.white,
                  height: 1.3,
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

/// `#menuPremiumBadge`.
class _PremiumBadge extends StatelessWidget {
  const _PremiumBadge();

  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.only(right: 6),
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
    decoration: BoxDecoration(
      color: _C.red,
      borderRadius: BorderRadius.circular(20),
    ),
    child: Text(
      'PREMIUM',
      style: wt(
        10.4,
        weight: FontWeight.w800,
        color: Colors.white,
        height: 14 / 10.4,
      ),
    ),
  );
}
