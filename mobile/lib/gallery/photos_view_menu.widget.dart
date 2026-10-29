import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/timeline_grouping.model.dart';
import 'package:immich_mobile/gallery/library_view.model.dart';
import 'package:immich_mobile/gallery/library_view.provider.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_grouping_selector.widget.dart';
import 'package:immich_mobile/providers/timeline/timeline_grouping.provider.dart';

/// The Photos app-bar menu: the library view (#1038) and the grouping. Filters live in search mode. The button is no
/// wider than a tap target, which keeps the title slot and the logo one size (#1030).
class PhotosViewMenuButton extends ConsumerWidget {
  const PhotosViewMenuButton({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = Theme.of(context).colorScheme;
    final view = ref.watch(libraryViewVisibleProvider) ? ref.watch(activeLibraryViewProvider) : LibraryViewMode.both;
    // A view that narrows the timeline shows on the button.
    final (icon, narrowedBy) = switch (view) {
      LibraryViewMode.both => (Icons.more_horiz_rounded, null),
      LibraryViewMode.personal => (Icons.person_outline_rounded, context.t.library_view_personal),
      LibraryViewMode.spaces => (Icons.workspaces_outlined, context.t.library_view_spaces),
    };

    return MergeSemantics(
      child: Semantics(
        value: narrowedBy,
        child: IconButton(
          key: const Key('photos-view-menu-button'),
          tooltip: context.t.display_options,
          icon: Icon(icon, size: 22),
          style: IconButton.styleFrom(
            fixedSize: const Size(44, 40),
            backgroundColor: colors.surfaceContainerHighest,
            foregroundColor: colors.onSurface,
            shape: StadiumBorder(side: BorderSide(color: colors.outlineVariant.withValues(alpha: 0.7))),
          ),
          onPressed: () => unawaited(_open(context)),
        ),
      ),
    );
  }

  /// A route of its own rather than an overlay anchored to the button: every choice reloads the timeline, which
  /// rebuilds the app bar, and the menu stays open across that. It reads app-wide providers only (the Photos route
  /// shares its grouping), so it does not depend on the button's scope.
  Future<void> _open(BuildContext context) {
    final box = context.findRenderObject()! as RenderBox;
    final anchor = box.localToGlobal(Offset.zero) & box.size;
    final rtl = Directionality.of(context) == TextDirection.rtl;
    final endInset = rtl ? anchor.left : MediaQuery.sizeOf(context).width - anchor.right;
    unawaited(HapticFeedback.selectionClick());
    return showGeneralDialog<void>(
      context: context,
      barrierDismissible: true,
      barrierLabel: MaterialLocalizations.of(context).modalBarrierDismissLabel,
      barrierColor: Colors.transparent,
      anchorPoint: anchor.center,
      transitionDuration: MediaQuery.disableAnimationsOf(context) ? Duration.zero : const Duration(milliseconds: 150),
      pageBuilder: (_, _, _) => _PhotosViewMenu(top: anchor.bottom + 6, endInset: endInset),
      transitionBuilder: (_, animation, _, child) => FadeTransition(
        opacity: CurvedAnimation(parent: animation, curve: Curves.easeOut),
        child: child,
      ),
    );
  }
}

class _PhotosViewMenu extends ConsumerWidget {
  const _PhotosViewMenu({required this.top, required this.endInset});

  final double top;
  final double endInset;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final media = MediaQuery.of(context);
    final width = math.min(300.0, media.size.width - 16);
    // Under the button, sliding over the actions beside it when the screen is narrow.
    final end = endInset.clamp(8.0, media.size.width - 8 - width);
    final labelWidth = width - 104;
    final showView = ref.watch(libraryViewVisibleProvider);
    final view = ref.watch(libraryViewProvider);
    final grouping = ref.watch(timelineOverviewModeProvider);

    return Stack(
      children: [
        PositionedDirectional(
          top: top,
          end: end,
          width: width,
          child: ConstrainedBox(
            constraints: BoxConstraints(maxHeight: media.size.height - top - media.padding.bottom - 8),
            child: Material(
              key: const Key('photos-view-menu'),
              color: theme.colorScheme.surfaceContainer,
              elevation: 8,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(20),
                side: BorderSide(color: theme.colorScheme.outlineVariant.withValues(alpha: 0.6)),
              ),
              clipBehavior: Clip.antiAlias,
              child: SingleChildScrollView(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (showView) ...[
                      _Header(context.t.library_view),
                      for (final (mode, label, hint, icon) in [
                        (LibraryViewMode.both, context.t.library_view_both, null, Icons.photo_library_outlined),
                        (
                          LibraryViewMode.personal,
                          context.t.library_view_personal,
                          context.t.library_view_personal_description,
                          Icons.person_outline_rounded,
                        ),
                        (
                          LibraryViewMode.spaces,
                          context.t.library_view_spaces,
                          context.t.library_view_spaces_description,
                          Icons.workspaces_outlined,
                        ),
                      ])
                        _Choice(
                          key: Key('photos-view-library-${mode.name}'),
                          label: label,
                          hint: hint,
                          labelWidth: labelWidth,
                          icon: icon,
                          selected: view == mode,
                          onPressed: () => unawaited(ref.read(libraryViewProvider.notifier).set(mode)),
                        ),
                      const Divider(height: 16),
                    ],
                    _Header(context.t.timeline_grouping_selector),
                    for (final mode in timelineOverviewModeSelectorOrder)
                      _Choice(
                        key: Key('photos-view-grouping-${mode.name}'),
                        label: timelineGroupingLabel(mode),
                        labelWidth: labelWidth,
                        icon: switch (mode) {
                          TimelineOverviewMode.years => Icons.calendar_today_outlined,
                          TimelineOverviewMode.months => Icons.calendar_view_month_outlined,
                          TimelineOverviewMode.all => Icons.calendar_view_day_outlined,
                        },
                        selected: grouping == mode,
                        onPressed: () => unawaited(ref.read(timelineOverviewModeProvider.notifier).set(mode)),
                      ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _Header extends StatelessWidget {
  const _Header(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
      child: Semantics(
        header: true,
        child: Text(text, style: theme.textTheme.labelMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
      ),
    );
  }
}

class _Choice extends StatelessWidget {
  const _Choice({
    super.key,
    required this.label,
    required this.labelWidth,
    required this.icon,
    required this.selected,
    required this.onPressed,
    this.hint,
  });

  final String label;
  final String? hint;
  // A menu item does not let its label flex, so the label takes the width the menu leaves it.
  final double labelWidth;
  final IconData icon;
  final bool selected;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return MergeSemantics(
      child: Semantics(
        // One choice of a set, as screen readers announce a radio group.
        selected: selected,
        inMutuallyExclusiveGroup: true,
        child: MenuItemButton(
          style: hint == null
              ? null
              : MenuItemButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8)),
          leadingIcon: SizedBox(
            width: 24,
            child: selected ? Icon(Icons.check_rounded, size: 20, color: theme.colorScheme.primary) : null,
          ),
          trailingIcon: Icon(icon, size: 20),
          onPressed: () {
            unawaited(HapticFeedback.selectionClick());
            onPressed();
          },
          child: SizedBox(
            width: labelWidth,
            child: hint == null
                ? Text(label)
                : Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(label),
                      Text(
                        hint!,
                        style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                      ),
                    ],
                  ),
          ),
        ),
      ),
    );
  }
}
