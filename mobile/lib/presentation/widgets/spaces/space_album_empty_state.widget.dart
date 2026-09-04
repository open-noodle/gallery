import 'package:flutter/material.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/widgets/common/polaroid_hero.widget.dart';

/// Shown in place of the grid when a space album resolves to zero assets.
///
/// Without this the album opens on a blank screen, which reads as a failed load
/// rather than an album waiting for photos. Deliberately mirrors the main Photos
/// timeline's first-run state — same [PolaroidHero], same staggered reveal — so
/// the two feel like one design rather than two.
///
/// [onAddPhotos] is null for a viewer: they get the same illustration and a
/// subtitle that does not invite an action they are not allowed to take.
class SpaceAlbumEmptyState extends StatefulWidget {
  const SpaceAlbumEmptyState({super.key, this.onAddPhotos});

  final VoidCallback? onAddPhotos;

  @override
  State<SpaceAlbumEmptyState> createState() => _SpaceAlbumEmptyStateState();
}

class _SpaceAlbumEmptyStateState extends State<SpaceAlbumEmptyState> with SingleTickerProviderStateMixin {
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
    if (reduceMotion) return child;
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
    final canAdd = widget.onAddPhotos != null;

    final content = <Widget>[
      const PolaroidHero(),
      const SizedBox(height: 28),
      Text(
        context.t.space_album_empty_title,
        textAlign: TextAlign.center,
        style: context.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w600),
      ),
      const SizedBox(height: 10),
      Text(
        (canAdd ? context.t.space_album_empty_subtitle : context.t.space_album_empty_subtitle_viewer),
        textAlign: TextAlign.center,
        style: context.textTheme.bodyMedium?.copyWith(color: context.colorScheme.onSurfaceVariant),
      ),
      if (canAdd) ...[
        const SizedBox(height: 28),
        FilledButton.icon(
          key: const Key('space-album-empty-add-photos'),
          onPressed: widget.onAddPhotos,
          icon: const Icon(Icons.add_photo_alternate_outlined),
          label: Text(context.t.space_album_add_photos),
        ),
      ],
    ];

    // Only the meaningful rows get a staggered reveal; spacers ride along.
    final revealCount = canAdd ? 4 : 3;
    var revealIndex = 0;
    final children = [
      for (final child in content)
        if (child is SizedBox) child else _reveal(revealIndex++, revealCount, reduceMotion, child),
    ];

    return Center(
      key: const Key('space-album-empty-state'),
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
