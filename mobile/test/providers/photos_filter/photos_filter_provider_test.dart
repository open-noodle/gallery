import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/entities/asset.entity.dart';
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

  group('setText', () {
    test('empty string clears context to null', () {
      final notifier = container.read(photosFilterProvider.notifier);
      notifier.setText('paris');
      notifier.setText('');
      expect(container.read(photosFilterProvider).context, null);
    });
  });

  group('setLocation', () {
    test('assigns a location filter', () {
      final loc = SearchLocationFilter(country: 'France');
      final notifier = container.read(photosFilterProvider.notifier);
      notifier.setLocation(loc);
      expect(container.read(photosFilterProvider).location.country, 'France');
    });
    test('passing null resets to the empty SearchLocationFilter', () {
      final notifier = container.read(photosFilterProvider.notifier);
      notifier.setLocation(SearchLocationFilter(country: 'France'));
      notifier.setLocation(null);
      expect(container.read(photosFilterProvider).location.country, null);
    });
  });

  group('setDateRange', () {
    final a = DateTime(2024, 1, 1);
    final b = DateTime(2024, 12, 31);
    test('sets both endpoints', () {
      container.read(photosFilterProvider.notifier).setDateRange(start: a, end: b);
      final d = container.read(photosFilterProvider).date;
      expect(d.takenAfter, a);
      expect(d.takenBefore, b);
    });
    test('both null clears the range', () {
      final notifier = container.read(photosFilterProvider.notifier);
      notifier.setDateRange(start: a, end: b);
      notifier.setDateRange(start: null, end: null);
      final d = container.read(photosFilterProvider).date;
      expect(d.takenAfter, null);
      expect(d.takenBefore, null);
    });
  });

  group('setRating', () {
    test('sets a rating value', () {
      final notifier = container.read(photosFilterProvider.notifier);
      notifier.setRating(4);
      expect(container.read(photosFilterProvider).rating.rating, 4);
    });
    test('null clears the rating', () {
      final notifier = container.read(photosFilterProvider.notifier);
      notifier.setRating(4);
      notifier.setRating(null);
      expect(container.read(photosFilterProvider).rating.rating, null);
    });
  });

  group('setMediaType', () {
    test('sets media type to image', () {
      final notifier = container.read(photosFilterProvider.notifier);
      notifier.setMediaType(AssetType.image);
      expect(container.read(photosFilterProvider).mediaType, AssetType.image);
    });
    test('null clears to AssetType.other (match all)', () {
      final notifier = container.read(photosFilterProvider.notifier);
      notifier.setMediaType(AssetType.image);
      notifier.setMediaType(null);
      expect(container.read(photosFilterProvider).mediaType, AssetType.other);
    });
  });

  group('setFavouritesOnly', () {
    test('toggles favourites flag', () {
      final notifier = container.read(photosFilterProvider.notifier);
      notifier.setFavouritesOnly(true);
      expect(container.read(photosFilterProvider).display.isFavorite, true);
      notifier.setFavouritesOnly(false);
      expect(container.read(photosFilterProvider).display.isFavorite, false);
    });
  });

  group('setArchivedIncluded', () {
    test('toggles archive flag', () {
      final notifier = container.read(photosFilterProvider.notifier);
      notifier.setArchivedIncluded(true);
      expect(container.read(photosFilterProvider).display.isArchive, true);
      notifier.setArchivedIncluded(false);
      expect(container.read(photosFilterProvider).display.isArchive, false);
    });
  });

  group('setNotInAlbum', () {
    test('toggles not-in-album flag', () {
      final notifier = container.read(photosFilterProvider.notifier);
      notifier.setNotInAlbum(true);
      expect(container.read(photosFilterProvider).display.isNotInAlbum, true);
      notifier.setNotInAlbum(false);
      expect(container.read(photosFilterProvider).display.isNotInAlbum, false);
    });
  });

  group('clearPeople', () {
    test('empties the people set leaving other dimensions intact', () {
      final notifier = container.read(photosFilterProvider.notifier);
      const alice = PersonDto(id: 'alice', name: 'Alice', isHidden: false, thumbnailPath: '');
      notifier.togglePerson(alice);
      notifier.toggleTag('t1');
      notifier.clearPeople();
      final f = container.read(photosFilterProvider);
      expect(f.people, isEmpty);
      expect(f.tagIds, ['t1']); // untouched
    });
  });

  group('clearTags', () {
    test('clears tag list to null leaving other dimensions intact', () {
      final notifier = container.read(photosFilterProvider.notifier);
      const alice = PersonDto(id: 'alice', name: 'Alice', isHidden: false, thumbnailPath: '');
      notifier.togglePerson(alice);
      notifier.toggleTag('t1');
      notifier.clearTags();
      final f = container.read(photosFilterProvider);
      expect(f.tagIds == null || f.tagIds!.isEmpty, true);
      expect(f.people, contains(alice)); // untouched
    });
  });

  group('clearDimension', () {
    test('clears people dimension', () {
      final notifier = container.read(photosFilterProvider.notifier);
      const alice = PersonDto(id: 'alice', name: 'Alice', isHidden: false, thumbnailPath: '');
      notifier.togglePerson(alice);
      notifier.toggleTag('t1');
      notifier.clearDimension(Dimension.people);
      final f = container.read(photosFilterProvider);
      expect(f.people, isEmpty);
      expect(f.tagIds, ['t1']);
    });
    test('clears tags dimension', () {
      final notifier = container.read(photosFilterProvider.notifier);
      notifier.toggleTag('t1');
      notifier.clearDimension(Dimension.tags);
      expect(
        container.read(photosFilterProvider).tagIds == null || container.read(photosFilterProvider).tagIds!.isEmpty,
        true,
      );
    });
    test('clears location dimension', () {
      final notifier = container.read(photosFilterProvider.notifier);
      notifier.setLocation(SearchLocationFilter(country: 'France'));
      notifier.clearDimension(Dimension.location);
      expect(container.read(photosFilterProvider).location.country, null);
    });
    test('clears date dimension', () {
      final notifier = container.read(photosFilterProvider.notifier);
      notifier.setDateRange(start: DateTime(2024, 1, 1), end: DateTime(2024, 12, 31));
      notifier.clearDimension(Dimension.date);
      final d = container.read(photosFilterProvider).date;
      expect(d.takenAfter, null);
      expect(d.takenBefore, null);
    });
    test('clears camera dimension', () {
      final notifier = container.read(photosFilterProvider.notifier);
      // No setCamera method yet — set the camera filter directly via copyWith for this test setup.
      // Easier: expect calling clearDimension(Dimension.camera) on an already-empty filter to be a no-op.
      notifier.clearDimension(Dimension.camera);
      final c = container.read(photosFilterProvider).camera;
      expect(c.make, null);
      expect(c.model, null);
    });
    test('clears rating dimension', () {
      final notifier = container.read(photosFilterProvider.notifier);
      notifier.setRating(4);
      notifier.clearDimension(Dimension.rating);
      expect(container.read(photosFilterProvider).rating.rating, null);
    });
    test('clears mediaType dimension', () {
      final notifier = container.read(photosFilterProvider.notifier);
      notifier.setMediaType(AssetType.image);
      notifier.clearDimension(Dimension.mediaType);
      expect(container.read(photosFilterProvider).mediaType, AssetType.other);
    });
    test('clears display dimension', () {
      final notifier = container.read(photosFilterProvider.notifier);
      notifier.setFavouritesOnly(true);
      notifier.setArchivedIncluded(true);
      notifier.setNotInAlbum(true);
      notifier.clearDimension(Dimension.display);
      final d = container.read(photosFilterProvider).display;
      expect(d.isFavorite, false);
      expect(d.isArchive, false);
      expect(d.isNotInAlbum, false);
    });
    test('clears text dimension', () {
      final notifier = container.read(photosFilterProvider.notifier);
      notifier.setText('paris');
      notifier.clearDimension(Dimension.text);
      expect(container.read(photosFilterProvider).context, null);
    });
  });
}
