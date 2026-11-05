import 'dart:async';

import 'package:drift/drift.dart' hide isNull;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/data/db/main/table/remote/asset.drift.dart';
import 'package:immich_mobile/data/db/main/table/remote/shared_space.drift.dart';
import 'package:immich_mobile/data/db/main/table/remote/shared_space_album_asset.drift.dart';
import 'package:immich_mobile/data/db/main/table/remote/shared_space_album_link.drift.dart';
import 'package:immich_mobile/data/db/main/table/remote/shared_space_asset.drift.dart';
import 'package:immich_mobile/data/db/main/table/remote/shared_space_library.drift.dart';
import 'package:immich_mobile/data/db/main/table/remote/shared_space_member.drift.dart';
import 'package:immich_mobile/data/db/main/table/user/user.drift.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/gallery/space_badge.provider.dart';
import 'package:immich_mobile/gallery/space_badge.widget.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/widgets/spaces/space_collage.dart';
import 'package:openapi/api.dart' show UserAvatarColor;

import '../fixtures/asset.stub.dart';

void main() {
  group('watchAssetSpaces', () {
    late Drift db;

    setUp(() async {
      db = Drift(DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
      for (final id in ['me', 'other']) {
        await db.into(db.userEntity).insert(UserEntityCompanion.insert(id: id, email: '$id@test', name: id));
      }
      await db
          .into(db.remoteAssetEntity)
          .insert(
            RemoteAssetEntityCompanion.insert(
              id: 'asset',
              name: 'asset.jpg',
              type: AssetType.image,
              checksum: 'c-asset',
              ownerId: 'other',
              visibility: AssetVisibility.timeline,
              libraryId: const Value('library'),
            ),
          );
    });

    tearDown(() => db.close());

    Future<void> space(String id, {String? color, bool member = true, bool showInTimeline = true}) async {
      await db
          .into(db.sharedSpaceEntity)
          .insert(SharedSpaceEntityCompanion.insert(id: id, name: id, createdById: 'other', color: Value(color)));
      await db
          .into(db.sharedSpaceMemberEntity)
          .insert(SharedSpaceMemberEntityCompanion.insert(spaceId: id, userId: 'other', role: 'owner'));
      if (member) {
        await db
            .into(db.sharedSpaceMemberEntity)
            .insert(
              SharedSpaceMemberEntityCompanion.insert(
                spaceId: id,
                userId: 'me',
                role: 'viewer',
                showInTimeline: Value(showInTimeline),
              ),
            );
      }
    }

    Future<void> addAsset(String spaceId) => db
        .into(db.sharedSpaceAssetEntity)
        .insert(SharedSpaceAssetEntityCompanion.insert(spaceId: spaceId, assetId: 'asset'));

    Future<void> linkAlbum(String spaceId) async {
      await db
          .into(db.sharedSpaceAlbumLinkEntity)
          .insert(SharedSpaceAlbumLinkEntityCompanion.insert(spaceId: spaceId, albumId: 'album'));
      await db
          .into(db.sharedSpaceAlbumAssetEntity)
          .insertOnConflictUpdate(SharedSpaceAlbumAssetEntityCompanion.insert(albumId: 'album', assetId: 'asset'));
    }

    Future<void> linkLibrary(String spaceId) => db
        .into(db.sharedSpaceLibraryEntity)
        .insert(SharedSpaceLibraryEntityCompanion.insert(spaceId: spaceId, libraryId: 'library'));

    Future<AssetSpaces> spaces() => watchAssetSpaces(db, 'me', 'asset').first;

    test('is empty for an asset in no space', () async {
      await space('alone');
      expect(await spaces(), noAssetSpaces);
    });

    test('finds the asset by each path into a space, hidden ones included', () async {
      await space('added', color: 'pink');
      await addAsset('added');
      expect(await spaces(), (count: 1, color: UserAvatarColor.pink));

      await db.delete(db.sharedSpaceAssetEntity).go();
      await space('by-album', color: 'green', showInTimeline: false);
      await linkAlbum('by-album');
      expect(await spaces(), (count: 1, color: UserAvatarColor.green));

      await db.delete(db.sharedSpaceAlbumLinkEntity).go();
      await space('by-library');
      await linkLibrary('by-library');
      expect(await spaces(), (count: 1, color: null));
    });

    test('counts a space reached twice once, and only the spaces the user is in', () async {
      await space('b-space', color: 'blue');
      await addAsset('b-space');
      await linkAlbum('b-space');
      await space('a-space', color: 'red');
      await linkLibrary('a-space');
      await space('not-mine', member: false);
      await addAsset('not-mine');

      expect(await spaces(), (count: 2, color: null));
    });

    test('follows the asset into and out of its spaces, emitting only changes', () async {
      await space('later', color: 'amber');
      await space('by-album');
      await space('by-library');
      final values = <AssetSpaces>[];
      final subscription = watchAssetSpaces(db, 'me', 'asset').listen(values.add);
      Future<void> settle() => pumpEventQueue();
      await settle();

      await addAsset('later');
      await settle();
      await linkAlbum('by-album');
      await settle();
      await linkLibrary('by-library');
      await settle();
      // A write that changes nothing for this asset.
      await db
          .into(db.sharedSpaceAssetEntity)
          .insert(SharedSpaceAssetEntityCompanion.insert(spaceId: 'later', assetId: 'another'));
      await settle();
      await db.delete(db.sharedSpaceLibraryEntity).go();
      await settle();
      await db.delete(db.sharedSpaceAlbumLinkEntity).go();
      await settle();
      await (db.delete(db.sharedSpaceMemberEntity)..where((m) => m.userId.equals('me'))).go();
      await settle();
      await subscription.cancel();

      expect(values, [
        noAssetSpaces,
        (count: 1, color: UserAvatarColor.amber),
        (count: 2, color: null),
        (count: 3, color: null),
        (count: 2, color: null),
        (count: 1, color: UserAvatarColor.amber),
        noAssetSpaces,
      ]);
    });
  });

  group('SpaceBadge', () {
    final asset = RemoteAsset(
      id: 'asset',
      name: 'asset.jpg',
      ownerId: 'other',
      checksum: 'c-asset',
      type: AssetType.image,
      createdAt: DateTime(2025),
      updatedAt: DateTime(2025),
      isEdited: false,
    );
    final badge = find.byKey(const Key('space-badge'));
    double opacity(WidgetTester tester) =>
        tester.widget<AnimatedOpacity>(find.ancestor(of: badge, matching: find.byType(AnimatedOpacity))).opacity;

    Future<void> pump(
      WidgetTester tester, {
      BaseAsset? tile,
      Stream<AssetSpaces>? spaces,
      TimelineOrigin origin = TimelineOrigin.main,
      double size = 120,
      bool hidden = false,
    }) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            assetSpacesProvider.overrideWith(
              (ref, _) => spaces ?? Stream.value((count: 1, color: UserAvatarColor.green)),
            ),
            timelineServiceProvider.overrideWithValue(
              TimelineService((
                assetSource: (_, _) async => const [],
                bucketSource: () => Stream.value(const []),
                origin: origin,
              )),
            ),
          ],
          child: MaterialApp(
            home: Center(
              child: SizedBox.square(
                dimension: size,
                child: Stack(
                  children: [
                    const Placeholder(),
                    SpaceBadge(tile ?? asset, hidden: hidden),
                  ],
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
    }

    Icon badgeIcon(WidgetTester tester) =>
        tester.widget<Icon>(find.descendant(of: badge, matching: find.byIcon(Icons.workspaces)));

    testWidgets('shows the space icon in the colour of the one space, in the top-left corner', (tester) async {
      await pump(tester);

      final icon = badgeIcon(tester);
      expect(icon.color, spaceBadgeColor(UserAvatarColor.green).withValues(alpha: 0.9));
      expect(icon.size, 16);
      expect(icon.shadows, isNotEmpty, reason: 'it reads on a bright photo');
      final tile = tester.getTopLeft(find.byType(Placeholder));
      expect(tester.getTopLeft(badge) - tile, const Offset(10, 6), reason: 'as the favourite mark below it');
      expect(find.byType(DecoratedBox), findsNothing, reason: 'no disc behind the icon');
      expect(opacity(tester), 1);
    });

    testWidgets('shows a white space icon with a count for several spaces, without the count on small tiles', (
      tester,
    ) async {
      await pump(tester, spaces: Stream.value((count: 3, color: null)));
      expect(find.descendant(of: badge, matching: find.text('3')), findsOneWidget);
      expect(badgeIcon(tester).color, Colors.white.withValues(alpha: 0.9));

      await pump(tester, spaces: Stream.value((count: 3, color: null)), size: 80);
      expect(find.descendant(of: badge, matching: find.text('3')), findsNothing);
      expect(badgeIcon(tester).color, Colors.white.withValues(alpha: 0.9));
    });

    test('takes the light end of each space colour, and a light indigo by default', () {
      expect(spaceBadgeColor(UserAvatarColor.pink), spaceGradientColors(UserAvatarColor.pink).first);
      expect(spaceBadgeColor(UserAvatarColor.primary), const Color(0xFF818CF8));
      expect(spaceBadgeColor(null), const Color(0xFF818CF8));
    });

    testWidgets('appears when the spaces are known, and leaves screen readers alone', (tester) async {
      final spaces = StreamController<AssetSpaces>();
      addTearDown(spaces.close);
      final semantics = tester.ensureSemantics();
      await pump(tester, spaces: spaces.stream, hidden: false);
      expect(badge, findsNothing);

      spaces.add((count: 2, color: null));
      await tester.pumpAndSettle();
      expect(badge, findsOneWidget);
      expect(find.bySemanticsLabel('2'), findsNothing);
      semantics.dispose();
    });

    testWidgets('shows nothing for an asset in no space or only on the device, and badges a backed-up one', (
      tester,
    ) async {
      await pump(tester, spaces: Stream.value(noAssetSpaces));
      expect(badge, findsNothing);

      await pump(tester, tile: LocalAssetStub.image1);
      expect(badge, findsNothing);

      await pump(tester, tile: LocalAssetStub.image1.copyWith(remoteId: 'asset'));
      expect(badge, findsOneWidget);
    });

    testWidgets("stays off a space's timelines, the trash and the locked folder", (tester) async {
      for (final origin in [TimelineOrigin.remoteSpace, TimelineOrigin.trash, TimelineOrigin.lockedFolder]) {
        await pump(tester, origin: origin);
        expect(badge, findsNothing, reason: '$origin');
      }
    });

    testWidgets('fades out while hidden', (tester) async {
      await pump(tester, hidden: true);
      expect(opacity(tester), 0);
    });
  });
}
