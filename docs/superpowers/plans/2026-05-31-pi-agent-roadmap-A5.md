# Phase A Slice A5 — `cleanup_duplicates` keeps the sharpest Implementation Plan

> **For agentic workers:** TDD. Steps use `- [ ]` checkboxes.

**Goal:** Extend the `cleanup_duplicates` keep-rule (`pickKeeper`) to rank by `sharpness` BEFORE resolution: favorite > rating > **sharpness** > resolution > age > id. Backward-compatible: null/absent sharpness sorts lowest, so groups without scores behave exactly as today.

**Architecture:** Pure-function change in the agent-runner. `pickKeeper` ranks the per-asset objects from the `listDuplicateGroups` tool response, which now carries `sharpness: number | null` (added server-side in A4). Agent-runner is untyped (duck-typed), so no type edits — just the comparator + tests. No routing/match change → no L1 re-seed. No server/web/OpenAPI.

**File:** `agent-runner/src/strict-workflows/workflows/cleanup-duplicates.mjs` (`pickKeeper` :32-50); test `agent-runner/src/strict-workflows/workflows/cleanup-duplicates.test.mjs` (`makeAsset` :10-18). Test framework: `node:test`. Run: `/opt/homebrew/bin/mise exec -- pnpm --dir agent-runner test` (or `node --test 'src/**/*.test.mjs'`).

---

## Task 1: Add sharpness to the keep-rule (TDD)

- [ ] **Step 1: Failing tests** — In `cleanup-duplicates.test.mjs`:
  - Update `makeAsset` to include `sharpness: overrides.sharpness ?? null`.
  - Add a describe/it block `pickKeeper — sharpness`:

    ```js
    it('prefers the sharper of two equal-resolution duplicates', () => {
      const sharp = makeAsset({ id: 'sharp', width: 1000, height: 1000, sharpness: 80 });
      const blurry = makeAsset({ id: 'blurry', width: 1000, height: 1000, sharpness: 20 });
      const { keeper, nonKeepers } = pickKeeper([blurry, sharp]);
      assert.equal(keeper.id, 'sharp');
      assert.deepEqual(
        nonKeepers.map((a) => a.id),
        ['blurry'],
      );
    });

    it('ranks present sharpness above resolution (sharper-but-smaller wins)', () => {
      const sharpSmall = makeAsset({ id: 'sharpSmall', width: 800, height: 600, sharpness: 90 });
      const blurryBig = makeAsset({ id: 'blurryBig', width: 4000, height: 3000, sharpness: 10 });
      const { keeper } = pickKeeper([blurryBig, sharpSmall]);
      assert.equal(keeper.id, 'sharpSmall');
    });

    it('falls back to resolution when sharpness is null on both', () => {
      const big = makeAsset({ id: 'big', width: 4000, height: 3000, sharpness: null });
      const small = makeAsset({ id: 'small', width: 800, height: 600, sharpness: null });
      const { keeper } = pickKeeper([small, big]);
      assert.equal(keeper.id, 'big');
    });

    it('treats null sharpness as lowest (scored asset wins over unscored at equal resolution)', () => {
      const scored = makeAsset({ id: 'scored', width: 1000, height: 1000, sharpness: 5 });
      const unscored = makeAsset({ id: 'unscored', width: 1000, height: 1000, sharpness: null });
      const { keeper } = pickKeeper([unscored, scored]);
      assert.equal(keeper.id, 'scored');
    });

    it('all-null sharpness is identical to the pre-sharpness behavior (resolution decides, then age, then id)', () => {
      const a = makeAsset({ id: 'a', width: 1000, height: 1000, fileCreatedAt: '2025-01-02T00:00:00.000Z' });
      const b = makeAsset({ id: 'b', width: 1000, height: 1000, fileCreatedAt: '2025-01-01T00:00:00.000Z' });
      const { keeper } = pickKeeper([a, b]);
      assert.equal(keeper.id, 'b'); // older wins at equal resolution + null sharpness
    });
    ```

  - Update the existing priority-chain test (the `favorite > rating > resolution > date > id` one) to insert a sharpness asset and rename/extend its assertion so the chain reads favorite > rating > sharpness > resolution > date > id. Keep its existing assertions valid (favorite still wins).
    Run: `/opt/homebrew/bin/mise exec -- pnpm --dir agent-runner test` → RED on the new sharpness tests (current `pickKeeper` ignores sharpness, so `ranks present sharpness above resolution` and `prefers the sharper` fail).

- [ ] **Step 2: Implement** — In `cleanup-duplicates.mjs` `pickKeeper`, add sharpness to `score` and a comparison between rating and resolution:

  ```js
  const score = (a) => [
    a.isFavorite ? 1 : 0,
    typeof a.rating === 'number' ? a.rating : -1,
    typeof a.sharpness === 'number' ? a.sharpness : -1,
    (a.width ?? 0) * (a.height ?? 0),
  ];
  const sorted = [...assets].sort((a, b) => {
    const [fa, ra, sha, sa] = score(a);
    const [fb, rb, shb, sb] = score(b);
    if (fa !== fb) return fb - fa; // favorite first
    if (ra !== rb) return rb - ra; // higher rating
    if (sha !== shb) return shb - sha; // sharper first
    if (sa !== sb) return sb - sa; // larger resolution
    const ta = Date.parse(a.fileCreatedAt) || 0;
    const tb = Date.parse(b.fileCreatedAt) || 0;
    if (ta !== tb) return ta - tb; // older first (keep the original)
    return String(a.id).localeCompare(String(b.id));
  });
  ```

- [ ] **Step 3: Green** — Run `/opt/homebrew/bin/mise exec -- pnpm --dir agent-runner test` → all pass (new + existing).

- [ ] **Step 4: Commit + push**
  ```bash
  cd /Users/pierre/dev/gallery/.worktrees/explore-pi-agent-brainstorm
  git add agent-runner/src/strict-workflows/workflows/cleanup-duplicates.mjs agent-runner/src/strict-workflows/workflows/cleanup-duplicates.test.mjs
  git commit -m "feat(agent): cleanup_duplicates keep-rule prefers the sharpest (roadmap A5)"
  git push
  ```

---

## Self-Review (against spec A5)

- **`pickKeeper` prefers the sharper of two equal-resolution dupes** → test 1. ✅
- **null sharpness falls back to resolution** → tests 3 (both null → resolution) & 4 (scored beats unscored). ✅
- **ties deterministic** → existing id-lexicographic tiebreak unchanged; all-null test 5 confirms age/id fallback. ✅
- **all null sharpness → identical to current behavior** → test 5. ✅
- **mixed null/present** → test 4. ✅
- **Order favorite > rating > sharpness > resolution > age > id** → implemented; chain test updated. ✅

**No L1/L3/server/web here.** A5 is L2-only (routing/match/tool I-O unchanged; sharpness already in the A4 tool response). Agent-runner is NOT in CI — `babysit` won't gate it; the local `node --test` run is the gate (note this in the commit/PR).
