import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/games/daily_challenge_card.widget.dart';
import 'package:immich_mobile/presentation/widgets/spaces/space_albums_shelf.widget.dart';
import 'package:immich_mobile/providers/game/hidden_daily_banner.provider.dart';
import 'package:immich_mobile/providers/infrastructure/space_album.provider.dart';
import 'package:immich_mobile/widgets/spaces/sync_status_banner.dart';

/// Combined top sliver: sync banner, the daily challenge slot, then the Albums shelf.
///
/// Used as the single `topSliverWidget` passed to [Timeline] on
/// [SpaceDetailPage], replacing the bare [SyncStatusBannerSliver].
///
/// D2 decision (spec §2): [Timeline] accepts ONE [topSliverWidget]. Rather
/// than changing Timeline's API (which would also change scrubber-offset
/// math), we compose both header sections here.
class SpaceTopSliver extends ConsumerWidget {
  const SpaceTopSliver({
    super.key,
    required this.spaceId,
    required this.canEdit,
    required this.onLinkTap,
    required this.onAlbumTap,
    required this.dailyChallengeEnabled,
    required this.onPlayDaily,
    required this.onDailyStandings,
    required this.onDecideDaily,
    this.onSeeAll,
  });

  final String spaceId;
  final bool canEdit;
  final VoidCallback onLinkTap;
  final void Function(String albumId) onAlbumTap;

  /// Tri-state daily opt-in, straight off `SharedSpaceResponseDto.dailyChallengeEnabled`. See
  /// [DailySlot].
  final bool? dailyChallengeEnabled;

  final VoidCallback onPlayDaily;
  final VoidCallback onDailyStandings;
  final void Function(bool enabled) onDecideDaily;

  /// Invoked when the user taps "See all ▸" in the shelf header.
  /// B3 wires this to push [SpaceAlbumsRoute]. If null, the tap is a no-op.
  final VoidCallback? onSeeAll;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // This reader's per-device choice to keep the banner off THIS space's timeline. Independent of
    // [dailyChallengeEnabled]: the space's daily keeps generating and its standings keep accruing,
    // and the Challenges page still shows the card — this only decides whether the slot appears
    // above the photos.
    //
    // Read here rather than taken as a prop so this gate and `computeTopSliverHeight`'s matching
    // one below have a single source and cannot be wired up out of step. Gated at this level
    // rather than inside [DailySlot], which stays reusable on the Challenges page where hiding
    // must not apply.
    final dailyBannerHidden = ref.watch(hiddenDailyBannerProvider).contains(spaceId);

    return SliverToBoxAdapter(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const SyncStatusBanner(),
          if (!dailyBannerHidden)
            DailySlot(
              spaceId: spaceId,
              dailyChallengeEnabled: dailyChallengeEnabled,
              canEdit: canEdit,
              onDecide: onDecideDaily,
              onPlay: onPlayDaily,
              onStandings: onDailyStandings,
            ),
          SpaceAlbumsShelf(
            spaceId: spaceId,
            canEdit: canEdit,
            onLinkTap: onLinkTap,
            onAlbumTap: onAlbumTap,
            onSeeAll: onSeeAll,
          ),
        ],
      ),
    );
  }
}

/// Computes the combined top-sliver height for Timeline's scrubber offset.
///
/// **Height strategy (trade-off documented per RULES):**
/// The scrubber uses `topSliverWidgetHeight` to know how many px to offset
/// the snap-to-month calculation. It is consumed synchronously at layout time.
///
/// The shelf height depends on async album data (from [spaceAlbumsProvider]).
/// We resolve this with a **size-stable reservation approach**:
///
///  - We watch [spaceAlbumsProvider] inside this function (called from
///    [SpaceDetailPage.build] where `ref` is available) to get the current
///    album count synchronously (Riverpod caches the last-emitted value).
///  - When [canEdit] is true, the shelf is always shown (either tiles or the
///    Link tile) → reserve [kSpaceAlbumsShelfHeight].
///  - When [canEdit] is false and no albums are loaded yet (`loading` / empty)
///    → reserve 0 (viewer sees no shelf for empty space).
///  - Trade-off: on first frame (loading), editors see the height reservation
///    even before albums arrive, which may leave a brief empty space. This is
///    acceptable because (a) the sync banner is usually also shown on first
///    load, and (b) the reservation is required for the scrubber math to be
///    correct once albums appear — a height jitter on first render is better
///    than a permanently wrong scrubber snap point.
double computeTopSliverHeight({
  required WidgetRef ref,
  required String spaceId,
  required bool canEdit,
  required bool isRemoteSyncing,
  required bool? dailyChallengeEnabled,
}) {
  final bannerHeight = isRemoteSyncing ? kSyncStatusBannerSliverHeight : 0.0;

  // Watched here rather than passed in, so this reservation and the `if (!dailyBannerHidden)` gate
  // in build() cannot disagree: both read the same provider, and toggling rebuilds both together.
  final hidden = ref.watch(hiddenDailyBannerProvider).contains(spaceId);

  // Depends only on values the page already holds synchronously, so unlike the shelf below it
  // this reservation never jitters while data loads.
  final dailyHeight = DailySlot.reservedHeight(dailyChallengeEnabled: dailyChallengeEnabled, hidden: hidden);

  // Resolve the shelf height synchronously from cached Riverpod state.
  final albumsAsync = ref.watch(spaceAlbumsProvider(spaceId));
  final shelfHeight = albumsAsync.when(
    loading: () => canEdit ? kSpaceAlbumsShelfHeight : 0.0,
    error: (_, __) => 0.0,
    data: (albums) => (albums.isNotEmpty || canEdit) ? kSpaceAlbumsShelfHeight : 0.0,
  );

  return bannerHeight + dailyHeight + shelfHeight;
}
