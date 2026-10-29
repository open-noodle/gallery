import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/cleanup/cleanup_prefs.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_filters.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_marks.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_queue.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_series.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_session_state.dart';
import 'package:immich_mobile/gallery/cleanup/navigation.dart';
import 'package:immich_mobile/gallery/cleanup/pages/cleanup_queue.page.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup.providers.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup_queue.providers.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup_rewind.providers.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup_series.provider.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_deck_card.dart' show libraryCleanupPreview;
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_details_sheet.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_finish.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_overview_bits.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_session_dialogs.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_session_scaffold.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_trash_confirm.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_view_flight.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/series_card.dart';
import 'package:immich_mobile/gallery/motion/motion_host.dart';
import 'package:immich_mobile/gallery/motion/motion_tokens.dart';
import 'package:immich_mobile/gallery/motion/removal.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:openapi/api.dart';

enum _Phase { content, finish, allClear }

/// Bursts and Duplicates in the session screen (specs/2026-10-29-mobile-library-cleanup-design.md, "Queues: Bursts and
/// Duplicates"; mockup `3-queues.html`, third screen): a series card per burst or duplicate group, in the series deck
/// or the list, with the same top bar, Done, finish screen, trash confirmation and undo toast as the photo queues. The
/// queue page (`cleanup_queue.page.dart`) hands these two queues to this view.
class LibraryCleanupSeriesQueueView extends ConsumerStatefulWidget {
  const LibraryCleanupSeriesQueueView({super.key, required this.queue});

  final LibraryCleanupQueue queue;

  @override
  ConsumerState<LibraryCleanupSeriesQueueView> createState() => _LibraryCleanupSeriesQueueViewState();
}

class _LibraryCleanupSeriesQueueViewState extends ConsumerState<LibraryCleanupSeriesQueueView>
    with LibraryCleanupViewFlight {
  final _doneKey = GlobalKey();
  _Phase _phase = _Phase.content;
  _Phase _shown = _Phase.content;
  bool _stayOnDeck = false;
  bool _restoredShown = false;
  bool _overlay = false;
  bool _overlayChecked = false;
  Offset? _flightTarget;
  bool _flightDissolves = false;

  LibraryCleanupQueue get _queue => widget.queue;
  bool get _duplicates => _queue == LibraryCleanupQueue.duplicates;
  LibraryCleanupSeriesNotifier get _session => ref.read(libraryCleanupSeriesProvider(_queue).notifier);
  LibraryCleanupSeriesState get _state => ref.read(libraryCleanupSeriesProvider(_queue));

  void _leave() {
    if (mounted) {
      Navigator.of(context).pop();
    }
  }

  Future<void> _onBack() async {
    final state = _state;
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

  Offset? _centerOf(GlobalKey key) {
    final box = key.currentContext?.findRenderObject();
    final overlay = GalleryMotionHost.overlayBox;
    if (box is! RenderBox || !box.hasSize || overlay == null) {
      return null;
    }
    return overlay.globalToLocal(box.localToGlobal(box.size.center(Offset.zero)));
  }

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

  /// The frames that will go to the trash once applied, in deck order.
  List<CleanupAssetDto> _trashPile(LibraryCleanupSeriesState state) => [
    for (final series in state.series)
      if (state.decisions.containsKey(series.id))
        for (final asset in series.assets)
          if (!state.willKeep(series, asset.id)) asset,
  ];

  Future<void> _apply() async {
    _flightTarget = _centerOf(_doneKey);
    _flightDissolves = !ref.read(libraryCleanupTrashEnabledProvider);
    final result = await _session.apply(confirm: (check) => showLibraryCleanupTrashConfirm(context, check));
    _flightTarget = null;
    if (!mounted || !_reportFailure(result)) {
      return;
    }
    final state = _state;
    final emptied = state.series.isEmpty && !state.hasMore;
    final messenger = ScaffoldMessenger.of(context);
    final t = context.t;
    if (emptied) {
      setState(() => _phase = _Phase.content);
    } else {
      _leave();
    }
    final repository = ref.read(libraryCleanupRepositoryProvider);
    final session = _session;
    final count = result.trashed.length;
    messenger.showSnackBar(
      SnackBar(
        key: const Key('cleanup-toast'),
        duration: const Duration(seconds: 5),
        content: Text(
          result.trashed.isEmpty
              ? t.saved
              : !result.trashUndoAvailable
              ? t.permanently_deleted_assets_count(count: count)
              // The copies come back from the trash; the duplicate groups only when the server detects them again.
              : _duplicates
              ? t.cleanup_duplicates_trashed_toast(count: count)
              : t.assets_trashed_count(count: count),
        ),
        action: result.trashUndoAvailable
            ? SnackBarAction(
                key: const Key('cleanup-toast-undo'),
                label: t.undo,
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

  Future<void> _open(CleanupAssetDto asset) async {
    final opened = await ref.read(libraryCleanupOpenInLibraryProvider)(context, ref, asset);
    if (!opened && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(context.t.cleanup_open_in_library_failed)));
    }
  }

  Future<void> _showDay(CleanupAssetDto asset) async {
    final day = DateTime.tryParse(asset.localDateTime);
    if (day != null) {
      await ref.read(libraryCleanupShowDayProvider)(context, day);
    }
  }

  /// ⓘ on the big frame: the details sheet for the frame shown. Duplicates carry the full asset, so the sheet only asks
  /// for the albums. Keep or Trash there sets the frame's mark.
  Future<void> _details(LibraryCleanupSeries series, CleanupAssetDto frame) async {
    final index = series.assets.indexWhere((asset) => asset.id == frame.id);
    final mark = await showLibraryCleanupDetails(
      context,
      LibraryCleanupDetailsRequest(
        asset: frame,
        fullAsset: series.full[frame.id],
        subtitle: context.t.cleanup_frame_position(index: index + 1, total: series.assets.length),
        marks: const [LibraryCleanupMark.trash, LibraryCleanupMark.keep],
        onOpenInLibrary: () => unawaited(_open(frame)),
        onShowDay: () => unawaited(_showDay(frame)),
      ),
    );
    if (mark != null && mounted) {
      _session.setFrame(frame.id, keep: mark != LibraryCleanupMark.trash);
    }
  }

  /// A long press on the finish screen's pile: the frame's details.
  Future<void> _pileDetails(CleanupAssetDto asset) async {
    final series = _state.series.where((item) => item.assets.any((frame) => frame.id == asset.id)).firstOrNull;
    if (series != null) {
      await _details(series, asset);
    }
  }

  /// The big frame of [seriesId]'s card in the deck.
  Rect? _cardRect(String seriesId) => libraryCleanupRectOf(context, {Key('cleanup-series-frame-$seriesId')});

  /// Swipe ↔ Grid, as everywhere: the deck's big frame flies into its series in the list, or the first undecided
  /// series' frame flies back into the deck; reduced motion crossfades.
  void _setView(LibraryCleanupView view) {
    final prefs = ref.read(libraryCleanupPrefsProvider);
    if (prefs.viewFor(_queue) == view && _phase == _Phase.content) {
      return;
    }
    final state = _state;
    final first = state.undecided.firstOrNull;
    final byId = {for (final series in state.series) series.id: series};
    switchViewWithFlight(
      toGrid: view == LibraryCleanupView.grid,
      id: _shown == _Phase.content ? first?.id : null,
      cardRect: _cardRect,
      picture: (id) => _framePicture(byId[id]!),
      cardRadius: 16,
      tileRadius: 16,
      commit: () {
        ref.read(libraryCleanupPrefsProvider.notifier).setView(_queue, view);
        setState(() {
          _phase = _Phase.content;
          _stayOnDeck = false;
        });
      },
    );
  }

  /// The series' frame as both views open on it: its suggestion, whole on black.
  Widget _framePicture(LibraryCleanupSeries series) {
    final frame =
        series.assets.where((asset) => series.suggested.contains(asset.id)).firstOrNull ?? series.assets.first;
    return ColoredBox(
      color: Colors.black,
      child: Image(
        image: libraryCleanupPreview(frame),
        fit: BoxFit.contain,
        gaplessPlayback: true,
        errorBuilder: (_, _, _) => const SizedBox.expand(),
      ),
    );
  }

  /// "How it works", and the first Bursts or Duplicates session: the series card's own gestures. Seen as soon as it
  /// shows; a flag of its own, since the photo decks' lesson does not teach these swipes.
  void _showOverlay() {
    setState(() => _overlay = true);
    ref.read(libraryCleanupPrefsProvider.notifier).markSeriesOverlaySeen();
  }

  void _onSession(LibraryCleanupSeriesState? previous, LibraryCleanupSeriesState next) {
    if (!_restoredShown && next.isReady && next.restoredMarks) {
      _restoredShown = true;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(key: const Key('cleanup-restored'), content: Text(context.t.cleanup_restored_marks)));
    }
    if (_stayOnDeck && next.undecided.isNotEmpty) {
      setState(() => _stayOnDeck = false);
    }
    final applying = next.applying;
    final target = _flightTarget;
    if (applying != null && applying.total > 0 && applying.done == 0 && target != null) {
      _flightTarget = null;
      final ids = _trashPile(next).map((asset) => asset.id);
      if (_flightDissolves) {
        GalleryRemoval.dissolve(ids);
      } else {
        GalleryRemoval.send(ids, target: target);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(libraryCleanupSeriesProvider(_queue));
    final prefs = ref.watch(libraryCleanupPrefsProvider);
    ref.listen(libraryCleanupSeriesProvider(_queue), _onSession);
    // Bursts count their series on the server; Duplicates arrive whole, so their total is what loaded.
    final count = _duplicates
        ? null
        : ref.watch(libraryCleanupQueueTotalProvider(LibraryCleanupFilters.defaults(_queue))).valueOrNull;
    final view = prefs.viewFor(_queue);
    final total = math.max(count?.count ?? 0, state.series.length);
    if (state.isReady && !_overlayChecked) {
      _overlayChecked = true;
      if (view == LibraryCleanupView.swipe && !prefs.seriesOverlaySeen && state.series.isNotEmpty) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) {
            _showOverlay();
          }
        });
      }
    }

    final empty = state.isReady && state.series.isEmpty && !state.hasMore && !state.loadingMore;
    final lastDecided =
        view == LibraryCleanupView.swipe &&
        state.isReady &&
        state.series.isNotEmpty &&
        state.undecided.isEmpty &&
        !state.hasMore &&
        !_stayOnDeck;
    final phase = _phase == _Phase.content && empty
        ? _Phase.allClear
        : _phase == _Phase.content && lastDecided
        ? _Phase.finish
        : _phase;
    _shown = phase;
    final canPop = phase == _Phase.allClear || (phase == _Phase.content && state.pendingCount == 0);

    final actions = LibraryCleanupSeriesActions(
      decide: _session.decide,
      flip: _session.flip,
      undo: _session.undo,
      details: (series, frame) => unawaited(_details(series, frame)),
    );
    final pile = _trashPile(state);
    final kept = [
      for (final series in state.series)
        if (state.decisions.containsKey(series.id))
          for (final asset in series.assets)
            if (state.willKeep(series, asset.id)) asset,
    ];

    final Widget body = switch (phase) {
      _Phase.content =>
        view == LibraryCleanupView.grid
            ? LibraryCleanupSeriesList(
                key: gridKey,
                hiddenId: landingId,
                state: state,
                actions: actions,
                onKeepSuggestionForAll: _session.keepSuggestionForAll,
                onNearEnd: () => unawaited(_session.loadMore()),
              )
            : LibraryCleanupSeriesDeck(key: const ValueKey('series-deck'), state: state, actions: actions),
      _Phase.finish => LibraryCleanupFinishView.queue(
        title: libraryCleanupQueueName(context, _queue),
        summary: LibraryCleanupFinishSummary(
          decided: state.decided,
          total: total,
          kept: kept.length,
          favorites: 0,
          trash: pile,
        ),
        applying: state.applying,
        onApply: () => unawaited(_apply()),
        onKeepGoing: () => setState(() {
          _phase = _Phase.content;
          _stayOnDeck = state.undecided.isEmpty;
        }),
        onRescue: (asset) => _session.rescue(asset.id),
        onDetails: (asset) => unawaited(_pileDetails(asset)),
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
        guardBackSwipe: !canPop,
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
        // The series card has one layout: its buttons are always under it and its swipes always decide, so the menu
        // offers no swipe / button choice here.
        menu: LibraryCleanupSessionMenu(
          deckMode: prefs.deckMode,
          onHowItWorks: _showOverlay,
          view: view,
          onView: _setView,
        ),
        overlay: _overlay && phase == _Phase.content && view == LibraryCleanupView.swipe
            ? LibraryCleanupGestureOverlay(
                gestures: LibraryCleanupGestures.series(context, duplicates: _duplicates),
                onDismiss: () => setState(() => _overlay = false),
              )
            : null,
        showViewSwitch: phase == _Phase.content,
        body: AnimatedSwitcher(
          duration: GalleryMotion.reduced(context) ? GalleryMotion.quick : GalleryMotion.base,
          child: KeyedSubtree(key: ValueKey((phase, view)), child: body),
        ),
      ),
    );
  }
}
