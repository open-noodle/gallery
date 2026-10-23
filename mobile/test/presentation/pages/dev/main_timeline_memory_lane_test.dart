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
  // (`!hasActiveFilters`), so search results start at the top of the viewport
  // instead of being pushed down by a strip that is irrelevant to the query.
  testWidgets('the memories strip drops out of the timeline while a search is active', (tester) async {
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
    expect(find.byType(MemoryLane), findsOneWidget, reason: 'search mode with no filter yet still shows the timeline');

    container.read(searchStateProvider.notifier).submitText('beach');
    await settleFrames(tester);
    expect(find.byType(MemoryLane), findsNothing, reason: 'a search result set is not a place for memories');

    container.read(searchStateProvider.notifier).reset();
    await settleFrames(tester);
    expect(find.byType(MemoryLane), findsOneWidget, reason: 'clearing the search restores the strip');

    await disposePhotosPage(tester, container);
  });
}
