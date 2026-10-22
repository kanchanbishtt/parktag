import 'package:flutter/material.dart';

import '../../core/models.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'models.dart';

/// The unlocked document list: tally, full card or trial note, then cards.
class VaultList extends StatelessWidget {
  const VaultList({
    super.key,
    required this.docs,
    required this.usedBytes,
    required this.entitlement,
    required this.limits,
    required this.onRefresh,
    required this.onView,
    required this.onRename,
    required this.onDelete,
  });

  final List<VaultDoc> docs;
  final int usedBytes;
  final VaultEntitlement? entitlement;
  final VaultLimits? limits;
  final Future<void> Function() onRefresh;
  final ValueChanged<VaultDoc> onView;
  final ValueChanged<VaultDoc> onRename;
  final ValueChanged<VaultDoc> onDelete;

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();
    final full = isVehicleFull(docs.length, entitlement);
    final note = trialNote(entitlement, limits, now, full: full);
    return RefreshIndicator(
      onRefresh: onRefresh,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(
          PtLayout.padX,
          12,
          PtLayout.padX,
          96,
        ),
        children: [
          Text(
            vaultTally(docs.length, usedBytes, entitlement, limits),
            style: const TextStyle(color: PtColors.muted),
          ),
          const SizedBox(height: 12),
          if (full)
            Card(
              key: const ValueKey('vault-full'),
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'This vehicle is full',
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(fullCardBody(entitlement!)),
                    if (note != null) ...[
                      const SizedBox(height: 6),
                      Text(note, style: const TextStyle(color: PtColors.muted)),
                    ],
                  ],
                ),
              ),
            )
          else if (note != null)
            Text(note, style: const TextStyle(color: PtColors.muted)),
          if (full || note != null) const SizedBox(height: 12),
          if (docs.isEmpty)
            const EmptyState(
              title: 'No documents yet',
              body: 'Keep your RC, insurance, PUC and licence here, locked with your PIN.',
              icon: Icons.folder_open_rounded,
            ),
          for (final d in docs) _card(d),
        ],
      ),
    );
  }

  Widget _card(VaultDoc d) {
    final date = formatDate(d.createdAt);
    final thumb = d.thumb;
    return Card(
      child: ListTile(
        leading: thumb != null
            ? ClipRRect(
                borderRadius: BorderRadius.circular(6),
                child: Image.memory(
                  thumb,
                  width: 48,
                  height: 48,
                  fit: BoxFit.cover,
                  gaplessPlayback: true,
                  errorBuilder: (_, _, _) => _icon(d),
                ),
              )
            : _icon(d),
        title: Text(
          d.title,
          style: const TextStyle(fontWeight: FontWeight.w700),
        ),
        subtitle: Text(
          [
            docTypeName(d.docType),
            formatBytes(d.size),
            if (date.isNotEmpty) date,
          ].join(' · '),
        ),
        onTap: () => onView(d),
        trailing: PopupMenuButton<String>(
          onSelected: (v) => v == 'rename' ? onRename(d) : onDelete(d),
          itemBuilder: (_) => const [
            PopupMenuItem(value: 'rename', child: Text('Rename')),
            PopupMenuItem(value: 'delete', child: Text('Delete')),
          ],
        ),
      ),
    );
  }

  Widget _icon(VaultDoc d) => Icon(
    d.isImage ? Icons.image_outlined : Icons.picture_as_pdf_outlined,
    color: PtColors.navy,
  );
}
