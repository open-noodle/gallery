import 'package:auto_route/auto_route.dart';
import 'package:flutter/widgets.dart';
import 'package:immich_mobile/domain/models/album/local_album.model.dart';
import 'package:immich_mobile/presentation/widgets/bottom_sheet/local_album_bottom_sheet.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_grouping_header_sliver.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_route_scope.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/widgets/common/mesmerizing_sliver_app_bar.dart';

@RoutePage()
class LocalTimelinePage extends StatelessWidget {
  final LocalAlbum album;

  const LocalTimelinePage({super.key, required this.album});

  static const timelineOverviewControlsEnabled = true;
  static const timelineOverviewTopSliverHeight = kTimelineGroupingHeaderSliverHeight;

  @override
  Widget build(BuildContext context) {
    return TimelineRouteScope(
      timelineServiceBuilder: (ref, scope) =>
          ref.watch(timelineFactoryProvider).localAlbum(albumId: album.id, temporalScope: scope),
      child: Timeline(
        topSliverWidget: const TimelineGroupingHeaderSliver(),
        topSliverWidgetHeight: LocalTimelinePage.timelineOverviewTopSliverHeight,
        appBar: MesmerizingSliverAppBar(title: album.name),
        bottomSheet: const LocalAlbumBottomSheet(),
        showStorageIndicator: true,
      ),
    );
  }
}
