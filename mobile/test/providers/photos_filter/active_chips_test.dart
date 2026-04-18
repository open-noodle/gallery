import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/entities/asset.entity.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/providers/photos_filter/active_chips.dart';
import 'package:immich_mobile/providers/photos_filter/chip_id.dart';
import 'package:openapi/api.dart';

PersonDto _person(String id, String name) => PersonDto(id: id, name: name, isHidden: false, thumbnailPath: '');

SearchFilter _base() => SearchFilter(
  people: <PersonDto>{},
  location: SearchLocationFilter(),
  camera: SearchCameraFilter(),
  date: SearchDateFilter(),
  display: SearchDisplayFilters(isFavorite: false, isArchive: false, isNotInAlbum: false),
  rating: SearchRatingFilter(),
  mediaType: AssetType.other,
);

void main() {
  group('activeChipsFromFilter', () {
    test('empty filter → empty list', () {
      expect(activeChipsFromFilter(_base()), isEmpty);
    });

    test('single person → 1 person chip, label from state, PersonChipId(id)', () {
      final f = _base()..people.add(_person('p1', 'Alice'));
      final chips = activeChipsFromFilter(f);
      expect(chips, hasLength(1));
      expect(chips.single.id, const PersonChipId('p1'));
      expect(chips.single.label, 'Alice');
      expect(chips.single.visual, ChipVisual.person);
      expect(chips.single.avatarPersonIds, ['p1']);
    });

    test('2 people → 2 individual chips (no spillover)', () {
      final f = _base()..people.addAll({_person('a', 'Alice'), _person('b', 'Bob')});
      final chips = activeChipsFromFilter(f);
      expect(chips.map((c) => c.label), containsAll(['Alice', 'Bob']));
      expect(chips, hasLength(2));
    });

    test('3 people → 2 individual chips + 1 spillover "Alice, Bob +1" with 3 avatars', () {
      final f = _base()..people.addAll({_person('a', 'Alice'), _person('b', 'Bob'), _person('c', 'Carol')});
      final chips = activeChipsFromFilter(f);
      expect(chips, hasLength(3));
      final spill = chips.last;
      expect(spill.label, 'Alice, Bob +1');
      expect(spill.avatarPersonIds, ['a', 'b', 'c']);
      expect((spill.id as PersonChipId).personId, 'c');
    });

    test('5 people → 2 individual + 1 spillover "Alice, Bob +3" with 3 avatars', () {
      final f = _base()
        ..people.addAll({
          _person('a', 'Alice'),
          _person('b', 'Bob'),
          _person('c', 'Carol'),
          _person('d', 'Dan'),
          _person('e', 'Eve'),
        });
      final chips = activeChipsFromFilter(f);
      expect(chips, hasLength(3));
      expect(chips.last.label, 'Alice, Bob +3');
      expect(chips.last.avatarPersonIds, ['a', 'b', 'c']);
    });

    test('tag id in suggestions → resolved label', () {
      final f = _base()..tagIds = ['t1'];
      final suggestions = FilterSuggestionsResponseDto(
        hasUnnamedPeople: false,
        tags: [FilterSuggestionsTagDto(id: 't1', value: 'wedding')],
      );
      final chips = activeChipsFromFilter(f, suggestions: suggestions);
      expect(chips, hasLength(1));
      expect(chips.single.label, 'wedding');
      expect(chips.single.id, const TagChipId('t1'));
      expect(chips.single.visual, ChipVisual.tag);
    });

    test('tag id NOT in suggestions → fallback label', () {
      final f = _base()..tagIds = ['unknown'];
      final chips = activeChipsFromFilter(f);
      expect(chips, hasLength(1));
      expect(chips.single.label, 'filter_sheet_tag_fallback');
      expect(chips.single.id, const TagChipId('unknown'));
    });

    test('location with only country → 1 chip with country text', () {
      final f = _base()..location = SearchLocationFilter(country: 'France');
      final chips = activeChipsFromFilter(f);
      expect(chips, hasLength(1));
      expect(chips.single.label, 'France');
      expect(chips.single.id, isA<LocationChipId>());
      expect(chips.single.visual, ChipVisual.location);
    });

    test('location with country + city → "France · Paris"', () {
      final f = _base()..location = SearchLocationFilter(country: 'France', city: 'Paris');
      expect(activeChipsFromFilter(f).single.label, 'France · Paris');
    });

    test('location with all fields null → no chip (defensive)', () {
      final f = _base();
      expect(activeChipsFromFilter(f).where((c) => c.visual == ChipVisual.location), isEmpty);
    });

    test('date with only takenAfter → "After MMM yyyy"', () {
      final f = _base()..date = SearchDateFilter(takenAfter: DateTime(2024, 4, 1));
      final chips = activeChipsFromFilter(f);
      expect(chips.single.visual, ChipVisual.when);
      expect(chips.single.label, 'After Apr 2024');
    });

    test('date with only takenBefore → "Before MMM yyyy"', () {
      final f = _base()..date = SearchDateFilter(takenBefore: DateTime(2024, 4, 30));
      expect(activeChipsFromFilter(f).single.label, 'Before Apr 2024');
    });

    test('date both-set same month → single "MMM yyyy"', () {
      final f = _base()..date = SearchDateFilter(takenAfter: DateTime(2024, 4, 1), takenBefore: DateTime(2024, 4, 30));
      expect(activeChipsFromFilter(f).single.label, 'Apr 2024');
    });

    test('date both-set different months → "MMM yyyy – MMM yyyy"', () {
      final f = _base()..date = SearchDateFilter(takenAfter: DateTime(2024, 4, 1), takenBefore: DateTime(2024, 12, 31));
      expect(activeChipsFromFilter(f).single.label, 'Apr 2024 – Dec 2024');
    });

    test('rating = 0 → no chip', () {
      final f = _base()..rating = SearchRatingFilter(rating: 0);
      expect(activeChipsFromFilter(f), isEmpty);
    });

    test('rating = 4 → "★ 4+" chip', () {
      final f = _base()..rating = SearchRatingFilter(rating: 4);
      final chips = activeChipsFromFilter(f);
      expect(chips, hasLength(1));
      expect(chips.single.label, '★ 4+');
      expect(chips.single.id, isA<RatingChipId>());
    });

    test('mediaType = other → no chip', () {
      final f = _base()..mediaType = AssetType.other;
      expect(activeChipsFromFilter(f), isEmpty);
    });

    test('mediaType = image → 1 chip labelled with i18n key', () {
      final f = _base()..mediaType = AssetType.image;
      final chips = activeChipsFromFilter(f);
      expect(chips, hasLength(1));
      expect(chips.single.label, 'filter_sheet_media_photos');
      expect(chips.single.id, isA<MediaTypeChipId>());
    });

    test('text chip with whitespace-only context → no chip', () {
      final f = _base()..context = '   ';
      expect(activeChipsFromFilter(f), isEmpty);
    });

    test('text chip with 30-char string → truncated', () {
      final f = _base()..context = 'a very long query string that goes on';
      final chip = activeChipsFromFilter(f).single;
      expect(chip.label.length, lessThanOrEqualTo(27)); // 24 + ellipsis + 2 quotes
      expect(chip.label, endsWith('…"'));
    });

    test('favourites / archived / notInAlbum emit toggle chips', () {
      final f = _base()..display = SearchDisplayFilters(isFavorite: true, isArchive: true, isNotInAlbum: true);
      final ids = activeChipsFromFilter(f).map((c) => c.id.runtimeType).toSet();
      expect(ids, containsAll([FavouriteChipId, ArchiveChipId, NotInAlbumChipId]));
    });

    test('combined filter preserves documented order', () {
      final f = _base()
        ..people.add(_person('p1', 'Alice'))
        ..tagIds = ['t1']
        ..location = SearchLocationFilter(country: 'France')
        ..date = SearchDateFilter(takenAfter: DateTime(2024, 4, 1))
        ..rating = SearchRatingFilter(rating: 4)
        ..mediaType = AssetType.image
        ..display = SearchDisplayFilters(isFavorite: true, isArchive: true, isNotInAlbum: true)
        ..context = 'paris';
      final chips = activeChipsFromFilter(f);
      final visuals = chips.map((c) => c.visual).toList();
      expect(visuals, [
        ChipVisual.person,
        ChipVisual.tag,
        ChipVisual.location,
        ChipVisual.when,
        ChipVisual.rating,
        ChipVisual.media,
        ChipVisual.toggle, // favourite
        ChipVisual.toggle, // archive
        ChipVisual.toggle, // not in album
        ChipVisual.text,
      ]);
    });

    test('person in state but absent from current suggestions still emits (id + state name)', () {
      final f = _base()..people.add(_person('p1', 'Alice'));
      final suggestions = FilterSuggestionsResponseDto(hasUnnamedPeople: false); // no people field
      final chips = activeChipsFromFilter(f, suggestions: suggestions);
      expect(chips.single.label, 'Alice');
    });
  });
}
