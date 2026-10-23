import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/search/search.providers.dart';
import 'package:immich_mobile/gallery/search/search_mode.provider.dart';
import 'package:immich_mobile/gallery/search/search_options.model.dart';
import 'package:immich_mobile/gallery/search/search_state.model.dart';
import 'package:immich_mobile/gallery/search/search_suggestion_matcher.dart';
import 'package:immich_mobile/gallery/search/search_ui.providers.dart';
import 'package:immich_mobile/gallery/search/widgets/search_avatar.widget.dart';
import 'package:immich_mobile/gallery/search/widgets/search_chip_row.widget.dart';
import 'package:immich_mobile/gallery/search/widgets/search_labels.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/widgets/images/thumbnail.widget.dart';
import 'package:intl/intl.dart';

// The search header (specs/2026-10-23-mobile-search-redesign-design.md, "The design"): it takes the place of the
// screen's app bar in search mode. Back arrow and field, the chip row under them, then the results header with the
// exact total and the sort. Pinned, so the filters stay in reach while scrolling the results.

class SearchHeader extends StatelessWidget {
  const SearchHeader({super.key});

  static const double fieldRowHeight = 56;
  static const double chipRowHeight = 48;
  static const double resultsRowHeight = 36;

  /// How much taller than a toolbar the header is. The timeline keeps its scrubber below `padding.top +
  /// kToolbarHeight`, room for the screen's app bar; in search mode the frame raises the timeline's top media padding by
  /// this much (SearchHeaderInset), so the scrubber starts below the header instead of under it.
  static const double extraTopPadding = fieldRowHeight + chipRowHeight + resultsRowHeight - kToolbarHeight;

  /// The status bar above the header: the media padding without what the frame added for the scrubber.
  static double statusBarInset(BuildContext context) =>
      MediaQuery.paddingOf(context).top - SearchHeaderInset.extraOf(context);

  @override
  Widget build(BuildContext context) {
    final height = statusBarInset(context) + fieldRowHeight + chipRowHeight + resultsRowHeight;
    return SliverPersistentHeader(pinned: true, delegate: _SearchHeaderDelegate(height));
  }
}

/// Marks the top media padding [extra] that search mode added below it for the timeline's scrubber (see
/// SearchHeader.extraTopPadding).
class SearchHeaderInset extends InheritedWidget {
  final double extra;

  const SearchHeaderInset({super.key, required this.extra, required super.child});

  static double extraOf(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<SearchHeaderInset>()?.extra ?? 0;

  @override
  bool updateShouldNotify(SearchHeaderInset oldWidget) => oldWidget.extra != extra;
}

class _SearchHeaderDelegate extends SliverPersistentHeaderDelegate {
  final double height;

  const _SearchHeaderDelegate(this.height);

  @override
  double get minExtent => height;

  @override
  double get maxExtent => height;

  @override
  Widget build(BuildContext context, double shrinkOffset, bool overlapsContent) => const _SearchHeaderBody();

  @override
  bool shouldRebuild(_SearchHeaderDelegate oldDelegate) => oldDelegate.height != height;
}

class _SearchHeaderBody extends ConsumerStatefulWidget {
  const _SearchHeaderBody();

  @override
  ConsumerState<_SearchHeaderBody> createState() => _SearchHeaderBodyState();
}

class _SearchHeaderBodyState extends ConsumerState<_SearchHeaderBody> {
  final _focus = FocusNode(debugLabel: 'search-field');
  final _dropdown = OverlayPortalController();
  final _link = LayerLink();
  double _fieldWidth = 0;

  late final TextEditingController _text;

  @override
  void initState() {
    super.initState();
    _text = ref.read(searchFieldControllerProvider);
    _focus
      ..addListener(_refresh)
      ..onKeyEvent = _onKey;
    _text.addListener(_refresh);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) {
        return;
      }
      _dropdown.show();
      final controller = _timelineController(context);
      if (controller != null && controller.hasClients) {
        ref.read(searchModeProvider.notifier).rememberScrollOffset(controller.offset);
      }
    });
    // New filters: the results start at the top.
    ref.listenManual<SearchState>(searchStateProvider, (previous, next) {
      if (previous != null && previous != next) {
        _scrollToTop();
      }
    });
  }

  @override
  void dispose() {
    _text.removeListener(_refresh);
    _focus.dispose();
    super.dispose();
  }

  void _refresh() {
    if (mounted) {
      setState(() {});
    }
  }

  void _scrollToTop() {
    final controller = _timelineController(context);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (controller != null && controller.hasClients && controller.offset != 0) {
        controller.jumpTo(0);
      }
    });
  }

  /// Backspace in an empty field removes the query token.
  KeyEventResult _onKey(FocusNode node, KeyEvent event) {
    if (event is KeyDownEvent &&
        event.logicalKey == LogicalKeyboardKey.backspace &&
        _text.text.isEmpty &&
        ref.read(searchStateProvider).isQueryMode) {
      ref.read(searchStateProvider.notifier).clearQuery();
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  void _leave() {
    _focus.unfocus();
    leaveSearchMode(context, ref, scrollController: _timelineController(context));
  }

  /// Enter runs a smart search on plain text; `@` and `#` text only narrows the suggestions.
  void _submit(String value) {
    final text = value.trim();
    if (text.isEmpty || text.startsWith('@') || text.startsWith('#')) {
      return;
    }
    ref.read(searchStateProvider.notifier).submitText(text);
    _text.clear();
    _focus.unfocus();
  }

  void _pick(SearchSuggestion suggestion) {
    final notifier = ref.read(searchStateProvider.notifier);
    final filters = ref.read(searchStateProvider).filters;
    switch (suggestion) {
      case PersonSuggestion(:final person):
        if (!filters.people.any((p) => p.filterId == person.filterId)) {
          notifier.togglePerson(personRefOf(person));
        }
      case TagSuggestion(:final tag):
        if (!filters.tags.any((t) => t.id == tag.id)) {
          notifier.toggleTag(SearchTagRef(id: tag.id, value: tag.value));
        }
      case PlaceSuggestion():
        notifier.setPlace(suggestion.place);
      case DateSuggestion(:final date):
        notifier.setDate(date);
      case SmartSearchSuggestion(:final text):
        notifier.submitText(text);
    }
    _text.clear();
    _focus.unfocus();
  }

  List<String> _monthNames(BuildContext context) {
    try {
      final locale = Localizations.localeOf(context).toLanguageTag();
      final format = DateFormat.MMMM(locale);
      return [for (var month = 1; month <= 12; month++) format.format(DateTime(2000, month))];
    } catch (_) {
      return englishMonthNames;
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final query = ref.watch(searchStateProvider.select((s) => s.query));
    // The dropdown matches against the options: rebuild it when they arrive.
    ref.watch(searchOptionsProvider);
    return BackButtonListener(
      onBackButtonPressed: () async {
        // A sheet or the asset viewer on top handles back itself.
        if (!mounted || ModalRoute.of(context)?.isCurrent == false) {
          return false;
        }
        _leave();
        return true;
      },
      child: Material(
        color: theme.colorScheme.surface,
        child: Padding(
          padding: EdgeInsets.only(top: SearchHeader.statusBarInset(context)),
          child: Column(
            children: [
              SizedBox(
                height: SearchHeader.fieldRowHeight,
                child: Row(
                  children: [
                    IconButton(
                      key: const Key('search-mode-back'),
                      tooltip: context.t.back,
                      icon: const Icon(Icons.arrow_back_rounded),
                      onPressed: _leave,
                    ),
                    Expanded(
                      child: Padding(
                        padding: const EdgeInsets.only(right: 12),
                        child: LayoutBuilder(
                          builder: (context, constraints) {
                            _fieldWidth = constraints.maxWidth;
                            return OverlayPortal(
                              controller: _dropdown,
                              overlayChildBuilder: _buildDropdown,
                              child: CompositedTransformTarget(link: _link, child: _buildField(theme, query)),
                            );
                          },
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: SearchHeader.chipRowHeight, child: SearchChipRow()),
              const SizedBox(height: SearchHeader.resultsRowHeight, child: _ResultsRow()),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildField(ThemeData theme, SearchQuery query) {
    return Container(
      height: 44,
      padding: const EdgeInsets.symmetric(horizontal: 8),
      decoration: BoxDecoration(color: theme.colorScheme.surfaceContainerHigh, borderRadius: BorderRadius.circular(14)),
      child: Row(
        children: [
          if (query case SearchQueryText(:final text)) ...[
            _QueryToken(label: text, onRemove: () => ref.read(searchStateProvider.notifier).clearQuery()),
            const SizedBox(width: 6),
          ] else if (query case SearchQuerySimilarTo(:final assetId)) ...[
            _QueryToken(
              key: const Key('search-mode-similar-token'),
              label: context.t.search_mode_similar_to,
              removeLabel: context.t.search_mode_remove_similar,
              leading: ClipRRect(
                borderRadius: BorderRadius.circular(4),
                child: SizedBox.square(
                  dimension: 20,
                  child: Thumbnail.remote(remoteId: assetId, thumbhash: '', fit: BoxFit.cover),
                ),
              ),
              onRemove: () => ref.read(searchStateProvider.notifier).clearQuery(),
            ),
            const SizedBox(width: 6),
          ] else
            Icon(Icons.search_rounded, size: 20, color: theme.colorScheme.onSurfaceVariant),
          const SizedBox(width: 4),
          Expanded(
            child: TextField(
              key: const Key('search-mode-field'),
              controller: ref.watch(searchFieldControllerProvider),
              focusNode: _focus,
              textInputAction: TextInputAction.search,
              autocorrect: false,
              decoration: InputDecoration.collapsed(
                hintText: context.t.search_mode_field_hint,
                hintStyle: theme.textTheme.bodyLarge?.copyWith(color: theme.colorScheme.onSurfaceVariant),
              ),
              style: theme.textTheme.bodyLarge,
              onSubmitted: _submit,
            ),
          ),
          if (_text.text.isNotEmpty)
            IconButton(
              visualDensity: VisualDensity.compact,
              tooltip: context.t.clear,
              icon: const Icon(Icons.close_rounded, size: 18),
              onPressed: _text.clear,
            ),
        ],
      ),
    );
  }

  Widget _buildDropdown(BuildContext context) {
    final text = ref.read(searchFieldControllerProvider).text;
    if (!_focus.hasFocus || text.trim().isEmpty) {
      return const SizedBox.shrink();
    }
    final options = ref.read(searchOptionsProvider);
    final suggestions = SearchSuggestionMatcher(monthNames: _monthNames(context)).match(text, options);
    return CompositedTransformFollower(
      link: _link,
      targetAnchor: Alignment.bottomLeft,
      offset: const Offset(0, 6),
      child: Align(
        alignment: Alignment.topLeft,
        child: TextFieldTapRegion(
          child: SizedBox(
            width: _fieldWidth,
            child: _SuggestionList(suggestions: suggestions, onPick: _pick),
          ),
        ),
      ),
    );
  }
}

class _QueryToken extends StatelessWidget {
  final String label;
  final VoidCallback onRemove;

  /// Before the label: a search icon for text, the reference photo's thumbnail for similar photos.
  final Widget? leading;
  final String? removeLabel;

  const _QueryToken({super.key, required this.label, required this.onRemove, this.leading, this.removeLabel});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 200),
      child: Material(
        key: key == null ? const Key('search-mode-query-token') : null,
        color: scheme.secondaryContainer,
        shape: const StadiumBorder(),
        child: InkWell(
          customBorder: const StadiumBorder(),
          onTap: onRemove,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                leading ?? Icon(Icons.search_rounded, size: 14, color: scheme.onSecondaryContainer),
                const SizedBox(width: 4),
                Flexible(
                  child: Text(
                    label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(
                      context,
                    ).textTheme.labelMedium?.copyWith(color: scheme.onSecondaryContainer, fontWeight: FontWeight.w600),
                  ),
                ),
                const SizedBox(width: 2),
                Semantics(
                  label: removeLabel ?? context.t.search_mode_remove_query,
                  button: true,
                  child: Icon(Icons.close_rounded, size: 14, color: scheme.onSecondaryContainer),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _SuggestionList extends StatelessWidget {
  final SearchSuggestions suggestions;
  final void Function(SearchSuggestion) onPick;

  const _SuggestionList({required this.suggestions, required this.onPick});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final rows = <Widget>[];
    void group(String title) => rows.add(
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 2),
        child: Text(
          title.toUpperCase(),
          style: theme.textTheme.labelSmall?.copyWith(color: theme.colorScheme.onSurfaceVariant, letterSpacing: 0.6),
        ),
      ),
    );
    if (suggestions.people.isNotEmpty) {
      group(context.t.people);
      for (final s in suggestions.people) {
        rows.add(
          _SuggestionRow(
            key: Key('search-suggestion-person-${s.person.filterId}'),
            leading: SearchPersonAvatar(person: s.person, radius: 15),
            title: s.person.name,
            count: s.person.count,
            onTap: () => onPick(s),
          ),
        );
      }
    }
    if (suggestions.tags.isNotEmpty) {
      group(context.t.tags);
      for (final s in suggestions.tags) {
        rows.add(
          _SuggestionRow(
            key: Key('search-suggestion-tag-${s.tag.id}'),
            leading: const _RoundIcon(Icons.tag_rounded),
            title: s.tag.value,
            count: s.tag.count,
            onTap: () => onPick(s),
          ),
        );
      }
    }
    if (suggestions.places.isNotEmpty) {
      group(context.t.places);
      for (final s in suggestions.places) {
        rows.add(
          _SuggestionRow(
            key: Key('search-suggestion-place-${s.city ?? s.country}'),
            leading: Icon(s.city == null ? Icons.public_rounded : Icons.place_outlined, size: 20),
            title: s.city ?? s.country,
            subtitle: s.city == null ? null : s.country,
            count: s.count,
            onTap: () => onPick(s),
          ),
        );
      }
    }
    if (suggestions.dates.isNotEmpty) {
      group(context.t.when$);
      for (final s in suggestions.dates) {
        rows.add(
          _SuggestionRow(
            key: Key('search-suggestion-date-${s.date}'),
            leading: const _RoundIcon(Icons.calendar_today_rounded),
            title: searchDateLabel(context, s.date),
            count: s.count,
            onTap: () => onPick(s),
          ),
        );
      }
    }
    if (suggestions.smartSearch case final smart?) {
      group(context.t.photos);
      rows.add(
        _SuggestionRow(
          key: const Key('search-suggestion-smart'),
          leading: const _RoundIcon(Icons.image_search_rounded),
          title: context.t.search_mode_smart_search(query: smart.text),
          subtitle: context.t.search_mode_smart_search_subtitle,
          onTap: () => onPick(smart),
        ),
      );
    }
    if (rows.isEmpty) {
      rows.add(
        Padding(
          padding: const EdgeInsets.all(16),
          child: Text(
            context.t.search_mode_nothing_matches,
            style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
          ),
        ),
      );
    }
    return Material(
      key: const Key('search-mode-suggestions'),
      elevation: 8,
      color: theme.colorScheme.surfaceContainer,
      borderRadius: BorderRadius.circular(12),
      clipBehavior: Clip.antiAlias,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxHeight: 360),
        child: ListView(shrinkWrap: true, padding: const EdgeInsets.only(bottom: 6), children: rows),
      ),
    );
  }
}

class _SuggestionRow extends StatelessWidget {
  final Widget leading;
  final String title;
  final String? subtitle;
  final int? count;
  final VoidCallback onTap;

  const _SuggestionRow({
    super.key,
    required this.leading,
    required this.title,
    this.subtitle,
    this.count,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        child: Row(
          children: [
            SizedBox(width: 30, child: Center(child: leading)),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, maxLines: 1, overflow: TextOverflow.ellipsis, style: theme.textTheme.bodyMedium),
                  if (subtitle != null)
                    Text(
                      subtitle!,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                    ),
                ],
              ),
            ),
            if (count != null)
              Text(
                formatSearchCount(context, count!),
                style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
              ),
          ],
        ),
      ),
    );
  }
}

class _RoundIcon extends StatelessWidget {
  final IconData icon;

  const _RoundIcon(this.icon);

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return CircleAvatar(
      radius: 15,
      backgroundColor: scheme.surfaceContainerHighest,
      child: Icon(icon, size: 16, color: scheme.onSurfaceVariant),
    );
  }
}

/// The exact total and the sort.
class _ResultsRow extends ConsumerWidget {
  const _ResultsRow();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final state = ref.watch(searchStateProvider);
    final total =
        ref.watch(searchResultsProvider.select((r) => r.total)) ??
        ref.watch(searchOptionsProvider.select((o) => o.total));
    final muted = theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Row(
        children: [
          Expanded(
            child: Text(
              total == null
                  ? ''
                  : state.isEmpty
                  ? context.t.search_mode_total_all(count: total)
                  : context.t.search_mode_total_matches(count: total),
              key: const Key('search-mode-total'),
              style: muted?.copyWith(color: theme.colorScheme.onSurface, fontWeight: FontWeight.w600),
            ),
          ),
          _SortButton(sort: state.sort, queryMode: state.isQueryMode),
        ],
      ),
    );
  }
}

class _SortButton extends ConsumerWidget {
  final SearchSort sort;
  final bool queryMode;

  const _SortButton({required this.sort, required this.queryMode});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    String label(SearchSort value) => switch (value) {
      SearchSort.newest => context.t.search_sort_newest,
      SearchSort.oldest => context.t.search_sort_oldest,
      SearchSort.relevance => context.t.search_sort_relevance,
    };
    return PopupMenuButton<SearchSort>(
      key: const Key('search-mode-sort'),
      tooltip: context.t.search_sort_title,
      initialValue: sort,
      onSelected: (value) => ref.read(searchStateProvider.notifier).setSort(value),
      itemBuilder: (_) => [
        for (final value in SearchSort.values)
          if (value != SearchSort.relevance || queryMode)
            PopupMenuItem(key: Key('search-mode-sort-${value.name}'), value: value, child: Text(label(value))),
      ],
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(label(sort), style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
          Icon(Icons.arrow_drop_down_rounded, size: 20, color: theme.colorScheme.onSurfaceVariant),
        ],
      ),
    );
  }
}

/// The selected person a field suggestion or a sheet option stands for.
SearchPersonRef personRefOf(SearchPersonOption person) => SearchPersonRef(
  filterId: person.filterId,
  name: person.name,
  profileId: person.profileId,
  profileType: person.profileType,
  profileSpaceId: person.profileSpaceId,
);

/// The timeline grid's scroll controller. The grid is a primary scroll view, which hides the PrimaryScrollController
/// from its slivers, so the header reaches it through its Scrollable.
ScrollController? _timelineController(BuildContext context) => Scrollable.maybeOf(context)?.widget.controller;
