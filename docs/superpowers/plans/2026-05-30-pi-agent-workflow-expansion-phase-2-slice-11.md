# Pi Agent Workflow Expansion (Phase 2) — Slice 11 Implementation Plan

> **For agentic workers:** Implement test-first. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Implement `remove_photos_from_album` `run()` as the exact inverse of
`add-photos-to-album`: resolve the album (`listAlbums`, none/>1 → needs_input), resolve
the source (handoff/needs_input/empty), then `proposeAlbumOperations([album.removeAssets])`
over the handle, gated. **EMPTY-REMOVAL SAFETY: a zero-asset resolution → needs_input,
NEVER an empty removal.** Add an `album.removeAssets` validator to the contract fixture so
a wrong-shape op throws in L2.

**Spec scope:** Slice 11 of
`docs/superpowers/specs/2026-05-30-pi-agent-workflow-expansion-phase-2-design.md`.

**Tech stack:** Node.js ESM, `node:test`, `mise exec -- pnpm --dir agent-runner test`.

**Files:**

- `agent-runner/src/strict-workflows/workflows/remove-photos-from-album.mjs`
- `agent-runner/src/strict-workflows/workflows/remove-photos-from-album.test.mjs`
- `agent-runner/src/strict-workflows/workflows/contract-fixtures.mjs` (album.removeAssets validator)

## Verified facts

- `album.removeAssets` is already in `KNOWN_OPERATION_TYPES`, but no field validator
  exists — add one (mirrors the `SPACE_OP_VALIDATORS` pattern).
- The op shape (from add-photos `album.addAssets`, inverted): `{ type:'album.removeAssets',
targetKind:'existing_album', targetId, assetSource:{ kind:'selectionHandle',
selectionHandleId } }` — NO per-op `summary`, NO `payload`, NO `temporaryTargetId`.
- `makeContractClient({ planResult })` overrides the propose result; default
  `{ status:'success', plan:{ id:'plan-1' } }`.

## Implementation (exact)

### A. `contract-fixtures.mjs` — album.removeAssets validator

Add near `SPACE_OP_VALIDATORS`:

```js
const validateAlbumRemoveAssets = (op) => {
  if (op.targetKind !== 'existing_album') fail('album.removeAssets requires targetKind "existing_album"');
  if (!op.targetId) fail('album.removeAssets requires targetId');
  if (op.temporaryTargetId !== undefined) fail('album.removeAssets must not set temporaryTargetId');
  const source = op.assetSource;
  if (!source || source.kind !== 'selectionHandle' || !source.selectionHandleId) {
    fail('album.removeAssets requires an assetSource selectionHandle');
  }
};

const ALBUM_OP_VALIDATORS = {
  'album.removeAssets': validateAlbumRemoveAssets,
};
```

In `validateOperations`, after the `SPACE_OP_VALIDATORS[op.type]?.(op);` line, add:

```js
ALBUM_OP_VALIDATORS[op.type]?.(op);
```

### B. `remove-photos-from-album.mjs` — replace imports + the stub run()

Replace the import lines:

```js
import { resolveAssetSource } from '../asset-source-resolver.mjs';
import { failed, handoffOpen, needsInput } from '../protocol.mjs';
import { gatePlanResult, safeFailureText } from './plan-gate.mjs';
```

(`SUBJECTIVE_PATTERN` is still used by the router decline gate — KEEP its import. Combine:
`import { SUBJECTIVE_PATTERN, resolveAssetSource } from '../asset-source-resolver.mjs';`)

Add the album resolver helper (near `normalizeAlbumRef`):

```js
const resolveAlbum = async ({ client, albumRef, signal }) => {
  const ref = normalizeAlbumRef(albumRef);
  const result = await client.call('listAlbums', {}, { signal });
  const albums = Array.isArray(result?.albums) ? result.albums : [];
  const matches = albums.filter((album) => clean(album?.albumName).toLowerCase() === ref.toLowerCase());
  return { ref, albums, matches };
};
```

Replace the stub `run()` with:

```js
  async run({ client, slots, signal }) {
    const sourceDescription = cleanSource(slots?.sourceDescription);

    // 1. Resolve the target album (none/ambiguous → ask).
    const { ref, matches } = await resolveAlbum({ client, albumRef: slots?.albumRef, signal });
    if (matches.length === 0) {
      return needsInput({ text: `I could not find an album called "${ref}". Which album do you mean?` });
    }
    if (matches.length > 1) {
      return needsInput({ text: `Multiple albums are called "${ref}". Which one do you mean?` });
    }
    const album = matches[0];
    const albumName = clean(album.albumName) || ref;

    // 2. Resolve the source into a selection handle (shared resolver).
    let resolution;
    try {
      resolution = await resolveAssetSource({ client, sourceDescription, signal });
    } catch (error) {
      return failed({ text: safeFailureText(error?.message ?? 'The search tool failed.') });
    }
    if (resolution.status === 'handoff') {
      return handoffOpen({ reason: resolution.reason });
    }
    if (resolution.status === 'needs_input') {
      return needsInput({ text: resolution.text });
    }
    // EMPTY-REMOVAL SAFETY: never propose removing nothing (a silent no-op).
    if (resolution.status === 'empty') {
      return needsInput({
        text: `I could not find any photos matching "${sourceDescription}" to remove from the "${albumName}" album. Can you describe them differently?`,
      });
    }
    const { selectionHandleId, assetCount } = resolution;

    // 3. Propose the removal via the selection handle. No raw asset ids reach the model.
    let planResult;
    try {
      planResult = await client.call(
        'proposeAlbumOperations',
        {
          summary: `Remove matching photos from "${albumName}".`,
          operations: [
            {
              type: 'album.removeAssets',
              targetKind: 'existing_album',
              targetId: album.id,
              assetSource: { kind: 'selectionHandle', selectionHandleId },
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
      successText: `I prepared a plan to remove ${assetCount} matching ${assetCount === 1 ? 'photo' : 'photos'} from the "${albumName}" album. Review the plan before applying it.`,
      successSummary: { workflowKind: KIND, albumName, assetCount },
    });
  },
```

## TDD steps

### Task 1: tests (red)

Add a `describe('remove_photos_from_album execution')` block (import `makeContractClient`).

- [ ] planned: `wf.run({ client: makeContractClient(), slots:{ albumRef:'Family', sourceDescription:'my newest 20 photos' } })`
      → `outcome.status==='planned'`; the `searchAssets` call has `mode:'metadata'`, `order:'desc'`,
      `limit:20`, `args.query===undefined`; the `proposeAlbumOperations` `operations[0]` deepEquals
      `{ type:'album.removeAssets', targetKind:'existing_album', targetId:'alb-1', assetSource:{ kind:'selectionHandle', selectionHandleId:'handle-1' } }`;
      `JSON.stringify(client.calls).includes('assetIds')===false`; `resolveAssetSearchFilters` NOT called.
- [ ] date source `'my photos from 2024'` → planned; `searchAssets.filters` deepEquals
      `{ takenAfter:'2024-01-01T00:00:00.000Z', takenBefore:'2024-12-31T23:59:59.999Z' }`; op type `'album.removeAssets'`.
- [ ] media-type `'my videos from 2024'` → planned; `searchAssets.filters` includes `type:'VIDEO'`.
- [ ] EMPTY-REMOVAL SAFETY: `makeContractClient({ handleAssetCount:0 })`, source `'newest 10 photos'`
      → `outcome.status==='needs_input'` AND `proposeAlbumOperations` NOT called.
- [ ] album not found: `makeContractClient({ albums:[] })`, albumRef `'Nope'` → `needs_input`; no `searchAssets`/propose.
- [ ] ambiguous album: `makeContractClient({ albums:[{ id:'a1', albumName:'Family' }, { id:'a2', albumName:'Family' }] })`
      → `needs_input`; no propose.
- [ ] unbounded source `'newest pics'` → `handoff_open`; neither `searchAssets` nor `proposeAlbumOperations` called.
- [ ] subjective source `'the good ones'` → `handoff_open`; `proposeAlbumOperations` NOT called.
- [ ] `searchAssets` throws → `failed` (wrap a client whose searchAssets throws).
- [ ] `proposeAlbumOperations` returns an error: `makeContractClient({ planResult:{ status:'error' } })`
      → `outcome.status==='failed'` AND `/prepared|remove \d/i.test(outcome.text)===false`.
- [ ] success copy/summary: planned run →
      `outcome.successSummary` deepEquals `{ workflowKind:'remove_photos_from_album', albumName:'Family', assetCount:20 }`;
      `outcome.text` matches `/remove/i`, includes `20` and `Family`, and does NOT match `/\badd\b/i`.
- [ ] singular copy: `makeContractClient({ handleAssetCount:1 })` → `outcome.text` contains `1 photo` (not `1 photos`).
- [ ] FIXTURE wrong-shape: `makeContractClient().call('proposeAlbumOperations', { summary:'x', operations:[{ type:'album.removeAssets', targetKind:'new_album', targetId:'a', assetSource:{ kind:'selectionHandle', selectionHandleId:'h' } }] })`
      rejects `/existing_album/i`; a removeAssets op missing `targetId` rejects `/targetId/i`; one with
      `temporaryTargetId:'t'` rejects `/temporaryTargetId/i`.
- [ ] Run `mise exec -- pnpm --dir agent-runner test` → RED (run() is the stub).

### Task 2: implement (green)

- [ ] Apply edits A and B. Run `mise exec -- pnpm --dir agent-runner test` → all green.

## Edge cases (covered above)

- EMPTY-REMOVAL SAFETY: zero-asset → needs_input, propose NOT called.
- `existing_album` + `targetId` required; `new_album` rejected; no `temporaryTargetId`; no payload.
- recency source sends NO `query`; date/type sources add filters; `resolveAssetSearchFilters`
  only for entity sources (recency uses just `searchAssets`).
- handoff vs failed channels kept distinct (clean handoff reason → handoff_open; thrown error → failed).
- singular/plural copy; no raw asset ids; copy says "remove", never "add".

## Acceptance

- `run()` plans an `album.removeAssets` over a resolved handle, gated, never an empty
  removal; the fixture throws on a wrong-shape removeAssets op.
- `mise exec -- pnpm --dir agent-runner test` green; not registered yet (Slice 12).

## Commit

- One commit: `feat(agent): remove_photos_from_album execution — album.removeAssets, never an empty removal (phase 2 slice 11)`.
