import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/memory.model.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/widgets/memory/memory_title.widget.dart';
import 'package:immich_mobile/utils/memory_card_text.dart';

/// Covers how rule memories reach upstream's title switch — the title rules themselves are
/// exercised without a widget tree in `test/utils/memory_card_text_test.dart`.
void main() {
  Memory memoryWith(Map<String, dynamic> data) => Memory(
    id: 'memory-rule-1',
    createdAt: DateTime(2026, 4, 23),
    updatedAt: DateTime(2026, 4, 23),
    ownerId: 'user-1',
    type: MemoryTypeEnum.rule,
    data: MemoryData(data),
    isSaved: false,
    memoryAt: DateTime(2026, 4, 23),
    showAt: DateTime(2026, 4, 23),
    hideAt: DateTime(2026, 4, 23, 23, 59),
    assets: const [],
  );

  test('resolves a rule title without a build context', () {
    expect(
      getRuleMemoryTitle(memoryWith({'ruleId': 'birthday', 'title': 'Happy birthday, Alice'})),
      'Happy birthday, Alice',
    );

    // easy_localization is not initialised here, so translation falls back to the key itself;
    // what matters is that a rule with no usable context reaches the generic label rather than
    // rendering an empty string.
    expect(getRuleMemoryTitle(memoryWith({'ruleId': 'recent_trip'})), 'memory');
  });

  // immich-32165 moved every memory title onto upstream's getMemoryTitle switch; a rule memory
  // must reach the fork's builder through it instead of falling through to a generic label.
  test("upstream's getMemoryTitle titles a rule memory through the fork builder", () {
    expect(
      getMemoryTitle(StaticTranslations.instance, memoryWith({'ruleId': 'birthday', 'title': 'Happy birthday, Alice'})),
      'Happy birthday, Alice',
    );
  });
}
