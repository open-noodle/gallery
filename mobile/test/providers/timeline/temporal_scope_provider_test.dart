import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/timeline_temporal_scope.model.dart';
import 'package:immich_mobile/providers/timeline/temporal_scope.provider.dart';

void main() {
  late ProviderContainer container;

  setUp(() {
    container = ProviderContainer();
    addTearDown(container.dispose);
  });

  test('defaults to non-persisted none scope', () {
    expect(container.read(timelineTemporalScopeProvider), const TimelineTemporalScope.none());
  });

  test('setYear stores a year scope', () {
    container.read(timelineTemporalScopeProvider.notifier).setYear(2025);

    expect(container.read(timelineTemporalScopeProvider), const TimelineTemporalScope.year(2025));
  });

  test('setMonth stores a month scope', () {
    container.read(timelineTemporalScopeProvider.notifier).setMonth(year: 2025, month: 8);

    expect(container.read(timelineTemporalScopeProvider), TimelineTemporalScope.month(year: 2025, month: 8));
  });

  test('clear returns to none', () {
    final notifier = container.read(timelineTemporalScopeProvider.notifier);
    notifier.setMonth(year: 2025, month: 8);

    notifier.clear();

    expect(container.read(timelineTemporalScopeProvider), const TimelineTemporalScope.none());
  });

  test('new provider container does not restore previous temporal scope', () {
    container.read(timelineTemporalScopeProvider.notifier).setYear(2025);
    container.dispose();

    final fresh = ProviderContainer();
    addTearDown(fresh.dispose);

    expect(fresh.read(timelineTemporalScopeProvider), const TimelineTemporalScope.none());
  });
}
