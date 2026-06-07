import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.widget.dart';

void main() {
  group('timelineScrubberSnappingOffset', () {
    test('adds the route top sliver height before the expanded app bar height', () {
      expect(timelineScrubberSnappingOffset(topSliverWidgetHeight: 56, appBarExpandedHeight: 64), 120);
      expect(timelineScrubberSnappingOffset(topSliverWidgetHeight: null, appBarExpandedHeight: 64), 64);
    });
  });
}
