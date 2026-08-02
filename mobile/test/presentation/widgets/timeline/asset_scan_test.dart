import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/asset_scan.dart';

void main() {
  group('assetScanChunks', () {
    List<({int index, int count})> chunks({int firstAssetIndex = 0, required int assetCount, int chunkSize = 250}) =>
        assetScanChunks(firstAssetIndex: firstAssetIndex, assetCount: assetCount, chunkSize: chunkSize).toList();

    test('an empty segment yields no chunks', () {
      expect(chunks(assetCount: 0), isEmpty);
    });

    test('a negative assetCount yields no chunks', () {
      expect(chunks(assetCount: -5), isEmpty);
    });

    test('fewer assets than the chunk size yields one exact chunk', () {
      expect(chunks(assetCount: 10, chunkSize: 250), [(index: 0, count: 10)]);
    });

    test('exactly one chunk size yields one chunk', () {
      expect(chunks(assetCount: 250, chunkSize: 250), [(index: 0, count: 250)]);
    });

    test('one more than a chunk size yields two chunks, the second of count 1', () {
      expect(chunks(assetCount: 251, chunkSize: 250), [(index: 0, count: 250), (index: 250, count: 1)]);
    });

    test('chunks are contiguous and their counts sum to assetCount', () {
      final result = chunks(assetCount: 1003, chunkSize: 250);

      expect(result.fold<int>(0, (sum, c) => sum + c.count), 1003);
      for (var i = 1; i < result.length; i++) {
        expect(result[i].index, result[i - 1].index + result[i - 1].count);
      }
    });

    test('chunks start at a non-zero firstAssetIndex', () {
      expect(chunks(firstAssetIndex: 1000, assetCount: 300, chunkSize: 250), [
        (index: 1000, count: 250),
        (index: 1250, count: 50),
      ]);
    });

    test('a chunkSize of zero is clamped to one so the sequence stays finite', () {
      // A zero or negative chunk size would otherwise yield nothing (a silent
      // "asset not found") or loop forever.
      expect(chunks(assetCount: 3, chunkSize: 0), [(index: 0, count: 1), (index: 1, count: 1), (index: 2, count: 1)]);
    });

    test('a negative chunkSize is clamped to one', () {
      expect(chunks(assetCount: 2, chunkSize: -10), [(index: 0, count: 1), (index: 1, count: 1)]);
    });
  });

  group('findAssetIndex', () {
    // A fake timeline of `total` assets. Records every window requested so the
    // tests can assert on read volume as well as the resolved index.
    ({AssetRangeLoader load, List<({int index, int count})> reads}) fakeTimeline(int total) {
      final reads = <({int index, int count})>[];
      Future<List<BaseAsset>> load(int index, int count) async {
        reads.add((index: index, count: count));
        return [for (var i = index; i < index + count; i++) _remote('asset-$i')];
      }

      return (load: load, reads: reads);
    }

    test('finds a target in the first chunk', () async {
      final timeline = fakeTimeline(1000);

      final result = await findAssetIndex(
        loadAssets: timeline.load,
        firstAssetIndex: 0,
        assetCount: 1000,
        target: _remote('asset-7'),
        chunkSize: 250,
      );

      expect(result, 7);
      expect(timeline.reads, hasLength(1));
    });

    test('finds a target in a later chunk, accounting for preceding chunks', () async {
      final timeline = fakeTimeline(1000);

      final result = await findAssetIndex(
        loadAssets: timeline.load,
        firstAssetIndex: 0,
        assetCount: 1000,
        target: _remote('asset-612'),
        chunkSize: 250,
      );

      expect(result, 612);
    });

    test('resolves an absolute index when the segment does not start at zero', () async {
      final timeline = fakeTimeline(2000);

      final result = await findAssetIndex(
        loadAssets: timeline.load,
        firstAssetIndex: 900,
        assetCount: 300,
        target: _remote('asset-1100'),
        chunkSize: 250,
      );

      expect(result, 1100);
    });

    test('finds the last asset in the segment', () async {
      final timeline = fakeTimeline(1000);

      final result = await findAssetIndex(
        loadAssets: timeline.load,
        firstAssetIndex: 0,
        assetCount: 500,
        target: _remote('asset-499'),
        chunkSize: 250,
      );

      expect(result, 499);
    });

    test('returns null for an absent target, requesting each chunk exactly once', () async {
      final timeline = fakeTimeline(1000);

      final result = await findAssetIndex(
        loadAssets: timeline.load,
        firstAssetIndex: 0,
        assetCount: 500,
        target: _remote('not-in-this-timeline'),
        chunkSize: 250,
      );

      expect(result, isNull);
      expect(timeline.reads, [(index: 0, count: 250), (index: 250, count: 250)]);
    });

    test('resolves correctly when a chunk returns fewer assets than requested', () async {
      // The service is free to return a short page; the offset must come from the
      // requested window, not from a running count of what came back.
      Future<List<BaseAsset>> shortLoad(int index, int count) async {
        if (index == 0) return [_remote('asset-0')]; // asked for 4, got 1
        return [for (var i = index; i < index + count; i++) _remote('asset-$i')];
      }

      final result = await findAssetIndex(
        loadAssets: shortLoad,
        firstAssetIndex: 0,
        assetCount: 8,
        target: _remote('asset-5'),
        chunkSize: 4,
      );

      expect(result, 5);
    });

    test('returns null instead of throwing when a read fails', () async {
      Future<List<BaseAsset>> failing(int index, int count) async => throw StateError('db gone');

      await expectLater(
        findAssetIndex(loadAssets: failing, firstAssetIndex: 0, assetCount: 10, target: _remote('asset-1')),
        completion(isNull),
      );
    });

    test('short-circuits an empty segment without reading', () async {
      final timeline = fakeTimeline(10);

      final result = await findAssetIndex(
        loadAssets: timeline.load,
        firstAssetIndex: 0,
        assetCount: 0,
        target: _remote('asset-1'),
      );

      expect(result, isNull);
      expect(timeline.reads, isEmpty);
    });

    test('stops at the cap and gives up rather than scanning a huge segment', () async {
      final timeline = fakeTimeline(5000);

      final result = await findAssetIndex(
        loadAssets: timeline.load,
        firstAssetIndex: 0,
        assetCount: 5000,
        target: _remote('asset-4000'),
        chunkSize: 250,
        cap: 2000,
      );

      expect(result, isNull);
      expect(timeline.reads.fold<int>(0, (sum, r) => sum + r.count), 2000);
    });

    test('still finds a target that sits just inside the cap', () async {
      final timeline = fakeTimeline(5000);

      final result = await findAssetIndex(
        loadAssets: timeline.load,
        firstAssetIndex: 0,
        assetCount: 5000,
        target: _remote('asset-1999'),
        chunkSize: 250,
        cap: 2000,
      );

      expect(result, 1999);
    });

    test('matches on remoteId even when localId differs', () async {
      // RemoteAsset.hashCode includes localId while == does not, so `==` would miss
      // this. The album-fetched copy has localId=null; the merged-timeline copy has it.
      Future<List<BaseAsset>> load(int index, int count) async => [_remote('asset-0', localId: 'local-abc')];

      final result = await findAssetIndex(
        loadAssets: load,
        firstAssetIndex: 0,
        assetCount: 1,
        target: _remote('asset-0'),
      );

      expect(result, 0);
    });

    test('matches on localId when neither side has a remote id', () async {
      Future<List<BaseAsset>> load(int index, int count) async => [_local('local-1')];

      final result = await findAssetIndex(
        loadAssets: load,
        firstAssetIndex: 0,
        assetCount: 1,
        target: _local('local-1'),
      );

      expect(result, 0);
    });

    test('falls back to checksum when neither id pair is comparable', () async {
      // A local-only asset (no remoteId) against a remote asset with no localId:
      // both id arms bail out, so checksum is the only thing left.
      Future<List<BaseAsset>> load(int index, int count) async => [_local('local-9', checksum: 'shared-checksum')];

      final result = await findAssetIndex(
        loadAssets: load,
        firstAssetIndex: 0,
        assetCount: 1,
        target: _remote('remote-9', checksum: 'shared-checksum'),
      );

      expect(result, 0);
    });

    test('does not match an asset that shares nothing', () async {
      Future<List<BaseAsset>> load(int index, int count) async => [_remote('asset-0')];

      final result = await findAssetIndex(
        loadAssets: load,
        firstAssetIndex: 0,
        assetCount: 1,
        target: _remote('asset-1'),
      );

      expect(result, isNull);
    });
  });
}

RemoteAsset _remote(String id, {String? localId, String? checksum}) => RemoteAsset(
  id: id,
  localId: localId,
  name: '$id.jpg',
  ownerId: 'owner-1',
  checksum: checksum ?? 'checksum-$id',
  type: AssetType.image,
  createdAt: DateTime(2026, 4, 3, 12),
  updatedAt: DateTime(2026, 4, 3, 12),
  isEdited: false,
);

LocalAsset _local(String id, {String? checksum}) => LocalAsset(
  id: id,
  name: '$id.jpg',
  checksum: checksum,
  type: AssetType.image,
  createdAt: DateTime(2026, 4, 3, 12),
  updatedAt: DateTime(2026, 4, 3, 12),
  playbackStyle: AssetPlaybackStyle.image,
  isEdited: false,
);
