import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/tag.model.dart';
import 'package:immich_mobile/providers/infrastructure/tag.provider.dart';
import 'package:immich_mobile/providers/photos_filter/tags_picker.provider.dart';

class _FakeTagNotifier extends TagNotifier {
  final Set<Tag> tags;
  _FakeTagNotifier(this.tags);

  @override
  Future<Set<Tag>> build() async => tags;
}

Tag _t(String id, String value) => Tag(id: id, value: value);

ProviderContainer _containerWith(Set<Tag> tags) {
  return ProviderContainer(overrides: [tagProvider.overrideWith(() => _FakeTagNotifier(tags))]);
}

void main() {
  group('tagsPickerFilteredProvider', () {
    test('empty query returns all tags sorted by value (case-insensitive)', () async {
      final c = _containerWith({_t('t1', 'Travel/Italy/Rome'), _t('t2', 'Travel/France'), _t('t3', 'Food')});
      addTearDown(c.dispose);
      final result = await c.read(tagsPickerFilteredProvider.future);
      expect(result.map((t) => t.value), ['Food', 'Travel/France', 'Travel/Italy/Rome']);
    });

    test('query filters by substring over full path, case-insensitive', () async {
      final c = _containerWith({_t('t1', 'Travel/Italy/Rome'), _t('t2', 'Travel/France'), _t('t3', 'Food')});
      addTearDown(c.dispose);
      c.read(tagsPickerQueryProvider.notifier).state = 'rom';
      final result = await c.read(tagsPickerFilteredProvider.future);
      expect(result.map((t) => t.value), ['Travel/Italy/Rome']);
    });

    test('query matches multiple tags by substring', () async {
      final c = _containerWith({_t('t1', 'Travel/Italy/Rome'), _t('t2', 'Travel/France'), _t('t3', 'Food')});
      addTearDown(c.dispose);
      c.read(tagsPickerQueryProvider.notifier).state = 'travel';
      final result = await c.read(tagsPickerFilteredProvider.future);
      expect(result.map((t) => t.value), ['Travel/France', 'Travel/Italy/Rome']);
    });

    test('whitespace-only query returns full list', () async {
      final c = _containerWith({_t('t1', 'Food')});
      addTearDown(c.dispose);
      c.read(tagsPickerQueryProvider.notifier).state = '   ';
      final result = await c.read(tagsPickerFilteredProvider.future);
      expect(result.map((t) => t.value), ['Food']);
    });

    test('non-matching query returns empty', () async {
      final c = _containerWith({_t('t1', 'Food')});
      addTearDown(c.dispose);
      c.read(tagsPickerQueryProvider.notifier).state = 'zzzzz';
      final result = await c.read(tagsPickerFilteredProvider.future);
      expect(result, isEmpty);
    });
  });
}
