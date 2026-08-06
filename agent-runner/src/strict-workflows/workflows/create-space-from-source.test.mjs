import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { makeContractClient } from './contract-fixtures.mjs';
import { createSpaceFromSourceWorkflow } from './create-space-from-source.mjs';

const wf = createSpaceFromSourceWorkflow();

describe('create_space_from_source router & slots', () => {
  it('matches inline name form "make a <Name> space of <source>"', () => {
    assert.deepEqual(wf.match('make a Family space of my newest 50 photos'), {
      slots: { sourceDescription: 'my newest 50 photos', spaceName: 'Family' },
    });
  });

  it('matches trailing name form "create a space from <source> called <Name>"', () => {
    assert.deepEqual(wf.match('create a space from my newest 50 photos called Trips'), {
      slots: { sourceDescription: 'my newest 50 photos', spaceName: 'Trips' },
    });
  });

  it('strips quotes from a titled name', () => {
    assert.deepEqual(wf.match('make a space of my newest 20 photos titled "South Africa"'), {
      slots: { sourceDescription: 'my newest 20 photos', spaceName: 'South Africa' },
    });
  });

  it('matches no-name form (no spaceName in slots)', () => {
    assert.deepEqual(wf.match('create a space from my 2024 photos'), {
      slots: { sourceDescription: 'my 2024 photos' },
    });
  });

  it('tolerates "shared space" without capturing "shared" as a name', () => {
    assert.deepEqual(wf.match('create a shared space of my newest 50 photos'), {
      slots: { sourceDescription: 'my newest 50 photos' },
    });
  });

  it('does not match "album" noun', () => {
    assert.equal(wf.match('make an album of my newest 50 photos'), undefined);
  });

  it('declines a subjective source', () => {
    assert.equal(wf.match('create a space of the best photos from last weekend'), undefined);
  });

  it('does not match a rename prompt', () => {
    assert.equal(wf.match('rename the Family space to Family 2026'), undefined);
  });

  it('does not match a member-add prompt', () => {
    assert.equal(wf.match('add Alex to the Family space'), undefined);
  });

  it('does not match a photo-add-to-existing-space prompt', () => {
    assert.equal(wf.match('add my newest 20 photos to the Family space'), undefined);
  });

  it('rejects an empty prompt', () => {
    assert.equal(wf.match(''), undefined);
  });

  it('strips trailing punctuation from source', () => {
    assert.deepEqual(wf.match('make a space of my photos.'), {
      slots: { sourceDescription: 'my photos' },
    });
  });

  it('parseSlots defaults spaceName to "New Space"', () => {
    assert.deepEqual(wf.parseSlots({ sourceDescription: 'my newest 50 photos' }), {
      sourceDescription: 'my newest 50 photos',
      spaceName: 'New Space',
    });
  });

  it('parseSlots strips quotes from spaceName', () => {
    assert.equal(
      wf.parseSlots({ sourceDescription: 'my newest 50 photos', spaceName: '"Trips"' }).spaceName,
      'Trips',
    );
  });

  it('parseSlots rejects a whitespace-only sourceDescription', () => {
    assert.equal(wf.parseSlots({ sourceDescription: '   ' }), null);
  });

  it('parseSlots rejects a missing sourceDescription', () => {
    assert.equal(wf.parseSlots({ spaceName: 'X' }), null);
  });

  it('has the correct identity fields and a run function', () => {
    assert.equal(wf.kind, 'create_space_from_source');
    assert.equal(wf.flow, 'hybrid');
    assert.equal(typeof wf.run, 'function');
  });
});

describe('create_space_from_source execution', () => {
  it('planned: proposeSpaceFromSearch called with exact selectionHandle assetSource', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({ client, slots: { sourceDescription: 'my newest 50 photos', spaceName: 'Family' } });
    assert.equal(outcome.status, 'planned');
    const proposeCall = client.calls.find((c) => c.name === 'proposeSpaceFromSearch');
    assert.ok(proposeCall, 'proposeSpaceFromSearch should have been called');
    assert.deepEqual(proposeCall.args, {
      summary: 'Create the "Family" space.',
      spaceName: 'Family',
      assetSource: { kind: 'selectionHandle', selectionHandleId: 'handle-1' },
    });
  });

  it('default name: spaceName defaults to "New Space" when not provided', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({ client, slots: { sourceDescription: 'my newest 50 photos', spaceName: 'New Space' } });
    assert.equal(outcome.status, 'planned');
    const proposeCall = client.calls.find((c) => c.name === 'proposeSpaceFromSearch');
    assert.ok(proposeCall);
    assert.equal(proposeCall.args.spaceName, 'New Space');
  });

  it('no raw ids: calls contain selectionHandle assetSource, not raw assetIds', async () => {
    const client = makeContractClient();
    await wf.run({ client, slots: { sourceDescription: 'my newest 50 photos', spaceName: 'Family' } });
    const callsJson = JSON.stringify(client.calls);
    assert.equal(callsJson.includes('assetIds'), false);
    assert.equal(callsJson.includes('"selectionHandleId":"handle-1"'), true);
    assert.equal(callsJson.includes('"kind":"selectionHandle"'), true);
  });

  it('date source: searchAssets filters deepEqual date range, status planned', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({ client, slots: { sourceDescription: 'my photos from 2024', spaceName: 'X' } });
    assert.equal(outcome.status, 'planned');
    const searchCall = client.calls.find((c) => c.name === 'searchAssets');
    assert.ok(searchCall, 'searchAssets should have been called');
    assert.deepEqual(searchCall.args.filters, {
      takenAfter: '2024-01-01T00:00:00.000Z',
      takenBefore: '2024-12-31T23:59:59.999Z',
    });
  });

  it('handoff: subjective source → handoff_open, proposeSpaceFromSearch not called', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({ client, slots: { sourceDescription: 'the good ones', spaceName: 'X' } });
    assert.equal(outcome.status, 'handoff_open');
    assert.equal(client.calls.some((c) => c.name === 'proposeSpaceFromSearch'), false);
  });

  it('empty: zero-count handle → needs_input, proposeSpaceFromSearch not called', async () => {
    const client = makeContractClient({ handleAssetCount: 0 });
    const outcome = await wf.run({ client, slots: { sourceDescription: 'my newest 50 photos', spaceName: 'X' } });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(client.calls.some((c) => c.name === 'proposeSpaceFromSearch'), false);
  });

  it('gate-block: plan without persisted id → failed, no success copy', async () => {
    const client = makeContractClient({ planResult: { status: 'success', plan: {} } });
    const outcome = await wf.run({ client, slots: { sourceDescription: 'my newest 50 photos', spaceName: 'X' } });
    assert.equal(outcome.status, 'failed');
    assert.equal(/prepared|created/i.test(outcome.text), false);
  });

  it('search throws → failed', async () => {
    const client = makeContractClient();
    const throwingClient = {
      calls: client.calls,
      async call(name, args) {
        if (name === 'searchAssets') throw new Error('Search unavailable');
        return client.call(name, args);
      },
    };
    const outcome = await wf.run({ client: throwingClient, slots: { sourceDescription: 'my newest 50 photos', spaceName: 'X' } });
    assert.equal(outcome.status, 'failed');
  });
});

describe('contract-fixtures proposeSpaceFromSearch validation', () => {
  it('rejects missing spaceName', async () => {
    const client = makeContractClient();
    await assert.rejects(
      () => client.call('proposeSpaceFromSearch', { assetSource: { kind: 'selectionHandle', selectionHandleId: 'h' } }),
      /spaceName/i,
    );
  });

  it('rejects missing assetSource', async () => {
    const client = makeContractClient();
    await assert.rejects(
      () => client.call('proposeSpaceFromSearch', { spaceName: 'X' }),
      /assetSource/i,
    );
  });

  it('rejects selectionHandle without selectionHandleId', async () => {
    const client = makeContractClient();
    await assert.rejects(
      () => client.call('proposeSpaceFromSearch', { spaceName: 'X', assetSource: { kind: 'selectionHandle' } }),
      /selectionHandleId/i,
    );
  });

  it('rejects bare top-level selectionHandleId (unknown key)', async () => {
    const client = makeContractClient();
    await assert.rejects(
      () => client.call('proposeSpaceFromSearch', { spaceName: 'X', selectionHandleId: 'h' }),
      /unknown|selectionHandleId/i,
    );
  });

  it('rejects invalid assetSource kind (explicitAssets)', async () => {
    const client = makeContractClient();
    await assert.rejects(
      () => client.call('proposeSpaceFromSearch', { spaceName: 'X', assetSource: { kind: 'explicitAssets', assetIds: ['a'] } }),
      /kind|invalid/i,
    );
  });

  it('accepts valid selectionHandle call and returns plan', async () => {
    const client = makeContractClient();
    const result = await client.call('proposeSpaceFromSearch', {
      spaceName: 'X',
      assetSource: { kind: 'selectionHandle', selectionHandleId: 'h' },
    });
    assert.equal(result.plan.id, 'plan-1');
  });

  it('rejects invalid color value', async () => {
    const client = makeContractClient();
    await assert.rejects(
      () => client.call('proposeSpaceFromSearch', {
        spaceName: 'X',
        assetSource: { kind: 'selectionHandle', selectionHandleId: 'h' },
        color: 'chartreuse',
      }),
      /color/i,
    );
  });
});
