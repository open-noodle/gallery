import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/providers/infrastructure/db.provider.dart';
import 'package:immich_mobile/repositories/memory_api.repository.dart';
import 'package:immich_mobile/widgets/settings/beta_sync_settings/sync_status_and_actions.dart';
import 'package:mocktail/mocktail.dart';

import '../../../infrastructure/repository.mock.dart';
import '../../../unit/presentation/presentation_context.dart';

// Fork: MemoryService also takes the memory-lane API repository (#997), whose
// default provider needs an ApiService the presentation context does not set.
class MockMemoryApiRepository extends Mock implements MemoryApiRepository {}

void main() {
  late PresentationContext context;

  setUp(() async => context = await PresentationContext.create());
  tearDown(() => context.dispose());

  testWidgets('keeps the reset button reachable when the counts fail', (tester) async {
    final drift = MockDrift();
    when(() => drift.localAlbumRepository).thenReturn(MockLocalAlbumRepository());
    when(() => drift.memoryRepository).thenReturn(MockMemoryRepository());
    when(() => context.service.asset.service.getAssetCounts()).thenThrow(Exception('corrupt db'));

    await tester.pumpTestWidget(
      context,
      const SyncStatusAndActions(),
      overrides: [
        driftProvider.overrideWithValue(drift),
        memoryApiRepositoryProvider.overrideWithValue(MockMemoryApiRepository()),
      ],
    );

    expect(tester.takeException(), isNull);
    expect(find.text('Something went wrong, reset the local database with the button below'), findsOneWidget);
    expect(find.text('Reset SQLite Database'), findsOneWidget);
  });
}
