import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/constants/enums.dart';
import 'package:immich_mobile/presentation/actions/action.widget.dart';
import 'package:immich_mobile/presentation/actions/asset_debug.action.dart';
import 'package:immich_mobile/presentation/actions/download.action.dart';
import 'package:immich_mobile/presentation/actions/favorite.action.dart';
import 'package:immich_mobile/presentation/actions/remove_from_space.action.dart';
import 'package:immich_mobile/presentation/actions/share.action.dart';
import 'package:immich_mobile/presentation/actions/share_link.action.dart';
import 'package:immich_mobile/presentation/widgets/bottom_sheet/base_bottom_sheet.widget.dart';
import 'package:immich_mobile/presentation/widgets/collection/collection_picker.widget.dart';
import 'package:immich_mobile/providers/timeline/multiselect.provider.dart';
import 'package:immich_mobile/utils/space_permissions.dart';
import 'package:openapi/api.dart';

class SpaceBottomSheet extends ConsumerStatefulWidget {
  final String spaceId;
  final SharedSpaceRole currentUserRole;
  final VoidCallback? onAssetsRemoved;

  const SpaceBottomSheet({super.key, required this.spaceId, required this.currentUserRole, this.onAssetsRemoved});

  @override
  ConsumerState<SpaceBottomSheet> createState() => _SpaceBottomSheetState();
}

class _SpaceBottomSheetState extends ConsumerState<SpaceBottomSheet> {
  late DraggableScrollableController sheetController;

  @override
  void initState() {
    super.initState();
    sheetController = DraggableScrollableController();
  }

  @override
  void dispose() {
    sheetController.dispose();
    super.dispose();
  }

  bool get _canEdit => roleIsWritable(widget.currentUserRole);

  @override
  Widget build(BuildContext context) {
    final multiselect = ref.watch(multiSelectProvider);

    return BaseBottomSheet(
      controller: sheetController,
      initialChildSize: 0.22,
      minChildSize: 0.22,
      // Raised from 0.55: the sheet now hosts the collection picker, which is unreachable
      // at the old ceiling.
      maxChildSize: 0.85,
      shouldCloseOnMinExtent: false,
      actions: [
        // ActionColumnButton throughout, matching every other BaseBottomSheet. ActionMenuItem is a
        // left-aligned vertical MENU row built for the asset-viewer kebab menu; placed in this
        // horizontal action Row it renders inconsistently next to the column tiles below. It is also
        // the one ActionWidget subclass that never wires onSecondaryAction, and ShareAction is the
        // only action that defines one — so using it here silently killed the long-press
        // share-quality prompt.
        const ActionColumnButton(action: AssetDebugAction(source: ActionSource.timeline)),
        const ActionColumnButton(action: ShareAction(source: ActionSource.timeline)),
        if (multiselect.hasRemote) ...[
          const ActionColumnButton(action: DownloadAction(source: ActionSource.timeline)),
          const ActionColumnButton(action: FavoriteAction(source: ActionSource.timeline)),
          // #1018: a link covering what the SPACE shows, contributions included. Same gate as
          // remove-from-space — the server authorizes a space-scoped link against Owner/Editor, so
          // offering it to a Viewer would only ever produce a rejected request.
          if (_canEdit)
            ActionColumnButton(
              action: ShareLinkAction(source: ActionSource.timeline, spaceId: widget.spaceId),
            ),
          if (_canEdit)
            ActionColumnButton(
              action: RemoveFromSpaceAction(
                source: ActionSource.timeline,
                spaceId: widget.spaceId,
                onComplete: widget.onAssetsRemoved,
              ),
            ),
        ],
      ],
      slivers: [
        // A space is not offered as a destination for its own assets.
        CollectionPicker(excludeSpaceId: widget.spaceId),
      ],
    );
  }
}
