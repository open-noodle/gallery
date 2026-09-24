import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/providers/infrastructure/db.provider.dart';
import 'package:immich_mobile/repositories/memory_api.repository.dart';
import 'package:immich_mobile/widgets/settings/beta_sync_settings/sync_status_and_actions.dart';
import 'package:mocktail/mocktail.dart';

import '../../../infrastructure/repository.mock.dart';
import '../../../unit/presentation/presentation_context.dart';

class _MockMemoryApiRepository extends Mock implements MemoryApiRepository {}

void main() {
  late PresentationContext context;

  setUp(() async => context = await PresentationContext.create());
  tearDown(() => context.dispose());

  testWidgets('keeps the reset button reachable when the counts fail', (tester) async {
    final drift = MockDrift();
    when(() => drift.localAlbumRepository).thenReturn(MockLocalAlbumRepository());
    final memoryRepository = MockMemoryRepository();
    when(() => drift.memoryRepository).thenReturn(memoryRepository);
    when(() => memoryRepository.getCount()).thenAnswer((_) async => 0);
    when(() => context.service.asset.service.getAssetCounts()).thenThrow(Exception('corrupt db'));

    await tester.pumpTestWidget(
      context,
      const SyncStatusAndActions(),
      overrides: [
        driftProvider.overrideWithValue(drift),
        // gallery-fork: this widget's MemoryService takes the API repository as well
        // (#997 memory-lane fallback), which would otherwise resolve ApiService.
        memoryApiRepositoryProvider.overrideWithValue(_MockMemoryApiRepository()),
      ],
    );

    expect(tester.takeException(), isNull);
    expect(find.text('Something went wrong, reset the local database with the button below'), findsOneWidget);
    expect(find.text('Reset SQLite Database'), findsOneWidget);
  });
}
