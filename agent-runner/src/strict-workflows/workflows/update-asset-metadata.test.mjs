import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { makeContractClient } from './contract-fixtures.mjs';
import { updateAssetMetadataWorkflow } from './update-asset-metadata.mjs';

const wf = updateAssetMetadataWorkflow();

describe('update_asset_metadata identity', () => {
  it('has correct kind, flow, and run stub', () => {
    assert.equal(wf.kind, 'update_asset_metadata');
    assert.equal(wf.flow, 'hybrid');
    assert.equal(typeof wf.run, 'function');
  });
});

describe('update_asset_metadata match — description', () => {
  it('set description on newest photos', () => {
    assert.deepEqual(wf.match('set the description on my newest 20 photos to Berlin weekend'), {
      slots: { field: 'description', description: 'Berlin weekend', sourceDescription: 'my newest 20 photos' },
    });
  });

  it('strips quotes from description value', () => {
    const result = wf.match('set the description on these photos to "Berlin"');
    assert.equal(result?.slots?.description, 'Berlin');
  });

  it('clear description from newest photos', () => {
    const result = wf.match('clear the description from my newest 20 photos');
    assert.equal(result?.slots?.field, 'description');
    assert.equal(result?.slots?.description, '');
  });

  it('declines album-qualified description', () => {
    assert.equal(wf.match('set the description on the Family album to Summer'), undefined);
  });

  it('declines space-qualified description', () => {
    assert.equal(wf.match('set the description on the Trips space to X'), undefined);
  });

  it('declines unsupported field (title)', () => {
    assert.equal(wf.match('set the title on these photos to Foo'), undefined);
  });

  it('declines subjective source', () => {
    assert.equal(wf.match('set the description on the best photos to X'), undefined);
  });

  it('place-name location prompt now routes to update_asset_metadata (B2)', () => {
    // After B2 this should match with a placeName slot, not be declined.
    const result = wf.match('set the location on these photos to Paris');
    assert.ok(result !== undefined, 'should match place-name location prompt');
    assert.equal(result?.slots?.field, 'location');
    assert.equal(result?.slots?.placeName, 'Paris');
  });

  it('declines rename verb', () => {
    assert.equal(wf.match('rename my newest 20 photos to Foo'), undefined);
  });

  it('returns undefined for empty prompt', () => {
    assert.equal(wf.match(''), undefined);
  });
});

describe('update_asset_metadata match — rating', () => {
  it('rate newest photos five stars (word number)', () => {
    assert.deepEqual(wf.match('rate my newest 12 photos five stars'), {
      slots: { field: 'rating', rating: 5, sourceDescription: 'my newest 12 photos' },
    });
  });

  it('clear rating from newest photos', () => {
    assert.deepEqual(wf.match('clear the rating from my newest 20 photos'), {
      slots: { field: 'rating', rating: null, sourceDescription: 'my newest 20 photos' },
    });
  });

  it('declines zero stars (out of range)', () => {
    assert.equal(wf.match('rate my newest 20 photos zero stars'), undefined);
  });

  it('declines six stars (out of range)', () => {
    assert.equal(wf.match('rate my newest 20 photos six stars'), undefined);
  });
});

describe('update_asset_metadata match — timezone', () => {
  it('set timezone on newest photos', () => {
    assert.deepEqual(wf.match('set the timezone on my newest 20 photos to Europe/Berlin'), {
      slots: { field: 'timeZone', timeZone: 'Europe/Berlin', sourceDescription: 'my newest 20 photos' },
    });
  });
});

describe('update_asset_metadata match — location (numeric coords)', () => {
  it('set lat/lng on newest photos (regression: numeric path unchanged)', () => {
    assert.deepEqual(wf.match('set my newest 20 photos to latitude 48.8566 and longitude 2.3522'), {
      slots: { field: 'location', latitude: 48.8566, longitude: 2.3522, sourceDescription: 'my newest 20 photos' },
    });
  });

  it('set location on newest 20 to lat 48.8 and lon 2.3 (regression: short form)', () => {
    const result = wf.match('set the location on my newest 20 photos to lat 48.8 and lon 2.3');
    assert.equal(result?.slots?.field, 'location');
    assert.equal(result?.slots?.latitude, 48.8);
    assert.equal(result?.slots?.longitude, 2.3);
  });
});

describe('update_asset_metadata match — location (place name, B2)', () => {
  it('set location on newest 20 to Paris', () => {
    const result = wf.match('set the location on my newest 20 to Paris');
    assert.ok(result !== undefined);
    assert.equal(result?.slots?.field, 'location');
    assert.equal(result?.slots?.placeName, 'Paris');
    assert.match(result?.slots?.sourceDescription, /newest 20/i);
  });

  it('set place on these to Tokyo', () => {
    const result = wf.match('set place on these photos to Tokyo');
    assert.ok(result !== undefined);
    assert.equal(result?.slots?.field, 'location');
    assert.equal(result?.slots?.placeName, 'Tokyo');
  });

  it('does NOT match "set Paris as the album cover" (negative: album cover routing)', () => {
    const result = wf.match('set Paris as the album cover');
    assert.equal(result, undefined);
  });

  it('place + explicit coords: prefer explicit coords, no placeName', () => {
    // When both place name and numeric coords appear, numeric LOCATION_RE should match first.
    // (Numeric LOCATION_RE is in EXTRACTORS before PLACE_RE so it wins.)
    // Just check that if a numeric-lat/lon form is given, the numeric path is used.
    const result = wf.match('set the location on my newest 20 to lat 48.8566 and lon 2.3522');
    assert.equal(result?.slots?.field, 'location');
    assert.equal(result?.slots?.latitude, 48.8566);
    assert.ok(result?.slots?.placeName === undefined, 'should not have placeName when coords supplied');
  });
});

describe('update_asset_metadata match — date shift', () => {
  it('shift forward by hours converts to positive minutes', () => {
    assert.deepEqual(wf.match('shift my newest 20 photos forward by 2 hours'), {
      slots: { field: 'date', dateTimeRelative: 120, sourceDescription: 'my newest 20 photos' },
    });
  });

  it('shift back by minutes gives negative minutes', () => {
    const result = wf.match('shift my newest 20 photos back by 90 minutes');
    assert.equal(result?.slots?.dateTimeRelative, -90);
  });
});

describe('update_asset_metadata parseSlots', () => {
  it('normalizes LLM field+value form for description', () => {
    assert.deepEqual(
      wf.parseSlots({ field: 'description', value: 'Berlin', sourceDescription: 'my newest 20 photos' }),
      { sourceDescription: 'my newest 20 photos', payload: { description: 'Berlin' } },
    );
  });

  it('normalizes LLM field+value for rating 5', () => {
    assert.deepEqual(
      wf.parseSlots({ field: 'rating', value: '5', sourceDescription: 'x' }).payload,
      { rating: 5 },
    );
  });

  it('normalizes LLM field+value for clear rating', () => {
    assert.deepEqual(
      wf.parseSlots({ field: 'rating', value: 'clear', sourceDescription: 'x' }).payload,
      { rating: null },
    );
  });

  it('returns null when longitude is missing', () => {
    assert.equal(wf.parseSlots({ latitude: 48.8566, sourceDescription: 'x' }), null);
  });

  it('returns null when no field or typed slot is present', () => {
    assert.equal(wf.parseSlots({ sourceDescription: 'x' }), null);
  });

  it('returns null when sourceDescription is missing', () => {
    assert.equal(wf.parseSlots({ field: 'description', value: 'Berlin' }), null);
  });

  it('normalizes match-output form (description field with typed description slot)', () => {
    assert.deepEqual(
      wf.parseSlots({ field: 'description', description: 'Berlin weekend', sourceDescription: 'my newest 20 photos' }),
      { sourceDescription: 'my newest 20 photos', payload: { description: 'Berlin weekend' } },
    );
  });

  it('normalizes match-output form with a NUMERIC rating slot (regex-path integration)', () => {
    assert.deepEqual(
      wf.parseSlots({ field: 'rating', rating: 5, sourceDescription: 'my newest 12 photos' }),
      { sourceDescription: 'my newest 12 photos', payload: { rating: 5 } },
    );
    assert.deepEqual(wf.parseSlots({ field: 'rating', rating: null, sourceDescription: 'x' }).payload, { rating: null });
  });
});

describe('update_asset_metadata execution', () => {
  it('description run: plans batch with flat asset.updateMetadata action', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 20 photos', payload: { description: 'Berlin weekend' } },
    });
    assert.equal(outcome.status, 'planned');
    const propose = client.calls.find((c) => c.name === 'proposeAssetBatchFromSelection');
    assert.deepEqual(propose.args.action, { type: 'asset.updateMetadata', description: 'Berlin weekend' });
    assert.equal(propose.args.selectionHandleId, 'handle-1');
    assert.equal(JSON.stringify(client.calls).includes('assetIds'), false);
  });

  it('rating run: plans with flat rating action', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 20 photos', payload: { rating: 5 } },
    });
    assert.equal(outcome.status, 'planned');
    const propose = client.calls.find((c) => c.name === 'proposeAssetBatchFromSelection');
    assert.deepEqual(propose.args.action, { type: 'asset.updateMetadata', rating: 5 });
  });

  it('clear-rating: action includes rating:null', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 20 photos', payload: { rating: null } },
    });
    assert.equal(outcome.status, 'planned');
    const propose = client.calls.find((c) => c.name === 'proposeAssetBatchFromSelection');
    assert.deepEqual(propose.args.action, { type: 'asset.updateMetadata', rating: null });
  });

  it('clear-description: action includes description:empty string, does not throw', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 20 photos', payload: { description: '' } },
    });
    assert.equal(outcome.status, 'planned');
    const propose = client.calls.find((c) => c.name === 'proposeAssetBatchFromSelection');
    assert.deepEqual(propose.args.action, { type: 'asset.updateMetadata', description: '' });
  });

  it('timezone: action includes timeZone field', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 20 photos', payload: { timeZone: 'Europe/Berlin' } },
    });
    assert.equal(outcome.status, 'planned');
    const propose = client.calls.find((c) => c.name === 'proposeAssetBatchFromSelection');
    assert.deepEqual(propose.args.action, { type: 'asset.updateMetadata', timeZone: 'Europe/Berlin' });
  });

  it('location: action includes latitude and longitude', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 20 photos', payload: { latitude: 48.8566, longitude: 2.3522 } },
    });
    assert.equal(outcome.status, 'planned');
    const propose = client.calls.find((c) => c.name === 'proposeAssetBatchFromSelection');
    assert.deepEqual(propose.args.action, { type: 'asset.updateMetadata', latitude: 48.8566, longitude: 2.3522 });
  });

  it('date-absolute: action has dateTimeOriginal matching 1998-06, status planned', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 20 photos', payload: { dateTimeOriginal: '1998-06-15T00:00:00.000Z' } },
    });
    assert.equal(outcome.status, 'planned');
    const propose = client.calls.find((c) => c.name === 'proposeAssetBatchFromSelection');
    assert.match(propose.args.action.dateTimeOriginal, /^1998-06/);
  });

  it('relative-shift: action has dateTimeRelative===120', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 20 photos', payload: { dateTimeRelative: 120 } },
    });
    assert.equal(outcome.status, 'planned');
    const propose = client.calls.find((c) => c.name === 'proposeAssetBatchFromSelection');
    assert.equal(propose.args.action.dateTimeRelative, 120);
  });

  it('date SOURCE + field: search uses date filters, action carries rating', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my photos from 2024', payload: { rating: 5 } },
    });
    assert.equal(outcome.status, 'planned');
    const search = client.calls.find((c) => c.name === 'searchAssets');
    assert.deepEqual(search.args.filters, {
      takenAfter: '2024-01-01T00:00:00.000Z',
      takenBefore: '2024-12-31T23:59:59.999Z',
    });
    const propose = client.calls.find((c) => c.name === 'proposeAssetBatchFromSelection');
    assert.deepEqual(propose.args.action, { type: 'asset.updateMetadata', rating: 5 });
  });

  it('success copy: description run text mentions "set the description" and "Berlin weekend"', async () => {
    const client = makeContractClient();
    const descOutcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 20 photos', payload: { description: 'Berlin weekend' } },
    });
    assert.match(descOutcome.text, /set the description/);
    assert.ok(descOutcome.text.includes('Berlin weekend'));

    const ratingClient = makeContractClient();
    const ratingOutcome = await wf.run({
      client: ratingClient,
      slots: { sourceDescription: 'my newest 20 photos', payload: { rating: 5 } },
    });
    assert.match(ratingOutcome.text, /rating/);
    assert.ok(ratingOutcome.text.includes('5'));

    const tzClient = makeContractClient();
    const tzOutcome = await wf.run({
      client: tzClient,
      slots: { sourceDescription: 'my newest 20 photos', payload: { timeZone: 'Europe/Berlin' } },
    });
    assert.match(tzOutcome.text, /timezone/i);
    assert.ok(tzOutcome.text.includes('Europe/Berlin'));
  });

  it('handoff: subjective source → handoff_open, propose NOT called', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'the best ones', payload: { description: 'X' } },
    });
    assert.equal(outcome.status, 'handoff_open');
    assert.equal(
      client.calls.some((c) => c.name === 'proposeAssetBatchFromSelection'),
      false,
    );
  });

  it('empty: zero-count handle → needs_input, propose NOT called', async () => {
    const client = makeContractClient({ handleAssetCount: 0 });
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 20 photos', payload: { rating: 5 } },
    });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(
      client.calls.some((c) => c.name === 'proposeAssetBatchFromSelection'),
      false,
    );
  });

  it('half-coordinate defensive: only latitude provided → needs_input, no tool calls', async () => {
    const client = makeContractClient();
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 20 photos', payload: { latitude: 48.8 } },
    });
    assert.equal(outcome.status, 'needs_input');
    assert.match(outcome.text, /latitude.*longitude|longitude.*latitude/i);
    assert.equal(client.calls.length, 0);
  });

  it('gate: plan without persisted id → failed, no success copy', async () => {
    const client = makeContractClient({ planResult: { status: 'success', plan: {} } });
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 20 photos', payload: { rating: 5 } },
    });
    assert.equal(outcome.status, 'failed');
    assert.equal(/prepared|set the/i.test(outcome.text), false);
  });

  it('search throws → failed', async () => {
    const client = {
      calls: [],
      async call(name) {
        this.calls.push({ name });
        if (name === 'searchAssets') throw new Error('network error');
        throw new Error(`unexpected ${name}`);
      },
    };
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 20 photos', payload: { rating: 5 } },
    });
    assert.equal(outcome.status, 'failed');
  });

  it('propose throws → failed', async () => {
    const base = makeContractClient();
    const client = {
      calls: base.calls,
      async call(name, args) {
        if (name === 'proposeAssetBatchFromSelection') {
          base.calls.push({ name, args });
          throw new Error('propose exploded');
        }
        return base.call(name, args);
      },
    };
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 20 photos', payload: { rating: 5 } },
    });
    assert.equal(outcome.status, 'failed');
  });

  it('singular/plural: 1 photo → text contains "1 photo" not "1 photos"', async () => {
    const client = makeContractClient({ handleAssetCount: 1 });
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 1 photo', payload: { rating: 5 } },
    });
    assert.ok(outcome.text.includes('1 photo'));
    assert.equal(outcome.text.includes('1 photos'), false);
  });
});

// --- B2: place-name location resolution via resolveLocation -------------------

/**
 * Build a contract client that also handles resolveLocation with a canned response.
 * @param resolveLocationResult  What client.call('resolveLocation') should return
 * @param config                 Passed to makeContractClient
 */
const makeLocationClient = (resolveLocationResult, config = {}) => {
  const base = makeContractClient(config);
  const resolveLocationCalls = [];
  return {
    calls: base.calls,
    resolveLocationCalls,
    async call(name, args) {
      base.calls.push({ name, args });
      if (name === 'resolveLocation') {
        resolveLocationCalls.push({ name, args });
        return resolveLocationResult;
      }
      return base.call(name, args);
    },
  };
};

describe('update_asset_metadata — place-name location (B2)', () => {
  it('run: matched place → proposes asset.updateMetadata with resolved lat/lng', async () => {
    const client = makeLocationClient({
      location: { status: 'matched', latitude: 48.8566, longitude: 2.3522, label: 'Paris, Île-de-France, FR' },
    });
    // Slots come from parseSlots on a place-name parse result.
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 20 photos', placeName: 'Paris', payload: {} },
    });
    assert.equal(outcome.status, 'planned');
    // resolveLocation should have been called with query:'Paris'
    assert.equal(client.resolveLocationCalls.length, 1);
    assert.deepEqual(client.resolveLocationCalls[0].args, { query: 'Paris' });
    // The proposed action must include the resolved lat/lng
    const propose = client.calls.find((c) => c.name === 'proposeAssetBatchFromSelection');
    assert.ok(propose, 'proposeAssetBatchFromSelection should have been called');
    assert.deepEqual(propose.args.action, { type: 'asset.updateMetadata', latitude: 48.8566, longitude: 2.3522 });
  });

  it('run: not_found → needs_input mentioning place not found', async () => {
    const client = makeLocationClient({ location: { status: 'not_found' } });
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 20 photos', placeName: 'Parisxyz', payload: {} },
    });
    assert.equal(outcome.status, 'needs_input');
    assert.match(outcome.text, /Parisxyz|not found|could not find/i);
    assert.equal(client.calls.some((c) => c.name === 'proposeAssetBatchFromSelection'), false);
  });

  it('run: ambiguous → needs_input listing choices', async () => {
    const client = makeLocationClient({
      location: {
        status: 'ambiguous',
        choices: [
          { latitude: 48.8566, longitude: 2.3522, label: 'Paris, Île-de-France, FR', countryCode: 'FR' },
          { latitude: 33.6609, longitude: -95.5555, label: 'Paris, Texas, US', countryCode: 'US' },
        ],
      },
    });
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 20 photos', placeName: 'Paris', payload: {} },
    });
    assert.equal(outcome.status, 'needs_input');
    // Should mention the ambiguous choices
    assert.ok(outcome.text.includes('Paris'), 'text should mention Paris');
    assert.equal(client.calls.some((c) => c.name === 'proposeAssetBatchFromSelection'), false);
  });

  it('run: place + explicit coords → prefer coords, do NOT call resolveLocation', async () => {
    const client = makeLocationClient({ location: { status: 'matched', latitude: 0, longitude: 0, label: 'Null Island' } });
    // When payload already has lat/lng, resolveLocation should NOT be called.
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 20 photos', placeName: 'Paris', payload: { latitude: 48.8566, longitude: 2.3522 } },
    });
    assert.equal(outcome.status, 'planned');
    assert.equal(client.resolveLocationCalls.length, 0, 'resolveLocation must NOT be called when explicit coords present');
    const propose = client.calls.find((c) => c.name === 'proposeAssetBatchFromSelection');
    assert.deepEqual(propose.args.action, { type: 'asset.updateMetadata', latitude: 48.8566, longitude: 2.3522 });
  });

  it('run: empty selection with placeName → needs_input', async () => {
    const client = makeLocationClient(
      { location: { status: 'matched', latitude: 48.8566, longitude: 2.3522, label: 'Paris, FR' } },
      { handleAssetCount: 0 },
    );
    const outcome = await wf.run({
      client,
      slots: { sourceDescription: 'my newest 20 photos', placeName: 'Paris', payload: {} },
    });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(client.calls.some((c) => c.name === 'proposeAssetBatchFromSelection'), false);
  });

  it('parseSlots: place-name match output → preserves placeName alongside empty payload', () => {
    // match() for place-name returns { field:'location', placeName:'Paris', sourceDescription:'...' }
    // parseSlots should pass through placeName and produce a payload that signals location edit
    const result = wf.parseSlots({
      field: 'location',
      placeName: 'Paris',
      sourceDescription: 'my newest 20 photos',
    });
    assert.ok(result !== null, 'parseSlots should not return null for place-name location');
    assert.equal(result?.sourceDescription, 'my newest 20 photos');
    assert.equal(result?.placeName, 'Paris');
  });
});
