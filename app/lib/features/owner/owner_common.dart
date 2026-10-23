import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api.dart';
import '../../core/app_state.dart';
import '../../core/models.dart';
import '../../core/widgets.dart';

/// Opens `tel:`, `https://wa.me/` and map links outside the app. Tests swap it.
Future<bool> Function(Uri url) ownerLaunch = (url) =>
    launchUrl(url, mode: LaunchMode.externalApplication);

/// Loads the dashboard on first use and wraps [builder] in pull to refresh,
/// with a skeleton before the first load and a retry card when it fails.
class DashboardView extends StatefulWidget {
  const DashboardView({
    super.key,
    required this.builder,
    this.header,
    this.padding = const EdgeInsets.fromLTRB(18, 16, 18, 120),
  });

  final List<Widget> Function(BuildContext context, AppState app) builder;

  /// Pinned above the list (the Home header).
  final Widget? header;

  /// Around the built sections.
  final EdgeInsets padding;

  @override
  State<DashboardView> createState() => _DashboardViewState();
}

class _DashboardViewState extends State<DashboardView> {
  Object? _error;
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && AppScope.read(context).dashboard == null) _load();
    });
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await AppScope.read(context).refresh();
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _pull() async {
    try {
      await AppScope.read(context).refresh();
    } catch (e) {
      if (!mounted) return;
      if (AppScope.read(context).dashboard == null) {
        setState(() => _error = e);
      } else {
        showError(context, e);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final List<Widget> children;
    if (app.dashboard != null) {
      children = widget.builder(context, app);
    } else if (_error != null && !_loading) {
      children = [ErrorCard.from(_error!, onRetry: _load)];
    } else {
      children = const [Skeleton()];
    }
    return RefreshIndicator(
      onRefresh: _pull,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: EdgeInsets.zero,
        children: [
          ?widget.header,
          Padding(
            padding: widget.padding,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: children,
            ),
          ),
        ],
      ),
    );
  }
}

/// Server text for an ApiError, a fallback otherwise.
void showError(BuildContext context, Object error) {
  showSnack(context, error is ApiError ? error.message : fallbackError);
}

void showSnack(BuildContext context, String text, {SnackBarAction? action}) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(text), action: action));
}

Future<bool> confirm(
  BuildContext context, {
  required String title,
  required String body,
  required String ok,
}) async {
  final yes = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(title),
      content: Text(body),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(ctx, false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(ctx, true),
          child: Text(ok),
        ),
      ],
    ),
  );
  return yes == true;
}

String tagTitle(Tag t) => t.plateNumber ?? t.vehicleLabel;

const _months = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

String formatDate(DateTime d) => '${d.day} ${_months[d.month - 1]} ${d.year}';

String formatTime(DateTime d) {
  final now = DateTime.now();
  final h = d.hour % 12 == 0 ? 12 : d.hour % 12;
  final time =
      '$h:${d.minute.toString().padLeft(2, '0')} ${d.hour < 12 ? 'AM' : 'PM'}';
  final sameDay =
      d.year == now.year && d.month == now.month && d.day == now.day;
  return sameDay ? time : '${formatDate(d)}, $time';
}

/// Coverage line from `tags[].membership`. Never a price or a plans link.
String coverageLine(Tag t) {
  final m = t.membership;
  if (m == null) return 'E-Tag. No membership cover.';
  switch (m['state']) {
    case 'open':
      return 'Covered, no end date';
    case 'lapsed':
      return 'Cover ended';
  }
  final ends = m['endsAt'] is String ? DateTime.tryParse(m['endsAt']) : null;
  return ends == null
      ? 'Covered'
      : 'Covered until ${formatDate(ends.toLocal())}';
}

/// "blocking_exit" -> "Blocking exit".
String humanize(String? s) {
  if (s == null || s.isEmpty) return '';
  final t = s.replaceAll(RegExp(r'[_-]+'), ' ').trim();
  return t.isEmpty ? '' : t[0].toUpperCase() + t.substring(1);
}
