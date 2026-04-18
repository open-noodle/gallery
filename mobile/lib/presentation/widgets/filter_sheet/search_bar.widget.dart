import 'dart:async';

import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:immich_mobile/providers/photos_filter/search_focus.provider.dart';

/// Debounced search field (250 ms). Writes to `photosFilterProvider.context`.
class FilterSheetSearchBar extends ConsumerStatefulWidget {
  const FilterSheetSearchBar({super.key});

  @override
  ConsumerState<FilterSheetSearchBar> createState() => _FilterSheetSearchBarState();
}

class _FilterSheetSearchBarState extends ConsumerState<FilterSheetSearchBar> {
  late final TextEditingController _controller;
  late final FocusNode _focusNode;
  int _lastProcessedFocusRequest = 0;
  Timer? _debounce;

  static const _debounceMs = Duration(milliseconds: 250);

  @override
  void initState() {
    super.initState();
    _focusNode = FocusNode(debugLabel: 'FilterSheetSearchBar');
    _controller = TextEditingController(text: ref.read(photosFilterProvider).context ?? '');
    _controller.addListener(_onChanged);
  }

  void _onChanged() {
    _debounce?.cancel();
    _debounce = Timer(_debounceMs, () {
      if (!mounted) return;
      ref.read(photosFilterProvider.notifier).setText(_controller.text);
    });
    setState(() {}); // re-render to toggle clear button
  }

  void _clear() {
    _debounce?.cancel();
    _controller.removeListener(_onChanged);
    _controller.clear();
    _controller.addListener(_onChanged);
    ref.read(photosFilterProvider.notifier).setText('');
    setState(() {});
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _controller.removeListener(_onChanged);
    _controller.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Watch the counter: when it rises above our last-processed value, schedule
    // a post-frame requestFocus. `ref.watch` (not `ref.listen`) is deliberate —
    // it survives the race where the increment lands BEFORE this widget mounts
    // (e.g., `openGallerySearch` triggers sheet open from a non-Photos tab).
    final focusRequest = ref.watch(photosFilterSearchFocusRequestProvider);
    if (focusRequest > _lastProcessedFocusRequest) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        _focusNode.requestFocus();
        setState(() => _lastProcessedFocusRequest = focusRequest);
      });
    }

    ref.listen<String?>(photosFilterProvider.select((f) => f.context), (prev, next) {
      final v = next ?? '';
      if (_controller.text == v) return;
      _controller.removeListener(_onChanged);
      _controller.text = v;
      _controller.selection = TextSelection.collapsed(offset: v.length);
      _controller.addListener(_onChanged);
      setState(() {});
    });

    final hasText = _controller.text.isNotEmpty;
    return TextField(
      controller: _controller,
      focusNode: _focusNode,
      decoration: InputDecoration(
        isDense: true,
        hintText: 'filter_sheet_search_hint'.tr(),
        prefixIcon: const Icon(Icons.search_rounded, size: 20),
        suffixIcon: hasText
            ? IconButton(
                key: const Key('filter-sheet-search-clear'),
                icon: const Icon(Icons.close_rounded, size: 18),
                onPressed: _clear,
                tooltip: 'remove_filter'.tr(),
              )
            : null,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide.none),
        filled: true,
        fillColor: Theme.of(context).colorScheme.surfaceContainer,
      ),
      textInputAction: TextInputAction.search,
      onSubmitted: (_) => FocusScope.of(context).unfocus(),
    );
  }
}
