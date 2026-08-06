# Pi Agent Highlight Curation Slice 6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add final acceptance smoke coverage and mark bounded highlight curation complete in the capability matrix.

**Architecture:** Extend only the deterministic e2e runner where the acceptance prompts need current-album context, then add exact smoke tests for the accepted workflows. Update the markdown capability matrix and its contract test after the runtime behavior is covered. Do not add new MCP tools, scoring services, operation types, or UI.

**Tech Stack:** Node test runner, deterministic `agent-runner` e2e runtime, Vitest server spec, markdown capability matrix.

---

## Scope Boundaries

This plan implements only Slice 6 from `docs/superpowers/specs/2026-05-26-pi-agent-highlight-curation-design.md`.

In scope:

- Exact acceptance smoke tests for the accepted highlight workflows.
- Current-album context support in the deterministic e2e runner for prompts that say "this album."
- Capability matrix completion after the Slice 1-5 implementation is in place.
- Final prompt/docs examples in the capability matrix.

Out of scope:

- No `analyzeAssetQuality`.
- No blur, exposure, aesthetic, or duplicate scoring.
- No new server DTO, operation type, MCP tool, or persisted score.
- No new review UI or curation wizard.
- No whole-library highlight plan.
- No shared-space highlight implementation in this slice; the Slice 6 required acceptance list is album, favorite, cover, no-scope, fewer-candidates, and no-candidates. Shared-space bounded highlights remain covered by the documented bounded-source contract and can be deepened later.

## Current Codebase Notes

- `agent-runner/src/e2e-runtime.test.mjs` already covers many Slice 3/4 behavior-specific paths but not the exact Slice 6 acceptance prompts.
- `agent-runner/src/e2e-runtime.mjs` currently stores `supportsImageInput` in the e2e session but drops `initialContext`; prompts that say "this album" therefore cannot resolve the current album.
- Existing server capability matrix coverage is in `server/src/services/agent-capability-matrix.spec.ts`.
- The markdown matrix lives at `docs/superpowers/specs/2026-05-19-pi-agent-capability-matrix.md`.

## Files

- Modify: `agent-runner/src/e2e-runtime.test.mjs`
  - Add exact acceptance smoke tests.
  - Add fixture helpers for a current-album context with enough assets.
- Modify: `agent-runner/src/e2e-runtime.mjs`
  - Store `initialContext`.
  - Resolve `initialContext.albumId` when the prompt says "this album."
  - Use current album asset IDs directly for highlight and cover curation.
- Modify: `server/src/services/agent-capability-matrix.spec.ts`
  - Change the highlight matrix expectation from planned/constrained to solid for bounded sources.
  - Assert visual cleanup remains constrained.
  - Assert image quality scoring remains in `Needs New MCP Tool`.
  - Assert final acceptance prompts are documented.
- Modify: `docs/superpowers/specs/2026-05-19-pi-agent-capability-matrix.md`
  - Mark "Best photos" curation solid for bounded sources only.
  - Add final acceptance smoke prompts.
  - Keep quality scoring in `Needs New MCP Tool`.

## Task 1: Add Red Acceptance Smoke Tests

**Files:**

- Modify: `agent-runner/src/e2e-runtime.test.mjs`
- Test: `agent-runner/src/e2e-runtime.test.mjs`

- [ ] **Step 1: Add current-album acceptance fixtures**

In `agent-runner/src/e2e-runtime.test.mjs`, add these helpers near the existing highlight fixtures:

```js
const currentAlbumAssetIds = Array.from(
  { length: 8 },
  (_value, index) => `00000000-0000-4000-8000-${String(800 + index).padStart(12, '0')}`,
);

const currentAlbumMetadataAssets = () =>
  currentAlbumAssetIds.map((id, index) =>
    highlightMetadataAsset(id, {
      isFavorite: index === 1 || index === 4,
      exifInfo: {
        rating: [1, 5, 3, 2, 4, 0, 2, 1][index],
        city: index % 2 === 0 ? 'Porto' : 'Lisbon',
        country: 'Portugal',
      },
    }),
  );

const currentAlbumSessionContext = () => ({
  albumId: familyAlbumId,
});
```

- [ ] **Step 2: Add exact Slice 6 smoke tests**

Add a new `describe('highlight curation acceptance smoke', () => { ... })` block near the existing highlight tests:

```js
describe('highlight curation acceptance smoke', () => {
  it('creates a highlights album from the current album context', async () => {
    const albums = [familyAlbumSummary()];
    const { calls, fetchImplementation } = createFetch(
      metadataHighlightHandlers({
        albums,
        albumAssetIds: currentAlbumAssetIds,
        metadataAssets: currentAlbumMetadataAssets(),
      }),
    );
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody({ initialContext: currentAlbumSessionContext() }));

    const events = await collectEvents(
      runtime,
      'Suggest 5 highlights from this album and make an album called Highlights.',
    );

    assert.equal(
      calls.map((call) => call.body.params.name).join(','),
      'readAlbum,readAssetMetadata,proposeAlbumOperations',
    );
    assert.deepEqual(calls[0].body.params.arguments, { albumId: familyAlbumId });
    const plan = calls.at(-1).body.params.arguments;
    assert.equal(JSON.stringify(plan).includes('assetSource'), false);
    assert.equal(JSON.stringify(plan).includes('previousSearch'), false);
    assert.equal(plan.operations[0].payload.albumName, 'Highlights');
    assert.deepEqual(
      plan.operations.map((operation) => operation.type),
      ['album.create', 'album.addAssets'],
    );
    assert.equal(plan.operations[1].assetIds.length, 5);
    assert.match(plan.summary, /metadata-only/i);
    assert.match(events.at(-1).content.blocks[0].text, /5 suggested highlights|5 .*highlights/i);
    assert.match(events.at(-1).content.blocks[0].text, /Review/i);
  });

  it('favorites the best 3 photos from last weekend', async () => {
    const { calls, fetchImplementation } = createFetch(metadataHighlightHandlers());
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    const events = await collectEvents(runtime, 'Favorite the best 3 photos from last weekend.');

    assert.equal(
      calls.map((call) => call.body.params.name).join(','),
      'searchAssets,readAssetMetadata,proposeAlbumOperations',
    );
    const plan = calls.at(-1).body.params.arguments;
    assert.deepEqual(plan.operations, [
      {
        type: 'asset.setFavorite',
        summary: 'Favorite 3 metadata-only suggested highlights.',
        targetKind: 'asset_batch',
        assetIds: [
          '00000000-0000-4000-8000-000000000402',
          '00000000-0000-4000-8000-000000000403',
          '00000000-0000-4000-8000-000000000401',
        ],
        riskLevel: 'low',
        enabled: true,
        payload: { favorite: true },
      },
    ]);
    assert.match(events.at(-1).content.blocks[0].text, /3 metadata-only suggested highlights/i);
  });

  it('picks a cover from the current album context', async () => {
    const albums = [familyAlbumSummary()];
    const { calls, fetchImplementation } = createFetch(
      previewHighlightHandlers({
        albums,
        albumAssetIds: currentAlbumAssetIds,
        metadataAssets: currentAlbumMetadataAssets(),
      }),
    );
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(
      createSessionBody({ initialContext: { ...currentAlbumSessionContext(), providerSupportsImages: true } }),
    );

    const events = await collectEvents(runtime, 'Pick a cover from this album.');

    assert.equal(
      calls.map((call) => call.body.params.name).join(','),
      'readAlbum,readAssetMetadata,readAssetPreviews,proposeAlbumOperations',
    );
    assert.deepEqual(calls[0].body.params.arguments, { albumId: familyAlbumId });
    const plan = calls.at(-1).body.params.arguments;
    assert.deepEqual(
      plan.operations.map((operation) => operation.type),
      ['album.setCover'],
    );
    assert.equal(plan.operations[0].assetIds.length, 1);
    assert.match(plan.summary, /cover/i);
    assert.match(events.at(-1).content.blocks[0].text, /cover/i);
    assert.match(events.at(-1).content.blocks[0].text, /Review/i);
  });

  it('asks for scope and creates no plan for best photos from the library', async () => {
    const { calls, fetchImplementation } = createFetch(successHandlers());
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    const events = await collectEvents(runtime, 'Pick the best photos from my library.');

    assert.equal(calls.length, 0);
    assert.match(events.at(-1).content.blocks[0].text, /bounded source/i);
    assert.match(events.at(-1).content.blocks[0].text, /\?/);
  });

  it('proposes the 7 eligible current-album assets when 20 are requested', async () => {
    const sevenAssetIds = currentAlbumAssetIds.slice(0, 7);
    const albums = [familyAlbumSummary()];
    const { calls, fetchImplementation } = createFetch(
      metadataHighlightHandlers({
        albums,
        albumAssetIds: sevenAssetIds,
        metadataAssets: currentAlbumMetadataAssets().slice(0, 7),
      }),
    );
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody({ initialContext: currentAlbumSessionContext() }));

    const events = await collectEvents(
      runtime,
      'Suggest 20 highlights from this album and make an album called Highlights.',
    );

    assert.equal(
      calls.map((call) => call.body.params.name).join(','),
      'readAlbum,readAssetMetadata,proposeAlbumOperations',
    );
    const plan = calls.at(-1).body.params.arguments;
    assert.equal(plan.operations[1].assetIds.length, 7);
    assert.match(events.at(-1).content.blocks[0].text, /Only 7 eligible candidates/i);
    assert.match(events.at(-1).content.blocks[0].text, /requested 20/i);
  });

  it('reports no matches and creates no plan for an empty bounded source', async () => {
    const { calls, fetchImplementation } = createFetch([
      {
        name: 'searchAssets',
        handle: (_args, request) => ({
          body: {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              structuredContent: {
                status: 'success',
                assetIds: [],
                returnedCount: 0,
                hasMore: false,
              },
            },
          },
        }),
      },
      successHandlers()[1],
    ]);
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    const events = await collectEvents(runtime, 'Suggest highlights from last weekend.');

    assert.equal(calls.map((call) => call.body.params.name).join(','), 'searchAssets');
    assert.match(events.at(-1).content.blocks[0].text, /no matching/i);
    assert.match(events.at(-1).content.blocks[0].text, /did not create a plan/i);
  });
});
```

- [ ] **Step 3: Run the acceptance tests and verify red**

Run:

```bash
pnpm --dir agent-runner exec node --test src/e2e-runtime.test.mjs
```

Expected: FAIL. The exact current-album tests should fail because the deterministic runtime does not preserve `initialContext` and answers "Please name the album" / "concrete searchable source" instead of reading `initialContext.albumId`.

## Task 2: Implement Current-Album Curation In The E2E Runtime

**Files:**

- Modify: `agent-runner/src/e2e-runtime.mjs`
- Test: `agent-runner/src/e2e-runtime.test.mjs`

- [ ] **Step 1: Preserve initial context on e2e sessions**

In `createE2eRuntime().createSession`, change the session object to include:

```js
        initialContext: body.initialContext ?? {},
```

The resulting object should keep the existing `supportsImageInput` field:

```js
sessions.set(runnerSessionId, {
  gallerySessionId: body.gallerySessionId,
  model: body.model,
  mcpGateway: body.mcpGateway,
  supportsImageInput: sessionSupportsImageInput(body),
  initialContext: body.initialContext ?? {},
});
```

- [ ] **Step 2: Add current-album helpers**

In `agent-runner/src/e2e-runtime.mjs`, near `resolveExistingAlbum`, add:

```js
const currentAlbumIdFromContext = (entry) => {
  const albumId = entry.initialContext?.albumId;
  return typeof albumId === 'string' && albumId.trim() ? albumId : null;
};

const readAlbumById = async (client, albumId) => {
  const albumResult = await client.call('readAlbum', { albumId });
  assertMcpResultSuccess(albumResult, 'Album read');
  return { status: 'resolved', album: albumResult.album };
};
```

- [ ] **Step 3: Track current-album prompts**

Change `parseHighlightPrompt` to include:

```js
    usesCurrentAlbum: /\bthis album\b/i.test(prompt),
```

Change `parseCoverPrompt` to return `usesCurrentAlbum`:

```js
const parseCoverPrompt = (prompt) => {
  if (!/\bcover\b/i.test(prompt)) {
    return null;
  }

  const usesCurrentAlbum = /\bthis album\b/i.test(prompt);
  const namedAlbum = prompt.match(/\bcover\s+(?:for|from)\s+([A-Za-z][A-Za-z0-9 '&-]*?)\.?$/i);
  if (namedAlbum && !usesCurrentAlbum) {
    return { targetAlbumName: stripTrailingSourcePhrase(namedAlbum[1]), usesCurrentAlbum };
  }

  return { targetAlbumName: null, usesCurrentAlbum };
};
```

- [ ] **Step 4: Resolve current album for cover prompts**

In the cover branch, replace the early target-name check and resolution with:

```js
        const contextAlbumId = currentAlbumIdFromContext(entry);
        if (!coverPrompt.targetAlbumName && !(coverPrompt.usesCurrentAlbum && contextAlbumId)) {
          yield completedEvent({
            gallerySessionId,
            runnerSessionId,
            text: 'Please name the album before I suggest a cover.',
          });
          return;
        }

        try {
          const resolution = coverPrompt.usesCurrentAlbum
            ? await readAlbumById(client, contextAlbumId)
            : await resolveExistingAlbum(client, coverPrompt.targetAlbumName);
```

Keep the existing unresolved-album message for named albums. For the current-album path, if the album read does not produce a usable album, let the existing catch block report the read error.

- [ ] **Step 5: Resolve current album as a highlight candidate source**

In the highlight branch, before the `if (!highlightPrompt.filters)` check, add:

```js
        const contextAlbumId = currentAlbumIdFromContext(entry);
        let sourceAlbum = null;
        if (highlightPrompt.usesCurrentAlbum) {
          if (!contextAlbumId) {
            yield completedEvent({
              gallerySessionId,
              runnerSessionId,
              text: 'I need the current album context before I suggest highlights from this album.',
            });
            return;
          }

          const resolution = await readAlbumById(client, contextAlbumId);
          sourceAlbum = resolution.album;
        }
```

Then change the existing check to:

```js
        if (!highlightPrompt.filters && !sourceAlbum) {
```

- [ ] **Step 6: Use current-album asset IDs instead of search results**

Inside the highlight `try` block, replace the single `readHighlightCandidates(...)` call with source-aware logic:

```js
const sourceAlbumAssetIds = Array.isArray(sourceAlbum?.assetIds) ? sourceAlbum.assetIds : null;
const candidateResult = sourceAlbumAssetIds
  ? { assetIds: sourceAlbumAssetIds, candidateCount: sourceAlbumAssetIds.length }
  : await readHighlightCandidates(client, highlightPrompt, planCandidateLimit);
const { assetIds, candidateCount } = candidateResult;
```

The rest of the highlight branch should keep using `assetIds` for metadata reads, candidate-limit checks, selection, and write plans.

- [ ] **Step 7: Run the acceptance tests and verify green**

Run:

```bash
pnpm --dir agent-runner exec node --test src/e2e-runtime.test.mjs
```

Expected: PASS. The exact Slice 6 acceptance prompts and existing e2e-runtime tests should pass.

## Task 3: Update Capability Matrix Contract And Markdown

**Files:**

- Modify: `server/src/services/agent-capability-matrix.spec.ts`
- Modify: `docs/superpowers/specs/2026-05-19-pi-agent-capability-matrix.md`
- Test: `server/src/services/agent-capability-matrix.spec.ts`

- [ ] **Step 1: Change the matrix test to expect completion**

In `server/src/services/agent-capability-matrix.spec.ts`, replace the current highlight matrix test with:

```ts
it('documents bounded highlight curation as solid while quality scoring remains a new-tool gap', () => {
  const markdown = readMatrix();

  const bestPhotosRow = markdown.split('\n').find((line) => line.includes('“Best photos” curation'));

  expect(bestPhotosRow).toBeDefined();
  expect(bestPhotosRow).toContain('Solid now for bounded sources');
  expect(bestPhotosRow).toMatch(/bounded candidates/i);
  expect(bestPhotosRow).toMatch(/ratings|favorites|metadata|previews/i);
  expect(bestPhotosRow).toMatch(/not quality scoring|not objective/i);
  expect(bestPhotosRow).not.toContain('planned implementation');

  const visualCleanupRow = markdown.split('\n').find((line) => line.includes('Visual cleanup'));
  expect(visualCleanupRow).toBeDefined();
  expect(visualCleanupRow).toContain('Constrained now');

  for (const prompt of [
    'Suggest 5 highlights from this album and make an album called Highlights.',
    'Favorite the best 3 photos from last weekend.',
    'Pick a cover from this album.',
    'Pick the best photos from my library.',
    'Suggest 20 highlights from this album.',
    'Suggest highlights from last weekend.',
  ]) {
    expect(markdown).toContain(prompt);
  }

  const needsNewToolHeadingIndex = markdown.indexOf('## Needs New MCP Tool');
  expect(needsNewToolHeadingIndex).not.toBe(-1);

  const needsNewToolSection = markdown.slice(needsNewToolHeadingIndex);
  expect(needsNewToolSection).toContain('Image quality scoring');
  expect(needsNewToolSection).toContain('analyzeAssetQuality');
  expect(needsNewToolSection).toMatch(/quality scoring/i);
});
```

- [ ] **Step 2: Run the capability matrix test and verify red**

Run:

```bash
pnpm --dir server test src/services/agent-capability-matrix.spec.ts
```

Expected: FAIL because the markdown still says highlight curation is behind planned implementation.

- [ ] **Step 3: Update the markdown matrix**

In `docs/superpowers/specs/2026-05-19-pi-agent-capability-matrix.md`, update the high-value constrained capability row from:

```markdown
| “Best photos” curation | Users want the assistant to pick highlights. | Constrained now and behind planned implementation; works only across bounded candidates using ratings, favorites, metadata, and previews, not quality scoring. | Ask for a scope when broad: album, shared space, date range, search/filter, selection, or max count. |
```

to:

```markdown
| “Best photos” curation | Users want the assistant to pick highlights. | Solid now for bounded sources using ratings, favorites, metadata, and previews across bounded candidates; suggested highlights are not objective quality scoring. | Ask for a scope when broad: album, shared space, date range, search/filter, selection, or max count. |
```

Keep the `Visual cleanup` row as `Constrained now`.

In the `Recommended Product Smoke Prompts` section, append:

```markdown
23. “Suggest 5 highlights from this album and make an album called Highlights.”
24. “Favorite the best 3 photos from last weekend.”
25. “Pick a cover from this album.”
26. “Pick the best photos from my library.”
27. “Suggest 20 highlights from this album.”
28. “Suggest highlights from last weekend.”
```

Do not remove `Image quality scoring` or `analyzeAssetQuality` from `## Needs New MCP Tool`.

- [ ] **Step 4: Run the capability matrix test and verify green**

Run:

```bash
pnpm --dir server test src/services/agent-capability-matrix.spec.ts
```

Expected: PASS.

## Task 4: Final Slice Verification And Commit

**Files:**

- Test: `agent-runner/src/e2e-runtime.test.mjs`
- Test: `server/src/services/agent-capability-matrix.spec.ts`
- Test: Slice 5 web review surface, because Slice 6 closes the full highlight curation feature.

- [ ] **Step 1: Run agent-runner tests**

Run:

```bash
pnpm --dir agent-runner test
```

Expected: PASS. All agent-runner tests pass, including the new exact acceptance smoke tests.

- [ ] **Step 2: Run capability matrix server test**

Run:

```bash
pnpm --dir server test src/services/agent-capability-matrix.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Run web plan review smoke tests**

Run:

```bash
pnpm --dir web exec vitest run 'src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts' 'src/routes/(user)/assistant/agent-plan-destination-card.spec.ts' 'src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts' 'src/routes/(user)/assistant/agent-operation-plan-i18n.spec.ts'
```

Expected: PASS. This confirms the final acceptance matrix did not close the feature while the highlight review UI is broken.

- [ ] **Step 4: Run whitespace check**

Run:

```bash
git diff --check
```

Expected: no output and exit 0.

- [ ] **Step 5: Commit and push Slice 6**

Run:

```bash
git add agent-runner/src/e2e-runtime.mjs \
  agent-runner/src/e2e-runtime.test.mjs \
  server/src/services/agent-capability-matrix.spec.ts \
  docs/superpowers/specs/2026-05-19-pi-agent-capability-matrix.md \
  docs/superpowers/plans/2026-05-26-pi-agent-highlight-curation-slice-6.md
git commit -m "test: add highlight curation acceptance coverage"
git push
```

Expected: commit succeeds and the branch pushes to `origin/explore/pi-agent-brainstorm`.

## Review Checklist

- Every new behavior starts red before implementation.
- Exact Slice 6 acceptance prompts are represented in tests or the capability matrix.
- "This album" works only when the session has `initialContext.albumId`; otherwise it asks for context.
- Current-album highlight plans use explicit selected `assetIds`, not `assetSource` or `previousSearch`.
- Cover curation still proposes exactly one `album.setCover`.
- Whole-library "best photos" still asks for scope and creates no plan.
- Fewer candidates than requested states the actual selected count.
- No matching candidates creates no plan.
- Capability matrix marks bounded highlight curation solid only for bounded sources.
- Visual cleanup remains constrained.
- Image quality scoring and `analyzeAssetQuality` remain in `Needs New MCP Tool`.
