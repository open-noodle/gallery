import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/memory.model.dart';
import 'package:immich_mobile/gallery/search/photos_search.dart';
import 'package:immich_mobile/gallery/search/search.providers.dart';
import 'package:immich_mobile/gallery/search/search_mode.provider.dart';
import 'package:immich_mobile/providers/infrastructure/memory.provider.dart';

// The memory lane follows search mode (specs/2026-10-23-mobile-search-redesign-design.md, "Removing the old filter
// sheet"): hidden as soon as search mode opens, shown otherwise.

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
  test('the strip shows while browsing and hides as soon as search mode opens, before any filter', () async {
    final c = _container(memories: [_memory()]);
    await c.read(memoryLaneProvider.future);
    expect(c.read(photosMemoryLaneVisibleProvider), isTrue);
    c.read(searchModeProvider.notifier).enter();
    expect(c.read(photosMemoryLaneVisibleProvider), isFalse);
  });

  test('the strip hides once search mode has a query', () async {
    final c = _container(memories: [_memory()]);
    await c.read(memoryLaneProvider.future);
    c.read(searchModeProvider.notifier).enter();
    c.read(searchStateProvider.notifier).submitText('beach');
    expect(c.read(photosMemoryLaneVisibleProvider), isFalse);
  });

  test('the strip hides for a filter without a query too', () async {
    final c = _container(memories: [_memory()]);
    await c.read(memoryLaneProvider.future);
    c.read(searchModeProvider.notifier).enter();
    c.read(searchStateProvider.notifier).setFavoritesOnly(true);
    expect(c.read(photosMemoryLaneVisibleProvider), isFalse);
  });

  test('the strip stays hidden when the filters are cleared, and comes back when search mode closes', () async {
    final c = _container(memories: [_memory()]);
    await c.read(memoryLaneProvider.future);
    c.read(searchModeProvider.notifier).enter();
    c.read(searchStateProvider.notifier)
      ..submitText('beach')
      ..reset();
    expect(c.read(photosMemoryLaneVisibleProvider), isFalse);
    c.read(searchModeProvider.notifier).leave();
    expect(c.read(photosMemoryLaneVisibleProvider), isTrue);
  });

  test('the strip stays hidden when there are no memories', () async {
    final c = _container(memories: const []);
    await c.read(memoryLaneProvider.future);
    expect(c.read(photosMemoryLaneVisibleProvider), isFalse);
  });
}
