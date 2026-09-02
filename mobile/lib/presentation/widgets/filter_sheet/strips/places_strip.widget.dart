import 'package:auto_route/auto_route.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/strips/strip_scaffold.widget.dart';
import 'package:immich_mobile/providers/photos_filter/filter_debounce.provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_suggestions.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:immich_mobile/routing/router.dart';

/// Strip cap: at most this many country tiles render before a trailing "+N"
/// tile takes over, opening the full-screen picker instead of an unbounded
/// ListView.
const int _kStripCap = 10;

class PlacesStrip extends ConsumerWidget {
  const PlacesStrip({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final filter = ref.watch(photosFilterDebouncedProvider);
    final async = ref.watch(photosFilterSuggestionsProvider(filter));
    final items = async.whenData((s) => s.countries);
    final suggestions = async.valueOrNull;
    final selectedPresence = ref.watch(photosFilterProvider.select((f) => f.location.locationPresence));

    // Location presence ("no GPS" / "coordinates but no name") is a member of the same
    // location group as country/city — mutually exclusive with them, ONE chip. Offered
    // ahead of the country tiles, gated on the server flag OR the value already being
    // selected (so a selection made under a different filter combo stays reachable here).
    final presenceEntries = <_PresenceEntry>[
      if ((suggestions?.hasNoGpsAssets ?? false) || selectedPresence == 'noGps')
        const _PresenceEntry('noGps', 'filter_location_no_gps'),
      if ((suggestions?.hasNoPlaceNameAssets ?? false) || selectedPresence == 'noPlaceName')
        const _PresenceEntry('noPlaceName', 'filter_location_no_place_name'),
    ];

    return StripScaffold(
      titleKey: 'filter_sheet_places',
      items: items,
      height: 84,
      // Zero countries must not hide the strip: a fully-unlocated library is the headline
      // case for this filter, and it would otherwise have no route to it at all (the "+N"
      // tile that opens the full picker is itself gated on there being country overflow).
      hasExtraEntries: presenceEntries.isNotEmpty,
      onRetry: () => ref.invalidate(photosFilterSuggestionsProvider(filter)),
      childBuilder: (data) {
        final countries = data.cast<String>();
        final shown = countries.take(_kStripCap).toList();
        final overflow = countries.length - shown.length;
        return ListView.separated(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 20),
          itemCount: presenceEntries.length + shown.length + (overflow > 0 ? 1 : 0),
          separatorBuilder: (_, _) => const SizedBox(width: 10),
          itemBuilder: (ctx, i) {
            if (i < presenceEntries.length) {
              return _PresenceChip(entry: presenceEntries[i]);
            }
            final j = i - presenceEntries.length;
            return j < shown.length ? _PlaceTile(country: shown[j]) : _MorePlaceTile(count: overflow);
          },
        );
      },
    );
  }
}

/// One entry of the location-presence group: `value` is the wire value sent as
/// `locationPresence` ('noGps' / 'noPlaceName'), `labelKey` the i18n key for its chip label.
class _PresenceEntry {
  final String value;
  final String labelKey;
  const _PresenceEntry(this.value, this.labelKey);
}

class _PresenceChip extends ConsumerWidget {
  final _PresenceEntry entry;
  const _PresenceChip({required this.entry});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final selected = ref.watch(photosFilterProvider.select((f) => f.location.locationPresence == entry.value));
    return Center(
      child: FilterChip(
        key: Key('places-presence-${entry.value}'),
        label: Text(entry.labelKey.tr()),
        selected: selected,
        onSelected: (_) {
          HapticFeedback.selectionClick();
          // Selecting/clearing a presence entry replaces the whole location group — a fresh
          // SearchLocationFilter, never copyWith (copyWith's `x ?? this.x` can't clear a field).
          ref
              .read(photosFilterProvider.notifier)
              .setLocation(selected ? null : SearchLocationFilter(locationPresence: entry.value));
        },
      ),
    );
  }
}

class _MorePlaceTile extends StatelessWidget {
  final int count;
  const _MorePlaceTile({required this.count});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return SizedBox(
      key: const Key('places-strip-more'),
      width: 104,
      height: 72,
      child: Material(
        color: theme.colorScheme.surfaceContainerHigh,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: () {
            HapticFeedback.selectionClick();
            context.pushRoute(const PlacesPickerRoute());
          },
          child: Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  '+$count',
                  style: theme.textTheme.titleMedium?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  'all'.tr(),
                  textAlign: TextAlign.center,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.labelSmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _PlaceTile extends ConsumerWidget {
  final String country;
  const _PlaceTile({required this.country});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final isSelected = ref.watch(photosFilterProvider.select((f) => f.location.country == country));
    return SizedBox(
      width: 104,
      height: 72,
      child: Material(
        key: const Key('place-tile'),
        color: theme.colorScheme.surfaceContainerHigh,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
          side: isSelected ? BorderSide(color: theme.colorScheme.primary, width: 2) : BorderSide.none,
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: () {
            HapticFeedback.selectionClick();
            if (isSelected) {
              ref.read(photosFilterProvider.notifier).setLocation(null);
            } else {
              ref.read(photosFilterProvider.notifier).setLocation(SearchLocationFilter(country: country));
            }
          },
          child: Stack(
            children: [
              Positioned.fill(
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                      colors: [Colors.transparent, Colors.black.withValues(alpha: 0.32)],
                    ),
                  ),
                ),
              ),
              Positioned(
                left: 10,
                right: 10,
                bottom: 8,
                child: Text(
                  country,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.labelLarge?.copyWith(
                    color: isSelected ? theme.colorScheme.primary : theme.colorScheme.onSurface,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
