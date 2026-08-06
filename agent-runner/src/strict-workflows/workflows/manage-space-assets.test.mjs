import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { makeContractClient } from './contract-fixtures.mjs';
import { manageSpaceAssetsWorkflow } from './manage-space-assets.mjs';

const wf = manageSpaceAssetsWorkflow();

describe('manage_space_assets router — match()', () => {
  it('matches "add my newest 20 photos to the Family space"', () => {
    assert.deepEqual(wf.match('add my newest 20 photos to the Family space'), {
      slots: { action: 'add', spaceRef: 'Family', sourceDescription: 'my newest 20 photos' },
    });
  });

  it('matches "remove my screenshots from the Family space"', () => {
    assert.deepEqual(wf.match('remove my screenshots from the Family space'), {
      slots: { action: 'remove', spaceRef: 'Family', sourceDescription: 'my screenshots' },
    });
  });

  it('matches "add my photos from 2024 to the Trips space"', () => {
    assert.deepEqual(wf.match('add my photos from 2024 to the Trips space'), {
      slots: { action: 'add', spaceRef: 'Trips', sourceDescription: 'my photos from 2024' },
    });
  });

  it('returns undefined for a member add (not a photo source)', () => {
    assert.equal(wf.match('add Alex to the Family space'), undefined);
  });

  it('returns undefined for multiple members', () => {
    assert.equal(wf.match('add Alex and Sam to the Family space'), undefined);
  });

  it('returns undefined when there is no "space" keyword in the target', () => {
    assert.equal(wf.match('add my newest 20 photos to Family'), undefined);
  });

  it('returns undefined for an album target (no space keyword)', () => {
    assert.equal(wf.match('add my newest 20 photos to the Trips album'), undefined);
  });

  it('returns undefined with no space target at all', () => {
    assert.equal(wf.match('archive my newest 50 photos'), undefined);
  });

  it('returns undefined when "remove … from Family" has no "space" keyword', () => {
    assert.equal(wf.match('remove my screenshots from Family'), undefined);
  });

  it('returns undefined for an empty prompt', () => {
    assert.equal(wf.match(''), undefined);
  });

  it('returns undefined for a subjective source', () => {
    assert.equal(wf.match('add the best photos to the Family space'), undefined);
  });
});

describe('manage_space_assets router — parseSlots()', () => {
  it('normalizes a spaceRef that includes "the … space"', () => {
    assert.deepEqual(
      wf.parseSlots({ action: 'add', spaceRef: 'the Family space', sourceDescription: 'my newest 20 photos' }),
      { action: 'add', spaceRef: 'Family', sourceDescription: 'my newest 20 photos' },
    );
  });

  it('returns null when sourceDescription is blank', () => {
    assert.equal(wf.parseSlots({ action: 'remove', spaceRef: 'Family', sourceDescription: '  ' }), null);
  });

  it('infers action from the prompt verb when the slot is missing', () => {
    assert.deepEqual(
      wf.parseSlots(
        { spaceRef: 'Family', sourceDescription: 'my newest 20 photos' },
        'add my newest 20 photos to the Family space',
      ),
      { action: 'add', spaceRef: 'Family', sourceDescription: 'my newest 20 photos' },
    );
  });

  it('returns null when action is unknown and not inferable', () => {
    assert.equal(wf.parseSlots({ action: 'frobnicate', spaceRef: 'Family', sourceDescription: 'x' }), null);
  });

  it('returns null when spaceRef is missing', () => {
    assert.equal(wf.parseSlots({ action: 'add', sourceDescription: 'my newest 20 photos' }), null);
  });
});

describe('manage_space_assets identity', () => {
  it('has the correct kind, flow, and a run function', () => {
    assert.equal(wf.kind, 'manage_space_assets');
    assert.equal(wf.flow, 'hybrid');
    assert.equal(typeof wf.run, 'function');
  });
});

describe('manage_space_assets execution', () => {
  it('ADD planned: proposeAddAssetsToSpaceFromSearch with spaceId only, selectionHandle, no assetIds', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({ client, slots: { action: 'add', spaceRef: 'Family', sourceDescription: 'my newest 20 photos' } });
    assert.equal(outcome.status, 'planned');
    const proposeCall = client.calls.find((c) => c.name === 'proposeAddAssetsToSpaceFromSearch');
    assert.ok(proposeCall, 'proposeAddAssetsToSpaceFromSearch was called');
    assert.equal(proposeCall.args.spaceId, 'spc-1');
    assert.equal(proposeCall.args.spaceName, undefined);
    assert.deepEqual(proposeCall.args.assetSource, { kind: 'selectionHandle', selectionHandleId: 'handle-1' });
    assert.ok(!JSON.stringify(client.calls).includes('assetIds'), 'no raw assetIds in calls');
  });

  it('ADD planned: searchAssets is metadata, order desc, limit 20, no query', async () => {
    const client = makeContractClient();
    await wf.run({ client, slots: { action: 'add', spaceRef: 'Family', sourceDescription: 'my newest 20 photos' } });
    const searchCall = client.calls.find((c) => c.name === 'searchAssets');
    assert.ok(searchCall, 'searchAssets was called');
    assert.equal(searchCall.args.mode, 'metadata');
    assert.equal(searchCall.args.order, 'desc');
    assert.equal(searchCall.args.limit, 20);
    assert.equal(searchCall.args.query, undefined);
  });

  it('REMOVE planned: proposeAlbumOperations with space.removeAssets op matching contract', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({ client, slots: { action: 'remove', spaceRef: 'Family', sourceDescription: 'my photos from 2024' } });
    assert.equal(outcome.status, 'planned');
    const proposeCall = client.calls.find((c) => c.name === 'proposeAlbumOperations');
    assert.ok(proposeCall, 'proposeAlbumOperations was called');
    assert.deepEqual(proposeCall.args.operations[0], {
      type: 'space.removeAssets',
      summary: 'Remove matching photos.',
      targetKind: 'existing_space',
      targetId: 'spc-1',
      assetSource: { kind: 'selectionHandle', selectionHandleId: 'handle-1' },
      payload: {},
    });
  });

  it('REMOVE date source: searchAssets filters match the 2024 date range', async () => {
    const client = makeContractClient();
    await wf.run({ client, slots: { action: 'remove', spaceRef: 'Family', sourceDescription: 'my photos from 2024' } });
    const searchCall = client.calls.find((c) => c.name === 'searchAssets');
    assert.ok(searchCall, 'searchAssets was called');
    assert.deepEqual(searchCall.args.filters, {
      takenAfter: '2024-01-01T00:00:00.000Z',
      takenBefore: '2024-12-31T23:59:59.999Z',
    });
  });

  it('handoff: screenshots source (ADD) → handoff_open, no propose call', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({ client, slots: { action: 'add', spaceRef: 'Family', sourceDescription: 'my screenshots' } });
    assert.equal(outcome.status, 'handoff_open');
    const proposeCall = client.calls.find((c) => c.name === 'proposeAddAssetsToSpaceFromSearch' || c.name === 'proposeAlbumOperations');
    assert.equal(proposeCall, undefined);
  });

  it('handoff: subjective source "the best ones" → handoff_open, no propose call', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({ client, slots: { action: 'add', spaceRef: 'Family', sourceDescription: 'the best ones' } });
    assert.equal(outcome.status, 'handoff_open');
    const proposeCall = client.calls.find((c) => c.name === 'proposeAddAssetsToSpaceFromSearch' || c.name === 'proposeAlbumOperations');
    assert.equal(proposeCall, undefined);
  });

  it('empty: zero-count handle (ADD) → needs_input, no propose call', async () => {
    const client = makeContractClient({ handleAssetCount: 0 });
    const outcome = await wf.run({ client, slots: { action: 'add', spaceRef: 'Family', sourceDescription: 'my newest 20 photos' } });
    assert.equal(outcome.status, 'needs_input');
    const proposeCall = client.calls.find((c) => c.name === 'proposeAddAssetsToSpaceFromSearch' || c.name === 'proposeAlbumOperations');
    assert.equal(proposeCall, undefined);
  });

  it('space unknown: no space match → needs_input, no searchAssets or propose', async () => {
    const client = makeContractClient({ spaces: [] });
    const outcome = await wf.run({ client, slots: { action: 'add', spaceRef: 'Nope', sourceDescription: 'my newest 20 photos' } });
    assert.equal(outcome.status, 'needs_input');
    const searchCall = client.calls.find((c) => c.name === 'searchAssets');
    assert.equal(searchCall, undefined);
    const proposeCall = client.calls.find((c) => c.name === 'proposeAddAssetsToSpaceFromSearch' || c.name === 'proposeAlbumOperations');
    assert.equal(proposeCall, undefined);
  });

  it('space ambiguous: multiple matches → needs_input, no propose', async () => {
    const client = makeContractClient({ spaces: [{ id: 's1', name: 'Family' }, { id: 's2', name: 'Family' }] });
    const outcome = await wf.run({ client, slots: { action: 'add', spaceRef: 'Family', sourceDescription: 'my newest 20 photos' } });
    assert.equal(outcome.status, 'needs_input');
    const proposeCall = client.calls.find((c) => c.name === 'proposeAddAssetsToSpaceFromSearch' || c.name === 'proposeAlbumOperations');
    assert.equal(proposeCall, undefined);
  });

  it('gate: plan without persisted id → failed, no success text for ADD', async () => {
    const client = makeContractClient({ planResult: { status: 'success', plan: {} } });
    const outcome = await wf.run({ client, slots: { action: 'add', spaceRef: 'Family', sourceDescription: 'my newest 20 photos' } });
    assert.equal(outcome.status, 'failed');
    assert.ok(!/prepared/i.test(outcome.text), 'failure text must not say "prepared"');
  });

  it('gate: plan without persisted id → failed, no success text for REMOVE', async () => {
    const client = makeContractClient({ planResult: { status: 'success', plan: {} } });
    const outcome = await wf.run({ client, slots: { action: 'remove', spaceRef: 'Family', sourceDescription: 'my photos from 2024' } });
    assert.equal(outcome.status, 'failed');
    assert.ok(!/prepared/i.test(outcome.text), 'failure text must not say "prepared"');
  });

  it('listSpaces throws → failed', async () => {
    const client = {
      calls: [],
      async call(name, args) {
        this.calls.push({ name, args });
        if (name === 'listSpaces') throw new Error('network error');
        throw new Error(`unexpected: ${name}`);
      },
    };
    const outcome = await wf.run({ client, slots: { action: 'add', spaceRef: 'Family', sourceDescription: 'my newest 20 photos' } });
    assert.equal(outcome.status, 'failed');
  });

  it('searchAssets throws → failed', async () => {
    const baseClient = makeContractClient();
    const client = {
      calls: [],
      async call(name, args) {
        this.calls.push({ name, args });
        if (name === 'searchAssets') throw new Error('search error');
        return baseClient.call(name, args);
      },
    };
    const outcome = await wf.run({ client, slots: { action: 'add', spaceRef: 'Family', sourceDescription: 'my newest 20 photos' } });
    assert.equal(outcome.status, 'failed');
  });

  it('propose tool throws → failed', async () => {
    const baseClient = makeContractClient();
    const client = {
      calls: [],
      async call(name, args) {
        this.calls.push({ name, args });
        if (name === 'proposeAddAssetsToSpaceFromSearch') throw new Error('propose error');
        return baseClient.call(name, args);
      },
    };
    const outcome = await wf.run({ client, slots: { action: 'add', spaceRef: 'Family', sourceDescription: 'my newest 20 photos' } });
    assert.equal(outcome.status, 'failed');
  });

  it('success summary: ADD planned → successSummary with correct fields, text mentions add and Family', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({ client, slots: { action: 'add', spaceRef: 'Family', sourceDescription: 'my newest 20 photos' } });
    assert.equal(outcome.status, 'planned');
    assert.deepEqual(outcome.successSummary, {
      workflowKind: 'manage_space_assets',
      spaceName: 'Family',
      assetCount: 20,
      action: 'add',
    });
    assert.ok(/add/i.test(outcome.text));
    assert.ok(/Family/.test(outcome.text));
  });

  it('contract-fixtures: proposeAddAssetsToSpaceFromSearch rejects both spaceId+spaceName (exactly one rule)', async () => {
    const client = makeContractClient();
    await assert.rejects(
      () => client.call('proposeAddAssetsToSpaceFromSearch', { spaceId: 'a', spaceName: 'b', assetSource: { kind: 'selectionHandle', selectionHandleId: 'h' } }),
      /exactly one/i,
    );
  });

  it('contract-fixtures: proposeAddAssetsToSpaceFromSearch rejects missing assetSource', async () => {
    const client = makeContractClient();
    await assert.rejects(
      () => client.call('proposeAddAssetsToSpaceFromSearch', { spaceId: 'a' }),
      /assetSource/i,
    );
  });

  it('contract-fixtures: proposeAddAssetsToSpaceFromSearch accepts valid spaceId + assetSource', async () => {
    const client = makeContractClient();
    const result = await client.call('proposeAddAssetsToSpaceFromSearch', { spaceId: 'a', assetSource: { kind: 'selectionHandle', selectionHandleId: 'h' } });
    assert.deepEqual(result, { status: 'success', plan: { id: 'plan-1' } });
  });

  it('contract-fixtures: proposeAlbumOperations space.removeAssets rejects targetKind "new_space"', async () => {
    const client = makeContractClient();
    await assert.rejects(
      () => client.call('proposeAlbumOperations', { operations: [{ type: 'space.removeAssets', targetKind: 'new_space', targetId: 'spc-1', assetSource: { kind: 'selectionHandle', selectionHandleId: 'h' }, payload: {} }] }),
      /existing_space/i,
    );
  });

  it('contract-fixtures: proposeAlbumOperations space.removeAssets rejects missing targetId', async () => {
    const client = makeContractClient();
    await assert.rejects(
      () => client.call('proposeAlbumOperations', { operations: [{ type: 'space.removeAssets', targetKind: 'existing_space', assetSource: { kind: 'selectionHandle', selectionHandleId: 'h' }, payload: {} }] }),
      /targetId/i,
    );
  });

  it('contract-fixtures: proposeAlbumOperations space.removeAssets rejects non-empty payload', async () => {
    const client = makeContractClient();
    await assert.rejects(
      () => client.call('proposeAlbumOperations', { operations: [{ type: 'space.removeAssets', targetKind: 'existing_space', targetId: 'spc-1', assetSource: { kind: 'selectionHandle', selectionHandleId: 'h' }, payload: { x: 1 } }] }),
      /payload/i,
    );
  });

  it('contract-fixtures: proposeAlbumOperations space.removeAssets accepts valid op', async () => {
    const client = makeContractClient();
    const result = await client.call('proposeAlbumOperations', { summary: 'test', operations: [{ type: 'space.removeAssets', targetKind: 'existing_space', targetId: 'spc-1', assetSource: { kind: 'selectionHandle', selectionHandleId: 'h' }, payload: {} }] });
    assert.deepEqual(result, { status: 'success', plan: { id: 'plan-1' } });
  });
});

// ─── D4b: durable space disambiguation (continuation) ─────────────────────────

const NOW = 1_000_000;

describe('manage_space_assets durable disambiguation (D4)', () => {
  // ── non-ambiguous path unchanged (regression) ────────────────────────────────
  it('non-ambiguous path: plans directly, no continuation', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({
      client,
      slots: { action: 'add', spaceRef: 'Family', sourceDescription: 'my newest 20 photos' },
      nowMs: NOW,
    });
    assert.equal(outcome.status, 'planned');
    assert.equal(outcome.continuation, undefined);
  });

  // ── "not found" stays bare needs_input (no continuation) ────────────────────
  it('not-found space stays bare needs_input without a continuation', async () => {
    const client = makeContractClient({ spaces: [] });
    const outcome = await wf.run({
      client,
      slots: { action: 'add', spaceRef: 'Nope', sourceDescription: 'my newest 20 photos' },
      nowMs: NOW,
    });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(outcome.continuation, undefined);
  });

  // ── ambiguous space: produces continuation with kind + candidates ─────────────
  it('ambiguous space yields needs_input with continuation (kind + candidates, no raw ids leaked)', async () => {
    const client = makeContractClient({
      spaces: [
        { id: 'spc-a', name: 'Family', members: [] },
        { id: 'spc-b', name: 'Family', members: [] },
      ],
    });
    const outcome = await wf.run({
      client,
      slots: { action: 'add', spaceRef: 'Family', sourceDescription: 'my newest 20 photos' },
      nowMs: NOW,
    });
    assert.equal(outcome.status, 'needs_input');
    assert.ok(outcome.continuation, 'continuation must be present');
    assert.equal(outcome.continuation.kind, 'manage_space_assets_space');
    assert.equal(Array.isArray(outcome.continuation.candidates), true);
    assert.equal(outcome.continuation.candidates.length, 2);
    // Candidates must be {index,id,name} only
    for (const c of outcome.continuation.candidates) {
      assert.deepEqual(Object.keys(c).sort(), ['id', 'index', 'name']);
    }
    // slots are carried for the next stage
    assert.ok(outcome.continuation.slots, 'slots must be carried');
    // members array must not leak into candidates
    for (const c of outcome.continuation.candidates) {
      assert.equal('members' in c, false, 'candidate must not carry a members array');
    }
  });

  // ── resume "the first one" → matched ctx resolvedSpaceId → run plans add ──────
  it('resume "the first one" resolves space, then plans add', async () => {
    const ambig = makeContractClient({
      spaces: [
        { id: 'spc-a', name: 'Family', members: [] },
        { id: 'spc-b', name: 'Family', members: [] },
      ],
    });
    // Turn 1: get the continuation
    const outcome1 = await wf.run({
      client: ambig,
      slots: { action: 'add', spaceRef: 'Family', sourceDescription: 'my newest 20 photos' },
      nowMs: NOW,
    });
    assert.equal(outcome1.status, 'needs_input');
    const pending = outcome1.continuation;

    // Turn 2: resume
    const resumed = wf.resumeContinuation({ pending, prompt: 'the first one', nowMs: NOW + 1000 });
    assert.equal(resumed.status, 'matched');
    assert.equal(resumed.ctx.resolvedSpaceId, 'spc-a');
    assert.ok(resumed.ctx.slots, 'slots must be in ctx');

    // Turn 2 run: proposes the add
    const client2 = makeContractClient({
      spaces: [
        { id: 'spc-a', name: 'Family', members: [] },
        { id: 'spc-b', name: 'Family', members: [] },
      ],
    });
    const outcome2 = await wf.run({
      client: client2,
      slots: resumed.ctx.slots,
      resolvedSpaceId: resumed.ctx.resolvedSpaceId,
      nowMs: NOW + 1000,
    });
    assert.equal(outcome2.status, 'planned');
    const proposeCall = client2.calls.find((c) => c.name === 'proposeAddAssetsToSpaceFromSearch');
    assert.ok(proposeCall, 'proposeAddAssetsToSpaceFromSearch was called');
    assert.equal(proposeCall.args.spaceId, 'spc-a');
  });

  // ── resume "2" → plans remove for spc-b ──────────────────────────────────────
  it('resume "2" resolves second space, then plans remove', async () => {
    const pending = {
      kind: 'manage_space_assets_space',
      createdAtMs: NOW,
      candidates: [
        { index: 1, id: 'spc-a', name: 'Family' },
        { index: 2, id: 'spc-b', name: 'Family' },
      ],
      slots: { action: 'remove', spaceRef: 'Family', sourceDescription: 'my photos from 2024' },
    };
    const resumed = wf.resumeContinuation({ pending, prompt: '2', nowMs: NOW + 500 });
    assert.equal(resumed.status, 'matched');
    assert.equal(resumed.ctx.resolvedSpaceId, 'spc-b');

    const client2 = makeContractClient({
      spaces: [
        { id: 'spc-a', name: 'Family', members: [] },
        { id: 'spc-b', name: 'Family', members: [] },
      ],
    });
    const outcome = await wf.run({
      client: client2,
      slots: resumed.ctx.slots,
      resolvedSpaceId: resumed.ctx.resolvedSpaceId,
      nowMs: NOW + 500,
    });
    assert.equal(outcome.status, 'planned');
    const proposeCall = client2.calls.find((c) => c.name === 'proposeAlbumOperations');
    assert.ok(proposeCall, 'proposeAlbumOperations was called');
    assert.equal(proposeCall.args.operations[0].targetId, 'spc-b');
  });

  // ── edge: out-of-range ordinal → needs_input ──────────────────────────────────
  it('out-of-range ordinal in resume → needs_input', () => {
    const pending = {
      kind: 'manage_space_assets_space',
      createdAtMs: NOW,
      candidates: [
        { index: 1, id: 'spc-a', name: 'Family' },
        { index: 2, id: 'spc-b', name: 'Family' },
      ],
      slots: { action: 'add', spaceRef: 'Family', sourceDescription: 'x' },
    };
    const result = wf.resumeContinuation({ pending, prompt: '5', nowMs: NOW + 1000 });
    assert.equal(result.status, 'needs_input');
  });

  // ── edge: name not in list → needs_input ──────────────────────────────────────
  it('name not in list → needs_input', () => {
    const pending = {
      kind: 'manage_space_assets_space',
      createdAtMs: NOW,
      candidates: [
        { index: 1, id: 'spc-a', name: 'Family' },
        { index: 2, id: 'spc-b', name: 'Family 2' },
      ],
      slots: { action: 'add', spaceRef: 'Family', sourceDescription: 'x' },
    };
    const result = wf.resumeContinuation({ pending, prompt: 'Trips', nowMs: NOW + 1000 });
    assert.equal(result.status, 'needs_input');
  });

  // ── edge: expired continuation → expired message ──────────────────────────────
  it('expired continuation → expired message', () => {
    const pending = {
      kind: 'manage_space_assets_space',
      createdAtMs: NOW,
      candidates: [{ index: 1, id: 'spc-a', name: 'Family' }],
      slots: { action: 'add', spaceRef: 'Family', sourceDescription: 'x' },
    };
    const result = wf.resumeContinuation({ pending, prompt: '1', nowMs: NOW + 15 * 60 * 1000 });
    assert.equal(result.status, 'expired');
    assert.match(result.text, /expired/i);
  });

  // ── workflow exposes resumeContinuation ───────────────────────────────────────
  it('workflow exposes resumeContinuation', () => {
    assert.equal(typeof wf.resumeContinuation, 'function');
  });
});
