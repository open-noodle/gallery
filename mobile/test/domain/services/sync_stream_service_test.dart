import 'dart:async';

import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/models/sync_event.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/domain/services/sync_stream.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/local_asset.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/storage.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/sync_api.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/sync_stream.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/trashed_local_asset.repository.dart';
import 'package:immich_mobile/repositories/local_files_manager.repository.dart';
import 'package:immich_mobile/utils/semver.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

import '../../api.mocks.dart';
import '../../fixtures/asset.stub.dart';
import '../../fixtures/sync_stream.stub.dart';
import '../../infrastructure/repository.mock.dart';
import '../../mocks/asset_entity.mock.dart';
import '../../repository.mocks.dart';
import '../../service.mocks.dart';

class _AbortCallbackWrapper {
  const _AbortCallbackWrapper();

  bool call() => false;
}

class _MockAbortCallbackWrapper extends Mock implements _AbortCallbackWrapper {}

class _CancellationWrapper {
  const _CancellationWrapper();

  bool call() => false;
}

class _MockCancellationWrapper extends Mock implements _CancellationWrapper {}

void main() {
  late SyncStreamService sut;
  late SyncStreamRepository mockSyncStreamRepo;
  late SyncApiRepository mockSyncApiRepo;
  late DriftLocalAssetRepository mockLocalAssetRepo;
  late DriftTrashedLocalAssetRepository mockTrashedLocalAssetRepo;
  late LocalFilesManagerRepository mockLocalFilesManagerRepo;
  late StorageRepository mockStorageRepo;
  late MockApiService mockApi;
  late MockServerApi mockServerApi;
  late MockSyncMigrationRepository mockSyncMigrationRepo;
  late Future<void> Function(List<SyncEvent>, Function(), Function()) handleEventsCallback;
  late _MockAbortCallbackWrapper mockAbortCallbackWrapper;
  late _MockAbortCallbackWrapper mockResetCallbackWrapper;
  late Drift db;
  late bool hasManageMediaPermission;

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    registerFallbackValue(LocalAssetStub.image1);
    registerFallbackValue(const SemVer(major: 2, minor: 5, patch: 0));

    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: DriftStoreRepository(db));
  });

  tearDownAll(() async {
    debugDefaultTargetPlatformOverride = null;
    await Store.clear();
    await db.close();
  });

  successHandler(Invocation _) async => true;

  setUp(() async {
    mockSyncStreamRepo = MockSyncStreamRepository();
    mockSyncApiRepo = MockSyncApiRepository();
    mockLocalAssetRepo = MockLocalAssetRepository();
    mockTrashedLocalAssetRepo = MockTrashedLocalAssetRepository();
    mockLocalFilesManagerRepo = MockLocalFilesManagerRepository();
    mockStorageRepo = MockStorageRepository();
    mockAbortCallbackWrapper = _MockAbortCallbackWrapper();
    mockResetCallbackWrapper = _MockAbortCallbackWrapper();
    mockApi = MockApiService();
    mockServerApi = MockServerApi();
    mockSyncMigrationRepo = MockSyncMigrationRepository();

    when(() => mockAbortCallbackWrapper()).thenReturn(false);

    when(() => mockSyncApiRepo.streamChanges(any(), serverVersion: any(named: 'serverVersion'))).thenAnswer((
      invocation,
    ) async {
      handleEventsCallback = invocation.positionalArguments.first;
    });

    when(
      () => mockSyncApiRepo.streamChanges(
        any(),
        onReset: any(named: 'onReset'),
        serverVersion: any(named: 'serverVersion'),
      ),
    ).thenAnswer((invocation) async {
      handleEventsCallback = invocation.positionalArguments.first;
    });

    when(() => mockSyncApiRepo.ack(any())).thenAnswer((_) async => {});
    when(() => mockSyncApiRepo.deleteSyncAck(any())).thenAnswer((_) async => {});

    when(() => mockApi.serverInfoApi).thenReturn(mockServerApi);
    when(
      () => mockServerApi.getServerVersion(),
    ).thenAnswer((_) async => ServerVersionResponseDto(major: 1, minor: 132, patch_: 0));

    when(() => mockSyncStreamRepo.updateUsersV1(any())).thenAnswer(successHandler);
    when(() => mockSyncStreamRepo.deleteUsersV1(any())).thenAnswer(successHandler);
    when(() => mockSyncStreamRepo.updatePartnerV1(any())).thenAnswer(successHandler);
    when(() => mockSyncStreamRepo.deletePartnerV1(any())).thenAnswer(successHandler);
    when(() => mockSyncStreamRepo.updateAssetsV1(any())).thenAnswer(successHandler);
    when(
      () => mockSyncStreamRepo.updateAssetsV1(any(), debugLabel: any(named: 'debugLabel')),
    ).thenAnswer(successHandler);
    when(() => mockSyncStreamRepo.deleteAssetsV1(any())).thenAnswer(successHandler);
    when(
      () => mockSyncStreamRepo.deleteAssetsV1(any(), debugLabel: any(named: 'debugLabel')),
    ).thenAnswer(successHandler);
    when(() => mockSyncStreamRepo.updateAssetsExifV1(any())).thenAnswer(successHandler);
    when(
      () => mockSyncStreamRepo.updateAssetsExifV1(any(), debugLabel: any(named: 'debugLabel')),
    ).thenAnswer(successHandler);
    when(() => mockSyncStreamRepo.updateMemoriesV1(any())).thenAnswer(successHandler);
    when(() => mockSyncStreamRepo.deleteMemoriesV1(any())).thenAnswer(successHandler);
    when(() => mockSyncStreamRepo.updateMemoryAssetsV1(any())).thenAnswer(successHandler);
    when(() => mockSyncStreamRepo.deleteMemoryAssetsV1(any())).thenAnswer(successHandler);
    when(
      () => mockSyncStreamRepo.updateStacksV1(any(), debugLabel: any(named: 'debugLabel')),
    ).thenAnswer(successHandler);
    when(
      () => mockSyncStreamRepo.deleteStacksV1(any(), debugLabel: any(named: 'debugLabel')),
    ).thenAnswer(successHandler);
    when(() => mockSyncStreamRepo.updateUserMetadatasV1(any())).thenAnswer(successHandler);
    when(() => mockSyncStreamRepo.deleteUserMetadatasV1(any())).thenAnswer(successHandler);
    when(() => mockSyncStreamRepo.updatePeopleV1(any())).thenAnswer(successHandler);
    when(() => mockSyncStreamRepo.deletePeopleV1(any())).thenAnswer(successHandler);
    when(() => mockSyncStreamRepo.updateAssetFacesV1(any())).thenAnswer(successHandler);
    when(() => mockSyncStreamRepo.deleteAssetFacesV1(any())).thenAnswer(successHandler);
    // Shared-space sync handlers — wired in PR 1. Stubbed here so the
    // parameterized dispatch tests can route sharedSpace* events through
    // all 14 case arms without falling into the default arm.
    when(() => mockSyncStreamRepo.updateSharedSpacesV1(any())).thenAnswer(successHandler);
    when(() => mockSyncStreamRepo.deleteSharedSpacesV1(any())).thenAnswer(successHandler);
    when(() => mockSyncStreamRepo.updateSharedSpaceMembersV1(any())).thenAnswer(successHandler);
    when(() => mockSyncStreamRepo.deleteSharedSpaceMembersV1(any())).thenAnswer(successHandler);
    when(() => mockSyncStreamRepo.updateSharedSpaceAssetsV1(any())).thenAnswer(successHandler);
    when(() => mockSyncStreamRepo.updateSharedSpaceAssetExifsV1(any())).thenAnswer(successHandler);
    when(() => mockSyncStreamRepo.updateSharedSpaceToAssetsV1(any())).thenAnswer(successHandler);
    when(() => mockSyncStreamRepo.deleteSharedSpaceToAssetsV1(any())).thenAnswer(successHandler);
    // Library sync handlers — wired in PR 2 Task 33/34. Stubbed here so the
    // dispatch tests can route a libraryV1/libraryDeleteV1 event without
    // falling through to the default case (which would log a warning).
    when(() => mockSyncStreamRepo.updateLibrariesV1(any())).thenAnswer(successHandler);
    when(
      () => mockSyncStreamRepo.deleteLibrariesV1(any(), currentUserId: any(named: 'currentUserId')),
    ).thenAnswer(successHandler);
    when(() => mockSyncStreamRepo.updateLibraryAssetsV1(any())).thenAnswer(successHandler);
    when(() => mockSyncStreamRepo.deleteLibraryAssetsV1(any())).thenAnswer(successHandler);
    when(() => mockSyncStreamRepo.updateLibraryAssetExifsV1(any())).thenAnswer(successHandler);
    when(() => mockSyncStreamRepo.updateSharedSpaceLibrariesV1(any())).thenAnswer(successHandler);
    when(() => mockSyncStreamRepo.deleteSharedSpaceLibrariesV1(any())).thenAnswer(successHandler);
    when(() => mockSyncMigrationRepo.v20260128CopyExifWidthHeightToAsset()).thenAnswer(successHandler);

    sut = SyncStreamService(
      syncApiRepository: mockSyncApiRepo,
      syncStreamRepository: mockSyncStreamRepo,
      localAssetRepository: mockLocalAssetRepo,
      trashedLocalAssetRepository: mockTrashedLocalAssetRepo,
      localFilesManager: mockLocalFilesManagerRepo,
      storageRepository: mockStorageRepo,
      api: mockApi,
      syncMigrationRepository: mockSyncMigrationRepo,
    );

    when(() => mockLocalAssetRepo.getAssetsFromBackupAlbums(any())).thenAnswer((_) async => {});
    when(() => mockTrashedLocalAssetRepo.trashLocalAsset(any())).thenAnswer((_) async {});
    when(() => mockTrashedLocalAssetRepo.getToRestore()).thenAnswer((_) async => []);
    when(() => mockTrashedLocalAssetRepo.applyRestoredAssets(any())).thenAnswer((_) async {});
    hasManageMediaPermission = false;
    when(() => mockLocalFilesManagerRepo.hasManageMediaPermission()).thenAnswer((_) async => hasManageMediaPermission);
    when(() => mockLocalFilesManagerRepo.moveToTrash(any())).thenAnswer((_) async => true);
    when(() => mockLocalFilesManagerRepo.restoreAssetsFromTrash(any())).thenAnswer((_) async => []);
    when(() => mockStorageRepo.getAssetEntityForAsset(any())).thenAnswer((_) async => null);
    await Store.put(StoreKey.manageLocalMediaAndroid, false);
  });

  Future<void> simulateEvents(List<SyncEvent> events) async {
    await sut.sync();
    await handleEventsCallback(events, mockAbortCallbackWrapper.call, mockResetCallbackWrapper.call);
  }

  group("SyncStreamService - _handleEvents", () {
    test("processes events and acks successfully when handlers succeed", () async {
      final events = [
        SyncStreamStub.userDeleteV1,
        SyncStreamStub.userV1Admin,
        SyncStreamStub.userV1User,
        SyncStreamStub.partnerDeleteV1,
        SyncStreamStub.partnerV1,
      ];

      await simulateEvents(events);

      verifyInOrder([
        () => mockSyncStreamRepo.deleteUsersV1(any()),
        () => mockSyncApiRepo.ack(["2"]),
        () => mockSyncStreamRepo.updateUsersV1(any()),
        () => mockSyncApiRepo.ack(["5"]),
        () => mockSyncStreamRepo.deletePartnerV1(any()),
        () => mockSyncApiRepo.ack(["4"]),
        () => mockSyncStreamRepo.updatePartnerV1(any()),
        () => mockSyncApiRepo.ack(["3"]),
      ]);
      verifyNever(() => mockAbortCallbackWrapper());
    });

    test("processes final batch correctly", () async {
      final events = [SyncStreamStub.userDeleteV1, SyncStreamStub.userV1Admin];

      await simulateEvents(events);

      verifyInOrder([
        () => mockSyncStreamRepo.deleteUsersV1(any()),
        () => mockSyncApiRepo.ack(["2"]),
        () => mockSyncStreamRepo.updateUsersV1(any()),
        () => mockSyncApiRepo.ack(["1"]),
      ]);
      verifyNever(() => mockAbortCallbackWrapper());
    });

    test("does not process or ack when event list is empty", () async {
      await simulateEvents([]);

      verifyNever(() => mockSyncStreamRepo.updateUsersV1(any()));
      verifyNever(() => mockSyncStreamRepo.deleteUsersV1(any()));
      verifyNever(() => mockSyncStreamRepo.updatePartnerV1(any()));
      verifyNever(() => mockSyncStreamRepo.deletePartnerV1(any()));
      verifyNever(() => mockAbortCallbackWrapper());
      verifyNever(() => mockSyncApiRepo.ack(any()));
    });

    test("aborts and stops processing if cancelled during iteration", () async {
      final cancellationChecker = _MockCancellationWrapper();
      when(() => cancellationChecker()).thenReturn(false);

      sut = SyncStreamService(
        syncApiRepository: mockSyncApiRepo,
        syncStreamRepository: mockSyncStreamRepo,
        localAssetRepository: mockLocalAssetRepo,
        trashedLocalAssetRepository: mockTrashedLocalAssetRepo,
        localFilesManager: mockLocalFilesManagerRepo,
        storageRepository: mockStorageRepo,
        cancelChecker: cancellationChecker.call,
        api: mockApi,
        syncMigrationRepository: mockSyncMigrationRepo,
      );
      await sut.sync();

      final events = [SyncStreamStub.userDeleteV1, SyncStreamStub.userV1Admin, SyncStreamStub.partnerDeleteV1];

      when(() => mockSyncStreamRepo.deleteUsersV1(any())).thenAnswer((_) async {
        when(() => cancellationChecker()).thenReturn(true);
      });

      await handleEventsCallback(events, mockAbortCallbackWrapper.call, mockResetCallbackWrapper.call);

      verify(() => mockSyncStreamRepo.deleteUsersV1(any())).called(1);
      verifyNever(() => mockSyncStreamRepo.updateUsersV1(any()));
      verifyNever(() => mockSyncStreamRepo.deletePartnerV1(any()));

      verify(() => mockAbortCallbackWrapper()).called(1);

      verify(() => mockSyncApiRepo.ack(["2"])).called(1);
    });

    test("aborts and stops processing if cancelled before processing batch", () async {
      final cancellationChecker = _MockCancellationWrapper();
      when(() => cancellationChecker()).thenReturn(false);

      final processingCompleter = Completer<void>();
      bool handler1Started = false;
      when(() => mockSyncStreamRepo.deleteUsersV1(any())).thenAnswer((_) async {
        handler1Started = true;
        return processingCompleter.future;
      });

      sut = SyncStreamService(
        syncApiRepository: mockSyncApiRepo,
        syncStreamRepository: mockSyncStreamRepo,
        localAssetRepository: mockLocalAssetRepo,
        trashedLocalAssetRepository: mockTrashedLocalAssetRepo,
        localFilesManager: mockLocalFilesManagerRepo,
        storageRepository: mockStorageRepo,
        cancelChecker: cancellationChecker.call,
        api: mockApi,
        syncMigrationRepository: mockSyncMigrationRepo,
      );

      await sut.sync();

      final events = [SyncStreamStub.userDeleteV1, SyncStreamStub.userV1Admin, SyncStreamStub.partnerDeleteV1];

      final processingFuture = handleEventsCallback(
        events,
        mockAbortCallbackWrapper.call,
        mockResetCallbackWrapper.call,
      );
      await pumpEventQueue();

      expect(handler1Started, isTrue);

      // Signal cancellation while handler 1 is waiting
      when(() => cancellationChecker()).thenReturn(true);
      await pumpEventQueue();

      processingCompleter.complete();
      await processingFuture;

      verifyNever(() => mockSyncStreamRepo.updateUsersV1(any()));

      verify(() => mockSyncApiRepo.ack(["2"])).called(1);
    });

    test("processes memory sync events successfully", () async {
      final events = [
        SyncStreamStub.memoryV1,
        SyncStreamStub.memoryDeleteV1,
        SyncStreamStub.memoryToAssetV1,
        SyncStreamStub.memoryToAssetDeleteV1,
      ];

      await simulateEvents(events);

      verifyInOrder([
        () => mockSyncStreamRepo.updateMemoriesV1(any()),
        () => mockSyncApiRepo.ack(["5"]),
        () => mockSyncStreamRepo.deleteMemoriesV1(any()),
        () => mockSyncApiRepo.ack(["6"]),
        () => mockSyncStreamRepo.updateMemoryAssetsV1(any()),
        () => mockSyncApiRepo.ack(["7"]),
        () => mockSyncStreamRepo.deleteMemoryAssetsV1(any()),
        () => mockSyncApiRepo.ack(["8"]),
      ]);
      verifyNever(() => mockAbortCallbackWrapper());
    });

    test("processes mixed memory and user events in correct order", () async {
      final events = [
        SyncStreamStub.memoryDeleteV1,
        SyncStreamStub.userV1Admin,
        SyncStreamStub.memoryToAssetV1,
        SyncStreamStub.memoryV1,
      ];

      await simulateEvents(events);

      verifyInOrder([
        () => mockSyncStreamRepo.deleteMemoriesV1(any()),
        () => mockSyncApiRepo.ack(["6"]),
        () => mockSyncStreamRepo.updateUsersV1(any()),
        () => mockSyncApiRepo.ack(["1"]),
        () => mockSyncStreamRepo.updateMemoryAssetsV1(any()),
        () => mockSyncApiRepo.ack(["7"]),
        () => mockSyncStreamRepo.updateMemoriesV1(any()),
        () => mockSyncApiRepo.ack(["5"]),
      ]);
      verifyNever(() => mockAbortCallbackWrapper());
    });

    test("handles memory sync failure gracefully", () async {
      when(() => mockSyncStreamRepo.updateMemoriesV1(any())).thenThrow(Exception("Memory sync failed"));

      final events = [SyncStreamStub.memoryV1, SyncStreamStub.userV1Admin];

      expect(() async => await simulateEvents(events), throwsA(isA<Exception>()));
    });

    test("processes memory asset events with correct data types", () async {
      final events = [SyncStreamStub.memoryToAssetV1];

      await simulateEvents(events);

      verify(() => mockSyncStreamRepo.updateMemoryAssetsV1(any())).called(1);
      verify(() => mockSyncApiRepo.ack(["7"])).called(1);
    });

    test("processes memory delete events with correct data types", () async {
      final events = [SyncStreamStub.memoryDeleteV1];

      await simulateEvents(events);

      verify(() => mockSyncStreamRepo.deleteMemoriesV1(any())).called(1);
      verify(() => mockSyncApiRepo.ack(["6"])).called(1);
    });

    test("processes memory create/update events with correct data types", () async {
      final events = [SyncStreamStub.memoryV1];

      await simulateEvents(events);

      verify(() => mockSyncStreamRepo.updateMemoriesV1(any())).called(1);
      verify(() => mockSyncApiRepo.ack(["5"])).called(1);
    });

    // --- gallery-fork: parameterized dispatch arm tests ---
    //
    // sync_stream.service.dart has 24 case arms for shared-space and library
    // sync entity types. A typo in any one of them would send events to the
    // wrong repository method (or the default arm, which silently logs and
    // skips). The repository handlers are exhaustively covered by
    // sync_stream_repository_test.dart; these tests verify the dispatch
    // routing one level up. They are structured as individual test cases so
    // a single-arm failure is easy to identify in CI output.

    group('SyncStreamService - library dispatch arms', () {
      test('libraryV1 → updateLibrariesV1', () async {
        await simulateEvents([SyncStreamStub.libraryV1]);
        verify(() => mockSyncStreamRepo.updateLibrariesV1(any())).called(1);
        verify(() => mockSyncApiRepo.ack(['library-v1-ack'])).called(1);
      });

      test('libraryDeleteV1 → deleteLibrariesV1 (no-op when no currentUser in Store)', () async {
        // The dispatch reads Store.tryGet(currentUser) to pass into the
        // sweep handler. In this isolated test the store has no user row,
        // so the dispatch logs a warning and does NOT call the handler.
        // We verify the SKIP path: event is still acked (forward progress
        // is essential — we cannot wedge on a missing store) and the
        // repository method is NOT called.
        await simulateEvents([SyncStreamStub.libraryDeleteV1]);
        verifyNever(
          () => mockSyncStreamRepo.deleteLibrariesV1(any(), currentUserId: any(named: 'currentUserId')),
        );
        // The event is still acked — the dispatch must not wedge when
        // there's no current user. (If you change the contract to wedge,
        // update this assertion.)
        verify(() => mockSyncApiRepo.ack(['library-delete-ack'])).called(1);
      });

      test('libraryAssetCreateV1 → updateLibraryAssetsV1', () async {
        await simulateEvents([SyncStreamStub.libraryAssetCreateV1]);
        verify(() => mockSyncStreamRepo.updateLibraryAssetsV1(any())).called(1);
        verify(() => mockSyncApiRepo.ack(['lib-asset-create-ack'])).called(1);
      });

      test('libraryAssetBackfillV1 → updateLibraryAssetsV1 (same handler as create)', () async {
        await simulateEvents([SyncStreamStub.libraryAssetBackfillV1]);
        verify(() => mockSyncStreamRepo.updateLibraryAssetsV1(any())).called(1);
        verify(() => mockSyncApiRepo.ack(['lib-asset-backfill-ack'])).called(1);
      });

      test('libraryAssetDeleteV1 → deleteLibraryAssetsV1', () async {
        await simulateEvents([SyncStreamStub.libraryAssetDeleteV1]);
        verify(() => mockSyncStreamRepo.deleteLibraryAssetsV1(any())).called(1);
        verify(() => mockSyncApiRepo.ack(['lib-asset-delete-ack'])).called(1);
      });

      test('libraryAssetExifCreateV1 → updateLibraryAssetExifsV1', () async {
        await simulateEvents([SyncStreamStub.libraryAssetExifCreateV1]);
        verify(() => mockSyncStreamRepo.updateLibraryAssetExifsV1(any())).called(1);
        verify(() => mockSyncApiRepo.ack(['lib-asset-exif-create-ack'])).called(1);
      });

      test('libraryAssetExifBackfillV1 → updateLibraryAssetExifsV1 (same handler)', () async {
        await simulateEvents([SyncStreamStub.libraryAssetExifBackfillV1]);
        verify(() => mockSyncStreamRepo.updateLibraryAssetExifsV1(any())).called(1);
        verify(() => mockSyncApiRepo.ack(['lib-asset-exif-backfill-ack'])).called(1);
      });

      test('sharedSpaceLibraryV1 → updateSharedSpaceLibrariesV1', () async {
        await simulateEvents([SyncStreamStub.sharedSpaceLibraryV1]);
        verify(() => mockSyncStreamRepo.updateSharedSpaceLibrariesV1(any())).called(1);
        verify(() => mockSyncApiRepo.ack(['shared-space-library-v1-ack'])).called(1);
      });

      test('sharedSpaceLibraryBackfillV1 → updateSharedSpaceLibrariesV1 (same handler)', () async {
        await simulateEvents([SyncStreamStub.sharedSpaceLibraryBackfillV1]);
        verify(() => mockSyncStreamRepo.updateSharedSpaceLibrariesV1(any())).called(1);
        verify(() => mockSyncApiRepo.ack(['shared-space-library-backfill-ack'])).called(1);
      });

      test('sharedSpaceLibraryDeleteV1 → deleteSharedSpaceLibrariesV1', () async {
        await simulateEvents([SyncStreamStub.sharedSpaceLibraryDeleteV1]);
        verify(() => mockSyncStreamRepo.deleteSharedSpaceLibrariesV1(any())).called(1);
        verify(() => mockSyncApiRepo.ack(['shared-space-library-delete-ack'])).called(1);
      });
    });

    group('SyncStreamService - shared space dispatch arms (PR 1 gap fill)', () {
      test('sharedSpaceV1 → updateSharedSpacesV1', () async {
        await simulateEvents([SyncStreamStub.sharedSpaceV1]);
        verify(() => mockSyncStreamRepo.updateSharedSpacesV1(any())).called(1);
        verify(() => mockSyncApiRepo.ack(['shared-space-v1-ack'])).called(1);
      });

      test('sharedSpaceDeleteV1 → deleteSharedSpacesV1', () async {
        await simulateEvents([SyncStreamStub.sharedSpaceDeleteV1]);
        verify(() => mockSyncStreamRepo.deleteSharedSpacesV1(any())).called(1);
        verify(() => mockSyncApiRepo.ack(['shared-space-delete-ack'])).called(1);
      });

      test('sharedSpaceMemberV1 → updateSharedSpaceMembersV1', () async {
        await simulateEvents([SyncStreamStub.sharedSpaceMemberV1]);
        verify(() => mockSyncStreamRepo.updateSharedSpaceMembersV1(any())).called(1);
        verify(() => mockSyncApiRepo.ack(['shared-space-member-v1-ack'])).called(1);
      });

      test('sharedSpaceMemberBackfillV1 → updateSharedSpaceMembersV1 (same handler)', () async {
        await simulateEvents([SyncStreamStub.sharedSpaceMemberBackfillV1]);
        verify(() => mockSyncStreamRepo.updateSharedSpaceMembersV1(any())).called(1);
        verify(() => mockSyncApiRepo.ack(['shared-space-member-backfill-ack'])).called(1);
      });

      test('sharedSpaceMemberDeleteV1 → deleteSharedSpaceMembersV1', () async {
        await simulateEvents([SyncStreamStub.sharedSpaceMemberDeleteV1]);
        verify(() => mockSyncStreamRepo.deleteSharedSpaceMembersV1(any())).called(1);
        verify(() => mockSyncApiRepo.ack(['shared-space-member-delete-ack'])).called(1);
      });
    });
  });

  group("SyncStreamService - remote trash & restore", () {
    setUp(() async {
      await Store.put(StoreKey.manageLocalMediaAndroid, true);
      hasManageMediaPermission = true;
    });

    tearDown(() async {
      await Store.put(StoreKey.manageLocalMediaAndroid, false);
      hasManageMediaPermission = false;
    });

    test("moves backed up local and merged assets to device trash when remote trash events are received", () async {
      final localAsset = LocalAssetStub.image1.copyWith(id: 'local-only', checksum: 'checksum-local', remoteId: null);
      final mergedAsset = LocalAssetStub.image2.copyWith(
        id: 'merged-local',
        checksum: 'checksum-merged',
        remoteId: 'remote-merged',
      );
      final assetsByAlbum = {
        'album-a': [localAsset],
        'album-b': [mergedAsset],
      };
      when(() => mockLocalAssetRepo.getAssetsFromBackupAlbums(any())).thenAnswer((invocation) async {
        final Iterable<String> requestedChecksums = invocation.positionalArguments.first as Iterable<String>;
        expect(requestedChecksums.toSet(), equals({'checksum-local', 'checksum-merged', 'checksum-remote-only'}));
        return assetsByAlbum;
      });

      final localEntity = MockAssetEntity();
      when(() => localEntity.getMediaUrl()).thenAnswer((_) async => 'content://local-only');
      when(() => mockStorageRepo.getAssetEntityForAsset(localAsset)).thenAnswer((_) async => localEntity);

      final mergedEntity = MockAssetEntity();
      when(() => mergedEntity.getMediaUrl()).thenAnswer((_) async => 'content://merged-local');
      when(() => mockStorageRepo.getAssetEntityForAsset(mergedAsset)).thenAnswer((_) async => mergedEntity);

      when(() => mockLocalFilesManagerRepo.moveToTrash(any())).thenAnswer((invocation) async {
        final urls = invocation.positionalArguments.first as List<String>;
        expect(urls, unorderedEquals(['content://local-only', 'content://merged-local']));
        return true;
      });

      final events = [
        SyncStreamStub.assetTrashed(
          id: 'remote-1',
          checksum: localAsset.checksum!,
          ack: 'asset-remote-local-1',
          trashedAt: DateTime(2025, 5, 1),
        ),
        SyncStreamStub.assetTrashed(
          id: 'remote-2',
          checksum: mergedAsset.checksum!,
          ack: 'asset-remote-merged-2',
          trashedAt: DateTime(2025, 5, 2),
        ),
        SyncStreamStub.assetTrashed(
          id: 'remote-3',
          checksum: 'checksum-remote-only',
          ack: 'asset-remote-only-3',
          trashedAt: DateTime(2025, 5, 3),
        ),
      ];

      await simulateEvents(events);

      verify(() => mockTrashedLocalAssetRepo.trashLocalAsset(assetsByAlbum)).called(1);
      verify(() => mockSyncApiRepo.ack(['asset-remote-only-3'])).called(1);
    });

    test("skips device trashing when no local assets match the remote trash payload", () async {
      final events = [
        SyncStreamStub.assetTrashed(
          id: 'remote-only',
          checksum: 'checksum-only',
          ack: 'asset-remote-only-9',
          trashedAt: DateTime(2025, 6, 1),
        ),
      ];

      await simulateEvents(events);

      verify(() => mockLocalAssetRepo.getAssetsFromBackupAlbums(any())).called(1);
      verifyNever(() => mockLocalFilesManagerRepo.moveToTrash(any()));
      verifyNever(() => mockTrashedLocalAssetRepo.trashLocalAsset(any()));
    });

    test("does not request local deletions for permanent remote delete events", () async {
      final events = [SyncStreamStub.assetDeleteV1];

      await simulateEvents(events);

      verifyNever(() => mockLocalAssetRepo.getAssetsFromBackupAlbums(any()));
      verifyNever(() => mockLocalFilesManagerRepo.moveToTrash(any()));
      verify(() => mockSyncStreamRepo.deleteAssetsV1(any())).called(1);
    });

    test("restores trashed local assets once the matching remote assets leave the trash", () async {
      final trashedAssets = [
        LocalAssetStub.image1.copyWith(id: 'trashed-1', checksum: 'checksum-trash', remoteId: 'remote-1'),
      ];
      when(() => mockTrashedLocalAssetRepo.getToRestore()).thenAnswer((_) async => trashedAssets);

      final restoredIds = ['trashed-1'];
      when(() => mockLocalFilesManagerRepo.restoreAssetsFromTrash(any())).thenAnswer((invocation) async {
        final Iterable<LocalAsset> requestedAssets = invocation.positionalArguments.first as Iterable<LocalAsset>;
        expect(requestedAssets, orderedEquals(trashedAssets));
        return restoredIds;
      });

      final events = [
        SyncStreamStub.assetModified(id: 'remote-1', checksum: 'checksum-trash', ack: 'asset-remote-1-11'),
      ];

      await simulateEvents(events);

      verify(() => mockTrashedLocalAssetRepo.applyRestoredAssets(restoredIds)).called(1);
    });
  });

  group('SyncStreamService - Sync Migration', () {
    test('ensure that <2.5.0 migrations run', () async {
      await Store.put(StoreKey.syncMigrationStatus, "[]");
      when(
        () => mockServerApi.getServerVersion(),
      ).thenAnswer((_) async => ServerVersionResponseDto(major: 2, minor: 4, patch_: 1));

      await sut.sync();

      verifyInOrder([
        () => mockSyncApiRepo.deleteSyncAck([
          SyncEntityType.assetExifV1,
          SyncEntityType.partnerAssetExifV1,
          SyncEntityType.albumAssetExifCreateV1,
          SyncEntityType.albumAssetExifUpdateV1,
        ]),
        () => mockSyncMigrationRepo.v20260128CopyExifWidthHeightToAsset(),
      ]);

      // should only run on server >2.5.0
      verifyNever(
        () => mockSyncApiRepo.deleteSyncAck([
          SyncEntityType.assetV1,
          SyncEntityType.partnerAssetV1,
          SyncEntityType.albumAssetCreateV1,
          SyncEntityType.albumAssetUpdateV1,
        ]),
      );
    });
    test('ensure that >=2.5.0 migrations run', () async {
      await Store.put(StoreKey.syncMigrationStatus, "[]");
      when(
        () => mockServerApi.getServerVersion(),
      ).thenAnswer((_) async => ServerVersionResponseDto(major: 2, minor: 5, patch_: 0));
      await sut.sync();

      verifyInOrder([
        () => mockSyncApiRepo.deleteSyncAck([
          SyncEntityType.assetExifV1,
          SyncEntityType.partnerAssetExifV1,
          SyncEntityType.albumAssetExifCreateV1,
          SyncEntityType.albumAssetExifUpdateV1,
        ]),
        () => mockSyncApiRepo.deleteSyncAck([
          SyncEntityType.assetV1,
          SyncEntityType.partnerAssetV1,
          SyncEntityType.albumAssetCreateV1,
          SyncEntityType.albumAssetUpdateV1,
        ]),
      ]);

      // v20260128_ResetAssetV1 writes that v20260128_CopyExifWidthHeightToAsset has been completed
      verifyNever(() => mockSyncMigrationRepo.v20260128CopyExifWidthHeightToAsset());
    });

    test('ensure that migrations do not re-run', () async {
      await Store.put(
        StoreKey.syncMigrationStatus,
        '["${SyncMigrationTask.v20260128_CopyExifWidthHeightToAsset.name}"]',
      );

      when(
        () => mockServerApi.getServerVersion(),
      ).thenAnswer((_) async => ServerVersionResponseDto(major: 2, minor: 4, patch_: 1));

      await sut.sync();

      verifyNever(() => mockSyncMigrationRepo.v20260128CopyExifWidthHeightToAsset());
    });
  });
}
