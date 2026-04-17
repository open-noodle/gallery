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
}
