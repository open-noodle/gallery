import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/constants/enums.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';
import 'package:immich_mobile/presentation/widgets/action_buttons/base_action_button.widget.dart';
import 'package:immich_mobile/providers/infrastructure/action.provider.dart';

class ShareLinkActionButton extends ConsumerWidget {
  final ActionSource source;
  final bool iconOnly;
  final bool menuItem;

  /// #1018: set when the button is opened from inside a Space by an Owner/Editor. The link is then
  /// authorized against the space, so it covers photos other members contributed rather than only
  /// the caller's own. Null everywhere else, which keeps the plain owner-only link.
  final String? spaceId;

  const ShareLinkActionButton({
    super.key,
    required this.source,
    this.iconOnly = false,
    this.menuItem = false,
    this.spaceId,
  });

  _onTap(BuildContext context, WidgetRef ref) async {
    if (!context.mounted) {
      return;
    }

    await ref.read(actionProvider.notifier).shareLink(source, context, spaceId: spaceId);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return BaseActionButton(
      iconData: Icons.link_rounded,
      label: "share_link".t(context: context),
      iconOnly: iconOnly,
      menuItem: menuItem,
      onPressed: () => _onTap(context, ref),
    );
  }
}
