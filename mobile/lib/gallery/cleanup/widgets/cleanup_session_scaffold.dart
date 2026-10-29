import 'package:flutter/material.dart';
import 'package:immich_mobile/gallery/cleanup/cleanup_prefs.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_session_state.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_overview_bits.dart';
import 'package:immich_mobile/gallery/motion/motion_tokens.dart';
import 'package:immich_mobile/gallery/motion/pop.dart';
import 'package:immich_mobile/gallery/motion/spring_curve.dart';
import 'package:immich_mobile/gallery/motion/swap.dart';
import 'package:immich_mobile/generated/translations.g.dart';

// The one session screen every cleanup runs in (specs/2026-10-29-mobile-library-cleanup-design.md, "One session screen
// for every cleanup"): the rewind and every queue supply their data, their card signal and their filters, and get the
// same top bar, progress, Done, menu, loading skeleton and error state.

/// One stretch of the progress bar: a rewind year, or the whole queue.
class LibraryCleanupProgressSegment {
  const LibraryCleanupProgressSegment({required this.done, required this.total, this.label});

  final int done;
  final int total;

  /// Shown above the bar while this segment is the current one ("2019 · 7 years ago").
  final String? label;
}

/// The bar under the top bar: one segment per rewind year, or a single plain one for a queue.
class LibraryCleanupProgress {
  const LibraryCleanupProgress({required this.segments, this.current = 0});

  /// A queue's bar: one segment, no label. A growing total ("so far") updates in place.
  LibraryCleanupProgress.plain({required int done, required int total})
    : this(
        segments: [LibraryCleanupProgressSegment(done: done, total: total)],
      );

  final List<LibraryCleanupProgressSegment> segments;

  /// The segment the user is in, whose label shows.
  final int current;

  String? get label => current < segments.length ? segments[current].label : null;
}

/// The ⋯ menu's choices. Queues add their filters through [extra].
class LibraryCleanupSessionMenu {
  const LibraryCleanupSessionMenu({
    required this.deckMode,
    required this.onDeckMode,
    required this.onHowItWorks,
    this.extra = const [],
    this.view = LibraryCleanupView.swipe,
    this.onView,
  });

  final LibraryCleanupDeckMode deckMode;
  final ValueChanged<LibraryCleanupDeckMode> onDeckMode;
  final VoidCallback onHowItWorks;

  /// Swipe or Grid. Without [onView] the session has no grid yet: Grid shows disabled, "coming soon".
  final LibraryCleanupView view;
  final ValueChanged<LibraryCleanupView>? onView;

  /// Items after the shared ones (a queue's filters).
  final List<PopupMenuEntry<VoidCallback>> extra;
}

/// The session screen: top bar (‹ back, title, Done with its pending badge, ⋯), progress, then [body] once [status] is
/// ready, a skeleton of the deck while it loads, or an inline error with retry (the top bar stays, so back works).
///
/// It owns no session state: the page passes what the session shows and handles back, Done and the menu. Back is a
/// plain pop request ([onBack]); the page's PopScope decides whether a close needs asking.
class LibraryCleanupSessionScaffold extends StatelessWidget {
  const LibraryCleanupSessionScaffold({
    super.key,
    required this.title,
    required this.position,
    required this.pendingCount,
    required this.progress,
    required this.status,
    required this.onBack,
    required this.onDone,
    required this.menu,
    required this.body,
    this.onRetry,
    this.doneKey,
    this.skeleton,
    this.overlay,
  });

  /// What the session is about ("Aug 15", "Blurry").
  final String title;

  /// The photo the user is on (1-based) and the total, or null while loading.
  final ({int index, int total})? position;
  final int pendingCount;
  final LibraryCleanupProgress progress;
  final LibraryCleanupLoadStatus status;
  final VoidCallback onBack;

  /// Opens the finish screen. Available as soon as the session has loaded.
  final VoidCallback onDone;
  final VoidCallback? onRetry;
  final LibraryCleanupSessionMenu menu;
  final Widget body;

  /// Placed on the Done button, so marks can fly into it.
  final Key? doneKey;

  /// The loading state; the deck's stack by default.
  final Widget? skeleton;

  /// Drawn over the body (the first-run gesture overlay).
  final Widget? overlay;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final position = this.position;
    final heading = position == null
        ? title
        : context.t.cleanup_session_title(what: title, index: position.index, total: position.total);
    return Scaffold(
      key: const Key('cleanup-session'),
      backgroundColor: theme.colorScheme.surface,
      appBar: AppBar(
        scrolledUnderElevation: 0,
        leading: IconButton(
          key: const Key('cleanup-session-back'),
          tooltip: MaterialLocalizations.of(context).backButtonTooltip,
          icon: const Icon(Icons.chevron_left_rounded, size: 30),
          onPressed: onBack,
        ),
        titleSpacing: 0,
        title: GallerySwap(
          value: heading,
          child: Text(heading, key: const Key('cleanup-session-title'), style: theme.textTheme.titleMedium),
        ),
        actions: [
          _DoneButton(
            key: doneKey,
            count: pendingCount,
            onPressed: status == LibraryCleanupLoadStatus.ready ? onDone : null,
          ),
          _Menu(menu: menu),
        ],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(28),
          child: _ProgressBar(progress: progress),
        ),
      ),
      body: Stack(
        children: [
          Positioned.fill(
            child: switch (status) {
              LibraryCleanupLoadStatus.loading => skeleton ?? const LibraryCleanupDeckSkeleton(),
              LibraryCleanupLoadStatus.error => _Error(onRetry: onRetry),
              LibraryCleanupLoadStatus.ready => body,
            },
          ),
          if (overlay != null && status == LibraryCleanupLoadStatus.ready) Positioned.fill(child: overlay!),
        ],
      ),
    );
  }
}

class _DoneButton extends StatelessWidget {
  const _DoneButton({super.key, required this.count, required this.onPressed});

  final int count;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(right: 2),
      child: TextButton(
        key: const Key('cleanup-session-done'),
        onPressed: onPressed,
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(context.t.done),
            // The badge pops the first time it goes above zero, then only its count tweens.
            if (count > 0)
              Padding(
                padding: const EdgeInsets.only(left: 6),
                child: GalleryPop(
                  onMount: true,
                  child: Container(
                    key: const Key('cleanup-session-badge'),
                    constraints: const BoxConstraints(minWidth: 20),
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                    decoration: BoxDecoration(color: scheme.primary, borderRadius: BorderRadius.circular(10)),
                    child: GallerySwap(
                      value: count,
                      alignment: Alignment.center,
                      child: Text(
                        '$count',
                        key: const Key('cleanup-session-badge-count'),
                        textAlign: TextAlign.center,
                        style: TextStyle(color: scheme.onPrimary, fontSize: 12, fontWeight: FontWeight.w700),
                      ),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _Menu extends StatelessWidget {
  const _Menu({required this.menu});

  final LibraryCleanupSessionMenu menu;

  @override
  Widget build(BuildContext context) {
    final t = context.t;
    CheckedPopupMenuItem<VoidCallback> mode(LibraryCleanupDeckMode mode, String label) => CheckedPopupMenuItem(
      key: Key('cleanup-menu-mode-${mode.name}'),
      checked: menu.deckMode == mode,
      value: () => menu.onDeckMode(mode),
      child: Text(label),
    );
    return PopupMenuButton<VoidCallback>(
      key: const Key('cleanup-session-menu'),
      icon: const Icon(Icons.more_horiz_rounded),
      onSelected: (action) => action(),
      itemBuilder: (context) => [
        // Swipe or Grid; a session without a grid yet shows it disabled.
        CheckedPopupMenuItem(
          key: const Key('cleanup-menu-swipe'),
          checked: menu.view == LibraryCleanupView.swipe,
          value: () => menu.onView?.call(LibraryCleanupView.swipe),
          child: Text(t.cleanup_menu_swipe),
        ),
        if (menu.onView == null)
          PopupMenuItem(key: const Key('cleanup-menu-grid'), enabled: false, child: Text(t.cleanup_menu_grid_soon))
        else
          CheckedPopupMenuItem(
            key: const Key('cleanup-menu-grid'),
            checked: menu.view == LibraryCleanupView.grid,
            value: () => menu.onView!(LibraryCleanupView.grid),
            child: Text(t.cleanup_mode_grid),
          ),
        const PopupMenuDivider(),
        mode(LibraryCleanupDeckMode.swipe, t.cleanup_deck_mode_swipe),
        mode(LibraryCleanupDeckMode.button, t.cleanup_deck_mode_buttons),
        ...menu.extra,
        const PopupMenuDivider(),
        PopupMenuItem(
          key: const Key('cleanup-menu-how-it-works'),
          value: menu.onHowItWorks,
          child: Text(t.cleanup_how_it_works),
        ),
      ],
    );
  }
}

class _ProgressBar extends StatelessWidget {
  const _ProgressBar({required this.progress});

  final LibraryCleanupProgress progress;

  static final _gentle = GallerySpringCurve(GalleryMotion.gentle);

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final reduced = GalleryMotion.reduced(context);
    final label = progress.label;
    final segments = progress.segments.where((segment) => segment.total > 0).toList();
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(
            height: 16,
            child: label == null
                ? null
                // Crossing into a new year slides its label in from the right.
                : AnimatedSwitcher(
                    duration: reduced ? Duration.zero : GalleryMotion.base,
                    switchInCurve: GalleryMotion.settle,
                    switchOutCurve: GalleryMotion.exit,
                    layoutBuilder: (current, previous) =>
                        Stack(alignment: AlignmentDirectional.centerStart, children: [...previous, ?current]),
                    transitionBuilder: (child, animation) => FadeTransition(
                      opacity: animation,
                      child: SlideTransition(
                        position: Tween(begin: const Offset(0.25, 0), end: Offset.zero).animate(animation),
                        child: child,
                      ),
                    ),
                    child: KeyedSubtree(
                      key: ValueKey(label),
                      child: Text(
                        label,
                        key: const Key('cleanup-session-year'),
                        style: TextStyle(fontSize: 11, color: scheme.onSurfaceVariant),
                      ),
                    ),
                  ),
          ),
          const SizedBox(height: 4),
          Row(
            key: const Key('cleanup-session-progress'),
            children: [
              for (final (index, segment) in segments.indexed) ...[
                if (index > 0) const SizedBox(width: 3),
                Expanded(
                  flex: segment.total,
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(2),
                    child: SizedBox(
                      height: 4,
                      child: ColoredBox(
                        color: scheme.surfaceContainerHighest,
                        child: TweenAnimationBuilder<double>(
                          tween: Tween(end: segment.done / segment.total),
                          duration: reduced ? Duration.zero : GalleryMotion.slow,
                          curve: _gentle,
                          builder: (context, value, _) => FractionallySizedBox(
                            key: Key('cleanup-session-progress-$index'),
                            alignment: AlignmentDirectional.centerStart,
                            widthFactor: value.clamp(0.0, 1.0),
                            child: ColoredBox(color: scheme.primary),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }
}

class _Error extends StatelessWidget {
  const _Error({required this.onRetry});

  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) => Center(
    key: const Key('cleanup-session-error'),
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.cloud_off_rounded, color: Theme.of(context).colorScheme.onSurfaceVariant),
          const SizedBox(height: 10),
          Text(context.t.cleanup_overview_load_failed, textAlign: TextAlign.center),
          if (onRetry != null)
            TextButton(key: const Key('cleanup-session-retry'), onPressed: onRetry, child: Text(context.t.retry)),
        ],
      ),
    ),
  );
}

/// The deck's loading state: the card stack in its real place, with the sheen. [hero] (the photo the session was
/// opened from) sits on the top card, so the overview's photo has somewhere to fly into before the data lands.
class LibraryCleanupDeckSkeleton extends StatelessWidget {
  const LibraryCleanupDeckSkeleton({super.key, this.hero});

  final Widget? hero;

  @override
  Widget build(BuildContext context) => Padding(
    key: const Key('cleanup-deck-skeleton'),
    padding: libraryCleanupDeckPadding,
    child: Column(
      children: [
        Expanded(
          child: Stack(
            children: [
              const Positioned.fill(
                child: Padding(
                  padding: EdgeInsets.fromLTRB(10, 14, 10, 0),
                  child: LibraryCleanupSkeleton(height: double.infinity, radius: 22),
                ),
              ),
              Positioned.fill(
                child: hero == null
                    ? const LibraryCleanupSkeleton(height: double.infinity, radius: 22)
                    : ClipRRect(borderRadius: BorderRadius.circular(22), child: hero),
              ),
            ],
          ),
        ),
        const SizedBox(height: libraryCleanupButtonRowGap),
        const SizedBox(
          height: libraryCleanupButtonRowHeight,
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: [
              LibraryCleanupSkeleton(width: 40, height: 40, radius: 20),
              LibraryCleanupSkeleton(width: 56, height: 56, radius: 28),
              LibraryCleanupSkeleton(width: 56, height: 56, radius: 28),
              LibraryCleanupSkeleton(width: 56, height: 56, radius: 28),
              LibraryCleanupSkeleton(width: 40, height: 40, radius: 20),
            ],
          ),
        ),
      ],
    ),
  );
}

/// Where the deck sits in the session body (shared with its skeleton so loading does not jump).
const libraryCleanupDeckPadding = EdgeInsets.fromLTRB(14, 6, 14, 16);
const libraryCleanupButtonRowHeight = 64.0;
const libraryCleanupButtonRowGap = 16.0;
