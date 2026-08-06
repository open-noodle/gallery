# Trash + Duplicate Cleanup — Slice 6 Implementation Plan

Spec: `docs/superpowers/specs/2026-05-31-pi-agent-trash-and-duplicate-cleanup-design.md`
Slice: 6 — agent-runner `cleanup_duplicates` workflow (deterministic keep-best, trash the rest).

Builds on Slice 5 (`listDuplicateGroups`) + Slices 1–3 (`asset.trash`).

## Goal

Route "clean up duplicates" phrasing to a workflow that reads the duplicate groups,
keeps one asset per group by a deterministic rule, and proposes ONE reversible,
High-risk `asset.trash` over the explicit non-keeper asset ids.

## Design

### Relax the fixture `validateAssetTrash` (faithful selection)

The real `asset.trash` op accepts EXACTLY ONE of `assetSource{selectionHandle}` /
`assetIds` / `assetSelectionHandleId` (`validateAssetSelection`). The Slice-2
fixture only accepts a selectionHandle. Update `validateAssetTrash`
(`contract-fixtures.mjs`) to accept any valid single mechanism (and reject zero or
multiple): a `selectionHandle` assetSource with an id, OR a non-empty `assetIds`
array, OR an `assetSelectionHandleId`. This is required because duplicate cleanup
trashes explicit ids.

### `cleanup_duplicates.mjs`

```js
import { failed, handoffOpen } from '../protocol.mjs';
import { gatePlanResult, safeFailureText } from './plan-gate.mjs';

const KIND = 'cleanup_duplicates';
const clean = (v) => (typeof v === 'string' ? v.trim() : '');

// Must require the "duplicate(s)/dupe(s)" keyword so trash_assets/others don't own it.
const PATTERNS = [
  /\b(?:clean\s*up|remove|delete|trash|find|get\s+rid\s+of|deduplicate|dedupe|merge)\b[^]*\bdup(?:licate|e)s?\b/i,
  /\bdup(?:licate|e)s?\b[^]*\b(?:clean\s*up|cleanup|removal)\b/i,
];

// Deterministic keeper: favorite > higher rating > larger resolution > older
// fileCreatedAt > lexicographic id. Returns { keeper, nonKeepers }.
export const pickKeeper = (assets) => {
  const score = (a) => [
    a.isFavorite ? 1 : 0,
    typeof a.rating === 'number' ? a.rating : -1,
    (a.width ?? 0) * (a.height ?? 0),
  ];
  const sorted = [...assets].sort((a, b) => {
    const [fa, ra, sa] = score(a);
    const [fb, rb, sb] = score(b);
    if (fa !== fb) return fb - fa; // favorite first
    if (ra !== rb) return rb - ra; // higher rating
    if (sa !== sb) return sb - sa; // larger resolution
    const ta = Date.parse(a.fileCreatedAt) || 0;
    const tb = Date.parse(b.fileCreatedAt) || 0;
    if (ta !== tb) return ta - tb; // older first (keep the original)
    return String(a.id).localeCompare(String(b.id));
  });
  return { keeper: sorted[0], nonKeepers: sorted.slice(1) };
};

export const cleanupDuplicatesWorkflow = () => ({
  kind: KIND,
  flow: 'hybrid',
  match(prompt) {
    const text = clean(prompt);
    if (!text) return undefined;
    return PATTERNS.some((p) => p.test(text)) ? { slots: {} } : undefined;
  },
  parseSlots() {
    return {}; // no slots; the duplicate set is read from the tool
  },
  async run({ client, signal }) {
    let result;
    try {
      result = await client.call('listDuplicateGroups', {}, { signal });
    } catch (error) {
      return failed({ text: safeFailureText(error?.message ?? 'The duplicate lookup failed.') });
    }
    const groups = Array.isArray(result?.groups) ? result.groups : [];
    if (groups.length === 0) {
      return handoffOpen({ reason: 'No duplicate groups were found to clean up.' });
    }
    const nonKeeperIds = [];
    for (const group of groups) {
      const assets = Array.isArray(group?.assets) ? group.assets : [];
      if (assets.length < 2) continue;
      const { nonKeepers } = pickKeeper(assets);
      for (const a of nonKeepers) if (a?.id) nonKeeperIds.push(a.id);
    }
    if (nonKeeperIds.length === 0) {
      return handoffOpen({ reason: 'Every duplicate group has only one keeper; nothing to trash.' });
    }

    let planResult;
    try {
      planResult = await client.call(
        'proposeAlbumOperations',
        {
          summary: `Trash ${nonKeeperIds.length} duplicate photos, keeping the best of each group.`,
          operations: [
            {
              type: 'asset.trash',
              summary: 'Move duplicate photos to Trash (recoverable), keeping one per group.',
              targetKind: 'asset_batch',
              assetIds: nonKeeperIds,
              riskLevel: 'high',
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
      successText: `I found ${groups.length} duplicate ${groups.length === 1 ? 'group' : 'groups'} and prepared a plan to move ${nonKeeperIds.length} duplicate ${nonKeeperIds.length === 1 ? 'photo' : 'photos'} to Trash — keeping the favorite / highest-rated / largest of each group. They can be restored from Trash. Review the plan before applying it.`,
      successSummary: { workflowKind: KIND, groupCount: groups.length, trashCount: nonKeeperIds.length },
    });
  },
});
```

(Confirm helper signatures against existing workflows. Tune the match regex under
TDD so the cases below pass.)

### registry.mjs

Import `cleanupDuplicatesWorkflow`; register it BEFORE `trashAssetsWorkflow` so
"trash duplicates" / "delete duplicate photos" route to cleanup (the duplicate
keyword wins), not generic trash. Extend the order comment.

### manifest.mjs (+ mirror) + matrix Flow Ownership row

- Entry: `kind:'cleanup_duplicates'`, `flow:'hybrid'`, `title:'Clean up duplicate photos'`,
  classifierDescription "User wants to find and remove near-duplicate photos,
  keeping the best of each group (reversible Trash).", positives ["Clean up my
  duplicate photos","Find and remove duplicates","Trash duplicate photos","Dedupe
  my library"], negatives ["Trash my newest 20 photos","Delete the Family album",
  "Find my best photos"], slots `{}`,
  `requiredReadTools:['listDuplicateGroups']`, `planTool:'proposeAlbumOperations'`,
  `supportsContinuation:false`,
  `matrixRow:{ capability:'Duplicate cleanup', tier:'Solid now', flow:'Hybrid' }`.
- Regenerate mirror; add a `| Duplicate cleanup | Hybrid | … |` Flow Ownership row
  to the matrix (required for the per-entry agreement test); regen the generated
  block; prettier the doc.

## TDD steps

### Task 1: failing tests (red)

`cleanup-duplicates.test.mjs`:

- `pickKeeper` unit tests (crafted groups): favorite wins; then higher rating;
  then larger resolution; then older fileCreatedAt; then id. Ties resolve
  deterministically. Returns the right keeper + non-keepers.
- `match` accepts: "clean up my duplicate photos", "find and remove duplicates",
  "trash duplicate photos", "dedupe my library", "get rid of duplicates".
  Rejects: "trash my newest 20 photos" (no duplicate keyword → trash_assets),
  "find my best photos", "delete the Family album".
- `run` (contract fixture, config-driven groups): proposes ONE `asset.trash` op
  over the explicit non-keeper `assetIds` (assert the ids are the non-keepers, the
  keeper is NOT trashed); gated; success text discloses the keep rule + counts.
  No groups → `handoffOpen` (no plan). Every group size 1 → `handoffOpen`.
  listDuplicateGroups throws → `failed`. The op passes the (relaxed) fixture
  `validateAssetTrash` with `assetIds`.

`contract-fixtures.test.mjs`: the relaxed `validateAssetTrash` now accepts an
`assetIds` trash op and still rejects zero/multiple selection mechanisms + payload.

### Task 2: implement (green)

Module + relaxed validator + registry + manifest (+ mirror) + matrix row + regen.

```bash
/opt/homebrew/bin/mise exec -- pnpm --dir agent-runner test
/opt/homebrew/bin/mise exec -- pnpm -C server test -- --run src/services/agent-capability-matrix.spec.ts
```

### Task 3: L1 scenarios + baseline

Recall: "clean up my duplicate photos" → `cleanup_duplicates`. Negative: "trash my
newest 20 photos" → `trash_assets` (already covered). Run `--runs 5`; re-seed
`baseline.json` to 100%; confirm no neighbor regressions (esp. trash_assets).

## Edge cases (covered)

- Duplicate keyword required (no collision with trash_assets).
- No duplicate groups → handoff (direct answer, no plan).
- All groups size 1 → handoff (no plan). (listDuplicateGroups already filters
  size-≤1, so this is defensive.)
- Keeper is never trashed (assert).
- Keep-rule ties resolve deterministically.
- The trash op uses explicit `assetIds` (not a broad source); High risk; reversible.

## Acceptance

- `cleanup-duplicates.test.mjs` + the relaxed fixture tests green; full agent-runner
  suite green; matrix spec green; L1 100%.
- Keeper preserved; non-keepers trashed; reversible; High risk.

## Commit

`feat(agent): add cleanup_duplicates workflow (keep-best, trash the rest via asset.trash)`
