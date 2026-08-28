# Rolling rebase branch — full review findings (Wave 0: the option-M person re-key)

**Status: Waves 0, 1 and 2 COMPLETE (18 agents + 1 follow-up). Wave 3 (adversarial refutation) CANCELLED by decision — everything here is SINGLE-SOURCED.**
**Part 1 below is the option-M re-key. Part 2 (Waves 1–2) starts at "PART 2" and contains the higher-severity findings.**
Written 2026-08-26. Uncommitted, untracked file on the rolling branch.

|                           |                                                                                                 |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| Branch                    | `rebase/upstream-rolling-v3.1.1` @ `ab50d5ab716`                                                |
| Worktree                  | `/Users/pierre/dev/gallery/.worktrees/rebase-upstream-rolling-v3.1.1`                           |
| New base                  | `upstream/main` `093f5c070ad` (level, 0 behind)                                                 |
| Old base of `origin/main` | `8aa95c67470`; `origin/main` = `a5626f3d9b9`                                                    |
| CI at review time         | 10/10 gating workflows green on `80154b8eb93`; `test.yml` 21/21 on `77b4afeca3a`                |
| Scope                     | Track 0 only — the `person.id` → `(ownerId, personGroupId)` re-key (upstream #30739 / option M) |

Nothing was fixed, committed, or pushed. **Everything here is single-sourced** — the adversarial
refutation wave has not run.

---

## Verdict

**No finding blocks the cutover on correctness of the re-key itself.** The re-key is in better
shape than the M landing's history would suggest. Three independently built live databases
(fresh install, Immich→Gallery switch, existing-Gallery upgrade) produce **byte-identical
schemas with zero drift**; the rename is clean across 4,337 SQL regions; permission-gate counts
show zero drops; the amputation and dormancy invariants hold 36/37; the mobile Drift foreign
keys survived the upstream relocation.

What the review actually found is four different kinds of problem, and they want four different
decisions:

1. **Two live user-visible bugs** — #1 (rebase regression, admin surface, upgrade path) and #2
   (pre-existing, wedges a page for space members).
2. **One safety net switched off** — #3. W0-D proved no drift is hiding behind it _today_, which
   is what makes it a process finding rather than a data finding.
3. **One possible live RBAC hole whose premise is unverified** — #4. Cheap to settle; settle it first.
4. **Latent traps that fire on a future action** — the next `upstream.version` bump (#6), the next
   upstream batch touching `packages/scripts` (#7), a fork migration rollback on an
   Immich→Gallery instance (#9), or the day anyone drops `person_personGroupId_key` (#11).

Plus a coverage story that is better than expected in the places that already broke, and thin in
one specific place: **the Space viewer's asset-detail people list has no test that can fail at
any layer** (C1).

---

# A. Defects, ranked

| #     | Finding                                                                            | Sev              | Confidence                 | Class                                 | Surface |
| ----- | ---------------------------------------------------------------------------------- | ---------------- | -------------------------- | ------------------------------------- | ------- |
| 1     | Pre-M JSONB blob vs post-M reader empties the face-cleanup console on upgrade      | **High**         | CONFIRMED                  | Rebase regression (M landing)         | server  |
| 2     | Space People page: duplicate-key grid wedge + silent person skip                   | **High**         | CONFIRMED (mechanism)      | Pre-existing fork                     | web     |
| 3     | CI schema-drift gate (`migrations:generate`) is inert                              | **High**         | CONFIRMED                  | Pre-existing upstream                 | CI      |
| 4     | Can a space **Viewer** draw face boxes on the owner's photos?                      | **High if true** | UNVERIFIED premise         | Pre-existing fork                     | server  |
| 5     | Mobile Drift FK can abort the entire sync stream                                   | Med-High         | PLAUSIBLE                  | Pre-existing shape, enabled by re-key | mobile  |
| 6     | `revert-to-immich.sql` deletes migration rows the pinned tag ships                 | Medium           | CONFIRMED                  | Pre-existing                          | scripts |
| 7     | Fork's deletion of `packages/scripts` partially reverted                           | Medium           | CONFIRMED                  | **Rebase regression, this cycle**     | repo    |
| 8     | Filter-sheet person picks drop `spaceId` → chip avatar 400s                        | Medium           | CONFIRMED                  | Pre-existing fork                     | mobile  |
| 9     | Two fork migrations have unguarded `down()` — rollback wedges on Immich→Gallery    | Med-Low          | **CONFIRMED on a live DB** | Pre-existing (M era)                  | server  |
| 10    | Two more paginated people lists append without dedupe                              | Medium           | PLAUSIBLE                  | Pre-existing                          | web     |
| 11    | Four undocumented M-reliance sites missing from the invariant inventory            | Medium           | CONFIRMED (as reliance)    | Pre-existing                          | server  |
| 12    | Merge leaves an orphan `person_group`; fork dropped upstream's sweep               | Low-Med          | CONFIRMED                  | Pre-existing fork                     | server  |
| 13    | Upstream's shared-album timeline widening is inert; call sites disagree            | Low-Med          | CONFIRMED (divergence)     | Rebase regression                     | server  |
| 14    | `mobile/analysis_options.yaml` adopted byte-identical, reverting a fork divergence | Low              | CONFIRMED                  | Rebase regression                     | mobile  |
| 15    | `personGroupId` ships on the wire from the scan-status endpoint                    | Low              | CONFIRMED                  | Pre-existing (M era)                  | server  |
| 16    | `person-join-not-viewer-filtered` is a two-literal grep, not a behavioural gate    | Low              | CONFIRMED                  | Pre-existing                          | CI      |
| 17–21 | Trivia: dead export, three stale comments, one orphan comment                      | Trivial          | CONFIRMED                  | mixed                                 | mixed   |

---

## 1. Pre-M JSONB blob vs post-M reader — face-cleanup console renders empty after upgrade

**High. CONFIRMED. Rebase regression from the M landing.**

`face_repair_scan.persons` is a JSONB snapshot; its _element shape_ is not a DB column, so
`1791000000000-RepointFaceReviewToPersonGroup` — which renames the three face-review **columns** —
never touches it. The M landing renamed the key _inside_ the blob from `personId` to
`personGroupId`, and every reader crosses DB→TS via `as unknown as RepairScanPerson[]`, so `tsc`
cannot see the mismatch.

- Writer on released fork: `git show origin/main:server/src/repositories/face-repair-scan.repository.ts:38-39` → `personId: string`
- Reader on branch: same path `:38-39` → `personGroupId: string`
- Read sites, all behind casts: `face-repair-scan.repository.ts:182`, `:219`; `face-repair.service.ts:635`, `:655`, `:659`
- Migration: three `ALTER TABLE … RENAME COLUMN`, zero `UPDATE face_repair_scan SET persons = …`. No compat read anywhere.

**Failure scenario.** An instance on released `origin/main` holds one completed `face_repair_scan`
row (`pruneSupersededScans` keeps exactly one). Admin upgrades to this branch, opens
`/admin/face-cleanup` → `GET /admin/face-repair/scan/latest`:
`withCurrentNames` builds `ids = persons.flatMap(p => [p.personGroupId, …])` → `[undefined, …]`,
the `IN` list binds `NULL`; `withLiveFlaggedCounts` gets `[undefined]` → empty although
`face_repair_scan_flagged_face` still holds correctly-keyed rows; `flagged: 0` for everyone;
`.filter(p => p.flagged > 0)` (`face-repair.service.ts:692`) drops all rows.

Result: header and totals render, **zero person rows**. No error, no log. Self-heals only on a
re-scan. Byte-for-byte the symptom of M landing defect #5, on the upgrade path.

**Why no gate catches it.** e2e always seeds a _fresh_ DB with the post-M key
(`face-cleanup.e2e-spec.ts:98,137,174,206`); the medium pin builds a post-M blob
(`face-repair.scan.spec.ts:159`). Nothing in CI loads a pre-M blob, and every schema gate is
blind to a JSONB value's interior.

### DECIDED FIX (2026-08-27) — clear the stale scan, do not rewrite the blob

**Confirmed with Pierre: the face-cleanup scan shipped and users are running it**, so this is a real
upgrade-path defect, not a personal-instance shrug. `face-repair-scan.repository.ts` first appears in
tag **v5.4.0** (absent in v5.3.1), and v5.4.0's `RepairScanPerson` declares `personId: string` — so
every v5.4.0+ instance that ran a scan holds a pre-M blob.

**The decision is to DELETE the stale scan rows, not rewrite them.** One fork migration:

```sql
DELETE FROM face_repair_scan WHERE jsonb_path_exists(persons, '$[*].personId');
```

`jsonb_path_exists(x, p)` is the function form of `x @? p` — "does any array element carry a
`personId` key?". Chosen over the operator because the fork has no jsonpath precedent in its
migrations and the function form avoids the literal `?`. Verified: `persons` is
`@Column({ type: 'jsonb', default: '[]' })` typed `RepairScanPerson[]`, i.e. a **top-level array**
(so `$[*]` is the right path) and non-nullable (no NULL case). PG floor is **14**; jsonpath needs 12.

**Why clearing beats the rewrite originally proposed:**

1. **A rewrite only fixes the key we happened to notice.** It assumes the rest of the persisted shape
   is unchanged between v5.4.0 and this branch. Clearing sidesteps every shape question at once.
2. **Nothing of value is lost.** `face_repair_decline` — the admin's persisted "leave it" decisions —
   has **no `scanId` reference at all** (its FKs are `asset_face`, `person_group`, `user`), and
   neither does `face_person_verdict`. The only cascade is `face_repair_scan_flagged_face`
   (`onDelete: 'CASCADE'`), whose own table comment calls it "a point-in-time scan snapshot". Human
   decisions survive; derived data is recomputed by the next scan.
3. **The empty state is already the fresh-install state.** `getLatestScanStatus` returns `null` when
   there is no scan (`face-repair.service.ts:613-615`) — exactly what a new instance shows. A cleared
   instance lands in a well-trodden "no scan yet, run one" state instead of the current silent
   header-with-no-rows.
4. The predicate targets only pre-M blobs, so the migration is precise and **safe to re-run**; an
   instance that already re-scanned keeps its fresh scan.

**Also required:** a medium spec that inserts a pre-M blob, proves the console renders empty
**first**, then proves the migration clears it. And a **release-note line** — otherwise an admin who
had run a scan finds the console reset with no explanation.

## 2. Space People page — duplicate-key grid wedge, plus a silent skip

**High. CONFIRMED (mechanism, by code read; not reproduced in a browser). Pre-existing fork bug — not a rebase regression, not re-key related.**

`web/src/routes/(user)/spaces/[spaceId]/people/+page.svelte:313-314` appends with
`offset: people.length` and `people = [...people, ...more]`, while mutating the server's own sort
keys **in place**: `:368`/`:425` (`onNameSubmit`, birthdate save) and `:445` (`handleHide`) all
keep the array length unchanged. Server order:
`isHidden ASC, name ASC NULLS LAST, assetCount DESC, id`
(`server/src/repositories/shared-space.repository.ts:1745-1751`). Grid is keyed:
`web/src/lib/components/people/people-grid.svelte:117`.

**A — duplicate → wedge.** Space with >`PAGE_SIZE` people; viewer names an unnamed person; that
row leaves the `NULLS LAST` tail for its alphabetical position, shifting everything between down
one. Next `loadMore()` re-emits the previous page's boundary row → duplicate id → Svelte 5
`each_key_duplicate` → that `{#each}` stops updating for the rest of the session while the
sentinel keeps firing requests. Byte-for-byte the symptom `a472367a024` (#847) fixed on `/people`.

**B — silent skip.** The list is fetched without `withHidden`, so the server applies
`where('isHidden','=',false)`. `handleHide` removes the person server-side but keeps it locally,
so `offset` runs one too high and the next page **permanently omits one person**. No error at all.

**Fix.** Route the append through `appendUniqueById` (`web/src/lib/utils/people-utils.ts:76`) —
the helper #847 added for exactly this. That fixes A but **not** B; B needs a keyset/id cursor or
a refetch-from-zero after any `isHidden`/`name` mutation.

`space-people-page.spec.ts` has 4 tests, none covering pagination — and one,
`it('moves a newly named person into alphabetical order')`, documents the very reorder that
triggers A.

---

## 3. The CI schema-drift gate is inert

**High (process). CONFIRMED. Pre-existing upstream; fork-specific consequence.**

`.github/workflows/test.yml:797`:

```yaml
- name: Generate new migrations
  continue-on-error: true
  run: pnpm --filter migrations:generate src/TestMigration
```

`--filter` selects _packages_, not scripts. No package is named `migrations:generate`
(`server/package.json` is `"immich"`), so pnpm exits non-zero with "No projects matched the
filters", `continue-on-error: true` swallows it, and `verify-changed-files` sees no changes →
green. Regression landed in upstream `a6e5e4f6252` ("fix: schema ci checks (#18146)");
`upstream/main` carries the identical broken line.

This is the gate that, during the M landing, was the **only** thing that caught the face-review
table definitions still declaring `personId` with FKs to a deleted column while `tsc` sat at
zero — it emitted a 24-statement drift migration. The fork carries a hand-repointed schema, so
the fork is the side that pays.

**Mitigating fact:** W0-D ran the correct form against three live DBs — **no drift**. Nothing is
hiding behind it today.

**Fix.** `pnpm --filter immich migrations:generate src/TestMigration`, and drop
`continue-on-error: true` (or assert the step outcome). The file is upstream-owned, so a
fork-side alternative is a separate Gallery job leaving upstream's line byte-identical.

**Related.** 44 raw-SQL regions carry no `@GenerateSql` decorator and sit outside the live-DB
gate entirely — including all three `face-repair*` repositories. W0-C hand-read all 44 and W0-D
executed 17 directly; both clean, but nothing in CI does either.

---

## 4. Can a space Viewer draw face boxes on the owner's photos?

**High if true. PREMISE UNVERIFIED — settle this first tomorrow, it is cheap.**

`createFace` is gated on `Permission.AssetUpdate` = owner ∪ `checkSpaceEditAccess`
(`person.service.ts:1533` → `utils/access.ts:159-163`). The _pieces_ are pinned —
`checkSpaceEditAccess` has a full DB matrix (`access-space-visibility.repository.spec.ts:476`,
`shared-space-visibility-matrix.medium.spec.ts:507`) — but the **composition** is not tested.

Every existing test in `e2e/src/specs/server/api/face.e2e-spec.ts:61-73, 131-145, 335-354`
targets `ctx.ownerAssetId`, which `actors.ts:47` documents as **not in the space**. So
`spaceNonMember: 400` is satisfied by "asset unreachable", never by a face-level rule, and
`ctx.spaceEditor` / `ctx.spaceViewer` are never used despite being in the fixture. The comment at
`:62-64` is also stale — it claims `Permission.AssetRead` where the code now requires
`AssetUpdate`.

**Settle it:** run the same three matrices against `ctx.spaceAssetId` with editor and viewer.
Expected: editor 201, viewer 400. If a viewer gets 201, this is a live write-access hole into
another user's library and jumps to the top of this list.

---

## 5. Mobile Drift FK can abort the entire sync stream

**Med-High if reachable. PLAUSIBLE — mechanism confirmed, reachability not proven.**

Before #30739, `asset_face.personId` FK'd `person.id`, a row with exactly one owner by
construction, so the two owner-scoped sync streams could never disagree. After the re-key,
`asset_face.personGroupId` FKs `person_group.id`
(`server/src/schema/tables/asset-face.table.ts:47`), which upstream deliberately made
owner-agnostic. What still guarantees "the group id on my asset's face resolves to a person **I**
own" is the fork's unique index plus application logic — not the database.

Mobile is where that is load-bearing: `PRAGMA foreign_keys = ON`
(`mobile/lib/data/db/main/database.dart:440`), and `updateAssetFacesV1/V2`
(`sync_stream.repository.dart:1239-1305`) insert `personId` straight from the wire with no
existence check. A face referencing an unsynced person raises a SQLite FK violation, caught,
logged `severe`, and **rethrown** (`:1310`) — aborting the sync batch. Effect: **the app silently
stops syncing entirely**, not just people.

**Why PLAUSIBLE.** No reachable write path found: `reassignFace` is access-gated, and space face
matching writes `shared_space_person_face`, never `asset_face.personGroupId`. W0-F independently
traced all 9 `set({ personGroupId })` writes to their RBAC gates and agreed. The theoretical
window is between `personRepository.delete()` and `deleteEmptyGroups()`
(`person.service.ts:725-728`).

**Cheap defensive fix.** Make the local `personId` a loose reference (drop `.references(...)`, as
the fork already does deliberately for `shared_space_asset.assetId` and
`shared_space_library.libraryId` for this exact "stream ordering is not guaranteed" reason), or
null unknown `personId`s at write time.

---

## 6. `revert-to-immich.sql` deletes migration rows the pinned tag actually ships

**Medium (latent, high impact). CONFIRMED. Pre-existing.**

`scripts/revert-to-immich.sql:357-364` claims _"The tagged upstream release in
branding/config.json does not ship this migration"_ about
`1784647658615-AddOAuthBearerTokenToSession`, and drops `session.oauthBearerToken`. Same for
`1784836013770-MinFacePreferenceMigration` (`:376`). `branding/config.json` pins
`upstream.version = "3.1.0"` — and **v3.1.0 ships both**. Both names are in step 8's
`DELETE FROM "kysely_migrations"` list (`:672`).

**Today: benign**, verified end to end. Those two are the _last two_ migrations in v3.1.0's list,
so deleting their rows leaves the executed set a proper prefix; upstream's ordered migrator
re-runs them (both idempotent). W0-D simulated the v3.1.0 boot: `applied 2 migrations`, and
`pg_dump -s` matches a true v3.1.0 DB.

**Latent.** The next `upstream.version` bump can turn a currently-tail migration into a _middle_
one. Step 8 then deletes a row from the middle of the tag's history and Kysely throws
`corrupted migrations: expected previously executed migration … to be at index i` — **upstream
Immich refuses to boot at all.**

**Fix.** Correct the two comments; add a maintenance rule to section 7 that step-8 deletions must
always be a **suffix** of the pinned tag's list, re-checked at every `upstream.version` bump.
Simpler: stop dropping the column and stop deleting the rows — they are at-tag, so leaving them
is the correct state.

---

## 7. The fork's deletion of `packages/scripts` was partially reverted — this cycle

**Medium (low blast today, re-adoption landmine). CONFIRMED. Rebase regression, THIS cycle.**

The fork deleted upstream's entire `packages/scripts/` tree in `bc06e84a1f4` ("drop upstream
#29331 release-version tooling"). This cycle, upstream's Renovate commit `aa6e4d9173f` touched
that package's `package.json`; the replay resolved the delete/modify conflict toward upstream and
**re-added the file alone**.

- `packages/scripts/package.json:1` — byte-identical to `093f5c070ad`, declaring
  `"main": "pump-wrapper.ts"` and `build`/`check`/`lint`/`test` scripts, **no source on disk**
- `pnpm-lock.yaml:393` — a `packages/scripts` importer with `commander`, `semver`, `@types/node`,
  `@types/semver`, `vite`, `vitest`. `origin/main` has zero.
- `pnpm-workspace.yaml:2,11` matches `packages/**`, so pnpm treats it as a workspace member

Shape I from the zero-conflict memory: fork deletes a file, upstream later writes one at that path.

**Failure scenario.** `pnpm install` pulls six dependencies for a package with no code. Any
filtered or recursive build/check/lint/test over the workspace hard-fails with nothing to fix.
Longer term: the workspace now claims upstream's release tooling exists, so **the next upstream
batch adding files under `packages/scripts/` applies cleanly instead of conflicting**, silently
re-adopting tooling the fork deliberately rejected.

**Why no gate saw it.** `grep -rn 'packages/scripts\|@immich/scripts' .github/` → empty. No CI job
touches it; `--frozen-lockfile` passes because the lockfile was regenerated _with_ the importer.

**Fix.** `git rm packages/scripts/package.json`, regenerate `pnpm-lock.yaml`, and add a
fork-deletion invariant (an `ownership.yml` forbidden path) so the next Renovate-shaped commit
re-conflicts instead of re-landing.

**Detector worth adopting:** set algebra over `git ls-tree` — fork-deleted paths ∩ files present
in HEAD. That is what found this and it is not currently any gate.

---

## 8. Filter-sheet person picks drop `spaceId` → active chip's avatar 400s

**Medium (user-visible). CONFIRMED. Pre-existing fork bug — equivalent defect on `origin/main`.**

`mobile/lib/presentation/widgets/filter_sheet/strips/people_strip.widget.dart:119` and
`.../deep/people_section.widget.dart:130` both build `FilterPerson(id:, name:)` on selection — no
`spaceId` — although the suggestion DTO carries the scope in `primaryProfile.spaceId` and the
strip's _own_ avatar three lines away already uses it. `activeChipsFromFilter` then passes
`avatarPersonSpaceIds: [null]`, so `active_filter_chip.widget.dart:115` de-tokenizes with
`spaceId: null` and falls to the **owner-only** branch →
`GET /people/<shared_space_person_id>/thumbnail`. That id has no row in the owner-only `person`
table, so `requireThumbnailAccess` misses both `checkOwnerAccess` and `checkSharedSpaceAccess`
and it 400s.

**Scenario.** Viewer or editor, member of a timeline-enabled space, online. Filter sheet → People
strip → tap a shared-space person. The **filter works** (the tokenized id is right for
`personIds`), but the chip renders a blank avatar. The same person picked from the full People
picker renders correctly (`people_picker.provider.dart:20-27` carries `spaceId`) — so the same
person shows a face or a blank depending on which surface picked them.

**Fix.** At both sites read `person.primaryProfile.orElse(null)` and pass
`spaceId: profile?.type == spacePerson ? profile?.spaceId.orElse(null) : null`, exactly as
`photosFilterPersonThumbnailUrl` already does three lines away.

---

## 9. Two fork migrations have unguarded `down()` — rollback wedges on Immich→Gallery

**Med-Low. CONFIRMED on a live database, with one prediction refuted. Pre-existing (M era).**

Fork commit `280bafbcb40` ("make the fork migrations tolerate the Immich-to-Gallery order") added
the `clusterGroupsApplied()` guard to `up()` on all six order-sensitive migrations, but to
`down()` on only one (`1791000000000`).

**Ordering premise, settled on a live DB.** `ClusterGroups` is recorded **first** on the
Immich→Gallery path and **third** on a fresh install. Kysely reverts in reverse
execution-timestamp order, so on the Immich path `ClusterGroups` is reverted **last of all 62** —
every fork `down()` runs while `person.id` is still gone.

**Claim 1 — CONFIRMED, and it wedges.** Revert walk on the Immich-path DB:

```
step 5   reverted: 1788000000000-ReconcileFacePersonVerdictConstraints
step 6   Error: 1787100000000-DropPersonFksBeforeClusterGroups
         ERROR: column "id" referenced in foreign key constraint does not exist
step 7   (same)   step 8   (same)
```

The migration is the head of the rollback queue forever; no fork migration below it can ever be
reverted on an Immich→Gallery instance. **Prediction refuted:** the FKs are _not_ left
half-restored — Kysely runs `#migrateDown` in a transaction, so the step rolls back atomically.
The database is **consistent but permanently stuck**, not damaged.

**Claim 2 — CONFIRMED but masked.** `1778800000000-ReconcileFaceIdentityIndexOverrides.ts:57-60`
sits nine migrations below the wedge, so the walk never reaches it; proved in isolation against a
clone of the wedge-point DB → `column "personId" does not exist`. Run outside a transaction it
loses the index (the unguarded `DROP` lands, the `CREATE` fails); inside the migrator it rolls
back and wedges instead.

**Control.** The same walk on a fresh install is clean: `ClusterGroups` is reverted at step 7,
`person.id` comes back, and step 8 lands the FKs correctly. That is why this has never fired.

**The caveat that does NOT save us.** `pnpm migrations:revert` refuses this DB outright
(`corrupted migrations: …`) because sql-tools hardcodes `allowUnorderedMigrations: false`. But
that is not the fork's revert path: `database.repository.ts:490-493` keeps `revertLastMigration()`
with an explicit comment that it is _"the ONLY way to exercise revert against the composite
provider"_, and it runs `allowUnorderedMigrations: true`. **The fork's own sanctioned rollback
mechanism is the one that breaks.**

**Severity reasoning (W0-D's, and I agree):** `revertLastMigration()` has no production caller —
only two medium specs — no CLI or admin command is wired to it, nothing boots wrong and no data
is lost. What breaks is the rollback escape hatch, on the one install path it exists to serve.

**Fix (~6 lines).** `if (await clusterGroupsApplied(db)) return;` at the top of
`1787100000000.down()`; wrap `1778800000000`'s `asset_face` DROP/CREATE pair (and its
`migration_overrides` UPDATE) in the same `if (!(await clusterGroupsApplied(db)))` its `up()`
uses, plus `IF EXISTS` on the DROP. Add a down-path scenario in the Immich order to
`database-migration.service.spec.ts` — its existing scenarios D/G exercise revert only in the
fresh order, which is why the whole class was invisible.

---

## 10. Two more paginated people lists append without dedupe

**Medium. PLAUSIBLE (needs a concurrent external write). Pre-existing.**

`web/src/routes/(user)/people/manage/+page.svelte:53` and
`web/src/routes/(user)/spaces/[spaceId]/people/+page.svelte:346-347`. Both carry the in-flight
guard #847 added, and `handleSaveVisibility` closes the save-then-scroll path via `onClose()`.
What remains is the OFFSET-window-shift half: any concurrent change to
`isHidden`/`isFavorite`/`name`/visible-asset-count — a second tab, a finishing recognition job —
between two page fetches re-emits a boundary row → `each_key_duplicate` → wedge.
**Fix:** `appendUniqueById` at both sites.

---

## 11. Four undocumented M-reliance sites, missing from the invariant inventory

**Medium (future-proofing). CONFIRMED as a reliance, not a live bug. Pre-existing.**

`specs/2026-08-22-option-m-invariant-inventory.md` §1 says: _"A new call site added without a line
here is an assumption nobody can find later."_ These four are absent:

- `server/src/repositories/face-repair-scan.repository.ts:380-385` — `new Map(people.map(p => [p.id, p]))`
  over a `where('personGroupId','in',…)` query that is **not owner-scoped**. Two owners in one
  group ⇒ `new Map` keeps the last ⇒ wrong `ownerId`/`name`/`thumbnailFaceId` in the admin
  face-repair report. Raw Kysely, so invisible to the `getByGroupIdOnly` grep the inventory teaches.
- `server/src/dtos/asset-response.dto.ts:171-179` — `peopleFromFaces` dedupes by `personGroupId`
- `server/src/services/asset.service.ts:164-168` and `person.service.ts:388-393` —
  `identityByPersonId = new Map<personGroupId, identityId>` across faces that may span owners on a
  shared asset

Safe today (`person_personGroupId_key` holds; the tripwire medium test asserts _rejection_).
Dropping that index — step 1 of ever enabling cluster groups — corrupts all four with no compiler
or test signal. **Fix:** add them to §1; optionally `.where('ownerId','=', …)` on the first, which
`enrichReportPersons` already has in context.

---

## 12. Merge leaves an orphan `person_group` — the fork dropped upstream's sweep

**Low-Medium. CONFIRMED. Pre-existing fork.**

Upstream's `mergePerson` calls `removeAllPersonGroups([mergeId], ownerId)`
(`upstream/main:person.service.ts:641`), ending in `deleteEmptyGroups()`. The fork delegates to
`IdentityMergePropagationService` → `PersonRepository.mergePersonProfile`
(`person.repository.ts:228`), which deletes the `person` row and **never sweeps the group**.
Self-healing via the nightly `PersonCleanup` job, so the effect is bounded to orphan rows between
sweeps — but nothing tests that linkage, and no test anywhere asserts `person_group` hygiene after
a merge. **Fix:** assert `person_group` count drops by one after `mergePerson` in the medium spec.

---

## 13. Upstream's shared-album timeline widening is inert, and the call sites disagree

**Low-Medium (latent). CONFIRMED as divergence; PLAUSIBLE as user-visible. Rebase regression.**

Upstream #30739 widened the person-scoped timeline so a viewer also sees that person's faces on
album-shared assets. The fork carried it into `withTimeBucketAssetFilters` as
`options.personId && viewerId` (`server/src/repositories/asset.repository.ts:482-483`, `:491-492`)
— but the only producer destructures `personId` **out** and re-emits it as `personIds`
(`server/src/services/timeline.service.ts:51`, `:54-56`, `:124`), so the branch is unreachable.

Separately `getTimeBuckets` passes `auth.user.id` as `viewerId` (`asset.repository.ts:1553`) while
`getTimeBucket` has `auth` in hand and passes only two arguments (`:1655-1661`); upstream applies
it in both. This contradicts the fork's own comment at `:1650-1652`: _"so the asset list can never
drift out of sync with the scrubber counts."_

Latent under M (`asset_face.personGroupId` is always same-owner). Goes live if `personId` is ever
threaded through or the unique index is dropped: scrubber shows N photos, bucket paints blank.
**Fix:** either wire it properly (pass `auth.user.id`, condition on `options.personIds?.length`)
or delete `TimeBucketOptions.personId` (`:106`) and both dead branches with a note that the fork
rejects the widening deliberately.

---

## 14–21. Low and trivial

- **14 — `mobile/analysis_options.yaml` adopted byte-identical**, reverting the fork's removal of
  `always_put_control_body_on_new_line` (`:68`, `:102`, dropped in `29abec9b878`). Green today;
  forward cost is a build failure for `if (x) return;`. Decide: re-drop, or record the convergence
  in `docs/fork/ownership.yml`.
- **15 — `personGroupId` on the wire.** `face-repair.service.ts:635-638` spreads `...person` and
  adds `personId`, so the storage name ships from `/admin/face-repair/scan/latest`. Undeclared in
  the OpenAPI spec (count 0). `ZodSerializerInterceptor` is registered (`app.module.ts:48`) but
  **no route carries `@ZodSerializerDto`**, so nothing validates responses. Fix: destructure
  instead of spreading. (The _suspectedOwners_ spread at `:620-627` is load-bearing — leave it.)
- **16 — `person-join-not-viewer-filtered` is a grep, not a gate.** `runCiInvariantAudits` does
  `file.text.includes(pattern)` against exactly two literals (`docs/fork/ownership.yml:499-501`).
  It cannot see a variable rename, an `eb(...)`/`whereRef` form, removal of the `orderBy`/`limit(1)`
  (which would return a nondeterministic row), or `asset.repository.ts` — not in `paths` despite
  carrying a person join at `:1048`. The behaviour _is_ pinned by real medium tests; just do not
  treat a green invariant audit as evidence.
- **17 — Dead export.** `server/src/utils/cluster-groups-order.ts:48` `assetFacePersonColumn`, zero
  call sites.
- **18 — Stale index name** in `face-repair-scan.repository.ts:227` (`asset_face_personId_…` no
  longer exists; live name is `…personGroupId…`).
- **19 — Stale comment** at `person.service.ts:386-387` claiming `mapFaces` nulls unowned people;
  untrue since #796, though the loop re-checks ownership itself.
- **20 — Orphan comment** at `web/src/routes/(user)/user-settings/SharingSettings.svelte:34`
  referring to "the group" — the deleted cluster-group half.
- **21 — Stale spec paths** in ten comments (`docs/superpowers/specs/` → `specs/`), including one
  inside a live gate at `docs/fork/ownership.yml:496`.

---

# B. Coverage gaps, ranked

## C1 — Space viewer's asset-detail `people`: no test that can fail, at any layer ★ highest blast radius

**Missing test:** `server/test/medium/specs/services/asset.service.spec.ts`, beside the existing
`describe('get (shared-album recipient)')` at `:993`.

**Must assert:** owner asset with a face + person, a Space containing the asset, a Viewer member,
a `shared_space_person` linked to the identity → `sut.get(auth(viewer), asset.id, space.id)`
returns `people` non-empty carrying `spacePersonId`; plus (b) a person hidden via
`shared_space_person.isHidden` is omitted for the viewer, (c) still visible to the owner and in a
_second_ space (proving the hide is per-space, not identity-wide), (d) a non-member passing
`spaceId` gets 403, (e) a person with no linked space profile is dropped (pins the
`p.spacePersonId &&` filter at `asset.service.ts:123`).

**Bug it catches:** the exact M defect the fork already shipped once — `withFacesAndPeople`
filtering the person join to the viewer returns `person: null`, `data.people` is `[]`, and **every
space viewer's asset-viewer People section goes blank**, plus hidden people stop being hidden. The
shared-_album_ twin **is** covered (`:1005-1035`) because that is how the bug was found; the
**Space** path — the fork's flagship feature, reached from web via `GET /assets/:id?spaceId=` —
was not. Today the only tests are unit tests that mock the repository and an e2e suite that never
asserts `asset.people` at all.

## C2 — Immich→Gallery migration produces an _unasserted_ schema

**Missing test:** `database-migration.service.spec.ts`, appended to Scenario B (`:68-127`).
**Must assert:** dump `information_schema` (tables, columns, constraints, indexes) plus
`migration_overrides` after Scenario A (fresh) and Scenario B (upstream-first); assert identical.

**Bug it catches:** Scenario B today asserts only that migrations _ran_ and that names interleave.
Six fork migrations branch on `clusterGroupsApplied` and take **different SQL** on the two paths —
e.g. `1778400000000-AddFaceIdentities.ts:82-89` skips `asset_face_personId_idx` and its
`migration_overrides` row entirely on the Immich-first path. A branch skipping one index too many,
or pointing an FK at the wrong table, yields a database that boots, passes every test, and is
silently missing a constraint for every user who switched from Immich.

**Note:** W0-D did this comparison **by hand** this cycle and it passed. C2 is about making that
permanent rather than a once-off.

## C3 — `POST /faces` / `PUT /faces/:personId` on a space asset, editor vs viewer

This is defect #4's test. `e2e/src/specs/server/api/face.e2e-spec.ts` — a second matrix against
`ctx.spaceAssetId` over `{spaceOwner, spaceEditor, spaceViewer, spaceNonMember, anon}`; editor 201
/ viewer 400 for create, same split for reassign.

## C4 — `getFacesForPicker` has no negative-access test at any layer

`person.service.ts:451`'s `requireAccess({ permission: PersonRead })` **was silently dropped by a
replay once** (17→16, found by a grep-count diff, not a test). All six existing call sites mock
access as granted, so deleting the line again leaves the suite green. Symptom is bounded —
`getRepresentativeFaces` still applies `scope: { memberUserId }`, so an unauthorised caller gets an
empty 200 rather than face data — so this is defence in depth. Model it on
`person-representative-face-write-scope.e2e-spec.ts:44-87`, which has the full matrix.

## C5 — `face_repair_decline` has zero e2e exercise

The `personId → personGroupId` rename and both re-pointed FKs in
`1791000000000-RepointFaceReviewToPersonGroup.ts:74-80` are exercised by **no e2e test at all**.
Add one round-trip in `face-cleanup.e2e-spec.ts`: dismiss a cluster, read it back from
`GET /admin/face-repair/decline`, assert `personId` matches and the dismissal survives a re-scan.
The DTO alias _is_ pinned at the repository layer, so this is a wiring gap, not an open hole.

## C6 — `person_group` hygiene after a merge

Defect #12's test. Assert the `person_group` row count drops by exactly one after `mergePerson`.

---

# C. Tests that cannot fail

Fourteen, verified by exhaustive repo-wide greps proving the asserted key/field has zero
producers, or by reading the gating expression. The ones that matter for the re-key:

| #                         | Where                                                                               | Why it stays green                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1                         | `e2e/.../pet-detection.e2e-spec.ts:501-504`                                         | "should include pet in asset people list" never reads `asset.people` — it asserts `expect(asset).toBeDefined()`. **`AssetResponseDto.people` is asserted nowhere in `e2e/src/specs/server/**`** — the highest-traffic place the re-keyed id crosses the public contract                                                                                                         |
| 9                         | `server/src/services/person.service.spec.ts:6264-6270, 6297-6303`                   | The `searchFaces` assertion omits **`userIds: [ownerId]`** — the one argument that makes the M invariant hold. Zero `userIds` assertions anywhere in the unit spec. **This is the gap the deleted upstream test left** (see D)                                                                                                                                                  |
| 3                         | `server/src/controllers/face-repair-admin.controller.spec.ts:259-266` + 16 siblings | `mockResolvedValue({declines: []})` then `toMatchObject({declines: []})` — true by construction. The **only** spec at the boundary where all 17 `as Promise<Dto>` casts live, and no route carries `@ZodSerializerDto`, so nothing validates responses. Exactly how `getLatestScanStatus` shipped without `personId`. (The auth half — `adminRoute: true` on 17/17 — _is_ real) |
| 4                         | `e2e/.../global-face-identities.e2e-spec.ts:180-183`                                | Four `not.toContain` leak assertions with **no positive control**. If `GET /people?withSharedSpaces=true` returned `[]` for everyone — what a broken alias or dropped join produces — all four pass                                                                                                                                                                             |
| 12                        | `people-cross-owner-merge.e2e-spec.ts:167-185` etc.                                 | "userB keeps their person" verified entirely through raw SQL on `personGroupId` — the **storage** layer. The re-key risk lives at the `personGroupId → personId` alias, which a storage assertion bypasses. `GET /people` as userB is never called                                                                                                                              |
| 14                        | `face-repair.scan.spec.ts:148, 215, 235, 368`                                       | Three of four sites locate the person by the **internal** `p.personGroupId`, which the DTO does not have. Only `:159` pins the public name — one line deep in a four-site pattern                                                                                                                                                                                               |
| 2, 5, 6, 7, 8, 10, 11, 13 | see agent report                                                                    | harness mocks the layer under test; assertions on test-ids with zero producers; a `filters` prop never passed so the asserted bar is structurally unmountable; an `alias` field no `.svelte` file reads; an UPDATE with no `rowCount` check                                                                                                                                     |

**Standing note:** `e2e/src/ui/**` hand-writes `PersonResponseDto`-shaped JSON with no
`@immich/sdk` type reference (`mock-network/people-avatar-network.ts:30-53`,
`face-editor-network.ts:56-96`). That suite contributes **zero** coverage to the re-key question
and should not be counted toward it.

---

# D. The deleted tests — seven, not six

| Test                                                                                                          | Property                                                          | Tested now?                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `person.repository.spec.ts` — "put people created with the same group into that group"                        | Two owners can share one `person_group`                           | **Inverted, correctly.** `:119-136` asserts a second owner's `create` **rejects** with `/person_personGroupId_key/` and the group still holds one row. Executable statement of M's invariant, falsifiable                                                                                                                                                        |
| same — "should not return a person owned by another user"                                                     | Owner leg of the composite key                                    | **Replaced** at `:146-155` with a reachable equivalent                                                                                                                                                                                                                                                                                                           |
| `cluster-group.service.spec.ts` — the whole `leaving a shared cluster group` describe (2 tests)               | `ClusterGroupService.leave` re-parents groups                     | **No — correctly.** Reachable only via the unmounted controller. Dead code, not a gap                                                                                                                                                                                                                                                                            |
| `person.service.spec.ts` medium — 3 merge-propagation tests                                                   | Merge across cluster-group members                                | **Not restored, none needed.** That propagation _is_ the cluster-groups feature; the fork's own merge semantics are covered far more heavily                                                                                                                                                                                                                     |
| `person.service.spec.ts` unit — "create a person in the matched group when the match belongs to another user" | `handleRecognizeFaces` creating a person in another owner's group | **No — and this is the one real gap.** The scenario is unreachable _only because_ `handleRecognizeFaces` scopes `searchFaces({ userIds: [ownerId] })`. Nothing asserts that scoping (cannot-fail #9). Drop `userIds` and the branch goes live: `create({ownerId, personGroupId})` violates the unique index, the recognition job fails, faces are never assigned |

The two new medium-factory helpers (`insertPersonGroup`, `insertClusterGroup`,
`test/medium.factory.ts:889-902`) are genuinely exercised across 20+ call sites, generate
FK-satisfying rows, and fail loud (`executeTakeFirstOrThrow`). No finding.

**Nothing else was quietly disabled** — a sweep for `it.skip`/`describe.skip`/`it.todo`/`xit`
across `server/`, `web/`, `e2e/` found only docker-gated and unrelated skips, none person- or
face-related.

**Two suspicions checked and disproved:** the face-repair admin console _does_ assert `adminRoute:
true` on 17/17 routes; and a rebase merging `PersonUpdate` into the `PersonRead` branch _would_ go
red (`server/src/utils/access.spec.ts:472-490` pins all three of Update/Delete/Merge, asserting
both an empty result and `checkSharedSpaceAccess).not.toHaveBeenCalled()`).

**All four production bugs that got past a green `tsc` during M are now pinned by falsifiable
tests** — `withPerson`/`withFacesAndPeople` viewer-preference, the composite-PK `GROUP BY`,
`getStatistics`'s disjunction, and `findOrFail`'s owner-agnosticism. The `getAllWithoutFaces`
LEFT-JOIN class is pinned with a regression comment. Both DTO drops behind casts are pinned.

---

# E. No action — recorded so they are not re-litigated

- **Nine orphaned cluster-group i18n keys.** Upstream keys for a declined feature. Deleting them
  fights upstream translation sync every cycle and breaks `translations.g.dart` regeneration. All
  10 interpolated `$t(\`…\`)`sites in`web/src` were enumerated; none can construct them.
- **`NotificationPanel.svelte:55` still handles `ClusterGroupRequest`.** Reachable only via the
  unmounted controller; a benign dead-end for an Immich→Gallery switcher with a pre-existing row.
- **Column ordinal differences** between install paths. Zero ordinal-dependent SQL exists anywhere.
- **`move_history` unique key now carries a group id.** Identical to upstream, latent upstream too,
  inert under M; paths are owner-namespaced so no file collision.
- **`asset-face.table.ts` byte-identical to upstream** with the fork partial index absent from the
  class: correct — it is `migration_overrides`-declared, repointed by `1791000000000:130,133`.
- **`person_group` missing from two hand-rolled e2e reset lists**
  (`people-cross-owner-merge.e2e-spec.ts:23-38`, `people-merge-space-collapse-block.e2e-spec.ts:19-36`)
  while `utils.ts:201-222` includes it — orphan groups accumulate across `beforeEach`. Harmless.

---

# F. Verified clean — do not re-review

- **Schema, three ways.** Fresh install, Immich→Gallery, existing-Gallery upgrade all produce
  byte-identical schemas. `migrations:generate` → "No changes detected" on all three;
  `schema-drift.spec.ts` primitives → `NO DRIFT`; **154 `migration_overrides` rows identical
  across all three paths**; 158 migrations (96 upstream + 61 gallery + 1 alias); the load-bearing
  `ChangeDurationToInteger` alias emits both filenames.
- **Raw SQL.** Zero missed renames, zero over-renames across **4,337 SQL regions** (692 person/face)
  plus 624 split generated queries, alias-resolved against the parsed schema of all 98 tables.
  Independently corroborated by a live `information_schema` sweep of every quoted
  `"table"."column"` pair and every INSERT column list: **0 unknown**.
- **Substring trap held.** Zero `shared_space_person*.personGroupId`;
  `shared_space_person_face."personId"` retains **223** production references; the 50-lines-apart
  `source_person`/`target_person` collision resolves correctly in both files.
- **`GROUP BY` under the new PK.** All person-keyed groups use the composite PK or an explicit
  `(personGroupId, name)` pair. **687 `@GenerateSql` queries executed live**: zero
  `must appear in the GROUP BY clause`. Regenerated `.sql` docs: **0 changed files**.
- **Permission gates.** `requireAccess` per-file counts vs both `origin/main` and `upstream/main`:
  **zero drops**. Extended to `requireOrFail`, `requireElevatedPermission`, `checkAccess`,
  `requireSpaceRole`, and a per-controller diff of the `@Authenticated` permission multiset.
- **Owner-scoped filters.** The shared-album recipient path traced end to end. `withPerson`
  prefer-viewer-then-fallback intact and pinned by a green `make ci-invariants-check`.
- **LEFT JOIN → INNER JOIN.** Scripted alias-tracking scan; every person/face hit is an intentional
  anti-join. `getAllWithoutFaces` still has its predicate in the ON clause.
- **Amputation + dormancy: 36/37 PASS.** Controller unmounted with reversal note; `cluster-group`
  count 0 in the spec, 0 in the TS SDK, no Dart API; service has no `@OnEvent`/`@OnJob`; 3 dormancy
  banners; exactly 8 `searchAssetBuilderLegacy` call sites; `clusterGroupId` count 0 in
  `search.repository.ts`. (The 37th is defect #7.)
- **Mobile.** The Drift relocation did **not** strip shared-space FKs this time — verified in
  generated code and the committed `drift_schema_v36.json`. Local PK safe; sync cursors page on
  `updateId`/audit id, never the re-keyed column; `spaceId` routing holds with the right ids on both
  sides; provider split has not reverted. 44/44 targeted tests pass.
- **Nothing can create the multi-owner state.** All 9 `set({ personGroupId })` writes traced to
  their RBAC gates. The Immich→Gallery migration probes for multi-owner groups and throws a
  **named error** rather than failing silently.
- **`revert-to-immich.sql`** round-trips from both source paths; `gallery-core` plugin-row cleanup
  present; all 8 post-tag upstream migrations handled.
- **Full server unit suite:** 6062 pass, 12 skipped, 0 fail.
- **Web:** `grep -rn "personGroupId" web/src` is **empty** — the rename is genuinely confined to
  the server.

---

# G. Open — not done

1. **Wave 1 (6 agents)** — interdiff + zero-conflict shape hunt per surface: server, web, mobile,
   ML+e2e+CI, schema/generated artifacts, i18n/branding/docs. **Not started.**
2. **Wave 2 (3 agents)** — coverage of the other fork subsystems: spaces/RBAC + S3, classification +
   pet + memories, filters/search + mobile sync + revert-to-immich + branding. **Not started.**
3. **Wave 3 (2 agents)** — adversarial refutation of every finding above. **Not started. Everything
   in this document is single-sourced.**
4. **`#1029`** — one fork commit on `origin/main` is not yet replayed onto the branch.

## Not covered by Wave 0

- Browser reproduction of #2 and #10; no dev stack was started.
- The full medium suite locally (needs `packages/sdk` + `plugin-core` built in the worktree; an
  unbuilt run reads falsely green). CI ran it on this tip.
- The Docker-boot half of Revert-to-Immich Validation — the tag's migrator was simulated, not booted.
- `mobile/`'s 1,007 Drift SQL regions counted and spot-checked, not audited. `mobile/test/**` not
  examined beyond the four files run.
- `machine-learning/` not examined.
- ~40 Playwright specs under `e2e/src/specs/web/` audited for RBAC and raw SQL, **not** for
  can't-fail UI assertions. ~190 web spec files outside the person/face name filter swept by regex
  only.
- No mutation testing. Cannot-fail findings rest on greps proving zero producers, or on reading the
  harness.
- Anything outside the re-key: the remaining fork delta (3,224 files) is Waves 1–3.

---

---

# PART 2 — Waves 1 & 2 (surface interdiff, shape hunt, and coverage)

**Status: 9 of 9 agents reported.** **Wave 3 (adversarial refutation) was deliberately NOT run** — so everything in this document, Part 1 included, is
**single-sourced**. Treat CONFIRMED findings as strong where evidence is pasted, and PLAUSIBLE ones
as needing a second opinion before spending effort.

Waves 1–2 went _around_ the person re-key, which Part 1 settled. They found more than Part 1 did,
and the centre of gravity moved: **the worst items here are not rebase regressions at all** — they
are long-standing fork defects that only became visible when someone asked "would a test catch
this?"

## Revised top of the list

Merging both parts, ranked by what I would fix first:

| Rank | Finding                                                                           | Part    | Sev      | Class                             |
| ---- | --------------------------------------------------------------------------------- | ------- | -------- | --------------------------------- |
| 1    | Docs branding destroys the AGPL attribution on the live public site               | 2 · §22 | **High** | Pre-existing                      |
| 2    | Human face detection destroys pet people, irreversibly                            | 2 · §23 | **High** | Pre-existing (also on `main`)     |
| 3    | An unknown `SyncEntityType` kills all mobile sync                                 | 2 · §24 | **High** | Pre-existing                      |
| 4    | `removeAutoTagAssignments` un-archives assets globally                            | 2 · §25 | **High** | Pre-existing                      |
| 5    | Revert-to-Immich orphans every S3 asset; the guide says the opposite              | 2 · §26 | **High** | Pre-existing                      |
| 6    | Storage rollback after `deleteSource:true` reports success and breaks the library | 2 · §27 | **High** | Pre-existing                      |
| 7    | Pre-M JSONB blob empties the face-cleanup console on upgrade                      | 1 · #1  | **High** | Rebase regression                 |
| 8    | Space People page duplicate-key wedge + silent skip                               | 1 · #2  | **High** | Pre-existing                      |
| 9    | The CI schema-drift gate is inert                                                 | 1 · #3  | **High** | Pre-existing upstream             |
| 10   | `AssetShare`→`AssetUpdate` swap silently widened permissions                      | 2 · §28 | Med-High | **Rebase regression, this cycle** |

---

## A2. Defects found in Waves 1–2, ranked

| #     | Finding                                                                                                                                                                                                                                                                                                                                                                        | Sev      | Confidence             | Class                        | Surface       |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ---------------------- | ---------------------------- | ------------- |
| 22    | Docs branding pass destroys the AGPL attribution                                                                                                                                                                                                                                                                                                                               | **High** | CONFIRMED (reproduced) | Pre-existing                 | branding/docs |
| 23    | Face detection deletes pet faces and then the pet person                                                                                                                                                                                                                                                                                                                       | **High** | CONFIRMED (traced)     | Pre-existing fork            | server        |
| 24    | Unknown `SyncEntityType` aborts the whole sync stream                                                                                                                                                                                                                                                                                                                          | **High** | CONFIRMED (traced)     | Pre-existing fork            | mobile        |
| 25    | `removeAutoTagAssignments` un-archives globally                                                                                                                                                                                                                                                                                                                                | **High** | CONFIRMED              | Pre-existing fork            | server        |
| 26    | Revert-to-Immich orphans S3 assets; docs assert the opposite                                                                                                                                                                                                                                                                                                                   | **High** | CONFIRMED              | Pre-existing fork            | scripts/docs  |
| 27    | Storage rollback after `deleteSource:true` silently succeeds                                                                                                                                                                                                                                                                                                                   | **High** | CONFIRMED              | Pre-existing fork            | server        |
| 28    | `AssetShare`→`AssetUpdate` swap widened who can pin another user's asset                                                                                                                                                                                                                                                                                                       | Med-High | CONFIRMED (mechanism)  | **Rebase regression**        | server        |
| 29    | `GET /asset-files/:id/download` 400s for every S3-stored file                                                                                                                                                                                                                                                                                                                  | Medium   | CONFIRMED (traced)     | **Rebase regression**        | server        |
| 30    | Success toast renders a raw ICU plural string                                                                                                                                                                                                                                                                                                                                  | Medium   | CONFIRMED              | **Rebase regression**        | mobile        |
| 31    | Space bottom sheets render menu rows in the action row; Share long-press dead                                                                                                                                                                                                                                                                                                  | Medium   | CONFIRMED              | **Rebase regression**        | mobile        |
| 32    | "Open in app" banner dead on every memory URL                                                                                                                                                                                                                                                                                                                                  | Medium   | CONFIRMED              | **Rebase regression**        | web           |
| 33    | Migration ORDER append-only check is vacuous on `workflow_dispatch`                                                                                                                                                                                                                                                                                                            | Medium   | CONFIRMED              | **Rebase regression**        | CI            |
| 34    | `upstream-preflight` path filter omits 6 of the 8 paths its specs guard                                                                                                                                                                                                                                                                                                        | Medium   | CONFIRMED              | Pre-existing                 | CI            |
| 35    | 63 files carry branded output committed to source                                                                                                                                                                                                                                                                                                                              | Medium   | CONFIRMED              | Pre-existing                 | repo          |
| 36    | 16 branding rewrite rules match nothing; 2 never worked                                                                                                                                                                                                                                                                                                                        | Medium   | CONFIRMED              | Pre-existing                 | branding      |
| 37    | 3 brand source assets missing → 17 copy destinations silently no-op                                                                                                                                                                                                                                                                                                            | Medium   | CONFIRMED              | Pre-existing                 | branding      |
| 38    | `make ci-invariants-check` is run by no workflow                                                                                                                                                                                                                                                                                                                               | Medium   | CONFIRMED              | Pre-existing                 | CI            |
| 39    | S3 is not gated on any PR; the S3 integration spec never runs anywhere                                                                                                                                                                                                                                                                                                         | Medium   | CONFIRMED              | Pre-existing                 | CI            |
| 40    | A failing sync batch wedges all sync permanently                                                                                                                                                                                                                                                                                                                               | Medium   | CONFIRMED (traced)     | Pre-existing fork            | mobile        |
| 41    | `AGENTS.md`/`CLAUDE.md` Flutter pin is wrong, and was edited to a wrong value                                                                                                                                                                                                                                                                                                  | Low-Med  | CONFIRMED              | **Rebase regression**        | docs          |
| 42    | Branded-spinner guard is 2 files short of the real swap set                                                                                                                                                                                                                                                                                                                    | Low-Med  | CONFIRMED              | Pre-existing                 | CI            |
| 43    | `pnpm test:cov` crashes — nobody can measure coverage on this fork                                                                                                                                                                                                                                                                                                             | Low      | CONFIRMED (reproduced) | Pre-existing upstream        | tooling       |
| 44    | Websocket handlers swallow every error; V2 has an unguarded cast V1 guards                                                                                                                                                                                                                                                                                                     | Low      | CONFIRMED              | Pre-existing fork            | mobile        |
| 45    | `setAcks` takes the last ack per type, not the greatest                                                                                                                                                                                                                                                                                                                        | Low      | CONFIRMED              | Pre-existing (TODO in place) | server        |
| 46–52 | Trivia: stale patch reference, `migration-alias.spec.ts` documents the re-timestamp backwards, postbuild pruner blind to class-name renames, `ApiKeyCreateResponseDto` missing a mobile patch entry (inert), branding rationale comment lost in the config port, hard-coded English in `remove_from_space.action.dart`, `scripts/revert-to-immich/` path cited but nonexistent | Trivial  | CONFIRMED              | mixed                        | mixed         |

### Correction to Part 1, finding #7

Part 1 said "`grep -rn 'packages/scripts\|@immich/scripts' .github/` → empty. No CI job touches it."
**That premise is false by path rather than by name.** `.github/workflows/fix-format.yml:30` runs
`pnpm --recursive install && pnpm run --recursive --if-present --parallel format:fix`, and
`packages/scripts/package.json:26` declares `format:fix`. The `--recursive install` is also what
materialises the six phantom dependencies at `pnpm-lock.yaml:393-407`. Label-gated (`fix:formatting`),
so the blast radius stays small — but the reasoning in #7 needs amending, and `pnpm-workspace.yaml:2`
(`packages/**`) means any future recursive command reaches it too.

---

## 22. The docs branding pass destroys the AGPL attribution on every deploy

**High. CONFIRMED by reproducing the exact `sed` on a scratch copy. Pre-existing.**

`branding/scripts/apply-branding.sh:915` runs a catch-all `s/Immich/${NAME}/g` over
`docs/docusaurus.config.js`. Result after branding:

```
copyright: `Gallery is a fork of Noodle Gallery, available … GNU AGPL v3 License.`
{ label: 'Noodle Gallery',      href: 'https://immich.app' },
{ label: 'Noodle Gallery Docs', href: 'https://docs.immich.app' },
```

Source lines `docs/docusaurus.config.js:165`, `:169`, `:175`. `docs-deploy.yml:126` runs
`apply-branding`, so **this is live on `docs.opennoodle.de` now**: the attribution the AGPL requires
is rewritten to name the fork itself, and the two "Upstream" footer links are relabelled while still
pointing at `immich.app`.

Nothing catches it because the only check is absence-only —
`branding/scripts/verify-branding.sh:52-56` fails _only if_ `Immich` is still present, so it passes
**because** the substitution happened (see cannot-fail C2-2).

**Fix.** Shield the attribution strings the way the AppDownloadModal check was already hardened
(`verify-branding.sh:246-259`), and add a **positive** assertion: after branding the copyright must
still read "a fork of **Immich**" and the Upstream labels must still be `Immich` / `Immich Docs`.

---

## 23. Human face detection destroys pet people, irreversibly

**High. CONFIRMED by tracing; the concurrency window is inferred, not observed. Pre-existing fork — live on `main` too, not a rebase regression.**

`handlePetDetection` inserts pet faces via `personRepository.createAssetFace` **with no
`sourceType`**, so they take the column default `SourceType.MachineLearning`
(`asset-face.table.ts:75`). `handleDetectFaces` (`person.service.ts:960-1000`) then sweeps **every**
`sourceType === MachineLearning` face on the asset into `mlFaceIds`, and anything the human detector
does not IoU-match becomes `faceIdsToRemove` → deleted. `getForDetectFacesJob`
(`asset-job.repository.ts:235`) selects all faces with no pet exclusion and no `isPet` column.

Then `getAllWithoutFaces` (`person.repository.ts:615`) has **no `type` filter**, so the now-empty pet
person is deleted outright by `handlePersonCleanup` — name, thumbnail, birthDate, gone.

Two further arms of the same hole: the FD force reset
`deleteFaces({sourceType: MachineLearning})` (`:911`) hard-wipes pet faces, and the FR force reset
`unassignFaces({sourceType: MachineLearning})` (`:1085`) unassigns them into the same cleanup. And
when a human box _does_ IoU-match a pet box > 0.5, `embeddings.push({faceId: match.id, embedding})`
(`:981`) writes a **human embedding onto the pet's row**, feeding it into human clustering.

**Reachability.** `job.service.ts:226-228` fans out `AssetDetectFaces` and `PetDetection` for the
same asset on every upload, onto two different queues, concurrently — whichever finishes second
wins. A "safe" ordering only defers it to the next face-detection run (nightly force, model change,
or asset replace at `asset.service.ts:758`).

`grep -c pet server/src/services/person.service.spec.ts` → **0**, across 6,000+ lines.

### VERIFIED + DECIDED (2026-08-27) — real, already catalogued as F4; **skip**, ships with `feat/pet-recognition`

Pierre challenged this finding, so it was put to an adversarial verifier briefed to **refute** it and
to default to REFUTED when uncertain. Verdict: **CONFIRMED.** Every refutation hypothesis failed —
`createAssetFace` (`person.repository.ts:1447`) is a bare insert with no `sourceType` default;
`getForDetectFacesJob` (`asset-job.repository.ts:239`) calls `withFaces(eb, true, true)` selecting
`.selectAll('asset_face')` with no person-type filter, so pet faces do reach the loop;
`grep "pet|isPet|species"` over this branch's `person.service.ts` returns **zero** matches;
`getAllWithoutFaces` ends at `.having(count(...), '=', 0)` with no type filter and its caller goes
straight to `personRepository.delete(groupIds)`; and pet people are ordinary `person` rows
(`createWithGroup({ ..., type: 'pet', species })`).

The two kill lines are hard deletes, not soft: `person.repository.ts:1272-1274`
(`deleteFrom('asset_face')`) and `:368-373` (`deleteFrom('person')`).

**The fork already knows about this.** `feat/pet-recognition` fixes it at `person.service.ts:937-940`
and the comment names it:

```ts
// Pet faces carry the same machine-learning sourceType as human faces, so without the isPet
// guard they land in faceIdsToRemove and get hard-deleted on every re-detection (F4).
if (face.sourceType === SourceType.MachineLearning && !face.isPet) {
```

That branch also blocks a **second data-loss path this review had missed**: a human detection box
IoU-matching a pet face and overwriting it with a human embedding (`if (face.isPet) return false;`
in the match predicate).

**Correction to the original framing.** The claimed "fires on every upload via the concurrent job
fan-out" is **overstated**. `handleDetectFaces` snapshots `asset.faces` on entry, so if
`PetDetection` has not written yet there is nothing to sweep. The deterministic trigger is any
**subsequent** `AssetDetectFaces` run on an asset that already has pet faces — a force re-detection
or a re-queue of missing. The person deletion needs no force: `PersonCleanup` is queued automatically
at `person.service.ts:927` and is also a manual admin job.

**Irreversibility confirmed.** Pet re-detection is gated on `petsDetectedAt`, so a normal re-run
restores nothing. Even a forced re-run calls `getByOwnerAndSpecies`, finds the person gone, and
creates a fresh one with `name: pet.label` — a pet named "Rex" returns as "dog", birthDate and
thumbnail lost.

**DECISION: skip.** No extraction, no separate issue — the fix lands with `feat/pet-recognition`.
Accepted consequence: the defect remains live on `main` until that branch merges.

**Note.** The fix exists on `feat/pet-recognition` (#843's review-fix slices: `petFacePredicate` /
`excludePetFaces` / `excludePets` / the `isPet` column) and is **not merged**.

---

## 24. An unknown `SyncEntityType` kills all mobile sync

**High. CONFIRMED by direct read of all four steps. Pre-existing fork.**

`sync_api.repository.dart:187` does `SyncEntityType.fromJson(jsonData['type'])!`. The generated
`decode()` defaults `allowNull: true` and returns `null` for an unrecognised string
(`sync_entity_type.dart:166,277-280`) — **its own doc comment says that exists precisely so old apps
survive new enum values.** The `!` throws; the throw is inside the `try` at `:147`, so `:176`
converts it to `Future.error` and the entire `/sync/stream` pass dies.
`background_sync.dart:205` turns that into a silent `return false`.

The `converter == null` guard at `:191` — which `sync_stream.service.dart:422-429` explicitly names
as the thing enforcing "a new server-side `SyncEntityType` must NOT throw and must not stall the
stream" — sits **downstream of the `!`** and is unreachable for unknown values.

Mobile and server release independently, so this fires on the next server release that adds an
entity type.

**Fix.** Drop the `!`; skip unknown-type lines and let well-known lines in the same chunk proceed.
**Test:** an unknown `type` line is skipped, later lines still reach `onData` and are acked.

---

## 25. `removeAutoTagAssignments` un-archives assets globally

**High. CONFIRMED. Pre-existing fork.**

`classification.repository.ts:42-49` un-archives **every** asset holding the tag, unconditionally. It
never checks the category's `action`, never checks whether another auto-category still archives the
asset, and never distinguishes an automatic archive from a manual one. The query is keyed by tag
**value**, not by owner — so it is global.

Two concrete bugs: an asset archived by category A (`tag_and_archive`) that also carries category B's
tag gets un-archived when B is removed; and an asset the **user** archived by hand that happens to
carry a `tag`-only category's tag gets un-archived too. Fired by any admin threshold tweak, category
rename, or category delete. Silently returns private/archived photos to the main timeline **for all
users at once**.

The existing test (`classification.repository.spec.ts:206`) seeds exactly one tag and one archived
asset, so the over-reach is invisible.

Related, lower: `removeAutoTagAssignments` deletes `tag_asset` rows but never the `tag` rows, so
every removed or renamed category leaves a permanent zero-asset `Auto/<old name>` entry in every
user's tag tree.

---

## 26. Reverting to Immich orphans every S3-backed asset, and the guide says the opposite

**High. CONFIRMED. Pre-existing fork.**

`server/src/backends/storage-backend.provider.ts:9-13` routes **absolute** paths to disk and
**relative** keys to S3. Upstream Immich has no S3 backend, so after a revert every relative
`originalPath` resolves against the filesystem and 404s. `scripts/revert-to-immich.sql:153` then
drops `storage_migration_log` — the `oldPath`/`newPath` ledger, i.e. **the only data that could map
keys back to disk**.

`docs/docs/guides/switch-back-to-immich.md:16` states: _"Assets you uploaded through Gallery are
preserved… the normal case for every file uploaded via the web or mobile app."_ The `:::danger`
block (`:8-13`) mentions neither S3 nor storage-migration history, and step 5 (`:97`) says only
"remove any Gallery-only environment variables" without listing the nine (`env.dto.ts:54-60` + two).

**The docs correction is the urgent half**; the script should additionally refuse a relative-path DB.

---

## 27. Storage rollback after `deleteSource: true` reports success and breaks the library

**High. CONFIRMED. Pre-existing fork.**

`storage-migration.service.ts:305-340` — `rollback` only rewrites DB paths via `updatePath`. It never
copies bytes back, never checks the old path still exists, and **`deleteSource` is not recorded in
the migration log at all** (`:279-287` writes only entityType/entityId/fileType/oldPath/newPath/
direction/batchId).

So an admin who migrated to S3 with `deleteSource: true` and then rolls back gets
`{rolledBack: N, failed: 0}` — a **success response** — while every asset now points at a deleted
disk path and 404s.

The e2e's own comment documents the DB-only semantics
(`e2e/src/storage-migration.ts:1010-1013`), and CI runs `rollback` **only after
`delete-source-false`** (`.github/workflows/storage-migration-tests.yml:157-161`;
`phaseDeleteSourceFalse` overwrites `lastToS3BatchId` at `storage-migration.ts:1381`) — exactly the
one configuration where it is harmless. `phaseRollback`'s header still says "Precondition: files are
on S3 (run after migrate-to-s3)", so the harmless ordering looks accidental.

**Fix.** Record `deleteSource` in the log and refuse (or byte-restore) a rollback of a batch that
deleted its sources.

---

## 28. The `AssetShare` → `AssetUpdate` swap silently widened permissions

**Med-High. CONFIRMED for the permission change and the reachable cross-owner row. PLAUSIBLE for real-world impact. Rebase regression, this cycle.**

Upstream `immich-28950` repurposed `Permission.AssetUpdate` as the **owner-only** gate for adding
assets to memories and tags — owner-only _in upstream's vocabulary_ — and shipped
`1787148183730-DeleteMismatchedMemoryAssets`, which deletes every `memory_asset` row where
`memory."ownerId" != asset."ownerId"`.

**The fork defines `AssetUpdate` as owner ∪ space editor** (`utils/access.ts:159-163`;
`checkSpaceEditAccess` returns assets owned by _anyone_ in a space where the caller is editor/owner,
`access.repository.ts:492-530`). Adopting the constant therefore inverted the intent: the fork now
_permits_ exactly the cross-owner rows upstream's migration purges. Zero conflicts; both files are
individually correct.

- Branch: `memory.service.ts:311` (create), `:355` (addAssets), `tag.service.ts:119` — all `AssetUpdate`
- `origin/main`: `memory.service.ts:319` = `AssetShare`; `:360` and `tag.service.ts:107` used the old default `AssetShare` in `utils/asset.util.ts:42`
- `AlbumService` is **not** affected — upstream pinned `AssetShare` there and the branch matches

**Scenario.** Alice is an Editor of space S containing Bob's asset P. `PUT /memories/{aliceMemory}/assets {ids:[P]}`
now succeeds. Alice is later removed from S; `MemoryService.get` (`:299-303`) re-checks only
`MemoryRead` and returns `mapMemory(...)` with **no per-asset filter** — unlike `search` (`:256-262`),
which does filter by `AssetView`. So P's metadata is still served after revocation. Media bytes stay
gated by `AssetView`, so this is metadata persistence, not content leak.

No first-party client calls those routes (grep over `web/src`, `mobile/lib`, `e2e/src` is empty), so
reach is SDK-only today.

---

## 29. `GET /asset-files/:id/download` returns 400 for every S3-stored file

**Medium. CONFIRMED by tracing; not executed against a live S3 instance. Rebase regression, this cycle.**

Upstream `immich-25900` added an endpoint that builds an `ImmichFileResponse` straight from
`asset_file.path` (`asset-file.service.ts:36-46`). `sendFile` accepts only absolute paths
(`utils/file.ts:152-155` throws 400 when `resolve(path) !== path`), and the fork encodes S3 objects
as **relative keys** by construction (`storage-backend.provider.ts:9-13`;
`media.service.ts:82-96,103-111` writes the relative key into `asset_file.path`).

Every other fork file-serving surface routes through `BaseService.serveFromBackend` — 7 sites
(`person.service.ts:588`, `shared-space.service.ts:1639`, `user.service.ts:171`,
`asset-media.service.ts:194,245,259`). `asset-file.service.ts` is absent from that list.

Latent today: the only caller is `packages/sdk`'s `downloadAssetFile`; no web/mobile/e2e code calls
it. `asset-file.service.ts` has **no spec at any layer**. Disk installs unaffected, and CI has no S3
backend, so nothing there can see it.

**Fix.** `return this.serveFromBackend(file.path, mimeTypes.lookup(file.path), CacheControl.PrivateWithCache, fileName)`
— the shape `AssetMediaService.viewThumbnail` already uses.

---

## 30–32. Three user-visible rebase regressions on fork-only surfaces

**30 — The success toast renders a raw ICU plural string. CONFIRMED. Mobile.**
`collection_picker.widget.dart:126` was rewritten from the fork's `.t(...)` helper to
easy_localization's `.tr(namedArgs:)`. They are **not** equivalent for ICU: the helper ran
`MessageFormat(translated).format(args)`; `.tr` does `res.replaceAll(RegExp('{count}'), value)`,
which never matches inside `{count, plural, one {…} other {…}}` — so there is no plural selection
_and no substitution_. Both keys are ICU plurals (`i18n/en.json:54`, `:3069`). Any member picking a
**Space** or **space album** as the target sees literally:
`Added {count, plural, one {# asset} other {# assets}} to space`. The plain-album branch is fine.
All 115 ICU keys were swept against every `.tr(` site in `mobile/lib` + `mobile/test`: **one hit,
this one.** Fix: route through the generated accessor as `space_album_detail.page.dart` does.

**31 — Space bottom sheets render menu rows in the action row, and Share's long-press is dead. CONFIRMED. Mobile.**
`space_bottom_sheet.widget.dart:58,59,61` and `space_album_bottom_sheet.widget.dart:75,76,77` wrap
AssetDebug/Share/Download in `ActionMenuItem` — a left-aligned vertical-menu row
(`menu_item.dart:88-98`) meant for a kebab menu — while Favorite/ShareLink/RemoveFromSpace stay
`ActionColumnButton` tiles, all inside `BaseBottomSheet`'s horizontal `Row`
(`base_bottom_sheet.widget.dart:95`). Every other bottom sheet in the repo uses `ActionColumnButton`
exclusively; `ActionMenuItem` otherwise appears only in the asset-viewer kebab menu. **Functional
half:** `ActionMenuItem` is the one `ActionWidget` subclass that never wires `onSecondaryAction`
(`action.widget.dart:69-70`), and `ShareAction` is the only action defining one
(`share.action.dart:35`, the share-quality prompt) — so an affordance that worked on `origin/main`
via `ShareActionButton` is now gone. The fork's own test asserts the **column** form for ShareLink
(`space_bottom_sheet_share_link_test.dart:68`); the three menu entries are unasserted.

**32 — "Open in app" banner dead on every memory URL. CONFIRMED. Web.**
Upstream `immich-28675` moved the memory viewer from `/memory?id=` to `/memories/<id>`. The fork
adopted the move (`route.ts:116-119`), but the **fork-only** deep-link table at
`utils/open-in-app.ts:3-14` still matches `^/memory/(UUID)$` and `^/memory$`. Upstream has never seen
that file, so zero conflicts. `pathToDeepLink` now returns `null` for every real memory path →
`isEligible` false → the globally-mounted banner renders nothing on mobile web. Its spec passes 39/39
because it pins the **retired** paths; the e2e spec only navigates to `/photos/*`.
**Note:** the mobile half is also incomplete — `deep_link.service.dart:97` handles only
`path == "/memory"` and discards `?id=`, so emitting the id needs a mobile change too.

---

## 33–39. Gates that do not cover what they appear to

**33 — Migration ORDER append-only check is vacuous on `workflow_dispatch`. CONFIRMED. Rebase regression, this cycle.**
`migration-order.yml:25-26` resolves `BASE_SHA` from `github.event.before`, which exists only in a
**push** payload. On dispatch it is empty → `actions/checkout` with `ref: ''` falls back to the
triggering ref → `base/` is a copy of the branch itself → `[ -f "${BASELINE}" ]` is true, the
degradation `::notice` never prints, and `verify-order --append-only-from <a copy of the file being
verified>` passes trivially. **Dispatch is the only mode the rolling branch can use** while it sits
off `main`. Whichever way the checkout fallback resolves, the outcome is "no append-only
enforcement". Fix: resolve `BASE_SHA` explicitly (e.g. `git rev-parse origin/main`), or skip the
append-only step with a visible notice.

**34 — `upstream-preflight`'s path filter omits 6 of the 8 paths its specs guard. CONFIRMED. Pre-existing.**
`test.yml:58-64` gates the job on `tools/upstream-preflight/**`, `test.yml`, `ownership.yml`, two docs
files and `Makefile`. The specs actually read `web/src`, `mobile/lib`,
`server/bin/sync-gallery-migrations.mjs`, both migration dirs, `CLAUDE.md`,
`branding/scripts/gallery-branding-check.sh`, `machine-learning/scripts/gallery-ml-smoke.sh`. So a
PR that only deletes the `compatibilityAliases` entry, or only reverts the branded-spinner files,
runs with that job **skipped** — and a skipped job renders identically to a passing one. Those are
exactly the two traps whose only detector is this job. Forced on for dispatched runs, so the rolling
branch is covered; **the gap is PR-only.**

**35 — 63 files carry branded output committed to source. CONFIRMED. Pre-existing.**
`git grep -ln 'Noodle Gallery'` over `server web mobile i18n docker packages open-api` → **63 files**,
with no guard anywhere. Confirmed branded-in-source with a matching now-dead rewrite rule:
`docker/docker-compose.yml:15,38`, `docusaurus.config.js:8,10`, `build.gradle:40`,
`AndroidManifest.xml`, `Appfile`/`Fastfile`. Directly against CLAUDE.md's "do not commit branded
output". **`Noodle Gallery` is the leak signal — plain `Gallery` is a false positive** (legitimate
fork identifiers like `gallery-map.controller.ts`, `migrations-gallery/*`). Home for a guard:
`tools/upstream-preflight/src/repo-hygiene.spec.ts`.

**36 — 16 branding rewrite rules match nothing. CONFIRMED. Pre-existing.**
All ~87 rules enumerated against live targets: 16 currently match nothing, two of which **never**
worked — `namespace "app.alextran.immich"` (rule uses double quotes, `build.gradle:78` uses single;
so Gallery's Android `namespace` is still `app.alextran.immich`) and the Fastfile team/identity
anchors (`2F67MQ8R79` / `Hau Tran`, present in neither upstream nor fork). `apply-branding.sh` guards
34 file operations with `if [[ -f ]]` and silently skips; `verify-branding.sh` hard-fails on a
missing file in only 4 places. `branding-targets.spec.ts:34-60` checks 5 paths with `existsSync` only
and **has no concept of an anchor string**. Fix: assert every `sed` anchor matches ≥1 line in its
target, allow-listing documented fallbacks.

**37 — 3 brand source assets missing → 17 copy destinations silently no-op. CONFIRMED. Pre-existing.**
`branding/assets/{splash,notification-icon,app-icon-adaptive-fg}.png` do not exist;
`copy_if_exists` (`apply-branding.sh:521-530`) skips silently. Dead destinations: 11 splash files, 5
`notification_icon.png`, 1 adaptive-icon foreground. They ship branded today **only because branded
PNGs are committed to source** — so a rebase resolving any of them "theirs" reverts them to Immich
art with no source asset left to restore from. `verify-mobile-assets.sh` covers only the 11
`android12splash.png` and the 34 iOS AppIcon sizes.

**38 — `make ci-invariants-check` is run by no workflow. CONFIRMED. Pre-existing.**
Only `test`/`check`/`format` are wired (`test.yml:99-105`). The fork's own invariant audits fire only
when a human types the command. Worse, `readInvariantSourceFiles` (`ci-invariants.ts:69-82`) silently
returns `[]` for a path that no longer exists — so a relocated file makes its invariant **pass with
zero files checked**. Same class as Part 1 #16, different mechanism.

**39 — S3 is gated on no PR, and the S3 integration spec never runs. CONFIRMED. Pre-existing.**
Both S3 workflows trigger on `schedule` + `workflow_dispatch` only — no `pull_request`, no `push` —
and `storage-migration-e2e.yml`'s dispatch input defaults to `branch: main`. Separately,
`s3-storage.backend.integration.spec.ts:25` is `describe.skipIf(!canRunDocker)` gated on
`IMMICH_TEST_DOCKER === 'true'`, a variable set in **exactly two places in the repo**: the spec
itself and a design doc. No workflow, Makefile target or package script sets it. Its ~10 MinIO
round-trip cases contribute **zero** coverage anywhere. Consequence: "10/10 green" says nothing about
S3 unless someone dispatches manually.

---

## 40–45. Lower

- **40 — A failing sync batch wedges all sync permanently.** 54 catch-and-rethrow sites in
  `sync_stream.repository.dart`, zero swallows. `sync_stream.service.dart:197-206` correctly skips
  the ack but unwinds to `Future.error`, killing the pass — and because the ack was withheld, the
  poison batch is re-delivered on every subsequent pass. `background_sync.dart:199` reports success.
  Compounds with #24 and with the two hard-FK join-table handlers (`updateMemoryAssetsV1`,
  `updateAlbumToAssetsV1`) that use `onConflict: DoNothing()` — which covers PK conflicts but **not**
  FK violations — and whose protective `SYNC_TYPES_ORDER` positions are unpinned.
- **41 — The Flutter pin doc is wrong and was edited to a wrong value this cycle.** `AGENTS.md:171`
  (symlinked as `CLAUDE.md`) says 3.44.9 "corroborated by `mobile/pubspec.yaml`"; the real pin is
  **3.47.1** in both `pubspec.yaml:9` and `mise.toml:5`, and the quoted TOML syntax is outdated too.
  3.47.1 arrived from upstream already at the new base, while branch-only commit `1f9e818154e` edited
  that line 3.44.8→3.44.9 independently. The line explicitly invites trust and warns "it has gone
  stale before", which is now self-defeating.
- **42 — Branded-spinner guard is 2 files short.** `branded-spinner.spec.ts:26-52` lists 25 paths;
  27 `.svelte` files import the fork-local spinner. `SpaceLinkAlbumModal.svelte` and
  `SpaceLinkLibraryModal.svelte` are unguarded. The guard is a hardcoded list and drifts as the swap
  set grows — and it is the guard that _fired_ during this cycle to catch the `memories/+page.svelte`
  revert.
- **43 — `pnpm test:cov` crashes before running a single test.** `server/package.json:159` pins
  `@vitest/coverage-v8: ^4.0.0` against `vitest: ^3.0.0` at `:177`; the v8 provider imports
  `BaseCoverageProvider` from `vitest/node`, which vitest 3.2.7 does not export. Byte-identical
  upstream, no CI job uses it — so it blocks nothing, but **nobody can measure line coverage on this
  fork**, which is why every coverage finding in this document rests on reading code rather than a
  report.
- **44 — Websocket handlers swallow every error.** Four handlers (`sync_stream.service.dart:432, 475,
518, 561`) end in a blanket `catch { _logger.severe }` with no rethrow, unlike every stream handler.
  Concrete asymmetry: V1 guards `payload['edit'] != null && is List` (`:543`); V2 does an unguarded
  cast (`:583`) — so a null `edit` throws, the swallow at `:594` fires, and the asset update at
  `:588` never runs. Repaired by the next full sync, but invisible.
- **45 — `setAcks` picks the last ack per type rather than the greatest**
  (`sync.service.ts:160-161`, TODO in place); a client batching acks out of order rewinds its cursor.
  Existing tests cover different-type acks only.

---

## B2. Coverage gaps from Waves 1–2

Ranked within each area. These are gaps, not defects — except where a gap's write-up above already
established a live bug.

### Highest

- **Space `PATCH /:id/members/:userId/metadata-contribution` has zero role coverage** while looking
  covered. `grep -rn metadata-contribution e2e/src` → **zero hits**, and the one unit "denial"
  (`shared-space.service.spec.ts:2229`) throws at a payload check _before_ `requireRole(Owner)` at
  `:567` ever runs. A dropped or inverted gate lets any space Editor or Viewer flip another member's
  `sharePersonMetadata` — a privacy write on someone else's setting.
- **No falsifiable negative for the `AssetUpdate` space-editor arm.** Widening it from
  `checkSpaceEditAccess` to `checkSpaceAccess` — a one-word edit — would give every space **Viewer**
  write access to every other member's assets, and the only negative test is inert (C2-1 below).
- **Non-member denial missing for four space-scoped read routes:**
  `GET /timeline/bucket-covers?spaceId`, `POST /search/statistics {spaceId}`,
  `GET /search/suggestions/filters?spaceId`, `POST /search/smart/facets {spaceId}`. All four exercise
  only the allow path. Sibling routes (`/search/random`, `/search/large-assets`,
  `/search/suggestions`) _do_ have the denial, so the omission is arbitrary. A dropped gate leaks
  asset counts and full city/country/camera/tag facet values of a private space to any authenticated
  user who guesses the id.
- **`GET /memories` has zero server e2e coverage.** No `e2e/src/specs/server/api/memory.e2e-spec.ts`
  exists. The fork adds a rule engine, a per-user type gate, `hideAt`/`isUpcoming` three-state
  semantics and a space-widened accessible-search builder on top of upstream memories — and not one
  is exercised over HTTP. Minimum: `for=2026-01-05` → 200 and `for=…T00:00:00.000Z` → 400 (the
  contract mobile hand-rolls around), pagination, and that a disabled type is absent from `/memories`
  but still counted by `/memories/statistics`.
- **Immich→Gallery migration produces an unasserted schema** (Part 1 C2). W0-D did the comparison by
  hand this cycle and it passed; this is about making it permanent.

### High

- **Web memories pagination never terminates** once the fork's post-`LIMIT` filters drop anything.
  `memory-manager.svelte.ts:352` compares the **post-filter** list length against the **pre-filter**
  `statisticsAccessible` total. Any user who disables one memory type, or can see a space-shared
  memory whose assets they may not view, makes `hasNextPage` permanently true → infinite re-request
  on scroll. Worse, `applyPreferences()` (`:87-95`) rebuilds `#filters` without `size`, and the
  server ignores `page` when `size` is absent (`memory.repository.ts:197`), so **each** request
  refetches the entire memory table. `git diff upstream/main..HEAD` on that file is **empty** — the
  paginator is upstream's; the fork's two post-LIMIT filters are what break it. Mobile hit and fixed
  exactly this with 8 tests; web has **no spec file at all**.
- **`handlePetDetection` has no idempotency guard and no test for a retried asset.**
  `pet-detection.service.ts:74-112` inserts unconditionally with no delete-stale step (unlike
  `handleDetectFaces`'s `refreshFaces`), and `upsertJobStatus({petsDetectedAt})` runs only after the
  loop — so a mid-loop failure → `JobStatus.Failed` → BullMQ retry re-inserts every already-created
  face. All 15 existing tests are single-invocation.
- **`streamUnclassifiedAssets` has no visibility or trash filter.**
  `classification.repository.ts:95-103` filters on `classifiedAt IS NULL` alone. A trashed asset can
  be matched by a `tag_and_archive` category and archived, so restoring it from the trash lands it in
  Archive; Locked-folder assets get `Auto/*` tags. Also burns the queue over trashed assets.
- **The revert-validation database is completely empty.** The workflow boots/pings/stops and never
  creates a user, uploads an asset, or inserts a row (`gallery_rows` counts _migration_ rows). Every
  data-touching statement runs on 0 rows — including `ALTER TABLE "asset_face" ADD CONSTRAINT …
REFERENCES "person"("id")` (`sql:499`) after a join-`UPDATE` that only repoints matching rows, and
  four `UPDATE …; SET NOT NULL` pairs.
- **The pet detector's preprocessing contract is asserted nowhere.** All 6 `TestPetDetection` tests
  patch `PetDetector.load` and hand-assign `session`/`_input_name`, so **the entire loading half of
  the class is replaced by the harness**; `_preprocess` is never called with an assertion.
  `test_basic_detection` asserts only that the bounding box has the right four keys and that they are
  ints — **no numeric assertion on any coordinate**, on a non-square 600×800 fixture, so swapping
  `scale_x`/`scale_y` or inverting the cxcywh→xyxy conversion stays green. _(Unverified, flagged not
  claimed: `_predict` feeds BGR into `_preprocess` with no channel swap and uses a squashing
  `cv2.resize` rather than letterbox padding; `conftest.py:21-25` documents the BGR choice as
  deliberate.)_

### Medium

- 16 of ~24 upstream sync dispatch arms have no mobile test (`AssetEditV1`, `AssetMetadataV1`,
  `AssetOcrV1`, the seven `PartnerAsset*`, `Album*`, `Stack*`, `AuthUserV1`, `UserMetadata*`).
- 13 mobile delete handlers have zero repo tests; `deleteUsersV1` is the worst, since `memory.ownerId`
  cascades from `UserEntity`.
- No mobile test that `_kResponseMap` covers every `SyncEntityType` — the file's own comment
  describes this exact bug having shipped once.
- No e2e for the five fork-only space-album sync streams; three have medium specs that call the repo
  directly and never ack.
- Web search-V3 dormancy has **no automated importer guard** — "no live importer" is enforced by a
  code comment only, and that tendril already bit once in batch 124.
- The second gate on `PUT/DELETE /:id/libraries` (admin **and** editor) is never exercised at HTTP
  level; the file's own comment asserts the behaviour in prose with no test behind it.
- `POST /:id/assets/linked-albums` has zero unit and zero e2e coverage.
- Controller-level `@Authenticated({permission})` assertions exist for the people routes only — the
  25 non-people space routes have no API-key scope coverage.
- `handleDeleteFiles`'s S3 branch is never executed by a unit test (all six pass absolute paths), and
  it catches every error into `logger.warn` while returning `JobStatus.Success` — so a transient S3
  outage orphans objects permanently with no retry and no failed-job record.
- `season_recap` and `favorites_throwback` have no real-DB generation test (9 of 11 rule types do).
- Classification config: no test for the rescan dialog on category **removal**, and none for the
  orphaned `Auto/<name>` tag rows.
- None of the non-SQL revert procedure is exercised — no compose file, `.env`, `docker cp`, the
  release-attached SQL asset, or any ML container.
- Docs omit three things the revert script does: deleting the `gallery-core` plugin row and every
  workflow step wired to it (**zero mention in the guide**), dropping face-repair state, and dropping
  `shared_link.spaceId` / `asset_job_status.classifiedAt`.
- `handleSharedSpaceAlbumGrantReconcile` is the only non-people method of 34 in
  `shared-space.service.ts` with zero test reference.

---

## C2. Cannot-fail tests found in Waves 1–2

**Roughly 41 more on top of Part 1's 14.** The ones that matter most:

| #     | Where                                       | Why it stays green                                                                                                                                                                                                                                                                                                                                                                                      |
| ----- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C2-1  | `server/src/utils/access.spec.ts:321-336`   | Titled "AssetUpdate — space should NOT grant". Every accessor in the mock defaults to `new Set()` and the test primes **nothing**, so `toEqual(new Set())` is true for any implementation. Worse, **the title contradicts shipped code** — `access.ts:159-163` explicitly unions in `checkSpaceEditAccess`. The only negative test on the space-editor escalation surface is both inert and misleading. |
| C2-2  | `branding/scripts/verify-branding.sh:52-56` | Absence-only: fails only if `Immich` is still present. The catch-all `s/Immich/…/g` removes every occurrence — so the check passes **because** finding #22 happened.                                                                                                                                                                                                                                    |
| C2-3  | `shared-space.service.spec.ts:2229`         | "reject owner attempts to enable" reads as the route's role gate; the throw comes from a payload check at `:562-563`, **before** `requireRole` at `:567`. A validation test wearing an RBAC test's name.                                                                                                                                                                                                |
| C2-4  | `smart-search-results.spec.ts:222`          | The test body contains **no `expect` at all**. Vitest does not fail on zero assertions.                                                                                                                                                                                                                                                                                                                 |
| C2-5  | `orphaned-selections.spec.ts:294, 332`      | "auto-clear camera model / city" — neither test asserts clearing, and no `onFiltersChange` is passed to `render()`, so **there is no channel through which a clear could be observed**. Sole coverage of auto-clear.                                                                                                                                                                                    |
| C2-6  | `orphaned-selections.spec.ts:210`           | "shows section content when items exist after re-fetch" — its only assertion is `toContain('(0)')`, i.e. it asserts the section is **empty**, the opposite of its name. Byte-duplicate of `:182`.                                                                                                                                                                                                       |
| C2-7  | `spaces-controls.spec.ts:26-126`            | 10 sorting tests against a copy of `sortSpaces` **re-declared inside the spec**. The real one is a component-local `const`, never exported. Inverting the component's comparator leaves all 10 green.                                                                                                                                                                                                   |
| C2-8  | `sync_stream_service_test.dart:428-434`     | "handles memory sync failure gracefully" asserts only that _some_ `Exception` escapes — it cannot distinguish "ack correctly withheld" from "ack fired anyway", and never checks the batch queued behind it.                                                                                                                                                                                            |
| C2-9  | `machine-learning/test_main.py:1169`        | Pet bounding box: asserts only key names and `isinstance(int)`. No numeric assertion, on a non-square fixture.                                                                                                                                                                                                                                                                                          |
| C2-10 | `memory.service.spec.ts:1679`               | The only real-DB exercise of retention is `resolves.not.toThrow()` on an **empty** database.                                                                                                                                                                                                                                                                                                            |
| C2-11 | `memory.service.spec.ts:950`                | The `on_this_day_place` end-to-end read filters by `MemoryType.Rule`, so the plain `OnThisDay` card is **excluded from the assertion by construction** — this is the test that should have caught the duplicate-card bug.                                                                                                                                                                               |
| C2-12 | `classification.e2e-spec.ts:96`             | Asserts `204` + `waitForQueueFinish`, nothing about tags or `classifiedAt`. Deleting the entire body of `handleClassify` keeps it green.                                                                                                                                                                                                                                                                |
| C2-13 | `global-search-manager.svelte.spec.ts:2647` | Both assertions read **field initializers**; the test never writes them before `open()`. Deleting all three reset paths passes.                                                                                                                                                                                                                                                                         |
| C2-14 | ~12 zero-producer absence assertions        | test-ids and i18n keys with **zero producers repo-wide** (`more-chip`, `members-activity`, `hero-*`, `sidebar-space-dot-*`, `date-group-header-0`, `spaces_show_people`…). The query returns null under every implementation.                                                                                                                                                                           |

Plus: `global-search.spec.ts:1619, 237` query the RTL container for a `Modal` that portals to
`document.body`; `cascade-fix.spec.ts:75, 96` have no assertion after the click at all;
`person-row.spec.ts:13` / `person-preview.spec.ts:31` assert an i18n **key** rather than the count
`42` it interpolates; `space-album-detail-page.spec.ts:373-378` overrides a field
(`showInTimeline`) that does not exist on `AlbumResponseDto`.

**Cleared, do not re-chase:** the `role='img'` trap does not apply (all four image tests use
`container.querySelector('img')` with positive controls); no vacuous `<select>`/`<option>` under
`filter-panel/`; all 79 test-ids emitted by `filter-panel/**.svelte` diffed against the 170
referenced — `more-chip` is the only orphan; `mobile/test/**` carries explicit anti-vacuity comments
and hand-rolls override lists omitting the provider under test — **no unfalsifiable mobile sync test
was found**.

---

## F2. Verified clean in Waves 1–2 — do not re-review

- **Server interdiff.** File sets reconciled (597 old-delta vs 605 new-delta, all 8 differences
  explained). A line-level loss detector over all 215 modified files produced **738 hits, all
  triaged** (~690 are the re-key; the rest are upstream renames the fork correctly followed).
  `BaseService.create`'s positional list: **exact 1:1, zero divergence**. `SYNC_TYPES_ORDER` == 41
  `SyncRequestType` members. All four fork batching loops retain their tail flush after upstream's
  batching change. The `immich-30881` config port drops **no** fork key. The one `main` commit not on
  the branch (tag-upsert deadlock fix) is correctly obsoleted by upstream's CTE rewrite.
- **Generated artifacts.** Every `@Controller` route parsed and matched: **0 spec paths with no
  controller**; 370 source routes vs 361 spec operations, residual 9 fully explained (7 unmounted
  cluster-group + 2 `@ApiExcludeEndpoint`). 361/361 operations exported by the SDK, **0** verb or
  path mismatches. 61 spec enums vs 92 source enums: **0** real drift. All 7 route-addressable uuid
  v7 tables correctly paired with their validators. Lockfile `version: link:` = **11** at HEAD, at
  the pre-batch tip, and on `origin/main`; `file:packages/` = **0** at all four refs. **Zero fork
  tables dropped.** **Zero breaking spec changes vs `origin/main`** — 0 operations removed, 0 newly
  required request properties, 0 removed required response properties.
- **Dart client.** Correctly uncommitted everywhere (`git ls-files mobile/openapi` = 0 at HEAD and at
  `093f5c070ad`); generated at build time into the gitignored `mobile/generated/openapi/`. All 7
  template/patch files present including the fork-only array-nullability patch. CLAUDE.md is accurate
  on this branch.
- **Mobile Drift relocation.** All 8 fork tables + `library.dart` byte-identical modulo imports; all
  registered in `@DriftDatabase.tables`; `schemaVersion 36`; `drift_schema_v36.json` cross-checked
  1:1 against the annotation **and all 9 fork `@TableIndex.sql` indexes**. `merged_asset.drift`
  keeps every fork clause. Zero dangling `package:immich_mobile/` imports. Shape I empty in **both**
  directions (24 fork-deleted paths ∩ HEAD = ∅; 59 upstream-added files, 0 missing).
- **freezed and codegen.** Upstream freezed-ified 66 mobile models this cycle; every fork
  `copyWith()..field = x` cascade correctly converted, no fork site passes a nullable expecting
  "keep". 21 newly-`Optional<>` DTO fields, **none referenced in `mobile/lib`**; zero `.value` on any
  Optional field in fork code.
- **i18n.** Fork-only keys 774 → 770, the 4-key delta fully accounted for with zero remaining
  references. **Nine maintained locales: zero translation losses** (767/770 on both refs). Exactly
  one fork key's English changed, and all nine locales were rewritten in the same delta. Zero
  code-referenced keys missing — with **all 17 interpolated call sites enumerated first** and every
  constructed key resolved. Zero `\uXXXX` escapes; the ~80 translator-owned locales are untouched
  this cycle.
- **Branding (the parts that work).** 72 `sed` rules parsed and each anchor grepped against its
  resolved target; the two dead `Info.plist` BGTask rules are correctly redundant. No branded output
  leaked _in_ this cycle (counts unchanged origin/main→HEAD). `en.json` Immich-leak audit: **0** keys
  needing an override. `branded-spinner` swap set 19–27 files depending on scope, 0 violations —
  including the file that reverted last cycle. `branding-tests` is deliberately un-path-filtered and
  runs the full overlay on every PR — a genuinely mature gate.
- **Web.** SDK operations 348 → 361, **zero removed**. `@immich/ui` 0.83→0.85 diffed tarball-to-
  tarball: the removed `ActionItem.extraText` and the Fuse.js swap do not reach fork code, and
  `Button.svelte` is byte-identical so `ghost` resolution is unaffected. `jsonOnly` (this cycle's
  Shape H) swept across all 78 void/nullable handlers. One suspected live bug **refuted** —
  `face-cleanup/[personId]` reading `p.personId` is correct because the service aliases at the DTO
  boundary. The dormant `search-bar/` set verified byte-identical to upstream with zero outside
  importers.
- **Spaces RBAC.** Part 1's "denied for an unrelated reason" flaw is **not** present in the space
  matrices — `spaces-selection-actions.e2e-spec.ts` uses `spaceAssetId` 18× and `ownerAssetId` 0×.
  Owner-leaves / last-owner-leaves / co-owner-removes-creator all guarded and tested. Member removal
  is transactional via three `@AfterDeleteTrigger`s, not an async window. Archive/visibility writes
  correctly matrixed with positive **and** negative controls. `computePhysicalUsage`'s S3 arm and the
  `S3StorageBackend` unit suite (limiter release, range pass-through, 416, `deletePrefix` pagination)
  are genuinely strong.
- **Filters/search.** The person-token value space is pinned at three layers with falsifiable tests
  including a real-server e2e. Section ledger, filter-section parity, locked-asset leakage and
  contextual filters are all well covered. All 14 fork `SyncRequestType` / 43 `SyncEntityType`
  members have a payload-pinning medium spec and a delete/audit spec.
- **ML gates, run for real:** `uv sync --locked --extra cpu` PASS, `ruff check immich_ml` PASS,
  `mypy immich_ml` PASS (31 files), `pytest` **116 passed / 3 skipped**.

---

## G2. Still open after Waves 1–2

1. **Wave 3 (adversarial refutation) was cancelled.** Nothing in this document has been
   independently refuted. W2-SURFACES self-verified 10 of its own findings and W2-SPACES 5 of 18;
   the rest are single-agent.
2. **`#1029` is still unreplayed**, and Part 2 gives it a concrete consequence: the duplicate
   "On this day in <city>" / "N years ago" card pair is **live on this branch**, up to 3 duplicate
   pairs per day.
3. No browser reproduction, no dev stack, no medium suite, no e2e run, no mutation testing anywhere
   in either wave.

---

# PART 2b — W1-INFRA (ML, e2e, CI, Docker, Makefile)

The last Wave 1 agent. **Waves 1–2 are now 9/9 complete.**

## ★ Read this before quoting "10/10 CI green"

**The tip is not where the rolling branch name points.** `ab50d5ab716` is pushed as
`refs/heads/rebase/upstream-batch-170`. `origin/rebase/upstream-rolling-v3.1.1` is a **divergent**
`58a1ca590ec` (`git rev-list --left-right --count` → `1399 1258`). Querying CI by the rolling branch
name returns **2026-08-19** results — the reused-branch trap:

```
$ gh run list --branch rebase/upstream-rolling-v3.1.1
2026-08-19T10:30:54Z  441958a14d0  success  Storage Migration E2E   ← NOT an ancestor of HEAD

$ gh run list --branch rebase/upstream-batch-170
2026-08-26T18:42:44Z  77b4afeca3a  success  Test
2026-08-26T18:11:52Z  80154b8eb93  success  Gallery Build Mobile    ← the real 10/10 set
```

Commits after the 10/10 set: `77b4afeca3a` (migration-order.yml only → finding 54),
`b16ba682f13` and `ab50d5ab716` (docs only). So the greenness claim holds for HEAD's code — but
**always query by head SHA, not by that branch name.**

## Findings

| #   | Finding                                                                                  | Sev     | Confidence | Class                 |
| --- | ---------------------------------------------------------------------------------------- | ------- | ---------- | --------------------- |
| 53  | `e2e/docker-compose.yml` `cache_from` resurrected; probes upstream's GHCR (both 404)     | Medium  | CONFIRMED  | **Rebase regression** |
| 54  | `Migration Order` has never executed anywhere                                            | Medium  | CONFIRMED  | **Rebase regression** |
| 55  | `pnpm … test <file>` resolves through `--passWithNoTests`                                | Low     | CONFIRMED  | Pre-existing fork     |
| 56  | ML `ci-unit` runs `ruff format`, not `--check`                                           | Low     | CONFIRMED  | Pre-existing upstream |
| 57  | `Makefile`'s `renovate` target is a silent no-op; docs cite targets that no longer exist | Low     | CONFIRMED  | Pre-existing upstream |
| 58  | Stale action pins in fork-only jobs                                                      | Trivial | CONFIRMED  | Pre-existing fork     |

### 53. The fork's `cache_from` deletion was dropped — Shape D where the fork's rule IS a deletion

Fork PR #171 (`dec80cb19e9`, _"remove stale upstream cache_from refs in e2e compose"_) deleted the
block; `origin/main` has none. Upstream re-created it this cycle (`47dccf72834` #30874,
`24532c4d821` #30894) and the replay took upstream's version verbatim. **Because the fork's rule is
expressed as a deletion, re-adding produces zero conflict and no gate can see it.**

`e2e/docker-compose.yml:18-21` now carries two `type=registry,ref=ghcr.io/immich-app/immich-server-build-cache:…`
entries. Both probe as **HTTP 404**. Every `docker compose up -d --build` (`test.yml:447`, `:537`,
both storage-migration workflows, every local `mise e2e`) makes two failed registry calls; BuildKit
warns and continues, which is why CI is green.

The latent hazard is the class fork rule #218 exists to prevent — reaching into upstream's registry
namespace. **If upstream ever publishes a cache whose tag hash matches, the fork's e2e server image
silently imports upstream-built layers.** Fix: re-delete lines 18-21. (HEAD also restored the
adjacent `args:` block that `origin/main` dropped; that half is upstream's own e2e build metadata and
is harmless — decide separately.)

### 54. `Migration Order` has never run — anywhere

```
$ gh --repo open-noodle/gallery run list --workflow migration-order.yml
HTTP 404: workflow migration-order.yml not found on the default branch
```

No run on the branch either: the 10/10 set is on `80154b8eb93`, which **predates** `77b4afeca3a`, the
second of the two commits that created and adapted this workflow. So the gate is entirely unproven,
and its first real execution will be the PR or push-to-`main` after this branch lands — where a
plumbing error reddens every PR.

This **corroborates finding #33 independently** and adds the "never executed" half. The underlying
commands are sound; W1-INFRA proved them **red as well as green**:

```
sql-tools migrations verify-order                                   → consistent (96)     exit 0
sql-tools --source-folder …/migrations-gallery … verify-order       → consistent (61)     exit 0
(doctored copy, one ORDER line deleted)                             → Error: … missing    exit 1
```

**Cheapest close: dispatch it once on the branch.**

### 55–58 (brief)

- **55** — `test.yml:733` runs `pnpm --filter @gallery/upstream-preflight test dart-nullable-array-items.spec.ts`,
  and that package's `test` script is `vitest --run --passWithNoTests`. Rename or move the spec and
  the filter matches nothing, vitest exits 0, the step goes green. Same "a check that cannot fail is
  not a check" shape as #3. It does run for real today (2/2, guard genuinely exercised). Fix: drop
  `--passWithNoTests` for this invocation.
- **56** — `machine-learning/mise.toml:14-15` defines `format` as `uv run ruff format immich_ml` (no
  `--check`), invoked from `ci-unit`, with nothing inspecting the tree afterwards — an ML formatting
  regression is rewritten in the runner and passes. No live drift (`--check` → `31 files already
formatted`).
- **57** — Upstream `bcf6e66e26d` deleted both makefiles; `mobile/makefile` is correctly gone and
  `Makefile` is **deliberately kept** (it hosts every fork gate). Two inherited problems ride along:
  `Makefile:159-160` indents the `renovate` recipe with **two spaces instead of a tab**, so make
  parses the body as a variable assignment and `make -n renovate` says "Nothing to be done"; and the
  file now carries upstream's deprecation stubs, so `make dev`, `make e2e`, `make open-api`,
  `make sql`, `make clean` only print "This command has been removed" — while `CLAUDE.md`/`AGENTS.md`
  still document them, plus `make build-server` / `build-web` / `lint-server` / `check-server` /
  `lint-all`, which **do not exist in the file at all**.
- **58** — `test.yml:80` and `:280` pin `actions/checkout` at v7.0.0 / v6.0.3 while all 15
  upstream-owned steps in the same file are on v7.0.1; four fork mobile workflows pin
  `use-mise-action` v3.1.0 vs v3.2.1 elsewhere.

## Gate results — all PASS

| Gate                                                                         | Result                                                                                                                              |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `uv sync --locked --extra cpu`                                               | PASS — 119 packages, no lock disagreement                                                                                           |
| `ruff check immich_ml`                                                       | PASS                                                                                                                                |
| `ruff format --check immich_ml`                                              | PASS — 31 files already formatted                                                                                                   |
| `mypy --strict immich_ml/`                                                   | PASS — 31 source files (note: **`--strict`**, unlike W2-ML's run)                                                                   |
| `pytest -q`                                                                  | PASS — 116 passed, 3 skipped (skips deploy the app + load models, by design)                                                        |
| `make ci-invariants-check`                                                   | PASS — `no-push-o-matic`, `gallery-release-image-names`, `gallery-docs-deploy-disabled-upstream`, `person-join-not-viewer-filtered` |
| `pnpm --filter @gallery/upstream-preflight test`                             | PASS — 23 files, 247 tests                                                                                                          |
| Migration ORDER, both folders + red-proof                                    | PASS / PASS / fails as designed                                                                                                     |
| 37 workflows YAML-parsed, dangling `needs:`                                  | PASS — 37 parsed, 0 dangling                                                                                                        |
| `docker.yml` Shape-D re-derivation                                           | PASS — `mirror` job, `DOCKERHUB_NAMESPACE`, both `needs:` removed; zero rocm/dockerhub matches                                      |
| PUSH_O_MATIC sweep                                                           | PASS — only `merge-translations.yml`, an explicit manifest exception                                                                |
| Upstream-registry sweep across `.github`, `docker/`, `e2e/`, all Dockerfiles | **1 hit** → finding 53                                                                                                              |
| Shape I resurrection detector, repo-wide                                     | 11 hits, **1 real** (`packages/scripts`, already filed); the 10 `search-bar/*` are deliberate dormancy                              |
| Lockfile health                                                              | PASS — `link:` 11 both refs, `file:packages/` = 0                                                                                   |
| e2e spec-file set                                                            | PASS — **0 fork-only specs lost**; the 3 removals track upstream deletions exactly                                                  |
| e2e test-count delta                                                         | PASS — aggregate fork delta **+1435 on both sides, 0 files shrank**                                                                 |
| e2e assertion delta                                                          | 1 shrink (`memory-index.e2e-spec.ts` 7→3), deliberate and documented                                                                |
| e2e skip markers                                                             | PASS — 14 on both refs, same sites                                                                                                  |
| Branding wiring                                                              | PASS — runs via `./.github/actions/apply-branding` in all 3 image-publishing fork workflows                                         |
| Literal silent-no-op detector                                                | 4 hits, all benign documented fallbacks                                                                                             |
| ML upstream-owned files                                                      | PASS — fork ML delta is purely additive (15 files, +798/−14)                                                                        |
| ML Shape-D repairs                                                           | PASS — `decode_cv2`→`decode_pil`/`pil_to_cv2`, `cv_image` fixture restored; the fork's stale OCR test correctly removed             |

## Two corrections to project documentation it turned up

- **`AGENTS.md:247` is stale**: branding does **not** run inside the Dockerfiles. It runs via the
  `./.github/actions/apply-branding` composite action, present in all three image-publishing fork
  workflows.
- **The "branding scripts are not wired into CI" note is stale**: 5 scripts report as absent from
  workflows but all run via the umbrella `gallery-branding-check.sh` at `test.yml:293`.

## Also flagged for a product decision

The fork's memory-history page from #455 was retired in favour of upstream's memories view
(`2f4faaa5118`, `482fdfa4371`). Deliberate and documented in the sync report — but it is a **fork
feature removal**, and someone should confirm it was a product call rather than a convergence
convenience.
