import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/data/store.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/tag.model.dart';
import 'package:immich_mobile/domain/models/user.model.dart';
import 'package:immich_mobile/domain/models/user_metadata.model.dart';
import 'package:immich_mobile/domain/services/user.service.dart';
import 'package:immich_mobile/presentation/widgets/asset_viewer/asset_details/tag_details.widget.dart';
import 'package:immich_mobile/providers/asset_viewer/asset_viewer.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:mocktail/mocktail.dart';

import '../../fixtures/user.stub.dart';
import '../../test_utils.dart';
import '../../widget_tester_extensions.dart';

class _MockUserService extends Mock implements UserService {}

class _StubCurrentUser extends CurrentUserProvider {
  _StubCurrentUser(super.service, UserDto? user) {
    state = user;
  }
}

class _ViewerShowing extends AssetViewerStateNotifier {
  _ViewerShowing(this._asset);

  final BaseAsset _asset;

  @override
  AssetViewerState build() => AssetViewerState(currentAsset: _asset);
}

void main() {
  final me = UserStub.user1;
  const tags = [Tag(id: 't1', value: 'holiday')];

  Future<void> pump(
    WidgetTester tester, {
    required String ownerId,
    List<Tag> assetTags = tags,
    bool tagsEnabled = true,
  }) async {
    final asset = TestUtils.createRemoteAsset(id: 'asset-1', ownerId: ownerId);
    final userService = _MockUserService();
    when(() => userService.tryGetMyUser()).thenReturn(me);
    when(() => userService.watchMyUser()).thenAnswer((_) => const Stream.empty());

    await tester.pumpConsumerWidget(
      Scaffold(body: TagDetails(asset: asset)),
      overrides: [
        currentUserProvider.overrideWith((ref) => _StubCurrentUser(userService, me)),
        Store.userMetadata.preferences().overrideWith((ref) => Stream.value(Preferences(tagsEnabled: tagsEnabled))),
        Store.tags.forAsset.overrideWith((ref, id) async => assetTags),
        assetViewerProvider.overrideWith(() => _ViewerShowing(asset)),
      ],
    );
  }

  testWidgets('shows the tags of an asset owned by someone else, read-only', (tester) async {
    await pump(tester, ownerId: 'someone-else');

    expect(find.text('holiday'), findsOneWidget);
    expect(find.byIcon(Icons.close), findsNothing);
    expect(find.byIcon(Icons.new_label_outlined), findsNothing);
  });

  testWidgets('shows no section on an asset owned by someone else without tags', (tester) async {
    await pump(tester, ownerId: 'someone-else', assetTags: const []);

    expect(find.byType(Wrap), findsNothing);
  });

  testWidgets('lets the owner edit the tags', (tester) async {
    await pump(tester, ownerId: me.id);

    expect(find.text('holiday'), findsOneWidget);
    expect(find.byIcon(Icons.close), findsOneWidget);
    expect(find.byIcon(Icons.new_label_outlined), findsOneWidget);
  });

  testWidgets('keeps the add-tag button for an owner without tags', (tester) async {
    await pump(tester, ownerId: me.id, assetTags: const []);

    expect(find.byIcon(Icons.new_label_outlined), findsOneWidget);
  });

  testWidgets('shows nothing when tags are disabled', (tester) async {
    await pump(tester, ownerId: me.id, tagsEnabled: false);

    expect(find.text('holiday'), findsNothing);
    expect(find.byIcon(Icons.new_label_outlined), findsNothing);
  });
}
