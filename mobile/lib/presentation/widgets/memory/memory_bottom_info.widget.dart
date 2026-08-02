import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/memory.model.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/providers/asset_viewer/scroll_to_asset_notifier.provider.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:intl/intl.dart';

/// The asset shown on [page] of [memory], clamped to the memory's bounds.
///
/// `currentAssetPage` in the memory page belongs to the ACTIVE memory, so an
/// inactive page in the vertical PageView can ask for an index this memory does
/// not have.
RemoteAsset memoryAssetForPage(Memory memory, int page) => memory.assets[page.clamp(0, memory.assets.length - 1)];

class MemoryBottomInfo extends StatelessWidget {
  final RemoteAsset asset;
  final String title;
  const MemoryBottomInfo({super.key, required this.asset, required this.title});

  @override
  Widget build(BuildContext context) {
    final df = DateFormat.yMMMMd();
    final fileCreatedDate = asset.createdAt;
    return Padding(
      padding: const EdgeInsets.all(16.0),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: TextStyle(color: Colors.grey[400], fontSize: 13.0, fontWeight: FontWeight.w500),
              ),
              Text(
                df.format(fileCreatedDate.toLocal()),
                style: const TextStyle(color: Colors.white, fontSize: 15.0, fontWeight: FontWeight.w500),
              ),
            ],
          ),
          Tooltip(
            message: context.t.view_in_timeline,
            child: MaterialButton(
              minWidth: 0,
              onPressed: () async {
                await context.maybePop();
                if (!context.mounted) {
                  return;
                }

                // Activate the existing timeline tab without rebuilding it (a fresh
                // TabShellRoute would reload the timeline to the top and discard the scroll).
                await context.navigateTo(const MainTimelineRoute());
                // #28941: the notifier converts to the viewer's local time itself.
                scrollToAssetNotifierProvider.scrollToAsset(asset);
              },
              shape: const CircleBorder(),
              color: Colors.white.withValues(alpha: 0.2),
              elevation: 0,
              child: const Icon(Icons.open_in_new, color: Colors.white),
            ),
          ),
        ],
      ),
    );
  }
}
