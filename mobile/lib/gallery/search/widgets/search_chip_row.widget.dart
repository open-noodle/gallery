import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/search/search.providers.dart';
import 'package:immich_mobile/gallery/search/search_options.model.dart';
import 'package:immich_mobile/gallery/search/search_scope.dart';
import 'package:immich_mobile/gallery/search/search_state.model.dart';
import 'package:immich_mobile/gallery/search/search_ui.providers.dart';
import 'package:immich_mobile/gallery/search/widgets/search_filters_sheet.widget.dart';
import 'package:immich_mobile/gallery/search/widgets/search_labels.dart';
import 'package:immich_mobile/gallery/search/widgets/search_sheets.widget.dart';
import 'package:immich_mobile/generated/translations.g.dart';

// The chip row (specs/2026-10-23-mobile-search-redesign-design.md, "The chip row"): People, When, Places, Tags, then
// the active extra filters with ✕, then ⚙ Filters with its badge, then Clear all from two active filters.
//
// #910: a main chip is hidden when its dimension is empty for the whole scope, and greyed (not tappable) when it is
// empty only because of the other active filters. An active chip always shows, so it can be changed or cleared.

enum SearchMainChip { people, when, places, tags }

class SearchChipRow extends ConsumerWidget {
  const SearchChipRow({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scope = ref.watch(searchScopeProvider);
    final state = ref.watch(searchStateProvider);
    final options = ref.watch(searchOptionsProvider);
    final scopeAvailability = searchScopeAvailability(ref, state, options);
    final filters = state.filters;
    final extras = activeExtraFilters(filters, scope);

    Widget? main(SearchMainChip chip) {
      final (section, active, label) = switch (chip) {
        SearchMainChip.people => (
          SearchSection.people,
          filters.people.isNotEmpty,
          filters.people.isEmpty ? context.t.people : searchPeopleLabel(filters.people),
        ),
        SearchMainChip.when => (
          SearchSection.when,
          filters.date != null && filters.date is! SearchDateCustom,
          filters.date == null || filters.date is SearchDateCustom
              ? context.t.when$
              : searchDateLabel(context, filters.date!),
        ),
        SearchMainChip.places => (
          SearchSection.places,
          filters.place != null,
          filters.place == null ? context.t.places : searchPlaceLabel(filters.place!),
        ),
        SearchMainChip.tags => (
          SearchSection.tags,
          filters.tags.isNotEmpty,
          filters.tags.isEmpty ? context.t.tags : searchTagsLabel(filters.tags),
        ),
      };
      if (scope.fixedSections.contains(section) || !options.facetsSupported) {
        return null;
      }
      if (!active && scopeAvailability != null && !_has(chip, scopeAvailability)) {
        return null;
      }
      final current = options.availability;
      // A date range (Filters sheet) is a When filter too: When stays tappable to replace it, even when the range
      // leaves nothing (#910 §4.4 rule 1).
      final dateFiltered = chip == SearchMainChip.when && filters.date != null;
      final possible = active || dateFiltered || current == null || _has(chip, current);
      return _SearchChip(
        key: Key('search-chip-${chip.name}'),
        label: label,
        active: active,
        enabled: possible,
        trailing: Icons.arrow_drop_down_rounded,
        onTap: () => showSearchChipSheet(context, chip),
      );
    }

    final chips = <Widget>[
      for (final chip in SearchMainChip.values) ?main(chip),
      for (final extra in extras)
        _SearchChip(
          key: Key('search-extra-chip-${extra.name}'),
          label: searchExtraLabel(context, extra, filters),
          active: true,
          leading: searchExtraIcon(extra, filters),
          trailing: Icons.close_rounded,
          semanticsLabel: context.t.filter_remove_chip(label: searchExtraLabel(context, extra, filters)),
          onTap: () => clearExtraFilter(ref, extra),
        ),
      _SearchChip(
        key: const Key('search-chip-filters'),
        label: context.t.filters,
        leading: Icons.tune_rounded,
        badge: extras.isEmpty ? null : extras.length,
        onTap: () => showSearchFiltersSheet(context),
      ),
      if (activeFilterCount(state, scope) >= 2)
        _SearchChip(
          key: const Key('search-chip-clear-all'),
          label: context.t.clear_all,
          plain: true,
          onTap: () => ref.read(searchStateProvider.notifier).reset(),
        ),
    ];

    // Few chips: all are built, so one past the right edge is there to scroll to.
    return SingleChildScrollView(
      key: const Key('search-chip-row'),
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      child: Row(
        children: [
          for (final (index, chip) in chips.indexed) ...[if (index > 0) const SizedBox(width: 8), chip],
        ],
      ),
    );
  }

  static bool _has(SearchMainChip chip, SearchAvailability availability) => switch (chip) {
    SearchMainChip.people => availability.hasPeople,
    SearchMainChip.when => availability.hasAssets,
    SearchMainChip.places => availability.hasPlaces,
    SearchMainChip.tags => availability.hasTags,
  };
}

class _SearchChip extends StatelessWidget {
  final String label;
  final bool active;
  final bool enabled;
  final bool plain;
  final IconData? leading;
  final IconData? trailing;
  final int? badge;
  final String? semanticsLabel;
  final VoidCallback onTap;

  const _SearchChip({
    super.key,
    required this.label,
    this.active = false,
    this.enabled = true,
    this.plain = false,
    this.leading,
    this.trailing,
    this.badge,
    this.semanticsLabel,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final foreground = active
        ? scheme.onSecondaryContainer
        : plain
        ? scheme.primary
        : scheme.onSurface;
    final chip = Material(
      color: active ? scheme.secondaryContainer : Colors.transparent,
      shape: StadiumBorder(side: active || plain ? BorderSide.none : BorderSide(color: scheme.outlineVariant)),
      child: InkWell(
        customBorder: const StadiumBorder(),
        onTap: enabled ? onTap : null,
        child: Padding(
          padding: EdgeInsets.only(left: leading == null ? 14 : 10, right: trailing == null ? 14 : 8),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (leading != null) ...[Icon(leading, size: 18, color: foreground), const SizedBox(width: 6)],
              ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 180),
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.labelLarge?.copyWith(
                    color: foreground,
                    fontWeight: active ? FontWeight.w600 : FontWeight.w500,
                  ),
                ),
              ),
              if (badge != null) ...[
                const SizedBox(width: 6),
                Container(
                  key: const Key('search-chip-filters-badge'),
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                  decoration: BoxDecoration(color: scheme.primary, borderRadius: BorderRadius.circular(999)),
                  child: Text('$badge', style: theme.textTheme.labelSmall?.copyWith(color: scheme.onPrimary)),
                ),
              ],
              if (trailing != null) ...[const SizedBox(width: 2), Icon(trailing, size: 18, color: foreground)],
            ],
          ),
        ),
      ),
    );
    return Semantics(
      button: true,
      enabled: enabled,
      label: semanticsLabel,
      child: Opacity(opacity: enabled ? 1 : 0.38, child: chip),
    );
  }
}
