import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/constants/enums.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/gallery/space_removal.dart';
import 'package:immich_mobile/gallery/space_remove.provider.dart';
import 'package:immich_mobile/gallery/space_remove_picker.widget.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/actions/action.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/infrastructure/toast.provider.dart';
import 'package:immich_mobile/utils/error_handler.dart';

/// Removes the Photos selection from a space it is in: the one space by name, or the one picked when there are
/// several. No confirmation, as inside a space on mobile. Only on the main timeline; a space's own timeline has
/// its own remove action.
class RemoveFromSpacesAction extends AssetActionBuilder {
  const RemoveFromSpacesAction({required super.source});

  @override
  ActionItem? create(BuildContext context, WidgetRef ref) {
    if (source != ActionSource.timeline ||
        ref.watch(timelineServiceProvider.select((service) => service.origin)) != TimelineOrigin.main) {
      return null;
    }
    final spaces = ref.watch(removableSpacesProvider).valueOrNull ?? const <RemovableSpace>[];
    if (spaces.isEmpty) {
      return null;
    }

    return .new(
      icon: Icons.remove_circle_outline,
      label: spaces.length == 1
          ? context.t.remove_from_named_space(space: spaces.single.name)
          : context.t.remove_from_a_space,
      onAction: () => _remove(context, ref, spaces),
    );
  }

  Future<void> _remove(BuildContext context, WidgetRef ref, List<RemovableSpace> spaces) async {
    // Read before any await: the picker may outlive this widget's frame.
    final toastService = ref.read(toastServiceProvider);
    final clearSelection = ref.read(clearSelectionProvider(source));
    final service = ref.read(spaceRemovalServiceProvider);
    // The spaces may still answer for the previous selection while the query reruns: act on what is selected now.
    final selected = {for (final asset in ref.read(assetsActionProvider(source)).remote()) asset.id};

    final space = spaces.length == 1 ? spaces.single : await showSpaceRemovePicker(context, spaces);
    if (space == null) {
      return;
    }

    final assetIds = [
      for (final id in space.assetIds)
        if (selected.contains(id)) id,
    ];
    if (assetIds.isEmpty) {
      return;
    }

    final SpaceRemoval removal;
    try {
      removal = await service.remove(space.id, assetIds);
    } catch (error, stack) {
      // Shows the server's message, or a generic one; the selection stays for another try.
      handleError(error, stack: stack, description: 'Failed to remove assets from space');
      return;
    }

    clearSelection();
    await showSpaceRemovalToast(toastService, removal);
  }
}
