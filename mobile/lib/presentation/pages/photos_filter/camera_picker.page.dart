import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/pages/photos_filter/widgets/camera_picker_make_accordion.widget.dart';
import 'package:immich_mobile/presentation/pages/photos_filter/widgets/camera_picker_search_header.widget.dart';
import 'package:immich_mobile/providers/photos_filter/camera_model_suggestions.provider.dart';
import 'package:immich_mobile/providers/photos_filter/camera_picker.provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_debounce.provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_suggestions.provider.dart';

@RoutePage()
class CameraPickerPage extends ConsumerStatefulWidget {
  const CameraPickerPage({super.key});

  @override
  ConsumerState<CameraPickerPage> createState() => _CameraPickerPageState();
}

class _CameraPickerPageState extends ConsumerState<CameraPickerPage> {
  late final TextEditingController _controller;
  String? _expandedMake;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: ref.read(cameraPickerQueryProvider));
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
    ref.listen<String>(cameraPickerQueryProvider, (prev, next) {
      if (_controller.text != next) {
        _controller.text = next;
        _controller.selection = TextSelection.collapsed(offset: next.length);
      }
    });

    final makesAsync = ref.watch(cameraPickerMakesProvider);
    final query = ref.watch(cameraPickerQueryProvider);

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded),
          tooltip: context.t.back,
          onPressed: () => Navigator.of(context).maybePop(),
        ),
        title: Text(context.t.filter_sheet_picker_camera_title),
        actions: [
          TextButton(
            key: const Key('camera-picker-done'),
            onPressed: () => Navigator.of(context).maybePop(),
            child: Text(context.t.filter_sheet_picker_done),
          ),
        ],
      ),
      body: CustomScrollView(
        slivers: [
          CameraPickerSearchHeader(
            controller: _controller,
            value: _controller.text,
            onChanged: (v) => ref.read(cameraPickerQueryProvider.notifier).state = v,
          ),
          const SliverToBoxAdapter(child: SizedBox(height: 8)),
          ..._bodySlivers(makesAsync, query),
        ],
      ),
    );
  }

  List<Widget> _bodySlivers(AsyncValue<List<String>> async, String query) {
    return async.when(
      loading: () => const [SliverFillRemaining(child: Center(child: CircularProgressIndicator()))],
      error: (e, st) => [
        SliverFillRemaining(
          child: Center(
            child: TextButton.icon(
              key: const Key('camera-picker-retry'),
              onPressed: () => ref.invalidate(photosFilterSuggestionsProvider(ref.read(photosFilterDebouncedProvider))),
              icon: const Icon(Icons.refresh_rounded),
              label: Text(context.t.filter_sheet_load_error_retry),
            ),
          ),
        ),
      ],
      data: (makes) {
        final trimmedQuery = query.trim();
        final hasVisibleContent = makes.isNotEmpty || _expandedMakeHasModelMatch(trimmedQuery);
        if (!hasVisibleContent && trimmedQuery.isNotEmpty) {
          return [
            SliverFillRemaining(
              hasScrollBody: false,
              child: _CameraNoResultsPanel(
                query: trimmedQuery,
                onClear: () => ref.read(cameraPickerQueryProvider.notifier).state = '',
              ),
            ),
          ];
        }
        if (!hasVisibleContent) {
          return const [SliverToBoxAdapter(child: SizedBox.shrink())];
        }
        return [
          SliverToBoxAdapter(
            child: CameraPickerMakeAccordion(
              expandedMake: _expandedMake,
              onExpandMake: (m) => setState(() => _expandedMake = m),
            ),
          ),
        ];
      },
    );
  }

  /// True when the currently-expanded make has an already-loaded model
  /// matching [trimmedQuery] — without triggering a fetch (only cached
  /// models of the expanded make count; no proactive fetch here).
  ///
  /// Lets the page keep the accordion visible even when [trimmedQuery]
  /// matches no make name, so the accordion's own already-loaded-model
  /// filtering (see CameraPickerMakeAccordion) stays reachable instead of
  /// being short-circuited by a page-level "no results" decision that only
  /// looked at make names.
  bool _expandedMakeHasModelMatch(String trimmedQuery) {
    final expanded = _expandedMake;
    if (expanded == null || trimmedQuery.isEmpty) {
      return false;
    }
    final query = trimmedQuery.toLowerCase();
    final cachedModels = ref.watch(cameraModelSuggestionsProvider(expanded)).valueOrNull;
    return cachedModels?.any((m) => m.toLowerCase().contains(query)) ?? false;
  }
}

class _CameraNoResultsPanel extends StatelessWidget {
  final String query;
  final VoidCallback onClear;
  const _CameraNoResultsPanel({required this.query, required this.onClear});

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
            context.t.filter_sheet_picker_no_results(query: query),
            textAlign: TextAlign.center,
            style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
          ),
          const SizedBox(height: 12),
          TextButton(
            key: const Key('camera-picker-clear-search'),
            onPressed: onClear,
            child: Text(context.t.filter_sheet_picker_clear_search),
          ),
        ],
      ),
    );
  }
}
