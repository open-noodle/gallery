import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/constants/enums.dart';
import 'package:immich_mobile/presentation/actions/action.widget.dart';
import 'package:immich_mobile/presentation/actions/asset_debug.action.dart';
import 'package:immich_mobile/presentation/actions/download.action.dart';
import 'package:immich_mobile/presentation/actions/share.action.dart';
import 'package:immich_mobile/presentation/widgets/action_buttons/remove_from_album_action_button.widget.dart';
import 'package:immich_mobile/presentation/widgets/bottom_sheet/base_bottom_sheet.widget.dart';
import 'package:immich_mobile/presentation/widgets/collection/collection_picker.widget.dart';

/// Reduced multiselect bottom sheet for the Space Album detail page.
///
/// Action set:
///   - Troubleshoot (self-gating: only renders when the advanced-troubleshooting
///     setting is on and exactly one asset is selected)
///   - Download (always)
///   - Share (always)
///   - Remove from album (editor only, gated on [canEdit])
///
/// Excluded actions compared to [RemoteAlbumBottomSheet]:
///   Favorite / Archive / Trash / Lock / Set-cover / Share-link / Stack /
///   Unstack / Edit-date-time / Edit-location / Delete-local
///
/// The sheet also mounts the shared [CollectionPicker] (#965 follow-up), with no
/// `excludeSpaceId` — the current space is a legitimate target from inside one of its own albums.
///
/// Role-gating is on [canEdit] (space role), not album ownership (D3).
///
/// [onRemoved] is called after a successful remove-from-album action so the
/// caller can fire the sync-nudge (B6).
class SpaceAlbumBottomSheet extends ConsumerStatefulWidget {
  const SpaceAlbumBottomSheet({super.key, required this.canEdit, required this.albumId, this.onRemoved});

  final bool canEdit;
  final String albumId;

  /// Optional callback fired after photos are successfully removed from the
  /// album. Used by [SpaceAlbumDetailPage] to trigger the sync-nudge.
  final VoidCallback? onRemoved;

  @override
  ConsumerState<SpaceAlbumBottomSheet> createState() => _SpaceAlbumBottomSheetState();
}

class _SpaceAlbumBottomSheetState extends ConsumerState<SpaceAlbumBottomSheet> {
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

  @override
  Widget build(BuildContext context) {
    Future<void> onKeyboardExpand() {
      // 0.85 is this sheet's maxChildSize.
      return sheetController.animateTo(0.85, duration: const Duration(milliseconds: 200), curve: Curves.easeInOut);
    }

    return BaseBottomSheet(
      controller: sheetController,
      initialChildSize: 0.18,
      minChildSize: 0.18,
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
        const ActionColumnButton(action: DownloadAction(source: ActionSource.timeline)),
        if (widget.canEdit)
          RemoveFromAlbumActionButton(
            source: ActionSource.timeline,
            albumId: widget.albumId,
            onComplete: widget.onRemoved,
          ),
      ],
      // The same picker every other multi-select surface offers. No excludeSpaceId: this sheet has
      // no spaceId, and the current space is a legitimate target from inside one of its albums.
      slivers: [CollectionPicker(onKeyboardExpanded: onKeyboardExpand)],
    );
  }
}
