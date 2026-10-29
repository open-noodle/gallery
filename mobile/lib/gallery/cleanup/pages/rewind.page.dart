import 'dart:async';
import 'dart:math' as math;

import 'package:auto_route/auto_route.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/cleanup/cleanup_prefs.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_calendar.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_marks.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_overview.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_queue.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_session_state.dart';
import 'package:immich_mobile/gallery/cleanup/navigation.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup.providers.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup_overview.providers.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup_rewind.providers.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup_session.provider.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_deck.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_deck_card.dart'
    show libraryCleanupCardRadius, libraryCleanupPreview;
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_details_sheet.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_finish.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_overview_bits.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_session_dialogs.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_session_scaffold.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_trash_confirm.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/rewind_grid.dart';
import 'package:immich_mobile/gallery/motion/flight.dart';
import 'package:immich_mobile/gallery/motion/motion_host.dart';
import 'package:immich_mobile/gallery/motion/motion_tokens.dart';
import 'package:immich_mobile/gallery/motion/removal.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/widgets/images/remote_image_provider.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:openapi/api.dart';

enum _Phase { deck, finish, done }

/// One date's rewind (specs/2026-10-29-mobile-library-cleanup-design.md, "Rewind"; mockups `1-flow.html`, screens 3a
/// and 3b, and `5-grid-and-finish.html`): the date's photos from every past year in the deck or the grid, then the
/// finish screen and, once the day is finished, its celebration. Runs in the shared session screen.
///
/// [heroAssetId] (with its [heroThumbhash]) is the overview photo the session was opened from; it flies into the first
/// card. Plain strings, so the route needs no API type.
@RoutePage()
class LibraryCleanupRewindPage extends StatelessWidget {
  const LibraryCleanupRewindPage({super.key, required this.monthDay, this.heroAssetId, this.heroThumbhash});

  final int monthDay;
  final String? heroAssetId;
  final String? heroThumbhash;

  // "Next day" replaces this route with one for another date, and the router may keep the page's element: keyed by the
  // date, the session starts fresh.
  @override
  Widget build(BuildContext context) => _RewindSession(
    key: ValueKey(monthDay),
    monthDay: monthDay,
    heroAssetId: heroAssetId,
    heroThumbhash: heroThumbhash,
  );
}

class _RewindSession extends ConsumerStatefulWidget {
  const _RewindSession({super.key, required this.monthDay, this.heroAssetId, this.heroThumbhash});

  final int monthDay;
  final String? heroAssetId;
  final String? heroThumbhash;

  @override
  ConsumerState<_RewindSession> createState() => _RewindSessionState();
}

class _RewindSessionState extends ConsumerState<_RewindSession> {
  late final _request = LibraryCleanupSessionRequest.rewind(widget.monthDay);
  final _doneKey = GlobalKey();
  final _trashIconKey = GlobalKey();

  _Phase _phase = _Phase.deck;

  /// The phase on screen: the deck turns into the finish screen by itself once every card is decided.
  _Phase _shown = _Phase.deck;

  /// "Keep going" from a finish screen that opened by itself (the last card was decided): stay on the deck until a
  /// card is undecided again.
  bool _stayOnDeck = false;
  bool _overlay = false;
  bool _overlayChecked = false;
  bool _restoredShown = false;

  /// The grid, for the flight between a card and its tile. A new key each time the grid is shown, so a grid still
  /// fading out never shares one with the grid fading in.
  GlobalKey<LibraryCleanupRewindGridState> _gridKey = GlobalKey();

  /// Button mode's photo, after a sideways swipe (swipe mode is always on its first undecided photo).
  String? _buttonCurrentId;

  /// The tile a card is flying into, left empty until it lands.
  String? _landingId;
  bool _gridEntrance = false;
  bool _gridHint = false;

  /// Where the photos of the apply in progress fly once the server is being asked (null: none fly).
  Offset? _flightTarget;
  bool _flightDissolves = false;

  LibraryCleanupDayDoneData? _done;

  /// The day was already reviewed when it opened: finishing it again is not celebrated again.
  late final bool _reviewedAtOpen;
  late final int _streakAtOpen;

  LibraryCleanupSessionNotifier get _session => ref.read(libraryCleanupSessionProvider(_request).notifier);

  @override
  void initState() {
    super.initState();
    final calendar = ref.read(libraryCleanupCalendarProvider);
    _reviewedAtOpen = calendar?.days.where((day) => day.monthDay == widget.monthDay).firstOrNull?.reviewedAt != null;
    _streakAtOpen = calendar?.streak ?? 0;
  }

  String get _shortDate {
    final date = DateTime(2000, widget.monthDay ~/ 100, widget.monthDay % 100);
    final locale = Localizations.maybeLocaleOf(context)?.toLanguageTag() ?? 'en';
    try {
      return DateFormat.MMMd(locale).format(date);
    } catch (_) {
      return DateFormat.MMMd('en').format(date);
    }
  }

  int _yearOf(LibraryCleanupSessionState state, String id) => state.years
      .firstWhere((year) => year.assets.any((asset) => asset.id == id), orElse: () => state.years.first)
      .year;

  LibraryCleanupCardInfo _info(BuildContext context, LibraryCleanupSessionState state, CleanupAssetDto asset) {
    final now = ref.read(libraryCleanupClockProvider)();
    final year = state.years.isEmpty ? DateTime.parse(asset.localDateTime).year : _yearOf(state, asset.id);
    final locale = Localizations.maybeLocaleOf(context)?.toLanguageTag() ?? 'en';
    String time;
    try {
      time = DateFormat.Hm(locale).format(DateTime.parse(asset.localDateTime));
    } catch (_) {
      time = '';
    }
    return LibraryCleanupCardInfo(
      headline: '$year · ${context.t.cleanup_years_ago(count: math.max(now.year - year, 0))}',
      detail: [?asset.city, if (time.isNotEmpty) time].join(' · '),
    );
  }

  LibraryCleanupProgress _progress(BuildContext context, LibraryCleanupSessionState state) {
    final now = ref.read(libraryCleanupClockProvider)();
    final top = state.undecided.firstOrNull;
    final segments = [
      for (final year in state.years)
        LibraryCleanupProgressSegment(
          total: year.count,
          done: year.count - year.assets.where((asset) => !state.marks.containsKey(asset.id)).length,
          label: '${year.year} · ${context.t.cleanup_years_ago(count: math.max(now.year - year.year, 0))}',
        ),
    ];
    final current = top == null
        ? math.max(segments.length - 1, 0)
        : state.years.indexWhere((year) => year.assets.any((asset) => asset.id == top.id));
    return LibraryCleanupProgress(segments: segments, current: math.max(current, 0));
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Leaving
  // ---------------------------------------------------------------------------------------------------------------

  void _leave() {
    if (mounted) {
      Navigator.of(context).pop();
    }
  }

  /// ‹, Android back and the iOS back swipe: back to the deck from the finish screen; with pending marks, ask first.
  Future<void> _onBack() async {
    final state = ref.read(libraryCleanupSessionProvider(_request));
    if (state.applying != null) {
      return;
    }
    switch (_shown) {
      case _Phase.done:
        _leave();
      case _Phase.finish:
        setState(() {
          _phase = _Phase.deck;
          _stayOnDeck = state.undecided.isEmpty;
        });
      case _Phase.deck:
        if (state.pendingCount == 0) {
          _leave();
          return;
        }
        final choice = await showLibraryCleanupCloseGuard(
          context,
          pending: state.pendingCount,
          applyLabel: context.t.cleanup_close_apply,
        );
        switch (choice) {
          case LibraryCleanupCloseChoice.apply:
            await _applyAndStop();
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

  Future<bool> _confirm(LibraryCleanupTrashCheck check) => showLibraryCleanupTrashConfirm(context, check);

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

  void _showSkipped(ScaffoldMessengerState messenger, LibraryCleanupApplyResult result) {
    if (result.skipped.isNotEmpty) {
      messenger.showSnackBar(SnackBar(content: Text(context.t.cleanup_skipped_count(count: result.skipped.length))));
    }
  }

  /// The trash's 5-second Undo (trash on), restoring exactly the ids the server trashed; a plain notice when the
  /// delete was permanent.
  void _showTrashed(ScaffoldMessengerState messenger, LibraryCleanupApplyResult result, {String? message}) {
    if (result.trashed.isEmpty && message == null) {
      return;
    }
    final repository = ref.read(libraryCleanupRepositoryProvider);
    final t = context.t;
    messenger.showSnackBar(
      SnackBar(
        key: const Key('cleanup-toast'),
        duration: const Duration(seconds: 5),
        content: Text(
          message ??
              (result.trashUndoAvailable
                  ? t.assets_trashed_count(count: result.trashed.length)
                  : t.permanently_deleted_assets_count(count: result.trashed.length)),
        ),
        action: result.trashUndoAvailable
            ? SnackBarAction(
                key: const Key('cleanup-toast-undo'),
                label: t.undo,
                onPressed: () => unawaited(repository.restoreAssets(result.trashed).catchError((_) {})),
              )
            : null,
      ),
    );
  }

  /// "Apply and stop for now" (and the close prompt's Apply): commits the marks without finishing the day, flies them
  /// into Done, and goes back to where the session was opened from with "Saved · …".
  Future<void> _applyAndStop() async {
    final state = ref.read(libraryCleanupSessionProvider(_request));
    final position = math.min(state.decided + 1, state.total);
    _flightTarget = _centerOf(_doneKey);
    _flightDissolves = false;
    final result = await _session.applyAndStop(confirm: _confirm);
    _flightTarget = null;
    if (!mounted || !_reportFailure(result)) {
      return;
    }
    final messenger = ScaffoldMessenger.of(context);
    final t = context.t;
    final count = result.trashed.length;
    final message = count == 0
        ? t.cleanup_saved_toast(position: position)
        : result.trashUndoAvailable
        ? t.cleanup_saved_toast_trashed(count: count, position: position)
        : t.cleanup_saved_toast_deleted(count: count, position: position);
    _leave();
    _showTrashed(messenger, result, message: message);
    _showSkipped(messenger, result);
  }

  /// Finishes the day: commits the marks (with [keepTheRest], every untouched photo kept too) and `completeMonthDay`,
  /// then celebrates.
  Future<void> _finish({required bool keepTheRest}) async {
    final state = ref.read(libraryCleanupSessionProvider(_request));
    final kept = state.count(LibraryCleanupMark.keep) + (keepTheRest ? state.undecided.length : 0);
    final favorites = state.count(LibraryCleanupMark.favorite);
    final sizes = {for (final asset in state.assets) asset.id: asset.fileSize.round()};
    final trashEnabled = ref.read(libraryCleanupTrashEnabledProvider);
    _flightTarget = _centerOf(_trashIconKey);
    _flightDissolves = !trashEnabled;
    final result = await _session.finishDay(keepTheRest: keepTheRest, confirm: _confirm);
    _flightTarget = null;
    if (!mounted || !_reportFailure(result)) {
      return;
    }
    if (!result.dayCompleted) {
      return;
    }
    final calendar = ref.read(libraryCleanupCalendarProvider);
    final next = calendar == null ? null : libraryCleanupNextUnreviewedDay(calendar.days, widget.monthDay);
    ref.read(libraryCleanupFinishedDaysProvider.notifier).update((days) => {...days, widget.monthDay});
    setState(() {
      _phase = _Phase.done;
      _done = LibraryCleanupDayDoneData(
        date: libraryCleanupMonthDayLabel(context, widget.monthDay),
        kept: kept,
        favorites: favorites,
        trashed: result.trashed.length,
        freedBytes: result.trashed.fold(0, (sum, id) => sum + (sizes[id] ?? 0)),
        streakBefore: _streakAtOpen,
        nextLabel: next == null
            ? null
            : context.t.cleanup_day_done_next(date: libraryCleanupMonthDayLabel(context, next)),
      );
    });
    final messenger = ScaffoldMessenger.of(context);
    _showTrashed(messenger, result);
    _showSkipped(messenger, result);
  }

  /// "Next day" replaces this session, so back never walks through a chain of days.
  void _next() {
    final calendar = ref.read(libraryCleanupCalendarProvider);
    final next = calendar == null ? null : libraryCleanupNextUnreviewedDay(calendar.days, widget.monthDay);
    if (next != null) {
      unawaited(context.router.replace(LibraryCleanupRewindRoute(monthDay: next)));
    }
  }

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

  /// The details sheet for a photo of this day: how long ago and where it sits in the session ("Photo 16 of 42").
  Future<LibraryCleanupMark?> _details(CleanupAssetDto asset, String? heroTag) {
    final state = ref.read(libraryCleanupSessionProvider(_request));
    final now = ref.read(libraryCleanupClockProvider)();
    final t = context.t;
    final index = state.assets.indexWhere((candidate) => candidate.id == asset.id);
    final year = state.years.isEmpty ? DateTime.parse(asset.localDateTime).year : _yearOf(state, asset.id);
    final subtitle = [
      t.cleanup_years_ago(count: math.max(now.year - year, 0)),
      if (index >= 0) t.cleanup_photo_position(index: state.alreadyDone + index + 1, total: state.total),
    ].join(' · ');
    return showLibraryCleanupDetails(
      context,
      LibraryCleanupDetailsRequest(
        asset: asset,
        subtitle: subtitle,
        heroTag: heroTag,
        onOpenInLibrary: () => unawaited(_open(asset)),
        onShowDay: () => unawaited(_showDay(asset)),
      ),
    );
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

  // ---------------------------------------------------------------------------------------------------------------
  // Swipe and Grid
  // ---------------------------------------------------------------------------------------------------------------

  /// Where the deck's card for [asset] is on screen: the top card in swipe mode, the page in button mode.
  Rect? _cardRect(CleanupAssetDto asset) {
    final keys = {Key('cleanup-card-${asset.id}'), Key('cleanup-page-${asset.id}')};
    RenderBox? found;
    void visit(Element element) {
      if (found != null) {
        return;
      }
      final box = element.renderObject;
      if (keys.contains(element.widget.key) && box is RenderBox && box.hasSize && box.attached) {
        found = box;
        return;
      }
      element.visitChildElements(visit);
    }

    if (mounted) {
      (context as Element).visitChildElements(visit);
    }
    final box = found;
    return box == null ? null : box.localToGlobal(Offset.zero) & box.size;
  }

  void _afterLayout(VoidCallback callback) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        callback();
      }
    });
    WidgetsBinding.instance.scheduleFrame();
  }

  /// Switches between the deck and the grid, keeping every mark and the position: the current card shrinks into its
  /// tile (the grid scrolled to it), or the first undecided tile grows back into the card. Reduced motion: a crossfade.
  void _setView(LibraryCleanupView view) {
    final prefs = ref.read(libraryCleanupPrefsProvider);
    if (prefs.viewFor(LibraryCleanupQueue.rewind) == view) {
      return;
    }
    final state = ref.read(libraryCleanupSessionProvider(_request));
    final reduced = GalleryMotion.reduced(context);
    final first = state.undecided.firstOrNull;
    ref.read(libraryCleanupPrefsProvider.notifier).setView(LibraryCleanupQueue.rewind, view);
    if (view == LibraryCleanupView.grid) {
      final current =
          (prefs.deckMode == LibraryCleanupDeckMode.button
              ? state.assets.where((asset) => asset.id == _buttonCurrentId).firstOrNull
              : null) ??
          first;
      final from = current == null ? null : _cardRect(current);
      final showHint = !prefs.gridHintSeen;
      setState(() {
        _gridKey = GlobalKey();
        _gridEntrance = !reduced;
        _gridHint = _gridHint || showHint;
        _landingId = reduced || from == null ? null : current?.id;
      });
      if (showHint) {
        ref.read(libraryCleanupPrefsProvider.notifier).markGridHintSeen();
      }
      if (current == null) {
        return;
      }
      _afterLayout(() {
        _gridKey.currentState?.reveal(current.id);
        _afterLayout(() {
          final to = _gridKey.currentState?.tileRect(current.id);
          if (reduced || from == null || to == null) {
            setState(() => _landingId = null);
            return;
          }
          _fly(
            current,
            from: from,
            to: to,
            fromRadius: libraryCleanupCardRadius,
            toRadius: libraryCleanupGridTileRadius,
          );
        });
      });
    } else {
      final from = first == null ? null : _gridKey.currentState?.tileRect(first.id);
      setState(() {
        _buttonCurrentId = null;
        _gridEntrance = false;
        _landingId = null;
      });
      if (reduced || from == null || first == null) {
        return;
      }
      _afterLayout(() {
        final to = _cardRect(first);
        if (to != null) {
          _fly(first, from: from, to: to, fromRadius: libraryCleanupGridTileRadius, toRadius: libraryCleanupCardRadius);
        }
      });
    }
  }

  void _fly(CleanupAssetDto asset, {required Rect from, required Rect to, double fromRadius = 0, double toRadius = 0}) {
    GalleryFlight.fly(
      from: from,
      to: to,
      fromRadius: fromRadius,
      toRadius: toRadius,
      child: Image(
        image: libraryCleanupPreview(asset),
        fit: BoxFit.cover,
        gaplessPlayback: true,
        errorBuilder: (_, _, _) => const ColoredBox(color: Colors.black),
      ),
      onLand: () {
        if (mounted && _landingId == asset.id) {
          setState(() => _landingId = null);
        }
      },
    );
  }

  /// A long press in a grid: the details sheet, and the mark chosen there applied to the tile.
  Future<void> _gridDetails(CleanupAssetDto asset) async {
    final mark = await _details(asset, null);
    if (mark != null && mounted) {
      _session.mark(asset.id, mark);
    }
  }

  void _showOverlay() {
    setState(() => _overlay = true);
    // Seen as soon as it shows, as the web explainer counts it.
    ref.read(libraryCleanupPrefsProvider.notifier).markOverlaySeen();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(libraryCleanupSessionProvider(_request));
    final prefs = ref.watch(libraryCleanupPrefsProvider);
    ref.listen(libraryCleanupSessionProvider(_request), _onSession);
    ref.watch(libraryCleanupCalendarProvider);

    final view = prefs.viewFor(LibraryCleanupQueue.rewind);
    final grid = view == LibraryCleanupView.grid;
    if (state.isReady && !_overlayChecked) {
      _overlayChecked = true;
      // The gesture overlay teaches the deck; a session opening in the grid gets the grid's hint instead.
      if (!grid && !prefs.overlaySeen) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) {
            _showOverlay();
          }
        });
      }
      if (grid && !prefs.gridHintSeen) {
        _gridHint = true;
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) {
            ref.read(libraryCleanupPrefsProvider.notifier).markGridHintSeen();
          }
        });
      }
    }
    // Deciding the last card opens the finish screen. Not in the grid, where a tap only steps a tile's mark on: Done
    // opens it there.
    final phase = _phase == _Phase.deck && state.isReady && state.undecided.isEmpty && !_stayOnDeck && !grid
        ? _Phase.finish
        : _phase;
    _shown = phase;
    final heroTag = widget.heroAssetId == null ? null : LibraryCleanupHeroTags.rewind(widget.monthDay);
    final total = state.total;
    final canPop = phase == _Phase.done || (phase == _Phase.deck && state.pendingCount == 0);

    final Widget body = switch (phase) {
      _Phase.deck => AnimatedSwitcher(
        duration: GalleryMotion.reduced(context) ? GalleryMotion.quick : GalleryMotion.base,
        child: grid
            ? LibraryCleanupRewindGrid(
                key: _gridKey,
                years: state.years,
                marks: state.marks,
                nowYear: ref.read(libraryCleanupClockProvider)().year,
                onCycle: _session.cycle,
                onKeepTheRest: (year) => _session.keepTheRest(year: year),
                onDetails: (asset) => unawaited(_gridDetails(asset)),
                hiddenId: _landingId,
                showHint: _gridHint,
                entrance: _gridEntrance,
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
                info: (context, asset) => _info(context, state, asset),
                openDetails: _details,
                heroTag: heroTag,
                onCurrentChanged: (asset) => _buttonCurrentId = asset.id,
              ),
      ),
      _Phase.finish => LibraryCleanupFinishView(
        title: libraryCleanupMonthDayLabel(context, widget.monthDay),
        summary: LibraryCleanupFinishSummary(
          decided: state.decided,
          total: total,
          kept: state.count(LibraryCleanupMark.keep),
          favorites: state.count(LibraryCleanupMark.favorite),
          trash: [
            for (final asset in state.assets)
              if (state.marks[asset.id] == LibraryCleanupMark.trash) asset,
          ],
        ),
        applying: state.applying,
        trashIconKey: _trashIconKey,
        onApplyAndStop: () => unawaited(_applyAndStop()),
        onKeepTheRest: () => unawaited(_finish(keepTheRest: true)),
        onFinish: () => unawaited(_finish(keepTheRest: false)),
        onKeepGoing: () => setState(() {
          _phase = _Phase.deck;
          _stayOnDeck = state.undecided.isEmpty;
        }),
        onRescue: (asset) => _session.keep(asset.id),
        onDetails: (asset) => unawaited(_gridDetails(asset)),
      ),
      _Phase.done => LibraryCleanupDayDone(
        data: _done!,
        streak: ref.read(libraryCleanupCalendarProvider)?.streak ?? _done!.streakBefore,
        celebrate: !_reviewedAtOpen,
        onHub: _leave,
        onNext: _done!.nextLabel == null ? null : _next,
      ),
    };

    return PopScope(
      canPop: canPop,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) {
          unawaited(_onBack());
        }
      },
      child: LibraryCleanupSessionScaffold(
        title: _shortDate,
        position: state.isReady && total > 0 ? (index: math.min(state.decided + 1, total), total: total) : null,
        pendingCount: state.pendingCount,
        progress: _progress(context, state),
        status: state.status,
        onRetry: () => unawaited(_session.retry()),
        onBack: () => unawaited(_onBack()),
        onDone: () {
          if (_phase == _Phase.deck) {
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
        ),
        skeleton: grid
            ? const LibraryCleanupGridSkeleton()
            : LibraryCleanupDeckSkeleton(
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
        overlay: _overlay && phase == _Phase.deck && !grid
            ? LibraryCleanupGestureOverlay(onDismiss: () => setState(() => _overlay = false))
            : null,
        body: AnimatedSwitcher(
          duration: GalleryMotion.reduced(context) ? GalleryMotion.quick : GalleryMotion.base,
          child: KeyedSubtree(key: ValueKey(phase), child: body),
        ),
      ),
    );
  }
}
