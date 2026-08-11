import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/constants/enums.dart';
import 'package:immich_mobile/domain/models/album/album.model.dart';
import 'package:immich_mobile/domain/models/collection_target.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/widgets/album/album_selector.widget.dart';
import 'package:immich_mobile/presentation/widgets/collection/space_collection_section.widget.dart';
import 'package:immich_mobile/providers/infrastructure/action.provider.dart';
import 'package:immich_mobile/widgets/common/immich_toast.dart';
import 'package:sliver_tools/sliver_tools.dart';

/// "Add to album or space" — the album selector plus the spaces section.
///
/// `AlbumSelector` is upstream and is composed, with two additive fork hooks
/// (`onSearchChanged`, `searchHint`) so its search field can cover the spaces section too. Its own
/// `AddToAlbumHeader` is not reused because it hardcodes the `add_to_album` key; this
/// picker supplies its own header so the sheet can honestly say "album or space".
class CollectionPicker extends ConsumerStatefulWidget {
  const CollectionPicker({super.key, this.excludeSpaceId, this.onKeyboardExpanded});

  /// Set on a space's own surface so that space is not offered as a destination for
  /// its own assets.
  final String? excludeSpaceId;

  final Function? onKeyboardExpanded;

  @override
  ConsumerState<CollectionPicker> createState() => _CollectionPickerState();
}

class _CollectionPickerState extends ConsumerState<CollectionPicker> {
  bool _isBusy = false;
  String _searchQuery = '';

  Future<void> _addToAlbum(RemoteAlbum album) async {
    if (_isBusy) return;
    setState(() => _isBusy = true);
    final result = await ref.read(actionProvider.notifier).addToAlbum(ActionSource.timeline, album);
    if (!mounted) return;
    setState(() => _isBusy = false);

    if (!result.success) {
      _toastError();
      return;
    }
    ImmichToast.show(
      context: context,
      msg: result.count == 0
          ? context.t.add_to_album_bottom_sheet_already_exists(album: album.name)
          : context.t.add_to_album_bottom_sheet_added(album: album.name),
    );
  }

  Future<void> _addToTarget(CollectionTarget target) async {
    if (_isBusy) return;
    setState(() => _isBusy = true);

    final notifier = ref.read(actionProvider.notifier);
    final ActionResult result;
    final String? successMessage;
    switch (target) {
      case AlbumTarget(:final album):
        result = await notifier.addToAlbum(ActionSource.timeline, album);
        successMessage = null;
      case SpacePoolTarget(:final space):
        result = await notifier.addToSpace(ActionSource.timeline, space);
        // The pool endpoint is 204 with no body, so this count is the request length.
        successMessage = 'added_to_space_count';
      case SpaceAlbumTarget(:final spaceId, :final album):
        result = await notifier.addToSpaceAlbum(ActionSource.timeline, spaceId, album);
        // This one IS the server's count, so duplicates are already excluded.
        successMessage = 'space_album_add_photos_success';
    }

    if (!mounted) return;
    setState(() => _isBusy = false);

    if (!result.success) {
      _toastError();
      return;
    }
    if (successMessage != null) {
      ImmichToast.show(
        context: context,
        msg: successMessage.tr(namedArgs: {'count': result.count.toString()}),
        toastType: ToastType.success,
      );
    }
  }

  void _toastError() {
    ImmichToast.show(context: context, msg: context.t.scaffold_body_error_occurred, toastType: ToastType.error);
  }

  @override
  Widget build(BuildContext context) {
    return MultiSliver(
      children: [
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
          sliver: SliverToBoxAdapter(
            child: Text(
              context.t.add_to_album_or_space,
              key: const Key('collection-picker-header'),
              style: context.textTheme.titleSmall,
            ),
          ),
        ),
        AlbumSelector(
          onAlbumSelected: _addToAlbum,
          onKeyboardExpanded: widget.onKeyboardExpanded,
          onSearchChanged: (query) => setState(() => _searchQuery = query),
          searchHint: context.t.search_albums_and_spaces,
        ),
        SliverToBoxAdapter(
          child: SpaceCollectionSection(
            onTargetSelected: _addToTarget,
            excludeSpaceId: widget.excludeSpaceId,
            isBusy: _isBusy,
            searchQuery: _searchQuery,
          ),
        ),
      ],
    );
  }
}
