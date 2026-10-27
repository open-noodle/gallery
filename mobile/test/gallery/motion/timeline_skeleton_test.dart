import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/gallery/motion/timeline_skeleton.dart';

const _exit = Key('gallery-timeline-skeleton-exit');

/// Shows the skeleton until [loaded] flips, like the timeline does when its segments arrive.
class _Host extends StatelessWidget {
  final ValueNotifier<bool> loaded;
  final bool reduceMotion;
  final double exitInsetBottom;

  const _Host({required this.loaded, this.reduceMotion = false, this.exitInsetBottom = 0});

  @override
  Widget build(BuildContext context) => MaterialApp(
    builder: (context, child) => MediaQuery(
      data: MediaQuery.of(context).copyWith(disableAnimations: reduceMotion),
      child: child!,
    ),
    home: Scaffold(
      body: ValueListenableBuilder<bool>(
        valueListenable: loaded,
        builder: (_, isLoaded, _) => isLoaded
            ? const SizedBox.expand(
                key: Key('content'),
                child: ColoredBox(color: Colors.red),
              )
            : GallerySkeletonGrid(exitInsetBottom: exitInsetBottom),
      ),
    ),
  );
}

/// The exit wave's state, read through its painter (the types are private to the library).
dynamic _wave(WidgetTester tester) => (tester.widget<CustomPaint>(find.byKey(_exit)).painter as dynamic).wave;

bool _playing(WidgetTester tester) => _wave(tester).isPlaying as bool;

Rect? _waveRect(WidgetTester tester) => _wave(tester).rect as Rect?;

void main() {
  testWidgets('the copy waits idle, plays when the content arrives, then removes itself', (tester) async {
    final loaded = ValueNotifier(false);
    await tester.pumpWidget(_Host(loaded: loaded));
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.byKey(const Key('gallery-timeline-skeleton')), findsOneWidget);
    expect(_playing(tester), isFalse);

    loaded.value = true;
    await tester.pump();
    expect(find.byKey(const Key('content')), findsOneWidget);
    expect(_playing(tester), isTrue);
    expect(_waveRect(tester), tester.getRect(find.byKey(const Key('content'))));

    // The wave never takes touches from the content under it.
    expect(find.ancestor(of: find.byKey(_exit), matching: find.byType(IgnorePointer)), findsWidgets);

    await tester.pump(const Duration(milliseconds: 600));
    await tester.pump();
    await tester.pump();
    expect(find.byKey(_exit), findsNothing);
  });

  testWidgets('the wave stops short of the floating nav', (tester) async {
    final loaded = ValueNotifier(false);
    await tester.pumpWidget(_Host(loaded: loaded, exitInsetBottom: 100));
    await tester.pump();
    final skeleton = tester.getRect(find.byKey(const Key('gallery-timeline-skeleton')));

    loaded.value = true;
    await tester.pump();
    final wave = _waveRect(tester)!;
    expect(wave.top, skeleton.top);
    expect(wave.height, skeleton.height - 100);
    await tester.pump(const Duration(seconds: 1));
    await tester.pump();
    await tester.pump();
  });

  testWidgets('with reduced motion the copy only fades, and quickly', (tester) async {
    final loaded = ValueNotifier(false);
    await tester.pumpWidget(_Host(loaded: loaded, reduceMotion: true));
    await tester.pump();
    loaded.value = true;
    await tester.pump();
    expect(_playing(tester), isTrue);
    await tester.pump(const Duration(milliseconds: 200));
    await tester.pump();
    await tester.pump();
    expect(find.byKey(_exit), findsNothing);
  });

  testWidgets('no wave when the skeleton leaves because its page is covered', (tester) async {
    final loaded = ValueNotifier(false);
    await tester.pumpWidget(_Host(loaded: loaded));
    await tester.pump();
    final navigator = tester.state<NavigatorState>(find.byType(Navigator));
    unawaited(navigator.push(MaterialPageRoute<void>(builder: (_) => const SizedBox())));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));

    loaded.value = true;
    await tester.pump();
    await tester.pump();
    await tester.pump();
    expect(find.byKey(_exit), findsNothing);
  });
}
