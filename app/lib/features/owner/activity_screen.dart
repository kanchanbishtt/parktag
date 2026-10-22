import 'package:flutter/material.dart';

import '../../core/models.dart';
import '../../core/widgets.dart';
import 'activity_row.dart';
import 'activity_rules.dart';
import 'owner_common.dart';

export 'activity_row.dart' show ActivityRow, ActivityTicker;

/// `/activity?tag=<tagId>&request=<requestId>`. Rows carry the tag token, so
/// the tag id resolves through [AppState.tokenForTagId].
class ActivityScreen extends StatefulWidget {
  const ActivityScreen({super.key, this.tagId, this.requestId});

  final String? tagId;
  final String? requestId;

  @override
  State<ActivityScreen> createState() => _ActivityScreenState();
}

class _ActivityScreenState extends State<ActivityScreen> {
  late String? _tagId = widget.tagId;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Activity')),
      body: DashboardView(
        builder: (context, app) {
          final token = _tagId == null ? null : app.tokenForTagId(_tagId!);
          return [
            ActivityTicker(
              builder: (context, view) {
                final filter = activityFilterToken(token, view.recent);
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    ?_chips(view, filter),
                    ActivityList(
                      token: filter,
                      highlightId: widget.requestId,
                      view: view,
                    ),
                  ],
                );
              },
            ),
          ];
        },
      ),
    );
  }

  /// welcome.js renderActivityFilter: only vehicles with activity in the 48
  /// hours, and only when at least two buckets (rows from deleted tags count
  /// as one) have something.
  Widget? _chips(ActivityView view, String? filter) {
    final counts = vehicleCounts(view.recent);
    final withActivity = [
      for (final t in view.tags)
        if (counts.containsKey(t.token)) t,
    ];
    final orphans =
        view.recent.length -
        withActivity.fold(0, (n, t) => n + counts[t.token]!);
    if (withActivity.length + (orphans > 0 ? 1 : 0) < 2) return null;
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        children: [
          for (final (id, label, n) in [
            (null, 'All', view.recent.length),
            for (final t in withActivity) (t.id, tagTitle(t), counts[t.token]!),
          ])
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: ChoiceChip(
                label: Text('$label  $n'),
                selected: id == null
                    ? filter == null
                    : withActivity.any((t) => t.id == id && t.token == filter),
                onSelected: (_) => setState(
                  () => _tagId = (id == null || _tagId == id) ? null : id,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// The tag [token] to filter by, or null (All) when it is unknown or has no
/// rows in the 48 hour window, so a stale or deep linked filter never hides
/// other vehicles' activity behind an All chip.
String? activityFilterToken(String? token, List<ContactRequest> recent) =>
    token != null && recent.any((r) => r.token == token) ? token : null;

/// Rows per tag token.
Map<String, int> vehicleCounts(List<ContactRequest> rows) {
  final counts = <String, int>{};
  for (final r in rows) {
    counts[r.token] = (counts[r.token] ?? 0) + 1;
  }
  return counts;
}

/// The last 48 hours of `dashboard.requests[]`, optionally for one tag
/// [token], at most 20 rows (or [limit]).
class ActivityList extends StatelessWidget {
  const ActivityList({
    super.key,
    this.token,
    this.highlightId,
    this.limit,
    this.view,
  });

  final String? token;
  final String? highlightId;
  final int? limit;

  /// Shared with a parent ticker; otherwise this list runs its own.
  final ActivityView? view;

  @override
  Widget build(BuildContext context) {
    final shared = view;
    if (shared == null) {
      return ActivityTicker(builder: (context, v) => _list(v));
    }
    return _list(shared);
  }

  Widget _list(ActivityView view) {
    if (!view.hasAny) {
      return const EmptyState(
        title: 'No activity yet',
        body: 'Contact requests from scanners will appear here',
        icon: Icons.notifications_none,
      );
    }
    final rows = [
      for (final r in view.recent)
        if (token == null || r.token == token) r,
    ].take(limit ?? maxVisibleRows);
    if (rows.isEmpty) {
      return const EmptyState(
        title: 'No recent activity',
        body: 'Activity older than 2 days is hidden',
        icon: Icons.notifications_none,
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final r in rows) ...[
          ActivityRow(request: r, view: view, highlighted: r.id == highlightId),
          const SizedBox(height: 10),
        ],
      ],
    );
  }
}
