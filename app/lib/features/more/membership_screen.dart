import 'package:flutter/material.dart';

import '../../core/app_state.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';

/// Read-only cover per tag. Play policy: `plans`, prices and any buy action
/// from the response are deliberately never read.
class MembershipScreen extends StatefulWidget {
  const MembershipScreen({super.key});

  @override
  State<MembershipScreen> createState() => _MembershipScreenState();
}

class _MembershipScreenState extends State<MembershipScreen> {
  late Future<Map<String, dynamic>> _data = _fetch();

  Future<Map<String, dynamic>> _fetch() =>
      AppScope.read(context).api.get('/api/owner/membership');

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Membership')),
      body: FutureBuilder<Map<String, dynamic>>(
        future: _data,
        builder: (context, snap) {
          final Widget child;
          if (snap.hasError) {
            child = ErrorCard.from(snap.error!,
                onRetry: () => setState(() => _data = _fetch()));
          } else if (!snap.hasData) {
            child = const Skeleton();
          } else {
            child = _body(snap.data!);
          }
          return ListView(
            padding: const EdgeInsets.all(PtLayout.padX),
            children: [child],
          );
        },
      ),
    );
  }

  Widget _body(Map<String, dynamic> data) {
    final trial = data['trial'];
    final tags = [
      for (final t in data['tags'] is List ? data['tags'] as List : const [])
        if (t is Map<String, dynamic>) t,
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (trial is Map && trial['headline'] is String) ...[
          _TrialHeader(trial),
          const SizedBox(height: 16),
        ],
        if (tags.isEmpty)
          const EmptyState(
            title: 'No premium tags yet',
            body: 'Cover shows here once a premium tag is activated.',
            icon: Icons.workspace_premium_outlined,
          )
        else
          for (final t in tags)
            _TagCover(t, trialMonths: trial is Map ? _num(trial['months']) : 0),
      ],
    );
  }
}

int _num(Object? v) => v is num ? v.toInt() : 0;

/// Web membership.js trial capsule: the numeral over its unit, both from the
/// server, then the headline and note.
class _TrialHeader extends StatelessWidget {
  const _TrialHeader(this.trial);

  final Map trial;

  @override
  Widget build(BuildContext context) {
    final value = trial['value'];
    final unit = trial['unit'];
    return Row(
      children: [
        if (value != null && unit is String)
          Container(
            width: 64,
            padding: const EdgeInsets.symmetric(vertical: 8),
            margin: const EdgeInsets.only(right: 12),
            decoration: BoxDecoration(
              color: PtColors.amberBg,
              borderRadius: BorderRadius.circular(PtRadii.r14),
            ),
            child: Column(
              children: [
                Text('$value',
                    style: const TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.w900,
                        color: PtColors.accent)),
                Text(unit.toUpperCase(),
                    style: const TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                        color: PtColors.accent)),
              ],
            ),
          ),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(trial['headline'] as String,
                  style: const TextStyle(
                      fontSize: 18, fontWeight: FontWeight.w800)),
              if (trial['note'] is String)
                Text(trial['note'] as String,
                    style: const TextStyle(color: PtColors.muted)),
            ],
          ),
        ),
      ],
    );
  }
}

/// Whole days of cover left, rounded up so the last day reads "1 day left".
int daysLeft(DateTime until, DateTime now) {
  final ms = until.difference(now).inMilliseconds;
  if (ms <= 0) return 0;
  return (ms / Duration.millisecondsPerDay).ceil();
}

/// Share of the included trial still left, 0 to 1. Only trial cover has a
/// known length (trial.months); paid cover shows days left without a bar.
double? trialRemaining(DateTime until, int months, DateTime now) {
  if (months <= 0) return null;
  final start = DateTime.utc(until.year, until.month - months, until.day,
      until.hour, until.minute);
  final total = until.difference(start).inMilliseconds;
  if (total <= 0) return null;
  return (until.difference(now).inMilliseconds / total).clamp(0.0, 1.0);
}

class _TagCover extends StatelessWidget {
  const _TagCover(this.tag, {required this.trialMonths});

  final Map<String, dynamic> tag;
  final int trialMonths;

  @override
  Widget build(BuildContext context) {
    final until = DateTime.tryParse(tag['coveredUntil'] as String? ?? '');
    final now = DateTime.now();
    final left = until == null ? 0 : daysLeft(until, now);
    final progress = until != null && tag['trial'] == true
        ? trialRemaining(until, trialMonths, now)
        : null;
    final String status;
    if (until == null) {
      status = 'Not covered';
    } else if (tag['trial'] == true) {
      status = 'Included cover until ${formatDay(until)}';
    } else {
      status = 'Covered until ${formatDay(until)}';
    }
    return Card(
      child: ListTile(
        leading: const Icon(Icons.directions_car_filled, color: PtColors.navy),
        title: Text(tag['plateNumber'] as String? ?? 'Vehicle',
            style: const TextStyle(fontWeight: FontWeight.w800)),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text([
              if (tag['vehicleLabel'] is String) tag['vehicleLabel'] as String,
              status,
            ].join('\n')),
            if (left > 0) ...[
              const SizedBox(height: 6),
              Text(left == 1 ? '1 day left' : '$left days left',
                  style: const TextStyle(
                      color: PtColors.ink, fontWeight: FontWeight.w700)),
            ],
            if (progress != null) ...[
              const SizedBox(height: 6),
              LinearProgressIndicator(
                value: progress,
                minHeight: 6,
                borderRadius: BorderRadius.circular(PtRadii.pill),
                color: PtColors.accent,
                backgroundColor: PtColors.line,
              ),
            ],
          ],
        ),
      ),
    );
  }
}

const _months = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/// "12 Mar 2027" in local time, without pulling in intl.
String formatDay(DateTime d) {
  final l = d.toLocal();
  return '${l.day} ${_months[l.month - 1]} ${l.year}';
}
