# Pi Agent Workflow Expansion (Phase 3) — Slice 1 Implementation Plan

Spec: `docs/superpowers/specs/2026-05-30-pi-agent-workflow-expansion-phase-3-design.md`
Slice: 1 — `untag_assets` router + run + contract fixture (end-to-end).

## Goal

Add a hybrid `untag_assets` workflow that turns "remove [the] `<tag>` tag from
`<source>`" / "untag `<source>` [as `<tag>`]" into a reviewable
`proposeAlbumOperations` plan with one `asset.removeTag` operation over a
resolver-resolved selection. Mirror of `tag_assets` with name→`tagId` resolution.

## Resolved contracts (do not re-derive)

- **`asset.removeTag` op shape** = exact mirror of `addTagOperationSchema`
  (`server/src/dtos/agent-operation.dto.ts`): one operation
  ```js
  {
    type: 'asset.removeTag',
    summary: '<summary>',
    targetKind: 'asset_batch',
    assetSource: { kind: 'selectionHandle', selectionHandleId },
    payload: { tagId },           // tagId is a UUID, NOT a name
  }
  ```
  No `targetId` (asset_batch is a standalone batch — `validateStandaloneTarget`).
  Selection is exactly one of `assetSource` / `assetIds` / `assetSelectionHandleId`;
  use the `assetSource` selectionHandle form (the established workflow pattern,
  same as `album.removeAssets`).
- **Tag name → tagId** via `resolveAssetSearchFilters({ tags: [tagName] })`.
  Success response `results: [{ kind:'tag', query, status:'matched'|'ambiguous'|'not_found', id?, value?, choices, message }]`.
  A `matched` tag result carries `id` (the tag UUID). `ambiguous` / `not_found`
  → `needs_input` (use `message`). Reads are auto-resolved to success in the
  workflow client (same as the resolver's own `resolveAssetSearchFilters` call —
  no approval branch needed).
- **Source** resolves via the shared `resolveAssetSource` (recency/date/entity),
  returning `{ status: 'resolved', selectionHandleId, assetCount }` or
  `needs_input` / `handoff` / `empty` — handle exactly like `tag_assets`.

## Implementation (exact)

### 1. New module `agent-runner/src/strict-workflows/workflows/untag-assets.mjs`

Model it on `workflows/tag-assets.mjs`. Key differences: removal regexes
requiring the literal `tag` token, tag name→id resolution, and a
`proposeAlbumOperations` `asset.removeTag` plan instead of
`proposeAssetBatchFromSelection`.

```js
import { SUBJECTIVE_PATTERN, resolveAssetSource } from '../asset-source-resolver.mjs';
import { failed, handoffOpen, needsInput } from '../protocol.mjs';
import { gatePlanResult, safeFailureText } from './plan-gate.mjs';

// untag_assets (hybrid, REMOVE-ONLY): "remove [the] <tag> tag from <source>",
// "remove [the] tag <tag> from <source>", "untag <source> [as|from <tag>]" →
// a proposeAlbumOperations asset.removeTag over a resolved selection. The add
// arm lives in tag_assets; the two never overlap (add has no "remove"/"untag").

const KIND = 'untag_assets';

const clean = (value) => (typeof value === 'string' ? value.trim() : '');
const cleanSource = (value) =>
  clean(value)
    .replace(/[.?!]+$/u, '')
    .trim();
const stripQuotes = (t) => (t.length >= 2 && /^["'“‘]/.test(t) && /["'”’]$/.test(t) ? t.slice(1, -1).trim() : t);
const cleanTag = (value) =>
  stripQuotes(
    clean(value)
      .replace(/[.?!]+$/u, '')
      .trim(),
  );

const tripSourcePattern = /\brecent\s+trip\b/i;
const declinesSourceFastPath = (source) => SUBJECTIVE_PATTERN.test(source) || tripSourcePattern.test(source);

// "remove [the] tag <tag> from <source>"
const REMOVE_TAG_NAMED_FROM = /\bremove\s+(?:the\s+)?tag\s+(?<tag>.+?)\s+from\s+(?<source>.+)$/i;
// "remove [the] <tag> tag from <source>"
const REMOVE_NAMED_TAG_FROM = /\bremove\s+(?:the\s+)?(?<tag>.+?)\s+tag\s+from\s+(?<source>.+)$/i;
// "untag <source> [as|from <tag>]" (tag optional → run asks which tag)
const UNTAG_PATTERN = /\buntag\s+(?<source>.+?)(?:\s+(?:as|from)\s+(?<tag>.+))?$/i;

const PATTERNS = [REMOVE_TAG_NAMED_FROM, REMOVE_NAMED_TAG_FROM, UNTAG_PATTERN];

export const untagAssetsWorkflow = () => ({
  kind: KIND,
  flow: 'hybrid',

  match(prompt) {
    const text = clean(prompt);
    if (!text) return undefined;
    for (const pattern of PATTERNS) {
      const m = pattern.exec(text);
      if (m?.groups?.source) {
        const sourceDescription = cleanSource(m.groups.source);
        const tagName = m.groups.tag ? cleanTag(m.groups.tag) : '';
        if (!sourceDescription || declinesSourceFastPath(sourceDescription)) return undefined;
        return { slots: { sourceDescription, tagName } };
      }
    }
    return undefined;
  },

  parseSlots(rawSlots) {
    const sourceDescription = cleanSource(rawSlots?.sourceDescription);
    const tagName = cleanTag(rawSlots?.tagName);
    if (!sourceDescription) return null;
    return { sourceDescription, tagName }; // tagName may be '' → run asks
  },

  async run({ client, slots, signal }) {
    const sourceDescription = clean(slots?.sourceDescription);
    const tagName = cleanTag(slots?.tagName);
    if (!tagName) {
      return needsInput({ text: 'Which tag should I remove?' });
    }

    // 1. Resolve the source into a selection handle (shared resolver).
    let resolution;
    try {
      resolution = await resolveAssetSource({ client, sourceDescription, signal });
    } catch (error) {
      return failed({ text: safeFailureText(error?.message ?? 'The search tool failed.') });
    }
    if (resolution.status === 'handoff') return handoffOpen({ reason: resolution.reason });
    if (resolution.status === 'needs_input') return needsInput({ text: resolution.text });
    if (resolution.status === 'empty') {
      return needsInput({
        text: `I could not find any photos matching "${sourceDescription}". Can you describe them differently?`,
      });
    }
    const { selectionHandleId, assetCount } = resolution;

    // 2. Resolve the tag NAME → tagId (removeTag payload needs a UUID).
    let tagResolution;
    try {
      tagResolution = await client.call('resolveAssetSearchFilters', { tags: [tagName] }, { signal });
    } catch (error) {
      return failed({ text: safeFailureText(error?.message ?? 'The tag lookup failed.') });
    }
    const tagResult = (tagResolution?.results ?? []).find((r) => r?.kind === 'tag');
    if (!tagResult || tagResult.status === 'not_found') {
      return needsInput({ text: `I could not find a tag called "${tagName}". Which tag do you mean?` });
    }
    if (tagResult.status === 'ambiguous') {
      return needsInput({ text: `Multiple tags match "${tagName}". Which one do you mean?` });
    }
    const tagId = clean(tagResult.id);
    if (!tagId) {
      return failed({ text: safeFailureText(`The tag "${tagName}" did not resolve to an id.`) });
    }

    // 3. Propose a reviewable asset.removeTag over the resolved selection.
    let planResult;
    try {
      planResult = await client.call(
        'proposeAlbumOperations',
        {
          summary: `Remove the "${tagName}" tag from matching photos.`,
          operations: [
            {
              type: 'asset.removeTag',
              summary: `Remove the "${tagName}" tag.`,
              targetKind: 'asset_batch',
              assetSource: { kind: 'selectionHandle', selectionHandleId },
              payload: { tagId },
            },
          ],
        },
        { signal },
      );
    } catch (error) {
      return failed({ text: safeFailureText(error?.message ?? 'The planning tool failed.') });
    }

    return gatePlanResult({
      planResult,
      planTool: 'proposeAlbumOperations',
      successText: `I prepared a plan to remove the "${tagName}" tag from ${assetCount} matching ${assetCount === 1 ? 'photo' : 'photos'}. Review the plan before applying it.`,
      successSummary: { workflowKind: KIND, assetCount, label: tagName },
    });
  },
});
```

(Confirm `failed`/`handoffOpen`/`needsInput` and `gatePlanResult`/`safeFailureText`
signatures against `tag-assets.mjs` before finalizing — match them exactly.)

### 2. `registry.mjs`

- Import `untagAssetsWorkflow` from `./workflows/untag-assets.mjs`.
- Insert `untagAssetsWorkflow,` into `WORKFLOW_FACTORIES` immediately AFTER
  `tagAssetsWorkflow` and BEFORE `removePhotosFromAlbumWorkflow`.
- Extend the order comment: untag requires the literal `tag` token so it owns
  "remove `<tag>` tag from `<source>`" / "untag …" before `remove_photos_from_album`,
  and never steals favorite/space/member removals (no `tag` token there).

### 3. `manifest.mjs` (+ regenerate mirror)

Add an `untag_assets` entry mirroring `tag_assets`' format:

- `kind: 'untag_assets'`, `flow: 'hybrid'`, `title: 'Untag photos (remove)'`.
- `classifierDescription`: "User wants to remove an existing tag from a
  metadata-describable set of photos or a named entity (remove-only; the add arm
  is tag_assets)."
- `positiveExamples`: "Remove the Travel tag from my newest 20", "Remove tag
  Spring Break from my last 50 photos", "Untag my newest 20 as Travel",
  "Untag the Berlin photos from Work".
- `negativeExamples`: "Add the Travel tag to my newest 20", "Remove my newest 20
  from the Italy album", "Remove Bob from the Family space".
- `slots`: `sourceDescription` (required) + `tagName` (required:false —
  untag-without-tag asks). Description note tagName optional for untag.
- `requiredReadTools: ['resolveAssetSearchFilters', 'searchAssets']`.
- `planTool: 'proposeAlbumOperations'`.
- `supportsContinuation: false`.
- `matrixRow`: `{ capability: 'Add or remove tags', tier: 'Solid now', flow: 'Hybrid' }`
  — keep the capability string identical to `tag_assets` so the matrix lists one
  row covered by both add and remove (verify against the matrix spec's
  expectations in Slice 9; for Slice 1 just keep it self-consistent).

Then regenerate the mirror:
`/opt/homebrew/bin/mise exec -- node agent-runner/src/bin/sync-strict-workflow-manifest.mjs`.

### 4. `contract-fixtures.mjs` — add `validateAssetRemoveTag`

Mirror `validateAlbumRemoveAssets`. Register it in the per-type validator map
keyed by `'asset.removeTag'` (next to `'album.removeAssets'`):

```js
const validateAssetRemoveTag = (op) => {
  if (op.targetKind !== 'asset_batch') fail('asset.removeTag requires targetKind "asset_batch"');
  if (op.targetId !== undefined) fail('asset.removeTag must not set targetId');
  if (op.temporaryTargetId !== undefined) fail('asset.removeTag must not set temporaryTargetId');
  if (!op.payload || typeof op.payload.tagId !== 'string' || !op.payload.tagId) {
    fail('asset.removeTag requires payload.tagId (uuid)');
  }
  const source = op.assetSource;
  if (!source || source.kind !== 'selectionHandle' || !source.selectionHandleId) {
    fail('asset.removeTag requires an assetSource selectionHandle');
  }
};
// ... in the validator map:
//   'asset.removeTag': validateAssetRemoveTag,
```

(`'asset.removeTag'` is already in `KNOWN_OPERATION_TYPES`; only the validator
binding is new.)

## TDD steps

### Task 1: write the failing tests (red)

New `agent-runner/src/strict-workflows/workflows/untag-assets.test.mjs`,
modelled on `tag-assets.test.mjs` (reuse its fake-client / fixture harness).

`match`:

- accepts and extracts slots for: "remove the Travel tag from my newest 20"
  (`{tag:'Travel', source:'my newest 20'}`), "remove tag Spring Break from my
  last 50 photos", "untag my newest 20 as Travel", "untag the Berlin photos from
  Work".
- "untag my newest 20" → matches with `tagName: ''`.
- rejects (returns undefined): "add the Travel tag to my newest 20",
  "remove my newest 20 from the Italy album", "remove Bob from the Family space",
  "remove these from favorites", "remove the best ones tag from my photos"
  (subjective source declines).

`parseSlots`: round-trips regex slots and LLM-shaped raw slots; missing source →
null; empty tagName preserved.

`run` (via the contract fixture):

- happy path: resolves source → resolves tag → proposes one valid
  `asset.removeTag` op over the selectionHandle → gated; success text states the
  asset count and tag name. Assert the op passes `validateOperations`.
- untag with no tag (`tagName: ''`) → `needs_input` "Which tag should I remove?",
  no plan.
- tag `not_found` → `needs_input`; tag `ambiguous` → `needs_input`; neither
  proposes a plan.
- source resolver `needs_input` / `handoff` / `empty` → propagated; no plan.
- `resolveAssetSearchFilters` throws → `failed`; `proposeAlbumOperations` throws
  or returns not-gated → `failed`.

`contract-fixtures.test.mjs`:

- a valid `asset.removeTag` op passes.
- rejects: missing `payload.tagId`, non-string `tagId`, `targetId` present,
  `targetKind !== 'asset_batch'`, missing/`search`-kind assetSource.

Disambiguation unit (`disambiguation.test.mjs`): change the existing
`['remove the Travel tag from my newest 20', 'none']` expectation to
`'untag_assets'`; keep `['add the Travel tag to my newest 20', 'tag_assets']`.

Run red and confirm the failures are "untagAssetsWorkflow is not defined" /
"unknown operation type" / wrong-route — not typos.

### Task 2: implement (green)

Add the module, registry entry, manifest entry (+ mirror regen), and fixture
validator until all new tests are green and the full agent-runner suite is green:

```bash
/opt/homebrew/bin/mise exec -- pnpm --dir agent-runner test
```

## Edge cases (covered by the tests above)

- Quoted / multi-word tag names ("remove the \"Date Night\" tag from …").
- Trailing punctuation on source and tag.
- untag without a tag → asks which tag (no tagless removal plan).
- Empty selection (resolver `empty`) → needs_input, never an empty removal plan.
- Tag not found / ambiguous → needs_input (no plan).
- Removal phrasing with no `tag` token does not match (neighbors keep it):
  album-remove, favorite-remove, member-remove.
- Subjective source ("the best ones") declines via the fast-path.

### 5. Regenerate the capability-matrix generated block (keep server CI green)

Adding an `untag_assets` manifest entry breaks the server test
`agent-capability-matrix.spec.ts` "keeps the generated implemented-workflows
block in sync with the manifest" (it asserts the doc's `<!-- generated:workflows -->`
block contains `renderImplementedWorkflowsBlock(manifest)`). The per-entry Flow
Ownership agreement test stays green because `untag_assets` reuses the existing
`'Add or remove tags'` row (already "Hybrid"). So only the generated block needs
regenerating:

```bash
# manifest mirror first (agent-runner)
/opt/homebrew/bin/mise exec -- node agent-runner/src/bin/sync-strict-workflow-manifest.mjs
# regenerate the doc's generated block (server already built this session)
/opt/homebrew/bin/mise exec -- pnpm -C server sync:agent-capabilities
# prettier the matrix doc to a fixed point (run from cd docs)
cd docs && for i in 1 2 3; do /opt/homebrew/bin/mise exec -- pnpm exec prettier --write superpowers/specs/2026-05-19-pi-agent-capability-matrix.md >/dev/null 2>&1; done; cd ..
# confirm the server spec is green
/opt/homebrew/bin/mise exec -- pnpm -C server test -- --run src/services/agent-capability-matrix.spec.ts
```

Do NOT hand-edit the generated block. Do NOT change the hand-authored Flow
Ownership rows in this slice (untag reuses the existing tag row); deeper matrix
wording lands in Slice 9.

## Acceptance

- New `untag-assets.test.mjs` + `contract-fixtures.test.mjs` additions green.
- Full agent-runner unit suite green (no regressions in tag/remove/space/favorite).
- `manifest.generated.json` regenerated and committed.
- Capability-matrix generated block regenerated; `agent-capability-matrix.spec.ts`
  green; matrix doc prettier-clean.
- `disambiguation.test.mjs` flips the untag prompt to `untag_assets`, add arm
  unchanged.

## Commit

`feat(agent): add untag_assets workflow (tag removal via asset.removeTag)`
