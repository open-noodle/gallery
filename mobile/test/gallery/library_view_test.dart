import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/gallery/library_view.model.dart';
import 'package:immich_mobile/gallery/library_view.provider.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';

import '../medium/repository_context.dart';

void main() {
  late Drift db;

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    drift.driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: StoreRepository(db), listenUpdates: false);
  });

  setUp(() async => Store.clear());

  tearDownAll(() async => db.close());

  ProviderContainer container({bool? hasTimelineSpace}) {
    final container = ProviderContainer(
      overrides: [
        if (hasTimelineSpace != null) hasTimelineSpaceProvider.overrideWith((ref) => Stream.value(hasTimelineSpace)),
      ],
    );
    addTearDown(container.dispose);
    return container;
  }

  test('starts on both and remembers the chosen view by name', () async {
    expect(container().read(libraryViewProvider), LibraryViewMode.both);

    await container().read(libraryViewProvider.notifier).set(LibraryViewMode.spaces);

    expect(Store.tryGet(StoreKey.photosLibraryView), 'spaces');
    expect(container().read(libraryViewProvider), LibraryViewMode.spaces);
  });

  test('reads an unknown stored view as both', () async {
    await Store.put(StoreKey.photosLibraryView, 'shared');

    expect(container().read(libraryViewProvider), LibraryViewMode.both);
  });

  test('applies the view, and shows it, only while a space is on the timeline', () async {
    await Store.put(StoreKey.photosLibraryView, LibraryViewMode.personal.name);
    final withSpace = container(hasTimelineSpace: true);
    final withoutSpace = container(hasTimelineSpace: false);
    await withSpace.read(hasTimelineSpaceProvider.future);
    await withoutSpace.read(hasTimelineSpaceProvider.future);

    expect(withSpace.read(activeLibraryViewProvider), LibraryViewMode.personal);
    expect(withSpace.read(libraryViewVisibleProvider), isTrue);
    expect(withoutSpace.read(activeLibraryViewProvider), LibraryViewMode.both);
    expect(withoutSpace.read(libraryViewVisibleProvider), isFalse);
  });

  test('knows when one of my spaces is on my timeline', () async {
    final ctx = MediumRepositoryContext();
    addTearDown(ctx.dispose);
    final me = await ctx.newUser(id: 'me');
    final peer = await ctx.newUser(id: 'peer');
    await ctx.newSharedSpace(id: 'family', createdById: peer.id);
    await ctx.newSharedSpaceMember(spaceId: 'family', userId: peer.id);
    await ctx.newSharedSpaceMember(spaceId: 'family', userId: me.id, showInTimeline: false);

    expect(await watchHasTimelineSpace(ctx.db, me.id).first, isFalse);

    await ctx.newSharedSpace(id: 'friends', createdById: peer.id);
    await ctx.newSharedSpaceMember(spaceId: 'friends', userId: me.id);
    expect(await watchHasTimelineSpace(ctx.db, me.id).first, isTrue);
  });
}
