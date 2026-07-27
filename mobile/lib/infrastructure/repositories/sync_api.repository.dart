import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:immich_mobile/constants/constants.dart';
import 'package:immich_mobile/domain/models/server_capability.model.dart';
import 'package:immich_mobile/domain/models/sync_event.model.dart';
import 'package:immich_mobile/infrastructure/repositories/network.repository.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:immich_mobile/utils/semver.dart';
import 'package:logging/logging.dart';
import 'package:openapi/api.dart';

class SyncApiRepository {
  final Logger _logger = Logger('SyncApiRepository');
  final ApiService _api;
  SyncApiRepository(this._api);

  Future<void> ack(List<String> data) {
    return _api.syncApi.sendSyncAck(SyncAckSetDto(acks: data));
  }

  Future<void> deleteSyncAck(List<SyncEntityType> types) {
    return _api.syncApi.deleteSyncAck(SyncAckDeleteDto(types: Optional.present(types)));
  }

  /// The five Phase-2B space-album request types. Kept in one place so the capability
  /// filter and the version-gate fallback can never drift apart.
  static const _spaceAlbumSyncTypes = [
    SyncRequestType.sharedSpaceAlbumsV1,
    SyncRequestType.sharedSpaceAlbumLinksV1,
    SyncRequestType.sharedSpaceAlbumToAssetsV1,
    SyncRequestType.sharedSpaceAlbumAssetsV1,
    SyncRequestType.sharedSpaceAlbumAssetExifsV1,
  ];

  Future<void> streamChanges(
    Future<void> Function(List<SyncEvent>, Function() abort, Function() reset) onData, {
    required SemVer serverVersion,
    Set<String>? supportedSyncTypes,
    Function()? onReset,
    int batchSize = kSyncEventBatchSize,
    http.Client? httpClient,
    Future<void>? abortSignal,
  }) async {
    final stopwatch = Stopwatch()..start();
    final client = httpClient ?? NetworkRepository.client;
    final endpoint = "${_api.apiClient.basePath}/sync/stream";

    final headers = {'Content-Type': 'application/json', 'Accept': 'application/jsonlines+json'};

    final request = http.AbortableRequest('POST', Uri.parse(endpoint), abortTrigger: abortSignal);
    request.headers.addAll(headers);
    request.body = jsonEncode(
      SyncStreamDto(
        types: [
          SyncRequestType.authUsersV1,
          SyncRequestType.usersV1,
          serverVersion.supports(.syncV2) ? SyncRequestType.assetsV2 : SyncRequestType.assetsV1,
          SyncRequestType.assetExifsV1,
          if (serverVersion.supports(.assetEdits)) SyncRequestType.assetEditsV1,
          SyncRequestType.assetMetadataV1,
          SyncRequestType.partnersV1,
          serverVersion.supports(.syncV2) ? SyncRequestType.partnerAssetsV2 : SyncRequestType.partnerAssetsV1,
          SyncRequestType.partnerAssetExifsV1,
          serverVersion.supports(.syncV2) ? SyncRequestType.albumsV2 : SyncRequestType.albumsV1,
          SyncRequestType.albumUsersV1,
          serverVersion.supports(.syncV2) ? SyncRequestType.albumAssetsV2 : SyncRequestType.albumAssetsV1,
          SyncRequestType.albumAssetExifsV1,
          SyncRequestType.albumToAssetsV1,
          SyncRequestType.memoriesV1,
          SyncRequestType.memoryToAssetsV1,
          SyncRequestType.stacksV1,
          SyncRequestType.partnerStacksV1,
          SyncRequestType.userMetadataV1,
          SyncRequestType.peopleV1,
          serverVersion.supports(.assetFacesV2) ? SyncRequestType.assetFacesV2 : SyncRequestType.assetFacesV1,
          if (serverVersion.supports(.assetOcr)) SyncRequestType.assetOcrV1,
          // --- gallery-fork: shared-space + library sync types ---
          //
          // PR 1 added the server emitters and the mobile dispatch handlers but
          // never added these types to the mobile's request list, so the sync
          // stream silently skipped them. PR 2's SpaceDetailPage UI switchover
          // surfaced the bug because the new Drift-backed timeline depends on
          // these tables being populated. Without these entries the
          // shared_space_*, library_* tables stay empty forever.
          //
          // These are gallery-fork-only types — a stock Immich server will
          // reject the request. The mobile build is intended to talk only to
          // gallery-fork servers.
          SyncRequestType.sharedSpacesV1,
          SyncRequestType.sharedSpaceMembersV1,
          SyncRequestType.sharedSpaceAssetsV1,
          SyncRequestType.sharedSpaceAssetExifsV1,
          SyncRequestType.sharedSpaceToAssetsV1,
          SyncRequestType.librariesV1,
          SyncRequestType.libraryAssetsV1,
          SyncRequestType.libraryAssetExifsV1,
          SyncRequestType.sharedSpaceLibrariesV1,
          // --- gallery-fork: shared-space album sync types (Phase 2B) ---
          //
          // mobile-1: gate these 5 request types behind the fork-server version that
          // first ships the space-albums feature. An older fork server's
          // SyncRequestTypeSchema (z.enum) REJECTS unknown enum values with a 400 for
          // the WHOLE /sync/stream request → a total sync outage on an app that is
          // ahead of the server (mobile + server release independently). The boundary
          // is a FORK version: deployed fork servers report FORK_VERSION (stamped into
          // server/package.json by branding/scripts/apply-branding.sh patch_versions),
          // NOT the upstream Immich version — so do NOT copy the 3.0.0 OCR gate. v5.0.0
          // is the last release WITHOUT space-albums; the feature (and its enum values)
          // ship in the next release, so gate on strictly-after-5.0.0, which also admits
          // the feature's release-candidates. See slice-5 plan §0.1 for the full evidence
          // and the release-time reconciliation note. There is no complementary
          // server-side defense: a slice-5 filter that dropped unknown request types
          // was later reverted, so an older/skewed server's SyncRequestTypeSchema
          // still 400s the WHOLE /sync/stream request on any unrecognized type. This
          // client-side version gate is therefore the ONLY protection — every future
          // gallery-fork-only request type MUST be gated the same way.
          // M14 resolution: servers now DECLARE the request types they accept via
          // GET /server/features (syncRequestTypes), which the sync service passes in as
          // [supportedSyncTypes]. The declaration is authoritative in both directions — it
          // opens the gate on servers whose version LIES about the feature (an RC image
          // stamps the bare base version, an unbranded dev server reports the upstream
          // version) and keeps it closed on future servers that drop a type. The version
          // gate below survives only as the fallback for fork servers that predate
          // capability signalling (their /server/features has no syncRequestTypes field).
          if (supportedSyncTypes != null)
            ...(_spaceAlbumSyncTypes.where((type) => supportedSyncTypes.contains(type.toJson())))
          else if (serverVersion > const SemVer(major: 5, minor: 0, patch: 0))
            ..._spaceAlbumSyncTypes,
        ],
      ).toJson(),
    );

    String previousChunk = '';
    final List<String> lines = [];

    bool shouldAbort = false;

    void abort() {
      _logger.warning("Abort requested, stopping sync stream");
      shouldAbort = true;
    }

    final reset = onReset ?? () {};

    try {
      final response = await client.send(request);

      if (response.statusCode != 200) {
        final errorBody = await response.stream.bytesToString();
        throw ApiException(response.statusCode, 'Failed to get sync stream: $errorBody');
      }

      await for (final chunk in response.stream.transform(utf8.decoder)) {
        if (shouldAbort) {
          break;
        }

        previousChunk += chunk;
        final parts = previousChunk.split('\n');
        previousChunk = parts.removeLast();
        lines.addAll(parts);

        if (lines.length < batchSize) {
          continue;
        }

        await onData(_parseLines(lines), abort, reset);
        lines.clear();
      }

      if (lines.isNotEmpty && !shouldAbort) {
        await onData(_parseLines(lines), abort, reset);
      }
    } catch (error, stack) {
      return Future.error(error, stack);
    }
    stopwatch.stop();
    _logger.info("Remote Sync completed in ${stopwatch.elapsed.inMilliseconds}ms");
  }

  List<SyncEvent> _parseLines(List<String> lines) {
    final List<SyncEvent> data = [];

    for (final line in lines) {
      final jsonData = jsonDecode(line);
      final type = SyncEntityType.fromJson(jsonData['type'])!;
      final dataJson = jsonData['data'];
      final ack = jsonData['ack'];
      final converter = _kResponseMap[type];
      if (converter == null) {
        _logger.warning("Unknown type $type");
        continue;
      }

      data.add(SyncEvent(type: type, data: converter(dataJson), ack: ack));
    }

    return data;
  }
}

const _kResponseMap = <SyncEntityType, Function(Object)>{
  SyncEntityType.authUserV1: SyncAuthUserV1.fromJson,
  SyncEntityType.userV1: SyncUserV1.fromJson,
  SyncEntityType.userDeleteV1: SyncUserDeleteV1.fromJson,
  SyncEntityType.partnerV1: SyncPartnerV1.fromJson,
  SyncEntityType.partnerDeleteV1: SyncPartnerDeleteV1.fromJson,
  SyncEntityType.assetV1: SyncAssetV1.fromJson,
  SyncEntityType.assetV2: SyncAssetV2.fromJson,
  SyncEntityType.assetDeleteV1: SyncAssetDeleteV1.fromJson,
  SyncEntityType.assetExifV1: SyncAssetExifV1.fromJson,
  SyncEntityType.assetEditV1: SyncAssetEditV1.fromJson,
  SyncEntityType.assetEditDeleteV1: SyncAssetEditDeleteV1.fromJson,
  SyncEntityType.assetMetadataV1: SyncAssetMetadataV1.fromJson,
  SyncEntityType.assetMetadataDeleteV1: SyncAssetMetadataDeleteV1.fromJson,
  SyncEntityType.partnerAssetV1: SyncAssetV1.fromJson,
  SyncEntityType.partnerAssetV2: SyncAssetV2.fromJson,
  SyncEntityType.partnerAssetBackfillV1: SyncAssetV1.fromJson,
  SyncEntityType.partnerAssetBackfillV2: SyncAssetV2.fromJson,
  SyncEntityType.partnerAssetDeleteV1: SyncAssetDeleteV1.fromJson,
  SyncEntityType.partnerAssetExifV1: SyncAssetExifV1.fromJson,
  SyncEntityType.partnerAssetExifBackfillV1: SyncAssetExifV1.fromJson,
  SyncEntityType.albumV1: SyncAlbumV1.fromJson,
  SyncEntityType.albumV2: SyncAlbumV2.fromJson,
  SyncEntityType.albumDeleteV1: SyncAlbumDeleteV1.fromJson,
  SyncEntityType.albumUserV1: SyncAlbumUserV1.fromJson,
  SyncEntityType.albumUserBackfillV1: SyncAlbumUserV1.fromJson,
  SyncEntityType.albumUserDeleteV1: SyncAlbumUserDeleteV1.fromJson,
  SyncEntityType.albumAssetCreateV1: SyncAssetV1.fromJson,
  SyncEntityType.albumAssetCreateV2: SyncAssetV2.fromJson,
  SyncEntityType.albumAssetUpdateV1: SyncAssetV1.fromJson,
  SyncEntityType.albumAssetUpdateV2: SyncAssetV2.fromJson,
  SyncEntityType.albumAssetBackfillV1: SyncAssetV1.fromJson,
  SyncEntityType.albumAssetBackfillV2: SyncAssetV2.fromJson,
  SyncEntityType.albumAssetExifCreateV1: SyncAssetExifV1.fromJson,
  SyncEntityType.albumAssetExifUpdateV1: SyncAssetExifV1.fromJson,
  SyncEntityType.albumAssetExifBackfillV1: SyncAssetExifV1.fromJson,
  SyncEntityType.albumToAssetV1: SyncAlbumToAssetV1.fromJson,
  SyncEntityType.albumToAssetBackfillV1: SyncAlbumToAssetV1.fromJson,
  SyncEntityType.albumToAssetDeleteV1: SyncAlbumToAssetDeleteV1.fromJson,
  SyncEntityType.syncAckV1: _SyncEmptyDto.fromJson,
  SyncEntityType.syncResetV1: _SyncEmptyDto.fromJson,
  SyncEntityType.memoryV1: SyncMemoryV1.fromJson,
  SyncEntityType.memoryDeleteV1: SyncMemoryDeleteV1.fromJson,
  SyncEntityType.memoryToAssetV1: SyncMemoryAssetV1.fromJson,
  SyncEntityType.memoryToAssetDeleteV1: SyncMemoryAssetDeleteV1.fromJson,
  SyncEntityType.stackV1: SyncStackV1.fromJson,
  SyncEntityType.stackDeleteV1: SyncStackDeleteV1.fromJson,
  SyncEntityType.partnerStackV1: SyncStackV1.fromJson,
  SyncEntityType.partnerStackBackfillV1: SyncStackV1.fromJson,
  SyncEntityType.partnerStackDeleteV1: SyncStackDeleteV1.fromJson,
  SyncEntityType.userMetadataV1: SyncUserMetadataV1.fromJson,
  SyncEntityType.userMetadataDeleteV1: SyncUserMetadataDeleteV1.fromJson,
  SyncEntityType.personV1: SyncPersonV1.fromJson,
  SyncEntityType.personDeleteV1: SyncPersonDeleteV1.fromJson,
  SyncEntityType.assetFaceV1: SyncAssetFaceV1.fromJson,
  SyncEntityType.assetFaceV2: SyncAssetFaceV2.fromJson,
  SyncEntityType.assetFaceDeleteV1: SyncAssetFaceDeleteV1.fromJson,
  SyncEntityType.assetOcrV1: SyncAssetOcrV1.fromJson,
  SyncEntityType.assetOcrDeleteV1: SyncAssetOcrDeleteV1.fromJson,
  SyncEntityType.syncCompleteV1: _SyncEmptyDto.fromJson,
  // --- gallery-fork: shared-space sync types ---
  SyncEntityType.sharedSpaceV1: SyncSharedSpaceV1.fromJson,
  SyncEntityType.sharedSpaceDeleteV1: SyncSharedSpaceDeleteV1.fromJson,
  SyncEntityType.sharedSpaceMemberV1: SyncSharedSpaceMemberV1.fromJson,
  SyncEntityType.sharedSpaceMemberBackfillV1: SyncSharedSpaceMemberV1.fromJson,
  SyncEntityType.sharedSpaceMemberDeleteV1: SyncSharedSpaceMemberDeleteV1.fromJson,
  SyncEntityType.sharedSpaceAssetCreateV1: SyncAssetV1.fromJson,
  SyncEntityType.sharedSpaceAssetUpdateV1: SyncAssetV1.fromJson,
  SyncEntityType.sharedSpaceAssetBackfillV1: SyncAssetV1.fromJson,
  SyncEntityType.sharedSpaceAssetExifCreateV1: SyncAssetExifV1.fromJson,
  SyncEntityType.sharedSpaceAssetExifUpdateV1: SyncAssetExifV1.fromJson,
  SyncEntityType.sharedSpaceAssetExifBackfillV1: SyncAssetExifV1.fromJson,
  SyncEntityType.sharedSpaceToAssetV1: SyncSharedSpaceToAssetV1.fromJson,
  SyncEntityType.sharedSpaceToAssetBackfillV1: SyncSharedSpaceToAssetV1.fromJson,
  SyncEntityType.sharedSpaceToAssetDeleteV1: SyncSharedSpaceToAssetDeleteV1.fromJson,
  // --- gallery-fork: library sync types ---
  SyncEntityType.libraryV1: SyncLibraryV1.fromJson,
  SyncEntityType.libraryDeleteV1: SyncLibraryDeleteV1.fromJson,
  SyncEntityType.libraryAssetCreateV1: SyncAssetV1.fromJson,
  SyncEntityType.libraryAssetBackfillV1: SyncAssetV1.fromJson,
  SyncEntityType.libraryAssetDeleteV1: SyncLibraryAssetDeleteV1.fromJson,
  SyncEntityType.libraryAssetExifCreateV1: SyncAssetExifV1.fromJson,
  SyncEntityType.libraryAssetExifBackfillV1: SyncAssetExifV1.fromJson,
  SyncEntityType.sharedSpaceLibraryV1: SyncSharedSpaceLibraryV1.fromJson,
  SyncEntityType.sharedSpaceLibraryBackfillV1: SyncSharedSpaceLibraryV1.fromJson,
  SyncEntityType.sharedSpaceLibraryDeleteV1: SyncSharedSpaceLibraryDeleteV1.fromJson,
  // --- gallery-fork: shared-space album sync types (Phase 2B) ---
  SyncEntityType.sharedSpaceAlbumV1: SyncAlbumV2.fromJson,
  SyncEntityType.sharedSpaceAlbumBackfillV1: SyncAlbumV2.fromJson,
  SyncEntityType.sharedSpaceAlbumDeleteV1: SyncAlbumDeleteV1.fromJson,
  SyncEntityType.sharedSpaceAlbumLinkV1: SyncSharedSpaceAlbumLinkV1.fromJson,
  SyncEntityType.sharedSpaceAlbumLinkBackfillV1: SyncSharedSpaceAlbumLinkV1.fromJson,
  SyncEntityType.sharedSpaceAlbumLinkDeleteV1: SyncSharedSpaceAlbumLinkDeleteV1.fromJson,
  SyncEntityType.sharedSpaceAlbumToAssetV1: SyncAlbumToAssetV1.fromJson,
  SyncEntityType.sharedSpaceAlbumToAssetBackfillV1: SyncAlbumToAssetV1.fromJson,
  SyncEntityType.sharedSpaceAlbumToAssetDeleteV1: SyncAlbumToAssetDeleteV1.fromJson,
  SyncEntityType.sharedSpaceAlbumAssetCreateV1: SyncAssetV2.fromJson,
  SyncEntityType.sharedSpaceAlbumAssetUpdateV1: SyncAssetV2.fromJson,
  SyncEntityType.sharedSpaceAlbumAssetBackfillV1: SyncAssetV2.fromJson,
  SyncEntityType.sharedSpaceAlbumAssetExifCreateV1: SyncAssetExifV1.fromJson,
  SyncEntityType.sharedSpaceAlbumAssetExifUpdateV1: SyncAssetExifV1.fromJson,
  SyncEntityType.sharedSpaceAlbumAssetExifBackfillV1: SyncAssetExifV1.fromJson,
};

class _SyncEmptyDto {
  static _SyncEmptyDto? fromJson(dynamic _) => _SyncEmptyDto();
}
