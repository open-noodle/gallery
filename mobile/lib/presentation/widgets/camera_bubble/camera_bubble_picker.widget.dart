import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/collection_target.dart';
import 'package:immich_mobile/domain/services/camera_bubble.service.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/widgets/album/album_selector.widget.dart';
import 'package:immich_mobile/presentation/widgets/collection/space_collection_section.widget.dart';
import 'package:sliver_tools/sliver_tools.dart';

/// The Camera Bubble's destination picker.
///
/// Composes the same [AlbumSelector] and [SpaceCollectionSection] as the in-app "Add to album or
/// space" sheet, unmodified. Only the intent differs: this records destinations for photos that
/// do not exist yet.
///
/// Multi-select without touching those widgets: both emit one target per tap and render no
/// selected state, so a tap toggles here and the selection shows as chips in the
/// `sliverAfterSearch` slot the fork already provides.
class CameraBubblePicker extends ConsumerStatefulWidget {
  const CameraBubblePicker({super.key, required this.initial, required this.onDone, this.scrollController});

  final List<CameraBubbleTarget> initial;
  final void Function(List<CameraBubbleTarget> targets) onDone;

  /// From the [DraggableScrollableSheet]. The sheet only resizes when the scrollable inside it
  /// uses this controller; otherwise the list scrolls and the sheet stays put.
  final ScrollController? scrollController;

  @override
  ConsumerState<CameraBubblePicker> createState() => _CameraBubblePickerState();
}

class _CameraBubblePickerState extends ConsumerState<CameraBubblePicker> {
  late final List<CameraBubbleTarget> _selected = [...widget.initial];
  String _searchQuery = '';

  /// Pulsed for one frame after each pick. [SpaceCollectionSection] latches shut on its first
  /// emit and only unlatches when `isBusy` goes true -> false, so a picker that stays open would
  /// otherwise accept exactly one tap ever.
  bool _isBusy = false;

  void _toggle(CameraBubbleTarget target) {
    setState(() {
      if (!_selected.remove(target)) {
        _selected.add(target);
      }
      _isBusy = true;
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        setState(() => _isBusy = false);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    // Everything inside the one scroll view the sheet controls. A header outside it would be
    // inert to drags — exactly where a person reaches to resize a sheet.
    return CustomScrollView(
      controller: widget.scrollController,
      slivers: [
        SliverPersistentHeader(
          pinned: true,
          delegate: _PickerHeader(onDone: () => widget.onDone(_selected), background: context.colorScheme.surface),
        ),
        MultiSliver(
          children: [
            AlbumSelector(
              onAlbumSelected: (album) => _toggle(CameraBubbleTarget.fromCollection(AlbumTarget(album))),
              onSearchChanged: (query) => setState(() => _searchQuery = query),
              searchHint: context.t.search_albums_and_spaces,
              writableOnly: true,
              sliverAfterSearch: SliverToBoxAdapter(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _SelectionChips(selected: _selected, onRemove: _toggle),
                    SpaceCollectionSection(
                      // Spaces and the albums nested inside them; a space album is a plain album.
                      onTargetSelected: (target) => _toggle(CameraBubbleTarget.fromCollection(target)),
                      searchQuery: _searchQuery,
                      isBusy: _isBusy,
                      // No assets exist yet; an empty list keeps this off the multiselect provider.
                      assets: const [],
                      footer: Padding(
                        padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
                        child: Text(context.t.albums, style: context.textTheme.labelLarge),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ],
    );
  }
}

/// Grab handle, title and Done — pinned, and part of the scrollable so it can drag the sheet.
class _PickerHeader extends SliverPersistentHeaderDelegate {
  _PickerHeader({required this.onDone, required this.background});

  final VoidCallback onDone;
  final Color background;

  static const _height = 74.0;

  @override
  double get minExtent => _height;

  @override
  double get maxExtent => _height;

  @override
  Widget build(BuildContext context, double shrinkOffset, bool overlapsContent) {
    return Container(
      // Opaque: a pinned header must hide what scrolls beneath it.
      color: background,
      height: _height,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            margin: const EdgeInsets.only(top: 10, bottom: 2),
            width: 32,
            height: 4,
            decoration: BoxDecoration(
              color: context.colorScheme.onSurfaceVariant.withValues(alpha: 0.4),
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 8, 0),
            child: Row(
              children: [
                Expanded(child: Text(context.t.add_to_album_or_space, style: context.textTheme.titleMedium)),
                TextButton(onPressed: onDone, child: Text(context.t.done)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  @override
  bool shouldRebuild(covariant _PickerHeader oldDelegate) =>
      oldDelegate.onDone != onDone || oldDelegate.background != background;
}

/// The running selection, and the only place selected state is rendered.
class _SelectionChips extends StatelessWidget {
  const _SelectionChips({required this.selected, required this.onRemove});

  final List<CameraBubbleTarget> selected;
  final void Function(CameraBubbleTarget) onRemove;

  @override
  Widget build(BuildContext context) {
    if (selected.isEmpty) {
      return Padding(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
        child: Text(
          context.t.camera_bubble_nothing_selected,
          style: context.textTheme.bodySmall?.copyWith(color: context.colorScheme.onSurfaceVariant),
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 4, 12, 8),
      child: Wrap(
        spacing: 6,
        runSpacing: 2,
        children: [
          for (final target in selected)
            InputChip(
              label: Text(target.name),
              avatar: Icon(
                target.kind == CameraBubbleTargetKind.space ? Icons.workspaces_outline : Icons.photo_album_outlined,
                size: 16,
              ),
              onDeleted: () => onRemove(target),
            ),
        ],
      ),
    );
  }
}
