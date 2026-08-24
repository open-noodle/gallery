// #1018: publishing another member's photo is a decision made on their behalf, so the mobile
// editor states it before the link exists — the same consent affordance the web modal carries.
// Without it mobile shipped the capability and not the warning that makes it defensible.
import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/pages/library/shared_link/shared_link_edit.page.dart';
import 'package:immich_mobile/providers/server_info.provider.dart';
import 'package:immich_mobile/services/server_info.service.dart';
import 'package:mocktail/mocktail.dart';

import '../test_utils.dart';
import '../widget_tester_extensions.dart';

class _MockServerInfoService extends Mock implements ServerInfoService {}

void main() {
  const warningKey = Key('shared-link-contributed-warning');

  // The page falls back to getServerUrl() when the server reports no external domain, and that
  // reads the local store — so the store has to exist even though this test is about the warning.
  setUpAll(() async {
    TestUtils.init();
    await StoreService.init(
      storeRepository: StoreRepository(
        Drift(DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true)),
      ),
    );
  });

  Future<void> pumpEditor(WidgetTester tester, {String? spaceId, int contributedCount = 0, String? albumId}) async {
    await tester.pumpConsumerWidget(
      SharedLinkEditPage(
        assetsList: albumId == null ? const ['asset-1'] : null,
        albumId: albumId,
        spaceId: spaceId,
        contributedCount: contributedCount,
      ),
      overrides: [serverInfoProvider.overrideWith((ref) => ServerInfoNotifier(_MockServerInfoService()))],
    );
    await tester.pump();
  }

  testWidgets('warns, with a count, when the selection includes other members photos', (tester) async {
    await pumpEditor(tester, spaceId: 'space-1', contributedCount: 3);

    expect(find.byKey(warningKey), findsOneWidget);
  });

  testWidgets('does not warn when the creator owns the whole selection', (tester) async {
    await pumpEditor(tester, spaceId: 'space-1', contributedCount: 0);

    expect(find.byKey(warningKey), findsNothing);
  });

  testWidgets('warns without a count on a space album link', (tester) async {
    await pumpEditor(tester, spaceId: 'space-1', albumId: 'album-1');

    expect(find.byKey(warningKey), findsOneWidget);
  });

  testWidgets('does not warn outside a space', (tester) async {
    await pumpEditor(tester, contributedCount: 3);

    expect(find.byKey(warningKey), findsNothing);
  });
}
