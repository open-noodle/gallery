import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

void main() {
  late ProviderContainer container;
  setUp(() {
    container = ProviderContainer();
    addTearDown(container.dispose);
  });

  group('photosFilterProvider default state', () {
    test('builds to an empty SearchFilter', () {
      final filter = container.read(photosFilterProvider);
      expect(filter.isEmpty, true);
    });
  });

  group('reset', () {
    test('reset() clears all dimensions back to the empty filter', () {
      final notifier = container.read(photosFilterProvider.notifier);
      notifier.setText('paris');
      expect(container.read(photosFilterProvider).isEmpty, false);
      notifier.reset();
      expect(container.read(photosFilterProvider).isEmpty, true);
    });
  });

  group('togglePerson', () {
    const alice = PersonDto(id: 'alice', name: 'Alice', isHidden: false, thumbnailPath: '');
    test('adding a person sets it in state.people', () {
      final notifier = container.read(photosFilterProvider.notifier);
      notifier.togglePerson(alice);
      expect(container.read(photosFilterProvider).people, contains(alice));
    });
    test('toggling the same person twice ends in empty set', () {
      final notifier = container.read(photosFilterProvider.notifier);
      notifier.togglePerson(alice);
      notifier.togglePerson(alice);
      expect(container.read(photosFilterProvider).people, isEmpty);
    });
    test('toggling two people leaves both in state', () {
      const bob = PersonDto(id: 'bob', name: 'Bob', isHidden: false, thumbnailPath: '');
      final notifier = container.read(photosFilterProvider.notifier);
      notifier.togglePerson(alice);
      notifier.togglePerson(bob);
      expect(container.read(photosFilterProvider).people, {alice, bob});
    });
  });

  group('toggleTag', () {
    test('adding a tag sets it in state.tagIds', () {
      final notifier = container.read(photosFilterProvider.notifier);
      notifier.toggleTag('tag-1');
      expect(container.read(photosFilterProvider).tagIds, ['tag-1']);
    });
    test('toggling same tag twice ends with null or empty tagIds', () {
      final notifier = container.read(photosFilterProvider.notifier);
      notifier.toggleTag('tag-1');
      notifier.toggleTag('tag-1');
      final tagIds = container.read(photosFilterProvider).tagIds;
      expect(tagIds == null || tagIds.isEmpty, true);
    });
    test('toggle persists null-ness on an empty list', () {
      final notifier = container.read(photosFilterProvider.notifier);
      notifier.toggleTag('tag-1');
      notifier.toggleTag('tag-2');
      notifier.toggleTag('tag-1');
      expect(container.read(photosFilterProvider).tagIds, ['tag-2']);
    });
  });
}
