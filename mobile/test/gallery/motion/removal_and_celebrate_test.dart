import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/gallery/motion/celebrate.dart';
import 'package:immich_mobile/gallery/motion/gallery_tile.dart';
import 'package:immich_mobile/gallery/motion/motion_host.dart';
import 'package:immich_mobile/gallery/motion/removal.dart';

import '../../test_utils.dart';

const _layer = Key('gallery-removal');

/// The photos currently in the "timeline", and a generation that rebuilds every tile from scratch.
class _Grid {
  final shown = ValueNotifier<List<String>>(['a', 'b']);
  final generation = ValueNotifier<int>(0);
}

/// Photo tiles in a page that attaches the motion host, like the app shell does.
class _Host extends StatefulWidget {
  final _Grid grid;

  const _Host(this.grid);

  @override
  State<_Host> createState() => _HostState();
}

class _HostState extends State<_Host> {
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    GalleryMotionHost.attach(Overlay.of(context, rootOverlay: true));
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: Listenable.merge([widget.grid.shown, widget.grid.generation]),
    builder: (_, _) => Row(
      children: [
        for (final id in widget.grid.shown.value)
          SizedBox(
            key: ValueKey('$id-${widget.grid.generation.value}'),
            width: 100,
            height: 100,
            child: GalleryTile(
              asset: TestUtils.createRemoteAsset(id: id),
              child: ColoredBox(key: Key('photo-$id'), color: Colors.blue),
            ),
          ),
      ],
    ),
  );
}

Widget _app(_Grid grid, {bool reduceMotion = false}) => MaterialApp(
  builder: (context, child) => MediaQuery(
    data: MediaQuery.of(context).copyWith(disableAnimations: reduceMotion),
    child: child!,
  ),
  home: Scaffold(body: _Host(grid)),
);

Finder _copyOf(String id) => find.descendant(of: find.byKey(_layer), matching: find.byKey(Key('photo-$id')));

void main() {
  tearDown(GalleryMotionHost.debugReset);

  testWidgets('a copy rests over its tile until the tile leaves, then flies to the last press', (tester) async {
    final grid = _Grid();
    await tester.pumpWidget(_app(grid));
    await tester.tapAt(const Offset(700, 550));
    await tester.pump();

    GalleryRemoval.send(['a', 'missing']);
    await tester.pump();
    // Only the photo on screen is copied, and it sits exactly over its tile.
    expect(_copyOf('a'), findsOneWidget);
    expect(_copyOf('b'), findsNothing);
    await tester.pump(const Duration(milliseconds: 300));
    expect(tester.getCenter(_copyOf('a')), const Offset(50, 50));

    // The change syncs: the timeline drops the tile.
    grid.shown.value = ['b'];
    await tester.pump();
    await tester.pump();
    final start = tester.getCenter(_copyOf('a'));
    await tester.pump(const Duration(milliseconds: 530));
    final late = tester.getCenter(_copyOf('a'));
    expect((late - const Offset(700, 550)).distance, lessThan((start - const Offset(700, 550)).distance / 4));

    await tester.pump(const Duration(milliseconds: 100));
    await tester.pump();
    expect(find.byKey(_layer), findsNothing);
  });

  testWidgets('a failed request never plays, and the copy goes away unseen', (tester) async {
    final grid = _Grid();
    await tester.pumpWidget(_app(grid));
    GalleryRemoval.send(['a']);
    await tester.pump();
    expect(_copyOf('a'), findsOneWidget);

    await tester.pump(const Duration(seconds: 3));
    expect(tester.getCenter(_copyOf('a')), const Offset(50, 50));
    await tester.pump(GalleryRemoval.armedFor);
    await tester.pump();
    expect(find.byKey(_layer), findsNothing);
  });

  testWidgets('a grid rebuild that keeps the photo does not throw it', (tester) async {
    final grid = _Grid();
    await tester.pumpWidget(_app(grid));
    GalleryRemoval.send(['a']);
    await tester.pump();

    grid.generation.value++;
    await tester.pump();
    await tester.pump();
    expect(_copyOf('a'), findsNothing);
    await tester.pump();
    expect(find.byKey(_layer), findsNothing);
  });

  testWidgets('a sync faster than the first frame still plays', (tester) async {
    final grid = _Grid();
    await tester.pumpWidget(_app(grid));
    GalleryRemoval.send(['a']);
    grid.shown.value = ['b'];
    await tester.pump();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));
    expect(_copyOf('a'), findsOneWidget);
    expect(tester.getCenter(_copyOf('a')), isNot(const Offset(50, 50)));
    await tester.pumpAndSettle();
    expect(find.byKey(_layer), findsNothing);
  });

  testWidgets('deleting permanently dissolves in place', (tester) async {
    final grid = _Grid();
    await tester.pumpWidget(_app(grid));
    GalleryRemoval.dissolve(['a', 'b']);
    await tester.pump();
    grid.shown.value = [];
    await tester.pump();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 150));
    expect(find.descendant(of: find.byKey(_layer), matching: find.byType(ImageFiltered)), findsNWidgets(2));
    expect(tester.getCenter(_copyOf('a')), const Offset(50, 50));
    await tester.pumpAndSettle();
    expect(find.byKey(_layer), findsNothing);
  });

  testWidgets('photos on a covered page are not thrown', (tester) async {
    final grid = _Grid();
    await tester.pumpWidget(_app(grid));
    final navigator = tester.state<NavigatorState>(find.byType(Navigator));
    navigator.push(MaterialPageRoute<void>(builder: (_) => const SizedBox())).ignore();
    await tester.pumpAndSettle();

    GalleryRemoval.send(['a']);
    await tester.pump();
    expect(find.byKey(_layer), findsNothing);
  });

  testWidgets('a favourite bursts from the press, and not with reduced motion', (tester) async {
    final grid = _Grid();
    await tester.pumpWidget(_app(grid));
    await tester.tapAt(const Offset(300, 300));
    GalleryCelebrate.favorite();
    await tester.pump();
    expect(find.byKey(const Key('gallery-celebrate')), findsOneWidget);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('gallery-celebrate')), findsNothing);

    GalleryCelebrate.favorite(when: false);
    await tester.pump();
    expect(find.byKey(const Key('gallery-celebrate')), findsNothing);

    GalleryMotionHost.debugReset();
    await tester.pumpWidget(_app(_Grid(), reduceMotion: true));
    GalleryCelebrate.favorite();
    await tester.pump();
    expect(find.byKey(const Key('gallery-celebrate')), findsNothing);
  });

  testWidgets('a copy flies to the given target instead of the last press', (tester) async {
    final grid = _Grid();
    await tester.pumpWidget(_app(grid));
    await tester.tapAt(const Offset(700, 550));
    await tester.pump();

    GalleryRemoval.send(['a'], target: const Offset(40, 700));
    await tester.pump();
    grid.shown.value = ['b'];
    await tester.pump();
    await tester.pump();
    final start = tester.getCenter(_copyOf('a'));
    await tester.pump(const Duration(milliseconds: 530));
    const target = Offset(40, 700);
    final late = tester.getCenter(_copyOf('a'));
    expect((late - target).distance, lessThan((start - target).distance / 4));
    expect((late - target).distance, lessThan((late - const Offset(700, 550)).distance));
    await tester.pumpAndSettle();
  });

  testWidgets('a tile known only by its remote id can be removed', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) {
              GalleryMotionHost.attach(Overlay.of(context, rootOverlay: true));
              return const SizedBox(
                width: 100,
                height: 100,
                child: GalleryTile(
                  remoteId: 'x',
                  child: ColoredBox(key: Key('photo-x'), color: Colors.red),
                ),
              );
            },
          ),
        ),
      ),
    );
    expect(GalleryTile.live('x'), hasLength(1));
    GalleryRemoval.dissolve(['x']);
    await tester.pump();
    expect(_copyOf('x'), findsOneWidget);
  });

  testWidgets('a finished day bursts confetti from the given point for about a second, never with reduced motion', (
    tester,
  ) async {
    final grid = _Grid();
    await tester.pumpWidget(_app(grid));
    GalleryCelebrate.dayComplete(origin: const Offset(200, 300), colors: const [Colors.green, Colors.red]);
    await tester.pump();
    expect(find.byKey(const Key('gallery-celebrate-day')), findsOneWidget);
    await tester.pump(const Duration(milliseconds: 600));
    expect(find.byKey(const Key('gallery-celebrate-day')), findsOneWidget, reason: 'larger and longer than a heart');
    await tester.pump(const Duration(milliseconds: 700));
    await tester.pump();
    expect(find.byKey(const Key('gallery-celebrate-day')), findsNothing);

    GalleryMotionHost.debugReset();
    // A fresh tree, so the host attaches again, now under reduced motion.
    await tester.pumpWidget(const SizedBox());
    await tester.pumpWidget(_app(_Grid(), reduceMotion: true));
    expect(GalleryMotionHost.overlay, isNotNull);
    GalleryCelebrate.dayComplete(origin: const Offset(200, 300), colors: const [Colors.green]);
    await tester.pump();
    expect(find.byKey(const Key('gallery-celebrate-day')), findsNothing);
  });

  testWidgets('without an attached overlay nothing happens', (tester) async {
    GalleryMotionHost.debugReset();
    GalleryRemoval.send(['a']);
    GalleryCelebrate.favorite();
    await tester.pumpWidget(const SizedBox());
    expect(find.byKey(_layer), findsNothing);
  });
}
