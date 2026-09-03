import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/memory.model.dart';
import 'package:immich_mobile/utils/memory_card_text.dart';

/// Covers the widget-bound wrapper only — the title rules themselves are exercised without a
/// widget tree in `test/utils/memory_card_text_test.dart`.
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

  testWidgets('resolves a title through the build context', (tester) async {
    late BuildContext context;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (ctx) {
            context = ctx;
            return const SizedBox.shrink();
          },
        ),
      ),
    );

    expect(
      getMemoryTitle(context, memoryWith({'ruleId': 'birthday', 'title': 'Happy birthday, Alice'})),
      'Happy birthday, Alice',
    );

    // No easy_localization in this tree, so translation falls back to the key itself; what
    // matters here is that a rule with no usable context reaches the generic label rather than
    // rendering an empty string.
    expect(getMemoryTitle(context, memoryWith({'ruleId': 'recent_trip'})), 'memory');
  });
}
