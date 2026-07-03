# Slice 2 — M3: space-scoped search hides other members' archived/locked (per-owner elevation)

**Finding:** M3 · `server/src/services/search.service.ts` shared-space scoping combined with the v3
`undefined`-for-elevated visibility default.
**Depends on:** Slice 1 (H1) — already committed; every search endpoint now passes
`visibility: dto.visibility ?? (auth.session?.hasElevatedPermission ? undefined : 'not-locked')`.

## Problem

Upstream v3 (#29385) removed `searchAssetBuilder`'s implicit `visibility = Timeline` default; each
endpoint now resolves visibility to `undefined` for elevated sessions (see all rows) or `'not-locked'`
for non-elevated. The global visibility filter in `searchAssetBuilder` (`database.ts:648-652`) applies
that resolved value to **every** row, including rows reached only through the fork's shared-space
scoping. So for space-scoped search:

- **Elevated** caller (`undefined` visibility → no filter) sees **other** space members' Archived,
  Hidden, and Locked assets.
- **Non-elevated** caller (`'not-locked'`) sees other members' Archived + Hidden.

On `main` (v2.7.5), `searchAssetBuilder` coerced unset visibility to `Timeline`, so other members'
non-Timeline assets were always excluded from search. That exclusion was silently dropped in the rebase.

## Decision (locked by the user)

Restore the fork exclusion **per owner**: elevation only unlocks the **caller's own** locked/archived
folder. **Other** shared-space members' assets are always **Timeline-only** in space-scoped search.
The caller's own (and partner) rows still follow the Slice-1/H1 rule (global visibility filter).

## Root-cause location & fix shape

`searchAssetBuilder` (`server/src/utils/database.ts`) has two space-scoping branches; both currently
match space rows without any per-owner visibility constraint:

- **Branch A — `spaceId`** (`database.ts:655-672`): fires when a caller searches a single space
  (`dto.spaceId`). Pure `exists(shared_space_asset|library where spaceId = options.spaceId)`.
- **Branch B — `timelineSpaceIds`** (`database.ts:673-691`): fires for `withSharedSpaces`. It is an
  `OR` of `ownerId IN userIds` (caller + partners) and `exists(... where spaceId IN timelineSpaceIds)`.

The global visibility filter (`database.ts:648-652`) applies the caller's resolved visibility to all
rows. The minimal fix constrains only the **non-caller** space rows to `Timeline`, leaving the
caller-owned rows to the global filter:

- **Branch A** → `inSpace AND (ownerId IN userIds OR visibility = Timeline)`.
  Caller/partner-owned space rows follow the global filter; every other row must be `Timeline`.
  `userIds` may be absent (album path); guard the `ownerId` disjunct behind `options.userIds`.
- **Branch B** → `ownerId IN userIds OR (visibility = Timeline AND exists(space))`.
  Caller/partner rows via the `ownerId` disjunct (global filter applies); other members' rows must be
  `Timeline`. Branch B's `.$if` already requires `!!options.userIds`, so no guard needed.

Interaction with the global filter is correct in every case:

| resolved visibility           | caller-owned space rows           | other-member space rows                     |
| ----------------------------- | --------------------------------- | ------------------------------------------- |
| `undefined` (elevated)        | global off → all own visibilities | branch forces `Timeline` only               |
| `'not-locked'` (non-elevated) | global excludes Locked            | `Timeline` ⊆ not-locked → Timeline only     |
| explicit `Archive`            | global `= Archive` → own archived | `Timeline` ∧ `= Archive` = ∅ → **excluded** |
| explicit `Timeline`           | global `= Timeline`               | consistent → Timeline                       |

The change is entirely inside `searchAssetBuilder`; `searchMetadata`, `searchStatistics`,
`searchRandom`, `searchLargeAssets`, `searchSmart`, and smart-facets all route through it, so all
inherit the fix. No service/DTO change, no OpenAPI regen.

**Out of scope:** the `albumSharedSpaceScope` helper (album-scoped search reaching space content) — a
separate fork RBAC gate, not named by M3; left unchanged. Partner rows keep following the resolved
visibility (they reach the caller via partnership, not space membership — same as every sibling
endpoint and pre-rebase `main`).

## Files

- `server/src/utils/database.ts` — Branch A + Branch B per-owner constraint (the fix).
- `server/test/medium/specs/services/search.service.spec.ts` — new `describe('space-scoped visibility (M3)')`
  medium/DB tests (RED-first).
- `docs/superpowers/plans/2026-07-02-rolling-rebase-audit-slice-02.md` — this plan.
- `docs/plans/2026-07-02-rolling-rebase-audit-findings.md` — M3 Status → FIXED (slice S2).

## Tests (medium/DB, RED-first)

Test path: **medium** (`pnpm test:medium`, testcontainers Docker) — Docker is available. Two users A
(owner) + B (member/elevated) in one shared space S; assets with explicit visibilities.

Primary path uses `dto.spaceId` (Branch A) — deterministic, matches the existing "library-linked space
assets" tests. Add `withSharedSpaces` (Branch B) and `searchStatistics` coverage too.

1. **RED anchor** — Owner A archives asset X into S; member B **elevated** runs
   `searchMetadata({ spaceId: S })` → **X absent**. (Pre-fix: present, because elevated `undefined`
   visibility disables the global filter and Branch A has no per-owner constraint.)
2. Owner A has a Timeline asset Y in S; member B (elevated) `searchMetadata({ spaceId: S })` →
   **Y present**.
3. Caller B's **own** archived asset Z shared into S: B elevated `searchMetadata({ spaceId: S })` →
   **Z present** (own rows follow H1/elevated).
4. Non-elevated member B: A's Archived / Hidden / Locked assets in S all **absent** from
   `searchMetadata({ spaceId: S })`; a Timeline asset is present (baseline preserved).
5. Explicit `visibility = Archive`: elevated B `searchMetadata({ spaceId: S, visibility: Archive })`
   → A's archived **absent**, B's own archived **present** (only the caller's own archive is exposed).
6. `withSharedSpaces` (Branch B): A's archived absent, A's Timeline present for elevated B via
   `searchMetadata({ withSharedSpaces: true })`.
7. `searchStatistics({ spaceId: S })` for elevated B counts only Timeline (A's) + B's own = excludes
   A's archived (statistics variant shares the builder).
8. Multiple other-owners (A and C both archive into S): neither A's nor C's archived surfaces for
   elevated B (mixed-space independence).

**Expected RED:** tests 1, 5, 6, 7, 8 (and the archived/hidden/locked cases of 4) fail because the
pre-fix builder returns other members' non-Timeline assets. Capture the count mismatch on test 1.

## GREEN

`cd server && pnpm test:medium -- --run src/services/search.service.spec.ts`

Regression:

- `cd server && pnpm test -- --run src/services/search.service.spec.ts` (unit suite still green).
- `cd server && npx tsc --noEmit -p tsconfig.json` (no new `error TS`).

## Commit

```
fix(server): space-scoped search hides other members' archived/locked (M3)
```

Body: per-owner elevation — the caller's own (and partner) rows follow the resolved
visibility, other shared-space members' rows are constrained to Timeline in both the `spaceId` and
`timelineSpaceIds` scoping branches of `searchAssetBuilder`. Restores the pre-rebase `main` exclusion
that the v3 `undefined`-for-elevated default silently dropped.
