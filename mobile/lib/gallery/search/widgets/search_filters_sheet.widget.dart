import 'package:collection/collection.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/search/search.providers.dart';
import 'package:immich_mobile/gallery/search/search_filter_prefs.dart';
import 'package:immich_mobile/gallery/search/search_options.model.dart';
import 'package:immich_mobile/gallery/search/search_scope.dart';
import 'package:immich_mobile/gallery/search/search_state.model.dart';
import 'package:immich_mobile/gallery/search/search_ui.providers.dart';
import 'package:immich_mobile/gallery/search/widgets/search_sheets.widget.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:intl/intl.dart';

// The Filters sheet (specs/2026-10-23-mobile-search-redesign-design.md, "The Filters sheet (⚙)"): every filter beyond
// People, When, Places and Tags, in one tall sheet. Like the chip sheets it applies each change at once (the results
// behind it update) and reads only options already loaded.
//
// #910 per section (searchSectionState): hidden when empty for the whole scope or fixed by the screen, greyed when empty
// only because of the other filters. Never per option: all five stars and all three media options always show.

/// Opens the Filters sheet over the screen whose chip row [context] belongs to (see showSearchSheet).
Future<void> showSearchFiltersSheet(BuildContext context) =>
    showSearchSheet(context, (_) => const SearchFiltersSheet());

/// One section of the sheet. [title] makes it collapsible by tapping the title; the switch rows have none.
class _SectionSpec {
  final String name;
  final String label;
  final String? title;
  final String? trailing;
  final bool active;
  final SearchSectionState state;
  final Widget Function() body;

  const _SectionSpec({
    required this.name,
    required this.label,
    required this.active,
    required this.state,
    required this.body,
    this.title,
    this.trailing,
  });
}

class SearchFiltersSheet extends ConsumerWidget {
  const SearchFiltersSheet({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scope = ref.watch(searchScopeProvider);
    final state = ref.watch(searchStateProvider);
    final options = ref.watch(searchOptionsProvider);
    final prefs = ref.watch(searchFilterSectionPrefsProvider);
    final scopeAvailability = searchScopeAvailability(ref, state, options);
    final filters = state.filters;
    final extras = activeExtraFilters(filters, scope);

    SearchSectionState stateOf(SearchSection section) => searchSectionState(
      section,
      scope: scope,
      filters: filters,
      scopeAvailability: scopeAvailability,
      current: options.availability,
    );

    final notifier = ref.read(searchStateProvider.notifier);
    final minRating = filters.minRating;
    final text = filters.text;
    final specs = <_SectionSpec>[
      _SectionSpec(
        name: SearchSection.favorites.name,
        label: context.t.search_mode_favorites_only,
        active: filters.favoritesOnly,
        state: stateOf(SearchSection.favorites),
        body: () => _Switch(
          key: const Key('search-filter-favorites'),
          icon: Icons.favorite_rounded,
          label: context.t.search_mode_favorites_only,
          value: filters.favoritesOnly,
          onChanged: notifier.setFavoritesOnly,
        ),
      ),
      _SectionSpec(
        name: SearchSection.mediaType.name,
        label: context.t.search_mode_photo_or_video,
        title: context.t.search_mode_photo_or_video,
        active: filters.mediaType != SearchMediaType.all,
        state: stateOf(SearchSection.mediaType),
        body: () => _MediaSection(filters: filters, options: options),
      ),
      _SectionSpec(
        name: SearchSection.rating.name,
        label: context.t.filter_sheet_deep_rating_section,
        title: context.t.filter_sheet_deep_rating_section,
        trailing: minRating == null
            ? context.t.filter_sheet_deep_rating_any
            : context.t.filter_chip_rating(rating: minRating),
        active: minRating != null,
        state: stateOf(SearchSection.rating),
        body: () => _RatingSection(minRating: minRating),
      ),
      _SectionSpec(
        name: SearchSection.camera.name,
        label: context.t.camera,
        title: context.t.camera,
        active: filters.camera != null,
        state: stateOf(SearchSection.camera),
        body: () => _CameraSection(camera: filters.camera, makes: options.cameras),
      ),
      _SectionSpec(
        name: SearchSection.albums.name,
        label: context.t.albums,
        title: context.t.albums,
        active: filters.album != SearchAlbumFilter.any,
        state: stateOf(SearchSection.albums),
        body: () => _AlbumSection(value: filters.album),
      ),
      _SectionSpec(
        name: SearchSection.text.name,
        label: context.t.filter_text,
        title: context.t.filter_text,
        active: text.ocr != null || text.fileName != null || text.description != null,
        state: stateOf(SearchSection.text),
        body: () => _TextSection(text: text, queryMode: state.isQueryMode),
      ),
      // A date range replaces a When selection and the reverse (one period at a time). Never hidden by #910: the
      // timeline's own section in #910 terms.
      _SectionSpec(
        name: 'dateRange',
        label: context.t.date_range,
        title: context.t.date_range,
        active: filters.date is SearchDateCustom,
        state: SearchSectionState.available,
        body: () => _DateRangeSection(date: filters.date),
      ),
      _SectionSpec(
        name: SearchSection.archived.name,
        label: context.t.search_mode_archived_only,
        active: filters.archivedOnly,
        state: stateOf(SearchSection.archived),
        body: () => _Switch(
          key: const Key('search-filter-archived'),
          icon: Icons.archive_outlined,
          label: context.t.search_mode_archived_only,
          value: filters.archivedOnly,
          onChanged: notifier.setArchivedOnly,
        ),
      ),
      _SectionSpec(
        name: SearchSection.untagged.name,
        label: context.t.search_mode_untagged_only,
        active: filters.untagged && filters.tags.isEmpty,
        state: stateOf(SearchSection.untagged),
        body: () => _Switch(
          key: const Key('search-filter-untagged'),
          icon: Icons.label_off_outlined,
          label: context.t.search_mode_untagged_only,
          value: filters.untagged && filters.tags.isEmpty,
          onChanged: notifier.setUntagged,
        ),
      ),
    ];
    // #910 hides a section for the whole scope; the cog hides one by choice, except while it holds an active filter,
    // which must stay reachable to be changed.
    final offered = [
      for (final spec in specs)
        if (spec.state != SearchSectionState.hidden) spec,
    ];
    final shown = [
      for (final spec in offered)
        if (spec.active || !prefs.hidden.contains(spec.name)) spec,
    ];

    return SearchSheetScaffold(
      title: context.t.filters,
      heightFactor: 0.88,
      actions: [
        IconButton(
          key: const Key('search-filters-manage'),
          tooltip: context.t.search_mode_manage_sections,
          icon: const Icon(Icons.settings_outlined),
          onPressed: () => _showManageSections(context, [for (final spec in offered) (spec.name, spec.label)]),
        ),
      ],
      onClear: extras.isEmpty
          ? null
          : () {
              for (final extra in extras) {
                clearExtraFilter(ref, extra);
              }
            },
      // A handful of sections: all built at once, so the ones further down are there to scroll to.
      body: SingleChildScrollView(
        key: const Key('search-filters-list'),
        padding: const EdgeInsets.only(bottom: 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (final (index, spec) in shown.indexed) ...[
              if (index > 0) const Divider(height: 1, indent: 16, endIndent: 16),
              _Section(
                key: Key('search-filter-section-${spec.name}'),
                spec: spec,
                collapsed: spec.title != null && prefs.collapsed.contains(spec.name),
                onToggle: () => ref.read(searchFilterSectionPrefsProvider.notifier).toggleCollapsed(spec.name),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// The cog's list: a checkbox per section the screen offers, saved at once.
Future<void> _showManageSections(BuildContext context, List<(String, String)> sections) => showDialog<void>(
  context: context,
  builder: (context) => Consumer(
    builder: (context, ref, _) {
      final hidden = ref.watch(searchFilterSectionPrefsProvider.select((prefs) => prefs.hidden));
      return AlertDialog(
        title: Text(context.t.search_mode_manage_sections),
        contentPadding: const EdgeInsets.symmetric(vertical: 12),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              for (final (name, label) in sections)
                CheckboxListTile(
                  key: Key('search-filters-manage-$name'),
                  title: Text(label),
                  value: !hidden.contains(name),
                  onChanged: (_) => ref.read(searchFilterSectionPrefsProvider.notifier).toggleHidden(name),
                ),
            ],
          ),
        ),
        actions: [
          TextButton(
            key: const Key('search-filters-manage-done'),
            onPressed: () => Navigator.of(context).pop(),
            child: Text(context.t.done),
          ),
        ],
      );
    },
  ),
);

class _Section extends StatelessWidget {
  final _SectionSpec spec;
  final bool collapsed;
  final VoidCallback onToggle;

  const _Section({super.key, required this.spec, required this.collapsed, required this.onToggle});

  @override
  Widget build(BuildContext context) {
    final greyed = spec.state == SearchSectionState.greyed;
    final title = spec.title;
    return Semantics(
      enabled: !greyed,
      child: IgnorePointer(
        ignoring: greyed,
        child: Opacity(
          opacity: greyed ? 0.38 : 1,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: title == null
                ? spec.body()
                : Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      _Title(
                        title,
                        name: spec.name,
                        trailing: spec.trailing,
                        collapsed: collapsed,
                        // Collapsed, the title still says a filter is set inside.
                        active: collapsed && spec.active,
                        onTap: onToggle,
                      ),
                      if (!collapsed) spec.body(),
                    ],
                  ),
          ),
        ),
      ),
    );
  }
}

class _Title extends StatelessWidget {
  final String text;
  final String name;
  final String? trailing;
  final bool collapsed;
  final bool active;
  final VoidCallback onTap;

  const _Title(
    this.text, {
    required this.name,
    required this.collapsed,
    required this.active,
    required this.onTap,
    this.trailing,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.colorScheme.onSurfaceVariant;
    return Semantics(
      button: true,
      expanded: !collapsed,
      child: InkWell(
        key: Key('search-filter-toggle-$name'),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 4, 12, 8),
          child: Row(
            children: [
              // The title and its dot take the free width, so the count and the arrow sit at the right edge.
              Expanded(
                child: Row(
                  children: [
                    Flexible(
                      child: Text(text, style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
                    ),
                    if (active)
                      Container(
                        key: Key('search-filter-active-$name'),
                        margin: const EdgeInsets.only(left: 8),
                        width: 8,
                        height: 8,
                        decoration: BoxDecoration(color: theme.colorScheme.primary, shape: BoxShape.circle),
                      ),
                  ],
                ),
              ),
              if (trailing != null) Text(trailing!, style: theme.textTheme.bodySmall?.copyWith(color: muted)),
              Icon(collapsed ? Icons.expand_more_rounded : Icons.expand_less_rounded, size: 22, color: muted),
            ],
          ),
        ),
      ),
    );
  }
}

class _Switch extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool value;
  final ValueChanged<bool> onChanged;

  const _Switch({super.key, required this.icon, required this.label, required this.value, required this.onChanged});

  @override
  Widget build(BuildContext context) => SwitchListTile(
    contentPadding: const EdgeInsets.symmetric(horizontal: 20),
    secondary: Icon(icon, size: 22),
    title: Text(label),
    value: value,
    onChanged: onChanged,
  );
}

/// One of a few mutually exclusive options, as one segmented row. Every option is always tappable.
class _Segmented<T> extends StatelessWidget {
  final String keyPrefix;
  final List<(T, String, int?)> options;
  final T selected;
  final ValueChanged<T> onSelected;
  final String Function(T value) name;

  const _Segmented({
    required this.keyPrefix,
    required this.options,
    required this.selected,
    required this.onSelected,
    required this.name,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Container(
        padding: const EdgeInsets.all(3),
        decoration: BoxDecoration(color: scheme.surfaceContainerHigh, borderRadius: BorderRadius.circular(12)),
        child: Row(
          children: [
            for (final (value, label, count) in options)
              Expanded(
                child: Semantics(
                  button: true,
                  selected: value == selected,
                  child: Material(
                    color: value == selected ? scheme.surface : Colors.transparent,
                    elevation: value == selected ? 1 : 0,
                    borderRadius: BorderRadius.circular(9),
                    child: InkWell(
                      key: Key('$keyPrefix-${name(value)}'),
                      borderRadius: BorderRadius.circular(9),
                      onTap: () => onSelected(value),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 4),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Flexible(
                              child: Text(
                                label,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: theme.textTheme.labelLarge?.copyWith(
                                  fontWeight: value == selected ? FontWeight.w600 : FontWeight.w500,
                                ),
                              ),
                            ),
                            if (count != null) ...[const SizedBox(width: 4), SearchOptionCount(count)],
                          ],
                        ),
                      ),
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

class _MediaSection extends ConsumerWidget {
  final SearchFilters filters;
  final SearchOptions options;

  const _MediaSection({required this.filters, required this.options});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    int? count(String type) => options.mediaTypes?.firstWhereOrNull((option) => option.type == type)?.count;
    // All three always show, none greyed: a result set of photos only still offers Videos (#910 §2.4).
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _Segmented<SearchMediaType>(
          keyPrefix: 'search-filter-media',
          name: (value) => value.name,
          selected: filters.mediaType,
          onSelected: ref.read(searchStateProvider.notifier).setMediaType,
          options: [
            (SearchMediaType.all, context.t.all, null),
            (SearchMediaType.image, context.t.filter_sheet_media_photos, count('IMAGE')),
            (SearchMediaType.video, context.t.filter_sheet_media_videos, count('VIDEO')),
          ],
        ),
      ],
    );
  }
}

class _RatingSection extends ConsumerWidget {
  final int? minRating;

  const _RatingSection({required this.minRating});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final notifier = ref.read(searchStateProvider.notifier);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Five stars meaning "at least N", by position: never filtered or greyed by the ratings the options report.
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: Row(
            children: [
              for (var star = 1; star <= 5; star++)
                IconButton(
                  key: Key('search-filter-star-$star'),
                  tooltip: context.t.filter_chip_rating(rating: star),
                  isSelected: minRating != null && star <= minRating!,
                  icon: Icon(Icons.star_outline_rounded, color: scheme.onSurfaceVariant),
                  selectedIcon: const Icon(Icons.star_rounded, color: Colors.amber),
                  iconSize: 32,
                  // Tapping the selected minimum again clears it.
                  onPressed: () => notifier.setMinRating(minRating == star ? null : star),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

class _CameraSection extends ConsumerStatefulWidget {
  final SearchCamera? camera;
  final List<SearchCameraMakeOption>? makes;

  const _CameraSection({required this.camera, required this.makes});

  @override
  ConsumerState<_CameraSection> createState() => _CameraSectionState();
}

class _CameraSectionState extends ConsumerState<_CameraSection> {
  /// Makes listed before "Show N more": a library with hundreds of makes would otherwise bury every section below.
  static const _folded = 5;

  final Set<String> _open = {};
  bool _showAll = false;

  @override
  void initState() {
    super.initState();
    final make = widget.camera?.make;
    if (make != null) {
      _open.add(make);
    }
  }

  @override
  Widget build(BuildContext context) {
    final camera = widget.camera;
    final makes = widget.makes;
    final notifier = ref.read(searchStateProvider.notifier);
    // The selected camera stays listed even when the options no longer offer it, so it can be cleared.
    final rows = [
      ...?makes,
      if (camera != null && !(makes ?? const []).any((m) => m.make == camera.make))
        SearchCameraMakeOption(
          make: camera.make,
          models: camera.model == null ? const [] : [SearchCameraModelOption(model: camera.model!)],
        ),
    ];
    // Folded, the selected make still shows, so it can be seen and cleared.
    final visible = _showAll || rows.length <= _folded
        ? rows
        : [
            for (final (index, make) in rows.indexed)
              if (index < _folded || make.make == camera?.make) make,
          ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (makes == null && camera == null)
          const SearchSheetPending(SearchDimension.cameras)
        else
          for (final make in visible) ...[
            ListTile(
              key: Key('search-filter-make-${make.make}'),
              dense: true,
              contentPadding: const EdgeInsets.symmetric(horizontal: 20),
              leading: const Icon(Icons.photo_camera_outlined, size: 20),
              title: Text(make.make, style: const TextStyle(fontWeight: FontWeight.w600)),
              selected: camera?.make == make.make,
              trailing: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  SearchOptionCount(make.count),
                  Icon(_open.contains(make.make) ? Icons.arrow_drop_up_rounded : Icons.arrow_drop_down_rounded),
                ],
              ),
              // A make opens its models at once, from the options already loaded.
              onTap: () => setState(() => _open.contains(make.make) ? _open.remove(make.make) : _open.add(make.make)),
            ),
            if (_open.contains(make.make))
              Padding(
                padding: const EdgeInsets.fromLTRB(56, 0, 16, 8),
                child: Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    ChoiceChip(
                      key: Key('search-filter-camera-any-${make.make}'),
                      label: Text(context.t.search_mode_camera_any(make: make.make)),
                      selected: camera != null && camera.make == make.make && camera.model == null,
                      onSelected: (_) => notifier.setCamera(
                        camera?.make == make.make && camera?.model == null ? null : SearchCamera(make: make.make),
                      ),
                    ),
                    for (final model in make.models ?? const <SearchCameraModelOption>[])
                      ChoiceChip(
                        key: Key('search-filter-model-${make.make}-${model.model}'),
                        label: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [Text(model.model), const SizedBox(width: 6), SearchOptionCount(model.count)],
                        ),
                        selected: camera?.make == make.make && camera?.model == model.model,
                        onSelected: (_) => notifier.setCamera(
                          camera?.make == make.make && camera?.model == model.model
                              ? null
                              : SearchCamera(make: make.make, model: model.model),
                        ),
                      ),
                  ],
                ),
              ),
          ],
        if (rows.length > _folded)
          Align(
            alignment: Alignment.centerLeft,
            child: Padding(
              padding: const EdgeInsets.only(left: 8),
              child: TextButton(
                key: const Key('search-filter-camera-more'),
                onPressed: () => setState(() => _showAll = !_showAll),
                child: Text(
                  _showAll ? context.t.show_less : context.t.search_mode_show_more(count: rows.length - _folded),
                ),
              ),
            ),
          ),
      ],
    );
  }
}

class _AlbumSection extends ConsumerWidget {
  final SearchAlbumFilter value;

  const _AlbumSection({required this.value});

  @override
  Widget build(BuildContext context, WidgetRef ref) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      _Segmented<SearchAlbumFilter>(
        keyPrefix: 'search-filter-album',
        name: (value) => value.name,
        selected: value,
        onSelected: ref.read(searchStateProvider.notifier).setAlbumFilter,
        options: [
          (SearchAlbumFilter.any, context.t.search_mode_albums_any, null),
          (SearchAlbumFilter.inAlbum, context.t.filter_has_album, null),
          (SearchAlbumFilter.notInAlbum, context.t.filter_has_no_album, null),
        ],
      ),
    ],
  );
}

/// In the photo (OCR), File name and Description: all three can be filled at once, as on web. Each change applies as
/// you type; the providers' debounce keeps it to one request per pause.
class _TextSection extends ConsumerStatefulWidget {
  final SearchText text;
  final bool queryMode;

  const _TextSection({required this.text, required this.queryMode});

  @override
  ConsumerState<_TextSection> createState() => _TextSectionState();
}

class _TextSectionState extends ConsumerState<_TextSection> {
  late final _ocr = TextEditingController(text: widget.text.ocr);
  late final _fileName = TextEditingController(text: widget.text.fileName);
  late final _description = TextEditingController(text: widget.text.description);

  @override
  void didUpdateWidget(covariant _TextSection oldWidget) {
    super.didUpdateWidget(oldWidget);
    // Cleared from outside (the sheet's Clear): the fields follow.
    _sync(_ocr, widget.text.ocr);
    _sync(_fileName, widget.text.fileName);
    _sync(_description, widget.text.description);
  }

  static void _sync(TextEditingController controller, String? value) {
    if (value == null && controller.text.trim().isNotEmpty) {
      controller.clear();
    }
  }

  @override
  void dispose() {
    _ocr.dispose();
    _fileName.dispose();
    _description.dispose();
    super.dispose();
  }

  static String? _value(String text) => text.trim().isEmpty ? null : text;

  void _apply() => ref
      .read(searchStateProvider.notifier)
      .setText(
        SearchText(ocr: _value(_ocr.text), fileName: _value(_fileName.text), description: _value(_description.text)),
      );

  Widget _field(String key, String label, TextEditingController controller, {bool enabled = true}) => Padding(
    padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
    child: TextField(
      key: Key('search-filter-text-$key'),
      controller: controller,
      enabled: enabled,
      autocorrect: false,
      textInputAction: TextInputAction.done,
      onChanged: (_) => _apply(),
      decoration: InputDecoration(
        isDense: true,
        labelText: label,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
      ),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    // /search/smart has no file name or description filter, so a text search drops both (buildSearchParams): say so,
    // and keep them read-only meanwhile.
    final browse = !widget.queryMode;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _field('ocr', context.t.search_mode_text_ocr, _ocr),
        _field('fileName', context.t.file_name_text, _fileName, enabled: browse),
        _field('description', context.t.description, _description, enabled: browse),
        if (!browse)
          Padding(
            key: const Key('search-filter-text-query-hint'),
            padding: const EdgeInsets.symmetric(horizontal: 20),
            child: Text(
              context.t.search_mode_text_query_hint,
              style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          ),
      ],
    );
  }
}

class _DateRangeSection extends ConsumerWidget {
  final SearchDate? date;

  const _DateRangeSection({required this.date});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final custom = date is SearchDateCustom ? date! as SearchDateCustom : null;
    final notifier = ref.read(searchStateProvider.notifier);
    final now = ref.read(searchClockProvider)();
    final locale = Localizations.maybeLocaleOf(context)?.toLanguageTag() ?? 'en';
    String format(DateTime value) {
      try {
        return DateFormat.yMMMd(locale).format(value);
      } catch (_) {
        return DateFormat.yMMMd('en').format(value);
      }
    }

    Future<DateTime?> pick(DateTime? initial) => showDatePicker(
      context: context,
      initialDate: initial ?? DateTime(now.year, now.month, now.day),
      firstDate: DateTime(1900),
      lastDate: DateTime(now.year + 1, 12, 31),
    );

    // One end alone leaves the other open: From only is that day onward, To only is up to and including that day. An
    // end on the wrong side of the other moves the other with it.
    Future<void> pickFrom() async {
      final from = await pick(custom?.from);
      if (from == null) {
        return;
      }
      final to = custom?.to;
      notifier.setDate(SearchDate.custom(from: from, to: to != null && to.isBefore(from) ? from : to));
    }

    Future<void> pickTo() async {
      final to = await pick(custom?.to);
      if (to == null) {
        return;
      }
      final from = custom?.from;
      notifier.setDate(SearchDate.custom(from: from != null && from.isAfter(to) ? to : from, to: to));
    }

    Widget button(String key, String label, DateTime? value, Future<void> Function() onPressed) => Expanded(
      child: OutlinedButton(
        key: Key('search-filter-date-$key'),
        style: OutlinedButton.styleFrom(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        ),
        onPressed: onPressed,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(label, style: Theme.of(context).textTheme.labelSmall),
            Text(value == null ? '—' : format(value), maxLines: 1, overflow: TextOverflow.ellipsis),
          ],
        ),
      ),
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Row(
            children: [
              button('from', context.t.filter_from, custom?.from, pickFrom),
              const SizedBox(width: 8),
              button('to', context.t.filter_to, custom?.to, pickTo),
              if (custom != null)
                IconButton(
                  key: const Key('search-filter-date-clear'),
                  tooltip: context.t.clear,
                  icon: const Icon(Icons.close_rounded),
                  onPressed: () => notifier.setDate(null),
                ),
            ],
          ),
        ),
      ],
    );
  }
}
