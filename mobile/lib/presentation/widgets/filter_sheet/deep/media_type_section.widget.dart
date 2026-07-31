import 'dart:async';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/collapsible_section.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_section_id.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

/// Segmented control over All / Photos / Videos / Audio. "All" maps to
/// AssetType.other (the "no server-side media-type constraint" sentinel).
class MediaTypeSection extends ConsumerWidget {
  const MediaTypeSection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final current = ref.watch(photosFilterProvider.select((f) => f.mediaType));
    return CollapsibleSection(
      sectionId: FilterSectionId.media,
      titleKey: 'filter_sheet_deep_media_section',
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 20),
        child: SegmentedButton<AssetType>(
          segments: [
            ButtonSegment(
              value: AssetType.other,
              label: Text('filter_sheet_deep_media_any'.tr(), key: const Key('media-segment-all')),
            ),
            ButtonSegment(
              value: AssetType.image,
              label: Text('filter_sheet_media_photos'.tr(), key: const Key('media-segment-image')),
            ),
            ButtonSegment(
              value: AssetType.video,
              label: Text('filter_sheet_media_videos'.tr(), key: const Key('media-segment-video')),
            ),
            ButtonSegment(
              value: AssetType.audio,
              label: Text('filter_sheet_media_audio'.tr(), key: const Key('media-segment-audio')),
            ),
          ],
          selected: {current},
          onSelectionChanged: (selected) {
            unawaited(HapticFeedback.selectionClick());
            final next = selected.first;
            ref.read(photosFilterProvider.notifier).setMediaType(next == AssetType.other ? null : next);
          },
          showSelectedIcon: false,
        ),
      ),
    );
  }
}
