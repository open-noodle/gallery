import 'package:drift/drift.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/gallery/library_view.model.dart';
import 'package:immich_mobile/providers/infrastructure/db.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';

/// The Photos tab library view the user chose, remembered on the device.
class LibraryViewNotifier extends Notifier<LibraryViewMode> {
  @override
  LibraryViewMode build() =>
      LibraryViewMode.values.asNameMap()[Store.tryGet(StoreKey.photosLibraryView)] ?? LibraryViewMode.both;

  Future<void> set(LibraryViewMode view) async {
    state = view;
    await Store.put(StoreKey.photosLibraryView, view.name);
  }
}

final libraryViewProvider = NotifierProvider<LibraryViewNotifier, LibraryViewMode>(LibraryViewNotifier.new);

/// Whether one of [userId]'s spaces is on their timeline.
Stream<bool> watchHasTimelineSpace(Drift db, String userId) {
  final member = db.sharedSpaceMemberEntity;
  final query = db.selectOnly(member)
    ..addColumns([member.spaceId])
    ..where(member.userId.equals(userId) & member.showInTimeline.equals(true))
    ..limit(1);
  return query.watch().map((rows) => rows.isNotEmpty);
}

/// Until one of the user's spaces is on their timeline, the view is hidden and counts as Both.
final hasTimelineSpaceProvider = StreamProvider<bool>((ref) {
  final userId = ref.watch(currentUserProvider.select((user) => user?.id));
  return userId == null ? Stream.value(false) : watchHasTimelineSpace(ref.watch(driftProvider), userId);
});

/// The view the Photos timeline and its searches apply. Spaces not read yet count as one, so a remembered view does
/// not load the timeline twice.
final activeLibraryViewProvider = Provider<LibraryViewMode>(
  (ref) =>
      (ref.watch(hasTimelineSpaceProvider).valueOrNull ?? true) ? ref.watch(libraryViewProvider) : LibraryViewMode.both,
);

/// Whether the menu offers the library view: once one of the user's spaces is on their timeline. The menu steps aside
/// with the app bar in search mode, where a text or similar-photo search spans every photo.
final libraryViewVisibleProvider = Provider<bool>((ref) => ref.watch(hasTimelineSpaceProvider).valueOrNull == true);
