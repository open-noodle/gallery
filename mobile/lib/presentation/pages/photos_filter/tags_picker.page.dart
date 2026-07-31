import 'package:auto_route/auto_route.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/tag.model.dart';
import 'package:immich_mobile/presentation/pages/photos_filter/widgets/selected_tags_strip.widget.dart';
import 'package:immich_mobile/presentation/pages/photos_filter/widgets/tags_picker_list.widget.dart';
import 'package:immich_mobile/presentation/pages/photos_filter/widgets/tags_picker_search_header.widget.dart';
import 'package:immich_mobile/providers/infrastructure/tag.provider.dart';
import 'package:immich_mobile/providers/photos_filter/tags_picker.provider.dart';

@RoutePage()
class TagsPickerPage extends ConsumerStatefulWidget {
  const TagsPickerPage({super.key});

  @override
  ConsumerState<TagsPickerPage> createState() => _TagsPickerPageState();
}

class _TagsPickerPageState extends ConsumerState<TagsPickerPage> {
  late final TextEditingController _controller;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: ref.read(tagsPickerQueryProvider));
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Keep controller text in sync if provider changes externally (e.g. the
    // Clear-search button in the no-results panel below).
    ref.listen<String>(tagsPickerQueryProvider, (prev, next) {
      if (_controller.text != next) {
        _controller.text = next;
        _controller.selection = TextSelection.collapsed(offset: next.length);
      }
    });

    final filteredAsync = ref.watch(tagsPickerFilteredProvider);
    final query = ref.watch(tagsPickerQueryProvider);

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded),
          tooltip: 'back'.tr(),
          onPressed: () => Navigator.of(context).maybePop(),
        ),
        title: Text('filter_sheet_picker_tags_title'.tr()),
        actions: [
          TextButton(
            key: const Key('tags-picker-done'),
            onPressed: () => Navigator.of(context).maybePop(),
            child: Text('filter_sheet_picker_done'.tr()),
          ),
        ],
      ),
      body: CustomScrollView(
        slivers: [
          TagsPickerSearchHeader(
            controller: _controller,
            value: _controller.text,
            onChanged: (v) => ref.read(tagsPickerQueryProvider.notifier).state = v,
          ),
          const SliverToBoxAdapter(child: SelectedTagsStrip()),
          ..._bodySlivers(filteredAsync, query),
        ],
      ),
    );
  }

  List<Widget> _bodySlivers(AsyncValue<List<Tag>> async, String query) {
    return async.when(
      loading: () => const [SliverFillRemaining(child: Center(child: CircularProgressIndicator()))],
      error: (e, st) => [
        SliverFillRemaining(
          child: Center(
            child: TextButton.icon(
              key: const Key('tags-picker-retry'),
              onPressed: () => ref.invalidate(tagProvider),
              icon: const Icon(Icons.refresh_rounded),
              label: Text('filter_sheet_load_error_retry'.tr()),
            ),
          ),
        ),
      ],
      data: (filtered) {
        if (filtered.isEmpty && query.trim().isNotEmpty) {
          return [
            SliverFillRemaining(
              hasScrollBody: false,
              child: _NoResultsPanel(
                query: query.trim(),
                onClear: () => ref.read(tagsPickerQueryProvider.notifier).state = '',
              ),
            ),
          ];
        }
        if (filtered.isEmpty) {
          return const [SliverToBoxAdapter(child: SizedBox.shrink())];
        }
        return [SliverFillRemaining(hasScrollBody: true, child: TagsPickerList(tags: filtered))];
      },
    );
  }
}

class _NoResultsPanel extends StatelessWidget {
  final String query;
  final VoidCallback onClear;
  const _NoResultsPanel({required this.query, required this.onClear});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            'filter_sheet_picker_no_results'.tr(namedArgs: {'query': query}),
            textAlign: TextAlign.center,
            style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
          ),
          const SizedBox(height: 12),
          TextButton(
            key: const Key('tags-picker-clear-search'),
            onPressed: onClear,
            child: Text('filter_sheet_picker_clear_search'.tr()),
          ),
        ],
      ),
    );
  }
}
