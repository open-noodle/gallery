import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/gallery/search/search.providers.dart';
import 'package:immich_mobile/gallery/search/search_mode.provider.dart';
import 'package:immich_mobile/presentation/widgets/memory/memory_lane.widget.dart';

import '../../../gallery/search/search_mode_harness.dart';

void main() {
  final database = SearchModeDatabase();

  setUpAll(database.setUpAll);
  tearDownAll(database.tearDownAll);

  // #902 — web's photos page renders the memories carousel only while browsing
  // (`!hasActiveFilters`). Mobile goes further: the strip leaves as soon as search mode opens,
  // so the grid starts right under the search header, and comes back when search mode closes.
  testWidgets('the memories strip drops out of the timeline while search mode is open', (tester) async {
    await database.setUp(timelineAssets: 20);
    final container = searchModeContainer(
      db: database.db,
      repository: FakeSearchRepository(FakeLibrary.standard),
      memories: true,
    );
    await pumpPhotosPage(tester, container);
    expect(find.byType(MemoryLane), findsOneWidget, reason: 'browsing an unfiltered timeline shows memories');

    container.read(searchModeProvider.notifier).enter();
    await settleFrames(tester);
    expect(find.byType(MemoryLane), findsNothing, reason: 'search mode hides memories before any filter');

    container.read(searchStateProvider.notifier).submitText('beach');
    await settleFrames(tester);
    expect(find.byType(MemoryLane), findsNothing, reason: 'a search result set is not a place for memories');

    container.read(searchStateProvider.notifier).reset();
    await settleFrames(tester);
    expect(find.byType(MemoryLane), findsNothing, reason: 'still in search mode with the filters cleared');

    container.read(searchModeProvider.notifier).leave();
    await settleFrames(tester);
    expect(find.byType(MemoryLane), findsOneWidget, reason: 'leaving search mode restores the strip');

    await disposePhotosPage(tester, container);
  });
}
