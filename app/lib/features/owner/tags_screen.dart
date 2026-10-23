import 'package:flutter/material.dart';

import '../../core/app_state.dart';
import '../../core/models.dart';
import 'activity_row.dart';
import 'home_cards.dart';
import 'home_web.dart';
import 'owner_common.dart';

/// `/tags`: the web owner dashboard's Tags view (the tag icon on the web nav) (pages/owner/welcome.html),
/// section for section: header, banners, Overview, the callback prompt,
/// search, My Vehicles, Refer a friend, Activity. Membership is read-only
/// here: no prices and no plans link.
class TagsScreen extends StatefulWidget {
  const TagsScreen({super.key});

  @override
  State<TagsScreen> createState() => _TagsScreenState();
}

class _TagsScreenState extends State<TagsScreen> {
  VehicleFilter? _filter;
  String? _activityVehicle;
  final _search = TextEditingController();

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: DashboardView(
        header: const HomeHeader(),
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 120),
        builder: _body,
      ),
    );
  }

  /// welcome.js getDisplayTags: the KPI filter, then the search box.
  List<Tag> _shown(List<Tag> tags) {
    var out = tags;
    final f = _filter;
    if (f != null) out = out.where(f.matches).toList();
    final q = _search.text.trim().toLowerCase();
    if (q.isNotEmpty) {
      out = out
          .where(
            (t) =>
                t.vehicleLabel.toLowerCase().contains(q) ||
                (t.plateNumber ?? '').toLowerCase().contains(q),
          )
          .toList();
    }
    return out;
  }

  List<Widget> _body(BuildContext context, AppState app) {
    final tags = app.tags;
    final shown = _shown(tags);
    final filtered = _filter != null || _search.text.trim().isNotEmpty;
    final count = tags.isEmpty
        ? null
        : shown.length == tags.length
        ? '(${tags.length})'
        : '(${shown.length} of ${tags.length})';
    final referral = app.referral;
    return [
      const BannerCarousel(),
      OverviewSection(
        tags: tags,
        filter: _filter,
        onFilter: (f) => setState(() => _filter = f),
      ),
      ActivityTicker(
        every: const Duration(seconds: 15),
        builder: (context, view) => CallbackPromptWeb(view: view),
      ),
      VehicleSearch(controller: _search, onChanged: (_) => setState(() {})),
      const SizedBox(height: 22),
      SectionTitle('My Vehicles', count: count, barGap: 5),
      const SizedBox(height: 7),
      if (shown.isEmpty) VehiclesEmpty(filtered: filtered),
      for (final t in shown) ...[
        VehicleCardWeb(tag: t, colorIndex: tags.indexOf(t)),
        const SizedBox(height: 10),
      ],
      const AddVehicleCard(),
      if (referral != null) ReferralCardWeb(referral: referral),
      ActivityTicker(
        builder: (context, view) => ActivitySectionWeb(
          view: view,
          vehicleFilter: _activityVehicle,
          onVehicleFilter: (v) => setState(() => _activityVehicle = v),
        ),
      ),
    ];
  }
}
