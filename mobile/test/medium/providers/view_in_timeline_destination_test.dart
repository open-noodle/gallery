import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/user.model.dart';
import 'package:immich_mobile/domain/services/user.service.dart';
import 'package:immich_mobile/infrastructure/repositories/shared_space.repository.dart';
import 'package:immich_mobile/providers/asset_viewer/scroll_to_asset_notifier.provider.dart';
import 'package:immich_mobile/providers/asset_viewer/view_in_timeline_destination.dart';
import 'package:immich_mobile/providers/infrastructure/db.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:mocktail/mocktail.dart';

import '../repository_context.dart';

void main() {
  late MediumRepositoryContext ctx;
  late SharedSpaceRepository repo;

  setUp(() {
    ctx = MediumRepositoryContext();
    repo = SharedSpaceRepository(ctx.db);
  });
  tearDown(() => ctx.dispose());

  group('viewInTimelineSpaceId', () {
    test('sends a photo the viewer only has through a Space to that Space', () async {
      // #1047: the personal timeline carries a Space photo only while that membership is
      // shown in the timeline, so the jump used to land on the right day with nothing there.
      final owner = await ctx.newUser();
      final viewer = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: owner.id);
      await ctx.newSharedSpaceMember(spaceId: space.id, userId: viewer.id);
      final asset = await ctx.newRemoteAsset(ownerId: owner.id);
      await ctx.insertSharedSpaceAsset(spaceId: space.id, assetId: asset.id);

      final destination = await viewInTimelineSpaceId(
        asset: _remoteAsset(asset.id, ownerId: owner.id),
        currentUserId: viewer.id,
        repository: repo,
      );

      expect(destination, space.id);
    });

    test('keeps a photo the viewer owns on the personal timeline', () async {
      // An owned photo is in the owner's own timeline whether or not it is also in a
      // space, and that is where "view in timeline" has always taken them.
      final owner = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: owner.id);
      await ctx.newSharedSpaceMember(spaceId: space.id, userId: owner.id);
      final asset = await ctx.newRemoteAsset(ownerId: owner.id);
      await ctx.insertSharedSpaceAsset(spaceId: space.id, assetId: asset.id);

      final destination = await viewInTimelineSpaceId(
        asset: _remoteAsset(asset.id, ownerId: owner.id),
        currentUserId: owner.id,
        repository: repo,
      );

      expect(destination, isNull);
    });

    test('keeps a photo reached some other way on the personal timeline', () async {
      // Partner sharing / an album share: not owned, not in a space. Nothing changes.
      final owner = await ctx.newUser();
      final viewer = await ctx.newUser();
      final asset = await ctx.newRemoteAsset(ownerId: owner.id);

      final destination = await viewInTimelineSpaceId(
        asset: _remoteAsset(asset.id, ownerId: owner.id),
        currentUserId: viewer.id,
        repository: repo,
      );

      expect(destination, isNull);
    });

    test('keeps a device-only photo on the personal timeline', () async {
      final viewer = await ctx.newUser();

      final destination = await viewInTimelineSpaceId(
        asset: _localAsset('local-1'),
        currentUserId: viewer.id,
        repository: repo,
      );

      expect(destination, isNull);
    });
  });

  group('viewMemoryAssetInTimeline', () {
    late List<String> navigations;

    ProviderContainer containerFor(UserDto user) {
      final userService = _MockUserService();
      when(() => userService.tryGetMyUser()).thenReturn(user);
      when(() => userService.watchMyUser()).thenAnswer((_) => const Stream<UserDto?>.empty());
      final container = ProviderContainer(
        overrides: [
          driftProvider.overrideWithValue(ctx.db),
          currentUserProvider.overrideWith((ref) => _StubCurrentUserNotifier(userService, user)),
        ],
      );
      addTearDown(container.dispose);
      return container;
    }

    Future<void> jump(ProviderContainer container, RemoteAsset asset) => viewMemoryAssetInTimeline(
      asset: asset,
      read: container.read,
      popViewer: () async => navigations.add('pop'),
      goToMainTimeline: () async => navigations.add('main'),
      goToSpace: (spaceId) async => navigations.add('space:$spaceId'),
    );

    setUp(() {
      navigations = [];
      // The notifier is a process-wide singleton; drop anything a previous test left.
      scrollToAssetNotifierProvider.consume();
    });
    tearDown(() => scrollToAssetNotifierProvider.consume());

    test('opens the Space timeline for a photo the viewer only has through a Space', () async {
      final owner = await ctx.newUser();
      final viewer = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: owner.id);
      await ctx.newSharedSpaceMember(spaceId: space.id, userId: viewer.id);
      final asset = await ctx.newRemoteAsset(ownerId: owner.id);
      await ctx.insertSharedSpaceAsset(spaceId: space.id, assetId: asset.id);

      await jump(containerFor(_user(viewer.id)), _remoteAsset(asset.id, ownerId: owner.id));

      expect(navigations, ['pop', 'space:${space.id}']);
      expect(scrollToAssetNotifierProvider.value?.spaceId, space.id);
    });

    test('opens the personal timeline for a photo the viewer owns', () async {
      final owner = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: owner.id);
      await ctx.newSharedSpaceMember(spaceId: space.id, userId: owner.id);
      final asset = await ctx.newRemoteAsset(ownerId: owner.id);
      await ctx.insertSharedSpaceAsset(spaceId: space.id, assetId: asset.id);

      await jump(containerFor(_user(owner.id)), _remoteAsset(asset.id, ownerId: owner.id));

      expect(navigations, ['pop', 'main']);
      expect(scrollToAssetNotifierProvider.value?.spaceId, isNull);
    });
  });
}

class _MockUserService extends Mock implements UserService {}

class _StubCurrentUserNotifier extends CurrentUserProvider {
  _StubCurrentUserNotifier(super.service, UserDto? initial) {
    state = initial;
  }
}

UserDto _user(String id) => UserDto(id: id, email: '$id@example.com', name: id, profileChangedAt: DateTime(2024, 1, 1));

RemoteAsset _remoteAsset(String id, {required String ownerId}) => RemoteAsset(
  id: id,
  name: '$id.jpg',
  ownerId: ownerId,
  checksum: 'checksum-$id',
  type: AssetType.image,
  createdAt: DateTime(2026, 4, 3, 12),
  updatedAt: DateTime(2026, 4, 3, 12),
  isEdited: false,
);

LocalAsset _localAsset(String id) => LocalAsset(
  id: id,
  name: '$id.jpg',
  checksum: 'checksum-$id',
  type: AssetType.image,
  createdAt: DateTime(2026, 4, 3, 12),
  updatedAt: DateTime(2026, 4, 3, 12),
  isEdited: false,
  playbackStyle: AssetPlaybackStyle.image,
);
