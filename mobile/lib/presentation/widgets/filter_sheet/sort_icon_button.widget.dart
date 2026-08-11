import 'dart:async';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

/// App-bar control for search-result ordering (relevance / newest / oldest).
///
/// Collapses to nothing while the filter is empty — sort is meaningless on the
/// plain chronological timeline, so the button only appears once a search or
/// filter is active. Tapping opens a bottom sheet of the available orders.
/// Relevance is offered only for semantic (context) search; otherwise it falls
/// back to newest, mirroring [SearchFilter] sort handling.
class SortIconButton extends ConsumerWidget {
  const SortIconButton({super.key});

  static String _label(SearchSortOrder s) => switch (s) {
    SearchSortOrder.relevance => StaticTranslations.instance.search_sort_relevance,
    SearchSortOrder.newest => StaticTranslations.instance.search_sort_newest,
    SearchSortOrder.oldest => StaticTranslations.instance.search_sort_oldest,
  };

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final filter = ref.watch(photosFilterProvider);
    if (filter.isEmpty) return const SizedBox.shrink();

    final smart = filter.context != null && filter.context!.isNotEmpty;
    final effective = (!smart && filter.sort == SearchSortOrder.relevance) ? SearchSortOrder.newest : filter.sort;

    return Semantics(
      button: true,
      label: context.t.search_sort_title,
      child: IconButton(
        key: const Key('photos-filter-sort-button'),
        icon: const Icon(Icons.swap_vert_rounded),
        tooltip: context.t.search_sort_title,
        onPressed: () => _open(context, ref, smart, effective),
      ),
    );
  }

  void _open(BuildContext context, WidgetRef ref, bool smart, SearchSortOrder current) {
    final options = [if (smart) SearchSortOrder.relevance, SearchSortOrder.newest, SearchSortOrder.oldest];
    unawaited(
      showModalBottomSheet<void>(
        context: context,
        builder: (ctx) => SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Padding(
                padding: const EdgeInsets.all(16),
                child: Text(context.t.search_sort_title, style: Theme.of(ctx).textTheme.titleMedium),
              ),
              RadioGroup<SearchSortOrder>(
                groupValue: current,
                onChanged: (v) {
                  if (v != null) ref.read(photosFilterProvider.notifier).setSort(v);
                  Navigator.of(ctx).pop();
                },
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    for (final o in options)
                      RadioListTile<SearchSortOrder>(
                        key: Key('sort-option-${o.name}'),
                        value: o,
                        title: Text(_label(o)),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
