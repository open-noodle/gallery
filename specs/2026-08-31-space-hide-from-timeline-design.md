# "Hide from timeline" should actually hide — design

Issue: [#1041](https://github.com/open-noodle/gallery/issues/1041) — _"I mark a Spaces Album as 'Hidden from timeline', but all those pictures still appear in the Space's timeline and the master 'Photos' timeline."_ (v5.5.0-rc.0, web)

Date: 2026-08-31 · Status: design, pending review

---

## 1. Diagnosis

There are two distinct flags, both surfaced with the **same words**:

| Flag                                 | Scope                              | Set by                         | Today's meaning                                                              |
| ------------------------------------ | ---------------------------------- | ------------------------------ | ---------------------------------------------------------------------------- |
| `shared_space_member.showInTimeline` | per **member**, per space          | that member, for themselves    | assets reachable _only_ via this space drop out of my timeline               |
| `shared_space_album.showInTimeline`  | per **space + album** (shared row) | any space editor, for everyone | this album's assets don't flow into the space timeline or members' timelines |

`shared-space-album.table.ts:47`, `shared-space-member.table.ts`.

The reporter used the album one. Both render the identical i18n key:

- space kebab — `web/src/routes/(user)/spaces/[spaceId]/+layout.svelte:247` → `spaces_hide_from_timeline`
- album kebab — `web/src/lib/components/spaces/space-album-card.svelte:42` → `spaces_hide_from_timeline`
- album row — `web/src/lib/components/spaces/space-albums-table.svelte:70` → `spaces_hide_from_timeline`

"Hide from timeline" in both places, two different scopes. That alone explains a large part of the report.

This is not a new discovery — `e2e/src/specs/web/spaces-albums-timeline.e2e-spec.ts:19-23` already
documents both toggles and notes explicitly that their menu items "share the same" name. It was known
and worked around in tests; #1041 is a user hitting it.

### Why nothing hides

Every personal-timeline query is shaped:

```
asset."ownerId" = <viewer>
  OR (visibility gate AND (spaceDirect OR spaceLibrary OR spaceAlbum[showInTimeline = true]))
```

`server/src/utils/shared-space-album-scope.ts:389` (`accessibleTimelineAssetPredicate`), and the Kysely
twin at `server/src/repositories/asset.repository.ts:478`.

The `showInTimeline` gate only ever sits on the **space arm**. The ownership arm is unconditional, so
**no space-level or album-level flag can subtract a photo from its own owner's timeline.** The reporter
owns those photos. Working as built; not what the label promises.

### The space-timeline half of the report

Not reproduced from code. `asset.repository.ts:432` gates a `spaceId` browse with
`requireShowInTimeline: true` and has no owner bypass (`userIds` is undefined for a space browse —
`timeline.service.ts:201`). Two candidate explanations: the photos also reach the space by a
directly-added `shared_space_asset` or a linked library (neither is gated by the album flag), or it is a
separate bug.

> **Slice 0 is to reproduce this before writing code.** See §8.

---

## 2. Semantics

The space toggle becomes the primary, coarse lever; the album toggle is the optional finer knob inside a
space. For an asset the viewer **owns**:

```
shows on my timeline  ⟺  ¬A ∨ V

  A = the asset has ANY path into a space I'm a member of   (any flag state)
  V = the asset has a VISIBLE path — a path into a space where my
      shared_space_member.showInTimeline = true, and, for album paths,
      shared_space_album.showInTimeline = true
```

Non-owned assets are unchanged: they show iff `V` (plus the existing visibility gate).

Since `A = Hpath ∨ V`, this is equivalent to `¬Hpath ∨ V` where `Hpath` = "has a hidden path". **The
implementation uses the `Hpath` form** — see §5, it is the difference between a working query and a 2×
regression.

### Truth table

| Asset's space presence                                | `A` | `V` | Owner's timeline |
| ----------------------------------------------------- | --- | --- | ---------------- |
| in no space at all                                    | ✗   | ✗   | **shows**        |
| only in a hidden album, in a shown space              | ✓   | ✗   | **hidden**       |
| only in a hidden space (any path)                     | ✓   | ✗   | **hidden**       |
| in a hidden album **and** a visible album             | ✓   | ✓   | **shows**        |
| in a hidden album **and** added to the space directly | ✓   | ✓   | **shows**        |
| in hidden space A **and** visible space B             | ✓   | ✓   | **shows**        |
| in a shown space, album shown                         | ✓   | ✓   | **shows**        |

Rule of thumb for the docs: **a photo disappears only when _every_ way it reaches a space is hidden.**

### Two decisions recorded

1. **The space toggle subtracts everything in that space** — direct assets, linked libraries, and every
   linked album — not just album content. This is the fix for #1041's "master Photos timeline" half.
2. **Any visible path wins.** Chosen deliberately: it keeps `/photos` and the space timeline in
   agreement, since the space timeline already resolves paths as an `OR`.

### ⚠ Open question for review

Should the **album** toggle also subtract the owner's own photos, or only the space toggle?

- Argument for **yes**: it is the lever the reporter actually used; "hide from timeline" should mean the
  same thing at both levels.
- Argument for **no**: `shared_space_album.showInTimeline` is a **shared, editor-settable** row. Any
  editor flipping it would remove another member's own photos from that member's own `/photos`. The space
  toggle has no such hazard — `shared_space_member` is per member.

**This design assumes _yes_** (both levels subtract), with the hazard disclosed in the confirm dialog
(§7). Overrule this in review if you'd rather the album flag stay space-scoped.

---

## 3. Surfaces — Archive parity

Archive is the existing "hide from timeline" concept (`docs/docs/FAQ.mdx:114`): hidden from the main
timeline and folder view, still present in search. Match it.

| Surface                     | In scope   | Site                                                                  |
| --------------------------- | ---------- | --------------------------------------------------------------------- |
| `/photos` web timeline      | ✅ slice 1 | `asset.repository.ts:475` **and** `:478` — both owner branches        |
| Timeline scrubber covers    | ✅ free    | `getTimeBucketCovers` (`asset.repository.ts:1545`) — see note below   |
| Mobile timeline + scrubber  | ✅ slice 1 | `mobile/lib/infrastructure/entities/merged_asset.drift:63` and `:166` |
| Folder view                 | ✅ slice 1 | `view-repository.ts:60` `ownedOrSpaceAccessible`                      |
| Memories                    | ✅ slice 2 | `memory.repository.ts:133`, `:169`, `:315`, plus `getByDayOfYear`     |
| Search / smart search       | ❌         | unchanged, like Archive                                               |
| Map                         | ❌         | unchanged                                                             |
| People page counts          | ❌         | unchanged — deliberately, it is already the slowest query             |
| The album/space page itself | ❌         | must always show its own contents                                     |

Three server call sites, not two. `getTimeBuckets`, `getTimeBucket` and `getTimeBucketCovers` all route
through `withTimeBucketAssetFilters`, so editing that one helper covers all three — but the scrubber
counts and the asset list would drift apart if a future change touched only one, which is exactly why
they share the helper today (`asset.repository.ts:1626`).

`asset.repository.ts:475` is easy to miss: it is the `!timelineSpaceIds` branch (`userIds` set, shared
spaces off). A user with `withSharedSpaces=false` must still get the subtraction, so **both** branches
change.

---

## 4. Data and resolution

No schema change. Both flags already exist and already sync.

Resolve once per request, service-side, alongside the existing `getSpaceIdsForTimeline` call
(`timeline.service.ts:82`):

```ts
// SharedSpaceRepository — new, sibling to getSpaceIdsForTimeline (shared-space.repository.ts:360)
getTimelineHiddenScope(userId): Promise<{
  hiddenSpaceIds: string[];       // my member rows with showInTimeline = false
  hiddenAlbumIds: string[];       // for the album_asset arm — see resolution rules
  hiddenAlbumSpacePairs: Array<{ albumId: string; spaceId: string }>;
                                  // for the album_space_asset arm, which MUST carry the space
  hiddenLibraryIds: string[];     // libraries linked to a hidden space (usually empty)
}>
```

**Resolution rules — all four are load-bearing:**

1. **Scope to my memberships.** Every set is derived from `shared_space_member` rows for `userId`. A
   space creator always has one: `shared-space.service.ts:136` inserts an `Owner` member row at
   creation, so `getSpaceIdsForTimeline`'s member-table-only read has no creator gap, and neither does
   this.
2. **`hiddenAlbumIds`** = albums linked to a space in `hiddenSpaceIds`, ∪ albums with
   `shared_space_album.showInTimeline = false` in a space I show, **MINUS** albums also linked _visibly_
   to a space I show. The `MINUS` implements "a visible linked album cancels it" as set arithmetic on a
   tiny set, so it never reaches SQL.
3. **A1 invariant.** Both the hidden set and the cancelling set join `album` and require
   `album.deletedAt IS NULL`. Without this on the hidden side a trashed album keeps hiding photos;
   without it on the cancelling side a trashed album keeps re-admitting them. This is the same
   invariant the whole `shared-space-album-scope.ts` family encodes (`requireAlbumNotDeleted`, default
   true) — pinned by edge case E1.
4. **Contributions carry their space.** `album_space_asset` rows are only ever visible through the
   single space they were contributed to — `spaceContributedAssetExists` correlates
   `album_space_asset.spaceId = shared_space_album.spaceId` for exactly that reason (#764, #1018).
   The hidden side must preserve that dimension, hence `hiddenAlbumSpacePairs` rather than bare album
   ids: hiding album X in space S must **not** hide a contribution made to X in space T.

**Collapse when empty.** If all four are empty — the overwhelmingly common case — emit no extra
predicate at all. This mirrors the existing `hasTimelineSpaces` collapse in
`accessibleTimelineAssetPredicate` (`shared-space-album-scope.ts:393`) and keeps the change free for
every user who has hidden nothing.

---

## 5. Query shape

New fork-owned helper beside the existing family in `src/utils/shared-space-album-scope.ts`:

```ts
export function hiddenFromOwnTimeline(eb: ExpressionBuilder<DB, keyof DB>, scope: TimelineHiddenScope): Expression<SqlBool> | undefined; // undefined ⇒ caller emits nothing
```

emitting, for a non-empty scope (each arm emitted **only** when its own list is non-empty):

```sql
    NOT EXISTS (SELECT 1 FROM shared_space_asset
                 WHERE "spaceId" = ANY(:hiddenSpaceIds) AND "assetId" = asset.id)
AND NOT EXISTS (SELECT 1 FROM album_asset
                 WHERE "albumId" = ANY(:hiddenAlbumIds) AND "assetId" = asset.id)
AND NOT EXISTS (SELECT 1 FROM album_space_asset          -- cross-owner contributions (#764)
                 WHERE ("albumId", "spaceId") = ANY(:hiddenAlbumSpacePairs)
                   AND "assetId" = asset.id)
AND (asset."libraryId" IS NULL OR asset."libraryId" <> ALL(:hiddenLibraryIds))
```

Three things in there are deliberate and were each wrong in an earlier draft of this spec:

- **The library arm is not an `EXISTS`.** Once the service has resolved `hiddenLibraryIds`, a subquery
  buys nothing. More importantly `asset.libraryId` is **nullable**, and `NULL <> ALL (…)` evaluates to
  `NULL`, not `true` — so the bare `<> ALL` form silently subtracts every asset that has no library,
  i.e. most of the timeline. The `IS NULL OR` guard is mandatory. Pinned by edge case E13.
- **The contribution arm keys on `(albumId, spaceId)`**, per resolution rule 4. Pinned by E7b.
- **It attaches to the caller's own id, never to `userIds`.** See below.

### Where it attaches — the partner trap

The owner arm at `asset.repository.ts:478` is `asset.ownerId = anyUuid(options.userIds!)`, and
`userIds` **includes partner ids** (`timeline.service.ts:76-80` pushes `getMyPartnerIds` into it). AND-ing
the subtraction onto that arm would remove a **partner's** photos from my timeline based on **my**
flags — a real access/correctness bug, and one no happy-path test would catch.

The owner arm must therefore be split:

```
(asset."ownerId" = :callerId AND <hiddenFromOwnTimeline>)
OR asset."ownerId" = ANY(:partnerIds)          -- unchanged, no subtraction
OR (visibility gate AND <existing space arms V>)
```

`TimeBucketOptions` needs the caller's own id distinguished from `userIds` for this; today the service
flattens both into one list. Pinned by edge case E10.

The existing space arms (`V`) are untouched and provide the re-admission for free, because an asset with
a visible path is admitted by the last arm of the same `OR`.

Postgres compiles each `NOT EXISTS` to a **hashed SubPlan** — one index scan, `loops=1`, then an O(1)
hash probe per row. Verified in the plan:

```
Filter: ... AND (NOT (ANY (id = (hashed SubPlan 2).col1)))
  SubPlan 2
    ->  Index Only Scan using album_asset_pkey  (rows=1091 loops=1, 0.134 ms)
```

Cost is O(hidden set) once plus O(1) per row — **independent of library size, but linear in hidden-set
size.** The largest hidden set measured was 8.4k asset paths; a user hiding a 50k-photo space builds a
proportionally larger hash. Still one build per query, not per row, so it stays bounded — but it is the
untested end of the curve.

### Forms that were measured and rejected

Do not "simplify" into any of these. **These four were measured with `jit = on`** (before the per-role
GUC trap in §6 was spotted), so read them as a relative ranking against a 546 ms baseline, not as
absolute costs. The chosen form was then re-measured correctly with `jit = off` (§6).

| Form                                              | Scrubber, jit=on | vs its jit=on baseline | Why it fails                                                                          |
| ------------------------------------------------- | ---------------- | ---------------------- | ------------------------------------------------------------------------------------- |
| Chosen: service-resolved id lists                 | 660 ms           | +21%                   | —                                                                                     |
| Joining `shared_space_album` inside the hot query | 687 ms           | +26%                   | rebuilds an 8.4k-row join per request; modestly worse per bucket too (55 ms vs 48 ms) |
| `ownerId = me AND NOT A` over **all** paths       | 899 ms           | +93%                   | probes the full 116k-row path set per row                                             |
| Inlined `NOT IN (… UNION … EXCEPT …)`             | 819 ms           | +51%                   | the `EXCEPT` over the 116k visible set costs more than it saves                       |
| `WITH hidden AS (…)` + correlated `NOT EXISTS`    | **9,300 ms**     | **+1600%**             | a CTE reference cannot be hashed; re-scanned per row                                  |

The last row is the one to guard against in review — it is the most natural-looking refactor and it is
catastrophic. The service-resolved form beats the in-query join only modestly; it is preferred for
plan stability, not because the join is unusable.

---

## 6. Performance

Measured on the personal instance, 2026-08-31: 66,215 timeline assets, 21 linked albums, 116,901
`shared_space_asset` rows, PostgreSQL 18.4, 2-core node. **All figures with `jit = off`**, matching the
per-role GUC the `gallery` application role carries
(`migrations-gallery/1783628194057-DisablePostgresJit.ts`). Median of 4–5 passes.

|                      | Scrubber (`getTimeBuckets`, full library) | Per-bucket (`getTimeBucket`, 4,764 assets) |
| -------------------- | ----------------------------------------- | ------------------------------------------ |
| Baseline today       | 113 ms                                    | 7.4 ms                                     |
| Only an album hidden | 152 ms (+35%)                             | 4.0–5.6 ms (faster)                        |
| A space hidden       | 164 ms (+49%)                             | 47 ms (6.4×)                               |

Those are two states of one shipped feature, not two competing designs — a user with a hidden space is
the worst case and the row to budget against. Hiding only an album is cheaper on the scrubber and
actually _faster_ per bucket, because a hidden album also removes a correlated `EXISTS` arm from the
`OR` that costs more than the hash probe replacing it.

The per-bucket 6.4× is **an artifact of a single-owner library**. Today the owner arm short-circuits, so
the space subqueries are literally `(never executed)` — including a 115k-row hash of
`shared_space_asset`. Under the new rule the handful of hidden assets fall through to the visible-path
check, forcing that hash to be built (14.8 ms) plus ~27 ms of per-row probes. On a genuinely
multi-member instance that hash is built anyway and the marginal cost is small.

Accepted: absolute costs stay ≤165 ms (scrubber) and ≤47 ms (per bucket), and only users who have
actually hidden something pay anything.

> Benchmark trap, recorded so it is not repeated: `psql -U postgres` gets the cluster default `jit = on`
> and is ~5× slower than the app (546 ms vs 113 ms on the scrubber). Always `SET jit = off;` first, or
> check `pg_db_role_setting`.

---

## 7. Copy, dialog, docs

The shared label is part of the bug. Split it, and say what will happen.

| Key                                             | Now                    | Proposed                                                                                                                                       |
| ----------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `spaces_hide_from_timeline`                     | "Hide from timeline"   | **space** kebab only → "Hide all space photos from timeline"                                                                                   |
| _new_ `space_albums_hide_from_timeline`         | —                      | **album** kebab → "Hide this album from timeline"                                                                                              |
| `spaces_show_on_timeline`                       | "Show on timeline"     | "Show all space photos in timeline"                                                                                                            |
| `spaces_linked_albums_show_in_timeline`         | "Show in timeline"     | "Show this album in timeline"                                                                                                                  |
| `space_albums_hidden_from_timeline`             | "Hidden from timeline" | unchanged (a badge, scope is clear from placement)                                                                                             |
| _new_ `spaces_hide_from_timeline_confirm`       | —                      | "Hide all photos in **{space}** from your timeline? This removes **{count}** photos from your timeline. They stay in the space and in search." |
| _new_ `space_albums_hide_from_timeline_confirm` | —                      | see the reworded copy below the table                                                                                                          |

The album dialog names the hazard explicitly — that flag is shared and editor-settable.

`{count}` comes from a dedicated read-only preview endpoint —
`GET /shared-spaces/:spaceId/timeline-hide-preview` and
`GET /shared-spaces/:spaceId/albums/:albumId/timeline-hide-preview` — each returning
`{ hiddenAssetCount: number }`, computed by counting rows the §5 predicate would subtract **if** that
flag were flipped. Read-only, membership-gated like the toggle it precedes; it changes no state, so the
dialog can be opened and cancelled freely.

**`{count}` is always scoped to the caller, never to "everyone".** Each member's count genuinely
differs, because it depends on their _other_ space memberships — an asset I reach only through this
album may be reachable by you through a space I'm not in. Computing a number for "everyone" would be
both expensive and meaningless. The album copy above is therefore reworded to:

> "Hide **{album}** from timelines? This removes **{count}** photos from your timeline. It also hides
> the album from everyone else in **{space}**, including from the people who own those photos."

— which states the hazard without pretending to a cross-member number we are not computing.

A count of 0 is worth showing too: it tells a user with a "dump everything" space _why_ nothing will
change — which is exactly the confusion behind #1041. On the personal instance, hiding all 21 albums
subtracts only 177 photos, because 6,872 of the 7,049 assets in linked albums are also added to a space
directly.

All nine locales in the same commit: `de fr it nl pl es ru zh_Hans zh_Hant`. German/Italian/Spanish
informal, French/Russian formal. Then `npx prettier --write i18n/*.json`.

Docs: `docs/docs/features/shared-spaces.md:543` — replace the "Timeline integration" paragraph with the
`¬A ∨ V` rule and the truth table.

**No migration.** Existing `showInTimeline = false` rows keep their value, so users who already hid a
space will see those photos leave their timeline on upgrade. Release notes carry the explanation.
(Measured: 378 photos on the personal instance.)

---

## 8. Test plan — TDD, BDD scenarios

**Every slice is written test-first.** For each scenario below: write the failing test, watch it fail for
the _stated_ reason, then implement. A test that passes before the implementation is a broken test, not a
finished one — see the standing hazards in §8.4.

### 8.1 Server — medium tests (real Postgres)

Extend `server/test/medium/specs/repositories/shared-space-visibility-matrix.medium.spec.ts` and
`timeline-bucket-explicit-visibility.medium.spec.ts`. `medium.factory.ts:415` already takes
`showInTimeline` when linking an album, so the fixtures exist.

The truth table from §2, as Given/When/Then:

| #   | Given                                                                                      | When                        | Then                                                        |
| --- | ------------------------------------------------------------------------------------------ | --------------------------- | ----------------------------------------------------------- |
| S1  | I own an asset in no space                                                                 | I load `/photos`            | it shows                                                    |
| S2  | I own an asset, only in album X, X linked to space S, X hidden, S shown                    | I load `/photos`            | it is **absent**                                            |
| S3  | as S2, but the asset is also in visible album Y linked to S                                |                             | it shows                                                    |
| S4  | as S2, but the asset is also a `shared_space_asset` of S                                   |                             | it shows                                                    |
| S5  | I own an asset, only in space S (direct), S hidden by me                                   |                             | it is **absent**                                            |
| S6  | as S5, but the asset is also direct in space T, T shown                                    |                             | it shows                                                    |
| S7  | I own an asset in album X linked to hidden space S **and** to shown space T, unhidden in T |                             | it shows                                                    |
| S8  | I own an asset via a library linked to hidden space S only                                 |                             | it is **absent**                                            |
| S9  | another member owns an asset in hidden-for-me space S                                      |                             | absent (unchanged today)                                    |
| S10 | another member owns an asset in a hidden album, shown space                                |                             | absent (unchanged today)                                    |
| S11 | I hide space S; **another member** who shows S owns an asset in it                         | that member loads `/photos` | it shows — my flag is mine alone                            |
| S12 | an **editor** hides album X; I own assets in X                                             | I load `/photos`            | absent — the disclosed hazard, pinned as intended behaviour |

Edge cases that have bitten this codebase before:

| #   | Given                                                                                                 | Then                                                                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | the linked album is soft-deleted (`album.deletedAt` set)                                              | the A1 invariant still holds; a deleted album neither hides nor re-admits                                                                               |
| E2  | the asset is in a hidden album **and** trashed                                                        | still absent from the timeline; trash is unaffected                                                                                                     |
| E3  | the asset is `visibility = archive`                                                                   | unaffected — it was never on the timeline                                                                                                               |
| E4  | the asset is `visibility = hidden` / `locked`                                                         | unaffected; no new leak path                                                                                                                            |
| E5  | the viewer belongs to **no** space                                                                    | the predicate collapses; SQL contains no `NOT EXISTS` (assert on the generated SQL, not just the rows)                                                  |
| E6  | the viewer has spaces but has hidden **nothing**                                                      | same collapse — this is the free-for-everyone claim, so assert it                                                                                       |
| E7  | the asset arrived via `album_space_asset` (cross-owner contribution, #764)                            | the contributor's own timeline honours the hide                                                                                                         |
| E8  | a stacked asset whose primary is hidden but a sibling is not                                          | the stack behaves as the existing `withStacked` filter dictates; no orphan rows                                                                         |
| E9  | album linked to two spaces, hidden in both                                                            | absent                                                                                                                                                  |
| E10 | `withPartners = true`, partner owns an asset in an album I hid                                        | my flag must not subtract my **partner's** assets from my timeline — the subtraction applies to the `ownerId = me` arm only                             |
| E7b | album X linked to hidden space S **and** shown space T; a contribution was made to X **in T**         | the contribution still shows — the hidden side keys on `(albumId, spaceId)`, so hiding X in S must not reach T's contribution (§4 rule 4)               |
| E11 | the album is unlinked from the space entirely                                                         | asset returns to the timeline                                                                                                                           |
| E12 | `withSharedSpaces = false` (the `!timelineSpaceIds` branch, `asset.repository.ts:475`)                | the subtraction still applies                                                                                                                           |
| E13 | I own assets with `libraryId IS NULL` (the normal case) and have a hidden space with a linked library | they still show. Guards the `NULL <> ALL(…)` trap in §5 — the naive form subtracts the entire timeline                                                  |
| E14 | my membership of the hidden space is revoked while the flag is set                                    | the space leaves `hiddenSpaceIds`; the assets return                                                                                                    |
| E15 | I am the space **creator**                                                                            | resolution still finds me — `shared-space.service.ts:136` guarantees an Owner member row                                                                |
| E16 | I own an asset in an album that is linked to a space I am **not** a member of                         | not hidden — every set is membership-scoped (§4 rule 1)                                                                                                 |
| E17 | a hidden space containing ~50k assets                                                                 | perf smoke only: assert the hash is built once (`loops=1`), not per row. §5's cost is linear in hidden-set size and this end of the curve is unmeasured |

E10 and E12 are the two most likely to be missed — E12 is a second code branch, E10 is a real correctness
bug if the predicate is attached to `ownerId = ANY(userIds)` rather than to the caller's own id.

### 8.2 Server — equivalence and SQL-shape guards

- `accessible-timeline-asset-predicate.medium.spec.ts` already compares the collapsed and expanded forms
  of the predicate. Extend it so the new term is covered by the same comparison — that file exists
  precisely to catch a future arm that isn't `timeline_spaces`-gated.
- Assert the **rejected query forms** cannot silently return: a test that greps the generated SQL for a
  correlated `shared_space_album` join inside the timeline query, since re-introducing it is a 6× per
  bucket regression that no correctness test would catch.
- `make sql` regeneration: any edit under `server/src/repositories/` requires it, body-only edits
  included.

### 8.3 Mobile — Drift

`mobile/test/infrastructure/repositories/merged_asset_drift_test.dart` exists and is the right home. The
`.drift` predicate is a hand-written mirror, so it needs its **own** copy of S1–S8 and E5/E6/E9 — a
server-side test proves nothing about it.

No sync work: `shared_space_album_link_entity.showInTimeline`, `shared_space_member_entity.showInTimeline`
and `shared_space_album_asset_entity` all sync already, and `sync.repository.ts:1674` ships the album's
own `album_asset` rows, not just contributions. Regenerate `merged_asset.drift.dart` after editing.

Run per `mobile/mise.toml`'s pinned Flutter — read the pin, don't trust a remembered version.

### 8.4 Test-honesty requirements

Standing failure modes in this repo; each has produced a false green before.

- **Prove red first.** For every scenario, flip the flag in the fixture and confirm the test fails for
  the stated reason. A mobile widget test that passes with the feature disabled is measuring nothing.
- **No assertions that cannot fail.** `queryBy…` returning null passes whether or not the element was
  ever rendered; assert on presence _and_ absence explicitly.
- **A fast path masks its own arm tests.** The §4 collapse is exactly the shape that hid a real bug
  before: every scenario that hides a space also risks leaving the viewer with nothing to hide, so the
  collapsed path runs and the full predicate is never emitted. Each of S2–S8 **must** be constructed with
  the viewer holding at least one _other_, visible space, so the expanded predicate is the one under
  test. Assert on the generated SQL where the distinction matters.
- **`tsc` green means nothing on a re-key.** Type checks do not see raw SQL or Drift strings.

### 8.5 Existing tests that this change puts at risk

A semantics change breaks tests that encoded the old semantics. Audit these **before** writing new ones;
each is either still correct (and proves we didn't over-reach) or needs updating with a recorded reason.

| Test                                                                                                                                                               | Why it is at risk                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `e2e/src/specs/web/spaces-albums-timeline.e2e-spec.ts:181` — _"viewer toggling 'show in my timeline' gains/loses the linked photo on their main /photos timeline"_ | sits exactly on the redefined surface. Should still pass: the viewer does **not** own the photo, so only the `V` arm applies and that is unchanged. If it fails, the subtraction has leaked onto non-owned assets. |
| `spaces-albums-timeline.e2e-spec.ts:150` — album toggle drops/re-adds in the space Photos tab                                                                      | space-timeline behaviour, unchanged by this work. A failure here means slice 1 touched the `spaceId` browse it should not have.                                                                                    |
| `server/test/medium/specs/repositories/shared-space-visibility-matrix.medium.spec.ts`                                                                              | the matrix asserts today's "owner always sees their own" rule in several rows                                                                                                                                      |
| `accessible-timeline-asset-predicate.medium.spec.ts`                                                                                                               | compares collapsed vs expanded predicate forms; the new term must appear in both or neither                                                                                                                        |
| `timeline-bucket-explicit-visibility.medium.spec.ts`                                                                                                               | explicit-visibility rows interact with the new owner-arm split                                                                                                                                                     |

### 8.6 E2E

`e2e/src/specs/web/spaces-albums-timeline.e2e-spec.ts` already exists and is the right home — it is
built around exactly these two toggles. Add:

- **member toggle, owner's own photos**: owner links their album into a space, hides the space from
  their timeline, asserts their own photos leave `/photos` and return on unhide. This is #1041's
  headline scenario and there is no API-level test that substitutes for it.
- **album toggle, owner's own photos**: same shape at album granularity (assumes the §2 open question
  resolves to _yes_; drop this one if it resolves to _no_).
- **cancellation is visible to the user**: a photo in a hidden album that is also added to the space
  directly stays on `/photos`. This is the scenario most likely to generate a follow-up bug report, so
  it should be demonstrably intentional.
- **the confirm dialog states a count**, and cancelling it changes nothing.

API-level specs under `e2e/src/specs/api/` for the two new preview endpoints: membership gating (a
non-member gets 403), the count matches what the timeline actually drops, and the zero case.

### 8.7 Sync

Flipping either flag must reach mobile, and must **not** purge local rows.

`sync-shared-space-album-visibility-purge.spec.ts` purges on **asset visibility** transitions
(Timeline/Archive → Hidden), not on `showInTimeline`. That is the behaviour we want and rely on: hiding
leaves the local `remote_asset_entity` rows in place and the Drift predicate filters them, so the asset
stays available to search and returns instantly on unhide. Nothing currently pins that, so add:

- flipping `shared_space_member.showInTimeline` emits the member row on `SharedSpaceMemberSync` and
  emits **no** asset deletions;
- flipping `shared_space_album.showInTimeline` emits the link row on `SharedSpaceAlbumLinkSync` and
  emits **no** asset deletions.

### 8.8 Web

Component tests for the split copy and the confirm dialogs
(`space-album-card.spec.ts`, `space-albums-table.spec.ts`, `space-layout.spec.ts` all exist), asserting
the space and album menu items no longer render the same string, and that each dialog surfaces its count.

**Cache invalidation.** `+layout.svelte:129` calls `invalidateAll()` after the member toggle, which
reloads route data but does not reach the `/photos` `TimelineManager` — a different, currently unmounted
route that refetches on mount. That is very likely fine, but it is an assumption: assert that navigating
to `/photos` after a toggle shows the new result rather than a cached bucket. Check the **album**
toggle's handler too; it was not audited during this design and may not invalidate at all.

### 8.9 Shared links

`auth.sharedLink` resolves its own scope (`timeline.service.ts:101`, #1018) and never carries a member
`showInTimeline`. **Decision: the subtraction does not apply to shared-link viewers.** A link is an
explicit act of publishing a specific album or space; a member's private timeline preference is not the
link viewer's preference, and applying it would make link contents vary by who created the link. Add one
API-level test pinning that a link to a hidden album still serves its assets.

---

## 9. Slices

| Slice | Content                                                                                                                                                                                                                                                         | Gate                 |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| **0** | Reproduce the space-timeline half of #1041 on a real stack. If it reproduces, it is a separate bug — file it and fix independently. Also run the §8.5 audit of at-risk tests against unmodified code, so their current state is recorded before anything moves. | before any code      |
| **1** | Predicate + service resolution + owner-arm split (§5 partner trap) + `/photos` (both branches) + folder view + mobile Drift. S1–S12, E1–E17, §8.7 sync tests.                                                                                                   | medium + Drift green |
| **2** | Memories (`memory.repository.ts` ×3 projections + `getByDayOfYear`). Includes "a memory whose assets are now all hidden" — decide empty-memory handling there, not here.                                                                                        | medium green         |
| **3** | The two preview endpoints + their API specs (§8.6), copy split, both confirm dialogs with counts, nine locales, docs, release-note text.                                                                                                                        | web tests + prettier |
| **4** | E2E (§8.6) on `spaces-albums-timeline.e2e-spec.ts`, including the cancellation scenario and the shared-link pin (§8.9).                                                                                                                                         | e2e green            |

The owner-arm split in slice 1 changes `TimeBucketOptions` (the caller's own id must be separable from
`userIds`), so it lands first within that slice — the other call sites depend on its shape.

## 10. Out of scope

- Search, map, People page — Archive parity (§3).
- Any schema change; both flags exist.
- Making `shared_space_album.showInTimeline` per-member. That would remove the S12 hazard entirely and is
  the cleaner long-term shape, but it is a schema + sync + API change and a separate piece of work.
- The `jit` question — already handled by `1783628194057-DisablePostgresJit.ts`.
