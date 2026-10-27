import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/motion/motion_tokens.dart';
import 'package:immich_mobile/gallery/motion/wave_mask.dart';
import 'package:immich_mobile/gallery/search/search.providers.dart';
import 'package:immich_mobile/gallery/search/search_mode.provider.dart';
import 'package:immich_mobile/gallery/search/search_timeline.dart' show searchResultsPendingProvider;
import 'package:immich_mobile/gallery/search/widgets/search_header.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_grouping_bottom_pill.widget.dart';

/// What search mode adds around the Photos screen (TimelineRouteScope wraps the page in it):
/// - room at the top for the search header, so the timeline's scrubber starts below it;
/// - the Years | Months | All pill while searching, in the place of the hidden bottom nav, so zoom works on results.
///   Outside search the Photos page keeps its app-bar chip and shows no pill. The pill sits beside the page rather than
///   inside the Timeline, so the timeline (and its scroll position) is untouched by entering and leaving;
/// - the warm-up of the server's unfiltered search cache when the Photos tab first shows (Slice 2's warm-up: once per
///   session, silent on failure).
class PhotosSearchFrame extends ConsumerStatefulWidget {
  final Widget child;

  const PhotosSearchFrame({super.key, required this.child});

  @override
  ConsumerState<PhotosSearchFrame> createState() => _PhotosSearchFrameState();
}

class _PhotosSearchFrameState extends ConsumerState<PhotosSearchFrame> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        ref.read(searchWarmUpProvider);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final searching = ref.watch(searchModeProvider);
    final media = MediaQuery.of(context);
    return Stack(
      children: [
        // The timeline reserves its bottom padding from the media padding: in search mode it makes room for the pill,
        // as detail timelines do. Its scrubber starts below `padding.top + kToolbarHeight`, room for an app bar: the
        // search header is taller, so the top grows by the difference, which the header takes back off. Always the
        // same wrappers, so the page underneath is never rebuilt from scratch.
        SearchHeaderInset(
          extra: searching ? SearchHeader.extraTopPadding : 0,
          child: MediaQuery(
            data: searching
                ? media.copyWith(
                    padding: media.padding.copyWith(
                      top: media.padding.top + SearchHeader.extraTopPadding,
                      bottom:
                          media.padding.bottom +
                          TimelineGroupingBottomPill.pillHeight +
                          TimelineGroupingBottomPill.bottomFloat,
                    ),
                  )
                : media,
            child: widget.child,
          ),
        ),
        StaleResultsScrim(top: media.padding.top),
        if (searching) const TimelineGroupingBottomPill(),
      ],
    );
  }
}

/// What search mode adds around any other timeline screen (album, space, person, ...): room at the top for the search
/// header, as on Photos. These screens already show the grouping pill, whose search button enters search mode.
class SearchScreenFrame extends ConsumerWidget {
  final Widget child;

  const SearchScreenFrame({super.key, required this.child});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final searching = ref.watch(searchModeProvider);
    final media = MediaQuery.of(context);
    return Stack(
      children: [
        SearchHeaderInset(
          extra: searching ? SearchHeader.extraTopPadding : 0,
          child: MediaQuery(
            data: searching
                ? media.copyWith(padding: media.padding.copyWith(top: media.padding.top + SearchHeader.extraTopPadding))
                : media,
            child: child,
          ),
        ),
        StaleResultsScrim(top: media.padding.top),
      ],
    );
  }
}

/// Dims the grid below the search header while a search is on its way (searchResultsPendingProvider): the photos
/// underneath are the previous answer, or the screen's own timeline, not what the filters now ask for. A slow light
/// sweeps across the dim, like the timeline's loading skeleton. When the answer arrives, the dim wipes away in the
/// skeleton's diagonal wave from the top-left, so the new photos ripple in. Touches pass through throughout.
///
/// Reduced motion: no sweep, and the dim fades out instead of wiping.
class StaleResultsScrim extends ConsumerStatefulWidget {
  /// The status bar height: the header sits right below it.
  final double top;

  const StaleResultsScrim({super.key, required this.top});

  /// How long the dim takes to wipe away once the results are in.
  static const exitDuration = Duration(milliseconds: 520);

  @override
  ConsumerState<StaleResultsScrim> createState() => _StaleResultsScrimState();
}

class _StaleResultsScrimState extends ConsumerState<StaleResultsScrim> with TickerProviderStateMixin {
  static const _dim = 0.6;
  late final AnimationController _sheen = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1600),
  );
  late final AnimationController _wipe = AnimationController(vsync: this, duration: StaleResultsScrim.exitDuration);
  late final AnimationController _fadeIn = AnimationController(vsync: this, duration: GalleryMotion.quick);

  bool _pending = false;
  bool _wiping = false;
  bool _ready = false;

  @override
  void initState() {
    super.initState();
    ref.listenManual<bool>(searchResultsPendingProvider, (_, next) => _onPending(next), fireImmediately: true);
    _ready = true;
  }

  void _onPending(bool pending) {
    if (pending == _pending) {
      return;
    }
    if (pending) {
      _wipe.stop();
      _wiping = false;
      _fadeIn.forward();
      _sheen.repeat();
    } else {
      _sheen.stop();
      if (ref.read(searchModeProvider) && _fadeIn.value > 0) {
        // The answer is in: wipe the dim away.
        _wiping = true;
        _wipe.forward(from: 0).whenCompleteOrCancel(() {
          if (mounted && !_pending) {
            setState(() {
              _wiping = false;
              _fadeIn.value = 0;
            });
          }
        });
      } else {
        // Search mode closed: nothing to reveal.
        _fadeIn.value = 0;
      }
    }
    _pending = pending;
    // The listener also fires from initState, before the first build: that build picks the state up.
    if (!_ready) {
      return;
    }
    if (SchedulerBinding.instance.schedulerPhase == SchedulerPhase.persistentCallbacks) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          setState(() {});
        }
      });
    } else {
      setState(() {});
    }
  }

  @override
  void dispose() {
    _sheen.dispose();
    _wipe.dispose();
    _fadeIn.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final reduced = GalleryMotion.reduced(context);
    final pending = _pending;
    final wiping = !pending && _wiping;
    if (!pending && !wiping) {
      return const SizedBox.shrink();
    }
    const headerHeight = SearchHeader.fieldRowHeight + SearchHeader.chipRowHeight + SearchHeader.resultsRowHeight;
    final scheme = Theme.of(context).colorScheme;
    final light = Theme.of(context).brightness == Brightness.light;
    return Positioned.fill(
      top: widget.top + headerHeight,
      child: IgnorePointer(
        // Only the waiting scrim carries the key: the wipe after the answer is just the exit.
        key: pending ? const Key('search-mode-stale-scrim') : null,
        child: AnimatedBuilder(
          animation: Listenable.merge([_sheen, _wipe, _fadeIn]),
          builder: (context, _) {
            final dim = ColoredBox(color: scheme.surface.withValues(alpha: _dim * _fadeIn.value));
            final body = reduced
                ? dim
                : CustomPaint(
                    foregroundPainter: _SheenPainter(
                      progress: _sheen.value,
                      color: Colors.white.withValues(alpha: (light ? 0.35 : 0.06) * _fadeIn.value),
                    ),
                    child: dim,
                  );
            if (!wiping) {
              return body;
            }
            return ShaderMask(
              blendMode: BlendMode.dstIn,
              shaderCallback: (rect) => galleryWaveShader(rect, _wipe.value, reveal: false, fadeOnly: reduced),
              child: body,
            );
          },
        ),
      ),
    );
  }
}

/// A soft diagonal band of light crossing the box once per run of [progress].
class _SheenPainter extends CustomPainter {
  final double progress;
  final Color color;

  const _SheenPainter({required this.progress, required this.color});

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    final center = -0.3 + progress * 1.6;
    final transparent = color.withValues(alpha: 0);
    final paint = Paint()
      ..shader = LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [transparent, color, transparent],
        stops: [(center - 0.15).clamp(0.0, 1.0), center.clamp(0.0, 1.0), (center + 0.15).clamp(0.0, 1.0)],
      ).createShader(rect);
    canvas.drawRect(rect, paint);
  }

  @override
  bool shouldRepaint(_SheenPainter oldDelegate) => oldDelegate.progress != progress || oldDelegate.color != color;
}

/// A screen's own sliver above its timeline (a space's header and albums) steps aside while search mode shows results,
/// as the Photos memory lane does: the results start right under the search header.
class HiddenWhileSearching extends ConsumerWidget {
  final Widget sliver;

  const HiddenWhileSearching({super.key, required this.sliver});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final filtering = ref.watch(searchModeProvider) && !ref.watch(searchStateProvider.select((s) => s.isEmpty));
    return filtering ? const SliverToBoxAdapter(child: SizedBox.shrink()) : sliver;
  }
}
