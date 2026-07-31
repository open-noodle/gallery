import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/constants/enums.dart';
import 'package:immich_mobile/presentation/actions/action.dart';
import 'package:immich_mobile/providers/infrastructure/action.provider.dart';
import 'package:immich_mobile/providers/infrastructure/toast.provider.dart';
import 'package:immich_mobile/utils/error_handler.dart';

/// Removing an asset from a Space is not deleting it, so an editor may remove
/// another member's photo. Derive from [assetsActionProvider], NOT
/// [ownedAssetsActionProvider] — see the design doc's hard constraint.
final _hasRemoteAssetsProvider = Provider.family.autoDispose<bool, ActionSource>(
  (ref, source) => ref.watch(assetsActionProvider(source)).remote().isNotEmpty,
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

    return .new(icon: Icons.remove_circle_outline, label: 'Remove from space', onAction: () => _removeFromSpace(ref));
  }

  Future<void> _removeFromSpace(WidgetRef ref) async {
    final toastService = ref.read(toastServiceProvider);
    final clearSelection = ref.read(clearSelectionProvider(source));
    final notifier = ref.read(actionProvider.notifier);

    try {
      final result = await notifier.removeFromSpace(source, spaceId);

      // Selection clearing and onComplete fire unconditionally, matching the
      // behaviour of the widget this replaces.
      clearSelection();
      onComplete?.call();

      if (result.success) {
        await toastService.success('${result.count} photos removed from space');
      } else {
        await toastService.error('scaffold_body_error_occurred');
      }
    } catch (error, stack) {
      handleError(error, stack: stack, description: 'Failed to remove assets from space');
    }
  }
}
