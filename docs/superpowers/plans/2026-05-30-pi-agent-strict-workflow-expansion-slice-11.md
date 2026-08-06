# Workflow Expansion — Slice 11: Group 1 manifest, capability regen & L1 scenarios

> Integration slice. Registers archive/favorite/tag, regenerates the manifest
> mirror + capability matrix, and adds the L1 eval battery. Test-first where it
> applies (manifest mirror parity); the L1 battery is run against the local model.

**Goal:** Make the three Group-1 workflows routable (regex + LLM) and visible in
the capability matrix, with L1 recall/slot/negative coverage.

**Spec scope:** Slice 11. **Depends on:** Slices 5-10 (the three modules with
`run`), the manifest/registry/sync machinery, the L1 driver + scenarios, the local
model (reachable at `127.0.0.1:8080`).

## Steps

### 1. Register the factories (`registry.mjs`)

Import `archiveAssetsWorkflow`, `favoriteAssetsWorkflow`, `tagAssetsWorkflow`.
Order in `WORKFLOW_FACTORIES` (regex fast-path is first-match-wins):

```
[ createRecentTripAlbumWorkflow,
  renameOrDescribeAlbumWorkflow,
  archiveAssetsWorkflow,
  favoriteAssetsWorkflow,
  tagAssetsWorkflow,
  addPhotosToAlbumWorkflow ]   // add_photos LAST
```

**Why add_photos last:** its `add <source> to <album>` regex would otherwise steal
`"add the tag Travel to my newest 20"`. `tag_assets` must be tried first. Verified
safe in the other direction: archive/favorite/tag patterns do not match the
add_photos canonical/paraphrase prompts (`"add my newest 20 photos to Family"`,
`"add my Berlin photos … to the Trips album"`), and `"add the good ones to Family"`
still declines to `none`.

### 2. Manifest entries (`manifest.mjs`)

Append three frozen entries (after `add_photos_to_album`), mirroring the existing
shape. `requiredReadTools: ['searchAssets']` (the resolver calls only `searchAssets`
— never `resolveAssetSearchFilters`). `planTool: 'proposeAssetBatchFromSelection'`,
`supportsContinuation: false`.

- **archive_assets** — flow hybrid, title "Archive or unarchive photos".
  - classifierDescription: "User wants to archive or unarchive a metadata-describable set of photos (recency/date/type bound)."
  - positiveExamples: `['Archive my newest 50 photos', 'Unarchive my last 10 photos', 'Move my 2024 videos out of the archive']`
  - negativeExamples: `['Archive the best photos from last weekend', 'Archive the Family album', 'Add my newest 20 photos to Family']`
  - slots: `{ archived: { type:'boolean', required:false, description:'true to archive, false to unarchive (default archive).' }, sourceDescription: { type:'string', required:true, description:'Metadata description of the photos to (un)archive.' } }`
  - matrixRow: `{ capability:'Archive or unarchive photos', tier:'Solid now', workflowOrBoundary:'Pi resolves a recency/date/type source; Gallery owns the batch archive plan from the handle.' }`
- **favorite_assets** — flow hybrid, title "Favorite or unfavorite photos".
  - classifierDescription: "User wants to favorite or unfavorite a metadata-describable set of photos."
  - positiveExamples: `['Favorite my newest 10 photos', 'Unfavorite my last 5 photos', 'Like my newest 20 photos']`
  - negativeExamples: `['Favorite the best 3 photos from last weekend', 'Favorite the Family album', 'Add the good ones to Family']`
  - slots: `{ favorite: { type:'boolean', required:false, description:'true to favorite, false to unfavorite (default favorite).' }, sourceDescription: { type:'string', required:true, description:'Metadata description of the photos to (un)favorite.' } }`
  - matrixRow: `{ capability:'Favorite or unfavorite photos', tier:'Solid now', workflowOrBoundary:'Pi resolves a recency/date/type source; Gallery owns the batch favorite plan from the handle.' }`
- **tag_assets** — flow hybrid, title "Tag photos (add)".
  - classifierDescription: "User wants to add a tag to a metadata-describable set of photos (add-only; no tag removal)."
  - positiveExamples: `['Tag my newest 20 photos as Travel', 'Add the tag Spring Break to my newest 50 photos', 'Add the Travel tag to my last 10 photos']`
  - negativeExamples: `['Remove the Travel tag from my newest 20', 'Tag the best ones as Travel', 'Add my newest 20 photos to the Travel album']`
  - slots: `{ sourceDescription: { type:'string', required:true, description:'Metadata description of the photos to tag.' }, tagName: { type:'string', required:true, description:'Tag name to add.' } }`
  - matrixRow: `{ capability:'Tag photos (add)', tier:'Solid now', workflowOrBoundary:'Add-only; Pi resolves the source; Gallery owns the batch tag-add plan from the handle.' }`

### 3. Regenerate the manifest mirror

```
node src/bin/sync-strict-workflow-manifest.mjs        # writes manifest.generated.json
```

`manifest.test.mjs` ("matches the committed JSON mirror") then stays green.

### 4. Regenerate the capability matrix doc

```
cd server && node --experimental-strip-types src/bin/sync-agent-capabilities.ts
node --experimental-strip-types src/bin/sync-agent-capabilities.ts --check   # exit 0
```

Keeps `server/src/services/agent-capability-matrix.spec.ts` green (it asserts the
doc is in sync with the manifest). Prettier-check the matrix doc afterward.

### 5. L1 scenarios

**Recall** (`eval/scenarios/classification-recall.mjs`) — canonical + paraphrase +
uncommon-verb per action; assert `{ kind, slotsSurvive: true, slots }` (booleans
compare via string coercion in the scorer, so `archived: true` works):

- `recall.archive.canonical`: 'archive my newest 50 photos' → archive_assets, `{ archived: true, sourceDescription: /newest 50 photos/i }`.
- `recall.archive.unarchive`: 'move my last 10 photos out of the archive' → `{ archived: false, sourceDescription: /last 10 photos/i }`.
- `recall.archive.uncommon-verb`: 'put my newest 20 photos in the archive' (regex misses → LLM) → archive_assets, slotsSurvive.
- `recall.favorite.canonical`: 'favorite my newest 10 photos' → `{ favorite: true, sourceDescription: /newest 10 photos/i }`.
- `recall.favorite.unfavorite`: 'unfavorite my last 5 photos' → `{ favorite: false }`.
- `recall.favorite.uncommon-verb`: 'add my newest 20 photos to my favorites' (regex misses → LLM) → favorite_assets, slotsSurvive.
- `recall.tag.canonical`: 'tag my newest 20 photos as Travel' → `{ sourceDescription: /newest 20 photos/i, tagName: 'Travel' }`.
- `recall.tag.add-the-tag`: 'add the tag Spring Break to my newest 50 photos' → `{ tagName: 'Spring Break' }` (must NOT route to add_photos_to_album).
- `recall.tag.uncommon-verb`: 'label my newest 20 photos Travel' (regex misses → LLM) → tag_assets, slotsSurvive.

**Slot fidelity** (`eval/scenarios/slot-fidelity.mjs`) — polarity, tag name, recency
count (regex fast-path, deterministic):

- `slots.archive.unarchive-polarity`: 'unarchive my newest 5 photos' → `{ archived: false, sourceDescription: 'my newest 5 photos' }`.
- `slots.favorite.polarity`: 'unfavorite my newest 5 photos' → `{ favorite: false, sourceDescription: 'my newest 5 photos' }`.
- `slots.tag.quoted-name`: 'tag my newest 20 as "Spring Break"' → `{ tagName: 'Spring Break', sourceDescription: 'my newest 20' }`.

**Negatives** (`eval/scenarios/classification-negatives.mjs`):

- KEEP `neg.unsup.favorite` ('favorite the best 3 photos from last weekend') → `none`
  (subjective: regex declines; LLM declines via the negativeExample).
- ADD `neg.tag.removal`: 'remove the Travel tag from my newest 20' → `none`
  (tag removal is out of scope; no add-pattern matches).
- ADD `neg.archive.subjective`: 'archive the best ones' → `none` (subjective declines).
- **RELOCATE** `neg.unsup.archive` ('archive old screenshots from 2024'): it now routes
  to `archive_assets` at classify-time (the resolver hands off "screenshots" only at
  run-time). REMOVE it from negatives; ADD `recall.archive.screenshots`:
  'archive old screenshots from 2024' → `{ kind: 'archive_assets', slotsSurvive: true }`.

### 6. Verify

```
export PATH="/Users/pierre/.local/share/mise/installs/node/24.14.1/bin:$PATH"
node --test 'agent-runner/src/**/*.test.mjs'          # unit suite green (manifest mirror parity)
cd agent-runner && node --env-file-if-exists=.env eval/run.mjs --diff     # L1 vs baseline
```

- Unit suite green (incl. `manifest.test.mjs` mirror parity, registry routing).
- L1: the existing 40 stay passing; the new recall/slot/negative scenarios pass at a
  healthy rate (regex-routable ones deterministic; LLM uncommon-verb ones ≥ a
  reasonable threshold). Then re-seed the baseline: `eval/run.mjs --accept`.
- `server` capability-matrix `--check` exits 0; matrix doc prettier-clean.

## Edge cases covered

- regex precedence: `tag_assets` before `add_photos_to_album` (no theft of
  `add the tag X to Y`); archive/favorite/tag do not steal add/trip/rename prompts.
- subjective archive/favorite → none; tag removal → none.
- screenshots/unresolvable archive source still ROUTES (classify) — resolver handoff
  is a run-time concern, not a routing miss.
- polarity + tag-name + recency-count slot fidelity.

## Commit

`feat: register + manifest Group 1 batch workflows; L1 scenarios + matrix regen (slice 11)`
