import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/timeline_zoom_anchor.model.dart';
import 'package:immich_mobile/providers/timeline/zoom_anchor.provider.dart';

void main() {
  late ProviderContainer container;

  setUp(() {
    container = ProviderContainer();
    addTearDown(container.dispose);
  });

  test('defaults to no pending anchor', () {
    expect(container.read(timelineZoomAnchorProvider), const TimelineZoomAnchor.none());
  });

  test('stores year anchors', () {
    container.read(timelineZoomAnchorProvider.notifier).setYear(2025);
    expect(container.read(timelineZoomAnchorProvider), const TimelineZoomAnchor.year(2025));
  });

  test('stores month anchors', () {
    container.read(timelineZoomAnchorProvider.notifier).setMonth(year: 2025, month: 3);
    expect(container.read(timelineZoomAnchorProvider), TimelineZoomAnchor.month(year: 2025, month: 3));
  });

  test('stores date anchors', () {
    final date = DateTime(2017, 11, 15);
    container.read(timelineZoomAnchorProvider.notifier).setDate(date);
    expect(container.read(timelineZoomAnchorProvider), TimelineZoomAnchor.date(date));
  });

  test('clears pending anchors', () {
    container.read(timelineZoomAnchorProvider.notifier).setMonth(year: 2025, month: 3);
    container.read(timelineZoomAnchorProvider.notifier).clear();
    expect(container.read(timelineZoomAnchorProvider), const TimelineZoomAnchor.none());
  });
}
