import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/constants/enums.dart';
import 'package:immich_mobile/gallery/space_removal.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/actions/action.dart';
import 'package:immich_mobile/providers/infrastructure/toast.provider.dart';
import 'package:immich_mobile/utils/error_handler.dart';

/// Removing an asset from a Space is not deleting it, so an editor may remove
/// another member's photo. Derive from [assetsActionProvider], NOT
/// [ownedAssetsActionProvider] — see the design doc's hard constraint.
final _hasRemoteAssetsProvider = Provider.family.autoDispose<bool, ActionSource>(
  (ref, source) => ref.watch(assetsActionProvider(source)).remote().isNotEmpty,
  dependencies: [assetsActionProvider],
);

class RemoveFromSpaceAction extends AssetActionBuilder {
  final String spaceId;
  final VoidCallback? onComplete;

  const RemoveFromSpaceAction({required super.source, required this.spaceId, this.onComplete});

  @override
  ActionItem? create(BuildContext context, WidgetRef ref) {
    if (!ref.watch(_hasRemoteAssetsProvider(source))) {
      return null;
    }

    return .new(
      icon: Icons.remove_circle_outline,
      label: context.t.remove_from_space,
      onAction: () => _removeFromSpace(context, ref),
    );
  }

  Future<void> _removeFromSpace(BuildContext context, WidgetRef ref) async {
    final toastService = ref.read(toastServiceProvider);
    final clearSelection = ref.read(clearSelectionProvider(source));
    final assetIds = ref.read(assetsActionProvider(source)).remote().map((asset) => asset.id).toList();

    SpaceRemoval? removal;
    try {
      removal = await ref.read(spaceRemovalServiceProvider).remove(spaceId, assetIds);
    } catch (error, stack) {
      // Shows the server's message, or a generic one.
      handleError(error, stack: stack, description: 'Failed to remove assets from space');
    }

    // Selection clearing and onComplete fire whatever the outcome, as before.
    clearSelection();
    onComplete?.call();
    if (removal == null) {
      return;
    }

    await showSpaceRemovalToast(toastService, removal);
  }
}
