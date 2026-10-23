import 'package:collection/collection.dart';
import 'package:diacritic/diacritic.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/search/search.providers.dart';
import 'package:immich_mobile/gallery/search/search_options.model.dart';
import 'package:immich_mobile/gallery/search/search_state.model.dart';
import 'package:immich_mobile/gallery/search/search_ui.providers.dart';
import 'package:immich_mobile/gallery/search/widgets/search_avatar.widget.dart';
import 'package:immich_mobile/gallery/search/widgets/search_chip_row.widget.dart';
import 'package:immich_mobile/gallery/search/widgets/search_header.widget.dart' show personRefOf;
import 'package:immich_mobile/gallery/search/widgets/search_labels.dart';
import 'package:immich_mobile/generated/translations.g.dart';

// The chip sheets (specs/2026-10-23-mobile-search-redesign-design.md, "The chip sheets"). Each opens over the results
// from options already loaded, applies every selection at once (the results behind it update), and closes with
// "Show N photos" or a tap outside. Nothing here requests anything: the lists are the narrowed options, filtered on the
// device as you type.

/// Opens [chip]'s sheet. The sheet lives in the navigator's overlay, so it reads the root search providers: the Photos
/// screen's. A screen with its own scoped search (Slice 6) must hand its scope to the sheet.
Future<void> showSearchChipSheet(BuildContext context, SearchMainChip chip) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  useSafeArea: true,
  showDragHandle: true,
  builder: (_) => switch (chip) {
    SearchMainChip.people => const _PeopleSheet(),
    SearchMainChip.when => const _WhenSheet(),
    SearchMainChip.places => const _PlacesSheet(),
    SearchMainChip.tags => const _TagsSheet(),
  },
);

String _fold(String value) => removeDiacritics(value).toLowerCase().trim();

class SearchSheetScaffold extends ConsumerWidget {
  final String title;
  final double heightFactor;
  final VoidCallback? onClear;
  final Widget? search;
  final Widget body;

  const SearchSheetScaffold({
    super.key,
    required this.title,
    required this.body,
    this.heightFactor = 0.66,
    this.onClear,
    this.search,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final media = MediaQuery.of(context);
    final keyboard = media.viewInsets.bottom;
    // Grows with the keyboard so the list and the button stay above it.
    final height = (media.size.height * heightFactor + keyboard).clamp(0.0, media.size.height - media.padding.top);
    final total =
        ref.watch(searchResultsProvider.select((r) => r.total)) ??
        ref.watch(searchOptionsProvider.select((o) => o.total));
    return SizedBox(
      height: height,
      child: Padding(
        padding: EdgeInsets.only(bottom: keyboard),
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 8, 4),
              child: Row(
                children: [
                  Expanded(
                    child: Text(title, style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600)),
                  ),
                  TextButton(key: const Key('search-sheet-clear'), onPressed: onClear, child: Text(context.t.clear)),
                ],
              ),
            ),
            if (search != null) Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 8), child: search),
            Expanded(child: body),
            const Divider(height: 1),
            Padding(
              padding: EdgeInsets.fromLTRB(16, 10, 16, 10 + (keyboard > 0 ? 0 : media.padding.bottom)),
              child: SizedBox(
                width: double.infinity,
                child: FilledButton(
                  key: const Key('search-sheet-show'),
                  onPressed: () => Navigator.of(context).pop(),
                  child: Text(
                    total == null
                        ? context.t.photos
                        : total == 0
                        ? context.t.search_mode_no_matches
                        : context.t.search_mode_show_photos(count: total),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SheetSearchField extends StatelessWidget {
  final String hint;
  final ValueChanged<String> onChanged;

  const _SheetSearchField({required this.hint, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    // No autofocus: the keyboard opens only when the field is tapped.
    return TextField(
      key: const Key('search-sheet-field'),
      onChanged: onChanged,
      autocorrect: false,
      decoration: InputDecoration(
        isDense: true,
        hintText: hint,
        prefixIcon: const Icon(Icons.search_rounded, size: 20),
        filled: true,
        fillColor: scheme.surfaceContainerHigh,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
      ),
    );
  }
}

class SearchSheetHint extends StatelessWidget {
  final String text;

  const SearchSheetHint(this.text, {super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 10, 20, 6),
      child: Text(text, style: theme.textTheme.labelMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
    );
  }
}

/// Placeholder shapes while a list is still on its way: no spinner.
class SearchSheetSkeleton extends StatelessWidget {
  final bool round;

  const SearchSheetSkeleton({super.key, this.round = false});

  static const count = 8;

  @override
  Widget build(BuildContext context) {
    final color = Theme.of(context).colorScheme.surfaceContainerHighest;
    return Padding(
      key: const Key('search-sheet-skeleton'),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Wrap(
        spacing: 16,
        runSpacing: 16,
        children: [
          for (var i = 0; i < count; i++)
            Container(
              width: round ? 54 : 96,
              height: round ? 54 : 30,
              decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(round ? 27 : 15)),
            ),
        ],
      ),
    );
  }
}

class SearchOptionCount extends StatelessWidget {
  final int? count;

  const SearchOptionCount(this.count, {super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    if (count == null) {
      return const SizedBox.shrink();
    }
    return Text(
      formatSearchCount(context, count!),
      style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
    );
  }
}

// ---------------------------------------------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------------------------------------------

class _PeopleSheet extends ConsumerStatefulWidget {
  const _PeopleSheet();

  @override
  ConsumerState<_PeopleSheet> createState() => _PeopleSheetState();
}

class _PeopleSheetState extends ConsumerState<_PeopleSheet> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final selected = ref.watch(searchStateProvider.select((s) => s.filters.people));
    final people = ref.watch(searchOptionsProvider.select((o) => o.people));
    final recentIds = ref.watch(searchRecentPersonIdsProvider).valueOrNull ?? const <String>[];
    final notifier = ref.read(searchStateProvider.notifier);
    final selectedIds = {for (final p in selected) p.filterId};
    final others = (people ?? const <SearchPersonOption>[]).where((p) => !selectedIds.contains(p.filterId)).toList();
    final query = _fold(_query);
    final matches = query.isEmpty ? others : others.where((p) => _fold(p.name).contains(query)).toList();
    final recent = query.isEmpty
        ? [
            for (final id in recentIds)
              ?others.firstWhereOrNull((p) => searchPersonProfileId(p.filterId, p.profileId) == id),
          ]
        : const <SearchPersonOption>[];

    return SearchSheetScaffold(
      title: context.t.people,
      onClear: selected.isEmpty ? null : notifier.clearPeople,
      search: _SheetSearchField(
        hint: context.t.filter_search_people,
        onChanged: (value) => setState(() => _query = value),
      ),
      body: CustomScrollView(
        slivers: [
          if (selected.isNotEmpty) ...[
            SliverToBoxAdapter(child: SearchSheetHint(context.t.search_mode_people_selected_hint)),
            SliverPadding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              sliver: SliverGrid.count(
                crossAxisCount: 4,
                childAspectRatio: 0.78,
                children: [
                  for (final person in selected)
                    _PersonTile(
                      key: Key('search-sheet-selected-${person.filterId}'),
                      avatar: SearchPersonAvatar.selected(person: person),
                      name: person.name,
                      selected: true,
                      onTap: () => notifier.togglePerson(person),
                    ),
                ],
              ),
            ),
          ],
          if (recent.isNotEmpty) ...[
            SliverToBoxAdapter(child: SearchSheetHint(context.t.recent)),
            SliverToBoxAdapter(
              child: SizedBox(
                key: const Key('search-sheet-recent'),
                height: 96,
                child: ListView(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  children: [
                    for (final person in recent)
                      SizedBox(
                        width: 80,
                        child: _PersonTile(
                          key: Key('search-sheet-recent-${person.filterId}'),
                          avatar: SearchPersonAvatar(person: person, radius: 24),
                          name: person.name,
                          count: person.count,
                          onTap: () => notifier.togglePerson(personRefOf(person)),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ],
          SliverToBoxAdapter(
            child: SearchSheetHint(
              query.isNotEmpty
                  ? context.t.search_mode_matches
                  : selected.isNotEmpty
                  ? context.t.search_mode_people_also_in
                  : context.t.search_mode_people_most_photographed,
            ),
          ),
          if (people == null)
            const SliverToBoxAdapter(child: SearchSheetSkeleton(round: true))
          else if (matches.isEmpty)
            SliverToBoxAdapter(child: SearchSheetHint(context.t.search_mode_people_none))
          else
            SliverPadding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              sliver: SliverGrid.builder(
                gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: 4,
                  childAspectRatio: 0.72,
                ),
                itemCount: matches.length,
                itemBuilder: (_, index) {
                  final person = matches[index];
                  return _PersonTile(
                    key: Key('search-sheet-person-${person.filterId}'),
                    avatar: SearchPersonAvatar(person: person),
                    name: person.name,
                    count: person.count,
                    onTap: () => notifier.togglePerson(personRefOf(person)),
                  );
                },
              ),
            ),
          const SliverPadding(padding: EdgeInsets.only(bottom: 12)),
        ],
      ),
    );
  }
}

class _PersonTile extends StatelessWidget {
  final Widget avatar;
  final String name;
  final int? count;
  final bool selected;
  final VoidCallback onTap;

  const _PersonTile({
    super.key,
    required this.avatar,
    required this.name,
    this.count,
    this.selected = false,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            DecoratedBox(
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(color: selected ? theme.colorScheme.primary : Colors.transparent, width: 3),
              ),
              child: Padding(padding: const EdgeInsets.all(2), child: avatar),
            ),
            const SizedBox(height: 4),
            Text(
              name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: theme.textTheme.labelMedium,
            ),
            SearchOptionCount(count),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------------------------------------------
// When
// ---------------------------------------------------------------------------------------------------------------

class _WhenSheet extends ConsumerStatefulWidget {
  const _WhenSheet();

  @override
  ConsumerState<_WhenSheet> createState() => _WhenSheetState();
}

class _WhenSheetState extends ConsumerState<_WhenSheet> {
  final Set<int> _expanded = {};

  @override
  void initState() {
    super.initState();
    // The selected period's year opens with its months.
    switch (ref.read(searchStateProvider).filters.date) {
      case SearchDateYear(:final year):
        _expanded.add(year);
      case SearchDateMonth(:final year):
        _expanded.add(year);
      default:
        break;
    }
  }

  @override
  Widget build(BuildContext context) {
    final date = ref.watch(searchStateProvider.select((s) => s.filters.date));
    final months = ref.watch(searchOptionsProvider.select((o) => o.months));
    final notifier = ref.read(searchStateProvider.notifier);
    final years = <int, int>{};
    final monthCounts = <(int, int), int>{};
    for (final m in months ?? const <SearchMonthCount>[]) {
      years[m.year] = (years[m.year] ?? 0) + m.count;
      monthCounts[(m.year, m.month)] = (monthCounts[(m.year, m.month)] ?? 0) + m.count;
    }
    final newestFirst = years.keys.toList()..sort((a, b) => b.compareTo(a));
    void toggle(SearchDate value) => notifier.setDate(date == value ? null : value);

    return SearchSheetScaffold(
      title: context.t.when$,
      heightFactor: 0.88,
      onClear: date == null || date is SearchDateCustom ? null : () => notifier.setDate(null),
      body: ListView(
        children: [
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            child: Row(
              children: [
                for (final range in SearchQuickRange.values)
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: ChoiceChip(
                      key: Key('search-when-quick-${range.name}'),
                      label: Text(searchDateLabel(context, SearchDate.quickRange(range))),
                      selected: date == SearchDate.quickRange(range),
                      onSelected: (_) => toggle(SearchDate.quickRange(range)),
                    ),
                  ),
              ],
            ),
          ),
          SearchSheetHint(context.t.search_mode_when_hint),
          if (months == null)
            const SearchSheetSkeleton()
          else
            for (final year in newestFirst) ...[
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                child: Row(
                  children: [
                    ChoiceChip(
                      key: Key('search-when-year-$year'),
                      label: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [Text('$year'), const SizedBox(width: 6), SearchOptionCount(years[year])],
                      ),
                      selected: date == SearchDate.year(year),
                      onSelected: (_) => toggle(SearchDate.year(year)),
                    ),
                    const SizedBox(width: 8),
                    TextButton.icon(
                      key: Key('search-when-months-$year'),
                      onPressed: () =>
                          setState(() => _expanded.contains(year) ? _expanded.remove(year) : _expanded.add(year)),
                      icon: Icon(
                        _expanded.contains(year) ? Icons.arrow_drop_up_rounded : Icons.arrow_drop_down_rounded,
                      ),
                      label: Text(context.t.search_mode_when_months),
                    ),
                  ],
                ),
              ),
              if (_expanded.contains(year))
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                  child: GridView.count(
                    crossAxisCount: 6,
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    mainAxisSpacing: 6,
                    crossAxisSpacing: 6,
                    childAspectRatio: 1.6,
                    children: [
                      for (var month = 1; month <= 12; month++)
                        _MonthCell(
                          key: Key('search-when-month-$year-$month'),
                          label: searchShortMonth(context, month),
                          selected: date == SearchDate.month(year, month),
                          // Months with no photos are greyed.
                          enabled: (monthCounts[(year, month)] ?? 0) > 0,
                          onTap: () => toggle(SearchDate.month(year, month)),
                        ),
                    ],
                  ),
                ),
            ],
          const SizedBox(height: 12),
        ],
      ),
    );
  }
}

class _MonthCell extends StatelessWidget {
  final String label;
  final bool selected;
  final bool enabled;
  final VoidCallback onTap;

  const _MonthCell({
    super.key,
    required this.label,
    required this.selected,
    required this.enabled,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return Semantics(
      button: true,
      enabled: enabled,
      selected: selected,
      child: Opacity(
        opacity: enabled ? 1 : 0.38,
        child: Material(
          color: selected ? scheme.primary : Colors.transparent,
          shape: StadiumBorder(side: BorderSide(color: selected ? scheme.primary : scheme.outlineVariant)),
          child: InkWell(
            customBorder: const StadiumBorder(),
            onTap: enabled ? onTap : null,
            child: Center(
              child: Text(
                label,
                style: theme.textTheme.labelMedium?.copyWith(color: selected ? scheme.onPrimary : scheme.onSurface),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Places
// ---------------------------------------------------------------------------------------------------------------

class _PlacesSheet extends ConsumerStatefulWidget {
  const _PlacesSheet();

  @override
  ConsumerState<_PlacesSheet> createState() => _PlacesSheetState();
}

class _PlacesSheetState extends ConsumerState<_PlacesSheet> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final place = ref.watch(searchStateProvider.select((s) => s.filters.place));
    final countries = ref.watch(searchOptionsProvider.select((o) => o.countries));
    final notifier = ref.read(searchStateProvider.notifier);
    final query = _fold(_query);
    bool hit(String name) => query.isEmpty || _fold(name).contains(query);

    final rows = <Widget>[];
    for (final country in countries ?? const <SearchCountryOption>[]) {
      final wholeCountry = hit(country.country);
      final cities = [
        for (final city in country.cities ?? const <SearchCityOption>[])
          if (wholeCountry || hit(city.city)) city,
      ];
      if (!wholeCountry && cities.isEmpty) {
        continue;
      }
      final countrySelected = place?.country == country.country && place?.city == null;
      rows.add(
        _PlaceRow(
          key: Key('search-place-country-${country.country}'),
          icon: Icons.public_rounded,
          title: country.country,
          subtitle: context.t.search_mode_place_all_of(country: country.country),
          count: country.count,
          selected: countrySelected,
          onTap: () => notifier.setPlace(countrySelected ? null : SearchPlace(country: country.country)),
        ),
      );
      for (final city in cities) {
        final citySelected = place?.country == country.country && place?.city == city.city;
        rows.add(
          _PlaceRow(
            key: Key('search-place-city-${city.city}'),
            icon: Icons.place_outlined,
            title: city.city,
            count: city.count,
            indent: true,
            selected: citySelected,
            onTap: () =>
                notifier.setPlace(citySelected ? null : SearchPlace(country: country.country, city: city.city)),
          ),
        );
      }
    }

    return SearchSheetScaffold(
      title: context.t.places,
      onClear: place == null ? null : () => notifier.setPlace(null),
      search: _SheetSearchField(
        hint: context.t.filter_sheet_picker_search_places_hint,
        onChanged: (value) => setState(() => _query = value),
      ),
      body: countries == null
          ? const SearchSheetSkeleton()
          : rows.isEmpty
          ? SearchSheetHint(context.t.search_mode_places_none)
          : ListView(children: rows),
    );
  }
}

class _PlaceRow extends StatelessWidget {
  final IconData icon;
  final String title;
  final String? subtitle;
  final int? count;
  final bool indent;
  final bool selected;
  final VoidCallback onTap;

  const _PlaceRow({
    super.key,
    required this.icon,
    required this.title,
    this.subtitle,
    this.count,
    this.indent = false,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ListTile(
      dense: true,
      selected: selected,
      selectedTileColor: theme.colorScheme.secondaryContainer,
      contentPadding: EdgeInsets.only(left: indent ? 40 : 20, right: 20),
      leading: Icon(icon, size: 20),
      title: Text(title, style: indent ? null : const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: subtitle == null ? null : Text(subtitle!),
      trailing: SearchOptionCount(count),
      onTap: onTap,
    );
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------------------------------------------

class _TagsSheet extends ConsumerStatefulWidget {
  const _TagsSheet();

  @override
  ConsumerState<_TagsSheet> createState() => _TagsSheetState();
}

class _TagsSheetState extends ConsumerState<_TagsSheet> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final selected = ref.watch(searchStateProvider.select((s) => s.filters.tags));
    final queryMode = ref.watch(searchStateProvider.select((s) => s.isQueryMode));
    final tags = ref.watch(searchOptionsProvider.select((o) => o.tags));
    final notifier = ref.read(searchStateProvider.notifier);
    final selectedIds = {for (final t in selected) t.id};
    final query = _fold(_query);
    final others = [
      for (final tag in tags ?? const <SearchTagOption>[])
        if (!selectedIds.contains(tag.id) && (query.isEmpty || _fold(tag.value).contains(query))) tag,
    ];

    return SearchSheetScaffold(
      title: context.t.tags,
      onClear: selected.isEmpty ? null : notifier.clearTags,
      search: _SheetSearchField(
        hint: context.t.filter_sheet_picker_search_tags_hint,
        onChanged: (value) => setState(() => _query = value),
      ),
      body: ListView(
        children: [
          // Browse results match any of the tags (/timeline/buckets), smart search all of them (/search/smart).
          SearchSheetHint(queryMode ? context.t.search_mode_tags_all_hint : context.t.search_mode_tags_any_hint),
          if (selected.isNotEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
              child: Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final tag in selected)
                    InputChip(
                      key: Key('search-tag-selected-${tag.id}'),
                      label: Text('#${tag.value}'),
                      selected: true,
                      onDeleted: () => notifier.toggleTag(tag),
                      onPressed: () => notifier.toggleTag(tag),
                    ),
                ],
              ),
            ),
          if (tags == null)
            const SearchSheetSkeleton()
          else if (others.isEmpty)
            SearchSheetHint(context.t.search_mode_tags_none)
          else
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final tag in others)
                    ActionChip(
                      key: Key('search-tag-${tag.id}'),
                      label: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [Text('#${tag.value}'), const SizedBox(width: 6), SearchOptionCount(tag.count)],
                      ),
                      onPressed: () => notifier.toggleTag(SearchTagRef(id: tag.id, value: tag.value)),
                    ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
