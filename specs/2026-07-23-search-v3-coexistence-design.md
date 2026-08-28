# Search V3 Coexistence — Design

**Date:** 2026-07-23
**Status:** Approved, pending implementation
**Context:** Rolling upstream rebase `rebase/upstream-rolling-v3.0.3`, batch 46 (upstream `#28686`).

## Problem

Upstream `#28686` (_feat(server): new search schemas and query builders_) is the **first slice** of an
unfinished Immich "V3" search rework. It lands directly on the fork's single most-extended surface
(Unified Smart Search, space scoping, `spacePersonIds`, CTE sort, smart-search-on-timeline, dynamic
filter suggestions, CLIP relevance threshold, `getAccessibleTags`).

Concretely, `#28686`:

- **Renames** the shared query builder `searchAssetBuilder(AssetSearchBuilderOptions)` →
  `searchAssetBuilderLegacy` in `server/src/utils/database.ts`, and introduces a **new**
  `searchAssetBuilder(AssetSearchBuilderV3Options)` with a different signature.
- Adds dormant repository methods `searchMetadataV3` / `searchStatisticsV3`, new zod filter schemas
  (`SearchFilter`, `SearchOrder`, `IdFilter`, `StringFilter`, `NumberFilter`, `DateFilter`, …),
  `SearchOrderField` enum, `DEFAULT_SEARCH_ORDER`, and `withSearchOrder`.
- Wires **nothing** to a controller or service — `searchMetadataV3`/`searchStatisticsV3` are never
  called. At runtime, V3 does nothing.
- Is the **current upstream tip** — no upstream commit sits after it yet.

A blind rebase would silently rebind the fork's `searchAssetBuilder(...)` call-sites to the new V3
builder (different signature / behavior) and could drop the fork's owner/space RBAC SQL gate.

## Decision

**Coexist.** Pull `#28686` so the branch stays 0-behind, but treat V3 as **inert scaffolding**:

- The fork's search keeps running end-to-end on the **legacy** query path
  (`searchAssetBuilderLegacy`), with **no behavioral change** to any fork search surface.
- Upstream's V3 code is present, compiles, and is **never called** (dormant).
- A future, separately-scoped effort switches the fork onto V3 once upstream declares V3 complete;
  at that point legacy is deleted.

**Rejected alternative — quarantine `#28686`:** hold it at the boundary and pull nothing past it.
Rejected because the roll is linear: once upstream ships commit #2 (V3 or unrelated), a boundary at
`#28686` makes the fork fall behind on _everything_ after it. Coexistence pays a one-time
reconciliation now and stays current, and because V3 lives in its own code paths, future upstream V3
commits should diverge cleanly from the fork's legacy path rather than re-colliding.

## End-state architecture

Two parallel, non-interacting search stacks in one tree:

| Layer                                                                    | Legacy — fork's live path                                                                                                                                        | V3 — upstream, dormant                                                                                                    |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Query builder (`utils/database.ts`)                                      | `searchAssetBuilderLegacy` — **carries the fork's RBAC / space-scoping gate**                                                                                    | `searchAssetBuilder` (new signature), `withSearchOrder`                                                                   |
| Repository (`search.repository.ts`)                                      | fork methods (space/smart search, filter-suggestions, CLIP threshold, `getAccessibleTags`) + upstream's `searchMetadata`/`searchRandom`/… — **all on `…Legacy`** | `searchMetadataV3` / `searchStatisticsV3` — uncalled                                                                      |
| DTOs (`search.dto.ts`)                                                   | fork's zod DTOs (`withSharedSpaces`, `spaceId`, `spacePersonIds`, …) — the live request shapes                                                                   | V3 filter schemas (`IdFilter`, `StringFilter`, `SearchFilter`, `DEFAULT_SEARCH_ORDER`, …) — referenced only by V3 methods |
| Callers (`search.service.ts`, controllers, `shared-space.repository.ts`) | unchanged — hit the legacy repository methods                                                                                                                    | nothing wires to V3                                                                                                       |

**Load-bearing invariant:** every fork `searchAssetBuilder(` call-site → `searchAssetBuilderLegacy(`,
preserving today's exact behavior and the security-sensitive scoping gate.

## Per-file reconciliation rules

- **`search.dto.ts`** — keep the fork's complete zod DTOs (the live request shapes); layer upstream's
  V3 filter schemas + `DEFAULT_SEARCH_ORDER` / `SearchOrderSchema` alongside as additive, dormant
  definitions. (The fork's `2490e9761ba` "complete zod conversion" replay collides here; resolve so
  both the fork DTOs and the upstream V3 schemas survive.)
- **`search.repository.ts`** — keep fork methods + upstream methods, repoint **all** fork builder
  calls to `…Legacy`; keep upstream's `…V3` methods verbatim (dormant).
- **`utils/database.ts`** — the fork's builder extensions move onto `searchAssetBuilderLegacy`; accept
  upstream's new V3 `searchAssetBuilder`.
- **`shared-space.repository.ts`** — the one fork call → `…Legacy`.
- **`search.repository.sql`** — regenerate from decorators (`mise sql`), never hand-merge.

## Differentiating dormant-upstream from fork

Every dormant V3 region carries a **consistent, greppable banner** so it is unmistakable and the
future switch-over can enumerate all of it in one command:

```ts
// ─── UPSTREAM SEARCH V3 — DORMANT ───────────────────────────────
// Not wired to any controller/service. The fork's live search runs on the
// legacy path (searchAssetBuilderLegacy). Do not call from fork code.
// Switch-over plan: specs/2026-07-23-search-v3-coexistence-design.md
```

Applied to: the V3 filter-schema block + `DEFAULT_SEARCH_ORDER` / `SearchOrderSchema` in
`search.dto.ts`, the `searchMetadataV3` / `searchStatisticsV3` methods, and the new V3
`searchAssetBuilder` / `withSearchOrder` in `utils/database.ts`. The single tag string
`UPSTREAM SEARCH V3 — DORMANT` makes `grep -rn` list every dormant block. Conversely,
`searchAssetBuilderLegacy` gets a one-line `// fork's live search path` note at its definition.

## Execution

1. (Done) Abort the tangled batch-46 rebase → clean batch-45 tree.
2. Commit this spec on the branch.
3. Redo the `#28686` rebase, applying the per-file rules deterministically and adding the dormant
   banners. Resolve each fork-search-commit conflict favouring: fork DTOs/methods survive, on
   `…Legacy`; upstream V3 additions survive, dormant.
4. **Legacy-repoint sweep:** `grep -n 'searchAssetBuilder\b' server/src` → every fork call-site
   becomes `…Legacy`. Only the two definitions and the `…V3` methods keep the bare name.
5. Regenerate `search.repository.sql`.

## Validation gates (all must pass before the batch is "done")

- **`cd server && pnpm check` (tsc)** — the real safety net: catches any fork call-site still passing
  legacy options to the V3 builder, and any missing/renamed DTO field.
- **Grep assertion** — no fork file _calls_ the bare V3 `searchAssetBuilder` (only V3 methods + the
  two definitions reference it).
- **Medium tests** — `search.repository` + `shared-space` suites (behavioural proof the legacy path is
  intact).
- **Search e2e** — `search.e2e-spec` + spaces-search smoke.
- Then the normal full CI dispatch for the batch.

## Switch-over follow-up (NOT built now)

**Trigger:** upstream marks V3 complete / wires V3 to endpoints / begins deleting the legacy builder.

**Mechanical steps at switch-over:**

1. Migrate the fork's repository methods off `searchAssetBuilderLegacy` onto the V3 `searchAssetBuilder`
   - `SearchFilter`/`SearchOrder`, porting the owner/space RBAC gate into the V3 builder.
2. Re-express the fork's request DTOs (`withSharedSpaces`, `spaceId`, `spacePersonIds`, …) against the
   V3 filter schemas.
3. Delete `searchAssetBuilderLegacy` and the fork's legacy methods.
4. Remove the `UPSTREAM SEARCH V3 — DORMANT` banners.
5. Re-validate with the same gates above.

**Tracking:** this spec is the record. The rebase's `rebase-upstream-report` skill carries a note so
future rolls keep the fork on legacy and re-flag any upstream commit that finishes V3 or removes the
legacy builder. No separate GitHub issue (per maintainer).

---

## 2026-08-28 — the trigger fired; decision: pull it, but do not dispatch

**`immich-30179` ("feat(server): new search API") wired V3 to live endpoints.** That is the
switch-over trigger this spec anticipated. Pierre's call: **pull the commit, keep Gallery on the
legacy path, and adopt V3 later once upstream's version has proven itself.**

### What upstream actually shipped

Not a new route. `searchMetadata`, `searchStatistics`, `searchRandom` and `searchSmart` each now
open with:

```ts
if (isNewShapeRequest(dto)) {
  return this.searchMetadataV3(auth, dto); // …StatisticsV3 / RandomV3 / SmartV3
}
```

`isNewShapeRequest` is true when the body carries any of `filter`, `orderBy`, `cursor`
(`NEW_SHAPE_FIELDS`). So V3 is reachable **through the existing endpoints, with no feature flag**.
The flat fields still work and are marked `DEPRECATED_FLAT_FIELD`; upstream tags the legacy
repository methods `TODO(v4): remove`.

### Why we are not adopting it yet

V3's `searchAssetBuilder(kysely, options, scope)` scopes the search entirely through

```ts
const ownershipPredicate = (eb) => eb("asset.ownerId", "=", anyUuid(scope.userIds));
```

plus a locked-visibility check — and on **album-confined** branches it drops that predicate
altogether (`.$if(scopeGlobally, …)`), trusting the service's album access check. It has **no
shared-space arm**, and none of the Archive+Timeline re-gating `searchAssetBuilderLegacy` performs.
That album arm is exactly the one the `security-1` cases in `search.repository.spec.ts` exist for.

Routing to V3 would therefore stand up a **second, live, un-gated search path** beside the gated
one — reachable by any API client sending the new body shape, while Gallery's own web and mobile
clients still send the flat shape and would see none of it.

Note the blast radius is smaller than it first appears: **the FilterPanel does not use the search
API at all.** `FilterState` → `buildPhotosTimelineOptions` / `buildMapTimelineOptions` / the album
and space variants → `TimelineManager` → `getTimeBuckets`, which is `asset.repository.ts`. The
search endpoints back the cmdk palette, the preview components, the legacy search page and the map's
smart search.

### What was built

The four dispatch points **throw** instead of dispatching:

```ts
if (isNewShapeRequest(dto)) {
  throw newShapeUnsupported(); // 400
}
```

**Rejecting rather than falling through is the load-bearing part.** The legacy path ignores `filter`
entirely, so a silent fallthrough would answer a filtered request with a **wider** result set than
the caller asked for. A 400 is honest; a wider answer is a correctness bug.

The shape of the guard deliberately mirrors upstream's dispatch — same `if`, same place, same three
lines — so each future rebase resolves as a one-line swap rather than a structural divergence.

Upstream's V3 service and repository methods, the V3 filter schemas, and `searchAssetBuilder` all
stay present and unreachable, byte-compatible with upstream so its own changes keep auto-merging.
This is the same dormancy policy already applied to the V3 builder (#28686) and the web search UI
(#30279) — carry it, don't delete it.

### Guards (both proved red before being trusted)

1. **`search-v3-not-dispatched` ci-invariant** (`docs/fork/ownership.yml`) — forbids
   `return this.<x>V3(auth, dto);` in `search.service.ts`. Verified: re-adding one dispatch turns it
   red. This is the important one, because a rebase resolving toward upstream would re-enable V3
   with **no conflict and no type error**.
2. **The reworked `new shape routing` tests** — assert all four endpoints reject, that every
   new-shape field (not just `filter`) is rejected, that no V3 repository method is reached, and
   that a flat request still routes to legacy. Verified: re-adding one dispatch fails three of them.

Upstream's own tests for that describe (V3 routing, cursor decoding, shared-link album confinement)
were replaced rather than deleted, so a rebase that restores upstream's dispatch conflicts here
visibly. They come back with the dispatch when we adopt V3.

### The API-honesty trade-off, stated

The DTOs still carry `filter` / `orderBy` / `cursor`, so the OpenAPI spec advertises fields the
server rejects. That is deliberate: removing them would widen the fork's `search.dto.ts` divergence
(already ~+670 lines) and make every future upstream change to those schemas conflict. Carrying them
dormant is what buys the auto-merge, and the 400 names the reason.

### Adopting V3 later — what the work actually is

The mechanical steps above still stand. The real cost is not the call sites, it is that V3 composes
**per-branch** predicates joined by `OR`, while the fork's gate is a flat option set applied once. So
the shared-space arms have to be re-expressed per branch, and the album-confined shortcut has to be
re-gated per branch. Budget it as design work plus re-proving the `security-1` cases, not as a
translation. Deleting this section's guard (the invariant and the tests) belongs in that same change.
