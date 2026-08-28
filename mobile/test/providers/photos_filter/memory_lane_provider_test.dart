import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/memory.model.dart';
import 'package:immich_mobile/providers/infrastructure/memory.provider.dart';
import 'package:immich_mobile/providers/photos_filter/memory_lane.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

Memory _memory() => Memory(
  id: 'memory-1',
  createdAt: DateTime(2024),
  updatedAt: DateTime(2024),
  ownerId: 'user-1',
  type: MemoryTypeEnum.onThisDay,
  data: const MemoryData({'year': 2019}),
  isSaved: false,
  memoryAt: DateTime(2019, 8, 1),
  assets: const [],
);

ProviderContainer _container({required List<Memory> memories}) {
  final c = ProviderContainer(overrides: [memoryLaneProvider.overrideWith((ref) async => memories)]);
  addTearDown(c.dispose);
  return c;
}

void main() {
  test('the strip shows while browsing an unfiltered timeline', () async {
    final c = _container(memories: [_memory()]);
    await c.read(memoryLaneProvider.future);
    expect(c.read(photosMemoryLaneVisibleProvider), isTrue);
  });

  test('the strip hides once a search is active', () async {
    // #902: web's photos page renders the memories carousel only when no filter
    // or search is active, so results are not pushed down the viewport.
    final c = _container(memories: [_memory()]);
    await c.read(memoryLaneProvider.future);
    c.read(photosFilterProvider.notifier).setText('beach');
    expect(c.read(photosMemoryLaneVisibleProvider), isFalse);
  });

  test('the strip hides for a metadata-only filter too', () async {
    final c = _container(memories: [_memory()]);
    await c.read(memoryLaneProvider.future);
    c.read(photosFilterProvider.notifier).setFavouritesOnly(true);
    expect(c.read(photosMemoryLaneVisibleProvider), isFalse);
  });

  test('the strip comes back when the filter is cleared', () async {
    final c = _container(memories: [_memory()]);
    await c.read(memoryLaneProvider.future);
    final notifier = c.read(photosFilterProvider.notifier);
    notifier.setText('beach');
    notifier.reset();
    expect(c.read(photosMemoryLaneVisibleProvider), isTrue);
  });

  test('the strip stays hidden when there are no memories', () async {
    final c = _container(memories: const []);
    await c.read(memoryLaneProvider.future);
    expect(c.read(photosMemoryLaneVisibleProvider), isFalse);
  });
}
