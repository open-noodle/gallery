import 'package:drift/drift.dart' hide isNull;
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/data/db/main/table/remote/shared_space.drift.dart';
import 'package:immich_mobile/data/db/main/table/remote/shared_space_member.drift.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/gallery/library_view.model.dart';
import 'package:immich_mobile/gallery/search/search.providers.dart';

import 'search_mode_harness.dart';

// #1038: the Photos page's search, through the real providers, under a remembered library view.
void main() {
  final database = SearchModeDatabase();

  setUpAll(database.setUpAll);
  tearDownAll(database.tearDownAll);

  testWidgets('under Personal, browsing sends the view and a text query does not', (tester) async {
    await database.setUp();
    final db = database.db;
    // One of my spaces on my timeline, so the remembered view applies.
    await db
        .into(db.sharedSpaceEntity)
        .insert(SharedSpaceEntityCompanion.insert(id: 'family', name: 'Family', createdById: testUserId));
    await db
        .into(db.sharedSpaceMemberEntity)
        .insert(
          SharedSpaceMemberEntityCompanion(
            spaceId: const Value('family'),
            userId: const Value(testUserId),
            role: const Value('owner'),
            joinedAt: Value(DateTime(2024)),
            showInTimeline: const Value(true),
          ),
        );
    await Store.put(StoreKey.photosLibraryView, LibraryViewMode.personal.name);
    final repository = FakeSearchRepository(FakeLibrary.standard);
    final container = searchModeContainer(db: db, repository: repository);
    await pumpPhotosPage(tester, container);

    await enterSearchMode(tester, container);
    container.read(searchStateProvider.notifier).setFavoritesOnly(true);
    await settleFrames(tester);

    expect(repository.optionsParams, isNotEmpty);
    expect(repository.optionsParams.map((p) => p.libraryView).toSet(), {LibraryViewMode.personal});
    expect(repository.resultParams.last.isFavorite, isTrue);
    expect(repository.resultParams.last.libraryView, LibraryViewMode.personal);

    container.read(searchStateProvider.notifier).submitText('beach');
    await settleFrames(tester);

    expect(repository.resultParams.last.query, 'beach');
    expect(repository.resultParams.last.libraryView, isNull);
    await disposePhotosPage(tester, container);
  });
}
