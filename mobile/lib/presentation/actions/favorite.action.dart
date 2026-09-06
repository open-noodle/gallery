import 'package:flutter/material.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/actions/action.dart';
import 'package:immich_mobile/providers/infrastructure/asset.provider.dart';
import 'package:immich_mobile/utils/asset_filter.dart';
import 'package:immich_ui/immich_ui.dart';

class FavoriteAction extends AssetAction<RemoteAsset> {
  final bool favorite;

  // #763 (E32): the direction must derive from the SAME set the action mutates. Candidates are
  // every remote asset in the selection — favorites are per-user, so read access (implied by the
  // asset being in the local mirror) is sufficient; ownership is irrelevant.
  FavoriteAction({required super.assets}) : favorite = AssetFilter(assets).remote().any((a) => !a.isFavorite);

  @override
  IconData get icon => favorite ? Icons.favorite_border_rounded : Icons.favorite_rounded;

  @override
  String label(ActionScope scope) => favorite ? scope.context.t.favorite : scope.context.t.unfavorite;

  @override
  Iterable<RemoteAsset> filter(ActionScope scope) =>
      // #763: no ownership gate — favoriting is a per-user overlay write available to anyone who
      // can see the asset, so every remote asset in the selection is a candidate.
      AssetFilter(assets).remote().favorite(isFavorite: !favorite);

  @override
  bool isVisible(ActionScope scope) => filter(scope).isNotEmpty;

  @override
  Future<void> onAction(ActionScope scope) async {
    final ActionScope(:ref) = scope;
    final assets = filter(scope).map((asset) => asset.id).toList(growable: false);

    await ref.read(assetServiceProvider).updateFavorite(assets, favorite);
    final message = favorite
        ? StaticTranslations.instance.favorite_action_prompt(count: assets.length)
        : StaticTranslations.instance.unfavorite_action_prompt(count: assets.length);
    snackbar.success(message);
  }
}
