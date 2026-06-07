import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';

void main() {
  group('GroupAssetsBy', () {
    test('keeps persisted indexes stable and appends year', () {
      expect(GroupAssetsBy.day.index, 0);
      expect(GroupAssetsBy.month.index, 1);
      expect(GroupAssetsBy.auto.index, 2);
      expect(GroupAssetsBy.none.index, 3);
      expect(GroupAssetsBy.year.index, 4);
    });
  });

  group('HeaderType', () {
    test('exposes year header type', () {
      expect(HeaderType.values, contains(HeaderType.year));
    });
  });
}
