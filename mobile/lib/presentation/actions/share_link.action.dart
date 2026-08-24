import 'dart:async';

import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/constants/enums.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/actions/action.dart';
import 'package:immich_mobile/routing/router.dart';

typedef _ShareLinkSelection = ({List<String> remoteIds, int contributedCount});

final _stateProvider = Provider.family.autoDispose<_ShareLinkSelection?, ActionSource>((ref, source) {
  final assets = ref.watch(assetsActionProvider(source));
  final remoteIds = assets.remote().map((asset) => asset.id).toList(growable: false);
  if (remoteIds.isEmpty) {
    return null;
  }
  // #1018: how many of the selection belong to other members. Drives the editor's consent
  // warning. Derived here rather than passed in so a caller cannot misreport it.
  final ownedCount = ref.watch(ownedAssetsActionProvider(source)).length;
  return (remoteIds: remoteIds, contributedCount: remoteIds.length - ownedCount);
}, dependencies: [assetsActionProvider, ownedAssetsActionProvider]);

class ShareLinkAction extends AssetActionBuilder {
  /// #1018: set when the action is offered from inside a Space to an Owner/Editor. The link is
  /// then authorized against the space, so it covers photos other members contributed rather than
  /// only the caller's own. Null everywhere else, which keeps the plain owner-only link.
  final String? spaceId;

  const ShareLinkAction({required super.source, this.spaceId});

  @override
  ActionItem? create(BuildContext context, WidgetRef ref) {
    final selection = ref.watch(_stateProvider(source));
    if (selection == null) {
      return null;
    }

    return .new(
      icon: Icons.link_rounded,
      label: context.t.share_link,
      onAction: () async => unawaited(
        context.pushRoute(
          SharedLinkEditRoute(
            assetsList: selection.remoteIds,
            spaceId: spaceId,
            // 0 off a space surface, where the whole selection is the caller's own anyway.
            contributedCount: spaceId == null ? 0 : selection.contributedCount,
          ),
        ),
      ),
    );
  }
}
