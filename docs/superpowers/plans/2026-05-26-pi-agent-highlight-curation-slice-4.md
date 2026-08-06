# Pi Agent Highlight Curation Slice 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add preview-assisted highlight planning and album cover suggestions while preserving metadata-only fallback and the no-originals rule.

**Architecture:** Extend the e2e runner highlight planning path so preview-capable sessions inspect previews for bounded write-intent curation only after candidate IDs are known and within the preview limit. Cover suggestions use existing album resolution, album asset IDs, metadata, optional previews, and a single `album.setCover` operation. Real Pi behavior is guided through prompt instructions for preview limits, preview denial/provider fallback, cover proposals, and never reading originals for curation.

**Tech Stack:** Node ESM runner, Node built-in test runner, Gallery MCP JSON-RPC tool calls.

---

## Scope Boundaries

This plan implements only Slice 4 from `docs/superpowers/specs/2026-05-26-pi-agent-highlight-curation-design.md`.

In scope:

- Preview-assisted highlight selection for bounded write-intent highlight prompts when the e2e session indicates image input is available.
- Candidate set above the preview limit asks the user to narrow before preview-assisted planning.
- Preview-denied or preview-unavailable flows fall back to metadata-only planning with disclosure. `approval-required` remains governed by the existing Pi approval-pause rule and is not treated as denial in this slice.
- Provider-without-image-input flow remains metadata-only and does not call `readAssetPreviews`.
- Existing album cover suggestion flow with exactly one `album.setCover` operation.
- Tests proving `readAssetOriginals` is not called for highlight or cover curation.
- Pi prompt guidance for previews, cover suggestions, fallback, and no originals.

Out of scope:

- No new server-side image scoring, `analyzeAssetQuality`, duplicate clustering, or original reads.
- No UI or sparse apply changes. Slice 5 owns those.
- No capability matrix completion or final acceptance E2E. Slice 6 owns those.
- No unresolved `this album` context. Deterministic e2e cover flow resolves named albums only.

## Files

- Modify: `agent-runner/src/e2e-runtime.test.mjs`
  - Add preview fixture handlers and tests for preview-assisted highlight album planning, preview limit narrowing, preview-denied metadata fallback, provider-without-image-input metadata fallback, cover selection, cover preview fallback, cover no-image fallback, cover limit narrowing, both named cover prompt forms, and no originals.
- Modify: `agent-runner/src/e2e-runtime.mjs`
  - Store a deterministic `supportsImageInput` flag in sessions, add preview read helpers, use preview limit for preview-capable highlight plans, add cover prompt parsing and cover proposal helpers.
- Modify: `agent-runner/src/pi-runtime.mjs`
  - Update prompt guidance for preview-assisted curation, cover suggestions, preview fallback, provider image-input fallback, and no originals.
- Modify: `agent-runner/src/pi-runtime.test.mjs`
  - Assert the new prompt guidance appears.

## Deterministic Slice 4 Behavior

Preview-assisted e2e behavior is opt-in. `createSessionBody()` defaults to no image input support. Tests that need preview assistance pass:

```js
createSessionBody({ initialContext: { providerSupportsImages: true } });
```

The e2e runtime stores:

```js
supportsImageInput:
  body.initialContext?.providerSupportsImages === true ||
  body.credential?.supportsImageInput === true ||
  body.credential?.capabilities?.imageInput === true,
```

Use:

```js
const previewHighlightCandidateLimit = 250;
```

For highlight write intents:

- Preview-capable sessions search with `limit: 250`.
- Metadata-only sessions keep the Slice 3 `limit: 500`.
- If a preview-capable source returns `hasMore: true` at `250`, ask to narrow and make no preview or plan calls.
- If previews return `status: "denied"` or `status: "unavailable"`, continue metadata-only and disclose preview fallback.
- If previews return `status: "approval-required"`, do not treat it as denial. Leave approval pausing to the existing Pi runtime approval behavior; deterministic e2e fallback tests use `denied`.
- Preview-assisted deterministic selection may still use the existing metadata ranker; the test proves previews are requested and disclosed, not that e2e can visually score images.

For cover prompts:

- Supported deterministic prompt forms:
  - `Pick a better cover for Family.`
  - `Pick a cover for Family.`
- Resolve the named album with `listAlbums` and `readAlbum`.
- If the album has no assets, answer directly and create no plan.
- If the album has more than `250` assets in a preview-capable session, ask to narrow before preview-assisted cover selection.
- Read metadata for album asset IDs, read previews only when supported and within limit, then select one asset with the same favorite/rating order.
- Propose exactly one `album.setCover` operation with one selected asset ID.

## Task 1: Add Preview And Cover Red Tests

**Files:**

- Modify: `agent-runner/src/e2e-runtime.test.mjs`
- Test: `agent-runner/src/e2e-runtime.test.mjs`

- [ ] **Step 1: Add preview fixture helpers**

Add after `metadataHighlightHandlers()`:

```js
const previewReference = (assetId) => ({
  assetId,
  mediaUrl: `/api/assets/${assetId}/thumbnail?size=preview`,
  mimeType: 'image/jpeg',
  fileName: `${assetId}.jpg`,
  width: 1024,
  height: 768,
});

const previewHighlightHandlers = (options = {}) => {
  const handlers = metadataHighlightHandlers(options);
  return [
    handlers[0],
    handlers[1],
    {
      name: 'readAssetPreviews',
      handle: (args, request) => ({
        body: {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            structuredContent: {
              previews: args.assetIds.map(previewReference),
            },
          },
        },
      }),
    },
    handlers[2],
    handlers[3],
    handlers[4],
  ];
};
```

- [ ] **Step 2: Add preview-assisted highlight album test**

Add after the existing metadata-only highlight album tests:

```js
it('reads previews after bounded candidates for preview-assisted highlight album planning', async () => {
  const { calls, fetchImplementation } = createFetch(previewHighlightHandlers());
  const runtime = createE2eRuntime({ fetch: fetchImplementation });
  await runtime.createSession(createSessionBody({ initialContext: { providerSupportsImages: true } }));

  const events = await collectEvents(
    runtime,
    'Pick the best 2 photos from last weekend and make an album called Weekend Highlights.',
  );

  assert.equal(
    calls.map((call) => call.body.params.name).join(','),
    'searchAssets,readAssetMetadata,readAssetPreviews,proposeAlbumOperations',
  );
  assert.equal(calls[0].body.params.arguments.limit, 250);
  assert.deepEqual(calls[2].body.params.arguments, { assetIds: highlightAssetIds });
  const plan = calls[3].body.params.arguments;
  assert.match(plan.summary, /preview-assisted/i);
  assert.equal(JSON.stringify(plan).includes('readAssetOriginals'), false);
  assert.deepEqual(plan.operations[1].assetIds, [
    '00000000-0000-4000-8000-000000000402',
    '00000000-0000-4000-8000-000000000403',
  ]);
  assert.match(events.at(-1).content.blocks[0].text, /preview-assisted/i);
});
```

- [ ] **Step 3: Add preview limit narrowing test**

Add:

```js
it('asks to narrow before preview-assisted highlight planning above the preview limit', async () => {
  const oversizedAssetIds = Array.from(
    { length: 251 },
    (_value, index) => `00000000-0000-4000-8000-${String(2000 + index).padStart(12, '0')}`,
  );
  const { calls, fetchImplementation } = createFetch(previewHighlightHandlers({ assetIds: oversizedAssetIds }));
  const runtime = createE2eRuntime({ fetch: fetchImplementation });
  await runtime.createSession(createSessionBody({ initialContext: { providerSupportsImages: true } }));

  const events = await collectEvents(
    runtime,
    'Pick the best 2 photos from last weekend and make an album called Weekend Highlights.',
  );

  assert.equal(calls.map((call) => call.body.params.name).join(','), 'searchAssets');
  assert.equal(calls[0].body.params.arguments.limit, 250);
  assert.match(events.at(-1).content.blocks[0].text, /too many/i);
  assert.match(events.at(-1).content.blocks[0].text, /narrow/i);
});
```

- [ ] **Step 4: Add preview-denied fallback test**

Add:

```js
it('falls back to metadata-only highlights when preview reads are denied', async () => {
  const handlers = previewHighlightHandlers();
  handlers[2] = {
    name: 'readAssetPreviews',
    handle: (_args, request) => ({
      body: {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          structuredContent: {
            status: 'denied',
            summary: 'Preview reads are denied in this session',
          },
        },
      },
    }),
  };
  const { calls, fetchImplementation } = createFetch(handlers);
  const runtime = createE2eRuntime({ fetch: fetchImplementation });
  await runtime.createSession(createSessionBody({ initialContext: { providerSupportsImages: true } }));

  const events = await collectEvents(
    runtime,
    'Pick the best 2 photos from last weekend and make an album called Weekend Highlights.',
  );

  assert.equal(
    calls.map((call) => call.body.params.name).join(','),
    'searchAssets,readAssetMetadata,readAssetPreviews,proposeAlbumOperations',
  );
  assert.match(calls.at(-1).body.params.arguments.summary, /metadata-only/i);
  assert.match(events.at(-1).content.blocks[0].text, /previews were unavailable/i);
});
```

- [ ] **Step 5: Add provider-without-image-input fallback test**

Add:

```js
it('keeps provider-without-image-input highlight planning metadata-only without preview reads', async () => {
  const { calls, fetchImplementation } = createFetch(previewHighlightHandlers());
  const runtime = createE2eRuntime({ fetch: fetchImplementation });
  await runtime.createSession(createSessionBody({ initialContext: { providerSupportsImages: false } }));

  const events = await collectEvents(
    runtime,
    'Pick the best 2 photos from last weekend and make an album called Weekend Highlights.',
  );

  assert.equal(
    calls.map((call) => call.body.params.name).join(','),
    'searchAssets,readAssetMetadata,proposeAlbumOperations',
  );
  assert.match(calls.at(-1).body.params.arguments.summary, /metadata-only/i);
  assert.match(events.at(-1).content.blocks[0].text, /metadata-only/i);
});
```

- [ ] **Step 6: Add cover suggestion test**

Add:

```js
it('proposes exactly one preview-assisted album cover operation from a named album', async () => {
  const albums = [familyAlbumSummary()];
  const { calls, fetchImplementation } = createFetch(
    previewHighlightHandlers({
      albums,
      albumAssetIds: highlightAssetIds,
    }),
  );
  const runtime = createE2eRuntime({ fetch: fetchImplementation });
  await runtime.createSession(createSessionBody({ initialContext: { providerSupportsImages: true } }));

  const events = await collectEvents(runtime, 'Pick a better cover for Family.');

  assert.equal(
    calls.map((call) => call.body.params.name).join(','),
    'listAlbums,readAlbum,readAssetMetadata,readAssetPreviews,proposeAlbumOperations',
  );
  const plan = calls.at(-1).body.params.arguments;
  assert.match(plan.summary, /cover/i);
  assert.match(plan.summary, /preview-assisted/i);
  assert.deepEqual(plan.operations, [
    {
      type: 'album.setCover',
      summary: 'Set Family cover to a suggested highlight.',
      targetKind: 'existing_album',
      targetId: familyAlbumId,
      assetIds: ['00000000-0000-4000-8000-000000000402'],
      riskLevel: 'low',
      enabled: true,
      payload: {},
    },
  ]);
  assert.match(events.at(-1).content.blocks[0].text, /cover/i);
  assert.match(events.at(-1).content.blocks[0].text, /Review/i);
});
```

This expected cover ID uses the same deterministic ranker: favorite asset `402` wins.

- [ ] **Step 7: Add second supported cover prompt form test**

Add:

```js
it('supports simple named album cover prompts', async () => {
  const albums = [familyAlbumSummary()];
  const { calls, fetchImplementation } = createFetch(
    previewHighlightHandlers({
      albums,
      albumAssetIds: highlightAssetIds,
    }),
  );
  const runtime = createE2eRuntime({ fetch: fetchImplementation });
  await runtime.createSession(createSessionBody({ initialContext: { providerSupportsImages: true } }));

  await collectEvents(runtime, 'Pick a cover for Family.');

  const plan = calls.at(-1).body.params.arguments;
  assert.deepEqual(
    plan.operations.map((operation) => operation.type),
    ['album.setCover'],
  );
  assert.deepEqual(plan.operations[0].assetIds, ['00000000-0000-4000-8000-000000000402']);
});
```

- [ ] **Step 8: Add cover preview-denied fallback test**

Add:

```js
it('falls back to metadata-only cover selection when preview reads are denied', async () => {
  const albums = [familyAlbumSummary()];
  const handlers = previewHighlightHandlers({ albums, albumAssetIds: highlightAssetIds });
  handlers[2] = {
    name: 'readAssetPreviews',
    handle: (_args, request) => ({
      body: {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          structuredContent: {
            status: 'denied',
            summary: 'Preview reads are denied in this session',
          },
        },
      },
    }),
  };
  const { calls, fetchImplementation } = createFetch(handlers);
  const runtime = createE2eRuntime({ fetch: fetchImplementation });
  await runtime.createSession(createSessionBody({ initialContext: { providerSupportsImages: true } }));

  const events = await collectEvents(runtime, 'Pick a better cover for Family.');

  assert.equal(
    calls.map((call) => call.body.params.name).join(','),
    'listAlbums,readAlbum,readAssetMetadata,readAssetPreviews,proposeAlbumOperations',
  );
  assert.match(calls.at(-1).body.params.arguments.summary, /metadata-only/i);
  assert.match(events.at(-1).content.blocks[0].text, /Previews were unavailable/i);
});
```

- [ ] **Step 9: Add provider-without-image-input cover fallback test**

Add:

```js
it('keeps provider-without-image-input cover selection metadata-only without preview reads', async () => {
  const albums = [familyAlbumSummary()];
  const { calls, fetchImplementation } = createFetch(
    previewHighlightHandlers({
      albums,
      albumAssetIds: highlightAssetIds,
    }),
  );
  const runtime = createE2eRuntime({ fetch: fetchImplementation });
  await runtime.createSession(createSessionBody({ initialContext: { providerSupportsImages: false } }));

  const events = await collectEvents(runtime, 'Pick a better cover for Family.');

  assert.equal(
    calls.map((call) => call.body.params.name).join(','),
    'listAlbums,readAlbum,readAssetMetadata,proposeAlbumOperations',
  );
  assert.match(calls.at(-1).body.params.arguments.summary, /metadata-only/i);
  assert.match(events.at(-1).content.blocks[0].text, /metadata-only/i);
});
```

- [ ] **Step 10: Add cover preview limit narrowing test**

Add:

```js
it('asks to narrow cover selection when a preview-capable album exceeds the preview limit', async () => {
  const albums = [familyAlbumSummary()];
  const oversizedAssetIds = Array.from(
    { length: 251 },
    (_value, index) => `00000000-0000-4000-8000-${String(3000 + index).padStart(12, '0')}`,
  );
  const { calls, fetchImplementation } = createFetch(
    previewHighlightHandlers({
      albums,
      albumAssetIds: oversizedAssetIds,
    }),
  );
  const runtime = createE2eRuntime({ fetch: fetchImplementation });
  await runtime.createSession(createSessionBody({ initialContext: { providerSupportsImages: true } }));

  const events = await collectEvents(runtime, 'Pick a better cover for Family.');

  assert.equal(calls.map((call) => call.body.params.name).join(','), 'listAlbums,readAlbum');
  assert.match(events.at(-1).content.blocks[0].text, /too many assets/i);
  assert.match(events.at(-1).content.blocks[0].text, /narrow/i);
});
```

- [ ] **Step 11: Add no-originals guard test**

Add:

```js
it('never reads originals for highlight or cover curation', async () => {
  const albums = [familyAlbumSummary()];
  const { calls, fetchImplementation } = createFetch([
    ...previewHighlightHandlers({ albums, albumAssetIds: highlightAssetIds }),
    {
      name: 'readAssetOriginals',
      handle: (_args, request) => ({
        body: {
          jsonrpc: '2.0',
          id: request.id,
          result: { structuredContent: { originals: [] } },
        },
      }),
    },
  ]);
  const runtime = createE2eRuntime({ fetch: fetchImplementation });
  await runtime.createSession(createSessionBody({ initialContext: { providerSupportsImages: true } }));

  await collectEvents(runtime, 'Pick the best 2 photos from last weekend and make an album called Weekend Highlights.');
  await collectEvents(runtime, 'Pick a better cover for Family.');

  assert.equal(
    calls.some((call) => call.body.params.name === 'readAssetOriginals'),
    false,
  );
});
```

- [ ] **Step 12: Run agent-runner tests and verify red**

Run:

```bash
pnpm --dir agent-runner test
```

Expected: FAIL. The new tests should fail because the e2e runtime does not store image-input support, call `readAssetPreviews`, parse cover prompts, or propose cover operations yet.

## Task 2: Implement Preview Helpers And Session Image Support

**Files:**

- Modify: `agent-runner/src/e2e-runtime.mjs`
- Test: `agent-runner/src/e2e-runtime.test.mjs`

- [ ] **Step 1: Add preview limit and image support helper**

Add after `metadataHighlightCandidateLimit`:

```js
const previewHighlightCandidateLimit = 250;
```

Add near helper functions:

```js
const sessionSupportsImageInput = (body) =>
  body.initialContext?.providerSupportsImages === true ||
  body.credential?.supportsImageInput === true ||
  body.credential?.capabilities?.imageInput === true;
```

In `createSession()`, store:

```js
supportsImageInput: sessionSupportsImageInput(body),
```

- [ ] **Step 2: Make candidate counting use the active limit**

Change `highlightCandidateCount()` signature:

```js
const highlightCandidateCount = (result, assetIds, candidateLimit = metadataHighlightCandidateLimit) => {
```

Change the full-page `hasMore` guard:

```js
if (
  result.hasMore === true &&
  candidateLimit >= previewHighlightCandidateLimit &&
  (result.returnedCount ?? assetIds.length) >= candidateLimit
) {
  return candidateLimit + 1;
}
```

Change `readHighlightCandidates()` return:

```js
    candidateCount: highlightCandidateCount(result, assetIds, limit),
```

- [ ] **Step 3: Add preview read helper**

Add after `readHighlightMetadata()`:

```js
const readHighlightPreviews = async (client, assetIds) => {
  const result = await client.call('readAssetPreviews', { assetIds });
  if (result.status === 'denied' || result.status === 'unavailable') {
    return { status: 'unavailable', reason: result.status };
  }

  assertMcpResultSuccess(result, 'Asset preview read');

  if (!Array.isArray(result.previews)) {
    throw new Error('Asset preview read did not return previews');
  }

  return { status: 'available', previews: result.previews };
};
```

- [ ] **Step 4: Add criteria summary helper**

Replace:

```js
const metadataCriteriaSummary =
  'metadata-only suggested highlights prioritized existing favorites, ratings, dates, tags, and location; no previews were inspected';
```

with:

```js
const highlightCriteriaSummary = (mode) =>
  mode === 'preview-assisted'
    ? 'preview-assisted suggested highlights considered previews, existing favorites, ratings, dates, tags, and location'
    : 'metadata-only suggested highlights prioritized existing favorites, ratings, dates, tags, and location; no previews were inspected';
```

Update proposal helpers to accept `criteriaMode` and call `highlightCriteriaSummary(criteriaMode)`.

For example:

```js
const proposeMetadataHighlightAlbum = async (client, intent, selectedAssetIds, criteriaMode = 'metadata-only') => {
  const criteriaSummary = highlightCriteriaSummary(criteriaMode);
  await client.call('proposeAlbumOperations', {
    summary: `Create ${intent.albumName} with ${selectedAssetIds.length} ${criteriaSummary}.`,
```

Update add/favorite helper signatures similarly.

- [ ] **Step 5: Run focused tests**

Run:

```bash
node --test agent-runner/src/e2e-runtime.test.mjs
```

Expected: still FAIL. Session storage and helpers exist, but highlight planning does not use previews yet and cover prompts are not implemented.

## Task 3: Use Previews For Highlight Write Plans

**Files:**

- Modify: `agent-runner/src/e2e-runtime.mjs`
- Test: `agent-runner/src/e2e-runtime.test.mjs`

- [ ] **Step 1: Compute preview mode and active candidate limit**

In the highlight branch, replace:

```js
const planCandidateLimit = planIntent ? metadataHighlightCandidateLimit : highlightPrompt.effectiveCount;
```

with:

```js
const usePreviewAssistedCuration = Boolean(planIntent && entry.supportsImageInput);
const planCandidateLimit = planIntent
  ? usePreviewAssistedCuration
    ? previewHighlightCandidateLimit
    : metadataHighlightCandidateLimit
  : highlightPrompt.effectiveCount;
const activeCandidateLimit = usePreviewAssistedCuration
  ? previewHighlightCandidateLimit
  : metadataHighlightCandidateLimit;
```

Change the candidate limit check:

```js
if (candidateCount > activeCandidateLimit) {
  yield completedEvent({
    gallerySessionId,
    runnerSessionId,
    text: usePreviewAssistedCuration
      ? 'That source has too many candidate assets for preview-assisted curation. Please narrow the album, space, date range, search/filter, or selected photos.'
      : 'That source has too many candidate assets for this metadata-only highlight pass. Please narrow the album, space, date range, search/filter, or selected photos.',
  });
  return;
}
```

- [ ] **Step 2: Add curation-context helper inside the highlight branch**

After the candidate-count check, add:

```js
const readCurationContext = async () => {
  const metadataAssets = await readHighlightMetadata(client, assetIds);
  if (!usePreviewAssistedCuration) {
    return { metadataAssets, criteriaMode: 'metadata-only', previewUnavailable: false };
  }

  const previewResult = await readHighlightPreviews(client, assetIds);
  if (previewResult.status !== 'available') {
    return { metadataAssets, criteriaMode: 'metadata-only', previewUnavailable: true };
  }

  return { metadataAssets, criteriaMode: 'preview-assisted', previewUnavailable: false };
};
```

- [ ] **Step 3: Use curation context in add/favorite/create branches**

Replace each direct:

```js
const metadataAssets = await readHighlightMetadata(client, assetIds);
```

with:

```js
const { metadataAssets, criteriaMode, previewUnavailable } = await readCurationContext();
```

Pass `criteriaMode` to the proposal helper. Add preview-unavailable disclosure to completed text:

```js
const previewFallbackText = previewUnavailable ? ' Previews were unavailable, so I used metadata-only criteria.' : '';
```

For create-album completion, use:

```js
text: `I proposed ${selectedAssetIds.length} suggested highlights using ${criteriaMode} criteria. Review the plan before applying it.${shortage}${previewFallbackText}`,
```

For add/favorite completions, include `${previewFallbackText}` before ` Review...`.

- [ ] **Step 4: Run focused tests**

Run:

```bash
node --test agent-runner/src/e2e-runtime.test.mjs
```

Expected: preview-assisted highlight tests pass. Cover tests still fail until Task 4.

## Task 4: Implement Cover Suggestion Flow

**Files:**

- Modify: `agent-runner/src/e2e-runtime.mjs`
- Test: `agent-runner/src/e2e-runtime.test.mjs`

- [ ] **Step 1: Add cover prompt parser**

Add after `parseHighlightPlanIntent()`:

```js
const parseCoverPrompt = (prompt) => {
  if (!/\bcover\b/i.test(prompt)) {
    return null;
  }

  const namedAlbum = prompt.match(/\bcover\s+(?:for|from)\s+([A-Za-z][A-Za-z0-9 '&-]*?)\.?$/i);
  if (namedAlbum) {
    return { targetAlbumName: stripTrailingSourcePhrase(namedAlbum[1]) };
  }

  return { targetAlbumName: null };
};
```

- [ ] **Step 2: Add cover proposal helper**

Add after favorite proposal helper:

```js
const proposeAlbumCover = async (client, album, assetId, criteriaMode) => {
  const criteriaSummary = highlightCriteriaSummary(criteriaMode);
  await client.call('proposeAlbumOperations', {
    summary: `Set ${album.albumName} cover using one ${criteriaSummary}.`,
    operations: [
      {
        type: 'album.setCover',
        summary: `Set ${album.albumName} cover to a suggested highlight.`,
        targetKind: 'existing_album',
        targetId: album.id,
        assetIds: [assetId],
        riskLevel: 'low',
        enabled: true,
        payload: {},
      },
    ],
  });
};
```

- [ ] **Step 3: Add cover branch before highlight branch**

After metadata prompt guards and before `const highlightPrompt = parseHighlightPrompt(prompt);`, add:

```js
const coverPrompt = parseCoverPrompt(prompt);
if (coverPrompt) {
  if (!coverPrompt.targetAlbumName) {
    yield completedEvent({
      gallerySessionId,
      runnerSessionId,
      text: 'Please name the album before I suggest a cover.',
    });
    return;
  }

  try {
    const resolution = await resolveExistingAlbum(client, coverPrompt.targetAlbumName);
    if (resolution.status !== 'resolved') {
      yield completedEvent({
        gallerySessionId,
        runnerSessionId,
        text: `I need one matching album named ${coverPrompt.targetAlbumName} before suggesting a cover. Which album should I use?`,
      });
      return;
    }

    const albumAssetIds = Array.isArray(resolution.album.assetIds) ? resolution.album.assetIds : [];
    if (albumAssetIds.length === 0) {
      yield completedEvent({
        gallerySessionId,
        runnerSessionId,
        text: `I found no assets in ${resolution.album.albumName}, so I did not create a cover plan.`,
      });
      return;
    }

    const usePreviewAssistedCover = entry.supportsImageInput;
    if (usePreviewAssistedCover && albumAssetIds.length > previewHighlightCandidateLimit) {
      yield completedEvent({
        gallerySessionId,
        runnerSessionId,
        text: 'That album has too many assets for preview-assisted cover selection. Please narrow the source or choose a smaller album.',
      });
      return;
    }

    const metadataAssets = await readHighlightMetadata(client, albumAssetIds);
    let criteriaMode = 'metadata-only';
    let previewUnavailable = false;
    if (usePreviewAssistedCover) {
      const previewResult = await readHighlightPreviews(client, albumAssetIds);
      if (previewResult.status === 'available') {
        criteriaMode = 'preview-assisted';
      } else {
        previewUnavailable = true;
      }
    }

    const [selectedCoverId] = selectMetadataHighlights(metadataAssets, 1);
    if (!selectedCoverId) {
      yield completedEvent({
        gallerySessionId,
        runnerSessionId,
        text: `I found no eligible assets in ${resolution.album.albumName}, so I did not create a cover plan.`,
      });
      return;
    }

    await proposeAlbumCover(client, resolution.album, selectedCoverId, criteriaMode);
    const previewFallbackText = previewUnavailable ? ' Previews were unavailable, so I used metadata-only criteria.' : '';
    yield completedEvent({
      gallerySessionId,
      runnerSessionId,
      text: `I proposed a ${criteriaMode} cover suggestion for ${resolution.album.albumName}.${previewFallbackText} Review the plan before applying it.`,
    });
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    yield completedEvent({
      gallerySessionId,
      runnerSessionId,
      text: `Gallery could not inspect cover candidates: ${redactGatewayToken(message, gateway)}`,
    });
    return;
  }
}
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
node --test agent-runner/src/e2e-runtime.test.mjs
```

Expected: PASS.

## Task 5: Update Pi Prompt Guidance

**Files:**

- Modify: `agent-runner/src/pi-runtime.test.mjs`
- Modify: `agent-runner/src/pi-runtime.mjs`
- Test: `agent-runner/src/pi-runtime.test.mjs`

- [ ] **Step 1: Add failing prompt assertions**

In `it('constructs the Pi resource loader with concrete runtime paths', ...)`, after the existing assertion for `No previews are required for metadata-only highlight plans`, add:

```js
assert.equal(
  calls.loaders[0].systemPrompt.includes(
    'Preview-assisted highlight requests use mcp_gallery_readAssetPreviews only after bounded candidate ids are known',
  ),
  true,
);
assert.equal(calls.loaders[0].systemPrompt.includes('above 250 preview candidates'), true);
assert.equal(
  calls.loaders[0].systemPrompt.includes('If previews are denied or the provider cannot inspect images'),
  true,
);
assert.equal(
  calls.loaders[0].systemPrompt.includes('Cover suggestions use album.setCover with exactly one selected assetId'),
  true,
);
assert.equal(
  calls.loaders[0].systemPrompt.includes('Never call mcp_gallery_readAssetOriginals for highlight or cover curation'),
  true,
);
```

- [ ] **Step 2: Run prompt test and verify red**

Run:

```bash
node --test agent-runner/src/pi-runtime.test.mjs
```

Expected: FAIL because the prompt does not yet contain Slice 4 preview and cover guidance.

- [ ] **Step 3: Update `runnerBehaviorPrompt`**

Add these lines after the current metadata-only highlight guidance:

```js
  'Preview-assisted highlight requests use mcp_gallery_readAssetPreviews only after bounded candidate ids are known and candidate count is 250 or fewer; above 250 preview candidates, ask the user to narrow before preview-assisted curation.',
  'If previews are denied or the provider cannot inspect images, continue with metadata-only highlight criteria when that satisfies the request, disclose the fallback, or ask one concise clarification.',
  'Cover suggestions use album.setCover with exactly one selected assetId from the resolved album. Prefer previews when allowed and bounded; otherwise use metadata-only criteria with disclosure.',
  'Never call mcp_gallery_readAssetOriginals for highlight or cover curation.',
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

- [ ] **Step 1: Run full agent-runner suite**

Run:

```bash
pnpm --dir agent-runner test
```

Expected: PASS, including preview-assisted highlight and cover tests.

- [ ] **Step 2: Run diff whitespace checks**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 3: Inspect final diff for scope creep**

Run:

```bash
git diff -- agent-runner/src/e2e-runtime.mjs agent-runner/src/e2e-runtime.test.mjs agent-runner/src/pi-runtime.mjs agent-runner/src/pi-runtime.test.mjs docs/superpowers/plans/2026-05-26-pi-agent-highlight-curation-slice-4.md
```

Expected:

- Preview-assisted highlight plans call `readAssetPreviews` only after `searchAssets`.
- Preview-capable candidate sets above 250 ask to narrow before preview reads or plan calls.
- Preview-denied and provider-without-image-input paths fall back to metadata-only with disclosure.
- Cover suggestions propose exactly one `album.setCover` operation.
- No `readAssetOriginals` call appears in implementation paths or tests except the no-call guard fixture.
- No UI, sparse apply, capability matrix, acceptance E2E, `analyzeAssetQuality`, or duplicate clustering work is present.

- [ ] **Step 4: Commit**

Run:

```bash
git status --short
git add agent-runner/src/e2e-runtime.mjs agent-runner/src/e2e-runtime.test.mjs agent-runner/src/pi-runtime.mjs agent-runner/src/pi-runtime.test.mjs docs/superpowers/plans/2026-05-26-pi-agent-highlight-curation-slice-4.md
git commit -m "feat: add preview highlight curation"
```

Expected: commit succeeds.

## Self-Review Checklist

- Preview-assisted highlight flow reads previews only after bounded candidate IDs are known.
- Preview-assisted candidate sets above 250 ask to narrow and do not call previews or propose plans.
- Preview-denied and provider-without-image-input paths fall back to metadata-only criteria with disclosure.
- Cover flow resolves a named album, reads album assets, selects exactly one asset, and proposes `album.setCover`.
- No curation flow calls `readAssetOriginals`.
- Existing metadata-only Slice 3 tests still pass.
- Real Pi prompt explains preview limits, cover suggestions, fallback, and no originals.
- No Slice 5 UI/sparse apply or Slice 6 capability matrix/E2E work is included.
