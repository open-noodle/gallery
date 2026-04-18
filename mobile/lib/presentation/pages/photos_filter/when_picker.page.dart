import 'package:auto_route/auto_route.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/pages/photos_filter/widgets/decade_anchor_strip.widget.dart';
import 'package:immich_mobile/presentation/pages/photos_filter/widgets/quick_ranges_row.widget.dart';
import 'package:immich_mobile/presentation/pages/photos_filter/widgets/when_picker_footer.widget.dart';
import 'package:immich_mobile/presentation/pages/photos_filter/widgets/when_picker_search_header.widget.dart';
import 'package:immich_mobile/presentation/pages/photos_filter/widgets/when_picker_year_accordion.widget.dart';
import 'package:immich_mobile/providers/photos_filter/temporal_utils.dart';
import 'package:immich_mobile/providers/photos_filter/when_picker.provider.dart';

@RoutePage()
class WhenPickerPage extends ConsumerStatefulWidget {
  const WhenPickerPage({super.key});

  @override
  ConsumerState<WhenPickerPage> createState() => _WhenPickerPageState();
}

class _WhenPickerPageState extends ConsumerState<WhenPickerPage> {
  late final TextEditingController _controller;
  final ScrollController _scrollController = ScrollController();
  final Map<int, GlobalKey> _yearKeys = <int, GlobalKey>{};
  int? _expandedYear;

  GlobalKey _yearKeyFor(int year) => _yearKeys.putIfAbsent(year, () => GlobalKey());

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: ref.read(whenPickerQueryProvider));
  }

  @override
  void dispose() {
    _scrollController.dispose();
    _controller.dispose();
    super.dispose();
  }

  Future<void> _scrollToYear(int year) async {
    final key = _yearKeys[year];
    final ctx = key?.currentContext;
    if (ctx == null) return;
    await Scrollable.ensureVisible(ctx, alignment: 0.1, duration: const Duration(milliseconds: 300));
  }

  Future<void> _scrollToDecade(int decadeStart) async {
    final years = await ref.read(whenPickerFilteredYearsProvider.future);
    final inDecade = years.where((y) => y.year >= decadeStart && y.year < decadeStart + 10).toList();
    if (inDecade.isEmpty) return;
    // aggregateYears returns years sorted descending, so first = newest.
    final newest = inDecade.first.year;
    await _scrollToYear(newest);
  }

  @override
  Widget build(BuildContext context) {
    // Keep controller text in sync if provider changes externally (e.g. the
    // Clear-search button in the no-results panel below).
    ref.listen<String>(whenPickerQueryProvider, (prev, next) {
      if (_controller.text != next) {
        _controller.text = next;
        _controller.selection = TextSelection.collapsed(offset: next.length);
      }
    });

    // Auto-expand + scroll to a typed year query.
    ref.listen<WhenQuery>(whenPickerParsedProvider, (prev, next) {
      if (prev == next) return;
      final year = next.yearValue;
      if (year == null) return;
      setState(() => _expandedYear = year);
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        _scrollToYear(year);
      });
    });

    final filteredAsync = ref.watch(whenPickerFilteredYearsProvider);
    final query = ref.watch(whenPickerQueryProvider);

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded),
          tooltip: 'back'.tr(),
          onPressed: () => Navigator.of(context).maybePop(),
        ),
        title: Text('filter_sheet_picker_when_title'.tr()),
        actions: [
          TextButton(
            key: const Key('when-picker-done'),
            onPressed: () => Navigator.of(context).maybePop(),
            child: Text('filter_sheet_picker_done'.tr()),
          ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: CustomScrollView(
              controller: _scrollController,
              slivers: [
                WhenPickerSearchHeader(
                  controller: _controller,
                  value: _controller.text,
                  onChanged: (v) => ref.read(whenPickerQueryProvider.notifier).state = v,
                ),
                const SliverToBoxAdapter(child: SizedBox(height: 8)),
                const SliverToBoxAdapter(child: QuickRangesRow()),
                const SliverToBoxAdapter(child: SizedBox(height: 8)),
                SliverToBoxAdapter(child: DecadeAnchorStrip(onDecade: _scrollToDecade)),
                const SliverToBoxAdapter(child: SizedBox(height: 12)),
                ..._bodySlivers(filteredAsync, query),
              ],
            ),
          ),
          const WhenPickerFooter(),
        ],
      ),
    );
  }

  List<Widget> _bodySlivers(AsyncValue<List<YearCount>> async, String query) {
    return async.when(
      loading: () => const [SliverFillRemaining(child: Center(child: CircularProgressIndicator(value: 0)))],
      error: (e, st) => [SliverFillRemaining(child: Center(child: Text('filter_sheet_load_error_retry'.tr())))],
      data: (filtered) {
        if (filtered.isEmpty && query.trim().isNotEmpty) {
          return [
            SliverFillRemaining(
              hasScrollBody: false,
              child: _WhenNoResultsPanel(
                query: query.trim(),
                onClear: () => ref.read(whenPickerQueryProvider.notifier).state = '',
              ),
            ),
          ];
        }
        if (filtered.isEmpty) {
          return const [SliverToBoxAdapter(child: SizedBox.shrink())];
        }
        return [
          SliverToBoxAdapter(
            child: WhenPickerYearAccordion(
              yearKeyFor: _yearKeyFor,
              expandedYear: _expandedYear,
              onExpandYear: (y) => setState(() => _expandedYear = y),
            ),
          ),
        ];
      },
    );
  }
}

class _WhenNoResultsPanel extends StatelessWidget {
  final String query;
  final VoidCallback onClear;
  const _WhenNoResultsPanel({required this.query, required this.onClear});

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
            key: const Key('when-picker-clear-search'),
            onPressed: onClear,
            child: Text('filter_sheet_picker_clear_search'.tr()),
          ),
        ],
      ),
    );
  }
}
