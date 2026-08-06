# Pi Agent Highlight Curation Slice 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add metadata-only highlight write plans for bounded highlight requests, using selected asset IDs only.

**Architecture:** Extend the deterministic e2e runner highlight path from read-only guardrails into metadata-only planning when the user asks to create a highlights album, add highlights to an existing album, or favorite highlights. The e2e runner will search a concrete bounded source, read metadata for the returned IDs, select a deterministic subset using favorites/ratings/date metadata, and call `proposeAlbumOperations` with explicit selected `assetIds`. Real Pi behavior is guided by a compact system prompt update that removes the Slice 2 read-only exception and teaches metadata-only selected-ID planning.

**Tech Stack:** Node ESM runner, Node built-in test runner, Gallery MCP JSON-RPC tool calls.

---

## Scope Boundaries

This plan implements only Slice 3 from `docs/superpowers/specs/2026-05-26-pi-agent-highlight-curation-design.md`.

In scope:

- Metadata-only highlight planning for concrete bounded deterministic sources.
- Create-highlights-album flow using `album.create` plus `album.addAssets`.
- Add-highlights-to-existing-album flow using `listAlbums`, `readAlbum`, and `album.addAssets`.
- Favorite-highlights flow using `asset.setFavorite`.
- Selected-ID invariant: all write operations use selected `assetIds` only; no operation carries the original broad `assetSource`.
- Duplicate avoidance for existing album adds when the target album already contains candidate assets.
- Fewer-candidates-than-requested planning for available candidates with an honest count in the assistant response.
- Source-over-metadata-limit narrowing when a write-intent search returns a full 500-item page with `hasMore: true`.
- Plan summaries disclose metadata-only criteria and no preview inspection.

Out of scope:

- Preview reads, preview-assisted selection, preview denial handling, and no-originals tests. Slice 4 owns these.
- Cover selection. Slice 4 owns this.
- UI plan review changes and sparse apply coverage. Slice 5 owns these.
- Capability matrix completion and acceptance E2E. Slice 6 owns these.
- New server-side curation/scoring services or `analyzeAssetQuality`.
- Whole-library curation without a bounded source.

## Files

- Modify: `agent-runner/src/e2e-runtime.test.mjs`
  - Add metadata-only planning tests for create album, add to existing album, favorite, selected-ID invariant, duplicate exclusion, fewer candidates, metadata preference ordering, source-over-limit narrowing, and album-name parsing edge cases.
- Modify: `agent-runner/src/e2e-runtime.mjs`
  - Add metadata read, metadata ranking, plan-intent parsing, existing-album resolution, and metadata-only proposal helpers.
- Modify: `agent-runner/src/pi-runtime.mjs`
  - Update the real Pi prompt from Slice 2 read-only guardrails to Slice 3 metadata-only planning guidance.
- Modify: `agent-runner/src/pi-runtime.test.mjs`
  - Assert the prompt includes metadata-only highlight planning guidance and no longer says Slice 2 is read-only.

## Deterministic Slice 3 Behavior

The deterministic e2e runner only needs to resolve `last weekend` / `weekend` as a concrete source in this slice. Other syntactically bounded phrases such as `this album` still ask for a concrete searchable source until later acceptance work adds richer context resolution.

Use the existing source filters:

```js
const lastWeekendHighlightFilters = {
  takenAfter: '2026-05-23T00:00:00.000Z',
  takenBefore: '2026-05-24T23:59:59.999Z',
};
```

Selection order:

1. Exclude assets already present in the target album when adding to an existing album.
2. Prefer `isFavorite === true`.
3. Prefer higher `exifInfo.rating`.
4. Prefer earlier original search order for ties.

Metadata reads must request:

```js
fields: ['type', 'dates', 'filename', 'favorite', 'rating', 'tags', 'location'];
```

Plan summaries and assistant text must say metadata-only / no previews, and must not claim objective quality scoring.

## Task 1: Add E2E Metadata-Only Highlight Planning Red Tests

**Files:**

- Modify: `agent-runner/src/e2e-runtime.test.mjs`
- Test: `agent-runner/src/e2e-runtime.test.mjs`

- [ ] **Step 1: Add shared metadata highlight test fixtures**

Add these constants and helper functions after `lastWeekendHighlightFilters`:

```js
const highlightAssetIds = [
  '00000000-0000-4000-8000-000000000401',
  '00000000-0000-4000-8000-000000000402',
  '00000000-0000-4000-8000-000000000403',
  '00000000-0000-4000-8000-000000000404',
];
const familyAlbumId = '00000000-0000-4000-8000-000000000501';
const familyOwnerId = '00000000-0000-4000-8000-000000000601';

const highlightMetadataAsset = (id, overrides = {}) => ({
  id,
  type: 'IMAGE',
  localDateTime: '2026-05-23T12:00:00.000Z',
  originalFileName: `${id.slice(-4)}.jpg`,
  isFavorite: false,
  exifInfo: { rating: 0, city: 'Porto', country: 'Portugal' },
  tags: [{ id: '00000000-0000-4000-8000-000000000701', value: 'Trip', color: 'blue' }],
  ...overrides,
});

const defaultHighlightMetadataAssets = () => [
  highlightMetadataAsset(highlightAssetIds[0], { exifInfo: { rating: 3, city: 'Porto', country: 'Portugal' } }),
  highlightMetadataAsset(highlightAssetIds[1], {
    isFavorite: true,
    exifInfo: { rating: 1, city: 'Porto', country: 'Portugal' },
  }),
  highlightMetadataAsset(highlightAssetIds[2], { exifInfo: { rating: 5, city: 'Lisbon', country: 'Portugal' } }),
  highlightMetadataAsset(highlightAssetIds[3], { exifInfo: { rating: 2, city: 'Lisbon', country: 'Portugal' } }),
];

const familyAlbumSummary = () => ({
  id: familyAlbumId,
  albumName: 'Family',
  description: 'Family album',
  ownerId: familyOwnerId,
  assetCount: 1,
  startDate: '2026-05-20T00:00:00.000Z',
  endDate: '2026-05-25T00:00:00.000Z',
  albumThumbnailAssetId: null,
});

const metadataHighlightHandlers = ({
  assetIds = highlightAssetIds,
  metadataAssets = defaultHighlightMetadataAssets(),
  totalCount,
  albums = [],
  albumAssetIds = [],
} = {}) => [
  {
    name: 'searchAssets',
    handle: (args, request) => {
      const returnedAssetIds = assetIds.slice(0, args.limit ?? assetIds.length);
      return {
        body: {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            structuredContent: {
              summary: `Returned ${returnedAssetIds.length} highlight candidate(s).`,
              detail: 'ids',
              assetIds: returnedAssetIds,
              returnedCount: returnedAssetIds.length,
              hasMore: assetIds.length > returnedAssetIds.length,
              nextPage: assetIds.length > returnedAssetIds.length ? '2' : null,
              ...(totalCount === undefined ? {} : { totalCount }),
            },
          },
        },
      };
    },
  },
  {
    name: 'readAssetMetadata',
    handle: (args, request) => ({
      body: {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          structuredContent: {
            summary: `Returned metadata for ${args.assetIds.length} asset(s).`,
            fields: args.fields,
            assets: args.assetIds.map((id) => metadataAssets.find((asset) => asset.id === id)).filter(Boolean),
          },
        },
      },
    }),
  },
  {
    name: 'listAlbums',
    handle: (_args, request) => ({
      body: {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          structuredContent: { albums },
        },
      },
    }),
  },
  {
    name: 'readAlbum',
    handle: (args, request) => {
      const album = albums.find((candidate) => candidate.id === args.albumId);
      return {
        body: {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            structuredContent: {
              album: {
                ...album,
                assetCount: albumAssetIds.length,
                assetIds: albumAssetIds,
              },
            },
          },
        },
      };
    },
  },
  successHandlers()[1],
];
```

- [ ] **Step 2: Add a create-highlights-album test that must fail first**

Add this test after the existing read-only highlight guardrail tests:

```js
it('proposes a metadata-only highlights album with selected asset ids only', async () => {
  const { calls, fetchImplementation } = createFetch(metadataHighlightHandlers());
  const runtime = createE2eRuntime({ fetch: fetchImplementation });
  await runtime.createSession(createSessionBody());

  const events = await collectEvents(
    runtime,
    'Pick the best 2 photos from last weekend and make an album called Weekend Highlights.',
  );

  assert.equal(
    calls.map((call) => call.body.params.name).join(','),
    'searchAssets,readAssetMetadata,proposeAlbumOperations',
  );
  assert.deepEqual(calls[0].body.params.arguments, {
    filters: lastWeekendHighlightFilters,
    detail: 'ids',
    limit: 500,
  });
  assert.deepEqual(calls[1].body.params.arguments, {
    assetIds: highlightAssetIds,
    fields: ['type', 'dates', 'filename', 'favorite', 'rating', 'tags', 'location'],
  });

  const plan = calls[2].body.params.arguments;
  assert.match(plan.summary, /metadata-only/i);
  assert.match(plan.summary, /ratings|favorites/i);
  assert.equal(JSON.stringify(plan).includes('assetSource'), false);
  assert.equal(JSON.stringify(plan).includes('previousSearch'), false);
  assert.deepEqual(
    plan.operations.map((operation) => operation.type),
    ['album.create', 'album.addAssets'],
  );
  assert.equal(plan.operations[0].payload.albumName, 'Weekend Highlights');
  assert.equal(plan.operations[1].targetKind, 'new_album');
  assert.equal(plan.operations[1].temporaryTargetId, 'weekend-highlights');
  assert.deepEqual(plan.operations[1].assetIds, [
    '00000000-0000-4000-8000-000000000402',
    '00000000-0000-4000-8000-000000000403',
  ]);
  assert.match(events.at(-1).content.blocks[0].text, /metadata-only/i);
  assert.match(events.at(-1).content.blocks[0].text, /2 suggested highlights/i);
  assert.match(events.at(-1).content.blocks[0].text, /Review/i);
});

it('keeps favorite in a requested album name from becoming a favorite operation', async () => {
  const { calls, fetchImplementation } = createFetch(metadataHighlightHandlers());
  const runtime = createE2eRuntime({ fetch: fetchImplementation });
  await runtime.createSession(createSessionBody());

  await collectEvents(
    runtime,
    'Pick the best 2 photos from last weekend and make an album called Favorite Highlights.',
  );

  assert.equal(
    calls.map((call) => call.body.params.name).join(','),
    'searchAssets,readAssetMetadata,proposeAlbumOperations',
  );
  const plan = calls[2].body.params.arguments;
  assert.deepEqual(
    plan.operations.map((operation) => operation.type),
    ['album.create', 'album.addAssets'],
  );
  assert.equal(plan.operations[0].payload.albumName, 'Favorite Highlights');
  assert.equal(plan.operations[1].temporaryTargetId, 'favorite-highlights');
});

it('parses album names before trailing source phrases in highlight album requests', async () => {
  const { calls, fetchImplementation } = createFetch(metadataHighlightHandlers());
  const runtime = createE2eRuntime({ fetch: fetchImplementation });
  await runtime.createSession(createSessionBody());

  await collectEvents(runtime, 'Pick the best 2 photos and make an album called Weekend Highlights from last weekend.');

  assert.equal(
    calls.map((call) => call.body.params.name).join(','),
    'searchAssets,readAssetMetadata,proposeAlbumOperations',
  );
  const plan = calls[2].body.params.arguments;
  assert.equal(plan.operations[0].payload.albumName, 'Weekend Highlights');
  assert.equal(plan.operations[1].temporaryTargetId, 'weekend-highlights');
});
```

This expected selection proves curation uses the bounded candidate set, not just the requested output count: asset `402` is favorite with rating `1`, so it comes before higher-rated non-favorites, and asset `403` with rating `5` beats asset `401` with rating `3`.

- [ ] **Step 3: Add an existing-album add test**

Add:

```js
it('adds metadata highlights to an existing album while excluding assets already in the album', async () => {
  const albums = [familyAlbumSummary()];
  const { calls, fetchImplementation } = createFetch(
    metadataHighlightHandlers({
      albums,
      albumAssetIds: ['00000000-0000-4000-8000-000000000402'],
    }),
  );
  const runtime = createE2eRuntime({ fetch: fetchImplementation });
  await runtime.createSession(createSessionBody());

  const events = await collectEvents(runtime, 'Add 2 highlights from last weekend to Family.');

  assert.equal(
    calls.map((call) => call.body.params.name).join(','),
    'listAlbums,readAlbum,searchAssets,readAssetMetadata,proposeAlbumOperations',
  );
  assert.deepEqual(calls[1].body.params.arguments, { albumId: familyAlbumId });
  assert.equal(calls[2].body.params.arguments.limit, 500);
  const plan = calls.at(-1).body.params.arguments;
  assert.equal(JSON.stringify(plan).includes('assetSource'), false);
  assert.equal(JSON.stringify(plan).includes('previousSearch'), false);
  assert.deepEqual(plan.operations, [
    {
      type: 'album.addAssets',
      summary: 'Add 2 metadata-only suggested highlights to Family.',
      targetKind: 'existing_album',
      targetId: familyAlbumId,
      assetIds: ['00000000-0000-4000-8000-000000000403', '00000000-0000-4000-8000-000000000401'],
      riskLevel: 'medium',
      enabled: true,
      payload: {},
    },
  ]);
  assert.match(events.at(-1).content.blocks[0].text, /excluded 1 already in Family/i);
});

it('parses existing-album names before trailing source phrases in add-highlight requests', async () => {
  const albums = [familyAlbumSummary()];
  const { calls, fetchImplementation } = createFetch(
    metadataHighlightHandlers({
      albums,
    }),
  );
  const runtime = createE2eRuntime({ fetch: fetchImplementation });
  await runtime.createSession(createSessionBody());

  await collectEvents(runtime, 'Add 2 highlights to Family from last weekend.');

  assert.equal(
    calls.map((call) => call.body.params.name).join(','),
    'listAlbums,readAlbum,searchAssets,readAssetMetadata,proposeAlbumOperations',
  );
  assert.deepEqual(calls[1].body.params.arguments, { albumId: familyAlbumId });
  assert.equal(calls.at(-1).body.params.arguments.operations[0].targetId, familyAlbumId);
});
```

- [ ] **Step 4: Add a favorite-highlights test**

Add:

```js
it('proposes favorite operations for metadata-only highlight selections', async () => {
  const { calls, fetchImplementation } = createFetch(metadataHighlightHandlers());
  const runtime = createE2eRuntime({ fetch: fetchImplementation });
  await runtime.createSession(createSessionBody());

  const events = await collectEvents(runtime, 'Favorite the best 2 photos from last weekend.');

  assert.equal(
    calls.map((call) => call.body.params.name).join(','),
    'searchAssets,readAssetMetadata,proposeAlbumOperations',
  );
  const plan = calls[2].body.params.arguments;
  assert.equal(JSON.stringify(plan).includes('assetSource'), false);
  assert.equal(JSON.stringify(plan).includes('previousSearch'), false);
  assert.deepEqual(plan.operations, [
    {
      type: 'asset.setFavorite',
      summary: 'Favorite 2 metadata-only suggested highlights.',
      targetKind: 'asset_batch',
      assetIds: ['00000000-0000-4000-8000-000000000402', '00000000-0000-4000-8000-000000000403'],
      riskLevel: 'low',
      enabled: true,
      payload: { favorite: true },
    },
  ]);
  assert.match(events.at(-1).content.blocks[0].text, /favorite/i);
  assert.match(events.at(-1).content.blocks[0].text, /metadata-only/i);
});
```

- [ ] **Step 5: Add a fewer-candidates-than-requested test**

Add:

```js
it('plans available metadata highlights when fewer candidates than requested exist', async () => {
  const { calls, fetchImplementation } = createFetch(
    metadataHighlightHandlers({
      assetIds: highlightAssetIds.slice(0, 2),
      metadataAssets: defaultHighlightMetadataAssets().slice(0, 2),
    }),
  );
  const runtime = createE2eRuntime({ fetch: fetchImplementation });
  await runtime.createSession(createSessionBody());

  const events = await collectEvents(
    runtime,
    'Pick the best 5 photos from last weekend and make an album called Weekend Highlights.',
  );

  assert.equal(
    calls.map((call) => call.body.params.name).join(','),
    'searchAssets,readAssetMetadata,proposeAlbumOperations',
  );
  assert.equal(calls[0].body.params.arguments.limit, 500);
  assert.deepEqual(calls[2].body.params.arguments.operations[1].assetIds, [
    '00000000-0000-4000-8000-000000000402',
    '00000000-0000-4000-8000-000000000401',
  ]);
  assert.equal(JSON.stringify(calls[2].body.params.arguments).includes('assetSource'), false);
  assert.equal(JSON.stringify(calls[2].body.params.arguments).includes('previousSearch'), false);
  assert.match(events.at(-1).content.blocks[0].text, /only 2 eligible/i);
  assert.match(events.at(-1).content.blocks[0].text, /requested 5/i);
});

it('asks to narrow metadata highlight plans when the bounded source exceeds the metadata candidate limit', async () => {
  const oversizedAssetIds = Array.from(
    { length: 501 },
    (_value, index) => `00000000-0000-4000-8000-${String(1000 + index).padStart(12, '0')}`,
  );
  const { calls, fetchImplementation } = createFetch(
    metadataHighlightHandlers({
      assetIds: oversizedAssetIds,
    }),
  );
  const runtime = createE2eRuntime({ fetch: fetchImplementation });
  await runtime.createSession(createSessionBody());

  const events = await collectEvents(
    runtime,
    'Pick the best 2 photos from last weekend and make an album called Weekend Highlights.',
  );

  assert.equal(calls.map((call) => call.body.params.name).join(','), 'searchAssets');
  assert.equal(calls[0].body.params.arguments.limit, 500);
  assert.match(events.at(-1).content.blocks[0].text, /too many/i);
  assert.match(events.at(-1).content.blocks[0].text, /narrow/i);
});
```

- [ ] **Step 6: Run agent-runner tests and verify red**

Run:

```bash
pnpm --dir agent-runner test
```

Expected: FAIL. The new metadata-only highlight tests should fail because the current highlight branch answers read-only and never calls `readAssetMetadata` or `proposeAlbumOperations`.

## Task 2: Implement Metadata Selection And Create-Album Planning

**Files:**

- Modify: `agent-runner/src/e2e-runtime.mjs`
- Test: `agent-runner/src/e2e-runtime.test.mjs`

- [ ] **Step 1: Add metadata helper constants and MCP result success normalization**

Add after `metadataHighlightCandidateLimit`:

```js
const highlightMetadataFields = ['type', 'dates', 'filename', 'favorite', 'rating', 'tags', 'location'];
```

Add after `highlightCandidateCount()`:

```js
const assertMcpResultSuccess = (result, label) => {
  if (typeof result.status === 'string' && result.status !== 'success') {
    throw new Error(`${label} did not complete successfully: ${result.status}`);
  }
};
```

Also update `highlightCandidateCount()` so a full metadata-limit page with `hasMore: true` is treated as above the limit, while ordinary pagination below the cap still is not oversized:

```js
if (result.hasMore === true && (result.returnedCount ?? assetIds.length) >= metadataHighlightCandidateLimit) {
  return metadataHighlightCandidateLimit + 1;
}
```

Then update `readHighlightCandidates()` from:

```js
if (result.status !== 'success') {
  throw new Error(`Asset search did not complete successfully: ${result.status}`);
}
```

to:

```js
assertMcpResultSuccess(result, 'Asset search');
```

This preserves existing mocked `status: "success"` compatibility while accepting real Gallery MCP read results that omit a `status` field on success.

Also update the helper signature and limit argument so metadata-only planning can inspect a bounded candidate set that is larger than the requested output count:

```js
const readHighlightCandidates = async (client, highlightPrompt, limit = highlightPrompt.effectiveCount) => {
  const result = await client.call('searchAssets', {
    filters: highlightPrompt.filters,
    detail: 'ids',
    limit,
  });
```

- [ ] **Step 2: Add plan intent parsing helpers**

Add after `parseHighlightPrompt()`:

```js
const slugifyTemporaryTargetId = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'highlights';

const stripTrailingSourcePhrase = (value) =>
  value
    .replace(/\s+from\s+(?:last\s+weekend|weekend)\s*\.?$/i, '')
    .replace(/\.$/, '')
    .trim();

const extractAlbumName = (prompt) => {
  const quoted = prompt.match(/\balbum called\s+["']([^"']+)["']/i);
  if (quoted) {
    return quoted[1].trim();
  }

  const unquoted = prompt.match(/\balbum called\s+(.+?)\.?$/i);
  if (unquoted) {
    return stripTrailingSourcePhrase(unquoted[1]);
  }

  return 'Suggested Highlights';
};

const extractTargetAlbumName = (prompt) => {
  const beforeSource = prompt.match(/\bto\s+([A-Za-z][A-Za-z0-9 '&-]*?)\s+from\s+(?:last\s+weekend|weekend)\b/i);
  if (beforeSource) {
    return beforeSource[1].trim();
  }

  const match = prompt.match(/\bto\s+([A-Za-z][A-Za-z0-9 '&-]*?)\.?$/i);
  return match ? stripTrailingSourcePhrase(match[1]) : null;
};

const parseHighlightPlanIntent = (prompt) => {
  if (/\b(make|create)\b.*\balbum\b|\balbum called\b/i.test(prompt)) {
    const albumName = extractAlbumName(prompt);
    return {
      kind: 'create-album',
      albumName,
      temporaryTargetId: slugifyTemporaryTargetId(albumName),
    };
  }

  if (/\badd\b/i.test(prompt)) {
    const targetAlbumName = extractTargetAlbumName(prompt);
    return targetAlbumName ? { kind: 'add-to-album', targetAlbumName } : null;
  }

  if (/\bfavorite\b/i.test(prompt)) {
    return { kind: 'favorite' };
  }

  return null;
};
```

- [ ] **Step 3: Add metadata read and selection helpers**

Add after `readHighlightCandidates()`:

```js
const readHighlightMetadata = async (client, assetIds) => {
  const result = await client.call('readAssetMetadata', {
    assetIds,
    fields: highlightMetadataFields,
  });
  assertMcpResultSuccess(result, 'Asset metadata read');

  if (!Array.isArray(result.assets)) {
    throw new Error('Asset metadata read did not return assets');
  }

  return result.assets;
};

const assetRating = (asset) => {
  const rating = asset?.exifInfo?.rating;
  return typeof rating === 'number' ? rating : 0;
};

const selectMetadataHighlights = (assets, requestedCount, excludedAssetIds = new Set()) =>
  assets
    .map((asset, index) => ({ asset, index }))
    .filter(({ asset }) => typeof asset?.id === 'string' && !excludedAssetIds.has(asset.id))
    .sort((left, right) => {
      const favoriteDelta = Number(Boolean(right.asset.isFavorite)) - Number(Boolean(left.asset.isFavorite));
      if (favoriteDelta !== 0) {
        return favoriteDelta;
      }

      const ratingDelta = assetRating(right.asset) - assetRating(left.asset);
      if (ratingDelta !== 0) {
        return ratingDelta;
      }

      return left.index - right.index;
    })
    .slice(0, requestedCount)
    .map(({ asset }) => asset.id);
```

- [ ] **Step 4: Add create-album proposal helper**

Add after selection helpers:

```js
const metadataCriteriaSummary =
  'metadata-only suggested highlights prioritized existing favorites, ratings, dates, tags, and location; no previews were inspected';

const proposeMetadataHighlightAlbum = async (client, intent, selectedAssetIds) => {
  await client.call('proposeAlbumOperations', {
    summary: `Create ${intent.albumName} with ${selectedAssetIds.length} ${metadataCriteriaSummary}.`,
    operations: [
      {
        type: 'album.create',
        summary: `Create ${intent.albumName}`,
        targetKind: 'new_album',
        temporaryTargetId: intent.temporaryTargetId,
        riskLevel: 'low',
        enabled: true,
        payload: {
          albumName: intent.albumName,
          description: 'Suggested highlights selected from metadata signals. No previews were inspected.',
        },
      },
      {
        type: 'album.addAssets',
        summary: `Add ${selectedAssetIds.length} metadata-only suggested highlights to ${intent.albumName}.`,
        targetKind: 'new_album',
        temporaryTargetId: intent.temporaryTargetId,
        assetIds: selectedAssetIds,
        riskLevel: 'medium',
        enabled: true,
        payload: {},
      },
    ],
  });
};
```

- [ ] **Step 5: Parse plan intent before the candidate search**

In the highlight branch, after the unresolved-source check and before `try {`, add:

```js
const planIntent = parseHighlightPlanIntent(prompt);
const planCandidateLimit = planIntent ? metadataHighlightCandidateLimit : highlightPrompt.effectiveCount;
```

Inside the `try` block, replace the existing candidate read:

```js
const { candidateCount } = await readHighlightCandidates(client, highlightPrompt);
```

with:

```js
const { assetIds, candidateCount } = await readHighlightCandidates(client, highlightPrompt, planCandidateLimit);
```

- [ ] **Step 6: Use metadata planning for create-album highlight prompts**

In the highlight branch, after the candidate-count guard and before the current read-only completion, add:

```js
          if (planIntent?.kind === 'create-album') {
            const metadataAssets = await readHighlightMetadata(client, assetIds);
            const selectedAssetIds = selectMetadataHighlights(metadataAssets, highlightPrompt.effectiveCount);
            if (selectedAssetIds.length === 0) {
              yield completedEvent({
                gallerySessionId,
                runnerSessionId,
                text: 'I found no eligible metadata candidates in that bounded source, so I did not create a plan.',
              });
              return;
            }

            await proposeMetadataHighlightAlbum(client, planIntent, selectedAssetIds);
            const shortage =
              selectedAssetIds.length < highlightPrompt.effectiveCount
                ? ` Only ${selectedAssetIds.length} eligible candidates were available, though you requested ${highlightPrompt.effectiveCount}.`
                : '';
            yield completedEvent({
              gallerySessionId,
              runnerSessionId,
              text: `I proposed ${selectedAssetIds.length} suggested highlights using metadata-only criteria. Review the plan before applying it.${shortage}`,
            });
            return;
          }
```

- [ ] **Step 7: Run agent-runner tests**

Run:

```bash
pnpm --dir agent-runner test
```

Expected: create-album and fewer-candidate tests pass. Existing-album and favorite tests still fail until later tasks implement those plan kinds.

## Task 3: Implement Existing-Album Highlight Adds

**Files:**

- Modify: `agent-runner/src/e2e-runtime.mjs`
- Test: `agent-runner/src/e2e-runtime.test.mjs`

- [ ] **Step 1: Add existing album resolver and proposal helper**

Add after `proposeMetadataHighlightAlbum()`:

```js
const resolveExistingAlbum = async (client, targetAlbumName) => {
  const result = await client.call('listAlbums', {});
  assertMcpResultSuccess(result, 'Album list');
  const matches = Array.isArray(result.albums)
    ? result.albums.filter((album) => album?.albumName?.toLowerCase() === targetAlbumName.toLowerCase())
    : [];

  if (matches.length !== 1) {
    return { status: 'needs-clarification', matchCount: matches.length };
  }

  const albumResult = await client.call('readAlbum', { albumId: matches[0].id });
  assertMcpResultSuccess(albumResult, 'Album read');
  return { status: 'resolved', album: albumResult.album };
};

const proposeMetadataHighlightAlbumAdd = async (client, album, selectedAssetIds) => {
  await client.call('proposeAlbumOperations', {
    summary: `Add ${selectedAssetIds.length} ${metadataCriteriaSummary} to ${album.albumName}.`,
    operations: [
      {
        type: 'album.addAssets',
        summary: `Add ${selectedAssetIds.length} metadata-only suggested highlights to ${album.albumName}.`,
        targetKind: 'existing_album',
        targetId: album.id,
        assetIds: selectedAssetIds,
        riskLevel: 'medium',
        enabled: true,
        payload: {},
      },
    ],
  });
};
```

- [ ] **Step 2: Resolve the target album before the candidate search**

Resolve the target album before `readHighlightCandidates()` so ambiguous or missing target albums fail before source reads, and so duplicate IDs are available for selection. Replace the candidate-read line added in Task 2:

```js
const { assetIds, candidateCount } = await readHighlightCandidates(client, highlightPrompt, planCandidateLimit);
```

with:

```js
          let targetAlbum = null;
          let existingIds = new Set();

          if (planIntent?.kind === 'add-to-album') {
            const resolution = await resolveExistingAlbum(client, planIntent.targetAlbumName);
            if (resolution.status !== 'resolved') {
              yield completedEvent({
                gallerySessionId,
                runnerSessionId,
                text: `I need one matching album named ${planIntent.targetAlbumName} before adding highlights. Which album should I use?`,
              });
              return;
            }

            targetAlbum = resolution.album;
            existingIds = new Set(Array.isArray(targetAlbum.assetIds) ? targetAlbum.assetIds : []);
          }

          const { assetIds, candidateCount } = await readHighlightCandidates(client, highlightPrompt, planCandidateLimit);
```

- [ ] **Step 3: Add existing-album branch before create-album branch**

Inside the candidate-count guarded section, before the create-album branch, add:

```js
          if (planIntent?.kind === 'add-to-album') {
            const metadataAssets = await readHighlightMetadata(client, assetIds);
            const selectedAssetIds = selectMetadataHighlights(metadataAssets, highlightPrompt.effectiveCount, existingIds);
            if (selectedAssetIds.length === 0) {
              yield completedEvent({
                gallerySessionId,
                runnerSessionId,
                text: `I found no eligible metadata candidates outside ${targetAlbum.albumName}, so I did not create a plan.`,
              });
              return;
            }

            await proposeMetadataHighlightAlbumAdd(client, targetAlbum, selectedAssetIds);
            const excludedCount = assetIds.filter((id) => existingIds.has(id)).length;
            const excludedText =
              excludedCount > 0 ? ` I excluded ${excludedCount} already in ${targetAlbum.albumName}.` : '';
            yield completedEvent({
              gallerySessionId,
              runnerSessionId,
              text: `I proposed ${selectedAssetIds.length} metadata-only suggested highlights for ${targetAlbum.albumName}.${excludedText} Review the plan before applying it.`,
            });
            return;
          }
```

- [ ] **Step 4: Run agent-runner tests**

Run:

```bash
pnpm --dir agent-runner test
```

Expected: existing-album test passes. Favorite test still fails until Task 4.

## Task 4: Implement Favorite Highlight Plans

**Files:**

- Modify: `agent-runner/src/e2e-runtime.mjs`
- Test: `agent-runner/src/e2e-runtime.test.mjs`

- [ ] **Step 1: Add favorite proposal helper**

Add after `proposeMetadataHighlightAlbumAdd()`:

```js
const proposeMetadataHighlightFavorites = async (client, selectedAssetIds) => {
  await client.call('proposeAlbumOperations', {
    summary: `Favorite ${selectedAssetIds.length} ${metadataCriteriaSummary}.`,
    operations: [
      {
        type: 'asset.setFavorite',
        summary: `Favorite ${selectedAssetIds.length} metadata-only suggested highlights.`,
        targetKind: 'asset_batch',
        assetIds: selectedAssetIds,
        riskLevel: 'low',
        enabled: true,
        payload: { favorite: true },
      },
    ],
  });
};
```

- [ ] **Step 2: Add favorite branch before create-album branch**

Inside the candidate-count guarded section, after the existing-album branch and before create-album branch, add:

```js
          if (planIntent?.kind === 'favorite') {
            const metadataAssets = await readHighlightMetadata(client, assetIds);
            const selectedAssetIds = selectMetadataHighlights(metadataAssets, highlightPrompt.effectiveCount);
            if (selectedAssetIds.length === 0) {
              yield completedEvent({
                gallerySessionId,
                runnerSessionId,
                text: 'I found no eligible metadata candidates to favorite, so I did not create a plan.',
              });
              return;
            }

            await proposeMetadataHighlightFavorites(client, selectedAssetIds);
            yield completedEvent({
              gallerySessionId,
              runnerSessionId,
              text: `I proposed favorite operations for ${selectedAssetIds.length} metadata-only suggested highlights. Review the plan before applying it.`,
            });
            return;
          }
```

- [ ] **Step 3: Run agent-runner tests**

Run:

```bash
pnpm --dir agent-runner test
```

Expected: all e2e metadata-only highlight planning tests pass.

## Task 5: Update Real Pi Prompt Guidance

**Files:**

- Modify: `agent-runner/src/pi-runtime.test.mjs`
- Modify: `agent-runner/src/pi-runtime.mjs`
- Test: `agent-runner/src/pi-runtime.test.mjs`

- [ ] **Step 1: Add failing prompt assertions**

In `it('constructs the Pi resource loader with concrete runtime paths', ...)`, replace the Slice 2 read-only assertion:

```js
assert.equal(
  calls.loaders[0].systemPrompt.includes(
    'Slice 2 is read-only: do not create album, favorite, or cover plans for highlight requests yet',
  ),
  true,
);
assert.equal(calls.loaders[0].systemPrompt.includes('Except for best/highlight requests during Slice 2'), true);
```

with:

```js
assert.equal(calls.loaders[0].systemPrompt.includes('metadata-only suggested highlights'), true);
assert.equal(calls.loaders[0].systemPrompt.includes('prioritize existing favorites and ratings'), true);
assert.equal(calls.loaders[0].systemPrompt.includes('selected assetIds only'), true);
assert.equal(calls.loaders[0].systemPrompt.includes('do not use broad assetSource'), true);
assert.equal(
  calls.loaders[0].systemPrompt.includes('No previews are required for metadata-only highlight plans'),
  true,
);
assert.equal(calls.loaders[0].systemPrompt.includes('Slice 2 is read-only'), false);
assert.equal(calls.loaders[0].systemPrompt.includes('Except for best/highlight requests during Slice 2'), false);
```

- [ ] **Step 2: Run prompt test and verify red**

Run:

```bash
node --test agent-runner/src/pi-runtime.test.mjs
```

Expected: FAIL because the current Pi prompt still says Slice 2 is read-only and does not include the new metadata-only planning guidance.

- [ ] **Step 3: Update `runnerBehaviorPrompt`**

Replace the Slice 2 highlight prompt line and the album exception line with:

```js
  'For best/highlight requests, require a bounded source; default to 10 only when the source is bounded and no count is specified; zero, negative, or above 500 counts ask for a valid smaller count; ask to narrow only when known count or total is above 500. No matching highlight candidates: answer directly and do not create a plan.',
  'For metadata-only suggested highlights, search bounded candidate ids, read mcp_gallery_readAssetMetadata for favorites, ratings, dates, tags, and location, prioritize existing favorites and ratings, disclose that no previews were inspected, and create reviewable album/favorite plans only when requested.',
  'After metadata-only curation narrows candidates, propose writes with selected assetIds only; do not use broad assetSource or previousSearch sources for curated highlight write plans.',
  'No previews are required for metadata-only highlight plans. Use mcp_gallery_readAssetPreviews later only for preview-assisted curation when allowed and the bounded candidate set is small.',
  'When a user asks you to create or fill an album and metadata candidates are found, call mcp_gallery_proposeAlbumOperations with album.create and album.addAssets operations. A chat-only answer is not enough for album creation requests.',
```

- [ ] **Step 4: Run prompt test and verify green**

Run:

```bash
node --test agent-runner/src/pi-runtime.test.mjs
```

Expected: PASS.

## Task 6: Focused Verification And Commit

**Files:**

- Test: `agent-runner/src/e2e-runtime.test.mjs`
- Test: `agent-runner/src/pi-runtime.test.mjs`

- [ ] **Step 1: Run the full agent-runner suite**

Run:

```bash
pnpm --dir agent-runner test
```

Expected: PASS, including the new metadata-only highlight planning tests.

- [ ] **Step 2: Run diff whitespace checks**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 3: Inspect final diff for scope creep**

Run:

```bash
git diff -- agent-runner/src/e2e-runtime.mjs agent-runner/src/e2e-runtime.test.mjs agent-runner/src/pi-runtime.mjs agent-runner/src/pi-runtime.test.mjs docs/superpowers/plans/2026-05-26-pi-agent-highlight-curation-slice-3.md
```

Expected:

- No calls to `readAssetPreviews` or `readAssetOriginals`.
- No `album.setCover` operations added.
- No `assetSource` or `previousSearch` is used by curated highlight write plans.
- `proposeAlbumOperations` operations use explicit selected `assetIds`.
- Plan summaries disclose metadata-only criteria and no preview inspection.
- Slice 2 guardrails still create no plan for unbounded, invalid-count, oversized, and no-candidate paths.

- [ ] **Step 4: Commit**

Run:

```bash
git status --short
git add agent-runner/src/e2e-runtime.mjs agent-runner/src/e2e-runtime.test.mjs agent-runner/src/pi-runtime.mjs agent-runner/src/pi-runtime.test.mjs docs/superpowers/plans/2026-05-26-pi-agent-highlight-curation-slice-3.md
git commit -m "feat: add metadata highlight planning"
```

Expected: commit succeeds.

## Self-Review Checklist

- Create-highlights-album prompt proposes `album.create` plus `album.addAssets`.
- Existing-album prompt resolves the album, reads current album asset IDs, excludes duplicates, and proposes only new selected IDs.
- Favorite prompt proposes `asset.setFavorite` with `targetKind: "asset_batch"`.
- All curated write operations use explicit selected `assetIds`.
- No curated write operation includes `assetSource`, `previousSearch`, or broad search materialization.
- Favorites outrank raw rating in deterministic metadata selection.
- Fewer-candidates-than-requested creates a plan for available candidates and states the actual count.
- No preview, original, cover, UI, sparse apply, capability matrix completion, or acceptance E2E work is included.
- Real Pi prompt now describes metadata-only highlight planning and no longer says Slice 2 is read-only.
