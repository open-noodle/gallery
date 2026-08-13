import 'dart:async';

import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/constants/enums.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/actions/action.widget.dart';
import 'package:immich_mobile/presentation/actions/archive.action.dart';
import 'package:immich_mobile/presentation/actions/lock.action.dart';
import 'package:immich_mobile/presentation/widgets/action_buttons/base_action_button.widget.dart';
import 'package:immich_mobile/presentation/widgets/album/album_selector.widget.dart';
import 'package:immich_mobile/presentation/widgets/bottom_sheet/base_bottom_sheet.widget.dart';
import 'package:immich_mobile/presentation/widgets/collection/collection_picker.widget.dart';
import 'package:immich_mobile/providers/asset_viewer/asset_viewer.provider.dart';
import 'package:immich_mobile/providers/infrastructure/album.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_mobile/widgets/common/immich_toast.dart';
import 'package:immich_ui/immich_ui.dart';

enum AddToMenuItem { album }

class AddActionButton extends ConsumerStatefulWidget {
  const AddActionButton({super.key, this.originalTheme});

  final ThemeData? originalTheme;

  @override
  ConsumerState<AddActionButton> createState() => _AddActionButtonState();
}

class _AddActionButtonState extends ConsumerState<AddActionButton> {
  void _handleMenuSelection(AddToMenuItem selected) {
    switch (selected) {
      case AddToMenuItem.album:
        _openAlbumSelector();
    }
  }

  List<Widget> _buildMenuChildren() {
    final asset = ref.read(assetViewerProvider).currentAsset;
    if (asset == null) {
      return [];
    }

    final user = ref.read(currentUserProvider);
    final isOwner = asset is RemoteAsset && asset.ownerId == user?.id;

    return [
      Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        child: Text(context.t.add_to_bottom_bar, style: context.textTheme.labelMedium),
      ),
      BaseActionButton(
        iconData: Icons.photo_album_outlined,
        label: context.t.album,
        menuItem: true,
        onPressed: () => _handleMenuSelection(AddToMenuItem.album),
      ),

      if (isOwner) ...[
        const Divider(),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Text(context.t.move_to, style: context.textTheme.labelMedium),
        ),
        const ActionMenuItem(action: ArchiveAction(source: .viewer)),
        const ActionMenuItem(action: LockAction(source: .viewer)),
      ],
    ];
  }

  void _openAlbumSelector() {
    final currentAsset = ref.read(assetViewerProvider).currentAsset;
    if (currentAsset == null) {
      ImmichToast.show(context: context, msg: "Cannot load asset information.", toastType: ToastType.error);
      return;
    }

    // #965: the same picker every other surface offers. The viewer has no multiselect, so it
    // states its source and its one asset explicitly — the spaces section judges ownership
    // from that rather than from an empty selection.
    final List<Widget> slivers = [
      const CreateAlbumButton(),
      CollectionPicker(
        source: ActionSource.viewer,
        assets: [currentAsset],
        onCompleted: () => _onAddCompleted(currentAsset),
      ),
    ];

    unawaited(
      showModalBottomSheet(
        context: context,
        isScrollControlled: true,
        backgroundColor: Colors.transparent,
        builder: (_) {
          return BaseBottomSheet(
            actions: const [],
            slivers: slivers,
            initialChildSize: 0.6,
            minChildSize: 0.3,
            maxChildSize: 0.95,
            expand: false,
            backgroundColor: context.isDarkTheme ? Colors.black : Colors.white,
          );
        },
      ),
    );
  }

  /// The picker owns the dispatch and the toasts; the viewer only has to refresh what it
  /// shows and get out of the way.
  void _onAddCompleted(BaseAsset asset) {
    // Guard before touching `ref`: invalidating from a disposed ConsumerState throws.
    if (!mounted) {
      return;
    }
    final remoteId = asset.remoteId;
    if (remoteId != null) {
      // Refresh the "Appears in" list on the asset's info panel.
      ref.invalidate(albumsContainingAssetProvider(remoteId));
    }
    unawaited(Navigator.of(context).maybePop());
  }

  @override
  Widget build(BuildContext context) {
    final asset = ref.watch(assetViewerProvider.select((s) => s.currentAsset));
    if (asset == null) {
      return const SizedBox.shrink();
    }

    final themeData = widget.originalTheme ?? context.themeData;

    return ImmichMenu(
      consumeOutsideTap: true,
      style: MenuStyle(
        backgroundColor: WidgetStatePropertyAll(themeData.scaffoldBackgroundColor),
        surfaceTintColor: const WidgetStatePropertyAll(Colors.grey),
        elevation: const WidgetStatePropertyAll(4),
        shape: const WidgetStatePropertyAll(
          RoundedRectangleBorder(borderRadius: BorderRadius.all(Radius.circular(12))),
        ),
        padding: const WidgetStatePropertyAll(EdgeInsets.symmetric(vertical: 6)),
      ),
      children: widget.originalTheme != null
          ? [
              Theme(
                data: widget.originalTheme!,
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: _buildMenuChildren()),
              ),
            ]
          : _buildMenuChildren(),
      builder: (context, controller, child) {
        return BaseActionButton(
          iconData: Icons.add,
          label: context.t.add_to_bottom_bar,
          onPressed: () => controller.isOpen ? controller.close() : controller.open(),
        );
      },
    );
  }
}
