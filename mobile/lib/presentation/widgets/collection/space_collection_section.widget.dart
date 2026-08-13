import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/constants/collection.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/collection_target.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/widgets/images/thumbnail.widget.dart';
import 'package:immich_mobile/providers/infrastructure/space_album.provider.dart';
import 'package:immich_mobile/providers/shared_space.provider.dart';
import 'package:immich_mobile/providers/timeline/multiselect.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_mobile/utils/selection_targets.dart';
import 'package:immich_mobile/utils/space_permissions.dart';
import 'package:immich_mobile/widgets/spaces/space_collage.dart';
import 'package:openapi/api.dart';

/// The "Spaces" half of the add-to-collection picker.
///
/// A plain box widget so it can be pumped directly in tests; the picker wraps it in a
/// `SliverToBoxAdapter`. Space rows come from the network `sharedSpacesProvider`; a row's
/// linked albums come from the local Drift `spaceAlbumsProvider`, watched ONLY while that
/// row is expanded, so collapsed spaces subscribe to nothing.
class SpaceCollectionSection extends ConsumerStatefulWidget {
  const SpaceCollectionSection({
    super.key,
    required this.onTargetSelected,
    this.excludeSpaceId,
    this.isBusy = false,
    this.searchQuery = '',
    this.assets,
    this.footer,
  });

  final void Function(CollectionTarget target) onTargetSelected;

  /// Set on a space's own surface so it is not offered as a destination for its own assets.
  final String? excludeSpaceId;

  /// The assets the picker is about to file, for the ownership / cap notices.
  ///
  /// Defaults to the timeline multiselect. The asset viewer has no multiselect, so it passes
  /// its one asset — falling back to the empty selection there would read as "nothing
  /// non-owned" and offer space targets for a photo that can never reach one.
  final Iterable<BaseAsset>? assets;

  /// Disables every row while an add is in flight.
  final bool isBusy;

  /// Narrows the rows to spaces whose name contains this query — supplied by the picker so
  /// its single search field covers both halves of the sheet.
  final String searchQuery;

  /// Rendered at the bottom of the section, and only when the section renders at all — so a caller
  /// can attach a label for whatever follows without duplicating the section's visibility rules
  /// (writable filter, excludeSpaceId, search query).
  final Widget? footer;

  @override
  ConsumerState<SpaceCollectionSection> createState() => _SpaceCollectionSectionState();
}

class _SpaceCollectionSectionState extends ConsumerState<SpaceCollectionSection> {
  /// Accordion: at most one expanded space, which bounds live Drift subscriptions to one.
  String? _expandedSpaceId;

  /// Guards a double-tap on a plain row from emitting two targets.
  bool _emitted = false;

  void _emit(CollectionTarget target) {
    if (_emitted || widget.isBusy) return;
    _emitted = true;
    widget.onTargetSelected(target);
  }

  @override
  void didUpdateWidget(covariant SpaceCollectionSection oldWidget) {
    super.didUpdateWidget(oldWidget);
    // The latch exists to swallow a double-tap while a dispatch is starting. Once the
    // parent reports it is no longer busy the dispatch has finished -- including when it
    // FAILED and left the sheet open -- so the section must accept taps again.
    if (oldWidget.isBusy && !widget.isBusy) {
      _emitted = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    final spacesAsync = ref.watch(sharedSpacesProvider);
    final userId = ref.watch(currentUserProvider.select((user) => user?.id));
    final multiSelection = ref.watch(multiSelectProvider.select((state) => state.selectedAssets));
    final selection = widget.assets ?? multiSelection;

    final spaces = spacesAsync.valueOrNull;
    // Offline or still loading: the album half of the picker still works, so stay out of
    // the way rather than surfacing an error into someone else's sheet.
    if (spaces == null) return const SizedBox.shrink();

    final query = widget.searchQuery.trim().toLowerCase();
    final writable =
        spaces
            .where(
              (space) =>
                  spaceIsWritable(space, userId) &&
                  space.id != widget.excludeSpaceId &&
                  (query.isEmpty || space.name.toLowerCase().contains(query)),
            )
            .toList()
          ..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
    if (writable.isEmpty) return const SizedBox.shrink();

    final String? notice;
    if (selectionHasNonOwned(selection, userId)) {
      notice = context.t.spaces_hidden_non_owned_selection;
    } else if (selectionHasLocked(selection)) {
      notice = context.t.spaces_hidden_non_owned_selection;
    } else if (selectionExceedsSpaceCap(selection)) {
      notice = context.t.spaces_hidden_too_many_assets(count: kMaxSpaceAssetsPerRequest);
    } else {
      notice = null;
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Padding(
          key: const Key('space-collection-header'),
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
          child: Text(context.t.spaces, style: context.textTheme.labelLarge),
        ),
        if (notice != null)
          Padding(
            key: const Key('space-collection-notice'),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Row(
              children: [
                const Icon(Icons.info_outline, size: 16),
                const SizedBox(width: 8),
                Expanded(child: Text(notice, style: context.textTheme.bodySmall)),
              ],
            ),
          )
        else
          for (final space in writable) ..._rowsFor(space),
        if (widget.footer != null) widget.footer!,
      ],
    );
  }

  List<Widget> _rowsFor(SharedSpaceResponseDto space) {
    // albumCount is Optional<num?> and is the ONLY way to know a row is expandable without
    // subscribing to its Drift stream. An absent count reads as 0 -- a plain row, which
    // still reaches the pool.
    final albumCount = (space.albumCount.orElse(null) ?? 0).toInt();
    final expandable = albumCount > 0;
    final expanded = _expandedSpaceId == space.id;

    return [
      ListTile(
        key: Key('space-row-${space.id}'),
        enabled: !widget.isBusy,
        leading: SpaceCollage(
          recentAssetIds: space.recentAssetIds.orElse(null) ?? const [],
          recentAssetThumbhashes: space.recentAssetThumbhashes.orElse(null) ?? const [],
          color: space.color.orElse(null),
          // Matches the `radius: 16` CircleAvatar this replaces, so row height is unchanged.
          size: 32,
        ),
        title: Text(space.name, maxLines: 1, overflow: TextOverflow.ellipsis),
        trailing: expandable ? Icon(expanded ? Icons.expand_less : Icons.expand_more) : null,
        onTap: widget.isBusy
            ? null
            : () {
                if (!expandable) {
                  _emit(SpacePoolTarget(space));
                  return;
                }
                setState(() => _expandedSpaceId = expanded ? null : space.id);
              },
      ),
      if (expanded) ..._childrenFor(space),
    ];
  }

  List<Widget> _childrenFor(SharedSpaceResponseDto space) {
    final albumsAsync = ref.watch(spaceAlbumsProvider(space.id));
    // `null` means the watch has not produced a value yet, which is NOT the same as "this space
    // has no albums" — conflating them flashed "no albums yet" on every expand. Web draws the
    // same distinction (`expandedSpaceAlbums === undefined`).
    final albums = albumsAsync.valueOrNull;

    return [
      ListTile(
        key: Key('space-pool-child-${space.id}'),
        contentPadding: const EdgeInsets.only(left: 48, right: 16),
        leading: const Icon(Icons.workspaces_outline),
        title: Text(context.t.add_to_space),
        enabled: !widget.isBusy,
        onTap: widget.isBusy ? null : () => _emit(SpacePoolTarget(space)),
      ),
      if (albums == null)
        const SizedBox.shrink() // still loading — say nothing rather than something wrong
      else if (albums.isEmpty)
        Padding(
          key: Key('space-albums-empty-${space.id}'),
          padding: const EdgeInsets.only(left: 48, right: 16, bottom: 8),
          child: Text(context.t.no_albums_in_space_yet, style: context.textTheme.bodySmall),
        )
      else
        for (final album in albums)
          ListTile(
            key: Key('space-album-child-${album.id}'),
            contentPadding: const EdgeInsets.only(left: 48, right: 16),
            leading: album.thumbnailAssetId == null
                ? const Icon(Icons.photo_album_outlined)
                : SizedBox(
                    width: 32,
                    height: 32,
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(4),
                      // SpaceAlbum carries no thumbhash; on Thumbnail.remote the value is only a
                      // cache-busting URL param, never a blur placeholder, so '' costs nothing here.
                      child: Thumbnail.remote(remoteId: album.thumbnailAssetId!, thumbhash: ''),
                    ),
                  ),
            title: Text(album.name, maxLines: 1, overflow: TextOverflow.ellipsis),
            enabled: !widget.isBusy,
            onTap: widget.isBusy ? null : () => _emit(SpaceAlbumTarget(spaceId: space.id, album: album)),
          ),
    ];
  }
}
