import 'dart:async';
import 'dart:math' as math;

import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/cleanup/cleanup_prefs.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_filters.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_marks.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_overview.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_queue.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_session_state.dart';
import 'package:immich_mobile/gallery/cleanup/navigation.dart';
import 'package:immich_mobile/gallery/cleanup/pages/cleanup_series_queue.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup.providers.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup_overview.providers.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup_queue.providers.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup_rewind.providers.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup_series.provider.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup_session.provider.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_deck.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_deck_card.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_details_sheet.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_finish.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_overview_bits.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_queue_card.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_queue_filters.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_queue_grid.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_session_dialogs.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_session_scaffold.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_trash_confirm.dart';
import 'package:immich_mobile/gallery/motion/motion_host.dart';
import 'package:immich_mobile/gallery/motion/motion_tokens.dart';
import 'package:immich_mobile/gallery/motion/pop.dart';
import 'package:immich_mobile/gallery/motion/removal.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/widgets/images/remote_image_provider.dart';
import 'package:openapi/api.dart';

enum _Phase { content, finish, allClear }

/// A cleanup queue (specs/2026-10-29-mobile-library-cleanup-design.md, "Queues: Blurry, Screenshots, Space hogs";
/// mockups `3-queues.html` and `5-grid-and-finish.html`). Runs in the shared session screen with the deck or the grid;
/// marks build up locally until Done → Apply, as in the rewind.
///
/// A photo queue only supplies its card signal ([libraryCleanupQueueCardInfo]) and its filters; Bursts and Duplicates
/// plug in the series card ([LibraryCleanupSeriesQueueView]). [queue] is the queue's [LibraryCleanupQueue.slug], and
/// [heroAssetId] (with [heroThumbhash]) the overview card's cover, which flies into the first card: plain strings, so
/// the route needs no fork type in the router.
@RoutePage()
class LibraryCleanupQueuePage extends ConsumerStatefulWidget {
  const LibraryCleanupQueuePage({super.key, required this.queue, this.heroAssetId, this.heroThumbhash});

  final String queue;
  final String? heroAssetId;
  final String? heroThumbhash;

  @override
  ConsumerState<LibraryCleanupQueuePage> createState() => _LibraryCleanupQueuePageState();
}

class _LibraryCleanupQueuePageState extends ConsumerState<LibraryCleanupQueuePage> {
  late final LibraryCleanupQueue _queue = LibraryCleanupQueue.fromSlug(widget.queue) ?? LibraryCleanupQueue.blurry;
  late final _request = LibraryCleanupSessionRequest.queue(_queue);
  final _doneKey = GlobalKey();

  _Phase _phase = _Phase.content;

  /// The phase on screen: the deck turns into the finish screen by itself once its last card is decided.
  _Phase _shown = _Phase.content;

  /// "Keep going" from a finish screen that opened by itself: stay on the deck until a card is undecided again.
  bool _stayOnDeck = false;
  bool _overlay = false;
  bool _overlayChecked = false;
  bool _restoredShown = false;

  /// Every photo this session has shown, so marks made under other filters still have their size on the finish screen.
  final Map<String, CleanupAssetDto> _seen = {};

  /// Where the photos of the apply in progress fly once the server is being asked (null: none fly).
  Offset? _flightTarget;
  bool _flightDissolves = false;

  LibraryCleanupSessionNotifier get _session => ref.read(libraryCleanupSessionProvider(_request).notifier);

  // ---------------------------------------------------------------------------------------------------------------
  // Leaving
  // ---------------------------------------------------------------------------------------------------------------

  void _leave() {
    if (mounted) {
      Navigator.of(context).pop();
    }
  }

  /// ‹, Android back and the iOS back swipe: back to the photos from the finish screen; with pending marks, ask first.
  Future<void> _onBack() async {
    final state = ref.read(libraryCleanupSessionProvider(_request));
    if (state.applying != null) {
      return;
    }
    switch (_shown) {
      case _Phase.allClear:
        _leave();
      case _Phase.finish:
        setState(() {
          _phase = _Phase.content;
          _stayOnDeck = state.undecided.isEmpty;
        });
      case _Phase.content:
        if (state.pendingCount == 0) {
          _leave();
          return;
        }
        final choice = await showLibraryCleanupCloseGuard(
          context,
          pending: state.pendingCount,
          applyLabel: context.t.cleanup_finish_apply,
        );
        switch (choice) {
          case LibraryCleanupCloseChoice.apply:
            await _apply();
          case LibraryCleanupCloseChoice.discard:
            _session.discard();
            _leave();
          case LibraryCleanupCloseChoice.keepGoing:
            break;
        }
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Applying
  // ---------------------------------------------------------------------------------------------------------------

  Offset? _centerOf(GlobalKey key) {
    final box = key.currentContext?.findRenderObject();
    final overlay = GalleryMotionHost.overlayBox;
    if (box is! RenderBox || !box.hasSize || overlay == null) {
      return null;
    }
    return overlay.globalToLocal(box.localToGlobal(box.size.center(Offset.zero)));
  }

  /// Reports a commit that did not go through. Returns true when it did.
  bool _reportFailure(LibraryCleanupApplyResult result) {
    final messenger = ScaffoldMessenger.of(context);
    switch (result.status) {
      case LibraryCleanupApplyStatus.applied:
        return true;
      case LibraryCleanupApplyStatus.cancelled:
        return false;
      case LibraryCleanupApplyStatus.lookupFailed:
        messenger.showSnackBar(SnackBar(content: Text(context.t.cleanup_trash_check_failed)));
      case LibraryCleanupApplyStatus.failed:
        messenger.showSnackBar(
          SnackBar(
            content: Text(
              result.appliedIds.isEmpty
                  ? context.t.cleanup_apply_failed
                  : context.t.cleanup_apply_partly_failed(count: result.appliedIds.length),
            ),
          ),
        );
    }
    return false;
  }

  /// Apply (the finish screen, or the close prompt): commits the marks after the one trash confirmation. An emptied
  /// queue then says "All clear"; otherwise the session goes back to where it was opened from. Either way the trash
  /// gets its 5-second Undo when the trash is on.
  Future<void> _apply() async {
    _flightTarget = _centerOf(_doneKey);
    _flightDissolves = !ref.read(libraryCleanupTrashEnabledProvider);
    final result = await _session.applyAndStop(confirm: (check) => showLibraryCleanupTrashConfirm(context, check));
    _flightTarget = null;
    if (!mounted || !_reportFailure(result)) {
      return;
    }
    final state = ref.read(libraryCleanupSessionProvider(_request));
    final emptied = state.assets.isEmpty && !state.hasMore && state.pendingCount == 0;
    final messenger = ScaffoldMessenger.of(context);
    final t = context.t;
    if (emptied) {
      // "All clear" shows by itself on an empty queue, and goes if the toast's Undo brings photos back.
      setState(() => _phase = _Phase.content);
    } else {
      _leave();
    }
    final repository = ref.read(libraryCleanupRepositoryProvider);
    final session = _session;
    messenger.showSnackBar(
      SnackBar(
        key: const Key('cleanup-toast'),
        duration: const Duration(seconds: 5),
        content: Text(
          result.trashed.isEmpty
              ? t.saved
              : result.trashUndoAvailable
              ? t.assets_trashed_count(count: result.trashed.length)
              : t.permanently_deleted_assets_count(count: result.trashed.length),
        ),
        action: result.trashUndoAvailable
            ? SnackBarAction(
                key: const Key('cleanup-toast-undo'),
                label: t.undo,
                // Still on the queue ("All clear"): the photos come back into it. Gone: the trash gives them back.
                onPressed: () => unawaited(
                  (mounted ? session.restoreTrashed(result) : repository.restoreAssets(result.trashed)).catchError(
                    (_) => const <String>[],
                  ),
                ),
              )
            : null,
      ),
    );
    if (result.skipped.isNotEmpty) {
      messenger.showSnackBar(SnackBar(content: Text(t.cleanup_skipped_count(count: result.skipped.length))));
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // The rest
  // ---------------------------------------------------------------------------------------------------------------

  Future<void> _open(CleanupAssetDto asset) async {
    final opened = await ref.read(libraryCleanupOpenInLibraryProvider)(context, ref, asset);
    if (!opened && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(context.t.cleanup_open_in_library_failed)));
    }
  }

  /// "Show that day": every photo taken on the card's (wall-clock) date, in the search results.
  Future<void> _showDay(CleanupAssetDto asset) async {
    final DateTime day;
    try {
      day = DateTime.parse(asset.localDateTime);
    } catch (_) {
      return;
    }
    await ref.read(libraryCleanupShowDayProvider)(context, day);
  }

  /// The details sheet for a queue photo: how long ago and where it sits in the queue ("Photo 3 of 87"). The sheet
  /// adds the queue's own signal (Blurry's reason and sharpness) from the photo itself.
  Future<LibraryCleanupMark?> _details(CleanupAssetDto asset, String? heroTag) {
    final state = ref.read(libraryCleanupSessionProvider(_request));
    final filters = state.filters ?? LibraryCleanupFilters.defaults(_queue);
    final total = math.max(ref.read(libraryCleanupQueueTotalProvider(filters)).valueOrNull?.count ?? 0, state.total);
    final now = ref.read(libraryCleanupClockProvider)();
    final t = context.t;
    final index = state.assets.indexWhere((candidate) => candidate.id == asset.id);
    final taken = DateTime.tryParse(asset.localDateTime);
    final subtitle = [
      if (taken != null) t.cleanup_years_ago(count: math.max(now.year - taken.year, 0)),
      if (index >= 0) t.cleanup_photo_position(index: state.alreadyDone + index + 1, total: total),
    ].join(' · ');
    return showLibraryCleanupDetails(
      context,
      LibraryCleanupDetailsRequest(
        asset: asset,
        subtitle: subtitle.isEmpty ? null : subtitle,
        heroTag: heroTag,
        onOpenInLibrary: () => unawaited(_open(asset)),
        onShowDay: () => unawaited(_showDay(asset)),
      ),
    );
  }

  /// A long press in the grid or on the finish screen: the details sheet, and the mark chosen there applied to the
  /// photo.
  Future<void> _gridDetails(CleanupAssetDto asset) async {
    final mark = await _details(asset, null);
    if (mark != null && mounted) {
      _session.mark(asset.id, mark);
    }
  }

  Future<void> _editFilters() async {
    final current = ref.read(libraryCleanupSessionProvider(_request)).filters ?? LibraryCleanupFilters.defaults(_queue);
    final chosen = await showLibraryCleanupFiltersSheet(context, current);
    if (mounted && chosen != current) {
      // Pages again from the start; the marks stay.
      unawaited(_session.setFilters(chosen));
    }
  }

  void _setView(LibraryCleanupView view) {
    ref.read(libraryCleanupPrefsProvider.notifier).setView(_queue, view);
    setState(() {
      _phase = _Phase.content;
      _stayOnDeck = false;
    });
  }

  void _showOverlay() {
    setState(() => _overlay = true);
    // Seen as soon as it shows, as the web explainer counts it; shared with the rewind, so it shows once in all.
    ref.read(libraryCleanupPrefsProvider.notifier).markOverlaySeen();
  }

  void _onSession(LibraryCleanupSessionState? previous, LibraryCleanupSessionState next) {
    if (!_restoredShown && next.isReady && next.restoredMarks) {
      _restoredShown = true;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(key: const Key('cleanup-restored'), content: Text(context.t.cleanup_restored_marks)));
    }
    if (_stayOnDeck && next.undecided.isNotEmpty) {
      setState(() => _stayOnDeck = false);
    }
    // The server is being asked now (any confirmation is behind us): the marked photos fly while it answers.
    final applying = next.applying;
    final target = _flightTarget;
    if (applying != null && applying.total > 0 && applying.done == 0 && target != null) {
      _flightTarget = null;
      final ids = next.marks.entries.where((e) => e.value == LibraryCleanupMark.trash).map((e) => e.key);
      if (_flightDissolves) {
        GalleryRemoval.dissolve(ids);
      } else {
        GalleryRemoval.send(ids, target: target);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (libraryCleanupSeriesQueues.contains(_queue)) {
      return LibraryCleanupSeriesQueueView(queue: _queue);
    }
    final t = context.t;
    final state = ref.watch(libraryCleanupSessionProvider(_request));
    final prefs = ref.watch(libraryCleanupPrefsProvider);
    ref.listen(libraryCleanupSessionProvider(_request), _onSession);
    final filters = state.filters ?? LibraryCleanupFilters.defaults(_queue);
    final count = ref.watch(libraryCleanupQueueTotalProvider(filters)).valueOrNull;
    final view = prefs.viewFor(_queue);
    for (final asset in state.assets) {
      _seen[asset.id] = asset;
    }

    if (state.isReady && !_overlayChecked) {
      _overlayChecked = true;
      if (!prefs.overlaySeen && view == LibraryCleanupView.swipe) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) {
            _showOverlay();
          }
        });
      }
    }

    final empty = state.isReady && state.assets.isEmpty && !state.hasMore && !state.loadingMore;
    final lastDecided =
        view == LibraryCleanupView.swipe &&
        state.isReady &&
        state.assets.isNotEmpty &&
        state.undecided.isEmpty &&
        !state.hasMore &&
        !_stayOnDeck;
    final phase = _phase == _Phase.content && empty && state.pendingCount == 0
        ? _Phase.allClear
        : _phase == _Phase.content && (lastDecided || (empty && state.pendingCount > 0))
        ? _Phase.finish
        : _phase;
    _shown = phase;

    // A growing total ("so far") updates in place; it is never below what has loaded.
    final total = math.max(count?.count ?? 0, state.total);
    final heroTag = widget.heroAssetId == null ? null : LibraryCleanupHeroTags.queue(_queue);
    final canPop = phase == _Phase.allClear || (phase == _Phase.content && state.pendingCount == 0);

    final Widget body = switch (phase) {
      _Phase.content =>
        view == LibraryCleanupView.grid
            ? LibraryCleanupQueueGrid(
                key: const ValueKey('grid'),
                queue: _queue,
                assets: state.assets,
                marks: state.marks,
                onMark: _session.markMany,
                onDetails: (asset) {
                  ref.read(libraryCleanupPrefsProvider.notifier).markGridHintSeen();
                  unawaited(_gridDetails(asset));
                },
                onNearEnd: () => unawaited(_session.loadMore()),
                showHint: !prefs.gridHintSeen,
              )
            : LibraryCleanupDeck(
                key: const ValueKey('deck'),
                assets: state.assets,
                marks: state.marks,
                mode: prefs.deckMode,
                canUndo: state.canUndo,
                onMark: _session.mark,
                onUndo: _session.undo,
                onOpen: (asset) => unawaited(_open(asset)),
                info: (context, asset) => libraryCleanupQueueCardInfo(context, _queue, asset),
                openDetails: _details,
                heroTag: heroTag,
              ),
      _Phase.finish => LibraryCleanupFinishView.queue(
        title: libraryCleanupQueueName(context, _queue),
        summary: LibraryCleanupFinishSummary(
          decided: state.decided,
          total: total,
          kept: state.count(LibraryCleanupMark.keep),
          favorites: state.count(LibraryCleanupMark.favorite),
          trash: [
            for (final entry in state.marks.entries)
              if (entry.value == LibraryCleanupMark.trash && _seen[entry.key] != null) _seen[entry.key]!,
          ],
        ),
        applying: state.applying,
        onApply: () => unawaited(_apply()),
        onKeepGoing: () => setState(() {
          _phase = _Phase.content;
          _stayOnDeck = state.undecided.isEmpty;
        }),
        onRescue: (asset) => _session.keep(asset.id),
        onDetails: (asset) => unawaited(_gridDetails(asset)),
      ),
      _Phase.allClear => LibraryCleanupAllClear(onBack: _leave),
    };

    return PopScope(
      canPop: canPop,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) {
          unawaited(_onBack());
        }
      },
      child: LibraryCleanupSessionScaffold(
        title: libraryCleanupQueueName(context, _queue),
        position: state.isReady && total > 0 && phase == _Phase.content
            ? (index: math.min(state.decided + 1, total), total: total)
            : null,
        pendingCount: state.pendingCount,
        progress: LibraryCleanupProgress.plain(done: state.decided, total: total),
        status: state.status,
        onRetry: () => unawaited(_session.retry()),
        onBack: () => unawaited(_onBack()),
        onDone: () {
          if (_phase == _Phase.content && phase != _Phase.allClear) {
            setState(() => _phase = _Phase.finish);
          }
        },
        doneKey: _doneKey,
        menu: LibraryCleanupSessionMenu(
          deckMode: prefs.deckMode,
          onDeckMode: ref.read(libraryCleanupPrefsProvider.notifier).setDeckMode,
          onHowItWorks: _showOverlay,
          view: view,
          onView: _setView,
          extra: [
            if (libraryCleanupHasFilters(_queue)) ...[
              const PopupMenuDivider(),
              PopupMenuItem(
                key: const Key('cleanup-menu-filters'),
                value: () => unawaited(_editFilters()),
                child: Text(t.filters),
              ),
            ],
          ],
        ),
        skeleton: LibraryCleanupDeckSkeleton(
          hero: heroTag == null
              ? null
              : Hero(
                  tag: heroTag,
                  child: Image(
                    image: RemoteImageProvider.thumbnail(
                      assetId: widget.heroAssetId!,
                      thumbhash: widget.heroThumbhash ?? '',
                    ),
                    fit: BoxFit.cover,
                    width: double.infinity,
                    height: double.infinity,
                    errorBuilder: (_, _, _) => const SizedBox.expand(),
                  ),
                ),
        ),
        overlay: _overlay && phase == _Phase.content && view == LibraryCleanupView.swipe
            ? LibraryCleanupGestureOverlay(onDismiss: () => setState(() => _overlay = false))
            : null,
        body: Column(
          children: [
            if (phase == _Phase.content) LibraryCleanupViewSwitch(view: view, onView: _setView),
            Expanded(
              child: AnimatedSwitcher(
                duration: GalleryMotion.reduced(context) ? GalleryMotion.quick : GalleryMotion.base,
                child: KeyedSubtree(key: ValueKey((phase, view)), child: body),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Swipe / Grid at the top of a queue, remembered per queue.
class LibraryCleanupViewSwitch extends StatelessWidget {
  const LibraryCleanupViewSwitch({super.key, required this.view, required this.onView});

  final LibraryCleanupView view;
  final ValueChanged<LibraryCleanupView> onView;

  @override
  Widget build(BuildContext context) {
    final t = context.t;
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 0, 14, 6),
      child: Align(
        alignment: AlignmentDirectional.centerStart,
        child: SegmentedButton<LibraryCleanupView>(
          key: const Key('cleanup-view-switch'),
          showSelectedIcon: false,
          style: const ButtonStyle(visualDensity: VisualDensity.compact),
          segments: [
            ButtonSegment(
              value: LibraryCleanupView.swipe,
              label: Text(t.cleanup_menu_swipe, key: const Key('cleanup-view-swipe')),
            ),
            ButtonSegment(
              value: LibraryCleanupView.grid,
              label: Text(t.cleanup_mode_grid, key: const Key('cleanup-view-grid')),
            ),
          ],
          selected: {view},
          onSelectionChanged: (selected) => onView(selected.single),
        ),
      ),
    );
  }
}

/// An emptied queue: "All clear", its check popping, and the way back.
class LibraryCleanupAllClear extends StatelessWidget {
  const LibraryCleanupAllClear({super.key, required this.onBack});

  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      key: const Key('cleanup-queue-all-clear'),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const GalleryPop(
              onMount: true,
              child: Icon(Icons.check_circle_rounded, size: 64, color: libraryCleanupKeepColor),
            ),
            const SizedBox(height: 14),
            Text(context.t.cleanup_all_clear, style: theme.textTheme.headlineSmall),
            const SizedBox(height: 6),
            Text(
              context.t.cleanup_queue_empty,
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
            const SizedBox(height: 22),
            FilledButton(
              key: const Key('cleanup-queue-back'),
              onPressed: onBack,
              child: Text(context.t.cleanup_day_done_hub),
            ),
          ],
        ),
      ),
    );
  }
}
