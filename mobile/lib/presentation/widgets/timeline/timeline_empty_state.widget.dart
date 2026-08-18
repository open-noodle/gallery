import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter_search.provider.dart';
import 'package:immich_mobile/providers/sync_status.provider.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:immich_mobile/widgets/common/immich_loading_indicator.dart';

/// Shown on the main Photos timeline when it resolves to zero assets.
///
/// Four states, in priority order:
///  1. a photos filter is active and its search request is still in flight -> a
///     loading indicator. The search-backed timeline service starts at zero
///     assets, so without this the "no results" state would be rendered for the
///     whole duration of every search request (#901);
///  2. a photos filter is active and the search has answered with nothing -> a
///     compact "no results" state that lets the user clear the filter (never
///     tells an existing user to enable backup);
///  3. the initial remote sync is still running -> a loading indicator, so the
///     brief empty bucket emission during sync (the upstream "blank timeline"
///     race) never flashes the onboarding state for accounts that have photos;
///  4. otherwise the account simply has no backed-up photos yet -> a first-run
///     onboarding state pointing at backup.
class TimelineEmptyState extends ConsumerWidget {
  const TimelineEmptyState({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final hasActiveFilter = ref.watch(photosFilterProvider.select((f) => !f.isEmpty));
    if (hasActiveFilter) {
      // Read from inside the TimelineRouteScope, same as the load-more footer, so
      // this is the scoped notifier actually feeding the timeline.
      final isSearching = ref.watch(photosFilterSearchProvider.select((s) => s.isLoading));
      if (isSearching) {
        return const Center(child: ImmichLoadingIndicator());
      }
      return const _FilteredEmpty();
    }

    final isSyncing = ref.watch(syncStatusProvider.select((s) => s.isRemoteSyncing));
    if (isSyncing) {
      return const Center(child: ImmichLoadingIndicator());
    }

    return const _FirstRunEmpty();
  }
}

/// First-run / no-photos onboarding with a staggered entrance reveal.
class _FirstRunEmpty extends StatefulWidget {
  const _FirstRunEmpty();

  @override
  State<_FirstRunEmpty> createState() => _FirstRunEmptyState();
}

class _FirstRunEmptyState extends State<_FirstRunEmpty> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 700),
  )..forward();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Widget _reveal(int index, int count, bool reduceMotion, Widget child) {
    if (reduceMotion) {
      return child;
    }
    final start = (index / (count + 1)).clamp(0.0, 0.8);
    final animation = CurvedAnimation(
      parent: _controller,
      curve: Interval(start, 1.0, curve: Curves.easeOutCubic),
    );
    return FadeTransition(
      opacity: animation,
      child: SlideTransition(
        position: Tween<Offset>(begin: const Offset(0, 0.12), end: Offset.zero).animate(animation),
        child: child,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final reduceMotion = MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    final content = <Widget>[
      const _PolaroidHero(),
      const SizedBox(height: 28),
      Text(
        context.t.timeline_empty_title,
        textAlign: TextAlign.center,
        style: context.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w600),
      ),
      const SizedBox(height: 10),
      Text(
        context.t.timeline_empty_subtitle,
        textAlign: TextAlign.center,
        style: context.textTheme.bodyMedium?.copyWith(color: context.colorScheme.onSurfaceVariant),
      ),
      const SizedBox(height: 28),
      FilledButton.icon(
        onPressed: () => context.pushRoute(const DriftBackupRoute()),
        icon: const Icon(Icons.cloud_upload_outlined),
        label: Text(context.t.enable_backup),
      ),
    ];

    // Only the four meaningful rows get a staggered reveal; spacers ride along.
    var revealIndex = 0;
    final children = [
      for (final widget in content)
        if (widget is SizedBox) widget else _reveal(revealIndex++, 4, reduceMotion, widget),
    ];

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 320),
          child: Column(mainAxisSize: MainAxisSize.min, children: children),
        ),
      ),
    );
  }
}

/// Theme-aware polaroid illustration sitting on a soft accent glow, so the
/// empty screen reads as intentional negative space rather than a black void.
class _PolaroidHero extends StatelessWidget {
  const _PolaroidHero();

  @override
  Widget build(BuildContext context) {
    final asset = context.isDarkTheme ? 'assets/polaroid-dark.png' : 'assets/polaroid-light.png';
    return SizedBox(
      width: 180,
      height: 180,
      child: Stack(
        alignment: Alignment.center,
        children: [
          DecoratedBox(
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(color: context.primaryColor.withValues(alpha: 0.14), blurRadius: 80, spreadRadius: 12),
              ],
            ),
            child: const SizedBox(width: 110, height: 110),
          ),
          Image.asset(asset, width: 150, filterQuality: FilterQuality.high, isAntiAlias: true),
        ],
      ),
    );
  }
}

/// Compact "no results" state for when a filter is active but matched nothing.
class _FilteredEmpty extends ConsumerWidget {
  const _FilteredEmpty();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 56,
              height: 56,
              decoration: BoxDecoration(shape: BoxShape.circle, color: context.colorScheme.surfaceContainerHighest),
              child: Icon(Icons.search_off_rounded, color: context.colorScheme.onSurfaceVariant),
            ),
            const SizedBox(height: 18),
            Text(
              context.t.timeline_empty_filtered_title,
              textAlign: TextAlign.center,
              style: context.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 8),
            Text(
              context.t.timeline_empty_filtered_subtitle,
              textAlign: TextAlign.center,
              style: context.textTheme.bodyMedium?.copyWith(color: context.colorScheme.onSurfaceVariant),
            ),
            const SizedBox(height: 20),
            TextButton(
              onPressed: () => ref.read(photosFilterProvider.notifier).reset(),
              child: Text(context.t.timeline_empty_clear_filters),
            ),
          ],
        ),
      ),
    );
  }
}
