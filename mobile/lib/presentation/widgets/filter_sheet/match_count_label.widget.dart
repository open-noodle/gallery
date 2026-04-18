import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/photos_filter/filter_count.provider.dart';

/// Live-region label for the current match count.
///
/// `photosFilterCountProvider` is a placeholder page-1 count (PR 1.1 comment).
class MatchCountLabel extends ConsumerWidget {
  final TextStyle? style;
  const MatchCountLabel({super.key, this.style});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final count = ref.watch(photosFilterCountProvider);
    final label = count.when(
      data: _formatPlural,
      loading: () => 'filter_sheet_match_count_loading'.tr(),
      error: (_, _) => 'filter_sheet_match_count_loading'.tr(),
    );
    return Semantics(
      liveRegion: true,
      label: label,
      child: Text(
        label,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style:
            style ??
            Theme.of(context).textTheme.labelLarge?.copyWith(fontFeatures: const [FontFeature.tabularFigures()]),
      ),
    );
  }

  String _formatPlural(int count) {
    // Pick the zero variant directly for count == 0. `.tr()` on a plural root
    // key returns the variant Map; `.plural()` hits Localization._locale which
    // is a late field that isn't set without an EasyLocalization ancestor
    // (e.g. in unit tests). Looking up the nested `.zero` leaf sidesteps both.
    if (count == 0) return 'filter_sheet_match_count_photos.zero'.tr();
    final formatted = NumberFormat.decimalPattern(Intl.getCurrentLocale()).format(count);
    return 'filter_sheet_match_count_photos'.plural(count, args: [formatted]);
  }
}
