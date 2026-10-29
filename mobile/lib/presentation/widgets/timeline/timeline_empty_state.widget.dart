import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/gallery/library_view.model.dart';
import 'package:immich_mobile/gallery/library_view.provider.dart';
import 'package:immich_mobile/gallery/search/search.providers.dart';
import 'package:immich_mobile/gallery/search/search_mode.provider.dart';
import 'package:immich_mobile/gallery/search/search_ui.providers.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/widgets/common/polaroid_hero.widget.dart';
import 'package:immich_mobile/providers/sync_status.provider.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:immich_mobile/widgets/common/immich_loading_indicator.dart';

/// Shown on the main Photos timeline when it resolves to zero assets.
///
/// Five states, in priority order:
///  1. search mode has a filter and its results request is still in flight -> a
///     loading indicator, so the "no results" state never flashes while a search
///     is still answering (#901);
///  2. search mode has a filter and the search has answered with nothing -> a
///     compact "no results" state that clears the filters (never tells an
///     existing user to enable backup);
///  3. a library view (#1038) is narrowing the timeline -> the same compact
///     state, without the filter actions; the app-bar menu changes the view;
///  4. the initial remote sync is still running -> a loading indicator, so the
///     brief empty bucket emission during sync (the upstream "blank timeline"
///     race) never flashes the onboarding state for accounts that have photos;
///  5. otherwise the account simply has no backed-up photos yet -> a first-run
///     onboarding state pointing at backup.
class TimelineEmptyState extends ConsumerWidget {
  const TimelineEmptyState({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final hasActiveFilter =
        ref.watch(searchModeProvider) && !ref.watch(searchStateProvider.select((state) => state.isEmpty));
    if (hasActiveFilter) {
      // Read from inside the TimelineRouteScope, so this is the screen's own search.
      final isSearching = ref.watch(searchResultsProvider.select((results) => results.loading));
      if (isSearching) {
        return const Center(child: ImmichLoadingIndicator());
      }
      return const _FilteredEmpty();
    }
    // An empty library view (#1038) is no results too; the app-bar menu changes it.
    if (ref.watch(activeLibraryViewProvider) != LibraryViewMode.both) {
      return const _FilteredEmpty(byFilter: false);
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
      const PolaroidHero(),
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
        onPressed: () => context.pushRoute(const BackupRoute()),
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

/// Compact "no results" state for a filter or a library view (#1038) that matched nothing. Only a filter gets the
/// subtitle and the action, which clears every filter and the query, and search mode stays open (like Clear all).
class _FilteredEmpty extends ConsumerWidget {
  const _FilteredEmpty({this.byFilter = true});

  final bool byFilter;

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
            if (byFilter) ...[
              const SizedBox(height: 8),
              Text(
                context.t.timeline_empty_filtered_subtitle,
                textAlign: TextAlign.center,
                style: context.textTheme.bodyMedium?.copyWith(color: context.colorScheme.onSurfaceVariant),
              ),
              const SizedBox(height: 20),
              TextButton(
                key: const Key('timeline-empty-clear-filters'),
                onPressed: () {
                  ref.read(searchStateProvider.notifier).reset();
                  ref.read(searchFieldControllerProvider).clear();
                },
                child: Text(context.t.timeline_empty_clear_filters),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
