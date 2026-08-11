import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/constants/enums.dart';
import 'package:immich_mobile/domain/models/events.model.dart';
import 'package:immich_mobile/domain/utils/event_stream.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/widgets/action_buttons/base_action_button.widget.dart';
import 'package:immich_mobile/providers/infrastructure/action.provider.dart';
import 'package:immich_mobile/providers/timeline/multiselect.provider.dart';
import 'package:immich_mobile/widgets/common/immich_toast.dart';

class RemoveFromAlbumActionButton extends ConsumerWidget {
  final String albumId;
  final ActionSource source;
  final bool iconOnly;
  final bool menuItem;

  /// Optional callback invoked after a successful remove-from-album action.
  /// Used by [SpaceAlbumBottomSheet] to fire the sync-nudge (B6).
  final VoidCallback? onComplete;

  const RemoveFromAlbumActionButton({
    super.key,
    required this.albumId,
    required this.source,
    this.iconOnly = false,
    this.menuItem = false,
    this.onComplete,
  });

  Future<void> _onTap(BuildContext context, WidgetRef ref) async {
    if (!context.mounted) {
      return;
    }

    if (source == ActionSource.viewer) {
      EventStream.shared.emit(const ViewerReloadAssetEvent());
    }

    final result = await ref.read(actionProvider.notifier).removeFromAlbum(source, albumId);
    ref.read(multiSelectProvider.notifier).reset();
    if (result.success) onComplete?.call();
    if (!context.mounted) {
      return;
    }

    final successMessage = context.t.remove_from_album_action_prompt(count: result.count);
    ImmichToast.show(
      context: context,
      msg: result.success ? successMessage : context.t.scaffold_body_error_occurred,
      gravity: ToastGravity.BOTTOM,
      toastType: result.success ? ToastType.success : ToastType.error,
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return BaseActionButton(
      iconData: Icons.remove_circle_outline,
      label: context.t.remove_from_album,
      iconOnly: iconOnly,
      menuItem: menuItem,
      onPressed: () => _onTap(context, ref),
      maxWidth: 100,
    );
  }
}
