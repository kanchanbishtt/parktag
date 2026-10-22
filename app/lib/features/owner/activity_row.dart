import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/api.dart';
import '../../core/app_state.dart';
import '../../core/errors.dart';
import '../../core/models.dart';
import '../../core/theme.dart';
import 'activity_rules.dart';
import 'owner_common.dart';

/// Builds [builder] from an [ActivityView] of the live dashboard and rebuilds
/// at the next moment a control changes by itself (a callback window closing,
/// a row leaving the hour or the 48 hours), like the web's
/// scheduleCallbackExpiry. [every] adds a steady tick for countdown text.
class ActivityTicker extends StatefulWidget {
  const ActivityTicker({super.key, required this.builder, this.every});

  final Widget Function(BuildContext context, ActivityView view) builder;
  final Duration? every;

  @override
  State<ActivityTicker> createState() => _ActivityTickerState();
}

class _ActivityTickerState extends State<ActivityTicker> {
  Timer? _timer;

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  void _schedule(ActivityView view) {
    _timer?.cancel();
    var wait = view.nextDeadline?.difference(view.now);
    // A second past the boundary, so the rebuild lands on the far side of it.
    if (wait != null) wait += const Duration(seconds: 1);
    final every = widget.every;
    if (every != null && (wait == null || every < wait)) wait = every;
    if (wait == null) return;
    _timer = Timer(wait, () {
      if (mounted) setState(() {});
    });
  }

  @override
  Widget build(BuildContext context) {
    final view = activityViewOf(AppScope.of(context));
    _schedule(view);
    return widget.builder(context, view);
  }
}

ActivityView activityViewOf(AppState app) => ActivityView(
  app.dashboardData,
  app.tags,
  app.requests,
  activityNow(),
  ownerHasMobile: (app.owner?.mobile ?? '').isNotEmpty,
);

class ActivityRow extends StatefulWidget {
  const ActivityRow({
    super.key,
    required this.request,
    required this.view,
    this.highlighted = false,
  });

  final ContactRequest request;
  final ActivityView view;
  final bool highlighted;

  @override
  State<ActivityRow> createState() => _ActivityRowState();
}

class _ActivityRowState extends State<ActivityRow> {
  bool _busy = false;

  ContactRequest get r => widget.request;

  // The paid callback pass is never sold in the app.
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
    final (Color icBg, Color icFg) = r.id == view.target?.id
        ? (PtColors.amberBg, PtColors.accent)
        : isCall && within
        ? (const Color(0xFFDBEAFE), const Color(0xFF2563EB))
        : !isCall
        ? (const Color(0xFFDCFCE7), PtColors.success)
        : (const Color(0xFFF3F4F6), const Color(0xFF9CA3AF));
    final title = [
      humanize(r.reason),
      humanize(r.action),
    ].where((s) => s.isNotEmpty).join(' · ');
    final outcome = outcomeLabel(r);
    final duration = isCall && outcome != null
        ? callDurationLabel(r.callDuration)
        : '';
    final map = r.carLocationMapUrl;
    final cta = view.ctaFor(r);
    return Card(
      color: widget.highlighted ? PtColors.amberBg : null,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            CircleAvatar(
              radius: 18,
              backgroundColor: icBg,
              child: Icon(
                isCall ? Icons.call_outlined : Icons.chat_bubble_outline,
                size: 18,
                color: icFg,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title.isEmpty ? 'Contact request' : title,
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                  const SizedBox(height: 4),
                  Wrap(
                    spacing: 6,
                    runSpacing: 4,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      _PlateChip(plateFor(view.tags, r.token)),
                      Text(
                        isCall ? 'Call' : 'WhatsApp',
                        style: const TextStyle(color: PtColors.muted),
                      ),
                      if (outcome != null)
                        _Badge(
                          outcome,
                          good: !isCall || outcome.startsWith('Answered'),
                        ),
                      if (duration.isNotEmpty)
                        Text(
                          duration,
                          style: const TextStyle(
                            color: PtColors.muted,
                            fontSize: 12,
                          ),
                        ),
                    ],
                  ),
                  if ((r.scannerLocationLabel ?? '').isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Row(
                      children: [
                        const Icon(
                          Icons.place_outlined,
                          size: 16,
                          color: PtColors.muted,
                        ),
                        const SizedBox(width: 4),
                        Expanded(child: Text(r.scannerLocationLabel!)),
                      ],
                    ),
                  ],
                  if (r.hasPhone && r.phoneLast4 != null) ...[
                    const SizedBox(height: 4),
                    Text(
                      '•••• ${r.phoneLast4}',
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                  ],
                  if (at != null) ...[
                    const SizedBox(height: 4),
                    Text(
                      '${formatTime(at)} · ${timeAgo(now.difference(at))}',
                      style: const TextStyle(
                        color: PtColors.muted,
                        fontSize: 12,
                      ),
                    ),
                  ],
                  if (map != null || cta != RowCta.none) ...[
                    const SizedBox(height: 10),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        if (map != null)
                          OutlinedButton.icon(
                            icon: const Icon(Icons.map_outlined),
                            label: const Text('Car location'),
                            onPressed: () => _openMap(map),
                          ),
                        if (cta == RowCta.callBack)
                          FilledButton.icon(
                            icon: const Icon(Icons.call),
                            label: const Text('Call back'),
                            onPressed: _busy ? null : _callBack,
                          )
                        else if (cta != RowCta.none)
                          CtaStatus(cta),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  // Only https Google Maps links leave the app.
  void _openMap(String url) {
    final uri = Uri.tryParse(url);
    final ok =
        uri != null &&
        uri.scheme == 'https' &&
        (uri.host == 'www.google.com' || uri.host == 'maps.google.com');
    if (ok) ownerLaunch(uri);
  }
}

/// Plain status text for a row that cannot be called back. Play policy: no
/// purchase or renewal link. "Add phone" opens Profile, where it is fixed.
class CtaStatus extends StatelessWidget {
  const CtaStatus(this.cta, {super.key});

  final RowCta cta;

  static String label(RowCta cta) => switch (cta) {
    RowCta.addPhone => 'Add phone to call back',
    RowCta.premiumNeeded => 'Premium needed to call back',
    RowCta.renewNeeded => 'Call service ended on this tag',
    RowCta.freeTimeUsed => 'Free time used up',
    RowCta.callBack || RowCta.none => '',
  };

  @override
  Widget build(BuildContext context) {
    final text = Text(
      label(cta),
      style: const TextStyle(
        color: PtColors.amberDeep,
        fontWeight: FontWeight.w700,
        fontSize: 12,
      ),
    );
    if (cta != RowCta.addPhone) return text;
    return InkWell(onTap: () => context.push('/more/profile'), child: text);
  }
}

/// welcome.js vehicleOf: the plate, or "Unknown vehicle" for a deleted tag.
String plateFor(List<Tag> tags, String token) {
  for (final t in tags) {
    if (t.token == token) return tagTitle(t);
  }
  return 'Unknown vehicle';
}

class _PlateChip extends StatelessWidget {
  const _PlateChip(this.plate);

  final String plate;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
    decoration: BoxDecoration(
      color: PtColors.bg,
      borderRadius: BorderRadius.circular(PtRadii.pill),
      border: Border.all(color: PtColors.line),
    ),
    child: Text(
      plate,
      style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
    ),
  );
}

class _Badge extends StatelessWidget {
  const _Badge(this.text, {required this.good});

  final String text;
  final bool good;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
    decoration: BoxDecoration(
      color: good ? const Color(0xFFDCFCE7) : const Color(0xFFFEE2E2),
      borderRadius: BorderRadius.circular(PtRadii.pill),
    ),
    child: Text(
      text,
      style: TextStyle(
        fontSize: 12,
        fontWeight: FontWeight.w700,
        color: good ? const Color(0xFF14532D) : const Color(0xFFB91C1C),
      ),
    ),
  );
}
