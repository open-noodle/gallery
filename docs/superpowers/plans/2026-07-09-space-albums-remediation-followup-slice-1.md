# Slice 1 — H1: Trashed album assets leak to space members — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement
> this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop a space Viewer from reading an owner's **trashed** album assets (metadata: ids, EXIF/GPS,
people, thumbhash) via `POST /search/metadata` (`albumIds` + trash params) and via
`GET /timeline/bucket?albumId=…&isTrashed=true`.

**Architecture:** The album-granted read scope applies `spaceVisibilityGate` but no `deletedAt` filter.
Add `asset.deletedAt IS NULL` to the search album scope (load-bearing), and reject `isTrashed=true` on
an album/space browse in the timeline service guard (the repo's `deletedAt` filter is a shared
`isTrashed` ternary, so a service-layer reject is the clean close), plus a data-layer belt-and-suspenders.

**Tech Stack:** NestJS, Kysely, vitest (unit/medium), e2e vitest. Server-only, no DTO/SDK change.

## Global Constraints (from spec §0)

- **TDD mandatory.** Red (with positive control) → green → refactor. A test that passes first run is a
  red flag. Every negative test must first prove the positive control (the leak happens without the fix).
- No `this.db` inside Kysely `transaction()`. No Claude co-author trailers. One commit per coherent group.
- Re-confirm exact lines/symbols before editing (references are HEAD `3dfabc41ca`-relative).
- **Consistency:** the `deletedAt IS NULL` added to `albumSharedSpaceScope` here must be **preserved**
  by Phase-2 Slice 6 (L2), which later replaces that branch with a flat gate.

---

### Task 1: Search path — add `deletedAt IS NULL` to `albumSharedSpaceScope` (load-bearing)

**Files:**

- Modify: `server/src/utils/database.ts` — `albumSharedSpaceScope`, plain-album branch (~`:612-624`)
- Test (medium): `server/src/**` search repository medium spec (extend the existing search medium spec
  that exercises `albumSharedSpaceScope`; find it via `grep -rl "albumSharedSpaceScope\|albumIds" server/test/medium server/src/**/*.spec.ts`)

**Interfaces:**

- Consumes: `spaceVisibilityGate(eb)` (already imported in `database.ts`).
- Produces: no signature change; the album search arm now also excludes soft-deleted assets.

- [ ] **Step 1: Write the failing medium test.** In the search medium spec, seed: owner O, album X with
      asset A (Timeline) + sibling B (Timeline); link X into space S; add Viewer V to S. Trash A
      (`asset.deletedAt` set, still an `album_asset` row). Run `searchMetadata` as V with
      `{ albumIds:[X], withDeleted: true }`.
  - **Positive control (asserts the bug exists pre-fix):** a first assertion variant WITHOUT the fix
    would return A. Structure the test so the post-fix assertion is: result ids include B, **exclude A**.
  - Also assert `{ albumIds:[X] }` (no trash params) already excludes A (regression) and includes B.

- [ ] **Step 2: Run it — expect RED.** `cd server && pnpm test -- --run <search-medium-spec>`.
      Expected: the `withDeleted:true` case FAILS because A is present (leak reproduced).

- [ ] **Step 3: Implement.** In `albumSharedSpaceScope`, add to the plain-album `eb.and([...])` branch
      (the one containing `spaceVisibilityGate(eb)` and the two `eb.not(eb.exists(...))` sub-clauses):

```ts
eb.and([
  spaceVisibilityGate(eb),
  eb('asset.deletedAt', 'is', null), // Fork RBAC (Slice 1 / H1): album-granted search must never
                                     // surface the owner's trashed assets, even when the caller flips
                                     // withDeleted via trashedAfter/Before/isOffline.
  eb.not(eb.exists(eb.selectFrom('shared_space_asset').whereRef('shared_space_asset.assetId', '=', 'asset.id'))),
  eb.not(eb.exists(eb.selectFrom('shared_space_library').whereRef('shared_space_library.libraryId', '=', 'asset.libraryId'))),
]),
```

- [ ] **Step 4: Run it — expect GREEN.** Same command. A absent, B present, both trash and non-trash cases.

- [ ] **Step 5: Regenerate SQL docs** if `albumSharedSpaceScope` feeds a `@GenerateSql`-decorated query
      whose doc changed: `cd server && make sql` (scratch migrated DB only — never dev-stack, never without
      a DB). If no decorated query output changed, skip. Verify `git status` shows only intended `.sql` diffs.

- [ ] **Step 6: Commit.**

```bash
git add server/src/utils/database.ts server/src/**/*.spec.ts server/src/queries 2>/dev/null
git commit -m "fix(spaces): exclude trashed album assets from album-granted search (H1)"
```

---

### Task 2: Timeline path — reject `isTrashed` on album/space browse + data-layer belt

**Files:**

- Modify: `server/src/services/timeline.service.ts` — `timeBucketChecks` (~`:127-138`)
- Modify: `server/src/repositories/asset.repository.ts` — album arm in `withTimeBucketAssetFilters`
  (~~`:295`) and the inline copy in `getTimeBucket` (~~`:1368`)
- Test (unit): `server/src/services/timeline.service.spec.ts`
- Test (e2e): `e2e/src/**` — extend the space-albums visibility negatives spec that already pins
  `albumId + visibility=locked → 401` (find via `grep -rl "albumId" e2e/src | xargs grep -l "visibility"`)

**Interfaces:**

- Consumes: existing `spaceBrowse` boolean (already includes `dto.albumId`) at `timeline.service.ts:133`.
- Produces: `timeBucketChecks` throws `BadRequestException` when `spaceBrowse && dto.isTrashed === true`.

- [ ] **Step 1: Write the failing unit test** in `timeline.service.spec.ts`: calling the bucket handler
      with `{ albumId: <uuid>, isTrashed: true }` as a non-owner throws `BadRequestException`. Add a sibling
      positive assertion that `{ albumId, isTrashed: false }` (or undefined) does NOT throw on the trash guard.

- [ ] **Step 2: Run — expect RED.** `cd server && pnpm test -- --run src/services/timeline.service.spec.ts`.
      Expected: FAIL (no throw today for `isTrashed`).

- [ ] **Step 3: Implement the guard.** In `timeBucketChecks`, extend the existing `spaceBrowse` block:

```ts
const spaceBrowse = !!dto.spaceId || !!dto.spacePersonId || !!dto.albumId;
const requestsPrivateVisibility =
  dto.visibility === AssetVisibility.Hidden || dto.visibility === AssetVisibility.Locked;
if (spaceBrowse && requestsPrivateVisibility) {
  throw new BadRequestException('Hidden and locked assets are not available when browsing a shared space or album');
}
// Fork RBAC (Slice 1 / H1): trash is an owner-private state; an album/space browse must never
// enumerate trashed assets. Closes the timeline vector before it reaches the repo.
if (spaceBrowse && dto.isTrashed === true) {
  throw new BadRequestException('Trashed assets are not available when browsing a shared space or album');
}
```

- [ ] **Step 4: Data-layer belt-and-suspenders.** In `asset.repository.ts`, inside the `albumId` `$if`
      block of `withTimeBucketAssetFilters` (~~`:295-300`) add `.where('asset.deletedAt', 'is', null)`, and
      mirror it in the inline `getTimeBucket` copy (~~`:1368-1380`). This forces the album arm to `deletedAt
IS NULL` even if `isTrashed` flips the shared ternary at `:253`/`:1352`. Add a one-line comment tying
      it to H1 and note "keep the two copies in sync" (a comment already flags the sync requirement).

- [ ] **Step 5: Write the failing e2e negatives** (both H1 vectors, one file). In the space-albums
      visibility negatives e2e: owner O uploads A into album X, links X into space S, syncs Viewer V. Assert:
  - **Positive control:** before trashing, V `GET /timeline/bucket?albumId=X&isTrashed=false` (default)
    returns A among the bucket asset ids, AND V `POST /search/metadata { albumIds:[X], withExif:true,
withPeople:true }` returns A with EXIF/people (proves the pipeline surfaces A pre-fix).
  - **Search negative (spec e2e #1):** after trashing A, V `POST /search/metadata { albumIds:[X],
withDeleted:true, withExif:true, withPeople:true }` → **A absent** (no id/checksum/originalPath/
    thumbhash/EXIF/people); sibling B present.
  - **Timeline negative:** after trashing A, V `GET /timeline/bucket?albumId=X&isTrashed=true` → **400**
    (guard) — assert status, not just empty. And `GET /timeline/buckets?albumId=X&isTrashed=true` → 400.
  - A non-trashed sibling B via `isTrashed=false` still returned (no over-block).

- [ ] **Step 6: Run — expect RED then implement is already done → GREEN.** Run the unit + e2e:
      `cd server && pnpm test -- --run src/services/timeline.service.spec.ts` (green) and the e2e file via
      `cd e2e && pnpm test -- --run <file>` (needs the e2e stack; if unavailable in this run, record the
      command + that it must pass in CI, and rely on the unit + medium coverage locally).

- [ ] **Step 7: Commit.**

```bash
git add server/src/services/timeline.service.ts server/src/repositories/asset.repository.ts \
        server/src/services/timeline.service.spec.ts e2e/src
git commit -m "fix(spaces): reject trashed-asset browse on space-linked album timeline (H1 secondary)"
```

---

## Edge cases (must each have an assertion — spec §Slice 1)

- [ ] `withDeleted:false` / no trash params → A already excluded (regression assert, both search + timeline).
- [ ] Owner requesting their own trashed album asset via the album path → **absent** (flat gate, no owner
      exception); owner still finds it via the non-album `userIds` search path → assert that path untouched.
- [ ] `trashedBefore`/`trashedAfter` range matching A → A still absent (search `deletedAt` gate wins).
- [ ] Album linked into two spaces; caller member of neither → nothing; member of one → gated, no trashed.
- [ ] `albumIds` + `personIds` combined → no bypass via the person arm; trashed still excluded.
- [ ] **Hidden** album asset via album search → still excluded (existing `spaceVisibilityGate` coexists
      with the new `deletedAt` filter — regression assert both gates hold together).
- [ ] Non-album direct/space search + timeline paths → regression-assert unchanged.

## Definition of done

- Search medium test + timeline unit test + e2e negatives all green (e2e in CI if not locally runnable).
- `make check-server` + `make lint-server` clean. No SDK/DTO change.
- Two commits pushed. No unrelated edits.
