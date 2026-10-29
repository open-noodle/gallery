import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/physics.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/cleanup/cleanup_prefs.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_marks.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_deck_card.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_details_sheet.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_session_scaffold.dart';
import 'package:immich_mobile/gallery/motion/celebrate.dart';
import 'package:immich_mobile/gallery/motion/motion_tokens.dart';
import 'package:immich_mobile/gallery/motion/pressable.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/providers/haptic_feedback.provider.dart';
import 'package:openapi/api.dart';

export 'package:immich_mobile/gallery/cleanup/widgets/cleanup_deck_card.dart' show LibraryCleanupCardInfo;

// The deck (specs/2026-10-29-mobile-library-cleanup-design.md, "The deck"): one widget for every cleanup that decides
// one photo at a time. Swipe mode stacks the cards and throws them; button mode shows the photo edge to edge, pages
// with horizontal swipes, and marks from a floating bar. Both only report marks: the session holds them.

/// What a swipe or a button decides, and where the card goes.
extension on LibraryCleanupMark {
  Offset get direction => switch (this) {
    LibraryCleanupMark.keep => const Offset(1, 0),
    LibraryCleanupMark.trash => const Offset(-1, 0),
    LibraryCleanupMark.favorite => const Offset(0, -1),
  };
}

/// The share of the card's width (or height, upwards) a drag must pass to decide.
const _horizontalThreshold = 0.28;
const _upThreshold = 0.16;

/// A release this fast (logical pixels per second) in a direction throws the card even before the threshold.
const _throwVelocity = 800.0;

/// The deck, in the mode the user chose.
class LibraryCleanupDeck extends StatelessWidget {
  const LibraryCleanupDeck({
    super.key,
    required this.assets,
    required this.marks,
    required this.mode,
    required this.canUndo,
    required this.onMark,
    required this.onUndo,
    required this.onOpen,
    required this.info,
    this.onDetails,
    this.openDetails,
    this.heroTag,
    this.onCurrentChanged,
  });

  /// Every photo of the session, in deck order, marked or not.
  final List<CleanupAssetDto> assets;
  final Map<String, LibraryCleanupMark> marks;
  final LibraryCleanupDeckMode mode;
  final bool canUndo;
  final void Function(String id, LibraryCleanupMark mark) onMark;
  final VoidCallback onUndo;

  /// "Open in library".
  final ValueChanged<CleanupAssetDto> onOpen;

  /// The card's signal: the rewind's year line, a queue's date.
  final LibraryCleanupCardInfo Function(BuildContext context, CleanupAssetDto asset) info;

  /// Called when the details are asked for (ⓘ, a tap on the photo, an upward drag on the info strip), when
  /// [openDetails] is not given. Without either the chip shows but does nothing and a tap on the photo is ignored.
  final ValueChanged<CleanupAssetDto>? onDetails;

  /// Opens the details sheet (cleanup_details_sheet.dart). A mark chosen on the sheet is applied to the card exactly as
  /// the deck's own button would: thrown in swipe mode, flashed and stepped past in button mode.
  final LibraryCleanupDetailsOpener? openDetails;

  bool get hasDetails => onDetails != null || openDetails != null;

  /// Button mode: the photo shown changed by a sideways swipe. Swipe mode is always on its first undecided photo.
  final ValueChanged<CleanupAssetDto>? onCurrentChanged;

  /// The hero the session was opened with, on the top card in swipe mode.
  final String? heroTag;

  @override
  Widget build(BuildContext context) {
    final reduced = GalleryMotion.reduced(context);
    return AnimatedSwitcher(
      duration: reduced ? GalleryMotion.quick : GalleryMotion.base,
      child: mode == LibraryCleanupDeckMode.swipe
          ? _SwipeDeck(key: const ValueKey('swipe'), deck: this)
          : _ButtonDeck(key: const ValueKey('button'), deck: this),
    );
  }
}

/// Asks for [asset]'s details. Resolves with the mark chosen on the sheet, if any; [hero] is the card's hero tag.
Future<LibraryCleanupMark?> _askDetails(LibraryCleanupDeck deck, CleanupAssetDto asset, String? hero) async {
  final open = deck.openDetails;
  if (open == null) {
    deck.onDetails?.call(asset);
    return null;
  }
  return open(asset, hero);
}

/// The hero a card carries: the session's on the top card, else the details sheet's.
String? _heroFor(LibraryCleanupDeck deck, CleanupAssetDto asset, {bool top = true}) =>
    (top ? deck.heroTag : null) ?? (deck.openDetails == null ? null : libraryCleanupDetailsHeroTag(asset.id));

List<CleanupAssetDto> _undecided(LibraryCleanupDeck deck) => [
  for (final asset in deck.assets)
    if (!deck.marks.containsKey(asset.id)) asset,
];

/// Asks for the previews of [assets] before they are on top, so a card is ready when the one above it leaves.
void _preload(BuildContext context, Iterable<CleanupAssetDto> assets, Set<String> done) {
  for (final asset in assets) {
    if (done.add(asset.id)) {
      unawaited(precacheImage(libraryCleanupPreview(asset), context, onError: (_, _) {}));
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Swipe mode
// ---------------------------------------------------------------------------------------------------------------------

class _Flight {
  _Flight({required this.asset, required this.mark, required this.from, required this.to, required this.controller});

  final CleanupAssetDto asset;
  final LibraryCleanupMark mark;
  final Offset from;
  final Offset to;
  final AnimationController controller;
}

class _SwipeDeck extends ConsumerStatefulWidget {
  const _SwipeDeck({super.key, required this.deck});

  final LibraryCleanupDeck deck;

  @override
  ConsumerState<_SwipeDeck> createState() => _SwipeDeckState();
}

class _SwipeDeckState extends ConsumerState<_SwipeDeck> with TickerProviderStateMixin {
  late final AnimationController _x = AnimationController.unbounded(vsync: this);
  late final AnimationController _y = AnimationController.unbounded(vsync: this);

  /// A card coming back after Undo fades in under reduced motion.
  late final AnimationController _fadeIn = AnimationController(vsync: this, duration: GalleryMotion.quick, value: 1);
  final List<_Flight> _flights = [];
  final Set<String> _preloaded = {};
  Size _size = Size.zero;

  /// The mark the drag is past the threshold of, for the one haptic per crossing.
  LibraryCleanupMark? _armed;

  LibraryCleanupDeck get deck => widget.deck;

  CleanupAssetDto? get _top => _undecided(deck).firstOrNull;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _preloadNext();
  }

  @override
  void didUpdateWidget(_SwipeDeck oldWidget) {
    super.didUpdateWidget(oldWidget);
    final before = _undecided(oldWidget.deck).firstOrNull;
    final now = _top;
    if (now != null && now.id != before?.id) {
      final was = oldWidget.deck.marks[now.id];
      if (was != null && !deck.marks.containsKey(now.id)) {
        _comeBack(now, was);
      } else {
        _x.value = 0;
        _y.value = 0;
      }
    }
    _preloadNext();
  }

  void _preloadNext() => _preload(context, _undecided(deck).skip(1).take(3), _preloaded);

  @override
  void dispose() {
    for (final flight in _flights) {
      flight.controller.dispose();
    }
    _x.dispose();
    _y.dispose();
    _fadeIn.dispose();
    super.dispose();
  }

  Offset get _offset => Offset(_x.value, _y.value);

  /// Where a card goes when thrown in [mark]'s direction: off the screen, keeping some of the drag's other axis.
  Offset _offscreen(LibraryCleanupMark mark, Offset from) {
    final direction = mark.direction;
    final reach = _size.longestSide * 1.3;
    return direction.dx != 0 ? Offset(direction.dx * reach, from.dy + from.dy.sign * 40) : Offset(from.dx, -reach);
  }

  LibraryCleanupMark? _markAt(Offset offset) {
    if (_size.isEmpty) {
      return null;
    }
    if (offset.dy < -_size.height * _upThreshold && -offset.dy > offset.dx.abs()) {
      return LibraryCleanupMark.favorite;
    }
    if (offset.dx.abs() > _size.width * _horizontalThreshold && offset.dx.abs() >= -offset.dy) {
      return offset.dx > 0 ? LibraryCleanupMark.keep : LibraryCleanupMark.trash;
    }
    return null;
  }

  void _onPanStart(DragStartDetails details) {
    _x.stop();
    _y.stop();
  }

  void _onPanUpdate(DragUpdateDetails details) {
    _x.value += details.delta.dx;
    _y.value += details.delta.dy;
    final armed = _markAt(_offset);
    if (armed != null && armed != _armed) {
      ref.read(hapticFeedbackProvider.notifier).selectionClick();
    }
    _armed = armed;
  }

  void _onPanEnd(DragEndDetails details) {
    final velocity = details.velocity.pixelsPerSecond;
    _armed = null;
    var mark = _markAt(_offset);
    if (mark == null) {
      if (velocity.dy < -_throwVelocity && -velocity.dy > velocity.dx.abs()) {
        mark = LibraryCleanupMark.favorite;
      } else if (velocity.dx.abs() > _throwVelocity && velocity.dx.abs() > velocity.dy.abs()) {
        mark = velocity.dx > 0 ? LibraryCleanupMark.keep : LibraryCleanupMark.trash;
      }
    }
    if (mark == null) {
      _springBack(velocity);
    } else {
      _throw(mark, speed: velocity.distance);
    }
  }

  /// A cancelled drag (or a drag down, which decides nothing) springs back on the bouncy spring.
  void _springBack(Offset velocity) {
    if (GalleryMotion.reduced(context)) {
      _x.value = 0;
      _y.value = 0;
      return;
    }
    unawaited(_x.animateWith(SpringSimulation(GalleryMotion.bouncy, _x.value, 0, velocity.dx)));
    unawaited(_y.animateWith(SpringSimulation(GalleryMotion.bouncy, _y.value, 0, velocity.dy)));
  }

  /// Throws the top card off in [mark]'s direction (a swipe, or a button doing exactly what the swipe does) and reports
  /// the mark at once, so the next card is usable while this one is still flying.
  void _throw(LibraryCleanupMark mark, {double speed = 0}) {
    final top = _top;
    if (top == null) {
      return;
    }
    final reduced = GalleryMotion.reduced(context);
    final from = _offset;
    final to = reduced ? from : _offscreen(mark, from);
    // The release velocity carries into the flight: a hard fling leaves faster.
    final distance = (to - from).distance;
    final millis = reduced
        ? GalleryMotion.quick.inMilliseconds
        : (distance / math.max(speed, 1800) * 1000).clamp(180, 340);
    final controller = AnimationController(
      vsync: this,
      duration: Duration(milliseconds: millis.round()),
    );
    final flight = _Flight(asset: top, mark: mark, from: from, to: to, controller: controller);
    setState(() => _flights.add(flight));
    unawaited(
      controller.forward().whenComplete(() {
        if (mounted) {
          setState(() => _flights.remove(flight));
        }
        controller.dispose();
      }),
    );
    _x.value = 0;
    _y.value = 0;
    if (mark == LibraryCleanupMark.favorite) {
      GalleryCelebrate.favorite();
    }
    deck.onMark(top.id, mark);
  }

  Future<void> _details(CleanupAssetDto asset) async {
    final deck = this.deck;
    final mark = await _askDetails(deck, asset, _heroFor(deck, asset));
    if (mark == null) {
      return;
    }
    if (mounted && _top?.id == asset.id) {
      _throw(mark);
    } else {
      deck.onMark(asset.id, mark);
    }
  }

  /// Undo: the card flies back in from where it left, on the same path.
  void _comeBack(CleanupAssetDto asset, LibraryCleanupMark mark) {
    for (final flight in _flights.where((flight) => flight.asset.id == asset.id).toList()) {
      flight.controller.stop();
      _flights.remove(flight);
    }
    if (GalleryMotion.reduced(context)) {
      _x.value = 0;
      _y.value = 0;
      _fadeIn.value = 0;
      unawaited(_fadeIn.forward());
      return;
    }
    final start = _offscreen(mark, Offset.zero);
    _x.value = start.dx;
    _y.value = start.dy;
    unawaited(_x.animateWith(SpringSimulation(GalleryMotion.gentle, start.dx, 0, 0)));
    unawaited(_y.animateWith(SpringSimulation(GalleryMotion.gentle, start.dy, 0, 0)));
  }

  @override
  Widget build(BuildContext context) {
    final undecided = _undecided(deck);
    final top = undecided.firstOrNull;
    final next = undecided.elementAtOrNull(1);
    final reduced = GalleryMotion.reduced(context);
    return Padding(
      padding: libraryCleanupDeckPadding,
      child: Column(
        children: [
          Expanded(
            child: LayoutBuilder(
              builder: (context, constraints) {
                _size = constraints.biggest;
                return Stack(
                  clipBehavior: Clip.none,
                  children: [
                    if (next != null)
                      Positioned.fill(
                        key: ValueKey('behind-${next.id}'),
                        child: _Behind(
                          child: LibraryCleanupDeckCard(asset: next, info: deck.info(context, next)),
                        ),
                      ),
                    if (top != null)
                      Positioned.fill(
                        key: ValueKey('top-${top.id}'),
                        child: _Grow(
                          key: ValueKey('grow-${top.id}'),
                          enabled: !reduced,
                          child: FadeTransition(
                            opacity: _fadeIn,
                            child: GestureDetector(
                              key: const Key('cleanup-deck-top'),
                              behavior: HitTestBehavior.opaque,
                              // With a tap (the details) in the arena too, the pan wins only past its slop: counted
                              // from the touch, the card still follows the finger 1:1.
                              dragStartBehavior: DragStartBehavior.down,
                              onPanStart: _onPanStart,
                              onPanUpdate: _onPanUpdate,
                              onPanEnd: _onPanEnd,
                              onTap: deck.hasDetails ? () => unawaited(_details(top)) : null,
                              child: AnimatedBuilder(
                                animation: Listenable.merge([_x, _y]),
                                builder: (context, child) => _Moved(
                                  offset: _offset,
                                  width: _size.width,
                                  rotate: !reduced,
                                  child: LibraryCleanupDeckCard(
                                    key: Key('cleanup-card-${top.id}'),
                                    asset: top,
                                    info: deck.info(context, top),
                                    heroTag: _heroFor(deck, top),
                                    stamps: _stampsAt(_offset),
                                    onDetails: deck.hasDetails ? () => unawaited(_details(top)) : null,
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                    for (final flight in _flights)
                      Positioned.fill(
                        key: ValueKey('flight-${flight.asset.id}-${identityHashCode(flight)}'),
                        child: IgnorePointer(
                          child: AnimatedBuilder(
                            animation: flight.controller,
                            builder: (context, child) {
                              final t = GalleryMotion.settle.transform(flight.controller.value);
                              final moved = _Moved(
                                offset: Offset.lerp(flight.from, flight.to, t)!,
                                width: _size.width,
                                rotate: !reduced,
                                child: child!,
                              );
                              return reduced || flight.controller.value > 0.7
                                  ? Opacity(
                                      opacity: reduced
                                          ? 1 - flight.controller.value
                                          : (1 - flight.controller.value) / 0.3,
                                      child: moved,
                                    )
                                  : moved;
                            },
                            child: LibraryCleanupDeckCard(
                              key: Key('cleanup-flight-${flight.asset.id}'),
                              asset: flight.asset,
                              info: deck.info(context, flight.asset),
                              stamps: {flight.mark: 1},
                            ),
                          ),
                        ),
                      ),
                  ],
                );
              },
            ),
          ),
          const SizedBox(height: libraryCleanupButtonRowGap),
          LibraryCleanupDeckButtons(
            canUndo: deck.canUndo,
            enabled: top != null,
            onUndo: deck.onUndo,
            onMark: _throw,
            onOpen: top == null ? null : () => deck.onOpen(top),
          ),
        ],
      ),
    );
  }

  /// How far the drag is towards each mark, 0 to 1 (1 at the threshold).
  Map<LibraryCleanupMark, double> _stampsAt(Offset offset) {
    if (_size.isEmpty || offset == Offset.zero) {
      return const {};
    }
    final up = -offset.dy > offset.dx.abs() ? (-offset.dy / (_size.height * _upThreshold)).clamp(0.0, 1.0) : 0.0;
    final side = offset.dx.abs() >= -offset.dy
        ? (offset.dx.abs() / (_size.width * _horizontalThreshold)).clamp(0.0, 1.0)
        : 0.0;
    return {
      LibraryCleanupMark.favorite: up,
      if (offset.dx > 0) LibraryCleanupMark.keep: side else LibraryCleanupMark.trash: side,
    };
  }
}

/// The card behind the top one: slightly smaller, lower and dimmed.
class _Behind extends StatelessWidget {
  const _Behind({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) => IgnorePointer(
    child: Transform.translate(
      offset: const Offset(0, 12),
      child: Transform.scale(
        scale: 0.94,
        child: Stack(
          fit: StackFit.expand,
          children: [
            child,
            DecoratedBox(
              decoration: BoxDecoration(
                color: Colors.black.withValues(alpha: 0.35),
                borderRadius: BorderRadius.circular(libraryCleanupCardRadius),
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

/// The new top card grows from the size it had behind to full size.
class _Grow extends StatelessWidget {
  const _Grow({super.key, required this.enabled, required this.child});

  final bool enabled;
  final Widget child;

  @override
  Widget build(BuildContext context) => !enabled
      ? child
      : TweenAnimationBuilder<double>(
          tween: Tween(begin: 0, end: 1),
          duration: GalleryMotion.base,
          curve: GalleryMotion.settle,
          builder: (context, t, child) => Transform.translate(
            offset: Offset(0, 12 * (1 - t)),
            child: Transform.scale(scale: 0.94 + 0.06 * t, child: child),
          ),
          child: child,
        );
}

/// A card moved by [offset], rotating slightly with its horizontal travel.
class _Moved extends StatelessWidget {
  const _Moved({required this.offset, required this.width, required this.rotate, required this.child});

  final Offset offset;
  final double width;
  final bool rotate;
  final Widget child;

  @override
  Widget build(BuildContext context) => Transform.translate(
    offset: offset,
    child: rotate && width > 0
        ? Transform.rotate(angle: (offset.dx / width).clamp(-1.5, 1.5) * 0.18, child: child)
        : child,
  );
}

/// The buttons under the card: Undo, Trash, Favourite, Keep, Open in library. A press squishes the button and throws
/// the card exactly as the swipe would.
class LibraryCleanupDeckButtons extends StatelessWidget {
  const LibraryCleanupDeckButtons({
    super.key,
    required this.canUndo,
    required this.enabled,
    required this.onUndo,
    required this.onMark,
    required this.onOpen,
  });

  final bool canUndo;
  final bool enabled;
  final VoidCallback onUndo;
  final ValueChanged<LibraryCleanupMark> onMark;
  final VoidCallback? onOpen;

  @override
  Widget build(BuildContext context) {
    final t = context.t;
    return SizedBox(
      height: libraryCleanupButtonRowHeight,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
        children: [
          _RoundButton(
            key: const Key('cleanup-deck-undo'),
            icon: Icons.undo_rounded,
            label: t.undo,
            small: true,
            onPressed: canUndo ? onUndo : null,
          ),
          _RoundButton(
            key: const Key('cleanup-deck-trash'),
            icon: Icons.close_rounded,
            label: t.trash,
            color: libraryCleanupTrashColor,
            onPressed: enabled ? () => onMark(LibraryCleanupMark.trash) : null,
          ),
          _RoundButton(
            key: const Key('cleanup-deck-favorite'),
            icon: Icons.favorite_rounded,
            label: t.favorite,
            color: libraryCleanupFavoriteColor,
            onPressed: enabled ? () => onMark(LibraryCleanupMark.favorite) : null,
          ),
          _RoundButton(
            key: const Key('cleanup-deck-keep'),
            icon: Icons.check_rounded,
            label: t.keep,
            color: libraryCleanupKeepColor,
            onPressed: enabled ? () => onMark(LibraryCleanupMark.keep) : null,
          ),
          _RoundButton(
            key: const Key('cleanup-deck-open'),
            icon: Icons.open_in_full_rounded,
            label: t.cleanup_open_in_library,
            small: true,
            onPressed: onOpen,
          ),
        ],
      ),
    );
  }
}

class _RoundButton extends StatelessWidget {
  const _RoundButton({
    super.key,
    required this.icon,
    required this.label,
    required this.onPressed,
    this.color,
    this.small = false,
  });

  final IconData icon;
  final String label;
  final VoidCallback? onPressed;
  final Color? color;
  final bool small;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final size = small ? 44.0 : 58.0;
    final foreground = onPressed == null ? scheme.onSurface.withValues(alpha: 0.3) : (color ?? scheme.onSurface);
    return GalleryPressable(
      enabled: onPressed != null,
      pressedScale: 0.86,
      child: Semantics(
        button: true,
        label: label,
        child: Tooltip(
          message: label,
          child: Material(
            color: scheme.surfaceContainerHigh,
            shape: CircleBorder(side: BorderSide(color: scheme.outlineVariant)),
            clipBehavior: Clip.antiAlias,
            child: InkWell(
              onTap: onPressed,
              child: SizedBox.square(
                dimension: size,
                child: Icon(icon, color: foreground, size: small ? 20 : 28),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Button mode
// ---------------------------------------------------------------------------------------------------------------------

class _ButtonDeck extends StatefulWidget {
  const _ButtonDeck({super.key, required this.deck});

  final LibraryCleanupDeck deck;

  @override
  State<_ButtonDeck> createState() => _ButtonDeckState();
}

class _ButtonDeckState extends State<_ButtonDeck> {
  late final PageController _pages = PageController(initialPage: _firstUndecided(widget.deck, 0));
  late int _index = _firstUndecided(widget.deck, 0);
  final Set<String> _preloaded = {};

  /// The mark just made, flashed as a stamp on the photo.
  ({String id, LibraryCleanupMark mark})? _flash;

  LibraryCleanupDeck get deck => widget.deck;

  /// The first photo without a mark at or after [from], else the first one anywhere, else [from].
  static int _firstUndecided(LibraryCleanupDeck deck, int from, {Set<String> also = const {}}) {
    bool open(int i) => !deck.marks.containsKey(deck.assets[i].id) && !also.contains(deck.assets[i].id);
    for (var i = from; i < deck.assets.length; i++) {
      if (open(i)) {
        return i;
      }
    }
    for (var i = 0; i < from && i < deck.assets.length; i++) {
      if (open(i)) {
        return i;
      }
    }
    return from.clamp(0, math.max(deck.assets.length - 1, 0));
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _preloadNext();
  }

  @override
  void didUpdateWidget(_ButtonDeck oldWidget) {
    super.didUpdateWidget(oldWidget);
    // Undo took a mark away: show that photo again.
    final undone = oldWidget.deck.marks.keys.where((id) => !deck.marks.containsKey(id)).toList();
    if (undone.length == 1) {
      final index = deck.assets.indexWhere((asset) => asset.id == undone.single);
      if (index >= 0 && index != _index) {
        _goTo(index);
      }
    }
    _preloadNext();
  }

  void _preloadNext() => _preload(context, deck.assets.skip(_index + 1).take(3), _preloaded);

  void _goTo(int index) {
    if (!_pages.hasClients) {
      return;
    }
    if (GalleryMotion.reduced(context)) {
      _pages.jumpToPage(index);
    } else {
      unawaited(_pages.animateToPage(index, duration: GalleryMotion.base, curve: GalleryMotion.standard));
    }
  }

  Future<void> _details(CleanupAssetDto asset) async {
    final deck = this.deck;
    final mark = await _askDetails(deck, asset, _heroFor(deck, asset, top: false));
    if (mark == null) {
      return;
    }
    if (mounted && deck.assets.elementAtOrNull(_index)?.id == asset.id) {
      _mark(mark);
    } else {
      deck.onMark(asset.id, mark);
    }
  }

  void _mark(LibraryCleanupMark mark) {
    final asset = deck.assets.elementAtOrNull(_index);
    if (asset == null) {
      return;
    }
    setState(() => _flash = (id: asset.id, mark: mark));
    if (mark == LibraryCleanupMark.favorite) {
      GalleryCelebrate.favorite();
    }
    deck.onMark(asset.id, mark);
    final next = _firstUndecided(deck, _index + 1, also: {asset.id});
    if (next != _index) {
      _goTo(next);
    }
  }

  @override
  void dispose() {
    _pages.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final current = deck.assets.elementAtOrNull(_index);
    return Stack(
      children: [
        PageView.builder(
          key: const Key('cleanup-deck-pages'),
          controller: _pages,
          itemCount: deck.assets.length,
          onPageChanged: (index) {
            setState(() {
              _index = index;
              _flash = null;
              _preloadNext();
            });
            deck.onCurrentChanged?.call(deck.assets[index]);
          },
          itemBuilder: (context, index) {
            final asset = deck.assets[index];
            final flash = _flash?.id == asset.id ? _flash!.mark : null;
            final details = deck.hasDetails ? () => unawaited(_details(asset)) : null;
            return GestureDetector(
              key: Key('cleanup-page-${asset.id}'),
              behavior: HitTestBehavior.opaque,
              onTap: details,
              child: LibraryCleanupDeckCard(
                asset: asset,
                info: deck.info(context, asset),
                edgeToEdge: true,
                heroTag: _heroFor(deck, asset, top: false),
                mark: deck.marks[asset.id],
                stamps: flash == null ? const {} : {flash: 1},
                infoBottomInset: 104,
                onDetails: details,
              ),
            );
          },
        ),
        Positioned(
          left: 12,
          right: 12,
          bottom: 16,
          child: _ButtonBar(
            enabled: current != null,
            canUndo: deck.canUndo,
            onMark: _mark,
            onUndo: deck.onUndo,
            onOpen: current == null ? null : () => deck.onOpen(current),
          ),
        ),
      ],
    );
  }
}

/// Button mode's floating bar of large labelled buttons.
class _ButtonBar extends StatelessWidget {
  const _ButtonBar({
    required this.enabled,
    required this.canUndo,
    required this.onMark,
    required this.onUndo,
    required this.onOpen,
  });

  final bool enabled;
  final bool canUndo;
  final ValueChanged<LibraryCleanupMark> onMark;
  final VoidCallback onUndo;
  final VoidCallback? onOpen;

  @override
  Widget build(BuildContext context) {
    final t = context.t;
    final scheme = Theme.of(context).colorScheme;
    return ClipRRect(
      borderRadius: BorderRadius.circular(22),
      child: Material(
        key: const Key('cleanup-button-bar'),
        color: scheme.surfaceContainerHigh.withValues(alpha: 0.88),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 4),
          child: Row(
            children: [
              _BarButton(
                key: const Key('cleanup-bar-trash'),
                icon: Icons.delete_outline_rounded,
                label: t.trash,
                color: libraryCleanupTrashColor,
                onPressed: enabled ? () => onMark(LibraryCleanupMark.trash) : null,
              ),
              _BarButton(
                key: const Key('cleanup-bar-favorite'),
                icon: Icons.favorite_rounded,
                label: t.favorite,
                color: libraryCleanupFavoriteColor,
                onPressed: enabled ? () => onMark(LibraryCleanupMark.favorite) : null,
              ),
              _BarButton(
                key: const Key('cleanup-bar-keep'),
                icon: Icons.check_rounded,
                label: t.keep,
                color: libraryCleanupKeepColor,
                onPressed: enabled ? () => onMark(LibraryCleanupMark.keep) : null,
              ),
              _BarButton(
                key: const Key('cleanup-bar-undo'),
                icon: Icons.undo_rounded,
                label: t.undo,
                onPressed: canUndo ? onUndo : null,
              ),
              _BarButton(
                key: const Key('cleanup-bar-open'),
                icon: Icons.open_in_full_rounded,
                label: t.cleanup_open_in_library,
                onPressed: onOpen,
                compact: true,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _BarButton extends StatelessWidget {
  const _BarButton({
    super.key,
    required this.icon,
    required this.label,
    required this.onPressed,
    this.color,
    this.compact = false,
  });

  final IconData icon;
  final String label;
  final VoidCallback? onPressed;
  final Color? color;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final foreground = onPressed == null ? scheme.onSurface.withValues(alpha: 0.3) : (color ?? scheme.onSurface);
    final button = GalleryPressable(
      enabled: onPressed != null,
      pressedScale: 0.9,
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onPressed,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, color: foreground, size: 26),
              if (!compact) ...[
                const SizedBox(height: 3),
                Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 12, color: foreground),
                ),
              ],
            ],
          ),
        ),
      ),
    );
    return compact
        ? Tooltip(
            message: label,
            child: SizedBox(width: 48, child: button),
          )
        : Expanded(child: button);
  }
}
