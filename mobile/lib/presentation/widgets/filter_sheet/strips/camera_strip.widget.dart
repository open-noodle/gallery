import 'dart:async';
import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/strips/strip_scaffold.widget.dart';
import 'package:immich_mobile/providers/photos_filter/filter_debounce.provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_suggestions.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:immich_mobile/routing/router.dart';

/// Strip cap: at most this many make tiles render before a trailing "+N"
/// tile takes over, opening the full-screen picker instead of an unbounded
/// ListView.
const int _kStripCap = 10;

class CameraStrip extends ConsumerWidget {
  const CameraStrip({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final filter = ref.watch(photosFilterDebouncedProvider);
    final async = ref.watch(photosFilterSuggestionsProvider(filter));
    final items = async.whenData((s) => s.cameraMakes);

    return StripScaffold(
      titleKey: 'filter_sheet_camera',
      items: items,
      height: 84,
      onRetry: () => ref.invalidate(photosFilterSuggestionsProvider(filter)),
      childBuilder: (data) {
        final makes = data.cast<String>();
        final shown = makes.take(_kStripCap).toList();
        final overflow = makes.length - shown.length;
        return ListView.separated(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 20),
          itemCount: shown.length + (overflow > 0 ? 1 : 0),
          separatorBuilder: (_, _) => const SizedBox(width: 10),
          itemBuilder: (ctx, i) => i < shown.length ? _MakeTile(make: shown[i]) : _MoreMakeTile(count: overflow),
        );
      },
    );
  }
}

class _MoreMakeTile extends StatelessWidget {
  final int count;
  const _MoreMakeTile({required this.count});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return SizedBox(
      key: const Key('camera-strip-more'),
      width: 104,
      height: 72,
      child: Material(
        color: theme.colorScheme.surfaceContainerHigh,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: () {
            unawaited(HapticFeedback.selectionClick());
            unawaited(context.pushRoute(const CameraPickerRoute()));
          },
          child: Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  '+$count',
                  style: theme.textTheme.titleMedium?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  context.t.all,
                  textAlign: TextAlign.center,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.labelSmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _MakeTile extends ConsumerWidget {
  final String make;
  const _MakeTile({required this.make});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final isSelected = ref.watch(photosFilterProvider.select((f) => f.camera.make == make));
    return SizedBox(
      width: 104,
      height: 72,
      child: Material(
        key: const Key('camera-tile'),
        color: theme.colorScheme.surfaceContainerHigh,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
          side: isSelected ? BorderSide(color: theme.colorScheme.primary, width: 2) : BorderSide.none,
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: () {
            unawaited(HapticFeedback.selectionClick());
            if (isSelected) {
              ref.read(photosFilterProvider.notifier).setCamera(null);
            } else {
              ref.read(photosFilterProvider.notifier).setCamera(SearchCameraFilter(make: make));
            }
          },
          child: Stack(
            children: [
              Positioned.fill(
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                      colors: [Colors.transparent, Colors.black.withValues(alpha: 0.32)],
                    ),
                  ),
                ),
              ),
              Positioned(
                left: 10,
                right: 10,
                bottom: 8,
                child: Text(
                  make,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.labelLarge?.copyWith(
                    color: isSelected ? theme.colorScheme.primary : theme.colorScheme.onSurface,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
