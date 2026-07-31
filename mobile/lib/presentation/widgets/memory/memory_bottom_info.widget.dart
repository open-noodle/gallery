import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:immich_mobile/domain/models/memory.model.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/providers/asset_viewer/scroll_to_date_notifier.provider.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:intl/intl.dart';

class MemoryBottomInfo extends StatelessWidget {
  final Memory memory;
  final String title;
  const MemoryBottomInfo({super.key, required this.memory, required this.title});

  @override
  Widget build(BuildContext context) {
    final df = DateFormat.yMMMMd();
    final fileCreatedDate = memory.assets.first.createdAt;
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
                // #28941: scroll to the date in the viewer's local time, not UTC.
                scrollToDateNotifierProvider.scrollToDate(fileCreatedDate.toLocal());
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
