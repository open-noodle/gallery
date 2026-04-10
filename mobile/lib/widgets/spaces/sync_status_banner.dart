import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/sync_status.provider.dart';

/// Banner that surfaces remote-sync progress so the user understands why
/// freshly-opened spaces appear empty for a few seconds. The Drift bucket
/// queries fed from `sync_api.repository.streamChanges` populate row by row
/// as the server flushes 5000-event chunks (see `kSyncEventBatchSize`), so on
/// the very first open of a large account the timeline can stay empty for ~10
/// s while sharedSpaceAssetsV1 / libraryAssetsV1 land. Showing this banner —
/// rather than a blank grid — turns "broken" into "loading".
///
/// Collapses to zero height once `syncStatusProvider.isRemoteSyncing` flips
/// back to false. Use [SyncStatusBannerSliver] inside a `CustomScrollView`,
/// or [SyncStatusBanner] anywhere else.
class SyncStatusBanner extends ConsumerWidget {
  const SyncStatusBanner({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isSyncing = ref.watch(syncStatusProvider.select((s) => s.isRemoteSyncing));
    return AnimatedSize(
      duration: const Duration(milliseconds: 200),
      curve: Curves.easeOut,
      alignment: Alignment.topCenter,
      child: isSyncing ? const _SyncBannerContent() : const SizedBox(width: double.infinity),
    );
  }
}

/// Sliver wrapper around [SyncStatusBanner] for use inside a `CustomScrollView`.
class SyncStatusBannerSliver extends StatelessWidget {
  const SyncStatusBannerSliver({super.key});

  @override
  Widget build(BuildContext context) {
    return const SliverToBoxAdapter(child: SyncStatusBanner());
  }
}

class _SyncBannerContent extends StatelessWidget {
  const _SyncBannerContent();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Material(
      color: theme.colorScheme.surfaceContainerHigh,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Row(
          children: [
            const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                'Syncing photos — the first load takes a moment. Future visits will be instant.',
                style: theme.textTheme.bodyMedium,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
