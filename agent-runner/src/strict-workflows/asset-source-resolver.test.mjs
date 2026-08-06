import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isCleanSource, parseDateRange, parseEntitySource, parseMediaType, parseUploadRange, resolveAssetSource } from './asset-source-resolver.mjs';
import { makeContractClient } from './workflows/contract-fixtures.mjs';

// A Friday, for deterministic relative-date math.
const NOW = new Date('2026-05-15T12:00:00.000Z');
const iso = (range) => (range ? { after: range.takenAfter.toISOString(), before: range.takenBefore.toISOString() } : range);

describe('parseDateRange', () => {
  for (const [phrase, after, before] of [
    ['photos from 2024', '2024-01-01T00:00:00.000Z', '2024-12-31T23:59:59.999Z'],
    ['in May 2024', '2024-05-01T00:00:00.000Z', '2024-05-31T23:59:59.999Z'],
    ['today', '2026-05-15T00:00:00.000Z', '2026-05-15T23:59:59.999Z'],
    ['yesterday', '2026-05-14T00:00:00.000Z', '2026-05-14T23:59:59.999Z'],
    ['this week', '2026-05-11T00:00:00.000Z', '2026-05-15T23:59:59.999Z'],
    ['this month', '2026-05-01T00:00:00.000Z', '2026-05-31T23:59:59.999Z'],
    ['last month', '2026-04-01T00:00:00.000Z', '2026-04-30T23:59:59.999Z'],
    ['last week', '2026-05-04T00:00:00.000Z', '2026-05-10T23:59:59.999Z'],
    ['last weekend', '2026-05-09T00:00:00.000Z', '2026-05-10T23:59:59.999Z'],
  ]) {
    it(`parses "${phrase}"`, () => {
      assert.deepEqual(iso(parseDateRange(phrase, NOW)), { after, before });
    });
  }

  it('returns undefined for unparseable or date-less phrases', () => {
    assert.equal(parseDateRange('sometime recently', NOW), undefined);
    assert.equal(parseDateRange('my newest 20 photos', NOW), undefined);
    assert.equal(parseDateRange('newest 20', NOW), undefined); // "20" is not a year
  });
});

describe('parseMediaType', () => {
  for (const [phrase, type] of [
    ['my videos from 2024', 'VIDEO'],
    ['newest 10 clips', 'VIDEO'],
    ['my movies', 'VIDEO'],
    ['newest 20 images', 'IMAGE'],
    ['my newest 20 photos', undefined], // generic colloquial word — NOT a type
    ['my pics from 2024', undefined], // generic
    ['screenshots', undefined], // not a metadata type
  ]) {
    it(`maps "${phrase}" → ${type}`, () => {
      assert.equal(parseMediaType(phrase), type);
    });
  }
});

describe('resolveAssetSource', () => {
  it('resolves a recency source via a bounded metadata search (no query)', async () => {
    const client = makeContractClient({ handleAssetCount: 13 });
    const result = await resolveAssetSource({ client, sourceDescription: 'my newest 20 photos' });
    assert.equal(result.status, 'resolved');
    assert.equal(result.selectionHandleId, 'handle-1');
    assert.equal(result.assetCount, 13);
    const search = client.calls.find((c) => c.name === 'searchAssets');
    assert.deepEqual(search.args, { mode: 'metadata', order: 'desc', limit: 20, detail: 'handle' });
    assert.equal(search.args.query, undefined);
  });

  it('hands off a subjective source without searching', async () => {
    const client = makeContractClient();
    const result = await resolveAssetSource({ client, sourceDescription: 'the good ones' });
    assert.equal(result.status, 'handoff');
    assert.equal(
      client.calls.some((c) => c.name === 'searchAssets'),
      false,
    );
  });

  it('hands off an unbounded or qualified source (clean-source gate)', async () => {
    // Entity cases ('Berlin photos from last weekend', 'newest 20 Berlin photos',
    // 'photos of Alex from last week') intentionally moved to the entity-resolution
    // describe block below — they now RESOLVE (Phase-0 behavior change).
    for (const source of [
      'newest photos', // recency keyword but no count → clean yet unbounded
      'my photos', // all filler, no recency/date bound
    ]) {
      const result = await resolveAssetSource({ client: makeContractClient(), sourceDescription: source, now: NOW });
      assert.equal(result.status, 'handoff', source);
    }
  });

  it('resolves a clean date source into a metadata search with ISO date filters', async () => {
    const client = makeContractClient({ handleAssetCount: 5 });
    const result = await resolveAssetSource({ client, sourceDescription: 'my photos from 2024', now: NOW });
    assert.equal(result.status, 'resolved');
    const search = client.calls.find((c) => c.name === 'searchAssets');
    assert.deepEqual(search.args, {
      mode: 'metadata',
      order: 'desc',
      limit: 1000,
      filters: { takenAfter: '2024-01-01T00:00:00.000Z', takenBefore: '2024-12-31T23:59:59.999Z' },
      detail: 'handle',
    });
  });

  it('combines recency and date (limit + filters)', async () => {
    const client = makeContractClient();
    await resolveAssetSource({ client, sourceDescription: 'newest 20 photos from 2024', now: NOW });
    const search = client.calls.find((c) => c.name === 'searchAssets');
    assert.equal(search.args.limit, 20);
    assert.deepEqual(search.args.filters, {
      takenAfter: '2024-01-01T00:00:00.000Z',
      takenBefore: '2024-12-31T23:59:59.999Z',
    });
  });

  it('resolves a media-type source combined with a date (type + date filters)', async () => {
    const client = makeContractClient();
    const result = await resolveAssetSource({ client, sourceDescription: 'my videos from last weekend', now: NOW });
    assert.equal(result.status, 'resolved');
    const search = client.calls.find((c) => c.name === 'searchAssets');
    assert.equal(search.args.limit, 1000); // no recency count → high cap
    assert.deepEqual(search.args.filters, {
      takenAfter: '2026-05-09T00:00:00.000Z',
      takenBefore: '2026-05-10T23:59:59.999Z',
      type: 'VIDEO',
    });
  });

  it('resolves an image-type source combined with recency (type filter only)', async () => {
    const client = makeContractClient();
    await resolveAssetSource({ client, sourceDescription: 'newest 20 images', now: NOW });
    const search = client.calls.find((c) => c.name === 'searchAssets');
    assert.deepEqual(search.args, {
      mode: 'metadata',
      order: 'desc',
      limit: 20,
      filters: { type: 'IMAGE' },
      detail: 'handle',
    });
  });

  it('combines recency + date + type', async () => {
    const client = makeContractClient();
    await resolveAssetSource({ client, sourceDescription: 'newest 20 videos from 2024', now: NOW });
    const search = client.calls.find((c) => c.name === 'searchAssets');
    assert.equal(search.args.limit, 20);
    assert.deepEqual(search.args.filters, {
      takenAfter: '2024-01-01T00:00:00.000Z',
      takenBefore: '2024-12-31T23:59:59.999Z',
      type: 'VIDEO',
    });
  });

  it('keeps generic "photos" recency-only sources type-free (no filters key — regression guard)', async () => {
    const client = makeContractClient();
    await resolveAssetSource({ client, sourceDescription: 'my newest 20 photos', now: NOW });
    const search = client.calls.find((c) => c.name === 'searchAssets');
    assert.deepEqual(search.args, { mode: 'metadata', order: 'desc', limit: 20, detail: 'handle' });
  });

  it('hands off a type-only source (unbounded — type is not a bound)', async () => {
    const client = makeContractClient();
    const result = await resolveAssetSource({ client, sourceDescription: 'my videos', now: NOW });
    assert.equal(result.status, 'handoff');
    assert.equal(
      client.calls.some((c) => c.name === 'searchAssets'),
      false,
    );
  });

  it('"my screenshots" no longer hands off — resolves via Screenshots tag (E1)', async () => {
    // Screenshots is now a tag-first entity: resolveAssetSearchFilters is called.
    // When the instance has no Screenshots tag the resolver discloses; when it does,
    // it resolves. Use default client (empty resolvedFilters) to confirm it tries
    // resolveAssetSearchFilters and does NOT produce a silent searchAssets call.
    const client = makeContractClient(); // resolvedFilters={} → handoff (no bound after tag lookup)
    const result = await resolveAssetSource({ client, sourceDescription: 'my screenshots', now: NOW });
    // With default client (no resolveResults, resolvedFilters={}), the entity path
    // resolves empty filters → handoff (no usable filter + no recency bound).
    // The key assertion: resolveAssetSearchFilters IS called (not skipped).
    assert.ok(
      client.calls.some((c) => c.name === 'resolveAssetSearchFilters'),
      'resolveAssetSearchFilters must be called for screenshots',
    );
    assert.equal(
      client.calls.some((c) => c.name === 'searchAssets'),
      false,
    );
  });

  it('resolves a relative-date source ("photos I took yesterday")', async () => {
    const client = makeContractClient();
    const result = await resolveAssetSource({ client, sourceDescription: 'the photos I took yesterday', now: NOW });
    assert.equal(result.status, 'resolved');
    const search = client.calls.find((c) => c.name === 'searchAssets');
    assert.deepEqual(search.args.filters, {
      takenAfter: '2026-05-14T00:00:00.000Z',
      takenBefore: '2026-05-14T23:59:59.999Z',
    });
  });

  it('keeps recency-only calls unchanged (no filters key)', async () => {
    const client = makeContractClient();
    await resolveAssetSource({ client, sourceDescription: 'my newest 20 photos', now: NOW });
    const search = client.calls.find((c) => c.name === 'searchAssets');
    assert.deepEqual(search.args, { mode: 'metadata', order: 'desc', limit: 20, detail: 'handle' });
  });

  it('merges extraFilters into the bounded search filters', async () => {
    const client = makeContractClient();
    const result = await resolveAssetSource({
      client,
      sourceDescription: 'my newest 20 photos',
      now: NOW,
      extraFilters: { maxSharpness: 30 },
    });

    assert.equal(result.status, 'resolved');
    const search = client.calls.find((c) => c.name === 'searchAssets');
    assert.deepEqual(search.args, {
      mode: 'metadata',
      order: 'desc',
      limit: 20,
      filters: { maxSharpness: 30 },
      detail: 'handle',
    });
  });

  it('rejects extraFilters that would overwrite parsed source filters', async () => {
    const client = makeContractClient();

    await assert.rejects(
      () =>
        resolveAssetSource({
          client,
          sourceDescription: 'my videos from 2024',
          now: NOW,
          extraFilters: { type: 'IMAGE' },
        }),
      /extraFilters.*type/i,
    );
    assert.equal(
      client.calls.some((c) => c.name === 'searchAssets'),
      false,
    );
  });

  it('hands off an absurd recency count (> 4 digits is not a count → unbounded)', async () => {
    const client = makeContractClient();
    const result = await resolveAssetSource({ client, sourceDescription: 'newest 99999 photos', now: NOW });
    assert.equal(result.status, 'handoff');
    assert.equal(
      client.calls.some((c) => c.name === 'searchAssets'),
      false,
    );
  });

  it('reports empty when the recency source resolves to zero assets', async () => {
    const client = makeContractClient({ handleAssetCount: 0 });
    const result = await resolveAssetSource({ client, sourceDescription: 'newest 10 photos' });
    assert.equal(result.status, 'empty');
  });

  it('propagates a search tool error (caller maps it to failed)', async () => {
    const throwingClient = {
      calls: [],
      async call(name) {
        if (name === 'searchAssets') throw new Error('boom');
        throw new Error(`unexpected ${name}`);
      },
    };
    await assert.rejects(
      () => resolveAssetSource({ client: throwingClient, sourceDescription: 'newest 5 photos' }),
      /boom/,
    );
  });

  it('hands off "the best Berlin photos" (subjective beats entity, no search)', async () => {
    const client = makeContractClient();
    const result = await resolveAssetSource({ client, sourceDescription: 'the best Berlin photos', now: NOW });
    assert.equal(result.status, 'handoff');
    assert.equal(
      client.calls.some((c) => c.name === 'searchAssets'),
      false,
    );
  });
});

describe('resolveAssetSource — named-entity sources', () => {
  it('resolves "photos of Alex" via resolveAssetSearchFilters with people arg (no query)', async () => {
    const client = makeContractClient({ resolvedFilters: { personIds: ['per-1'] } });
    const result = await resolveAssetSource({ client, sourceDescription: 'photos of Alex', now: NOW });
    assert.equal(result.status, 'resolved');
    const resolveCall = client.calls.find((c) => c.name === 'resolveAssetSearchFilters');
    assert.ok(resolveCall, 'resolveAssetSearchFilters must be called');
    assert.deepEqual(resolveCall.args, { people: ['Alex'] });
    assert.equal(resolveCall.args.query, undefined);
    const searchCall = client.calls.find((c) => c.name === 'searchAssets');
    assert.deepEqual(searchCall.args, { mode: 'metadata', order: 'desc', limit: 1000, filters: { personIds: ['per-1'] }, detail: 'handle' });
  });

  it('resolves "photos tagged Travel" via resolveAssetSearchFilters with tags arg', async () => {
    const client = makeContractClient({ resolvedFilters: { tagIds: ['tag-1'] } });
    const result = await resolveAssetSource({ client, sourceDescription: 'photos tagged Travel', now: NOW });
    assert.equal(result.status, 'resolved');
    const resolveCall = client.calls.find((c) => c.name === 'resolveAssetSearchFilters');
    assert.deepEqual(resolveCall.args, { tags: ['Travel'] });
    const searchCall = client.calls.find((c) => c.name === 'searchAssets');
    assert.deepEqual(searchCall.args.filters, { tagIds: ['tag-1'] });
  });

  it('resolves "photos in the Italy album" via resolveAssetSearchFilters with albums arg', async () => {
    const client = makeContractClient({ resolvedFilters: { albumIds: ['alb-1'] } });
    const result = await resolveAssetSource({ client, sourceDescription: 'photos in the Italy album', now: NOW });
    assert.equal(result.status, 'resolved');
    const resolveCall = client.calls.find((c) => c.name === 'resolveAssetSearchFilters');
    assert.deepEqual(resolveCall.args, { albums: ['Italy'] });
    const searchCall = client.calls.find((c) => c.name === 'searchAssets');
    assert.deepEqual(searchCall.args.filters, { albumIds: ['alb-1'] });
  });

  it('resolves "my Sony photos" via resolveAssetSearchFilters with cameraMakes arg', async () => {
    const client = makeContractClient({ resolvedFilters: { make: 'Sony' } });
    const result = await resolveAssetSource({ client, sourceDescription: 'my Sony photos', now: NOW });
    assert.equal(result.status, 'resolved');
    const resolveCall = client.calls.find((c) => c.name === 'resolveAssetSearchFilters');
    assert.deepEqual(resolveCall.args, { cameraMakes: ['Sony'] });
    const searchCall = client.calls.find((c) => c.name === 'searchAssets');
    assert.deepEqual(searchCall.args.filters, { make: 'Sony' });
  });

  it('merges date range into entity filters ("photos of Alex from 2024")', async () => {
    const client = makeContractClient({ resolvedFilters: { personIds: ['per-1'] } });
    const result = await resolveAssetSource({ client, sourceDescription: 'photos of Alex from 2024', now: NOW });
    assert.equal(result.status, 'resolved');
    const resolveCall = client.calls.find((c) => c.name === 'resolveAssetSearchFilters');
    assert.deepEqual(resolveCall.args, { people: ['Alex'] });
    const searchCall = client.calls.find((c) => c.name === 'searchAssets');
    assert.deepEqual(searchCall.args.filters, {
      takenAfter: '2024-01-01T00:00:00.000Z',
      takenBefore: '2024-12-31T23:59:59.999Z',
      personIds: ['per-1'],
    });
  });

  it('hands off "photos of Alex" with default client (empty resolvedFilters + no bound)', async () => {
    const client = makeContractClient(); // no resolvedFilters config
    const result = await resolveAssetSource({ client, sourceDescription: 'photos of Alex', now: NOW });
    assert.equal(result.status, 'handoff');
    assert.equal(client.calls.some((c) => c.name === 'searchAssets'), false);
  });
});

describe('resolveAssetSource — direct-metadata sources', () => {
  it('resolves "my 5-star photos" via direct rating filter (no resolveAssetSearchFilters call)', async () => {
    const client = makeContractClient();
    const result = await resolveAssetSource({ client, sourceDescription: 'my 5-star photos', now: NOW });
    assert.equal(result.status, 'resolved');
    assert.equal(client.calls.some((c) => c.name === 'resolveAssetSearchFilters'), false);
    const searchCall = client.calls.find((c) => c.name === 'searchAssets');
    assert.deepEqual(searchCall.args.filters, { rating: 5 });
  });

  it('resolves "my Berlin photos from last weekend" via direct city + date filters (no resolver call)', async () => {
    const client = makeContractClient();
    const result = await resolveAssetSource({ client, sourceDescription: 'my Berlin photos from last weekend', now: NOW });
    assert.equal(result.status, 'resolved');
    assert.equal(client.calls.some((c) => c.name === 'resolveAssetSearchFilters'), false);
    const searchCall = client.calls.find((c) => c.name === 'searchAssets');
    assert.deepEqual(searchCall.args.filters, {
      city: 'Berlin',
      takenAfter: '2026-05-09T00:00:00.000Z',
      takenBefore: '2026-05-10T23:59:59.999Z',
    });
  });

  it('resolves "my favorites from last weekend" via isFavorite + date (no resolver call)', async () => {
    const client = makeContractClient();
    const result = await resolveAssetSource({ client, sourceDescription: 'my favorites from last weekend', now: NOW });
    assert.equal(result.status, 'resolved');
    assert.equal(client.calls.some((c) => c.name === 'resolveAssetSearchFilters'), false);
    const searchCall = client.calls.find((c) => c.name === 'searchAssets');
    assert.deepEqual(searchCall.args.filters, {
      isFavorite: true,
      takenAfter: '2026-05-09T00:00:00.000Z',
      takenBefore: '2026-05-10T23:59:59.999Z',
    });
  });

  it('resolves "newest 20 Berlin photos" with limit=20 and city filter (no resolver call)', async () => {
    const client = makeContractClient();
    const result = await resolveAssetSource({ client, sourceDescription: 'newest 20 Berlin photos', now: NOW });
    assert.equal(result.status, 'resolved');
    assert.equal(client.calls.some((c) => c.name === 'resolveAssetSearchFilters'), false);
    const searchCall = client.calls.find((c) => c.name === 'searchAssets');
    assert.equal(searchCall.args.limit, 20);
    assert.deepEqual(searchCall.args.filters, { city: 'Berlin' });
  });
});

describe('parseEntitySource', () => {
  for (const [input, expected] of [
    ['photos of Alex', { people: ['Alex'] }],
    ['my Berlin photos', { directFilters: { city: 'Berlin' } }],
    ['photos from Paris', { directFilters: { city: 'Paris' } }],
    ['photos tagged Travel', { tags: ['Travel'] }],
    ['my Travel-tagged photos', { tags: ['Travel'] }],
    ['photos in the Italy album', { albums: ['Italy'] }],
    ['my Sony photos', { cameras: ['Sony'] }],
    ['shot on Canon', { cameras: ['Canon'] }],
    ['my 5-star photos', { directFilters: { rating: 5 } }],
    ['rated 5', { directFilters: { rating: 5 } }],
    ['my favorites', { directFilters: { isFavorite: true } }],
    ['my favorite photos', { directFilters: { isFavorite: true } }],
    ['my archived photos', { directFilters: { visibility: 'archive' } }],
    ['my newest 20 photos', undefined],
    ['the best ones', undefined],
    ['photos from 2024', undefined],
    ['my videos', undefined],
    ['my photos', undefined],
    ['rated 7', undefined],
    ['my 7-star photos', undefined],
    ['photos of ' + 'A'.repeat(121), undefined],
  ]) {
    it(`parseEntitySource(${JSON.stringify(input)}) → ${JSON.stringify(expected)}`, () => {
      assert.deepEqual(parseEntitySource(input), expected);
    });
  }
});

describe('isCleanSource', () => {
  for (const [input, expected] of [
    ['my Berlin photos', true],
    ['my Sony photos', true],
    ['photos tagged Travel', true],
    ['photos in the Italy album', true],
    ['my 5-star photos', true],
    ['my archived photos', true],
    ['my newest 20 photos', true],
    ['the best ones', false],
    ['the best Berlin photos', false],
    ['my screenshots', true], // screenshots noun is now consumed (E1 tag entity)
  ]) {
    it(`isCleanSource(${JSON.stringify(input)}) → ${expected}`, () => {
      assert.equal(isCleanSource(input), expected);
    });
  }
});

describe('resolveAssetSource — entity ambiguity / not-found', () => {
  it('returns needs_input for an ambiguous person (no searchAssets call)', async () => {
    const client = makeContractClient({
      resolveResults: [
        { kind: 'person', query: 'Alex', status: 'ambiguous', choices: [{ value: 'p1', label: 'Alex Smith' }, { value: 'p2', label: 'Alex Jones' }], message: '' },
      ],
    });
    const result = await resolveAssetSource({ client, sourceDescription: 'photos of Alex', now: NOW });
    assert.equal(result.status, 'needs_input');
    assert.ok(/which.*Alex/i.test(result.text), `text should match /which.*Alex/i but got: ${result.text}`);
    assert.equal(client.calls.some((c) => c.name === 'searchAssets'), false);
  });

  it('returns needs_input for a not-found tag (no searchAssets call)', async () => {
    const client = makeContractClient({
      resolveResults: [
        { kind: 'tag', query: 'Trvel', status: 'not_found', choices: [], message: '' },
      ],
    });
    const result = await resolveAssetSource({ client, sourceDescription: 'photos tagged Trvel', now: NOW });
    assert.equal(result.status, 'needs_input');
    assert.ok(/could not find.*tag.*Trvel/i.test(result.text), `text should match /could not find.*tag.*Trvel/i but got: ${result.text}`);
    assert.equal(client.calls.some((c) => c.name === 'searchAssets'), false);
  });

  it('returns needs_input for mixed matched + not-found (text mentions not-found, no searchAssets)', async () => {
    const client = makeContractClient({
      resolveResults: [
        { kind: 'person', query: 'Alex', status: 'matched', choices: [], message: '' },
        { kind: 'tag', query: 'Trvel', status: 'not_found', choices: [], message: '' },
      ],
    });
    const result = await resolveAssetSource({ client, sourceDescription: 'photos of Alex tagged Trvel', now: NOW });
    assert.equal(result.status, 'needs_input');
    assert.ok(result.text.includes('Trvel'), `text should mention "Trvel" but got: ${result.text}`);
    assert.equal(client.calls.some((c) => c.name === 'searchAssets'), false);
  });

  it('returns a single needs_input for two ambiguous entities (text mentions both)', async () => {
    const client = makeContractClient({
      resolveResults: [
        { kind: 'person', query: 'Alex', status: 'ambiguous', choices: [{ value: 'a', label: 'Alex Smith' }], message: '' },
        { kind: 'tag', query: 'Travel', status: 'ambiguous', choices: [{ value: 't', label: 'Travel 2024' }], message: '' },
      ],
    });
    const result = await resolveAssetSource({ client, sourceDescription: 'photos of Alex tagged Travel', now: NOW });
    assert.equal(result.status, 'needs_input');
    assert.ok(/Alex/i.test(result.text), `text should mention "Alex" but got: ${result.text}`);
    assert.ok(/Travel/i.test(result.text), `text should mention "Travel" but got: ${result.text}`);
    assert.equal(client.calls.some((c) => c.name === 'searchAssets'), false);
  });

  it('all-matched proceeds to resolved (regression guard)', async () => {
    const client = makeContractClient({
      resolvedFilters: { personIds: ['per-1'] },
      resolveResults: [{ kind: 'person', query: 'Alex', status: 'matched', choices: [], message: '' }],
    });
    const result = await resolveAssetSource({ client, sourceDescription: 'photos of Alex', now: NOW });
    assert.equal(result.status, 'resolved');
    const searchCall = client.calls.find((c) => c.name === 'searchAssets');
    assert.deepEqual(searchCall.args.filters, { personIds: ['per-1'] });
  });

  it('ambiguous-vs-empty distinction: matched person with zero photos → empty (not needs_input)', async () => {
    const client = makeContractClient({
      resolvedFilters: { personIds: ['per-1'] },
      resolveResults: [{ kind: 'person', query: 'Alex', status: 'matched', choices: [], message: '' }],
      handleAssetCount: 0,
    });
    const result = await resolveAssetSource({ client, sourceDescription: 'photos of Alex', now: NOW });
    assert.equal(result.status, 'empty');
  });

  it('needs_input copy carries NO ids (labels and queries only)', async () => {
    const client = makeContractClient({
      resolveResults: [
        { kind: 'person', query: 'Alex', status: 'ambiguous', choices: [{ value: 'p1', label: 'Alex Smith' }, { value: 'p2', label: 'Alex Jones' }], message: '' },
      ],
    });
    const result = await resolveAssetSource({ client, sourceDescription: 'photos of Alex', now: NOW });
    assert.equal(result.status, 'needs_input');
    assert.equal(result.text.includes('p1'), false);
    assert.equal(result.text.includes('p2'), false);
  });
});

describe('resolveAssetSource — entity × recency/date/type/direct matrix', () => {
  it('newest 20 photos of Alex: resolved; order=desc, limit=20, filters={personIds}', async () => {
    const client = makeContractClient({
      resolvedFilters: { personIds: ['per-1'] },
      resolveResults: [{ kind: 'person', query: 'Alex', status: 'matched', choices: [], message: '' }],
    });
    const result = await resolveAssetSource({ client, sourceDescription: 'newest 20 photos of Alex', now: NOW });
    assert.equal(result.status, 'resolved');
    const search = client.calls.find((c) => c.name === 'searchAssets');
    assert.equal(search.args.order, 'desc');
    assert.equal(search.args.limit, 20);
    assert.deepEqual(search.args.filters, { personIds: ['per-1'] });
  });

  it('5-star videos from 2024: resolved; no resolver call; filters={takenAfter, takenBefore, type, rating}', async () => {
    const client = makeContractClient();
    const result = await resolveAssetSource({ client, sourceDescription: '5-star videos from 2024', now: NOW });
    assert.equal(result.status, 'resolved');
    assert.equal(client.calls.some((c) => c.name === 'resolveAssetSearchFilters'), false);
    const search = client.calls.find((c) => c.name === 'searchAssets');
    assert.deepEqual(search.args.filters, {
      takenAfter: '2024-01-01T00:00:00.000Z',
      takenBefore: '2024-12-31T23:59:59.999Z',
      type: 'VIDEO',
      rating: 5,
    });
  });

  it('my Sony photos of Alex: resolved; resolveAssetSearchFilters args={people, cameraMakes}; filters={personIds, make}', async () => {
    const client = makeContractClient({
      resolvedFilters: { personIds: ['per-1'], make: 'Sony' },
      resolveResults: [
        { kind: 'person', query: 'Alex', status: 'matched', choices: [], message: '' },
        { kind: 'cameraMake', query: 'Sony', status: 'matched', choices: [], message: '' },
      ],
    });
    const result = await resolveAssetSource({ client, sourceDescription: 'my Sony photos of Alex', now: NOW });
    assert.equal(result.status, 'resolved');
    const resolveCall = client.calls.find((c) => c.name === 'resolveAssetSearchFilters');
    assert.deepEqual(resolveCall.args, { people: ['Alex'], cameraMakes: ['Sony'] });
    const search = client.calls.find((c) => c.name === 'searchAssets');
    assert.deepEqual(search.args.filters, { personIds: ['per-1'], make: 'Sony' });
  });

  it('tagged Travel and favorited: resolved; resolveAssetSearchFilters args={tags}; filters={isFavorite, tagIds}', async () => {
    const client = makeContractClient({
      resolvedFilters: { tagIds: ['tag-1'] },
      resolveResults: [{ kind: 'tag', query: 'Travel', status: 'matched', choices: [], message: '' }],
    });
    const result = await resolveAssetSource({ client, sourceDescription: 'tagged Travel and favorited', now: NOW });
    assert.equal(result.status, 'resolved');
    const resolveCall = client.calls.find((c) => c.name === 'resolveAssetSearchFilters');
    assert.deepEqual(resolveCall.args, { tags: ['Travel'] });
    const search = client.calls.find((c) => c.name === 'searchAssets');
    assert.deepEqual(search.args.filters, { isFavorite: true, tagIds: ['tag-1'] });
  });

  it('over-resolution guard: photos of Alex underwater → handoff before any tool call', async () => {
    const client = makeContractClient();
    const result = await resolveAssetSource({ client, sourceDescription: 'photos of Alex underwater', now: NOW });
    assert.equal(result.status, 'handoff');
    assert.equal(client.calls.some((c) => c.name === 'resolveAssetSearchFilters'), false);
    assert.equal(client.calls.some((c) => c.name === 'searchAssets'), false);
  });

  it('subjective-beats-entity: the best Berlin photos → handoff; no searchAssets call', async () => {
    const client = makeContractClient();
    const result = await resolveAssetSource({ client, sourceDescription: 'the best Berlin photos', now: NOW });
    assert.equal(result.status, 'handoff');
    assert.equal(client.calls.some((c) => c.name === 'searchAssets'), false);
  });

  it('place-vs-person matched: photos of Paris → resolved; filters={personIds} (person wins)', async () => {
    const client = makeContractClient({
      resolvedFilters: { personIds: ['per-9'] },
      resolveResults: [{ kind: 'person', query: 'Paris', status: 'matched', choices: [], message: '' }],
    });
    const result = await resolveAssetSource({ client, sourceDescription: 'photos of Paris', now: NOW });
    assert.equal(result.status, 'resolved');
    const search = client.calls.find((c) => c.name === 'searchAssets');
    assert.deepEqual(search.args.filters, { personIds: ['per-9'] });
  });

  it('place-vs-person not_found (safe branch): photos of Paris → needs_input; no searchAssets call', async () => {
    const client = makeContractClient({
      resolveResults: [{ kind: 'person', query: 'Paris', status: 'not_found', choices: [], message: '' }],
    });
    const result = await resolveAssetSource({ client, sourceDescription: 'photos of Paris', now: NOW });
    assert.equal(result.status, 'needs_input');
    assert.equal(client.calls.some((c) => c.name === 'searchAssets'), false);
  });

  it('regression: my newest 20 photos → resolved; search args has NO filters key', async () => {
    const client = makeContractClient();
    const result = await resolveAssetSource({ client, sourceDescription: 'my newest 20 photos', now: NOW });
    assert.equal(result.status, 'resolved');
    const search = client.calls.find((c) => c.name === 'searchAssets');
    assert.deepEqual(search.args, { mode: 'metadata', order: 'desc', limit: 20, detail: 'handle' });
    assert.equal('filters' in search.args, false);
  });

  it('parseEntitySource("photos I favorited") → {directFilters:{isFavorite:true}}', () => {
    assert.deepEqual(parseEntitySource('photos I favorited'), { directFilters: { isFavorite: true } });
  });

  it('parseEntitySource("tagged Travel and favorited") → {tags:[Travel], directFilters:{isFavorite:true}}', () => {
    assert.deepEqual(parseEntitySource('tagged Travel and favorited'), {
      tags: ['Travel'],
      directFilters: { isFavorite: true },
    });
  });
});

// ---------------------------------------------------------------------------
// parseUploadRange (Slice 3)
// ---------------------------------------------------------------------------

describe('parseUploadRange', () => {
  // "uploaded today" → createdAfter/createdBefore bounding 2026-05-15.
  it('"uploaded today" → createdAfter/createdBefore bounding today', () => {
    const result = parseUploadRange('uploaded today', NOW);
    assert.ok(result, 'should return a range');
    assert.equal(result.createdAfter.toISOString(), '2026-05-15T00:00:00.000Z');
    assert.equal(result.createdBefore.toISOString(), '2026-05-15T23:59:59.999Z');
    assert.equal('takenAfter' in result, false);
    assert.equal('takenBefore' in result, false);
  });

  // "added this week" → this-week created range (Monday 2026-05-11 through Friday 2026-05-15).
  it('"added this week" → this-week created range', () => {
    const result = parseUploadRange('added this week', NOW);
    assert.ok(result, 'should return a range for "added this week"');
    assert.equal(result.createdAfter.toISOString(), '2026-05-11T00:00:00.000Z');
    assert.equal(result.createdBefore.toISOString(), '2026-05-15T23:59:59.999Z');
    assert.equal('takenAfter' in result, false);
  });

  // "imported yesterday" → 2026-05-14 created range.
  it('"imported yesterday" → 2026-05-14 created range', () => {
    const result = parseUploadRange('imported yesterday', NOW);
    assert.ok(result, 'should return a range');
    assert.equal(result.createdAfter.toISOString(), '2026-05-14T00:00:00.000Z');
    assert.equal(result.createdBefore.toISOString(), '2026-05-14T23:59:59.999Z');
    assert.equal('takenAfter' in result, false);
  });

  // "uploaded in January 2024" → Jan 2024 created range.
  it('"uploaded in January 2024" → January 2024 created range', () => {
    const result = parseUploadRange('uploaded in January 2024', NOW);
    assert.ok(result, 'should return a range');
    assert.equal(result.createdAfter.toISOString(), '2024-01-01T00:00:00.000Z');
    assert.equal(result.createdBefore.toISOString(), '2024-01-31T23:59:59.999Z');
    assert.equal('takenAfter' in result, false);
  });

  // "recent uploads" → createdAfter = now − 30 days, createdBefore = now.
  it('"recent uploads" → 30-day default window', () => {
    const result = parseUploadRange('recent uploads', NOW);
    assert.ok(result, 'should return a range');
    const expectedAfter = new Date(NOW.getTime() - 30 * 86_400_000);
    assert.equal(result.createdAfter.toISOString(), expectedAfter.toISOString());
    assert.equal(result.createdBefore.toISOString(), NOW.toISOString());
    assert.equal('takenAfter' in result, false);
  });

  // "recently uploaded" → 30-day default window.
  it('"recently uploaded" → 30-day default window', () => {
    const result = parseUploadRange('recently uploaded', NOW);
    assert.ok(result, 'should return a range');
    const expectedAfter = new Date(NOW.getTime() - 30 * 86_400_000);
    assert.equal(result.createdAfter.toISOString(), expectedAfter.toISOString());
    assert.equal(result.createdBefore.toISOString(), NOW.toISOString());
  });

  // "photos I uploaded" (no time, not "recent") → undefined.
  it('"photos I uploaded" (no time, not recent) → undefined', () => {
    assert.equal(parseUploadRange('photos I uploaded', NOW), undefined);
  });

  it('"uploaded in the last 6 months" → rolling created range', () => {
    const result = parseUploadRange('uploaded in the last 6 months', NOW);
    assert.ok(result, 'should return a range');
    assert.equal(result.createdAfter.toISOString(), '2025-11-15T12:00:00.000Z');
    assert.equal(result.createdBefore.toISOString(), NOW.toISOString());
  });

  // Capture phrasing returns undefined.
  it('"photos from today" (capture phrasing) → undefined', () => {
    assert.equal(parseUploadRange('photos from today', NOW), undefined);
  });

  it('"taken last weekend" (capture phrasing) → undefined', () => {
    assert.equal(parseUploadRange('taken last weekend', NOW), undefined);
  });
});

// ---------------------------------------------------------------------------
// resolveAssetSource — upload source integration (Slice 3)
// ---------------------------------------------------------------------------

describe('resolveAssetSource — upload sources', () => {
  it('"everything I uploaded today" → resolved; searchAssets carries createdAfter/createdBefore, NOT takenAfter', async () => {
    const client = makeContractClient({ handleAssetCount: 7 });
    const result = await resolveAssetSource({ client, sourceDescription: 'everything I uploaded today', now: NOW });
    assert.equal(result.status, 'resolved');
    const search = client.calls.find((c) => c.name === 'searchAssets');
    assert.ok(search, 'searchAssets must be called');
    assert.ok('createdAfter' in (search.args.filters ?? {}), 'filters must contain createdAfter');
    assert.ok('createdBefore' in (search.args.filters ?? {}), 'filters must contain createdBefore');
    assert.equal('takenAfter' in (search.args.filters ?? {}), false);
    assert.equal('takenBefore' in (search.args.filters ?? {}), false);
  });

  it('"photos from today" (capture) → searchAssets carries takenAfter/takenBefore, NOT createdAfter', async () => {
    const client = makeContractClient({ handleAssetCount: 3 });
    const result = await resolveAssetSource({ client, sourceDescription: 'photos from today', now: NOW });
    assert.equal(result.status, 'resolved');
    const search = client.calls.find((c) => c.name === 'searchAssets');
    assert.ok(search, 'searchAssets must be called');
    assert.ok('takenAfter' in (search.args.filters ?? {}), 'filters must contain takenAfter');
    assert.ok('takenBefore' in (search.args.filters ?? {}), 'filters must contain takenBefore');
    assert.equal('createdAfter' in (search.args.filters ?? {}), false);
    assert.equal('createdBefore' in (search.args.filters ?? {}), false);
  });

  it('"photos I uploaded today" (mixed) → upload wins; searchAssets carries createdAfter, NOT takenAfter', async () => {
    const client = makeContractClient({ handleAssetCount: 4 });
    const result = await resolveAssetSource({ client, sourceDescription: 'photos I uploaded today', now: NOW });
    assert.equal(result.status, 'resolved');
    const search = client.calls.find((c) => c.name === 'searchAssets');
    assert.ok(search, 'searchAssets must be called');
    assert.ok('createdAfter' in (search.args.filters ?? {}), 'filters must have createdAfter (upload wins)');
    assert.equal('takenAfter' in (search.args.filters ?? {}), false);
  });

  it('"recent uploads" → resolved (NOT handoff); createdAfter is 30-day default window', async () => {
    const client = makeContractClient({ handleAssetCount: 10 });
    const result = await resolveAssetSource({ client, sourceDescription: 'recent uploads', now: NOW });
    assert.equal(result.status, 'resolved');
    const search = client.calls.find((c) => c.name === 'searchAssets');
    assert.ok(search, 'searchAssets must be called');
    const expectedAfter = new Date(NOW.getTime() - 30 * 86_400_000).toISOString();
    assert.equal(search.args.filters?.createdAfter, expectedAfter);
  });

  it('"uploaded in the last 6 months" → resolved with created range', async () => {
    const client = makeContractClient({ handleAssetCount: 10 });
    const result = await resolveAssetSource({ client, sourceDescription: 'uploaded in the last 6 months', now: NOW });
    assert.equal(result.status, 'resolved');
    const search = client.calls.find((c) => c.name === 'searchAssets');
    assert.ok(search, 'searchAssets must be called');
    assert.equal(search.args.filters?.createdAfter, '2025-11-15T12:00:00.000Z');
    assert.equal(search.args.filters?.createdBefore, NOW.toISOString());
    assert.equal('takenAfter' in (search.args.filters ?? {}), false);
    assert.equal(search.args.limit, 1000);
  });

  it('"photos I uploaded" (no time) → handoff (no bounded upload range)', async () => {
    const client = makeContractClient();
    const result = await resolveAssetSource({ client, sourceDescription: 'photos I uploaded', now: NOW });
    assert.equal(result.status, 'handoff');
    assert.equal(client.calls.some((c) => c.name === 'searchAssets'), false);
  });
});

// ---------------------------------------------------------------------------
// Slice E1 — screenshots noun → tag-first resolution
// ---------------------------------------------------------------------------

describe('parseEntitySource — screenshots noun', () => {
  for (const input of ['my screenshots', 'screenshots', 'screen shots', 'screen captures', 'screenshot']) {
    it(`parseEntitySource(${JSON.stringify(input)}) → {tags:['Screenshots'], screenshotSource:true}`, () => {
      const entity = parseEntitySource(input);
      assert.deepEqual(entity?.tags, ['Screenshots']);
      assert.equal(entity?.screenshotSource, true);
    });
  }

  it('parseEntitySource("my screenshots from last week") → tags:["Screenshots"], screenshotSource:true (date not in entity)', () => {
    // Date tokens are not entity-level; entity only tracks the tag injection.
    const entity = parseEntitySource('my screenshots from last week');
    assert.deepEqual(entity?.tags, ['Screenshots']);
    assert.equal(entity?.screenshotSource, true);
  });

  it('parseEntitySource("my Sony photos") unchanged (regression)', () => {
    assert.deepEqual(parseEntitySource('my Sony photos'), { cameras: ['Sony'] });
  });

  it('parseEntitySource("my videos") → undefined (not screenshots)', () => {
    assert.equal(parseEntitySource('my videos'), undefined);
  });
});

describe('isCleanSource — screenshots noun', () => {
  it('"my screenshots" is clean after screenshots noun is consumed', () => {
    assert.equal(isCleanSource('my screenshots'), true);
  });

  it('"screenshots from last week" is clean', () => {
    assert.equal(isCleanSource('screenshots from last week'), true);
  });
});

describe('resolveAssetSource — screenshots (E1)', () => {
  it('"my screenshots" → calls resolveAssetSearchFilters({tags:["Screenshots"]}); resolved with tagIds', async () => {
    const client = makeContractClient({ resolvedFilters: { tagIds: ['tag-sc-1'] } });
    const result = await resolveAssetSource({ client, sourceDescription: 'my screenshots', now: NOW });
    assert.equal(result.status, 'resolved');
    const resolveCall = client.calls.find((c) => c.name === 'resolveAssetSearchFilters');
    assert.ok(resolveCall, 'resolveAssetSearchFilters must be called');
    assert.deepEqual(resolveCall.args, { tags: ['Screenshots'] });
    const searchCall = client.calls.find((c) => c.name === 'searchAssets');
    assert.deepEqual(searchCall.args.filters, { tagIds: ['tag-sc-1'] });
  });

  it('"screenshots" (bare) → resolves same as "my screenshots"', async () => {
    const client = makeContractClient({ resolvedFilters: { tagIds: ['tag-sc-1'] } });
    const result = await resolveAssetSource({ client, sourceDescription: 'screenshots', now: NOW });
    assert.equal(result.status, 'resolved');
    const resolveCall = client.calls.find((c) => c.name === 'resolveAssetSearchFilters');
    assert.deepEqual(resolveCall.args, { tags: ['Screenshots'] });
  });

  it('"screen shots" (two words) → resolves via Screenshots tag', async () => {
    const client = makeContractClient({ resolvedFilters: { tagIds: ['tag-sc-1'] } });
    const result = await resolveAssetSource({ client, sourceDescription: 'screen shots', now: NOW });
    assert.equal(result.status, 'resolved');
    const resolveCall = client.calls.find((c) => c.name === 'resolveAssetSearchFilters');
    assert.deepEqual(resolveCall.args, { tags: ['Screenshots'] });
  });

  it('"screen captures" → resolves via Screenshots tag', async () => {
    const client = makeContractClient({ resolvedFilters: { tagIds: ['tag-sc-1'] } });
    const result = await resolveAssetSource({ client, sourceDescription: 'screen captures', now: NOW });
    assert.equal(result.status, 'resolved');
    const resolveCall = client.calls.find((c) => c.name === 'resolveAssetSearchFilters');
    assert.deepEqual(resolveCall.args, { tags: ['Screenshots'] });
  });

  it('"screenshot" (singular) → resolves via Screenshots tag', async () => {
    const client = makeContractClient({ resolvedFilters: { tagIds: ['tag-sc-1'] } });
    const result = await resolveAssetSource({ client, sourceDescription: 'screenshot', now: NOW });
    assert.equal(result.status, 'resolved');
    const resolveCall = client.calls.find((c) => c.name === 'resolveAssetSearchFilters');
    assert.deepEqual(resolveCall.args, { tags: ['Screenshots'] });
  });

  it('tag-not-found (both Screenshots and Auto/Screenshots absent) → needs_input disclosure, no searchAssets', async () => {
    // Stub: not_found for both Screenshots and Auto/Screenshots
    const client = makeContractClient({
      resolveResults: [
        { kind: 'tag', query: 'Screenshots', status: 'not_found', choices: [], message: '' },
        { kind: 'tag', query: 'Auto/Screenshots', status: 'not_found', choices: [], message: '' },
      ],
    });
    const result = await resolveAssetSource({ client, sourceDescription: 'my screenshots', now: NOW });
    assert.equal(result.status, 'needs_input');
    // Must mention screenshots being untagged, not silently match everything
    assert.ok(/screenshot/i.test(result.text), `text should mention screenshots but got: ${result.text}`);
    assert.equal(client.calls.some((c) => c.name === 'searchAssets'), false);
  });

  it('Auto/Screenshots fallback: Screenshots not_found, Auto/Screenshots matched → resolved with Auto/Screenshots tagId', async () => {
    // Stub: Screenshots not found, Auto/Screenshots matched
    const client = makeContractClient({
      resolvedFilters: { tagIds: ['tag-auto-sc-1'] },
      resolveResults: [
        { kind: 'tag', query: 'Screenshots', status: 'not_found', choices: [], message: '' },
        { kind: 'tag', query: 'Auto/Screenshots', status: 'matched', choices: [], message: '' },
      ],
    });
    const result = await resolveAssetSource({ client, sourceDescription: 'my screenshots', now: NOW });
    assert.equal(result.status, 'resolved');
    const searchCall = client.calls.find((c) => c.name === 'searchAssets');
    assert.deepEqual(searchCall.args.filters, { tagIds: ['tag-auto-sc-1'] });
  });

  it('"screenshots from last week" → tagIds + date filter both survive', async () => {
    const client = makeContractClient({ resolvedFilters: { tagIds: ['tag-sc-1'] } });
    const result = await resolveAssetSource({ client, sourceDescription: 'screenshots from last week', now: NOW });
    assert.equal(result.status, 'resolved');
    const searchCall = client.calls.find((c) => c.name === 'searchAssets');
    assert.deepEqual(searchCall.args.filters, {
      tagIds: ['tag-sc-1'],
      takenAfter: '2026-05-04T00:00:00.000Z',
      takenBefore: '2026-05-10T23:59:59.999Z',
    });
  });

  it('regression: "my Sony photos" unchanged (no screenshots leakage)', async () => {
    const client = makeContractClient({ resolvedFilters: { make: 'Sony' } });
    const result = await resolveAssetSource({ client, sourceDescription: 'my Sony photos', now: NOW });
    assert.equal(result.status, 'resolved');
    const resolveCall = client.calls.find((c) => c.name === 'resolveAssetSearchFilters');
    assert.deepEqual(resolveCall.args, { cameraMakes: ['Sony'] });
    const searchCall = client.calls.find((c) => c.name === 'searchAssets');
    assert.deepEqual(searchCall.args.filters, { make: 'Sony' });
  });
});

// ---------------------------------------------------------------------------
// isCleanSource — upload words (Slice 3)
// ---------------------------------------------------------------------------

describe('isCleanSource — upload word consumption', () => {
  it('"everything I uploaded today" is clean (upload words stripped)', () => {
    assert.equal(isCleanSource('everything I uploaded today'), true);
  });

  it('"recent uploads" is clean', () => {
    assert.equal(isCleanSource('recent uploads'), true);
  });

  it('"photos I uploaded" is clean (no residual after strip)', () => {
    assert.equal(isCleanSource('photos I uploaded'), true);
  });
});
