import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/constants/enums.dart';
import 'package:immich_mobile/presentation/widgets/action_buttons/download_action_button.widget.dart';
import 'package:immich_mobile/presentation/widgets/action_buttons/remove_from_album_action_button.widget.dart';
import 'package:immich_mobile/presentation/widgets/action_buttons/share_action_button.widget.dart';
import 'package:immich_mobile/presentation/widgets/bottom_sheet/base_bottom_sheet.widget.dart';

/// Reduced multiselect bottom sheet for the Space Album detail page.
///
/// Action set:
///   - Download (always)
///   - Share (always)
///   - Remove from album (editor only, gated on [canEdit])
///
/// Excluded actions compared to [RemoteAlbumBottomSheet]:
///   Favorite / Archive / Trash / Lock / Set-cover / Share-link / Stack /
///   Unstack / Edit-date-time / Edit-location / Delete-local
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
    return BaseBottomSheet(
      controller: sheetController,
      initialChildSize: 0.18,
      minChildSize: 0.18,
      maxChildSize: 0.85,
      shouldCloseOnMinExtent: false,
      actions: [
        const ShareActionButton(source: ActionSource.timeline),
        const DownloadActionButton(source: ActionSource.timeline),
        if (widget.canEdit)
          RemoveFromAlbumActionButton(
            source: ActionSource.timeline,
            albumId: widget.albumId,
            onComplete: widget.onRemoved,
          ),
      ],
    );
  }
}
