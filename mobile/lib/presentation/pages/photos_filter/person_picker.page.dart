import 'package:auto_route/auto_route.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/presentation/pages/photos_filter/widgets/person_picker_list.widget.dart';
import 'package:immich_mobile/presentation/pages/photos_filter/widgets/person_picker_search_header.widget.dart';
import 'package:immich_mobile/presentation/pages/photos_filter/widgets/recent_people_strip.widget.dart';
import 'package:immich_mobile/presentation/pages/photos_filter/widgets/selected_people_strip.widget.dart';
import 'package:immich_mobile/providers/photos_filter/people_picker.provider.dart';

@RoutePage()
class PersonPickerPage extends ConsumerStatefulWidget {
  const PersonPickerPage({super.key});

  @override
  ConsumerState<PersonPickerPage> createState() => _PersonPickerPageState();
}

class _PersonPickerPageState extends ConsumerState<PersonPickerPage> {
  late final TextEditingController _controller;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: ref.read(peoplePickerQueryProvider));
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
    ref.listen<String>(peoplePickerQueryProvider, (prev, next) {
      if (_controller.text != next) {
        _controller.text = next;
        _controller.selection = TextSelection.collapsed(offset: next.length);
      }
    });

    final filteredAsync = ref.watch(peoplePickerFilteredProvider);
    final query = ref.watch(peoplePickerQueryProvider);
    final count = filteredAsync.valueOrNull?.length ?? 0;

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded),
          tooltip: 'back'.tr(),
          onPressed: () => Navigator.of(context).maybePop(),
        ),
        title: Text('filter_sheet_picker_people_title'.tr()),
        actions: [
          TextButton(
            key: const Key('person-picker-done'),
            onPressed: () => Navigator.of(context).maybePop(),
            child: Text('filter_sheet_picker_done'.tr()),
          ),
        ],
      ),
      body: CustomScrollView(
        slivers: [
          PersonPickerSearchHeader(
            count: count,
            value: _controller.text,
            controller: _controller,
            onChanged: (v) => ref.read(peoplePickerQueryProvider.notifier).state = v,
          ),
          const SliverToBoxAdapter(child: SelectedPeopleStrip()),
          const SliverToBoxAdapter(child: RecentPeopleStrip()),
          ..._bodySlivers(filteredAsync, query),
        ],
      ),
    );
  }

  List<Widget> _bodySlivers(AsyncValue<List<PersonDto>> async, String query) {
    return async.when(
      loading: () => const [SliverFillRemaining(child: Center(child: CircularProgressIndicator(value: 0)))],
      error: (e, st) => [SliverFillRemaining(child: Center(child: Text('filter_sheet_load_error_retry'.tr())))],
      data: (filtered) {
        if (filtered.isEmpty && query.trim().isNotEmpty) {
          return [
            SliverFillRemaining(
              hasScrollBody: false,
              child: _NoResultsPanel(
                query: query.trim(),
                onClear: () => ref.read(peoplePickerQueryProvider.notifier).state = '',
              ),
            ),
          ];
        }
        if (filtered.isEmpty) {
          return const [SliverToBoxAdapter(child: SizedBox.shrink())];
        }
        return [SliverFillRemaining(hasScrollBody: true, child: PersonPickerList(people: filtered))];
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
            key: const Key('person-picker-clear-search'),
            onPressed: onClear,
            child: Text('filter_sheet_picker_clear_search'.tr()),
          ),
        ],
      ),
    );
  }
}
