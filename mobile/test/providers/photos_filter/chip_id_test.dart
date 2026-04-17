import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/providers/photos_filter/chip_id.dart';

void main() {
  group('ChipId equality', () {
    test('PersonChipId value equality', () {
      expect(const PersonChipId('alice'), const PersonChipId('alice'));
      expect(const PersonChipId('alice').hashCode, const PersonChipId('alice').hashCode);
      expect(const PersonChipId('alice'), isNot(const PersonChipId('bob')));
    });
    test('TagChipId value equality', () {
      expect(const TagChipId('t1'), const TagChipId('t1'));
      expect(const TagChipId('t1'), isNot(const TagChipId('t2')));
    });
    test('Value-less chip ids are equal across instances', () {
      expect(const LocationChipId(), const LocationChipId());
      expect(const DateChipId(), const DateChipId());
      expect(const RatingChipId(), const RatingChipId());
      expect(const MediaTypeChipId(), const MediaTypeChipId());
      expect(const FavouriteChipId(), const FavouriteChipId());
      expect(const ArchiveChipId(), const ArchiveChipId());
      expect(const NotInAlbumChipId(), const NotInAlbumChipId());
      expect(const TextChipId(), const TextChipId());
    });
    test('Different value-less chip ids are NOT equal', () {
      expect(const LocationChipId(), isNot(const DateChipId()));
    });
  });
}
