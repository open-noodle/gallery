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

  // lastPositionDate — the remembered position-derived date used by
  // _onGroupingChanged to survive a coarse→fine round-trip.

  test('lastPositionDate is null before any setDate call', () {
    expect(container.read(timelineZoomAnchorProvider.notifier).lastPositionDate, isNull);
  });

  test('setDate updates lastPositionDate', () {
    final date = DateTime(2026, 6, 9);
    container.read(timelineZoomAnchorProvider.notifier).setDate(date);
    expect(container.read(timelineZoomAnchorProvider.notifier).lastPositionDate, date);
  });

  test('setDate updates both state and lastPositionDate', () {
    final date = DateTime(2026, 6, 9);
    container.read(timelineZoomAnchorProvider.notifier).setDate(date);
    expect(container.read(timelineZoomAnchorProvider), TimelineZoomAnchor.date(date));
    expect(container.read(timelineZoomAnchorProvider.notifier).lastPositionDate, date);
  });

  test('clear() resets state to none but does NOT clear lastPositionDate', () {
    final date = DateTime(2026, 6, 9);
    container.read(timelineZoomAnchorProvider.notifier).setDate(date);
    container.read(timelineZoomAnchorProvider.notifier).clear();
    expect(container.read(timelineZoomAnchorProvider), const TimelineZoomAnchor.none());
    expect(container.read(timelineZoomAnchorProvider.notifier).lastPositionDate, date);
  });

  test('second setDate overwrites lastPositionDate', () {
    final date1 = DateTime(2026, 6, 9);
    final date2 = DateTime(2026, 3, 1);
    container.read(timelineZoomAnchorProvider.notifier).setDate(date1);
    container.read(timelineZoomAnchorProvider.notifier).setDate(date2);
    expect(container.read(timelineZoomAnchorProvider.notifier).lastPositionDate, date2);
  });

  test('setYear does not update lastPositionDate', () {
    container.read(timelineZoomAnchorProvider.notifier).setYear(2025);
    expect(container.read(timelineZoomAnchorProvider.notifier).lastPositionDate, isNull);
  });

  test('setMonth does not update lastPositionDate', () {
    container.read(timelineZoomAnchorProvider.notifier).setMonth(year: 2025, month: 3);
    expect(container.read(timelineZoomAnchorProvider.notifier).lastPositionDate, isNull);
  });
}
