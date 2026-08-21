# Option M Spike — Handoff

**Date:** 2026-08-21
**Branch:** `spike/cluster-groups-m` — THROWAWAY, nothing merges
**Status:** 15 of 50 merge conflicts resolved. Does not compile yet.
**Companion doc:** [`2026-08-21-cluster-groups-consolidation-exploration.md`](./2026-08-21-cluster-groups-consolidation-exploration.md) — read that first for what
cluster groups are and how the options compare.

## Read this first

Nothing has been decided. This spike exists to find out what option M costs, not to adopt it. The
rolling branch is untouched and `rolling-state.json` is unchanged (`upstreamTargetHead` still
`f88fb628ff5`, `integratedForkHead` still `690fd44e12c`). The eight pending upstream commits are
still frozen behind #30739.

## What option M is

**Inert adoption.** Take upstream's schema; do not consolidate the identity models at all.

Verified against `1787148183729-ClusterGroups.ts`: the migration mentions `identityId` **zero** times
and `face_identity` **zero** times. The fork's entire identity layer survives untouched. So:

- Absorb the mechanical changes: `asset_face.personId` → `personGroupId`, and `person.id` → the
  composite primary key `(ownerId, personGroupId)`.
- **Keep `person.identityId`** and its two partial indexes. They survive the migration.
- Leave `face_identity`, `face_identity_face` and `shared_space_person.identityId` exactly as they
  are.
- Never create multi-user cluster groups, so `person_group` stays 1:1 with each person row.
- Never mount the cluster-groups UI.

The two layers answer different questions and do not compete: `person_group` = "which person rows are
the same human within a cluster group"; `face_identity` = "which faces are the same human across
scopes". `face_identity_face` is keyed on `assetFaceId` and never references `person`, which is why
it is unaffected.

Divergence on upstream tables is therefore **exactly what the fork already carries today**
(`person.identityId` + two indexes). M adds none.

## Where everything is

| Thing                | Location                                    | Ref                                                                          |
| -------------------- | ------------------------------------------- | ---------------------------------------------------------------------------- |
| Rolling branch       | `.worktrees/rebase-upstream-rolling-v3.1.1` | `rebase/upstream-rolling-v3.1.1`                                             |
| **M spike**          | `.worktrees/spike-cluster-groups-m`         | `spike/cluster-groups-m` → `972bf5d896c`                                     |
| K spike              | `.worktrees/spike-cluster-groups`           | `spike/cluster-groups-k` — **another agent is working here, do not disturb** |
| Fork tip (pre-merge) | —                                           | `3c662de1ae0`                                                                |
| Merge base           | fork's upstream base                        | `f88fb628ff5`                                                                |
| Upstream target      | `upstream/main`                             | `4c26a7ca761`                                                                |

The M branch was cut from K's stage-2 commit (`e64da31dded`) so both share the registry-union work and
stay directly comparable. It does **not** contain K's link table or merge-propagation changes.

Commits on `spike/cluster-groups-m`:

```
972bf5d896c  resolve utils/database.ts (5 conflicts) - Search V3 invariant intact
10d6d9c30e8  3-way merge 5 heavy files; person.repository.ts conflicts resolved (10/50)
d13de4d1e65  inert adoption - keep person.identityId + face_identity untouched, no link table
```

## Current state

### Conflicts

| File                                           | Conflicts | Status       |
| ---------------------------------------------- | --------: | ------------ |
| `server/src/repositories/person.repository.ts` |        10 | **resolved** |
| `server/src/utils/database.ts`                 |         5 | **resolved** |
| `server/src/services/person.service.ts`        |        25 | remaining    |
| `server/src/repositories/search.repository.ts` |         5 | remaining    |
| `server/src/repositories/asset.repository.ts`  |         5 | remaining    |

### After the conflicts, still to do

- **229 `person.id` call sites** → `person.personGroupId` (or the composite key)
- **Five fork tables** FK `person.id` and need repointing: `shared_space_person`,
  `shared_space_person_face`, `shared_space_person_alias`, `face_person_verdict`,
  `face_repair_decline`
- **~1,500 spec errors** across ~59 fork spec files — mechanical once production compiles
- Web (~820 fork-added person-id lines), mobile, e2e — **entirely untouched**
- No migration written; nothing executed; no tests run

Baseline measurement before conflict resolution started (commit `d13de4d1e65`): **2,241 type errors**
— fork production 212 / 23 files, fork specs 1,476 / 59, upstream production 84 / 31, upstream specs
469 / 33.

## How to pick it up

```bash
cd /Users/pierre/dev/gallery/.worktrees/spike-cluster-groups-m
pnpm install --frozen-lockfile        # ~11s, shared store
cd server && pnpm check               # tsc --noEmit; will show parse errors until conflicts are done
```

### The recipe that made this tractable

Do **not** rebase — a rebase replays 1,224 fork commits through #30739's conflict surface. A merge
reaches the same end state in one pass. For each remaining file, generate a proper 3-way merge:

```bash
BASE=f88fb628ff5; FORK=3c662de1ae0; UP=upstream/main
f=server/src/services/person.service.ts
git show "$FORK:$f" > /tmp/ours; git show "$BASE:$f" > /tmp/base; git show "$UP:$f" > /tmp/theirs
git merge-file -p /tmp/ours /tmp/base /tmp/theirs > "$f"
```

This auto-restores every **non-conflicting** fork addition — most of the re-graft list comes back for
free. Only genuinely overlapping edits conflict. `search.repository.ts` and `asset.repository.ts`
already have their merged output installed; `person.service.ts` does too.

### The resolution pattern

Nearly every conflict resolves as **fork's structure + upstream's schema rename**. The fork's
additions are behavioural (space scoping, RBAC gates, extra counts, transaction params); upstream's
are `personId → personGroupId` and composite keys. So far these compose — no conflict has yet been
found where the two genuinely disagree on intent.

## Gotchas — all four hit for real, all cost time

1. **A 3-way merge can produce a signature/body mismatch with NO conflict marker.** `getRandomFace`
   ended up with the fork's `personId` signature and upstream's `personGroupId` body. After resolving
   each file, grep for parameters that do not match their body.

2. **Read the shared tail before choosing a side.** Twice, the code _after_ a conflict belonged to the
   fork's function, so taking upstream's side would have left a dangling body that does not parse —
   `getNumberOfPeople` (fork replaced upstream's Kysely version with raw SQL) and `hasAnyPerson` (fork
   inserted it where `inAlbums` used to be).

3. **Conditions inside a LEFT JOIN are not equivalent to conditions in WHERE** — moving them silently
   converts it to an INNER JOIN. `getAllWithoutFaces` depends on this; the fork had deliberately moved
   them into the join.

4. **Diff upstream's side against the base before assuming a large conflict is a large change.** The
   460-line `searchAssetBuilder` conflict turned out to be a **one-line** upstream delta
   (`withFacesAndPeople` became curried, taking `{ viewingUserId }`). Resolution was the fork's side
   wholesale plus that single substitution.

   ```bash
   sed -n '<base-range>p' file > /tmp/b; sed -n '<theirs-range>p' file > /tmp/t; diff /tmp/b /tmp/t
   ```

## Invariants to re-check before believing it is done

- **Search V3 coexistence.** Fork call sites must use `searchAssetBuilderLegacy`; upstream's V3
  `searchAssetBuilder` stays present and dormant. Currently intact — Legacy at `database.ts:813` with
  its banner, dormant V3 at `1298`, and `shared-space.repository.ts` imports Legacy.
  ```bash
  grep -rn 'UPSTREAM SEARCH V3' server/src
  ```
- **`person.identityId` still exists** on `person.table.ts` with both partial indexes — this is the
  whole point of M.
- **`face_identity` / `face_identity_face` unmodified** relative to the fork tip:
  ```bash
  git diff 3c662de1ae0 -- server/src/schema/tables/face-identity*.ts   # expect empty
  ```
- **`schema/index.ts` needs BOTH edits per table** — the schema array _and_ the `export interface DB`
  block. Missing the second gives `not assignable to parameter of type 'TableExpression<DB, …>'`.
- **`BaseService` positional repo list** must match the constructor order.

## Suggested order for the next session

1. `person.service.ts` — 25 conflicts, the bulk of the work, and where the fork's face-suggestion,
   pet-detection and space-recognition hooks live. Expect these to be harder than
   `person.repository.ts`.
2. `search.repository.ts` and `asset.repository.ts` — 5 each.
3. Re-run `pnpm check`, then sweep the residual `person.id` sites.
4. Specs last — they follow mechanically once production compiles.

Checkpoint-commit per file so a bad resolution is cheap to unwind.

## What this spike will and will not tell you

It answers: _what does M cost, and does it hold together?_ It will **not** decide whether Gallery
adopts M, K, D or J″ — that is a product decision that also has to weigh rebase friction, query
clarity, and whether to bet on a one-day-old upstream design being final.

Two findings already worth carrying into that decision:

- **M and K cost roughly the same mechanically.** At the same stage, M measured 2,241 errors vs K's
  2,302 — about 3% apart. Both are dominated by the shared sweep (`person.id`, the re-graft list),
  which neither avoids. The choice between them is design risk and reversibility, not effort.
- **M's real advantage is what it does not require**: no new table, no backfill migration, and no
  merge-propagation redesign — the last being the piece flagged as most likely to get expensive
  under K.
