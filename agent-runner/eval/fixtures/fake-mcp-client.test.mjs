import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ALBUM_JAPAN_ID, DATASET, PLAN_ID } from './dataset.mjs';
import { createFakeMcpClient } from './fake-mcp-client.mjs';

describe('fake MCP client', () => {
  it('answers listAlbums from the dataset', async () => {
    const { client } = createFakeMcpClient();
    const result = await client.call('listAlbums', {}, {});
    assert.equal(result.status, 'success');
    assert.deepEqual(
      result.albums.map((a) => a.albumName),
      ['Japan', 'Summer', 'Summer'],
    );
  });

  it('records every call with name, args and order', async () => {
    const { client, calls } = createFakeMcpClient();
    await client.call('listAlbums', {}, {});
    await client.call('readAlbum', { albumId: ALBUM_JAPAN_ID }, {});
    assert.deepEqual(
      calls.map((c) => c.name),
      ['listAlbums', 'readAlbum'],
    );
    assert.deepEqual(calls[1].args, { albumId: ALBUM_JAPAN_ID });
  });

  it('throws on an unknown tool rather than returning undefined', async () => {
    const { client } = createFakeMcpClient();
    await assert.rejects(() => client.call('noSuchTool', {}, {}), /unexpected tool "noSuchTool"/);
  });

  it('still records a call that throws', async () => {
    const { client, calls } = createFakeMcpClient();
    await client.call('noSuchTool', {}, {}).catch(() => {});
    assert.deepEqual(
      calls.map((c) => c.name),
      ['noSuchTool'],
    );
  });

  it('returns a plan id from every plan tool', async () => {
    const { client } = createFakeMcpClient();
    for (const tool of ['proposeAlbumOperations', 'proposeAlbumFromSelection', 'proposeAssetBatchFromSelection']) {
      const result = await client.call(tool, {}, {});
      assert.equal(result.plan.id, PLAN_ID, `${tool} should return the seeded plan id`);
    }
  });

  it('override: an Error instance is thrown', async () => {
    const boom = new Error('planning exploded');
    const { client } = createFakeMcpClient({ overrides: { proposeAlbumOperations: boom } });
    await assert.rejects(() => client.call('proposeAlbumOperations', {}, {}), /planning exploded/);
  });

  it('override: a plain object is returned verbatim', async () => {
    const { client } = createFakeMcpClient({
      overrides: { proposeAlbumFromSelection: { status: 'approval-required', toolCall: { id: 'tc-1' } } },
    });
    const result = await client.call('proposeAlbumFromSelection', {}, {});
    assert.equal(result.status, 'approval-required');
    assert.equal(result.toolCall.id, 'tc-1');
  });

  it('override: a function receives the args', async () => {
    const { client } = createFakeMcpClient({
      overrides: { listAlbums: (args) => ({ status: 'success', albums: [], echoed: args }) },
    });
    const result = await client.call('listAlbums', { q: 1 }, {});
    assert.deepEqual(result.albums, []);
    assert.deepEqual(result.echoed, { q: 1 });
  });

  it('override: an empty result set is expressible', async () => {
    const { client } = createFakeMcpClient({ overrides: { listDuplicateGroups: { status: 'success', groups: [] } } });
    const result = await client.call('listDuplicateGroups', {}, {});
    assert.deepEqual(result.groups, []);
  });

  it('does not share the calls array between clients', async () => {
    const a = createFakeMcpClient();
    const b = createFakeMcpClient();
    await a.client.call('listAlbums', {}, {});
    assert.equal(a.calls.length, 1);
    assert.equal(b.calls.length, 0);
  });

  it('seeds two albums with the same name so ambiguity is reachable', () => {
    const summer = DATASET.albums.filter((a) => a.albumName === 'Summer');
    assert.equal(summer.length, 2);
    assert.notEqual(summer[0].id, summer[1].id);
  });
});
