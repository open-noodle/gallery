import 'package:flutter/widgets.dart';
import 'package:immich_mobile/gallery/motion/motion_tokens.dart';
import 'package:immich_mobile/gallery/motion/spring_curve.dart';

/// Gives the navigator below it a hero controller whose flights travel on the gentle spring: opening a
/// photo from the grid zooms it into the viewer and lands with a slight overshoot, and closing it
/// drops it back into its tile the same way. Size and position overshoot together, like a print
/// settling into place.
///
/// Heroes that set their own `createRectTween` keep it; every other hero in the app gets this one.
/// With reduced motion the flight is the plain straight-line tween.
class GalleryHeroScope extends StatefulWidget {
  final Widget child;

  const GalleryHeroScope({super.key, required this.child});

  @override
  State<GalleryHeroScope> createState() => _GalleryHeroScopeState();
}

class _GalleryHeroScopeState extends State<GalleryHeroScope> {
  static final _spring = GallerySpringCurve(GalleryMotion.gentle);

  bool _reduced = false;
  late final HeroController _controller = HeroController(
    createRectTween: (begin, end) =>
        _reduced ? RectTween(begin: begin, end: end) : SpringRectTween(begin: begin, end: end),
  );

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _reduced = GalleryMotion.reduced(context);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => HeroControllerScope(controller: _controller, child: widget.child);
}

/// A straight-line rect tween that follows the gentle spring, overshooting its end slightly.
class SpringRectTween extends RectTween {
  SpringRectTween({super.begin, super.end});

  @override
  Rect? lerp(double t) => super.lerp(_GalleryHeroScopeState._spring.transform(t));
}
