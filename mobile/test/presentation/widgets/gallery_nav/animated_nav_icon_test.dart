import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/presentation/widgets/gallery_nav/animated_nav_icon.widget.dart';

void main() {
  testWidgets('idle: only the outlined icon is visible', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Material(
          child: AnimatedNavIcon(
            idleIcon: Icons.photo_library_outlined,
            activeIcon: Icons.photo_library,
            active: false,
            size: 22,
            color: Colors.black,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    final crossFade = tester.widget<AnimatedCrossFade>(find.byType(AnimatedCrossFade));
    expect(crossFade.crossFadeState, CrossFadeState.showFirst);
    expect(find.byIcon(Icons.photo_library_outlined), findsOneWidget);
  });

  testWidgets('active: only the filled icon is visible', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Material(
          child: AnimatedNavIcon(
            idleIcon: Icons.photo_library_outlined,
            activeIcon: Icons.photo_library,
            active: true,
            size: 22,
            color: Colors.black,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    final crossFade = tester.widget<AnimatedCrossFade>(find.byType(AnimatedCrossFade));
    expect(crossFade.crossFadeState, CrossFadeState.showSecond);
    expect(find.byIcon(Icons.photo_library), findsOneWidget);
  });

  testWidgets('transition: both icons are in the tree mid-crossfade', (tester) async {
    final active = ValueNotifier<bool>(false);
    await tester.pumpWidget(
      MaterialApp(
        home: Material(
          child: ValueListenableBuilder<bool>(
            valueListenable: active,
            builder: (_, v, __) => AnimatedNavIcon(
              idleIcon: Icons.photo_library_outlined,
              activeIcon: Icons.photo_library,
              active: v,
              size: 22,
              color: Colors.black,
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    active.value = true;
    await tester.pump(const Duration(milliseconds: 110)); // halfway
    expect(find.byIcon(Icons.photo_library_outlined), findsOneWidget);
    expect(find.byIcon(Icons.photo_library), findsOneWidget);
  });

  testWidgets('duration is 220ms', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Material(
          child: AnimatedNavIcon(
            idleIcon: Icons.photo_library_outlined,
            activeIcon: Icons.photo_library,
            active: false,
            size: 22,
            color: Colors.black,
          ),
        ),
      ),
    );
    final crossFade = tester.widget<AnimatedCrossFade>(find.byType(AnimatedCrossFade));
    expect(crossFade.duration, const Duration(milliseconds: 220));
  });
}
