# "Hide from timeline" should actually hide — design

Issue: [#1041](https://github.com/open-noodle/gallery/issues/1041) — _"I mark a Spaces Album as 'Hidden from timeline', but all those pictures still appear in the Space's timeline and the master 'Photos' timeline."_ (v5.5.0-rc.0, web)

Date: 2026-08-31 · Status: design, pending review · Supersedes the first draft of this file (commits `7837185cd16`, `22081a485ab`)

---

## 1. Diagnosis

Two flags exist today, and both are surfaced with the **same words**:

| Flag                                 | Scope                              | Set by                         | Today's meaning                                                              |
| ------------------------------------ | ---------------------------------- | ------------------------------ | ---------------------------------------------------------------------------- |
| `shared_space_member.showInTimeline` | per **member**, per space          | that member, for themselves    | assets reachable _only_ via this space drop out of my timeline               |
| `shared_space_album.showInTimeline`  | per **space + album** (shared row) | any space editor, for everyone | this album's assets don't flow into the space timeline or members' timelines |

`shared-space-album.table.ts:47`, `shared-space-member.table.ts:97`.

The reporter used the album one. Both render the identical i18n key:

- space kebab — `web/src/routes/(user)/spaces/[spaceId]/+layout.svelte:247` → `spaces_hide_from_timeline`
- album kebab — `web/src/lib/components/spaces/space-album-card.svelte:42` → `spaces_hide_from_timeline`
- album row — `web/src/lib/components/spaces/space-albums-table.svelte:70` → `spaces_hide_from_timeline`

Not a new discovery: `e2e/src/specs/web/spaces-albums-timeline.e2e-spec.ts:19-23` already documents both
toggles and notes explicitly that their menu items "share the same" name. It was known and worked around
in tests; #1041 is a user hitting it.

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

### The space-timeline half of the report — RESOLVED in slice 0: not a bug

`asset.repository.ts:432` gates a `spaceId` browse with `requireShowInTimeline: true` and has no owner
bypass (`userIds` is undefined for a space browse — `timeline.service.ts:201`).

Slice 0 confirmed this empirically, twice over:

1. **An existing passing test already asserts it.**
   `shared-space-visibility-matrix.medium.spec.ts:1176` seeds an album with `showInTimeline = false`,
   links it to a space, and asserts the space timeline total is `2` — excluding the hidden album's
   asset. Green on unmodified `main`.
2. **A throwaway probe confirmed the actual cause.** Two owned assets, both in the same hidden album,
   one of them **also added to the space directly**:

   | Surface           | Result                                                                          |
   | ----------------- | ------------------------------------------------------------------------------- |
   | Space timeline    | **1** — only the directly-added asset; the album-only asset is correctly hidden |
   | Owner's `/photos` | **2** — both, because the owner arm is unconditional                            |

So the reporter's photos reach their space by a **second path** — a directly-added
`shared_space_asset`, or a linked library — neither of which the album flag gates. That is the
"any visible path wins" rule of §3 working as designed, not a defect. **No separate issue to file.**

The `/photos` half is the real bug, and the probe reproduces it exactly: the owner sees both assets,
including the one reachable only through an album they hid. Slices 1–10 fix that.

> Worth saying to the reporter directly: hiding an album cannot hide photos that are _also_ in the
> space by another route, and — until this work lands — cannot hide their owner's own photos at all.

### Slice 0 baseline — at-risk tests on unmodified `main`

All green, recorded so a later failure can be attributed (§9.7):

| Spec                                                      | Tests  |
| --------------------------------------------------------- | ------ |
| `shared-space-visibility-matrix.medium.spec.ts`           | 47     |
| `timeline-bucket-explicit-visibility.medium.spec.ts`      | 12     |
| `sync-shared-space-album.spec.ts`                         | 14     |
| `shared-space-album-link-sync.spec.ts`                    | 11     |
| `accessible-timeline-asset-predicate.medium.spec.ts`      | 4      |
| `accessible-timeline-asset-predicate-gate.medium.spec.ts` | 2      |
| **Total**                                                 | **90** |

---

## 2. The three switches

The design replaces two overloaded switches with three, each with exactly one job. This is the core of
the change; everything else follows from it.

| Switch                             | Storage                                       | Whose           | Controls                                      |
| ---------------------------------- | --------------------------------------------- | --------------- | --------------------------------------------- |
| **Space → my timeline**            | `shared_space_member.showInTimeline` (exists) | mine alone      | everything in this space, in **my** timeline  |
| **Album → my timeline**            | `shared_space_album_hidden` (**new**)         | mine alone      | this album, in **my** timeline                |
| **Album → the space's Photos tab** | `shared_space_album.showInTimeline` (exists)  | shared, editors | whether the album appears in the space itself |

Both "my timeline" switches are **private to their owner**: nobody else can change what appears in your
own library. That is the property that makes it safe for these switches to subtract your own photos,
which is what #1041 asks for.

### ⚠ Recorded consequence: the shared switch no longer reaches personal timelines

Today, an editor hiding an album removes it from **everyone's** personal timeline. After this change the
shared switch governs only the space's own Photos tab, so an editor hiding a noisy album no longer
declutters anyone else's `/photos` — each member must hide it for themselves.

This is the deliberate price of removing the hazard, and it has two mitigations:

1. **The migration seeds existing state** (§5.3), so nothing changes for albums that are hidden today.
2. **The editor's confirm dialog offers a bridge**: when an editor hides an album from the space tab,
   the dialog carries a checked-by-default "Also hide it from my own timeline", which writes only
   _their own_ `shared_space_album_hidden` row. One action, still no reach into anyone else's library.

---

## 3. Semantics

For an asset the viewer **owns**:

```
shows on my timeline  ⟺  ¬A ∨ V

  A = the asset has ANY path into a space I'm a member of   (any flag state)
  V = the asset has a VISIBLE path — a path into a space where my
      shared_space_member.showInTimeline = true, and, for album paths,
      I have no shared_space_album_hidden row for that (space, album)
```

Non-owned assets are unchanged in structure: they show iff `V` (plus the existing visibility gate) — but
`V`'s album arm now consults the **per-user** flag rather than the shared one.

Since `A = Hpath ∨ V`, this is equivalent to `¬Hpath ∨ V` where `Hpath` = "has a hidden path". **The
implementation uses the `Hpath` form** — see §6; it is the difference between a working query and a 2×
regression.

### Truth table (personal timeline)

| Asset's space presence                                | `A` | `V` | Owner's timeline |
| ----------------------------------------------------- | --- | --- | ---------------- |
| in no space at all                                    | ✗   | ✗   | **shows**        |
| only in an album I have hidden, in a space I show     | ✓   | ✗   | **hidden**       |
| only in a space I have hidden (any path)              | ✓   | ✗   | **hidden**       |
| in an album I hid **and** an album I did not          | ✓   | ✓   | **shows**        |
| in an album I hid **and** added to the space directly | ✓   | ✓   | **shows**        |
| in space A (hidden by me) **and** space B (shown)     | ✓   | ✓   | **shows**        |
| album hidden from the space tab, but not by me        | ✓   | ✓   | **shows**        |

Rule of thumb for the docs: **a photo disappears from your timeline only when _every_ way it reaches a
space is hidden by you.**

### The space's own Photos tab — unchanged

Gated by `shared_space_album.showInTimeline` exactly as today. Same for every member; no per-user
variation. No existing behaviour or test moves.

### Hiding is tidiness, not privacy

Recorded decision: **shared links are unaffected.** A link is a deliberate act of publishing a specific
album; a personal viewing preference must not silently change what a link sent last month shows. With
per-user switches there is no coherent "hidden according to whom?" answer for a link anyway. The docs
must say, in these words, that hiding does not restrict anyone's access — use link expiry or unlinking
for that.

---

## 4. Surfaces — Archive parity

Archive is the existing "hide from timeline" concept (`docs/docs/FAQ.mdx:114`): hidden from the main
timeline and folder view, still present in search. Match it.

| Surface                     | In scope    | Site                                                                              |
| --------------------------- | ----------- | --------------------------------------------------------------------------------- |
| `/photos` web timeline      | ✅ slice 8  | `asset.repository.ts:475` **and** `:478` — both owner branches                    |
| Timeline scrubber covers    | ✅ free     | `getTimeBucketCovers` (`asset.repository.ts:1545`) — note below                   |
| Mobile timeline + scrubber  | ✅ slice 10 | `mobile/lib/infrastructure/entities/merged_asset.drift:63` and `:166`             |
| Folder view                 | ✅ slice 9  | `view-repository.ts:60` `ownedOrSpaceAccessible`                                  |
| Memories                    | ✅ slice 13 | `memory.repository.ts:133`, `:169`, `:315`, plus `assetRepository.getByDayOfYear` |
| Search / smart search       | ❌          | unchanged, like Archive                                                           |
| Map                         | ❌          | unchanged                                                                         |
| People page counts          | ❌          | unchanged — deliberately, it is already the slowest query                         |
| Tag explorer                | ❌          | see the name-collision warning below                                              |
| The album/space page itself | ❌          | must always show its own contents                                                 |

### Why search stays out — measured, not assumed

Archive parity is the *reason*; the cost is the *proof*. Measured 2026-09-03 on a real 66,387-embedding
library (personal instance, warm cache, `jit=off`, `vchordrq.probes=1`), a top-100 CLIP search with 86%
of the library hidden:

| | run 1 | run 2 | run 3 |
| --- | ---: | ---: | ---: |
| current (no subtraction) | 1118 ms cold | 17.7 ms | **8.0 ms** |
| with the hidden-space subtraction | 32,498 ms | 29,417 ms | **27,311 ms** |

```
Limit
  └─ Nested Loop Anti Join
       └─ Index Scan using clip_index on smart_search  (actual time=492 .. 28,000 ms)
Execution Time: 29,956 ms
```

An ANN index emits candidates in distance order and stops when `LIMIT` is satisfied. A predicate that
rejects most of the library means it never satisfies it early — it walks essentially the whole
`clip_index` computing exact distances. There is no push-down to fix this, so the anti-join cannot be
made cheap; it has to stay off the vector path. Same family as the §6.5 regression, an order of
magnitude worse. **Do not "just add it to search" without re-running this measurement.**

Three server timeline call sites, not two: `getTimeBuckets`, `getTimeBucket` and `getTimeBucketCovers`
all route through `withTimeBucketAssetFilters`, so editing that one helper covers all three — which is
exactly why they share it (`asset.repository.ts:1626`).

`asset.repository.ts:475` is easy to miss: it is the `!timelineSpaceIds` branch (`userIds` set, shared
spaces off). A user with `withSharedSpaces=false` must still get the subtraction, so **both** branches
change.

> **Name collision — do not change both.** `view-repository.ts:58` and `tag.repository.ts:88` both define
> a private `ownedOrSpaceAccessible`. They are different: the view one scopes **assets** (in scope), the
> tag one scopes **tags** by `tag.userId` for the tag explorer list (out of scope, a metadata surface
> like search). Grepping the helper name finds both.

---

## 5. Schema, migration, sync

### 5.1 The new table

Sparse by design — **a row exists only when a member has hidden that album.** Absence means shown. A
dense table would be members × albums and would need the trigger fan-out that
`shared_space_album_user` carries; sparse needs none.

```ts
// server/src/schema/tables/shared-space-album-hidden.table.ts
@Table("shared_space_album_hidden")
@UpdatedAtTrigger("shared_space_album_hidden_updatedAt")
// Unlink cleanup: cascades when the (space, album) LINK goes away — which also covers space
// deletion and album deletion, since both cascade into shared_space_album first.
@ForeignKeyConstraint({
  columns: ["spaceId", "albumId"],
  referenceTable: () => SharedSpaceAlbumTable,
  referenceColumns: ["spaceId", "albumId"],
  onUpdate: "NO ACTION",
  onDelete: "CASCADE",
})
@AfterDeleteTrigger({
  scope: "statement",
  function: shared_space_album_hidden_delete_audit,
  referencingOldTableAs: "old",
})
export class SharedSpaceAlbumHiddenTable {
  @Column({ type: "uuid", primary: true }) spaceId!: string;
  @Column({ type: "uuid", primary: true, index: true }) albumId!: string;
  @ForeignKeyColumn(() => UserTable, { onDelete: "CASCADE", primary: true }) userId!: string;
  @CreateDateColumn() createdAt!: Generated<Timestamp>;
  @UpdateDateColumn() updatedAt!: Generated<Timestamp>;
  @CreateIdColumn({ index: true }) createId!: Generated<string>;
  @UpdateIdColumn({ index: true }) updateId!: Generated<string>;
}
```

Plus `shared_space_album_hidden_audit` and its delete trigger, mirroring
`shared-space-album-user-audit.table.ts` — mobile learns about **unhiding** from the audit row, since
unhiding is a row delete. Give it the same `(userId, id)` composite index that
`shared_space_album_user_audit` carries, for the same reason: the delete stream scans by `userId` plus
an `id` range.

`spaceId` is part of the key: the same album can be linked to two spaces and hidden in only one.

**Why the composite FK and not three column-level ones.** The hidden row is meaningful only as long as
the **link** exists. `@ForeignKeyConstraint` (already used this way in `activity.table.ts:32` for
`album_asset(albumId, assetId)`) references `shared_space_album`'s `(spaceId, albumId)` primary key, so
one constraint covers all three cases: unlinking the album, deleting the space, and deleting the album
— the latter two cascade into `shared_space_album` first, which then cascades here.

That makes separate `@ForeignKeyColumn`s to `SharedSpaceTable` and `AlbumTable` redundant, so `spaceId`
and `albumId` are plain `@Column`s. Only `userId` needs its own FK, since no path from the link row
reaches it. Pinned by E11 (row gone on unlink) and E11b (re-link is not still hidden).

**Membership removal does not cascade** and deliberately is not made to. There is no FK to
`shared_space_member` (the table keys on `userId`, not on a membership row). A removed member's rows are
inert — resolution is membership-scoped (§6.2 rule 1), so they can never affect a timeline — and they
correctly restore that member's preferences if they rejoin. Clean them up only if they ever become a
volume problem. Pinned by E14.

The structural model is `shared_space_member` one level down. **Not** `shared_space_album_user` — that is
documented as _"Internal, write-once … trigger-maintained; never user-facing"_, is keyed `(userId,
albumId)` with no `spaceId`, and is a sync watermark. Do not hang a user-settable flag on it.

### 5.2 Fork migration

`server/src/schema/migrations-gallery/1793000000000-AddSharedSpaceAlbumHidden.ts` — round timestamp per
the fork convention; the latest existing is `1792123120451-AddSharedLinkSpaceId.ts`. Partial/positional
indexes need a verbatim `migration_overrides` row.

### 5.3 Seeding — mandatory, and it is a correctness requirement

```sql
INSERT INTO shared_space_album_hidden ("spaceId", "albumId", "userId")
SELECT ssa."spaceId", ssa."albumId", ssm."userId"
FROM shared_space_album ssa
JOIN shared_space_member ssm ON ssm."spaceId" = ssa."spaceId"
WHERE ssa."showInTimeline" = false;
```

Without this, every currently-hidden album's photos would **appear** in members' personal timelines on
upgrade. Content becoming visible is the one direction a release note must not be asked to cover — it
reads as a leak even though no access boundary moved. Pinned by edge case E18.

The space-level flag is **not** reset: per the recorded decision, users who already hid a space will see
those photos leave their timeline on upgrade, and the release notes explain it (§8).

### 5.4 Sync

New entity, following `SharedSpaceAlbumLinkV1` exactly. Registration points:

| File                                  | What                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------ |
| `src/enum.ts:~1155`                   | `SyncRequestType.SharedSpaceAlbumHiddenV1`                               |
| `src/enum.ts:~1282`                   | `SyncEntityType.SharedSpaceAlbumHiddenV1` + `…DeleteV1` + `…BackfillV1`  |
| `src/dtos/sync.dto.ts:~561`           | zod schema, DTO class, and the `SyncEntityType → DTO` map entry (`:703`) |
| `src/repositories/sync.repository.ts` | the sync class, membership-scoped like `SharedSpaceAlbumLinkSync`        |
| `src/services/sync.service.ts:~1092`  | the upsert/delete handler                                                |
| mobile Drift entity + sync handler    | `shared_space_album_hidden_entity`                                       |

**The sync stream is scoped to the requesting user's own rows.** Another member's hiding preferences are
not the viewer's business and must never be synced — this is the one place the sparse table could leak a
preference. Pinned by S16.

OpenAPI regeneration (TypeScript SDK **and** Dart client) is required and is why slices 2–3 stand alone from the read path.
Regen is `mise open-api` — `make open-api` was removed and `pnpm sync:open-api` does not exist, despite
what `CLAUDE.md` still says.

---

## 6. Resolution and query shape

### 6.1 Splitting the gate — the highest-risk part of the whole change (slice 5)

`requireShowInTimeline` currently means one thing. It now means two, and every gate must be classified:

- **18 `requireShowInTimeline` call sites** across 7 files: `shared-space-album-scope.ts`, `database.ts`,
  `map.repository.ts`, `asset.repository.ts`, `view-repository.ts`, `memory.repository.ts`,
  `search.repository.ts`, `shared-space.repository.ts`
- **22 raw-SQL `showInTimeline = true` gates** in the same family

The option splits in two, and **neither is allowed to default**, so the compiler forces a decision at
every site:

```ts
albumTimelineGate: "space-tab" | "personal" | "none";
// 'space-tab' → shared_space_album.showInTimeline = true      (today's behaviour)
// 'personal'  → NOT EXISTS shared_space_album_hidden for this viewer
// 'none'      → no gate (album page itself)
```

Making it a required union rather than an optional boolean is deliberate: a defaulted boolean would let
a missed site silently keep the old gate, which is precisely the class of bug that a green `tsc` cannot
catch on a re-key. Triage of all 38 sites is a reviewable artifact of slice 5 — a table of site → chosen
value → reason, in the PR description.

> **Measured in slice 5, and slice 8 depends on it: the compiler will NOT enumerate the sites for you.**
> Slice 5 shipped `AlbumTimelineGate = 'space-tab' | 'none'` (`shared-space-album-scope.ts:83`), read at
> three places (`:195`, `:250`, `:442`) as `options.albumTimelineGate === 'space-tab'` — comparisons,
> not exhaustive `switch`es. Adding `| 'personal'` was tried during slice 5 and produced **zero** new
> `tsc` errors.
>
> Two consequences. First, a site left as `'space-tab'` when it should become `'personal'` compiles
> silently, so slice 8 must walk the triage table by hand rather than following compiler errors.
> Second, the SQL regen is the real safety net: a pure re-mapping changes emitted SQL, so slice 8's
> `server/src/queries/` diff must show **exactly** the personal-timeline surfaces changing and nothing
> else. Slice 5's own regen was byte-identical, which is what proved its 38-site mapping correct.
>
> If slice 8 wants compiler help, convert the three readers to exhaustive `switch` statements over the
> union first, as its own inert step.

### 6.2 Service-side resolution

Resolve once per request, beside the existing `getSpaceIdsForTimeline` call (`timeline.service.ts:82`):

```ts
// SharedSpaceRepository — sibling to getSpaceIdsForTimeline (shared-space.repository.ts:360)
getTimelineHiddenScope(userId): Promise<{
  hiddenSpaceIds: string[];
  hiddenAlbumIds: string[];
  hiddenAlbumSpacePairs: Array<{ albumId: string; spaceId: string }>;
  hiddenLibraryIds: string[];
}>
```

Resolution rules — all five load-bearing:

1. **Membership-scoped.** Every set derives from `shared_space_member` rows for `userId`. A space creator
   always has one (`shared-space.service.ts:136` inserts an `Owner` member row at creation), so there is
   no creator gap.
2. **`hiddenAlbumIds`** = albums linked to a space in `hiddenSpaceIds`, ∪ albums with a
   `shared_space_album_hidden` row for this user, **MINUS** albums also linked _visibly_ to a space I
   show (i.e. reachable without a hidden path). The `MINUS` implements "a visible path wins" as set
   arithmetic on a tiny set, so it never reaches SQL.
3. **A1 invariant.** Both the hidden set and the cancelling set join `album` and require
   `album.deletedAt IS NULL` — same invariant the whole `shared-space-album-scope.ts` family encodes
   (`requireAlbumNotDeleted`, default true). Without it on the hidden side a trashed album keeps hiding;
   without it on the cancelling side a trashed album keeps re-admitting. Pinned by E1.
4. **Contributions carry their space.** `album_space_asset` rows are visible only through the space they
   were contributed to (`spaceContributedAssetExists`, #764/#1018). Hence `hiddenAlbumSpacePairs`:
   hiding album X in space S must not hide a contribution made to X in space T. Pinned by E7b.
5. **The shared flag is not consulted here.** Personal timelines read only the per-user table (§2).

**Collapse when empty.** If all four lists are empty — the common case — emit no predicate at all,
mirroring the `hasTimelineSpaces` collapse at `shared-space-album-scope.ts:393`.

### 6.3 The predicate

```ts
export function hiddenFromOwnTimeline(eb: ExpressionBuilder<DB, keyof DB>, scope: TimelineHiddenScope): Expression<SqlBool> | undefined; // undefined ⇒ caller emits nothing
```

emitting, per arm, **only** when that arm's list is non-empty:

```sql
    NOT EXISTS (SELECT 1 FROM shared_space_asset
                 WHERE "spaceId" = ANY(:hiddenSpaceIds) AND "assetId" = asset.id)
AND NOT EXISTS (SELECT 1 FROM album_asset
                 WHERE "albumId" = ANY(:hiddenAlbumIds) AND "assetId" = asset.id)
AND NOT EXISTS (SELECT 1 FROM album_space_asset
                 WHERE ("albumId", "spaceId") = ANY(:hiddenAlbumSpacePairs)
                   AND "assetId" = asset.id)
AND (asset."libraryId" IS NULL OR asset."libraryId" <> ALL(:hiddenLibraryIds))
```

Three details are deliberate, each wrong in an earlier draft:

- **The library arm is not an `EXISTS`.** `asset.libraryId` is **nullable**, and `NULL <> ALL (…)` is
  `NULL`, not `true` — the bare form silently subtracts every asset with no library, i.e. most of the
  timeline. The `IS NULL OR` guard is mandatory. Pinned by E13.
- **The contribution arm keys on `(albumId, spaceId)`** — rule 4.
- **It attaches to the caller's own id, never `userIds`** — below.

### 6.4 Where it attaches — the partner trap

The owner arm at `asset.repository.ts:478` is `asset.ownerId = anyUuid(options.userIds!)`, and `userIds`
**includes partner ids** (`timeline.service.ts:76-80` pushes `getMyPartnerIds` into it). AND-ing the
subtraction there would remove a **partner's** photos based on **my** flags — a correctness bug no
happy-path test catches. The arm must split:

```
(asset."ownerId" = :callerId AND <hiddenFromOwnTimeline>)
OR asset."ownerId" = ANY(:partnerIds)          -- unchanged, no subtraction
OR (visibility gate AND <space arms V>)
```

`TimeBucketOptions` must therefore distinguish the caller's own id from `userIds`; today the service
flattens both. It is consumed only by `asset.repository.ts` and `timeline.service.ts`, so the change is
contained. Pinned by E10.

### 6.5 Query forms that were measured and rejected

Do not "simplify" into any of these. Measured with `jit = on` (before the §7 trap was spotted), so read
as a relative ranking against a 546 ms baseline, not absolute costs.

| Form                                              | Scrubber, jit=on | vs baseline | Why it fails                                                          |
| ------------------------------------------------- | ---------------- | ----------- | --------------------------------------------------------------------- |
| Chosen: service-resolved id lists                 | 660 ms           | +21%        | —                                                                     |
| Joining `shared_space_album` inside the hot query | 687 ms           | +26%        | rebuilds an 8.4k-row join per request; worse per bucket (55 vs 48 ms) |
| `ownerId = me AND NOT A` over **all** paths       | 899 ms           | +93%        | probes the full 116k-row path set per row                             |
| Inlined `NOT IN (… UNION … EXCEPT …)`             | 819 ms           | +51%        | the `EXCEPT` over the 116k visible set costs more than it saves       |
| `WITH hidden AS (…)` + correlated `NOT EXISTS`    | **9,300 ms**     | **+1600%**  | a CTE reference cannot be hashed; re-scanned per row                  |

The last row is the one to guard in review: it is the most natural-looking refactor and it is
catastrophic.

---

## 7. Performance

Measured on the personal instance, 2026-08-31: 66,215 timeline assets, 21 linked albums, 116,901
`shared_space_asset` rows, PostgreSQL 18.4, 2-core node. **All figures with `jit = off`**, matching the
per-role GUC the `gallery` role carries (`migrations-gallery/1783628194057-DisablePostgresJit.ts`).
Median of 4–5 passes.

|                      | Scrubber (`getTimeBuckets`, full library) | Per-bucket (`getTimeBucket`, 4,764 assets) |
| -------------------- | ----------------------------------------- | ------------------------------------------ |
| Baseline today       | 113 ms                                    | 7.4 ms                                     |
| Only an album hidden | 152 ms (+35%)                             | 4.0–5.6 ms (faster)                        |
| A space hidden       | 164 ms (+49%)                             | 47 ms (6.4×)                               |

Two states of one feature, not competing designs; a user with a hidden space is the worst case. Hiding
only an album is cheaper on the scrubber and faster per bucket, because a hidden album also removes a
correlated `EXISTS` arm that costs more than the hash probe replacing it.

Postgres compiles each `NOT EXISTS` to a **hashed SubPlan** — one index scan, `loops=1`, then an O(1)
probe per row:

```
Filter: ... AND (NOT (ANY (id = (hashed SubPlan 2).col1)))
  SubPlan 2
    ->  Index Only Scan using album_asset_pkey  (rows=1091 loops=1, 0.134 ms)
```

Cost is O(hidden set) once plus O(1) per row — **independent of library size, but linear in hidden-set
size.** Largest measured was 8.4k asset paths; a 50k-photo hidden space is the untested end (E17).

The per-bucket 6.4× is **an artifact of a single-owner library**. Today the owner arm short-circuits, so
the space subqueries are `(never executed)` — including a 115k-row hash of `shared_space_asset`. Under
the new rule the few hidden assets fall through to the visible-path check, forcing that hash to be built
(14.8 ms) plus ~27 ms of per-row probes. On a multi-member instance it is built anyway and the marginal
cost is small.

Accepted: ≤165 ms scrubber, ≤47 ms per bucket, and only users who hid something pay.

These figures predate the §6.4 owner-arm split, which adds one `OR` branch — a close approximation, not
the final shape. **Re-measure at the end of slice 8** with the same scripts.

> Benchmark trap: `psql -U postgres` gets the cluster default `jit = on` and is ~5× slower than the app
> (546 ms vs 113 ms). Always `SET jit = off;` first, or check `pg_db_role_setting`.

---

## 8. Copy, dialogs, docs

Three switches now need three distinct names. The shared label is part of the bug.

| Key                                           | Now                    | Proposed                                                        |
| --------------------------------------------- | ---------------------- | --------------------------------------------------------------- |
| `spaces_hide_from_timeline`                   | "Hide from timeline"   | **space** kebab only → "Hide all space photos from my timeline" |
| `spaces_show_on_timeline`                     | "Show on timeline"     | "Show all space photos in my timeline"                          |
| _new_ `space_albums_hide_from_my_timeline`    | —                      | **album** kebab, everyone → "Hide this album from my timeline"  |
| _new_ `space_albums_show_in_my_timeline`      | —                      | "Show this album in my timeline"                                |
| `spaces_linked_albums_show_in_timeline`       | "Show in timeline"     | **editors** → "Show this album in the space's photos"           |
| _new_ `space_albums_hide_from_space_photos`   | —                      | **editors** → "Hide this album from the space's photos"         |
| `space_albums_hidden_from_timeline`           | "Hidden from timeline" | badge → "Hidden from your timeline"                             |
| _new_ `space_albums_hidden_from_space_photos` | —                      | badge → "Hidden from the space's photos"                        |

Confirm dialogs, each stating a count from §8.1:

- **Space → my timeline**: "Hide all photos in **{space}** from your timeline? This removes **{count}**
  photos. They stay in the space, in search, and in any shared links."
- **Album → my timeline**: "Hide **{album}** from your timeline? This removes **{count}** photos. Only
  your timeline changes."
- **Album → space's photos** (editors): "Hide **{album}** from the photos in **{space}**? Everyone in
  the space stops seeing it there. Their own timelines are unaffected." — plus a checked-by-default
  **"Also hide it from my own timeline"** (§2 mitigation), which writes only the actor's own row.

### 8.1 Count endpoints

`GET /shared-spaces/:spaceId/timeline-hide-preview` and
`GET /shared-spaces/:spaceId/albums/:albumId/timeline-hide-preview`, each returning
`{ hiddenAssetCount: number }` — rows the §6.3 predicate would subtract if that switch were flipped.
Read-only and membership-gated, so the dialog can be cancelled freely.

**`{count}` is always the caller's own.** Each member's number genuinely differs, depending on their
other memberships; a cross-member number would be expensive and meaningless. A count of `0` is worth
showing — it tells a user with a "dump everything" space _why_ nothing will change. On the personal
instance, hiding all 21 albums subtracts only 177 photos, because 6,872 of the 7,049 assets in linked
albums are also added to a space directly.

### 8.2 i18n and docs

All nine locales in the same commit: `de fr it nl pl es ru zh_Hans zh_Hant`. German/Italian/Spanish
informal (`du`/`tu`/`tú`), French/Russian formal. Mind gender agreement on nouns each file already
translates. Keys stay alphabetically sorted; then `npx prettier --write i18n/*.json`.

`docs/docs/features/shared-spaces.md:543` — replace the "Timeline integration" paragraph with the three
switches, the truth table, and an explicit sentence that **hiding is not a privacy feature**.

**No reset migration for the space flag.** Users who already hid a space see those photos leave their
timeline on upgrade; release notes explain it (378 photos on the personal instance). This is the
opposite direction from §5.3's seeding, and deliberately so: photos _leaving_ a timeline matches what
the user asked for when they flipped the switch; photos _arriving_ does not.

---

## 9. Test plan — TDD, BDD

**Every slice is written test-first.** Write the failing test, watch it fail **for the stated reason**,
then implement. A test that passes before the implementation is a broken test.

### 9.1 Server — medium tests (real Postgres)

Extend `shared-space-visibility-matrix.medium.spec.ts` and
`timeline-bucket-explicit-visibility.medium.spec.ts`. `medium.factory.ts:415` already accepts
`showInTimeline` when linking an album; it needs a sibling for writing `shared_space_album_hidden`.

| #   | Given                                                                   | When             | Then                                                           |
| --- | ----------------------------------------------------------------------- | ---------------- | -------------------------------------------------------------- |
| S1  | I own an asset in no space                                              | I load `/photos` | it shows                                                       |
| S2  | I own an asset, only in album X linked to space S; **I** hid X; S shown |                  | **absent**                                                     |
| S3  | as S2, plus the asset is in visible album Y linked to S                 |                  | shows                                                          |
| S4  | as S2, plus the asset is a `shared_space_asset` of S                    |                  | shows                                                          |
| S5  | I own an asset, only in space S; **I** hid S                            |                  | **absent**                                                     |
| S6  | as S5, plus the asset is direct in space T, T shown                     |                  | shows                                                          |
| S7  | album X linked to hidden S **and** shown T; not hidden by me in T       |                  | shows                                                          |
| S8  | I own an asset via a library linked to hidden space S only              |                  | **absent**                                                     |
| S9  | another member owns an asset in a space I hid                           |                  | absent (unchanged)                                             |
| S10 | another member owns an asset in an album **I** hid                      |                  | absent                                                         |
| S11 | I hid space S; another member shows S and owns an asset in it           | **they** load    | it shows — my flag is mine alone                               |
| S12 | an **editor** hides album X from the space's photos; I own assets in X  | I load `/photos` | **shows** — the shared flag no longer reaches my timeline (§2) |
| S13 | as S12                                                                  | anyone opens S   | absent from the space's Photos tab — unchanged behaviour       |
| S14 | I hid album X for myself                                                | anyone opens S   | X's photos still in the space's Photos tab                     |
| S15 | I hid album X in space S; X also linked to space T                      | I load `/photos` | shows via T — the hidden row is `(space, album, user)`-keyed   |
| S16 | another member hid album X for themselves                               | I sync           | I never receive their row (§5.4)                               |

Edge cases:

| #    | Given                                                                                      | Then                                                                                                                                                             |
| ---- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1   | the linked album is soft-deleted (`album.deletedAt`)                                       | A1 holds: a deleted album neither hides nor re-admits                                                                                                            |
| E2   | asset in a hidden album **and** trashed                                                    | still absent; trash unaffected                                                                                                                                   |
| E3   | asset is `visibility = archive`                                                            | unaffected — never on the timeline                                                                                                                               |
| E4   | asset is `visibility = hidden` / `locked`                                                  | unaffected; no new leak path                                                                                                                                     |
| E5   | viewer belongs to **no** space                                                             | predicate collapses; assert the **generated SQL** has no `NOT EXISTS`, not just the rows                                                                         |
| E6   | viewer has spaces but hid nothing                                                          | same collapse — this is the free-for-everyone claim, so assert it                                                                                                |
| E7   | asset arrived via `album_space_asset` (#764)                                               | the contributor's own timeline honours the hide                                                                                                                  |
| E7b  | album X in hidden S **and** shown T; contribution made to X **in T**                       | contribution still shows — hidden side keys on `(albumId, spaceId)` (§6.2 rule 4)                                                                                |
| E8   | stacked asset, primary hidden, sibling not                                                 | follows the existing `withStacked` filter; no orphan rows                                                                                                        |
| E9   | album linked to two spaces, hidden by me in both                                           | absent                                                                                                                                                           |
| E10  | `withPartners = true`, partner owns an asset in an album I hid                             | **partner's asset still shows** — §6.4 owner-arm split                                                                                                           |
| E11  | album unlinked from the space entirely                                                     | asset returns **and** the hidden row is gone — assert the row count, not just the timeline, or the composite FK in §5.1 could be missing and the test still pass |
| E11b | album unlinked, then **re-linked** to the same space                                       | it is **not** still hidden — the strongest proof the §5.1 cleanup actually fired                                                                                 |
| E12  | `withSharedSpaces = false` (`asset.repository.ts:475`)                                     | subtraction still applies                                                                                                                                        |
| E13  | I own assets with `libraryId IS NULL` and have a hidden space with a linked library        | they still show — guards the `NULL <> ALL` trap (§6.3)                                                                                                           |
| E14  | my membership of the hidden space is revoked                                               | assets return — resolution is membership-scoped. The rows **remain** by design (§5.1); assert they are inert, not absent                                         |
| E14b | I am removed from a space and later re-added                                               | my old hiding preferences apply again — the documented consequence of E14, so it must be intentional rather than discovered                                      |
| E15  | I am the space **creator**                                                                 | resolution finds me — `shared-space.service.ts:136` guarantees an Owner member row                                                                               |
| E16  | I own an asset in an album linked to a space I am **not** a member of                      | not hidden — every set is membership-scoped (rule 1)                                                                                                             |
| E17  | a hidden space with ~50k assets                                                            | perf smoke: assert the hash builds once (`loops=1`), not per row                                                                                                 |
| E18  | **migration**: an album with `shared_space_album.showInTimeline = false` and three members | all three get a seeded hidden row; their timelines are byte-identical before and after (§5.3)                                                                    |
| E19  | migration runs on a DB with zero spaces                                                    | no-op, no error                                                                                                                                                  |
| E20  | a member is added to a space **after** an album there was hidden from the space's photos   | they get **no** hidden row — seeding is a one-time migration, not an ongoing rule                                                                                |

E10, E12, E13 and E18 are the ones most likely to be missed: E12 is a second code branch, E10 and E13
are silent correctness bugs, E18 only manifests on upgrade.

### 9.2 Gate-split triage (slice 5)

The ~40 gates in §6.1 are the highest-risk surface, and type-checking cannot validate the _choice_.

- The PR carries a **triage table**: every site → `'space-tab' | 'personal' | 'none'` → one-line reason.
- A test asserts the union type has **no default**, so a new call site fails to compile until classified.
- For each site chosen `'personal'`, a medium test proving the per-user flag reaches it; for each
  `'space-tab'`, a test proving the shared flag still does and the per-user flag does **not**.
- `make sql` regeneration: required whenever anything under `server/src/repositories/` changes, body-only
  edits included.

### 9.3 Server — equivalence and SQL-shape guards

- Extend `accessible-timeline-asset-predicate.medium.spec.ts` so the new term is covered by its
  collapsed-vs-expanded comparison — that file exists to catch an arm that isn't `timeline_spaces`-gated.
- Assert the rejected forms (§6.5) cannot return: grep the generated SQL for a correlated
  `shared_space_album` join inside the timeline query. Re-introducing it is a 6× per-bucket regression
  that no correctness test would catch.

### 9.4 Sync

- Flipping either switch emits its row and **no** asset deletions — hiding must not purge local rows, so
  search keeps working and unhiding is instant.
  (`sync-shared-space-album-visibility-purge.spec.ts` purges on **asset visibility** transitions, not on
  these flags; that is the behaviour we rely on and nothing currently pins it.)
- Unhiding emits the **delete/audit** row so mobile removes it (§5.1).
- **S16**: another member's hidden rows are never delivered.
- Backfill: a client syncing from scratch receives its own existing hidden rows.

### 9.5 Mobile — Drift

`mobile/test/infrastructure/repositories/merged_asset_drift_test.dart` is the home. The `.drift`
predicate is a hand-written mirror, so it needs its **own** copy of S1–S8, S15, E5, E6, E9, E13 — a
server test proves nothing about it.

New local table + sync handler; regenerate `merged_asset.drift.dart` after editing. Run with the Flutter
version pinned in `mobile/mise.toml` — read the pin, don't trust a remembered version. `dart analyze` is
not a substitute for `flutter test`: generated-code compile errors only surface when a test compiles.

### 9.6 Test-honesty requirements

Standing failure modes in this repo; each has produced a false green before.

- **Prove red first.** Flip the fixture flag and confirm each test fails for the stated reason. A mobile
  widget test that passes with the feature disabled measures nothing.
- **No assertions that cannot fail.** `queryBy…` returning null passes whether or not the element ever
  rendered; assert presence _and_ absence explicitly.
- **A fast path masks its own arm tests.** The §6.2 collapse is exactly the shape that hid a real bug
  before: every scenario that hides something also risks leaving the viewer with nothing to hide, so the
  collapsed path runs and the full predicate is never emitted. S2–S8 **must** give the viewer at least
  one other, visible space. Assert on generated SQL where it matters.
- **`tsc` green means nothing on a re-key** — it sees neither raw SQL nor Drift strings.

### 9.7 Existing tests this change puts at risk

Audit these **before** writing new ones; each is either still correct (proving we didn't over-reach) or
needs updating with a recorded reason.

| Test                                                                                          | Why at risk                                   | Expected                                                            |
| --------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------- |
| `spaces-albums-timeline.e2e-spec.ts:181` — viewer toggling "show in my timeline"              | sits on the redefined surface                 | still passes; viewer doesn't own the photo, so only `V` applies     |
| `spaces-albums-timeline.e2e-spec.ts:150` — album toggle drops/re-adds in the space Photos tab | now governed by the shared flag alone         | still passes; a failure means slice 8 or 9 touched the space browse |
| `shared-space-visibility-matrix.medium.spec.ts`                                               | asserts today's "owner always sees their own" | **will need updating**                                              |
| `accessible-timeline-asset-predicate.medium.spec.ts`                                          | collapsed vs expanded forms                   | new term must appear in both or neither                             |
| `timeline-bucket-explicit-visibility.medium.spec.ts`                                          | interacts with the owner-arm split            | review                                                              |
| `sync-shared-space-album.spec.ts`, `shared-space-album-link-sync.spec.ts`                     | new sibling stream                            | should be untouched                                                 |

### 9.8 E2E

`e2e/src/specs/web/spaces-albums-timeline.e2e-spec.ts` is the right home — it is already built around
these toggles.

- **space switch, owner's own photos**: owner links their album into a space, hides the space, asserts
  their own photos leave `/photos` and return on unhide. #1041's headline scenario.
- **album switch, owner's own photos**: same at album granularity.
- **the two album switches are independent**: an editor hiding from the space's photos does not change
  another member's `/photos`, and vice versa. This is the §2 consequence, so it must be demonstrably
  intentional.
- **cancellation is visible**: a photo in a hidden album that is also added directly to the space stays
  on `/photos` — the scenario most likely to generate a follow-up report.
- **the confirm dialog states a count**, and cancelling changes nothing.
- **shared link unaffected**: a link to an album hidden by its owner still serves the photos (§3).

API specs under `e2e/src/specs/api/`: the two preview endpoints (non-member → 403, count matches what
the timeline drops, zero case), and the new hide/unhide endpoint (a member can only write their own row).

### 9.9 Web

Component tests (`space-album-card.spec.ts`, `space-albums-table.spec.ts`, `space-layout.spec.ts` all
exist): the three switches render three distinct strings; editor-only items are hidden from viewers;
each dialog surfaces its count; the editor dialog's "also hide from my own timeline" checkbox writes the
actor's row and nothing else.

**Cache invalidation.** `+layout.svelte:129` calls `invalidateAll()` after the member toggle, which
reloads route data but does not reach the `/photos` `TimelineManager` — a different, unmounted route
that refetches on mount. Likely fine, but assert that navigating to `/photos` after a toggle shows the
new result rather than a cached bucket. The **album** toggle's handler was not audited during this
design and may not invalidate at all.

---

## 10. Slices

Fourteen slices, each producing working, testable software. Ordering is chosen so that **every
behaviour-changing slice is preceded by mechanical, zero-behaviour-change ones** — if a timeline
regression appears at slice 8, slices 1–7 are already proven inert and the cause is unambiguous.

### Slice 0 — Recon (no code, no commit)

Not an implementation slice; a gate before slice 1. Two outputs:

1. Reproduce the space-timeline half of #1041 on a real stack (§1). If it reproduces, it is a **separate
   bug** — file it and fix it independently of this work.
2. Run the §9.7 at-risk tests against unmodified `main` and record their current state, so a later
   failure can be attributed.

### Foundation — slices 1–4 (nothing reads the flag)

| #     | Goal                                                                                                                                                                                          | Tests                                                                                                         | Done when                                                     |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **1** | `shared_space_album_hidden` + `_audit` tables, delete trigger, composite FK to `shared_space_album` (§5.1); fork migration `1793000000000-AddSharedSpaceAlbumHidden.ts` with the §5.3 seeding | E11 (row gone on unlink), E11b (re-link not hidden), E14 (rows remain on member removal), E14b, E18, E19, E20 | migration runs on a seeded DB; schema-drift medium test green |
| **2** | `SharedSpaceRepository.hideAlbumForUser` / `unhideAlbumForUser` / `getTimelineHiddenScope`; controller + DTOs; membership-gated, own-row-only                                                 | resolution rules 1–5 (§6.2) incl. A1 and the `MINUS`; own-row-only rejection                                  | API specs green; OpenAPI + Dart regen committed               |
| **3** | Server sync stream `SharedSpaceAlbumHiddenV1` (+ delete + backfill), all six registration points (§5.4)                                                                                       | S16 (never receive another member's rows), delete emits audit, cold backfill                                  | sync medium specs green                                       |
| **4** | Mobile Drift table + sync handler; **no predicate change**                                                                                                                                    | Drift: rows land, unhide removes them, another member's rows never arrive                                     | `flutter test` green on the `mobile/mise.toml` pin            |

### Mechanical — slices 5–7 (still zero behaviour change)

| #     | Goal                                                                                                                                                                                | Tests                                                                                                | Done when                                                                        |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **5** | Replace `requireShowInTimeline?: boolean` with the required union `albumTimelineGate` (§6.1). **Every one of the 18 + 22 sites maps to `'space-tab'`** — today's behaviour, exactly | **no test changes at all.** The entire existing suite green, unmodified, is the proof                | triage table (site → value → reason) in the PR; a new call site fails to compile |
| **6** | `hiddenFromOwnTimeline` predicate builder (§6.3), deliberately **not wired** to any query                                                                                           | unit + medium on the builder: each arm, the `NULL` library guard (E13), collapse-when-empty (E5, E6) | helper covered; still no behaviour change                                        |
| **7** | Split the caller's own id from `userIds` in `TimeBucketOptions` + `timeline.service.ts` (§6.4)                                                                                      | E10 — partner assets unaffected (trivially true now; pins the shape before it can break)             | existing timeline suite green, unmodified                                        |

### Behaviour — slices 8–10

| #      | Goal                                                                                                 | Tests                                                                           | Done when                                                      |
| ------ | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **8**  | Wire the subtraction into `/photos`; flip personal-timeline sites from `'space-tab'` to `'personal'` | S1–S16, E1–E4, E7, E7b, E8, E9, E12, E15, E16, E17. §9.7 audit reviewed         | medium green; **§7 perf re-measured** on the personal instance |
| **9**  | Folder view (`view-repository.ts:60`) — **not** `tag.repository.ts:88` (§4)                          | folder-view equivalents of S2, S5, S6                                           | medium green                                                   |
| **10** | Mobile timeline predicate: `merged_asset.drift:63` and `:166`, regenerate `merged_asset.drift.dart`  | Drift copies of S1–S8, S15, E5, E6, E9, E13 — a server test proves nothing here | `flutter test` green                                           |

### Polish — slices 11–14

| #      | Goal                                                                                                                    | Tests                                                                                                               | Done when                      |
| ------ | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| **11** | Copy split: three switch names + two badges (§8), nine locales, docs incl. the "not a privacy feature" sentence         | web component specs: three distinct strings, editor-only items hidden from viewers                                  | i18n prettier gate green       |
| **12** | Preview endpoints (§8.1) + all three confirm dialogs with counts + the editor "also hide from my own timeline" checkbox | API specs (403 for non-member, count matches, zero case); web specs incl. the checkbox writing only the actor's row | OpenAPI + Dart regen committed |
| **13** | Memories: three projections + `assetRepository.getByDayOfYear`                                                          | memory equivalents of S2 and S5; hidden photos leave immediately, not overnight                                     | medium green                   |
| **14** | E2E on `spaces-albums-timeline.e2e-spec.ts` (§9.8)                                                                      | all six E2E scenarios                                                                                               | e2e green                      |

### Per-slice verification — run these, do not trust a narrow local check

Every one of these has produced a false green in a previous `/impl-loop` on this repo. A subagent
reporting "green" from the gate its own slice touched is **necessary but not sufficient**.

> **`make` targets do not exist.** `CLAUDE.md` documents `make check-server`, `make sql`,
> `make open-api`, `make lint-*`, `make format-*` — the root Makefile has only "moved to mise" stubs,
> and a **catch-all swallows any unknown target into `dev`**, so a wrong target prints
> `This command has been removed. Please use: mise dev` then `make: *** [dev] Error 1`. That reads like
> a broken toolchain but means only that the target name is wrong. Use the commands below.

| Gate                                       | Command                                                                                                                                                                                                                                                                                                                                                                                                                                  | Applies to           |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Server types                               | `cd server && npx tsc --noEmit` — vitest does **not** typecheck; three slice agents have previously reported "all green" from vitest while leaving `tsc` errors                                                                                                                                                                                                                                                                          | every server slice   |
| Server unit tests                          | `cd server && pnpm test --run <path>` — **never** `pnpm test -- --run <path>`, which silently drops the filter and runs everything. Bare `pnpm exec vitest run <path>` loads no config and dies with `describe is not defined` (a false red)                                                                                                                                                                                             | every server slice   |
| Server medium tests                        | `cd server && npx vitest --config test/vitest.config.medium.mjs run test/medium/specs/<path>` — `pnpm test:medium -- --run <path>` silently drops the filter too. Needs Docker                                                                                                                                                                                                                                                           | 1, 2, 3, 6, 8, 9, 13 |
| Server lint                                | `cd server && pnpm lint` (eslint `--max-warnings 0`)                                                                                                                                                                                                                                                                                                                                                                                     | every server slice   |
| SQL query docs — **destructive if misrun** | See the boxed recipe below. Required whenever **anything** under `server/src/repositories/` changes, body-only edits included                                                                                                                                                                                                                                                                                                            | 2, 3, 5, 6, 8, 9, 13 |
| Web checks + lint                          | `cd web && pnpm check:typescript && pnpm check:svelte`, then `pnpm lint` — CI's **Lint Web** is a separate job running eslint → prettier → svelte-check sequentially, so one push can fail three different ways in turn. Local `check:svelte` can scan **0 files**                                                                                                                                                                       | 11, 12               |
| OpenAPI incl. **Dart**                     | **Do not** run mise's top-level `open-api` task from a worktree — it hardcodes `//server:…`, which resolves to the **main checkout**, silently generating clients from the wrong source. Run in-worktree: `cd server && pnpm build && node ./dist/bin/sync-open-api.js`, then the oazapfts step, then `cd open-api && bash ./bin/generate-dart-sdk.sh` (needs JDK 21). Verify by regenerating **twice**: a correct run is byte-identical | 2, 3, 12             |
| Dart client diffs are opaque               | `.gitattributes` marks `mobile/openapi/**/*.dart` `-diff -merge`, so git shows `Bin N -> M bytes` with no textual diff. **Verify content with `grep`, not `git diff`**                                                                                                                                                                                                                                                                   | 2, 3, 12             |
| i18n sort + format                         | `pnpm --filter=immich-i18n format:fix` — CI runs prettier on `i18n/` (not `web/src/lib/i18n/`) and fails on any diff; appended keys land unsorted                                                                                                                                                                                                                                                                                        | 11                   |
| Prettier everywhere                        | `cd server && npx prettier --check "src/**/*.ts"`, plus `npx prettier --check` on touched markdown — CI's `prettier --cache --check .` catches files a local format pass missed                                                                                                                                                                                                                                                          | every slice          |
| Mobile format (CI scope is **narrower**)   | `mise //mobile:format` covers `lib` only; running `dart format` over `test` too is stricter than CI and injects unrelated churn. Format only your own files: `dart format --set-exit-if-changed --output=none <file>`                                                                                                                                                                                                                    | 4, 10                |
| Mobile tests                               | `flutter test` on the pin in `mobile/mise.toml` — **read the pin**. Export `PATH` _first_, don't chain `cd x && export …` (the Bash tool persists cwd, the second `cd` fails, `&&` short-circuits and the export never runs). `dart analyze` is not a substitute                                                                                                                                                                         | 4, 10                |
| E2E                                        | `cd e2e && pnpm test <path>` — **no** `--run`; `e2e`'s own script already carries it and passing it again crashes with `Expected a single value for option "--run"`                                                                                                                                                                                                                                                                      | 14                   |

Two mock idioms that fight each other: `mockResolvedValue()` trips TS2554, `mockResolvedValue(undefined)`
trips `unicorn/no-useless-undefined`. The codebase idiom is **`mockResolvedValue(void 0)`**.

#### The SQL regen recipe — read before running it

`sync-sql.ts` does an unconditional `rm -rf server/src/queries/` in `setup()` **before it connects**. If
the connection then fails it writes nothing, leaving zero query files and a ~7,500-line deletion diff
that looks like a catastrophic refactor. If that happens: `git checkout -- server/src/queries/`.

It also reads **`dist/`, not `src/`** — repositories are imported from the build — so a regen without an
immediately preceding build silently reflects stale code.

This work **adds a migration in slice 1**, so from slice 1 onward the shared dev-stack DB has the wrong
schema and a scratch DB is required (matching CI's `sql-schema-up-to-date` job):

```bash
# 1. scratch DB on a free port, pinned to the image CI uses
docker run -d --name sql-regen -p 55432:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=immich \
  ghcr.io/immich-app/postgres:14-vectorchord0.4.3   # use the exact sha from CI

# 2. build FIRST, then migrate, then regen — all three, in this order
cd server && pnpm build
DB_URL=postgres://postgres:postgres@localhost:55432/immich pnpm migrations:run
DB_URL=postgres://postgres:postgres@localhost:55432/immich node ./dist/bin/sync-sql.js

# 3. confirm ONLY the expected files moved, and that the change you made is actually in them
git diff --stat -- server/src/queries/
```

Step 3 is not optional: a stale-`dist` regen produces a plausible-looking diff that is missing the very
gate you just added.

### TDD stance for every slice

Red → green → refactor, with the red observed **for the stated reason**. Slices 5 and 7 invert this:
their proof is that the **existing** suite stays green with no test edits, so any test change in those
slices is itself a finding. §9.6's honesty requirements apply throughout — in particular, every scenario
in slice 8 must give the viewer a second, visible space, or the §6.2 collapse silently runs the wrong
code path and the test proves nothing.

## 11. Appendix — slice 5 gate triage (38 sites)

Every call site's chosen `albumTimelineGate`, recorded because slice 8 must walk this table by hand:
the compiler cannot enumerate the sites (§6.1). `'space-tab'` is today's `requireShowInTimeline: true`;
`'none'` is today's absent. **Slice 8 flips a subset of the `'space-tab'` rows to `'personal'`** — the
personal-timeline surfaces. The `'none'` rows are reachability/RBAC checks and must not move.

| Site                                    | Gate        | Why                                                                     |
| --------------------------------------- | ----------- | ----------------------------------------------------------------------- |
| `utils/database.ts:835`                 | `space-tab` | asset browse, spaceId timeline filter                                   |
| `utils/database.ts:873`                 | `space-tab` | asset browse, timelineSpaceIds filter                                   |
| `utils/shared-link-space-tether.ts:63`  | `none`      | shared-link publish tether — pure reachability                          |
| `asset.repository.ts:445`               | `space-tab` | asset browse (spaceId)                                                  |
| `asset.repository.ts:493`               | `space-tab` | asset browse (timelineSpaceIds)                                         |
| `asset.repository.ts:1784`              | `space-tab` | Explore-strip city aggregation                                          |
| `access.repository.ts:862`              | `none`      | `checkSharedSpaceAccess` — PersonRead reachability                      |
| `access.repository.ts:909`              | `none`      | `checkSharedSpaceEditAccess` — reachability                             |
| `face-person-verdict.repository.ts:765` | `none`      | `getPendingForSpacePerson` reachability                                 |
| `face-person-verdict.repository.ts:851` | `none`      | `hasPendingForSpacePerson` reachability                                 |
| `face-person-verdict.repository.ts:893` | `none`      | `isFaceReachableInSpace` reachability                                   |
| `map.repository.ts:127`                 | `space-tab` | map browse, albumIds + timelineSpaceIds                                 |
| `map.repository.ts:170`                 | `space-tab` | map browse, timelineSpaceIds album arm                                  |
| `memory.repository.ts:97`               | `space-tab` | memory candidate assets                                                 |
| `person.repository.ts:633`              | `none`      | face RBAC scope narrowing                                               |
| `person.repository.ts:825`              | `none`      | `getStatistics` memberUserId narrowing                                  |
| `search.repository.ts:1128`             | `none`      | face-search candidates (reachability)                                   |
| `search.repository.ts:1205`             | `space-tab` | `getAssetsByCity` — Explore "view all"                                  |
| `search.repository.ts:1431`             | `space-tab` | `getAccessibleTags` spaceId branch                                      |
| `search.repository.ts:1450`             | `space-tab` | `getAccessibleTags` timelineSpaceIds branch                             |
| `search.repository.ts:1574`             | `none`      | album-participants branch inside a specific-album query                 |
| `search.repository.ts:1595`             | `space-tab` | spaceId branch (filter suggestions)                                     |
| `search.repository.ts:1617`             | `space-tab` | timelineSpaceIds branch (filter suggestions)                            |
| `view-repository.ts:65`                 | `space-tab` | folder explorer `ownedOrSpaceAccessible`                                |
| `shared-space.repository.ts:553`        | `space-tab` | `getAssetCount` — space Photos tab count                                |
| `shared-space.repository.ts:1370`       | `space-tab` | `getRecentAssets` — Photos tab preview                                  |
| `shared-space.repository.ts:1434`       | `space-tab` | `getLastAssetAddedAt` — Photos tab metadata                             |
| `shared-space.repository.ts:2320`       | `none`      | `getSpaceRepresentativeFaceForUpdate` reachability                      |
| `shared-space.repository.ts:2362`       | `none`      | `getSpaceRepresentativeFaces` reachability                              |
| `shared-space.repository.ts:2725`       | `none`      | `getIdentityEvidenceForSpacePerson` reachability                        |
| `shared-space.repository.ts:2836`       | `space-tab` | `getPersonAssetIds`                                                     |
| `shared-space.repository.ts:2996`       | `none`      | `isSpacePersonRepresentativeFaceValid`                                  |
| `shared-space.repository.ts:3040`       | `none`      | `getFirstValidRepresentativeFaceForPerson`                              |
| `shared-space.repository.ts:3346`       | `none`      | `getAssetIdsWithoutOtherSpacePath` — face-cleanup anti-join             |
| `shared-space.repository.ts:3753`       | `none`      | `getScannableSpacePeopleWithUnassignedFaces`                            |
| `shared-space.repository.ts:3833`       | `none`      | `isAssetInSpace` (contributed arm)                                      |
| `shared-space.repository.ts:3943`       | `none`      | `getAssetIdsInSpacePage` — comment states "NOT gated by showInTimeline" |
| `shared-space-album-scope.ts:432`       | `space-tab` | `accessibleTimelineAssetPredicate` — People-page reachability           |

No site required guessing: each `'none'` either carries a doc comment stating it is reachability-only,
or is plainly not a browse surface (RBAC checks, face-cleanup anti-joins, representative-face validity).

The **empty `server/src/queries/` diff** after the refactor is strong independent evidence that none were
mis-mapped: a wrong value changes emitted SQL, and that shows up whether or not a test exercises the
surface. **Its limit, stated precisely:** `sync-sql` only captures queries reachable from
`@GenerateSql`-decorated repository methods. A site inside an undecorated helper contributes only via
its decorated callers, so the check is broad but not provably total. It is a very good check, not a
proof — pair it with the triage table rather than treating either as sufficient alone.

## 12. Out of scope

- Search, map, People page, tag explorer — Archive parity (§4).
- Retiring `shared_space_album.showInTimeline`. It keeps a real job (§2).
- Resetting the space-level flag on upgrade (§8.2).
- The `jit` question — already handled by `1783628194057-DisablePostgresJit.ts`.
