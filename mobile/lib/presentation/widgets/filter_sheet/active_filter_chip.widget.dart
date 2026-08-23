import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/widgets/images/remote_image_provider.dart';
import 'package:immich_mobile/providers/photos_filter/active_chips.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:immich_mobile/utils/image_url_builder.dart';

/// Renders a single active-filter chip for the timeline subheader.
///
/// Leading widget switches on [ChipVisual]:
///   * person  — up to 3 overlapping avatars.
///   * tag     — 8pt seeded-colour dot.
///   * location/rating/media/toggle/text — icon from spec.
///   * when    — no leading; label uses tabular figures.
///
/// Trailing × calls [onRemove] when provided, otherwise removes [spec.id].
class ActiveFilterChip extends ConsumerWidget {
  final ActiveChipSpec spec;
  final VoidCallback? onRemove;
  const ActiveFilterChip({super.key, required this.spec, this.onRemove});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    void removeChip() {
      unawaited(HapticFeedback.selectionClick());
      final callback = onRemove;
      if (callback != null) {
        callback();
      } else {
        ref.read(photosFilterProvider.notifier).removeChip(spec.id);
      }
    }

    final displayLabel = spec.labelIsKey ? spec.label.tr() : spec.label;

    return Semantics(
      button: true,
      label: spec.semanticsLabel ?? '$displayLabel, ${context.t.remove_filter}',
      onTap: removeChip,
      child: ExcludeSemantics(
        child: Material(
          color: theme.colorScheme.surfaceContainer,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(999),
            side: BorderSide(color: theme.colorScheme.outlineVariant),
          ),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                _leading(context),
                if (_needsLeadingGap) const SizedBox(width: 8),
                Flexible(
                  child: Text(
                    displayLabel,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: spec.visual == ChipVisual.when
                        ? theme.textTheme.labelLarge?.copyWith(
                            fontFeatures: const [FontFeature.tabularFigures()],
                            letterSpacing: 0.4,
                          )
                        : theme.textTheme.labelLarge,
                  ),
                ),
                const SizedBox(width: 6),
                InkWell(
                  customBorder: const CircleBorder(),
                  onTap: removeChip,
                  child: Padding(
                    padding: const EdgeInsets.all(4),
                    child: Icon(Icons.close_rounded, size: 16, color: theme.colorScheme.onSurfaceVariant),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  bool get _needsLeadingGap => spec.visual != ChipVisual.when;

  Widget _leading(BuildContext context) {
    switch (spec.visual) {
      case ChipVisual.person:
        final ids = spec.avatarPersonIds ?? const <String>[];
        // Index-aligned with ids (see ActiveChipSpec.avatarPersonSpaceIds). A shorter/absent list
        // degrades to null → owner endpoint, matching a personal person.
        final spaceIds = spec.avatarPersonSpaceIds ?? const <String?>[];
        final width = ids.isEmpty ? 0.0 : 18.0 + (ids.length - 1) * 14.0;
        return SizedBox(
          width: width,
          height: 18,
          child: Stack(
            children: [
              for (int i = 0; i < ids.length; i++)
                Positioned(
                  left: i * 14.0,
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      border: Border.all(color: Theme.of(context).colorScheme.surface, width: 1.5),
                    ),
                    child: CircleAvatar(
                      radius: 9,
                      backgroundImage: RemoteImageProvider(
                        url: getFilterPersonThumbnailUrl(ids[i], spaceId: i < spaceIds.length ? spaceIds[i] : null),
                      ),
                    ),
                  ),
                ),
            ],
          ),
        );
      case ChipVisual.tag:
        final seed = spec.tagDotSeed ?? 0;
        final color = Color((seed & 0xFFFFFF) | 0xFF000000);
        return Container(
          key: const Key('tag-dot'),
          width: 8,
          height: 8,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        );
      case ChipVisual.when:
        return const SizedBox.shrink();
      case ChipVisual.location:
      case ChipVisual.camera:
      case ChipVisual.rating:
      case ChipVisual.media:
      case ChipVisual.toggle:
      case ChipVisual.text:
        return Icon(
          spec.icon ?? Icons.label_outline_rounded,
          size: 16,
          color: Theme.of(context).colorScheme.onSurfaceVariant,
        );
    }
  }
}
