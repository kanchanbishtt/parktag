import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/models.dart';
import '../../core/theme.dart';
import 'owner_common.dart';
import 'tag_rules.dart';

/// One vehicle card on `/tags` (welcome.js vehicleCard): label, plate, serial,
/// the free-call / Call Used / Premium pill, active state, and for a spent
/// E-Tag the locked note with Buy Premium Tag (a physical sticker).
class TagCard extends StatelessWidget {
  const TagCard({super.key, required this.tag});

  final Tag tag;

  @override
  Widget build(BuildContext context) {
    final t = tag;
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => context.push('/tags/${t.id}'),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  const Icon(Icons.directions_car_filled, color: PtColors.navy),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          t.vehicleLabel,
                          style: const TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        Text(
                          tagTitle(t),
                          style: const TextStyle(color: PtColors.muted),
                        ),
                        if ((t.serial ?? '').isNotEmpty)
                          Text(
                            t.serial!,
                            style: const TextStyle(color: PtColors.muted),
                          ),
                      ],
                    ),
                  ),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      TagPill(tag: t),
                      const SizedBox(height: 6),
                      Text(
                        t.isActive ? 'Active' : 'Inactive',
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                          color: t.isActive ? PtColors.success : PtColors.muted,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
              if (trialExpired(t)) ...[
                const SizedBox(height: 12),
                Text(lockedTagNote(t), style: const TextStyle(fontSize: 13)),
                const SizedBox(height: 8),
                Align(
                  alignment: Alignment.centerLeft,
                  child: FilledButton(
                    onPressed: () => context.go(replaceShopPath(t)),
                    child: const Text('Buy Premium Tag'),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class TagPill extends StatelessWidget {
  const TagPill({super.key, required this.tag});

  final Tag tag;

  @override
  Widget build(BuildContext context) {
    final p = tagPill(tag);
    final (bg, fg) = switch (p.kind) {
      TagPillKind.premium => (PtColors.amberBg, PtColors.amberDeep),
      TagPillKind.free => (const Color(0xFFDCFCE7), PtColors.success),
      TagPillKind.used => (PtColors.line, PtColors.muted),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(PtRadii.pill),
      ),
      child: Text(
        p.label,
        style: TextStyle(color: fg, fontSize: 12, fontWeight: FontWeight.w700),
      ),
    );
  }
}
