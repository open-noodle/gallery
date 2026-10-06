import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/memory.model.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/widgets/memory/memory_title.widget.dart';
import 'package:immich_mobile/providers/asset_viewer/view_in_timeline_destination.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:intl/intl.dart';

class MemoryBottomInfo extends ConsumerWidget {
  final Memory memory;
  final RemoteAsset asset;
  const MemoryBottomInfo({super.key, required this.memory, required this.asset});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final df = DateFormat.yMMMMd();
    final fileCreatedDate = asset.createdAt;
    return Padding(
      padding: const EdgeInsets.all(16.0),
      child: Row(
        spacing: 16.0,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  getMemoryTitle(context.t, memory, asset: asset),
                  style: TextStyle(color: Colors.grey[400], fontSize: 13.0, fontWeight: FontWeight.w500),
                ),
                Text(
                  df.format(fileCreatedDate.toLocal()),
                  style: const TextStyle(color: Colors.white, fontSize: 15.0, fontWeight: FontWeight.w500),
                ),
              ],
            ),
          ),
          Tooltip(
            message: context.t.view_in_timeline,
            child: MaterialButton(
              minWidth: 0,
              onPressed: () => viewMemoryAssetInTimeline(
                asset: asset,
                read: ref.read,
                popViewer: () => context.maybePop(),
                // Activate the existing timeline tab without rebuilding it (a fresh
                // TabShellRoute would reload the timeline to the top and discard the scroll).
                goToMainTimeline: () => context.navigateTo(const MainTimelineRoute()),
                // #1047: a photo the viewer only reaches through a Space is not in their
                // personal timeline, so open the Space's own timeline instead. Pushed, not
                // navigated, so the Space stacks over the timeline — the jump latches its
                // scroll target BEFORE this future settles, because a push future completes
                // when the route is popped.
                goToSpace: (spaceId) => context.pushRoute(SpaceDetailRoute(spaceId: spaceId)),
              ),
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
