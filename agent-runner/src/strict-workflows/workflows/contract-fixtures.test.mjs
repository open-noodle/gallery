import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { KNOWN_BATCH_ACTION_TYPES, KNOWN_OPERATION_TYPES, makeContractClient } from './contract-fixtures.mjs';

const newUuid = () => '00000000-0000-4000-8000-000000000001';

describe('makeContractClient — contract-faithful fake MCP client', () => {
  it('resolveAssetSearchFilters rejects a free-text query (strictObject has no query field)', async () => {
    const client = makeContractClient();
    await assert.rejects(() => client.call('resolveAssetSearchFilters', { query: 'newest 20' }), /query/i);
    assert.deepEqual(await client.call('resolveAssetSearchFilters', { people: ['Alex'] }), { resolvedFilters: {} });
  });

  it('searchAssets rejects query in metadata mode but accepts it in smart mode', async () => {
    const client = makeContractClient();
    await assert.rejects(() => client.call('searchAssets', { query: 'beach' }), /metadata/i); // default mode
    await assert.rejects(() => client.call('searchAssets', { mode: 'metadata', query: 'beach' }), /metadata/i);
    const smart = await client.call('searchAssets', { mode: 'smart', query: 'beach', detail: 'handle' });
    assert.equal(smart.selectionHandle.id, 'handle-1');
  });

  it('searchAssets returns a selection handle for a metadata recency search', async () => {
    const client = makeContractClient({ handleAssetCount: 7 });
    const res = await client.call('searchAssets', { mode: 'metadata', order: 'desc', limit: 20, detail: 'handle' });
    assert.equal(res.selectionHandle.id, 'handle-1');
    assert.equal(res.selectionHandle.assetCount, 7);
  });

  it('searchAssets rejects an out-of-enum detail', async () => {
    const client = makeContractClient();
    await assert.rejects(() => client.call('searchAssets', { detail: 'bogus' }), /detail/i);
  });

  it('searchAssets enforces the metadata filters strictObject + AssetType enum', async () => {
    const client = makeContractClient();
    // Valid: a known key + an in-enum type does NOT throw.
    const ok = await client.call('searchAssets', {
      mode: 'metadata',
      detail: 'handle',
      filters: { type: 'VIDEO', takenAfter: '2024-01-01T00:00:00.000Z' },
    });
    assert.equal(ok.selectionHandle.id, 'handle-1');
    // Invalid: a type outside the AssetType enum.
    await assert.rejects(
      () => client.call('searchAssets', { mode: 'metadata', filters: { type: 'BOGUS' } }),
      /type/i,
    );
    // Invalid: an unknown filter key (the real DTO is a strictObject).
    await assert.rejects(
      () => client.call('searchAssets', { mode: 'metadata', filters: { notARealKey: true } }),
      /filter key/i,
    );
  });

  it('searchAssets accepts quality threshold filters', async () => {
    const client = makeContractClient();
    const ok = await client.call('searchAssets', {
      mode: 'metadata',
      detail: 'handle',
      filters: { maxSharpness: 35, maxBrightness: 30, maxQuality: 40 },
    });
    assert.equal(ok.selectionHandle.id, 'handle-1');
  });

  it('searchAssets enforces shared-space filter cross-field constraints', async () => {
    const client = makeContractClient();

    await assert.rejects(
      () =>
        client.call('searchAssets', {
          mode: 'metadata',
          detail: 'handle',
          filters: { spacePersonIds: ['space-person-1'] },
        }),
      /spacePersonIds requires spaceId/i,
    );

    await assert.rejects(
      () =>
        client.call('searchAssets', {
          mode: 'metadata',
          detail: 'handle',
          filters: { spaceId: 'space-1', withSharedSpaces: true },
        }),
      /Cannot use both spaceId and withSharedSpaces/i,
    );
  });

  it('proposeAssetBatchFromSelection accepts each valid action', async () => {
    const client = makeContractClient();
    for (const action of [
      { type: 'asset.setArchive', archived: true },
      { type: 'asset.setFavorite', favorite: false },
      { type: 'asset.addTag', tagName: 'Travel' },
      { type: 'asset.addTag', tagId: newUuid() },
    ]) {
      const res = await client.call('proposeAssetBatchFromSelection', { action, selectionHandleId: 'h' });
      assert.equal(res.plan.id, 'plan-1');
    }
  });

  it('proposeAssetBatchFromSelection enforces the action shape', async () => {
    const client = makeContractClient();
    // addTag: exactly one of tagName/tagId
    await assert.rejects(
      () => client.call('proposeAssetBatchFromSelection', { action: { type: 'asset.addTag' }, selectionHandleId: 'h' }),
      /tagName|tagId/i,
    );
    await assert.rejects(
      () =>
        client.call('proposeAssetBatchFromSelection', {
          action: { type: 'asset.addTag', tagName: 'T', tagId: newUuid() },
          selectionHandleId: 'h',
        }),
      /tagName|tagId/i,
    );
    // unknown action type
    await assert.rejects(
      () => client.call('proposeAssetBatchFromSelection', { action: { type: 'asset.bogus' }, selectionHandleId: 'h' }),
      /action/i,
    );
    // missing selection handle
    await assert.rejects(
      () => client.call('proposeAssetBatchFromSelection', { action: { type: 'asset.setArchive', archived: true } }),
      /selectionHandle/i,
    );
  });

  it('proposeAlbumOperations accepts album and space ops but rejects unknown types', async () => {
    const client = makeContractClient();
    const ok = await client.call('proposeAlbumOperations', {
      summary: 's',
      operations: [
        { type: 'album.addAssets', targetKind: 'existing_album', targetId: 'a', assetSource: { kind: 'selectionHandle', selectionHandleId: 'h' } },
        { type: 'space.updateDetails', targetKind: 'existing_space', targetId: 'spc-1', payload: { spaceName: 'X' } },
      ],
    });
    assert.equal(ok.plan.id, 'plan-1');
    await assert.rejects(
      () => client.call('proposeAlbumOperations', { summary: 's', operations: [{ type: 'bogus.op' }] }),
      /operation type/i,
    );
  });

  it('proposeAlbumFromSelection requires albumName + selectionHandleId', async () => {
    const client = makeContractClient();
    const ok = await client.call('proposeAlbumFromSelection', { albumName: 'A', selectionHandleId: 'h' });
    assert.equal(ok.plan.id, 'plan-1');
    await assert.rejects(() => client.call('proposeAlbumFromSelection', { selectionHandleId: 'h' }), /albumName/i);
    await assert.rejects(() => client.call('proposeAlbumFromSelection', { albumName: 'A' }), /selectionHandle/i);
  });

  it('readSpace returns members for a known id and throws for an unknown id', async () => {
    const client = makeContractClient({
      spaces: [{ id: 'spc-1', name: 'Family', members: [{ userId: 'u1', name: 'Owner', role: 'owner' }] }],
    });
    const space = await client.call('readSpace', { spaceId: 'spc-1' });
    assert.equal(space.members[0].role, 'owner');
    await assert.rejects(() => client.call('readSpace', { spaceId: 'nope' }), /not found/i);
  });

  it('listSpaces hides member detail; searchUsers returns users; calls are recorded in order', async () => {
    const client = makeContractClient({
      spaces: [{ id: 'spc-1', name: 'Family', members: [{ userId: 'u1', name: 'Owner', role: 'owner' }] }],
      users: [{ id: 'usr-1', name: 'Alex', email: 'alex@example.com' }],
    });
    const list = await client.call('listSpaces', {});
    assert.equal(list.spaces[0].name, 'Family');
    assert.equal(list.spaces[0].members, undefined);
    const users = await client.call('searchUsers', { query: 'Alex' });
    assert.equal(users.users[0].name, 'Alex');
    assert.deepEqual(
      client.calls.map((c) => c.name),
      ['listSpaces', 'searchUsers'],
    );
  });

  it('rejects an unexpected tool name', async () => {
    const client = makeContractClient();
    await assert.rejects(() => client.call('teleport', {}), /unexpected/i);
  });

  it('exports the known-type sets used by the validators', () => {
    assert.ok(KNOWN_OPERATION_TYPES.has('space.updateMemberRole'));
    assert.ok(KNOWN_OPERATION_TYPES.has('album.create'));
    assert.ok(KNOWN_BATCH_ACTION_TYPES.has('asset.addTag'));
  });

  it('resolveAssetSearchFilters — caps and shape validation', async () => {
    const client = makeContractClient();
    // unknown key
    await assert.rejects(() => client.call('resolveAssetSearchFilters', { foo: ['x'] }), /unrecognized|foo/i);
    // exceeds 20 names
    await assert.rejects(() => client.call('resolveAssetSearchFilters', { people: Array(21).fill('x') }), /exceed|20/i);
    // name too long
    await assert.rejects(() => client.call('resolveAssetSearchFilters', { people: ['x'.repeat(121)] }), /120|exceed/i);
    // valid: default client returns resolvedFilters: {}
    assert.deepEqual(await client.call('resolveAssetSearchFilters', { people: ['Alex'] }), { resolvedFilters: {} });
  });

  it('resolveAssetSearchFilters — configurable matched/ambiguous returns', async () => {
    const matched = makeContractClient({
      resolvedFilters: { personIds: ['per-1'] },
      resolveResults: [{ kind: 'person', query: 'Alex', status: 'matched', choices: [], message: '' }],
    });
    const result = await matched.call('resolveAssetSearchFilters', { people: ['Alex'] });
    assert.deepEqual(result.resolvedFilters, { personIds: ['per-1'] });
    assert.equal(result.results[0].status, 'matched');

    const ambiguous = makeContractClient({
      resolvedFilters: {},
      resolveResults: [{ kind: 'person', query: 'Alex', status: 'ambiguous', choices: ['Alex Smith', 'Alex Jones'], message: '' }],
    });
    const amb = await ambiguous.call('resolveAssetSearchFilters', { people: ['Alex'] });
    assert.equal(amb.results[0].status, 'ambiguous');
    assert.ok(amb.results[0].choices.length > 0);
  });

  it('searchAssets — rating-range and visibility-enum validation', async () => {
    const client = makeContractClient();
    // rating 0 is out of range (1–5)
    await assert.rejects(
      () => client.call('searchAssets', { mode: 'metadata', detail: 'handle', filters: { rating: 0 } }),
      /rating/i,
    );
    // rating 6 is out of range
    await assert.rejects(
      () => client.call('searchAssets', { mode: 'metadata', detail: 'handle', filters: { rating: 6 } }),
      /rating/i,
    );
    // rating null is accepted (clears the filter)
    const nullRating = await client.call('searchAssets', { mode: 'metadata', detail: 'handle', filters: { rating: null } });
    assert.equal(nullRating.selectionHandle.id, 'handle-1');
    // unknown visibility rejected
    await assert.rejects(
      () => client.call('searchAssets', { mode: 'metadata', detail: 'handle', filters: { visibility: 'bogus' } }),
      /visibility/i,
    );
    // known visibility accepted
    const archiveVis = await client.call('searchAssets', { mode: 'metadata', detail: 'handle', filters: { visibility: 'archive' } });
    assert.equal(archiveVis.selectionHandle.id, 'handle-1');
    // rating 5 accepted
    const rating5 = await client.call('searchAssets', { mode: 'metadata', detail: 'handle', filters: { rating: 5 } });
    assert.equal(rating5.selectionHandle.id, 'handle-1');
  });
});

describe('makeContractClient — asset.rotate action', () => {
  it('rejects angle 45 with /angle/i error', async () => {
    const client = makeContractClient();
    await assert.rejects(
      () => client.call('proposeAssetBatchFromSelection', { action: { type: 'asset.rotate', angle: 45 }, selectionHandleId: 'h' }),
      /angle/i,
    );
  });

  it('accepts angle 90 and returns plan-1', async () => {
    const client = makeContractClient();
    const res = await client.call('proposeAssetBatchFromSelection', { action: { type: 'asset.rotate', angle: 90 }, selectionHandleId: 'h' });
    assert.equal(res.plan.id, 'plan-1');
  });

  it('accepts angle 180 and returns plan-1', async () => {
    const client = makeContractClient();
    const res = await client.call('proposeAssetBatchFromSelection', { action: { type: 'asset.rotate', angle: 180 }, selectionHandleId: 'h' });
    assert.equal(res.plan.id, 'plan-1');
  });

  it('accepts angle 270 and returns plan-1', async () => {
    const client = makeContractClient();
    const res = await client.call('proposeAssetBatchFromSelection', { action: { type: 'asset.rotate', angle: 270 }, selectionHandleId: 'h' });
    assert.equal(res.plan.id, 'plan-1');
  });
});

describe('makeContractClient — readAlbum handler', () => {
  it('returns album detail for a known id (includes ownerId and albumUsers)', async () => {
    const client = makeContractClient({
      albums: [
        {
          id: 'alb-1',
          albumName: 'Family',
          ownerId: 'u-owner',
          assetIds: ['00000000-0000-4000-8000-000000000001'],
          albumThumbnailAssetId: '00000000-0000-4000-8000-000000000001',
          albumUsers: [{ userId: 'u-bob', role: 'viewer' }],
        },
      ],
    });
    const result = await client.call('readAlbum', { albumId: 'alb-1' });
    assert.deepEqual(result, {
      album: {
        id: 'alb-1',
        albumName: 'Family',
        ownerId: 'u-owner',
        assetIds: ['00000000-0000-4000-8000-000000000001'],
        albumThumbnailAssetId: '00000000-0000-4000-8000-000000000001',
        albumUsers: [{ userId: 'u-bob', role: 'viewer' }],
      },
    });
  });

  it('throws /album not found/i for an unknown id', async () => {
    const client = makeContractClient({
      albums: [{ id: 'alb-1', albumName: 'Family', assetIds: [], albumThumbnailAssetId: null }],
    });
    await assert.rejects(() => client.call('readAlbum', { albumId: 'nope' }), /album not found/i);
  });
});

describe('makeContractClient — album.setCover validator', () => {
  it('KNOWN_OPERATION_TYPES includes album.setCover', () => {
    assert.equal(KNOWN_OPERATION_TYPES.has('album.setCover'), true);
  });

  it('accepts a valid album.setCover op', async () => {
    const client = makeContractClient();
    const result = await client.call('proposeAlbumOperations', {
      operations: [
        {
          type: 'album.setCover',
          targetKind: 'existing_album',
          targetId: '00000000-0000-4000-8000-000000000001',
          assetIds: ['00000000-0000-4000-8000-000000000002'],
        },
      ],
    });
    assert.equal(result.plan.id, 'plan-1');
  });

  it('rejects album.setCover without targetId', async () => {
    const client = makeContractClient();
    await assert.rejects(
      () =>
        client.call('proposeAlbumOperations', {
          operations: [
            {
              type: 'album.setCover',
              targetKind: 'existing_album',
              assetIds: ['00000000-0000-4000-8000-000000000001'],
            },
          ],
        }),
      /targetId/i,
    );
  });

  it('rejects album.setCover with empty assetIds', async () => {
    const client = makeContractClient();
    await assert.rejects(
      () =>
        client.call('proposeAlbumOperations', {
          operations: [
            {
              type: 'album.setCover',
              targetKind: 'existing_album',
              targetId: '00000000-0000-4000-8000-000000000001',
              assetIds: [],
            },
          ],
        }),
      /assetId|cover/i,
    );
  });

  it('rejects album.setCover with wrong targetKind', async () => {
    const client = makeContractClient();
    await assert.rejects(
      () =>
        client.call('proposeAlbumOperations', {
          operations: [
            {
              type: 'album.setCover',
              targetKind: 'asset_batch',
              targetId: '00000000-0000-4000-8000-000000000001',
              assetIds: ['00000000-0000-4000-8000-000000000002'],
            },
          ],
        }),
      /existing_album/i,
    );
  });

  it('rejects album.setCover with a non-empty payload', async () => {
    const client = makeContractClient();
    await assert.rejects(
      () =>
        client.call('proposeAlbumOperations', {
          operations: [
            {
              type: 'album.setCover',
              targetKind: 'existing_album',
              targetId: '00000000-0000-4000-8000-000000000001',
              assetIds: ['00000000-0000-4000-8000-000000000002'],
              payload: { x: 1 },
            },
          ],
        }),
      /payload/i,
    );
  });
});

describe('makeContractClient — asset.updateMetadata action', () => {
  it('KNOWN_BATCH_ACTION_TYPES includes asset.updateMetadata', () => {
    assert.equal(KNOWN_BATCH_ACTION_TYPES.has('asset.updateMetadata'), true);
  });

  it('accepts a valid description string', async () => {
    const client = makeContractClient();
    const res = await client.call('proposeAssetBatchFromSelection', {
      action: { type: 'asset.updateMetadata', description: 'Berlin weekend' },
      selectionHandleId: 'h',
    });
    assert.equal(res.plan.id, 'plan-1');
  });

  it('accepts an empty string description (clears the field)', async () => {
    const client = makeContractClient();
    const res = await client.call('proposeAssetBatchFromSelection', {
      action: { type: 'asset.updateMetadata', description: '' },
      selectionHandleId: 'h',
    });
    assert.equal(res.plan.id, 'plan-1');
  });

  it('accepts rating:5 and rating:null', async () => {
    const client = makeContractClient();
    const r5 = await client.call('proposeAssetBatchFromSelection', {
      action: { type: 'asset.updateMetadata', rating: 5 },
      selectionHandleId: 'h',
    });
    assert.equal(r5.plan.id, 'plan-1');
    const rNull = await client.call('proposeAssetBatchFromSelection', {
      action: { type: 'asset.updateMetadata', rating: null },
      selectionHandleId: 'h',
    });
    assert.equal(rNull.plan.id, 'plan-1');
  });

  it('accepts latitude + longitude pair', async () => {
    const client = makeContractClient();
    const res = await client.call('proposeAssetBatchFromSelection', {
      action: { type: 'asset.updateMetadata', latitude: 48.8566, longitude: 2.3522 },
      selectionHandleId: 'h',
    });
    assert.equal(res.plan.id, 'plan-1');
  });

  it('accepts dateTimeRelative non-zero', async () => {
    const client = makeContractClient();
    const res = await client.call('proposeAssetBatchFromSelection', {
      action: { type: 'asset.updateMetadata', dateTimeRelative: 120 },
      selectionHandleId: 'h',
    });
    assert.equal(res.plan.id, 'plan-1');
  });

  it('rejects when no metadata field is supplied', async () => {
    const client = makeContractClient();
    await assert.rejects(
      () => client.call('proposeAssetBatchFromSelection', { action: { type: 'asset.updateMetadata' }, selectionHandleId: 'h' }),
      /at least one metadata field/i,
    );
  });

  it('rejects latitude without longitude', async () => {
    const client = makeContractClient();
    await assert.rejects(
      () => client.call('proposeAssetBatchFromSelection', { action: { type: 'asset.updateMetadata', latitude: 48.8 }, selectionHandleId: 'h' }),
      /both latitude and longitude/i,
    );
  });

  it('rejects longitude without latitude', async () => {
    const client = makeContractClient();
    await assert.rejects(
      () => client.call('proposeAssetBatchFromSelection', { action: { type: 'asset.updateMetadata', longitude: 2.3 }, selectionHandleId: 'h' }),
      /both latitude and longitude/i,
    );
  });

  it('rejects dateTimeOriginal + dateTimeRelative together', async () => {
    const client = makeContractClient();
    await assert.rejects(
      () =>
        client.call('proposeAssetBatchFromSelection', {
          action: { type: 'asset.updateMetadata', dateTimeOriginal: '2024-01-01T00:00:00.000Z', dateTimeRelative: 120 },
          selectionHandleId: 'h',
        }),
      /dateTimeOriginal or dateTimeRelative/i,
    );
  });

  it('rejects dateTimeRelative:0 as the sole field (no-op)', async () => {
    const client = makeContractClient();
    await assert.rejects(
      () =>
        client.call('proposeAssetBatchFromSelection', {
          action: { type: 'asset.updateMetadata', dateTimeRelative: 0 },
          selectionHandleId: 'h',
        }),
      /no-op|dateTimeRelative/i,
    );
  });

  it('rejects out-of-range rating values', async () => {
    const client = makeContractClient();
    await assert.rejects(
      () => client.call('proposeAssetBatchFromSelection', { action: { type: 'asset.updateMetadata', rating: 0 }, selectionHandleId: 'h' }),
      /rating/i,
    );
    await assert.rejects(
      () => client.call('proposeAssetBatchFromSelection', { action: { type: 'asset.updateMetadata', rating: 6 }, selectionHandleId: 'h' }),
      /rating/i,
    );
  });

  it('rejects an unknown field (placeName) — strictObject', async () => {
    const client = makeContractClient();
    await assert.rejects(
      () =>
        client.call('proposeAssetBatchFromSelection', {
          action: { type: 'asset.updateMetadata', description: 'Paris', placeName: 'Paris' },
          selectionHandleId: 'h',
        }),
      /unknown|placeName/i,
    );
  });
});

describe('makeContractClient — asset.removeTag validator', () => {
  const newUuid = () => '00000000-0000-4000-8000-000000000099';

  it('KNOWN_OPERATION_TYPES includes asset.removeTag', () => {
    assert.equal(KNOWN_OPERATION_TYPES.has('asset.removeTag'), true);
  });

  it('accepts a valid asset.removeTag op', async () => {
    const client = makeContractClient();
    const result = await client.call('proposeAlbumOperations', {
      summary: 'remove tag',
      operations: [
        {
          type: 'asset.removeTag',
          targetKind: 'asset_batch',
          assetSource: { kind: 'selectionHandle', selectionHandleId: 'handle-1' },
          payload: { tagId: newUuid() },
        },
      ],
    });
    assert.equal(result.plan.id, 'plan-1');
  });

  it('rejects asset.removeTag with missing payload.tagId', async () => {
    const client = makeContractClient();
    await assert.rejects(
      () =>
        client.call('proposeAlbumOperations', {
          operations: [
            {
              type: 'asset.removeTag',
              targetKind: 'asset_batch',
              assetSource: { kind: 'selectionHandle', selectionHandleId: 'h' },
              payload: {},
            },
          ],
        }),
      /tagId/i,
    );
  });

  it('rejects asset.removeTag with non-string tagId', async () => {
    const client = makeContractClient();
    await assert.rejects(
      () =>
        client.call('proposeAlbumOperations', {
          operations: [
            {
              type: 'asset.removeTag',
              targetKind: 'asset_batch',
              assetSource: { kind: 'selectionHandle', selectionHandleId: 'h' },
              payload: { tagId: 42 },
            },
          ],
        }),
      /tagId/i,
    );
  });

  it('rejects asset.removeTag with targetId present', async () => {
    const client = makeContractClient();
    await assert.rejects(
      () =>
        client.call('proposeAlbumOperations', {
          operations: [
            {
              type: 'asset.removeTag',
              targetKind: 'asset_batch',
              targetId: 'some-id',
              assetSource: { kind: 'selectionHandle', selectionHandleId: 'h' },
              payload: { tagId: newUuid() },
            },
          ],
        }),
      /targetId/i,
    );
  });

  it('rejects asset.removeTag with wrong targetKind', async () => {
    const client = makeContractClient();
    await assert.rejects(
      () =>
        client.call('proposeAlbumOperations', {
          operations: [
            {
              type: 'asset.removeTag',
              targetKind: 'existing_album',
              targetId: 'alb-1',
              assetSource: { kind: 'selectionHandle', selectionHandleId: 'h' },
              payload: { tagId: newUuid() },
            },
          ],
        }),
      /asset_batch/i,
    );
  });

  it('rejects asset.removeTag with missing assetSource', async () => {
    const client = makeContractClient();
    await assert.rejects(
      () =>
        client.call('proposeAlbumOperations', {
          operations: [
            {
              type: 'asset.removeTag',
              targetKind: 'asset_batch',
              payload: { tagId: newUuid() },
            },
          ],
        }),
      /assetSource|selectionHandle/i,
    );
  });

  it('rejects asset.removeTag with search-kind assetSource (must be selectionHandle)', async () => {
    const client = makeContractClient();
    await assert.rejects(
      () =>
        client.call('proposeAlbumOperations', {
          operations: [
            {
              type: 'asset.removeTag',
              targetKind: 'asset_batch',
              assetSource: { kind: 'search', selectionHandleId: 'h' },
              payload: { tagId: newUuid() },
            },
          ],
        }),
      /assetSource|selectionHandle/i,
    );
  });
});

describe('makeContractClient — asset.trash validator', () => {
  it('KNOWN_OPERATION_TYPES includes asset.trash', () => {
    assert.equal(KNOWN_OPERATION_TYPES.has('asset.trash'), true);
  });

  it('accepts a valid asset.trash op (no payload)', async () => {
    const client = makeContractClient();
    const result = await client.call('proposeAlbumOperations', {
      summary: 'move to trash',
      operations: [
        {
          type: 'asset.trash',
          targetKind: 'asset_batch',
          assetSource: { kind: 'selectionHandle', selectionHandleId: 'handle-1' },
        },
      ],
    });
    assert.equal(result.plan.id, 'plan-1');
  });

  it('accepts asset.trash with an empty payload object (payload is present but empty)', async () => {
    const client = makeContractClient();
    const result = await client.call('proposeAlbumOperations', {
      operations: [
        {
          type: 'asset.trash',
          targetKind: 'asset_batch',
          assetSource: { kind: 'selectionHandle', selectionHandleId: 'handle-1' },
          payload: {},
        },
      ],
    });
    assert.equal(result.plan.id, 'plan-1');
  });

  it('rejects asset.trash with a non-empty payload', async () => {
    const client = makeContractClient();
    await assert.rejects(
      () =>
        client.call('proposeAlbumOperations', {
          operations: [
            {
              type: 'asset.trash',
              targetKind: 'asset_batch',
              assetSource: { kind: 'selectionHandle', selectionHandleId: 'handle-1' },
              payload: { reason: 'cleanup' },
            },
          ],
        }),
      /payload/i,
    );
  });

  it('rejects asset.trash with targetId present', async () => {
    const client = makeContractClient();
    await assert.rejects(
      () =>
        client.call('proposeAlbumOperations', {
          operations: [
            {
              type: 'asset.trash',
              targetKind: 'asset_batch',
              targetId: 'some-id',
              assetSource: { kind: 'selectionHandle', selectionHandleId: 'handle-1' },
            },
          ],
        }),
      /targetId/i,
    );
  });

  it('rejects asset.trash with wrong targetKind', async () => {
    const client = makeContractClient();
    await assert.rejects(
      () =>
        client.call('proposeAlbumOperations', {
          operations: [
            {
              type: 'asset.trash',
              targetKind: 'existing_album',
              targetId: 'alb-1',
              assetSource: { kind: 'selectionHandle', selectionHandleId: 'handle-1' },
            },
          ],
        }),
      /asset_batch/i,
    );
  });

  it('rejects asset.trash with missing assetSource', async () => {
    const client = makeContractClient();
    await assert.rejects(
      () =>
        client.call('proposeAlbumOperations', {
          operations: [
            {
              type: 'asset.trash',
              targetKind: 'asset_batch',
            },
          ],
        }),
      /assetSource|selectionHandle/i,
    );
  });

  it('rejects asset.trash with search-kind assetSource (must be selectionHandle)', async () => {
    const client = makeContractClient();
    await assert.rejects(
      () =>
        client.call('proposeAlbumOperations', {
          operations: [
            {
              type: 'asset.trash',
              targetKind: 'asset_batch',
              assetSource: { kind: 'search', selectionHandleId: 'handle-1' },
            },
          ],
        }),
      /assetSource|selectionHandle/i,
    );
  });
});

describe('makeContractClient — asset.trash with assetIds (relaxed validator)', () => {
  it('accepts a valid asset.trash op with explicit assetIds (no assetSource)', async () => {
    const client = makeContractClient();
    const result = await client.call('proposeAlbumOperations', {
      summary: 'trash duplicates',
      operations: [
        {
          type: 'asset.trash',
          targetKind: 'asset_batch',
          assetIds: ['id-1', 'id-2', 'id-3'],
        },
      ],
    });
    assert.equal(result.plan.id, 'plan-1');
  });

  it('accepts a valid asset.trash op with assetSelectionHandleId', async () => {
    const client = makeContractClient();
    const result = await client.call('proposeAlbumOperations', {
      operations: [
        {
          type: 'asset.trash',
          targetKind: 'asset_batch',
          assetSelectionHandleId: 'handle-99',
        },
      ],
    });
    assert.equal(result.plan.id, 'plan-1');
  });

  it('rejects asset.trash with zero selection mechanisms (no assetSource, no assetIds, no assetSelectionHandleId)', async () => {
    const client = makeContractClient();
    await assert.rejects(
      () =>
        client.call('proposeAlbumOperations', {
          operations: [
            {
              type: 'asset.trash',
              targetKind: 'asset_batch',
            },
          ],
        }),
      /assetSource|selectionHandle|assetIds|selection/i,
    );
  });

  it('rejects asset.trash with both assetSource and assetIds (multiple mechanisms)', async () => {
    const client = makeContractClient();
    await assert.rejects(
      () =>
        client.call('proposeAlbumOperations', {
          operations: [
            {
              type: 'asset.trash',
              targetKind: 'asset_batch',
              assetSource: { kind: 'selectionHandle', selectionHandleId: 'h' },
              assetIds: ['id-1'],
            },
          ],
        }),
      /one|single|mechanism|multiple/i,
    );
  });

  it('rejects asset.trash with empty assetIds array', async () => {
    const client = makeContractClient();
    await assert.rejects(
      () =>
        client.call('proposeAlbumOperations', {
          operations: [
            {
              type: 'asset.trash',
              targetKind: 'asset_batch',
              assetIds: [],
            },
          ],
        }),
      /assetIds|empty/i,
    );
  });
});

describe('makeContractClient — listDuplicateGroups handler', () => {
  const makeGroup = (duplicateId, assetCount = 2) => ({
    duplicateId,
    assets: Array.from({ length: assetCount }, (_, i) => ({
      id: `asset-${duplicateId}-${i}`,
      originalFileName: `photo${i}.jpg`,
      fileCreatedAt: new Date('2025-01-01T00:00:00.000Z').toISOString(),
      isFavorite: false,
      rating: null,
      width: null,
      height: null,
    })),
  });

  it('returns configured duplicate groups', async () => {
    const groups = [makeGroup('dup-1'), makeGroup('dup-2')];
    const client = makeContractClient({ duplicateGroups: groups });
    const result = await client.call('listDuplicateGroups', {});
    assert.equal(result.groups.length, 2);
    assert.equal(result.groups[0].duplicateId, 'dup-1');
    assert.equal(result.groups[0].assets.length, 2);
  });

  it('returns empty groups when none configured', async () => {
    const client = makeContractClient();
    const result = await client.call('listDuplicateGroups', {});
    assert.deepEqual(result.groups, []);
  });

  it('caps groups to maxGroups', async () => {
    const groups = Array.from({ length: 10 }, (_, i) => makeGroup(`dup-${i}`));
    const client = makeContractClient({ duplicateGroups: groups });
    const result = await client.call('listDuplicateGroups', { maxGroups: 3 });
    assert.equal(result.groups.length, 3);
  });

  it('accepts valid maxGroups values', async () => {
    const client = makeContractClient();
    const r1 = await client.call('listDuplicateGroups', { maxGroups: 1 });
    assert.deepEqual(r1.groups, []);
    const r2 = await client.call('listDuplicateGroups', { maxGroups: 500 });
    assert.deepEqual(r2.groups, []);
  });

  it('rejects maxGroups: 0', async () => {
    const client = makeContractClient();
    await assert.rejects(() => client.call('listDuplicateGroups', { maxGroups: 0 }), /maxGroups/i);
  });

  it('rejects maxGroups > 500', async () => {
    const client = makeContractClient();
    await assert.rejects(() => client.call('listDuplicateGroups', { maxGroups: 501 }), /maxGroups/i);
  });

  it('rejects unknown request keys', async () => {
    const client = makeContractClient();
    await assert.rejects(() => client.call('listDuplicateGroups', { bogusKey: 'x' }), /unrecognized|bogusKey/i);
  });

  it('is recorded in the calls log', async () => {
    const client = makeContractClient();
    await client.call('listDuplicateGroups', {});
    assert.equal(client.calls[0].name, 'listDuplicateGroups');
  });
});

describe('makeContractClient — searchPeople', () => {
  const alice = { id: 'person-alice', name: 'Alice', faceAssetId: 'asset-alice-face' };
  const john1 = { id: 'person-john-1', name: 'John', faceAssetId: null };
  const john2 = { id: 'person-john-2', name: 'John', faceAssetId: null };

  it('returns matched when exactly one person matches the name (case-insensitive)', async () => {
    const client = makeContractClient({ people: [alice] });
    const result = await client.call('searchPeople', { name: 'alice' });
    assert.deepEqual(result, {
      people: { status: 'matched', personId: 'person-alice', name: 'Alice', thumbnailAssetId: 'asset-alice-face' },
    });
  });

  it('returns ambiguous when multiple people share the same name', async () => {
    const client = makeContractClient({ people: [john1, john2] });
    const result = await client.call('searchPeople', { name: 'John' });
    assert.equal(result.people.status, 'ambiguous');
    assert.equal(result.people.choices.length, 2);
    assert.equal(result.people.choices[0].personId, 'person-john-1');
    assert.equal(result.people.choices[1].personId, 'person-john-2');
  });

  it('returns not_found when no person matches the name', async () => {
    const client = makeContractClient({ people: [alice] });
    const result = await client.call('searchPeople', { name: 'Bob' });
    assert.deepEqual(result, { people: { status: 'not_found' } });
  });

  it('returns not_found when name is empty', async () => {
    const client = makeContractClient({ people: [alice] });
    const result = await client.call('searchPeople', { name: '' });
    assert.deepEqual(result, { people: { status: 'not_found' } });
  });

  it('returns peopleResult override when provided', async () => {
    const override = { status: 'ambiguous', choices: [] };
    const client = makeContractClient({ peopleResult: override });
    const result = await client.call('searchPeople', { name: 'Alice' });
    assert.deepEqual(result, { people: override });
  });
});

describe('makeContractClient — album.delete validator (Slice 3.2)', () => {
  it('KNOWN_OPERATION_TYPES includes album.delete', () => {
    assert.equal(KNOWN_OPERATION_TYPES.has('album.delete'), true);
  });

  it('accepts a valid album.delete op targeting an existing album', async () => {
    const client = makeContractClient();
    const result = await client.call('proposeAlbumOperations', {
      summary: 'Delete the Test album.',
      operations: [
        {
          type: 'album.delete',
          summary: 'Delete the "Test" album (photos are kept in your library).',
          targetKind: 'existing_album',
          targetId: newUuid(),
          riskLevel: 'high',
        },
      ],
    });
    assert.ok(result.plan);
  });

  it('rejects album.delete without targetId', async () => {
    const client = makeContractClient();
    await assert.rejects(
      () =>
        client.call('proposeAlbumOperations', {
          summary: 'Delete without target.',
          operations: [{ type: 'album.delete', summary: 'Missing target.', targetKind: 'existing_album' }],
        }),
      /targetId/i,
    );
  });

  it('rejects album.delete with wrong targetKind', async () => {
    const client = makeContractClient();
    await assert.rejects(
      () =>
        client.call('proposeAlbumOperations', {
          summary: 'Wrong target kind.',
          operations: [
            { type: 'album.delete', summary: 'New album target.', targetKind: 'new_album', temporaryTargetId: 'tmp' },
          ],
        }),
      /targetKind/i,
    );
  });
});

describe('makeContractClient — space.delete validator (Slice 3.2)', () => {
  it('KNOWN_OPERATION_TYPES includes space.delete', () => {
    assert.equal(KNOWN_OPERATION_TYPES.has('space.delete'), true);
  });

  it('accepts a valid space.delete op targeting an existing space', async () => {
    const client = makeContractClient();
    const result = await client.call('proposeAlbumOperations', {
      summary: 'Delete the Family space.',
      operations: [
        {
          type: 'space.delete',
          summary: "Delete the \"Family\" space (photos stay in members' libraries).",
          targetKind: 'existing_space',
          targetId: newUuid(),
          riskLevel: 'high',
        },
      ],
    });
    assert.ok(result.plan);
  });

  it('rejects space.delete without targetId', async () => {
    const client = makeContractClient();
    await assert.rejects(
      () =>
        client.call('proposeAlbumOperations', {
          summary: 'Delete without target.',
          operations: [{ type: 'space.delete', summary: 'Missing target.', targetKind: 'existing_space' }],
        }),
      /targetId/i,
    );
  });

  it('rejects space.delete with wrong targetKind', async () => {
    const client = makeContractClient();
    await assert.rejects(
      () =>
        client.call('proposeAlbumOperations', {
          summary: 'Wrong target kind.',
          operations: [
            { type: 'space.delete', summary: 'New space target.', targetKind: 'new_space', temporaryTargetId: 'tmp' },
          ],
        }),
      /targetKind/i,
    );
  });
});
