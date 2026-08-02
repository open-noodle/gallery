import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_grouping.model.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/presentation/widgets/images/thumbnail.widget.dart';

const double kTimelineOverviewCardHeight = 144.0;
const double kTimelineOverviewCardVerticalPadding = 6.0;
const double kTimelineOverviewCardHorizontalPadding = 12.0;
const double kTimelineOverviewSegmentExtent = kTimelineOverviewCardHeight + (kTimelineOverviewCardVerticalPadding * 2);

class TimelineOverviewCard extends StatelessWidget {
  const TimelineOverviewCard({
    super.key,
    required this.bucket,
    required this.mode,
    this.representativeAsset,
    this.onTap,
  });

  final TimeBucket bucket;
  final TimelineOverviewMode mode;
  final BaseAsset? representativeAsset;
  final VoidCallback? onTap;

  String _label(BuildContext context) {
    final locale = context.locale.toLanguageTag();
    return switch (mode) {
      TimelineOverviewMode.years => DateFormat.y(locale).format(bucket.date),
      TimelineOverviewMode.months => DateFormat.yMMM(locale).format(bucket.date),
      TimelineOverviewMode.all => DateFormat.yMMMEd(locale).format(bucket.date),
    };
  }

  String _semanticsPeriod(BuildContext context) {
    final locale = context.locale.toLanguageTag();
    return switch (mode) {
      TimelineOverviewMode.years => DateFormat.y(locale).format(bucket.date),
      TimelineOverviewMode.months => DateFormat.yMMMM(locale).format(bucket.date),
      TimelineOverviewMode.all => DateFormat.yMMMMEEEEd(locale).format(bucket.date),
    };
  }

  String _countLabel() {
    final count = bucket.assetCount;
    final translated = 'timeline_overview_photo_count'.tr(namedArgs: {'count': count.toString()});
    if (translated != 'timeline_overview_photo_count' && !translated.contains('plural')) {
      return translated;
    }

    return count == 1 ? '1 photo' : '$count photos';
  }

  String? _actionLabel() {
    final key = switch (mode) {
      TimelineOverviewMode.years => 'timeline_overview_show_months',
      TimelineOverviewMode.months => 'timeline_overview_show_days',
      TimelineOverviewMode.all => null,
    };
    if (key == null) {
      return null;
    }

    final translated = key.tr();
    if (translated != key) {
      return translated;
    }

    return switch (mode) {
      TimelineOverviewMode.years => 'show months',
      TimelineOverviewMode.months => 'show days',
      TimelineOverviewMode.all => null,
    };
  }

  String _cardSemanticsLabel(BuildContext context, String countLabel, String actionLabel) {
    final period = _semanticsPeriod(context);
    final translated = 'timeline_overview_card_semantics'.tr(
      namedArgs: {'period': period, 'countLabel': countLabel, 'action': actionLabel},
    );
    if (translated != 'timeline_overview_card_semantics' && !translated.contains('{period}')) {
      return translated;
    }

    return '$period, $countLabel, $actionLabel';
  }

  @override
  Widget build(BuildContext context) {
    final label = _label(context);
    final countLabel = _countLabel();
    final representativeAsset = this.representativeAsset;
    final actionLabel = _actionLabel();
    final isActionable = onTap != null && bucket.assetCount > 0 && actionLabel != null;

    final card = Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: kTimelineOverviewCardHorizontalPadding,
        vertical: kTimelineOverviewCardVerticalPadding,
      ),
      child: SizedBox(
        key: const ValueKey('timeline-overview-card-size'),
        height: kTimelineOverviewCardHeight,
        width: double.infinity,
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: isActionable ? onTap : null,
            borderRadius: BorderRadius.circular(8),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: Stack(
                fit: StackFit.expand,
                children: [
                  if (representativeAsset != null)
                    Thumbnail.fromAsset(asset: representativeAsset, fit: BoxFit.cover, size: const Size(640, 320))
                  else
                    DecoratedBox(
                      key: const ValueKey('timeline-overview-card-fallback'),
                      decoration: BoxDecoration(color: context.colorScheme.surfaceContainerHighest),
                    ),
                  const DecoratedBox(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                        colors: [Colors.transparent, Color(0xCC000000)],
                        stops: [0.35, 1.0],
                      ),
                    ),
                  ),
                  PositionedDirectional(
                    start: 16,
                    end: 16,
                    bottom: 14,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          label,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: context.textTheme.headlineSmall?.copyWith(
                            color: Colors.white,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 4),
                        DecoratedBox(
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: 0.88),
                            borderRadius: BorderRadius.circular(999),
                          ),
                          child: Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
                            child: Text(
                              countLabel,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: context.textTheme.labelMedium?.copyWith(
                                color: Colors.black,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );

    if (!isActionable) {
      return card;
    }

    return Semantics(
      button: true,
      enabled: true,
      label: _cardSemanticsLabel(context, countLabel, actionLabel),
      onTap: onTap,
      child: ExcludeSemantics(child: card),
    );
  }
}
