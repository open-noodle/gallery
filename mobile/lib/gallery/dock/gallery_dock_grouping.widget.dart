import 'dart:async';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/dock/gallery_dock_style.dart';
import 'package:immich_mobile/gallery/library_view.model.dart';
import 'package:immich_mobile/gallery/library_view.provider.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_grouping_selector.widget.dart';

/// A grouping row: the shared [TimelineGroupingSelector] filling the row and an optional round button at the end
/// ([GalleryDockRowButton]). The Photos dock puts display options there, the detail pages' pill puts search. The
/// button's slot opens and closes on the dock's spring. Sits on a [GalleryGlass] its host paints.
class GalleryGroupingRow extends StatelessWidget {
  final Widget? trailing;
  final bool showTrailing;

  const GalleryGroupingRow({super.key, this.trailing, this.showTrailing = true});

  static const double padding = 4;

  @override
  Widget build(BuildContext context) {
    final (duration, curve) = GalleryDockStyle.motion(context);
    final show = trailing != null && showTrailing;
    const size = GalleryDockRowButton.size;

    return Padding(
      padding: const EdgeInsets.all(padding),
      child: Row(
        children: [
          const Expanded(child: TimelineGroupingSelector(bare: true)),
          // The clamp keeps the spring's overshoot from giving the slot a negative width.
          TweenAnimationBuilder<double>(
            tween: Tween(end: show ? 1 : 0),
            duration: duration,
            curve: curve,
            builder: (context, t, child) {
              final v = t.clamp(0.0, 1.0);
              if (v == 0) {
                return const SizedBox.shrink();
              }
              return SizedBox(
                width: (size + padding) * v,
                height: size,
                child: ClipRect(
                  child: OverflowBox(
                    alignment: AlignmentDirectional.centerEnd,
                    minWidth: size,
                    maxWidth: size,
                    child: Opacity(opacity: v, child: child),
                  ),
                ),
              );
            },
            child: IgnorePointer(ignoring: !show, child: trailing),
          ),
        ],
      ),
    );
  }
}

/// The dock's grouping row, with display options at the end while the dock is unfolded.
class GalleryDockGrouping extends ConsumerWidget {
  /// Whether the display-options button shows: the unfolded dock only.
  final bool showOptions;

  const GalleryDockGrouping({super.key, required this.showOptions});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Until one of the user's spaces is on their timeline there is nothing to choose, so the button stays away.
    final options = showOptions && ref.watch(libraryViewVisibleProvider);
    return GalleryGroupingRow(trailing: const _OptionsButton(), showTrailing: options);
  }
}

class _OptionsButton extends ConsumerWidget {
  const _OptionsButton();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final view = ref.watch(activeLibraryViewProvider);
    return GalleryDockRowButton(
      key: const Key('gallery-dock-options'),
      icon: Icons.tune_rounded,
      label: context.t.display_options,
      value: switch (view) {
        LibraryViewMode.both => null,
        LibraryViewMode.personal => context.t.library_view_personal,
        LibraryViewMode.spaces => context.t.library_view_spaces,
      },
      // A view that narrows the timeline tints the button.
      active: view != LibraryViewMode.both,
      onTap: () => unawaited(_openDockViewMenu(context)),
    );
  }
}

/// Opens upwards from the button: the dock sits at the bottom of the screen.
Future<void> _openDockViewMenu(BuildContext context) {
  final box = context.findRenderObject()! as RenderBox;
  final anchor = box.localToGlobal(Offset.zero) & box.size;
  final size = MediaQuery.sizeOf(context);
  final rtl = Directionality.of(context) == TextDirection.rtl;
  final endInset = rtl ? anchor.left : size.width - anchor.right;
  final reduced = MediaQuery.disableAnimationsOf(context);
  unawaited(HapticFeedback.selectionClick());
  return showGeneralDialog<void>(
    context: context,
    barrierDismissible: true,
    barrierLabel: MaterialLocalizations.of(context).modalBarrierDismissLabel,
    barrierColor: Colors.transparent,
    anchorPoint: anchor.center,
    transitionDuration: reduced ? Duration.zero : const Duration(milliseconds: 280),
    pageBuilder: (_, _, _) => _DockViewMenu(bottom: size.height - anchor.top + 10, endInset: endInset),
    transitionBuilder: (_, animation, _, child) => FadeTransition(
      opacity: CurvedAnimation(
        parent: animation,
        curve: const Interval(0, 0.6, curve: Curves.easeOut),
      ),
      child: ScaleTransition(
        scale: Tween(begin: 0.85, end: 1.0).animate(CurvedAnimation(parent: animation, curve: Curves.easeOutBack)),
        alignment: rtl ? const Alignment(-0.7, 1) : const Alignment(0.7, 1),
        child: child,
      ),
    ),
  );
}

class _DockViewMenu extends ConsumerWidget {
  final double bottom;
  final double endInset;

  const _DockViewMenu({required this.bottom, required this.endInset});

  static const _radius = BorderRadius.all(Radius.circular(24));

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final dark = theme.brightness == Brightness.dark;
    final width = math.min(250.0, MediaQuery.sizeOf(context).width - 16);
    final view = ref.watch(libraryViewProvider);

    return Stack(
      children: [
        PositionedDirectional(
          bottom: bottom,
          end: math.max(8, endInset - 8),
          width: width,
          child: DecoratedBox(
            decoration: BoxDecoration(
              borderRadius: _radius,
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: dark ? 0.45 : 0.18),
                  offset: const Offset(0, 10),
                  blurRadius: 28,
                  spreadRadius: -8,
                ),
              ],
            ),
            child: ClipRRect(
              borderRadius: _radius,
              child: BackdropFilter(
                filter: ui.ImageFilter.blur(sigmaX: 28, sigmaY: 28),
                child: Material(
                  key: const Key('gallery-dock-view-menu'),
                  color: dark
                      ? theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.72)
                      : theme.colorScheme.surface.withValues(alpha: 0.92),
                  shape: RoundedRectangleBorder(
                    borderRadius: _radius,
                    side: BorderSide(color: theme.colorScheme.outlineVariant.withValues(alpha: 0.55)),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(8),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Padding(
                          padding: const EdgeInsets.fromLTRB(10, 6, 10, 6),
                          child: Semantics(
                            header: true,
                            child: Text(
                              context.t.library_view_assets_shown.toUpperCase(),
                              style: theme.textTheme.labelSmall?.copyWith(
                                color: theme.colorScheme.onSurfaceVariant,
                                fontWeight: FontWeight.w600,
                                letterSpacing: 0.6,
                              ),
                            ),
                          ),
                        ),
                        for (final (mode, label, icon) in [
                          (LibraryViewMode.both, context.t.library_view_show_everything, Icons.photo_library_outlined),
                          (
                            LibraryViewMode.personal,
                            context.t.library_view_show_personal,
                            Icons.person_outline_rounded,
                          ),
                          (LibraryViewMode.spaces, context.t.library_view_show_spaces, Icons.workspaces_outlined),
                        ])
                          _MenuChoice(
                            key: Key('gallery-dock-view-${mode.name}'),
                            label: label,
                            icon: icon,
                            selected: view == mode,
                            onTap: () {
                              unawaited(HapticFeedback.selectionClick());
                              unawaited(ref.read(libraryViewProvider.notifier).set(mode));
                              Navigator.of(context).pop();
                            },
                          ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _MenuChoice extends StatelessWidget {
  final String label;
  final IconData icon;
  final bool selected;
  final VoidCallback onTap;

  const _MenuChoice({super.key, required this.label, required this.icon, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Semantics(
      selected: selected,
      inMutuallyExclusiveGroup: true,
      button: true,
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
          child: Row(
            children: [
              Icon(icon, size: 20, color: selected ? theme.colorScheme.primary : theme.colorScheme.onSurfaceVariant),
              const SizedBox(width: 12),
              Expanded(child: Text(label, style: theme.textTheme.bodyLarge)),
              Opacity(
                opacity: selected ? 1 : 0,
                child: Icon(Icons.check_rounded, size: 20, color: theme.colorScheme.primary),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
