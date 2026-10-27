import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/gallery/motion/hero_scope.dart';
import 'package:immich_mobile/gallery/motion/motion_tokens.dart';
import 'package:immich_mobile/gallery/motion/spring_curve.dart';

void main() {
  test('the spring curve starts at 0, overshoots, and lands on 1', () {
    final curve = GallerySpringCurve(GalleryMotion.gentle);
    expect(curve.transform(0), 0);
    expect(curve.transform(1), 1);
    final peak = [for (var i = 1; i < 100; i++) curve.transform(i / 100)].reduce((a, b) => a > b ? a : b);
    // The gentle spring overshoots by about 7.6%.
    expect(peak, inInclusiveRange(1.05, 1.1));
  });

  test('the bouncy spring overshoots more than the gentle one', () {
    double peak(GallerySpringCurve c) =>
        [for (var i = 1; i < 100; i++) c.transform(i / 100)].reduce((a, b) => a > b ? a : b);
    expect(peak(GallerySpringCurve(GalleryMotion.bouncy)), greaterThan(peak(GallerySpringCurve(GalleryMotion.gentle))));
  });

  test('the spring rect tween passes its end before settling on it', () {
    final tween = SpringRectTween(begin: const Rect.fromLTWH(0, 0, 100, 100), end: const Rect.fromLTWH(0, 0, 200, 200));
    expect(tween.transform(0), const Rect.fromLTWH(0, 0, 100, 100));
    expect(tween.transform(1), const Rect.fromLTWH(0, 0, 200, 200));
    final widths = [for (var i = 1; i < 100; i++) tween.transform(i / 100)!.width];
    expect(widths.any((w) => w > 200), isTrue);
  });

  testWidgets('the scope hands its navigator a spring hero controller', (tester) async {
    late HeroController? controller;
    await tester.pumpWidget(
      MaterialApp(
        // Checked just above the navigator: a navigator hides the scope from its own pages.
        builder: (context, child) => GalleryHeroScope(
          child: Builder(
            builder: (context) {
              controller = HeroControllerScope.maybeOf(context);
              return child!;
            },
          ),
        ),
        home: const SizedBox(),
      ),
    );
    expect(controller, isNotNull);
    expect(controller!.createRectTween!(Rect.zero, const Rect.fromLTWH(0, 0, 10, 10)), isA<SpringRectTween>());
  });

  testWidgets('with reduced motion the hero flies straight', (tester) async {
    late HeroController? controller;
    await tester.pumpWidget(
      MaterialApp(
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(disableAnimations: true),
          child: GalleryHeroScope(
            child: Builder(
              builder: (context) {
                controller = HeroControllerScope.maybeOf(context);
                return child!;
              },
            ),
          ),
        ),
        home: const SizedBox(),
      ),
    );
    expect(controller!.createRectTween!(Rect.zero, const Rect.fromLTWH(0, 0, 10, 10)), isNot(isA<SpringRectTween>()));
  });
}
