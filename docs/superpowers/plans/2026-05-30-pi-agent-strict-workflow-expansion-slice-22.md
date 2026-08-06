# Workflow Expansion — Slice 22: `create_album_from_source` execution

> Test-first against the contract-faithful fake client.

**Goal:** Add `run()`: resolver → `proposeAlbumFromSelection({ albumName, selectionHandleId })`
→ `gatePlanResult` → copy. `handoff`/`empty`/tool-error →
`handoff_open`/`needs_input`/`failed`. No raw ids.

**Spec scope:** Slice 22. **Verified DTO:** `proposeAlbumFromSelection` =
`{ summary?, albumName, description?, selectionHandleId }` (selectionHandleId uuid).

## Design — `run({ client, slots, signal })`

```
const albumName = clean(slots?.albumName) || DEFAULT_NAME;     // 'New Album'
const sourceDescription = clean(slots?.sourceDescription);

let resolution;
try { resolution = await resolveAssetSource({ client, sourceDescription, signal }); }
catch (error) { return failed({ text: safeFailureText(error?.message ?? 'The search tool failed.') }); }
if (resolution.status === 'handoff') return handoffOpen({ reason: resolution.reason });
if (resolution.status === 'empty') {
  return needsInput({ text: `I could not find any photos matching "${sourceDescription}". Can you describe them differently?` });
}
const { selectionHandleId, assetCount } = resolution;

let planResult;
try {
  planResult = await client.call(
    'proposeAlbumFromSelection',
    { summary: `Create the "${albumName}" album.`, albumName, selectionHandleId },
    { signal },
  );
} catch (error) { return failed({ text: safeFailureText(error?.message ?? 'The planning tool failed.') }); }

return gatePlanResult({
  planResult,
  planTool: 'proposeAlbumFromSelection',
  successText: `I prepared a plan to create the "${albumName}" album with ${assetCount} matching ${assetCount === 1 ? 'photo' : 'photos'}. Review the plan before applying it.`,
  successSummary: { workflowKind: KIND, albumName, assetCount },
});
```

Imports: `resolveAssetSource` (extend resolver import), `failed`, `handoffOpen`,
`needsInput`, `gatePlanResult`, `safeFailureText`. Registry/manifest: Slice 23.

## TDD — exact tests (add to `create-album-from-source.test.mjs`)

`import { makeContractClient } from './contract-fixtures.mjs';`; flip router-only
`typeof wf.run` to `'function'`.

- [ ] **recency source planned (explicit name, no raw ids):** `wf.run({ client, slots: { sourceDescription: 'my newest 50 photos', albumName: 'Recent' } })`
      → `planned`; recorded `proposeAlbumFromSelection.args` deepEquals
      `{ summary: 'Create the "Recent" album.', albumName: 'Recent', selectionHandleId: 'handle-1' }`;
      `JSON.stringify(client.calls).includes('assetIds') === false`.
- [ ] **default name when missing:** `wf.run({ client, slots: { sourceDescription: 'my newest 50 photos' } })`
      → propose `albumName === 'New Album'`.
- [ ] **date source plans (resolver integration):** `wf.run({ client, slots: { sourceDescription: 'my photos from 2024', albumName: 'X' } })`
      → planned; the `searchAssets` call carries the 2024 `takenAfter/takenBefore` filters.
- [ ] **subjective → handoff:** `{ sourceDescription: 'the good ones', albumName: 'X' }` → `handoff_open`; no propose.
- [ ] **location source → handoff:** `{ sourceDescription: 'my Berlin photos', albumName: 'X' }` → `handoff_open`; no propose.
- [ ] **zero → needs_input:** `makeContractClient({ handleAssetCount: 0 })`, `{ sourceDescription: 'my newest 10 photos', albumName: 'X' }` → `needs_input`; no propose.
- [ ] **planless → failed (gate), no success copy:** `makeContractClient({ planResult: { status: 'success', plan: {} } })` → `failed`; text excludes `/prepared|created/i`.
- [ ] **search error → failed.**

## Edge cases covered

- recency + date source plan; explicit vs default name; subjective + location →
  handoff; zero → needs_input; gate blocks planless copy; selection handle only.

## Run / acceptance

```
export PATH="/Users/pierre/.local/share/mise/installs/node/24.14.1/bin:$PATH"
node --test 'agent-runner/src/**/*.test.mjs'
```

- New execution tests green; all prior green; `typeof wf.run === 'function'`.

## Commit

`feat: add create_album_from_source execution (album-from-selection plan) (slice 22)`
