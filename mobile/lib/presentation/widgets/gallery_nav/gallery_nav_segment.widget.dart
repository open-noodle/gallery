import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:immich_mobile/presentation/widgets/gallery_nav/animated_nav_icon.widget.dart';
import 'package:immich_mobile/providers/gallery_nav/gallery_nav_destination.dart';
import 'package:immich_mobile/providers/gallery_nav/gallery_tab_enum.dart';

class GalleryNavSegment extends StatelessWidget {
  static const Duration _opacityAnimDuration = Duration(milliseconds: 220);
  static const Cubic _easing = Cubic(0.3, 0.6, 0.2, 1);

  final GalleryTabEnum tab;
  final bool active;
  final VoidCallback onTap;

  const GalleryNavSegment({super.key, required this.tab, required this.active, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final destination = GalleryNavDestination.forTab(tab);
    final color = active ? theme.colorScheme.primary : theme.colorScheme.onSurface.withValues(alpha: 0.55);

    return Semantics(
      container: true,
      button: true,
      selected: active,
      liveRegion: active,
      label: destination.labelKey.tr(),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(999),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
          child: Padding(
            padding: EdgeInsets.symmetric(horizontal: active ? 16 : 14),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                ClipRect(
                  child: Align(
                    key: const Key('gallery-nav-segment-icon-slot'),
                    alignment: AlignmentDirectional.centerStart,
                    widthFactor: active ? 1.0 : 0.0,
                    child: Padding(
                      padding: const EdgeInsetsDirectional.only(end: 6),
                      child: AnimatedOpacity(
                        opacity: active ? 1.0 : 0.0,
                        duration: _opacityAnimDuration,
                        curve: _easing,
                        child: AnimatedNavIcon(
                          idleIcon: destination.idleIcon,
                          activeIcon: destination.activeIcon,
                          active: active,
                          size: 22,
                          color: color,
                        ),
                      ),
                    ),
                  ),
                ),
                Text(
                  destination.labelKey.tr(),
                  style: TextStyle(color: color, fontSize: 13.5, fontWeight: FontWeight.w500, letterSpacing: 0.002),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
