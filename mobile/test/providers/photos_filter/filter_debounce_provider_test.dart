import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/photos_filter/filter_debounce.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

void main() {
  group('photosFilterDebouncedProvider (250 ms)', () {
    test('initial read synchronously returns current filter state (empty)', () {
      final container = ProviderContainer();
      addTearDown(container.dispose);

      final debounced = container.read(photosFilterDebouncedProvider);
      expect(debounced.isEmpty, isTrue);
    });

    test('source change still returns previous value during the 250 ms window', () {
      fakeAsync((async) {
        final container = ProviderContainer();
        addTearDown(container.dispose);
        // Seed read so the provider is active.
        final initial = container.read(photosFilterDebouncedProvider);
        expect(initial.isEmpty, isTrue);

        container.read(photosFilterProvider.notifier).setText('paris');
        async.elapse(const Duration(milliseconds: 100));

        final duringWindow = container.read(photosFilterDebouncedProvider);
        expect(duringWindow.context, isNull, reason: 'debounce has not elapsed');
      });
    });

    test('after 250 ms elapses, debounced provider reflects the new filter', () {
      fakeAsync((async) {
        final container = ProviderContainer();
        addTearDown(container.dispose);
        container.read(photosFilterDebouncedProvider);

        container.read(photosFilterProvider.notifier).setText('paris');
        async.elapse(const Duration(milliseconds: 260));

        final after = container.read(photosFilterDebouncedProvider);
        expect(after.context, 'paris');
      });
    });

    test('two rapid changes within the window coalesce into the final value', () {
      fakeAsync((async) {
        final container = ProviderContainer();
        addTearDown(container.dispose);
        container.read(photosFilterDebouncedProvider);

        container.read(photosFilterProvider.notifier).setText('par');
        async.elapse(const Duration(milliseconds: 50));
        container.read(photosFilterProvider.notifier).setText('paris');
        async.elapse(const Duration(milliseconds: 260));

        final after = container.read(photosFilterDebouncedProvider);
        expect(after.context, 'paris');
      });
    });

    test('container dispose cancels any pending timer (no crash)', () {
      fakeAsync((async) {
        final container = ProviderContainer();
        container.read(photosFilterDebouncedProvider);

        container.read(photosFilterProvider.notifier).setText('paris');
        async.elapse(const Duration(milliseconds: 100));
        container.dispose();

        async.elapse(const Duration(milliseconds: 1000));
        // reaching here without an exception is the pass criterion.
      });
    });
  });

  group('photosTimelineFilterProvider (500 ms)', () {
    test('initial read returns current filter synchronously', () {
      final container = ProviderContainer();
      addTearDown(container.dispose);

      expect(container.read(photosTimelineFilterProvider).isEmpty, isTrue);
    });

    test('after 500 ms reflects the new filter', () {
      fakeAsync((async) {
        final container = ProviderContainer();
        addTearDown(container.dispose);
        container.read(photosTimelineFilterProvider);

        container.read(photosFilterProvider.notifier).setText('oslo');
        async.elapse(const Duration(milliseconds: 260));
        expect(
          container.read(photosTimelineFilterProvider).context,
          isNull,
          reason: '260 ms is within the 500 ms timeline debounce',
        );
        async.elapse(const Duration(milliseconds: 260));
        expect(container.read(photosTimelineFilterProvider).context, 'oslo');
      });
    });
  });
}
