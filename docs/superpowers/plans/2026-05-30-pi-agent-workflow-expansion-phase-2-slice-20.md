# Pi Agent Workflow Expansion (Phase 2) — Slice 20 Implementation Plan

> **For agentic workers:** Implement test-first. Steps use checkbox (`- [ ]`) syntax.
> Combined slice — do it in phases: (1) module + module tests → green; (2) registration +
> manifest + disambiguation + scenarios → green.

**Goal:** `set_album_cover` (strict): match "set/make the cover of `<album>` to
`<assetRef>`", resolve the album (`listAlbums`, 0/>1 → needs_input), resolve the cover to
ONE uuid by EXPLICIT index (first/last/Nth against `readAlbum.assetIds`; else handoff),
propose one `proposeAlbumOperations([album.setCover])` with `assetIds:[coverId]`. Register

- manifest + L1/L3. **Closes Phase 5.**

**Spec scope:** Slice 20 of
`docs/superpowers/specs/2026-05-30-pi-agent-workflow-expansion-phase-2-design.md`.

**Files:**

- `agent-runner/src/strict-workflows/workflows/set-album-cover.mjs` (new)
- `agent-runner/src/strict-workflows/workflows/set-album-cover.test.mjs` (new)
- `agent-runner/src/strict-workflows/registry.mjs`
- `agent-runner/src/strict-workflows/manifest.mjs`
- `agent-runner/src/strict-workflows/manifest.generated.json` (regenerate)
- `agent-runner/src/strict-workflows/manifest.test.mjs`
- `agent-runner/src/strict-workflows/disambiguation.test.mjs`
- `agent-runner/eval/scenarios/classification-recall.mjs`
- `agent-runner/eval/scenarios/classification-negatives.mjs`
- `agent-runner/eval/scenarios/slot-fidelity.mjs`
- `agent-runner/eval/scenarios/l3-readonly.mjs`

## Phase 1 — module + module tests

### A. `set-album-cover.mjs`

```js
import { failed, handoffOpen, needsInput } from '../protocol.mjs';
import { gatePlanResult, safeFailureText } from './plan-gate.mjs';

const KIND = 'set_album_cover';

const clean = (value) => (typeof value === 'string' ? value.trim() : '');

const normalizeAlbumRef = (value) =>
  clean(value)
    .replace(/^(?:the|my|this|that)\s+/i, '')
    .replace(/\s+album$/i, '')
    .trim();

const resolveAlbum = async ({ client, albumRef, signal }) => {
  const ref = normalizeAlbumRef(albumRef);
  const result = await client.call('listAlbums', {}, { signal });
  const albums = Array.isArray(result?.albums) ? result.albums : [];
  const matches = albums.filter((album) => clean(album?.albumName).toLowerCase() === ref.toLowerCase());
  return { ref, albums, matches };
};

const WORD_ORDINALS = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
};

// Resolve an explicit position to a 1-based index, or undefined if the reference is not a
// position (e.g. "a nicer one" → not resolvable → handoff).
const parseCoverIndex = (coverRef, count) => {
  const text = clean(coverRef).toLowerCase();
  if (/\blast\b/.test(text)) {
    return count;
  }
  const digit = text.match(/\b(\d+)(?:st|nd|rd|th)?\b/);
  if (digit) {
    return Number(digit[1]);
  }
  for (const [word, n] of Object.entries(WORD_ORDINALS)) {
    if (new RegExp(`\\b${word}\\b`).test(text)) {
      return n;
    }
  }
  return undefined;
};

const SET_COVER_PATTERN =
  /\b(?:set|change|use)\s+(?:the\s+)?cover\s+(?:photo\s+)?(?:of|for|on)\s+(?<album>.+?)\s+to\s+(?<cover>.+)$/i;
const MAKE_COVER_PATTERN =
  /\bmake\s+(?<album>.+?)\s+(?:the\s+)?cover\s+(?:the\s+)?(?<cover>\d+(?:st|nd|rd|th)?|first|last|second|third|fourth|fifth)\b/i;

const tryMatch = (prompt) => {
  const match = SET_COVER_PATTERN.exec(prompt) ?? MAKE_COVER_PATTERN.exec(prompt);
  if (!match?.groups) {
    return undefined;
  }
  const albumRef = normalizeAlbumRef(match.groups.album);
  const coverRef = clean(match.groups.cover)
    .replace(/[.?!]+$/u, '')
    .trim();
  return albumRef && coverRef ? { albumRef, coverRef } : undefined;
};

export const setAlbumCoverWorkflow = () => ({
  kind: KIND,
  flow: 'strict',

  match(prompt) {
    const text = clean(prompt);
    if (!text) {
      return undefined;
    }
    const matched = tryMatch(text);
    return matched ? { slots: matched } : undefined;
  },

  parseSlots(rawSlots) {
    const albumRef = normalizeAlbumRef(rawSlots?.albumRef);
    const coverRef = clean(rawSlots?.coverRef);
    if (!albumRef || !coverRef) {
      return null;
    }
    return { albumRef, coverRef };
  },

  async run({ client, slots, signal }) {
    const coverRef = clean(slots?.coverRef);

    let resolved;
    try {
      resolved = await resolveAlbum({ client, albumRef: slots?.albumRef, signal });
    } catch (error) {
      return failed({ text: safeFailureText(error?.message ?? 'The album lookup failed.') });
    }
    const { ref, matches } = resolved;
    if (matches.length === 0) {
      return needsInput({ text: `I could not find an album called "${ref}". Which album do you mean?` });
    }
    if (matches.length > 1) {
      return needsInput({ text: `Multiple albums are called "${ref}". Which one do you mean?` });
    }
    const album = matches[0];
    const albumName = clean(album.albumName) || ref;

    let detail;
    try {
      detail = await client.call('readAlbum', { albumId: album.id }, { signal });
    } catch (error) {
      return failed({ text: safeFailureText(error?.message ?? 'The album lookup failed.') });
    }
    const assetIds = Array.isArray(detail?.assetIds) ? detail.assetIds : [];

    const index = parseCoverIndex(coverRef, assetIds.length);
    if (index === undefined) {
      return handoffOpen({ reason: `I could not map "${coverRef}" to a specific photo in the "${albumName}" album.` });
    }
    if (index < 1 || index > assetIds.length) {
      return needsInput({
        text: `The "${albumName}" album has ${assetIds.length} ${assetIds.length === 1 ? 'photo' : 'photos'}, so I cannot use "${coverRef}". Pick a position in range.`,
      });
    }
    const coverId = assetIds[index - 1];

    let planResult;
    try {
      planResult = await client.call(
        'proposeAlbumOperations',
        {
          summary: `Set the cover of "${albumName}".`,
          operations: [
            {
              type: 'album.setCover',
              summary: 'Set the album cover.',
              targetKind: 'existing_album',
              targetId: album.id,
              assetIds: [coverId],
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
      successText: `I prepared a plan to set the cover of the "${albumName}" album. Review the plan before applying it.`,
      successSummary: { workflowKind: KIND, albumName },
    });
  },
});
```

### B. module tests (red → green)

`set-album-cover.test.mjs`: `const wf = setAlbumCoverWorkflow();`. For run tests use
`makeContractClient({ albums:[{ id:'alb-1', albumName:'Family', assetIds:['…a','…b','…c','…d'] }] })`
(use real uuids, e.g. `00000000-0000-4000-8000-00000000000{1..4}`).

- [ ] match: `'set the cover of the Family album to the first photo'` → `{ slots:{ albumRef:'Family', coverRef:'the first photo' } }`;
      `'make the Family album cover the 3rd photo'` → `{ slots:{ albumRef:'Family', coverRef:'3rd' } }`;
      `'pick a better cover for the Family album'` → `undefined`; `'change the cover photo on my Italy album'` → `undefined`;
      `''` → `undefined`; `'rename the Family album to X'` → `undefined`.
- [ ] parseSlots: `{ albumRef:'Family', coverRef:'3rd photo' }` → `{ albumRef:'Family', coverRef:'3rd photo' }`;
      `{ albumRef:'Family' }` → `null`; `{ coverRef:'3rd' }` → `null`.
- [ ] run index "the 3rd photo" vs assetIds=[a,b,c,d]: `slots:{ albumRef:'Family', coverRef:'the 3rd photo' }`
      → `outcome.status==='planned'`; `proposeAlbumOperations.operations[0]` deepEquals
      `{ type:'album.setCover', summary:'Set the album cover.', targetKind:'existing_album', targetId:'alb-1', assetIds:[c] }`
      (no payload key); `JSON.stringify(calls).includes('assetSource')===false`.
- [ ] run "the first photo" → `assetIds:[a]`; run "the last photo" → `assetIds:[d]`.
- [ ] run ambiguous album (two 'Family') → `needs_input`; no propose.
- [ ] run album not found (`albums:[]`) → `needs_input`; no propose.
- [ ] run index out of range ("the 9th photo", 4 assets) → `needs_input`; no propose.
- [ ] run unresolvable cover ("a nicer one") → `handoff_open`; no propose.
- [ ] run gate `{ status:'success', plan:{} }` → `failed`; `/prepared|set the cover/i.test(text)===false`.
- [ ] run `listAlbums` throws → `failed`; `readAlbum` throws → `failed`.
- [ ] identity: `wf.kind==='set_album_cover'`, `wf.flow==='strict'`, `typeof wf.run==='function'`.
- [ ] Run RED → implement A → GREEN.

## Phase 2 — registration + manifest + disambiguation + scenarios

- [ ] `registry.mjs`: import `setAlbumCoverWorkflow`; insert into `WORKFLOW_FACTORIES`
      **immediately after `renameOrDescribeAlbumWorkflow,`** (grouped with the album
      workflows). "cover" is a unique verb (rename's DESCRIBE_PATTERN requires the literal
      "description", so no collision).
- [ ] `manifest.mjs`: add the entry (after the `rename_or_describe_album` entry):

```js
  Object.freeze({
    kind: 'set_album_cover',
    flow: 'strict',
    title: 'Set album cover',
    classifierDescription:
      'User wants to set the cover photo of an existing album to a specific photo identified by position (first, last, or Nth).',
    positiveExamples: Object.freeze([
      'Set the cover of the Family album to the first photo',
      'Make the Family album cover the 3rd photo',
      'Set the cover of my Italy album to the last photo',
    ]),
    negativeExamples: Object.freeze([
      'Pick a better cover for the Family album',
      'Change the cover photo on my Italy album',
      'Rename the Family album to Family 2026',
    ]),
    slots: Object.freeze({
      albumRef: Object.freeze({ type: 'string', required: true, description: 'The album whose cover to set.' }),
      coverRef: Object.freeze({ type: 'string', required: true, description: 'Which photo becomes the cover (first/last/Nth).' }),
    }),
    requiredReadTools: Object.freeze(['listAlbums', 'readAlbum']),
    planTool: 'proposeAlbumOperations',
    supportsContinuation: false,
    matrixRow: Object.freeze({
      capability: 'Set album cover',
      tier: 'Solid now',
      workflowOrBoundary: 'Pi resolves the album + an explicit photo position; Gallery owns the album.setCover plan (cover rides in the asset selection).',
    }),
  }),
```

- [ ] Regenerate: `/opt/homebrew/bin/mise exec -- node agent-runner/src/bin/sync-strict-workflow-manifest.mjs`.
- [ ] `manifest.test.mjs`: add a test — `getWorkflowManifestEntry('set_album_cover').planTool==='proposeAlbumOperations'`;
      `requiredReadTools` deepEquals `['listAlbums','readAlbum']`; `flow==='strict'`.
- [ ] `disambiguation.test.mjs`: add `['set the cover of the Family album to the 3rd photo', 'set_album_cover']`
      and `['make the Family album cover the first photo', 'set_album_cover']`. Verify
      `['rename the Family album to Family 2026', 'rename_or_describe_album']` stays green.
- [ ] `classification-recall.mjs`: append
  - `recall.cover.index` → `'set the cover of the Family album to the 3rd photo'` → `{ kind:'set_album_cover', slotsSurvive:true, slots:{ albumRef:'Family' } }`
  - `recall.cover.first` → `'make the Family album cover the first photo'` → `{ kind:'set_album_cover', slotsSurvive:true, slots:{ albumRef:'Family' } }`
- [ ] `classification-negatives.mjs`: append
  - `neg.cover.subjective` → `'pick a better cover for the Family album'` → `{ kind:'none' }`
  - `neg.cover.unspecified` → `'change the cover photo on my Italy album'` → `{ kind:'none' }`
- [ ] `slot-fidelity.mjs`: append
  - `slots.cover.index` → `'set the cover of the Family album to the 3rd photo'` →
    `{ kind:'set_album_cover', slots:{ albumRef:'Family', coverRef:/3rd|third/i } }`
- [ ] `l3-readonly.mjs`: append
  - `l3.recall.cover` (category `'l3.recall'`) → `'set the cover of the {album} album to the first photo'` → `{ kind:'set_album_cover' }`
  - `l3.plan.cover.index` (category `'l3.plan'`, `threshold:0.5`) →
    `'set the cover of the {album} album to the first photo'` → `{ kind:'set_album_cover', planProposed:true }`
  - `l3.neg.cover.subjective` (category `'l3.negatives'`) → `'pick a better cover for {album}'` → `{ kind:'none' }`

Run `mise exec -- pnpm --dir agent-runner test` → all green.

## Part C — eval runs (controller-driven)

- [ ] L1 full `eval/run.mjs --diff`: confirm `recall.cover.*` route, `neg.cover.*` → none,
      `slots.cover.index` ok, NO regression. (Do NOT `--accept` — deferred to the final slice.)
- [ ] L3: at the final RC. **Open Q5:** verify `readAlbum.assetIds` ordering matches the UI
      so "first photo" picks the right asset (L3 plan-proposed is the live check).

## Edge cases

- STRICT BOUNDARY: only an EXPLICIT position (first/last/Nth) resolves; subjective
  "better/nicer cover" or a free-text visual description → handoff. Out-of-range → needs_input.
- cover rides in `assetIds:[coverId]` (NOT a payload field); exactly-one selection (no
  assetSource/handle); `targetKind:'existing_album'` + `targetId`.
- registry: "set the cover …" not stolen by rename's DESCRIBE_PATTERN (needs "description").

## Acceptance

- `set_album_cover` routes + resolves an explicit index against `readAlbum.assetIds` +
  plans `album.setCover`, gated; registered + manifest + mirror.
- `mise exec -- pnpm --dir agent-runner test` green; (Part C) L1 --diff clean.

## Commit

- One commit: `feat(agent): add set_album_cover (index resolution + execution + registration + L1/L3) (phase 2 slice 20)`.
