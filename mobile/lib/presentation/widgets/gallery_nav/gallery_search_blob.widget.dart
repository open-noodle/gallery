import 'dart:ui' as ui;

import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';

class GallerySearchBlob extends StatefulWidget {
  final bool enabled;
  final VoidCallback onTap;

  const GallerySearchBlob({super.key, required this.enabled, required this.onTap});

  @override
  State<GallerySearchBlob> createState() => _GallerySearchBlobState();
}

class _GallerySearchBlobState extends State<GallerySearchBlob> {
  static const _diameter = 54.0;
  bool _pressed = false;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final iconColor = _pressed ? theme.colorScheme.primary : theme.colorScheme.onSurface.withValues(alpha: 0.85);

    return Semantics(
      container: true,
      button: true,
      enabled: widget.enabled,
      label: 'nav_search_photos_hint'.tr(),
      child: Opacity(
        opacity: widget.enabled ? 1.0 : 0.3,
        child: IgnorePointer(
          ignoring: !widget.enabled,
          child: Listener(
            onPointerDown: (_) => setState(() => _pressed = true),
            onPointerUp: (_) => setState(() => _pressed = false),
            onPointerCancel: (_) => setState(() => _pressed = false),
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: widget.onTap,
              child: ClipRRect(
                borderRadius: BorderRadius.circular(_diameter / 2),
                child: BackdropFilter(
                  filter: ui.ImageFilter.blur(sigmaX: 28, sigmaY: 28),
                  child: Container(
                    width: _diameter,
                    height: _diameter,
                    decoration: BoxDecoration(
                      color: theme.brightness == Brightness.dark
                          ? theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.68)
                          : theme.colorScheme.surface.withValues(alpha: 0.9),
                      shape: BoxShape.circle,
                      border: Border.all(color: theme.colorScheme.outlineVariant.withValues(alpha: 0.55), width: 1),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withValues(alpha: 0.7),
                          offset: const Offset(0, 20),
                          blurRadius: 44,
                          spreadRadius: -14,
                        ),
                        BoxShadow(
                          color: Colors.black.withValues(alpha: 0.4),
                          offset: const Offset(0, 4),
                          blurRadius: 8,
                        ),
                      ],
                    ),
                    child: Center(child: Icon(Icons.search, size: 24, color: iconColor)),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
