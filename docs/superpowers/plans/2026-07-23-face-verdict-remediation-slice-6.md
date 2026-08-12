# Face Verdict Remediation — Slice 6: Read-side RBAC and queue hygiene — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close **D6** (a space member — viewers included — can read the owner's whole-library pending suggestion queue via `GET /people/:id/face-suggestions`, gated on `PersonRead` = owner ∪ space member) and **D11** (`getPendingForPerson` lacks the asset-state gates its space twin has, so trashed/hidden/offline/locked assets surface in the personal queue).

**Architecture:** D6 = switch `getFaceSuggestions`'s single access gate from `Permission.PersonRead` to `Permission.PersonUpdate` (pure owner-only — resolves via `checkOwnerAccess` alone, no space-member/editor/admin carve-out; keeps the 400 status). D11 = add the four asset-state `.where()` gates to `getPendingForPerson`'s `base` query, copied from the space twin (`asset` is already inner-joined).

**Tech Stack:** NestJS access layer (`requireAccess`/`Permission`), Kysely, Vitest unit + medium + e2e API.

## Global Constraints

- `src/` alias; eslint `--max-warnings 0`; Prettier.
- Unit run: `cd server && pnpm exec vitest --config test/vitest.config.mjs --run <path>`. Medium: `cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run <path>`. Never `-- --run`. Confirm each file executed. Run the FULL `person.service.spec.ts` + `shared-space.service.spec.ts` unit files as part of the gate (a service change can break a sibling spec — the Slice-3 lesson).
- `Permission.PersonUpdate` = pure owner-only (`access.ts:328-332` → `checkOwnerAccess`, a bare `person.ownerId = userId`). No admin bypass — admins are refused too (edge-case requirement) and use the `/admin/face-repair` routes.
- **The spec doc's "mirror `getFacesForPicker`'s non-owner refusal" is imprecise** — `getFacesForPicker` _scopes_ non-owners, it doesn't refuse. Use the `PersonUpdate` switch (one line), the same idiom already governing `confirmFaceSuggestion`/`rejectFaceSuggestion`/`ignoreFaceSuggestion`.
- `AssetVisibility` is already imported in the verdict repo (`import { AssetVisibility } from 'src/enum'`).
- Scope: Slice 6 only — no changes to the space read path, the write paths (Slices 2-4), or the scan handlers (Slice 3).
- One commit. No `Co-Authored-By` trailers.

---

## File Structure

- **Modify** `server/src/services/person.service.ts` — `getFaceSuggestions` (~340): `Permission.PersonRead` → `Permission.PersonUpdate`.
- **Modify** `server/src/repositories/face-person-verdict.repository.ts` — `getPendingForPerson` `base` (~349-389): add `af.isVisible IS TRUE`, `asset.deletedAt IS NULL`, `asset.isOffline IS FALSE`, `asset.visibility IN [Archive, Timeline]`, right after the existing `af.deletedAt` gate and before the Slice-3 anti-join `.where((eb) => ...)` blocks.
- **Modify** `server/src/services/person.service.spec.ts` — add the D6 space-member-refused unit test in the `getFaceSuggestions` describe (~6429-6509).
- **Modify** `server/test/medium/specs/repositories/face-person-verdict.repository.spec.ts` — add the D11 asset-hygiene test in the `getPendingForPerson` block (~148-310).
- **Modify** `e2e/src/specs/server/api/person-face-suggestions.e2e-spec.ts` — add space viewer/editor 400 + owner 200 cases via `buildSpaceContext()` from `e2e/src/actors.ts`.

---

## Task 1: Red — D6 space-member leak (unit) + D11 asset hygiene (medium)

**Files:** Modify `person.service.spec.ts`, `face-person-verdict.repository.spec.ts`.

- [ ] **Step 1 (D6 unit):** In the `getFaceSuggestions` describe, add (the existing "denies a non-owner" test at ~6434 is a _pure stranger_ and doesn't discriminate — this new one is a genuine space MEMBER):

```ts
it('refuses a space member (non-owner) — suggestions are owner-only (D6)', async () => {
  // Space member: NOT the owner, but space-reachable (would pass PersonRead).
  mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set());
  mocks.access.person.checkSharedSpaceAccess.mockResolvedValue(new Set(['person-1']));

  await expect(sut.getFaceSuggestions(factory.auth(), 'person-1', { page: 1, size: 10 })).rejects.toThrow(
    BadRequestException,
  );
  expect(mocks.facePersonVerdict.getPendingForPerson).not.toHaveBeenCalled();
});
```

Run `cd server && pnpm exec vitest --config test/vitest.config.mjs --run src/services/person.service.spec.ts`. Expected RED: with `PersonRead`, the space member passes the gate → `getPendingForPerson` is called → no throw.

- [ ] **Step 2 (D11 medium):** In the `getPendingForPerson` block, add an asset-hygiene test mirroring the space twin's (`getPendingForSpacePerson includes ... excludes ineligible asset and face rows`, ~888-955):

```ts
it('excludes pending rows on trashed / hidden / offline / locked assets and invisible faces (D11)', async () => {
  // seed a named person + unassigned faces on: a normal asset (kept), a trashed asset
  // (ctx.newAsset({ deletedAt: new Date() })), a hidden-visibility asset, a locked-visibility asset,
  // an offline asset (isOffline:true), and a face with isVisible:false on a normal asset.
  // upsertPending for all; assert getPendingForPerson returns ONLY the normal one.
});
```

Use `ctx.newAsset({ ownerId, deletedAt: new Date() })` for the trashed case, `visibility: AssetVisibility.Hidden`/`AssetVisibility.Locked`, `isOffline: true`; and `updateTable('asset_face').set({ isVisible: false })` for the invisible-face case. Run `cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/repositories/face-person-verdict.repository.spec.ts`. Expected RED: today all six surface (no gates).

---

## Task 2: Green — the two fixes

- [ ] **Step 1 (D6):** `person.service.ts` `getFaceSuggestions` (~340):

```ts
await this.requireAccess({ auth, permission: Permission.PersonUpdate, ids: [id] });
```

Run the unit spec → the new test GREEN, the existing stranger/not-found tests still GREEN.

- [ ] **Step 2 (D11):** `face-person-verdict.repository.ts` `getPendingForPerson` `base`, after `.where('af.deletedAt', 'is', null)` and before the Slice-3 anti-joins:

```ts
.where('af.isVisible', 'is', true)
.where('asset.deletedAt', 'is', null)
.where('asset.isOffline', 'is', false)
.where('asset.visibility', 'in', [AssetVisibility.Archive, AssetVisibility.Timeline])
```

Run the medium spec → asset-hygiene test GREEN; the existing band/gate tests still GREEN.

---

## Task 3: e2e coverage + done gate + commit

- [ ] **Step 1 (e2e — write):** In `e2e/src/specs/server/api/person-face-suggestions.e2e-spec.ts`, add cases using `buildSpaceContext()` (`e2e/src/actors.ts`): create a person owned by `spaceOwner` with a face on `spaceAssetId` (so the person is space-reachable → `PersonRead` currently admits `spaceViewer`/`spaceEditor`), seed an unassigned face + a pending `face_person_verdict` row (reuse this file's `insertUnassignedFace`/`insertSuggestion` raw-SQL helpers), then assert:
  - `GET /people/:id/face-suggestions` as `spaceViewer` → **400**
  - as `spaceEditor` → **400**
  - as `spaceOwner` → **200**
    Mirror the usage pattern in `person-representative-face-write-scope.e2e-spec.ts` (~26-98).
- [ ] **Step 2 (e2e — run):** The e2e API suite needs the **:2285 e2e stack** (machine-wide singleton — check nothing else is using it; never :2283). If the stack is available, run: `cd e2e && pnpm test -- person-face-suggestions` (API vitest) and confirm the three new cases pass. **If the e2e stack is not readily available, note that the e2e run is deferred to Slice 10's full e2e API gate** (the spec runs the full e2e API + web suites there) — the unit + medium tests already prove D6/D11 at the service/repo layer; the e2e case is authored and will run in Slice 10.
- [ ] **Step 3 (done gate):**

```
cd server && pnpm check && pnpm lint
cd server && pnpm exec vitest --config test/vitest.config.mjs --run src/services/person.service.spec.ts src/services/shared-space.service.spec.ts
cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/repositories/face-person-verdict.repository.spec.ts
```

- [ ] **Step 4: Commit:**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/face-unified
git add server/src/services/person.service.ts server/src/repositories/face-person-verdict.repository.ts \
        server/src/services/person.service.spec.ts \
        server/test/medium/specs/repositories/face-person-verdict.repository.spec.ts \
        e2e/src/specs/server/api/person-face-suggestions.e2e-spec.ts \
        docs/superpowers/plans/2026-07-23-face-verdict-remediation-slice-6.md
git commit -m "fix(server): owner-only personal suggestion reads; pending queue honours asset state"
```

---

## Edge-case coverage map (spec §Slice 6 table → test)

| Edge case                                  | Covered by                                                                                                            |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Admin calling another user's personal read | `PersonUpdate`/`checkOwnerAccess` has no admin carve-out → refused. Add a unit assertion: admin auth, non-owner → 400 |
| Locked-folder asset                        | D11 medium: `visibility: Locked` → excluded                                                                           |
| Asset restored from trash                  | read-time gate: rows never deleted, so a restored asset resurfaces — add a medium assertion (untrash → row returns)   |
| Space member (viewer AND editor)           | D6 unit (viewer-shaped mock) + e2e viewer AND editor → 400                                                            |

## Self-review (author)

- **Spec coverage:** D6 (owner-only read, unit + e2e) and D11 (four asset gates, medium) each have a task + red-first test. The spec's imprecise "mirror getFacesForPicker" is corrected to the cleaner `PersonUpdate` switch (documented in Global Constraints). ✅
- **Placeholder scan:** the D6 one-liner and the four D11 gate lines are exact. The two test bodies name the exact seeding helpers/patterns to copy; the D11 medium body is described (seed six asset/face states, assert one survives) with the concrete `ctx.newAsset` args — acceptable given the named sibling test. ✅
- **Type consistency:** `Permission.PersonUpdate`, `AssetVisibility.Archive/Timeline` used as they exist in the codebase. ✅
- **Scope:** no space-read changes, no write-path changes, no scan changes. ✅
- **e2e-run pragmatics:** the e2e case is authored in Slice 6; its execution against the :2285 stack is done here if available, else deferred to Slice 10's full e2e gate (per spec). Unit+medium are the authoritative local gate for D6/D11. Flagged.
