import 'package:flutter/material.dart';
import 'package:immich_mobile/gallery/motion/motion_tokens.dart';

/// Motion for arriving in the app shell (from the splash screen or after login) and for switching tabs.
abstract final class GalleryTransitions {
  /// How long the shell takes to settle in.
  static const shellDuration = Duration(milliseconds: 420);

  /// How long a tab switch takes. Upstream's tab shell cross-fades for 600ms from an empty frame.
  static const tabDuration = Duration(milliseconds: 260);

  /// The shell arrives by fading in while settling from slightly larger, so the splash dissolves into
  /// the timeline's skeleton instead of a page sliding in from the side.
  ///
  /// When a page is pushed on top of the shell, the shell still makes the platform's usual exit
  /// (iOS parallax, Android fade-forwards): [secondaryAnimation] goes to the theme's builder.
  static Widget shell(
    BuildContext context,
    Animation<double> animation,
    Animation<double> secondaryAnimation,
    Widget child,
  ) {
    final route = ModalRoute.of(context);
    final exit = route is PageRoute
        ? Theme.of(
            context,
          ).pageTransitionsTheme.buildTransitions(route, context, kAlwaysCompleteAnimation, secondaryAnimation, child)
        : child;
    return _settleIn(context, animation, exit, fromScale: 1.04);
  }

  /// Tab switch: the new tab fades in quickly while settling from slightly smaller.
  static Widget tab(BuildContext context, Widget child, Animation<double> animation) =>
      _settleIn(context, animation, child, fromScale: 0.985);

  static Widget _settleIn(
    BuildContext context,
    Animation<double> animation,
    Widget child, {
    required double fromScale,
  }) {
    final fade = CurvedAnimation(
      parent: animation,
      curve: const Interval(0, 0.6, curve: GalleryMotion.standard),
    );
    if (GalleryMotion.reduced(context)) {
      return FadeTransition(opacity: fade, child: child);
    }
    final scale = Tween<double>(
      begin: fromScale,
      end: 1,
    ).animate(CurvedAnimation(parent: animation, curve: GalleryMotion.settle));
    return FadeTransition(
      opacity: fade,
      child: ScaleTransition(scale: scale, child: child),
    );
  }
}
