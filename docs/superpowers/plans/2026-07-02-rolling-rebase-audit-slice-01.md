# Slice 1 Plan — H1: `/search/random` visibility fallback

**Spec:** `docs/superpowers/specs/2026-07-02-rolling-rebase-audit-remediation.md` §Slice 1
**Finding:** H1 · closes the `/search/random` Locked/Archived/Hidden leak.

## Grounding (verified against current tree)

- Fix site: `server/src/services/search.service.ts:212` —
  `const items = await this.searchRepository.searchRandom(dto.size || 250, { ...resolvedDto, userIds });`
- Sibling pattern (`searchMetadata`, ~:156): `visibility: dto.visibility ?? (auth.session?.hasElevatedPermission ? undefined : 'not-locked')`.
- `resolvedDto` comes from `resolveScopedPersonFilters(auth, { ...dto, timelineSpaceIds })`; when `dto` has no `visibility` key, the resolved object has **no** `visibility` property → the repo currently receives no visibility clause.
- Existing tests (`search.service.spec.ts:1494` `describe('searchRandom')`) assert with `expect.objectContaining({ userIds })` (lenient) → **not broken** by adding a field.
- Auth factory: `AuthFactory.from().session().build()` = non-elevated (session present, `hasElevatedPermission:false`); `.session({ hasElevatedPermission: true })` = elevated; `AuthFactory.create()` = **no session** (API-key / shared-link path → `auth.session?.hasElevatedPermission` is `undefined`).

## TDD

### RED — add to `server/src/services/search.service.spec.ts` inside `describe('searchRandom')`

1. **non-elevated** (`AuthFactory.from().session().build()`), no `dto.visibility` → repo opts `.visibility === 'not-locked'`. (RED: absent today.)
2. **elevated** (`.session({ hasElevatedPermission: true })`), no `dto.visibility` → opts has property `visibility` equal to `undefined` (`toHaveProperty('visibility', undefined)`). (RED: property absent today → fails.)
3. **explicit `visibility=AssetVisibility.Archive`** → opts `.visibility === AssetVisibility.Archive` (guard: green before & after).
4. **no-session auth** (`AuthFactory.create()`) → opts `.visibility === 'not-locked'`. (RED: absent today.)

Assert by inspecting `mocks.search.searchRandom.mock.calls[0][1]` for precision (avoids objectContaining's undefined ambiguity).

Expected RED: `cd server && pnpm test -- --run src/services/search.service.spec.ts` → tests 1,2,4 fail.

### GREEN — implementation

In `searchRandom`, change the repo call to:

```ts
const items = await this.searchRepository.searchRandom(dto.size || 250, {
  ...resolvedDto,
  userIds,
  visibility: dto.visibility ?? (auth.session?.hasElevatedPermission ? undefined : 'not-locked'),
});
```

Expected GREEN: same command → all `searchRandom` tests pass. Existing `userIds` assertions unaffected (objectContaining).

## Edge cases (all asserted above)

- Partner IDs: `getUserIdsToSearch` includes partners; the visibility clause applies to the whole result set (opts carries both `userIds` and `visibility`).
- `dto.size` default (250) unchanged (existing tests).
- Explicit `visibility=Timeline` still Timeline-only (test 3 covers explicit passthrough via Archive; Timeline behaves identically).
- No-session auth (API key / shared link) → `not-locked` (test 4).

## Commit

`fix(server): close /search/random visibility leak (H1) — sibling not-locked fallback`

Then set H1 **Status → FIXED (slice S1)** in `docs/plans/2026-07-02-rolling-rebase-audit-findings.md`.
