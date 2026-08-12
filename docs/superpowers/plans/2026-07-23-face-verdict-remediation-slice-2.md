# Face Verdict Remediation — Slice 2: Suggestion writes carry identity + actor; no silent no-ops; no weakening upserts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close **D2** (suggestion rejects/ignores write `identityId` + `actorId` + `source`), **D9** (space reject/ignore stops silently no-opping when the row isn't pending), and **D10** (a reject no longer nulls an existing keep-here row's `identityId`) of `docs/superpowers/specs/2026-07-23-face-verdict-layer-remediation-design.md`.

**Architecture:** Three coordinated changes. (1) The four suggestion write sites in `person.service`/`shared-space.service` ensure the target's identity and pass full verdict opts. (2) The verdict-repo conflict upserts **coalesce** `identityId` (`COALESCE(excluded, existing)`) so an incoming write never nulls a stronger existing key. (3) The space reject/ignore path replaces the `hasPendingForSpacePerson` gate — which conflated RBAC reachability with pendingness — with a pure face-reachability check (`spaceAssetPathBranches`), then upserts unconditionally like the personal path.

**Tech Stack:** NestJS 11, Kysely (`onConflict().doUpdateSet`, `sql` for `excluded`), Vitest unit (auto-mock `newTestService`) + medium (testcontainers).

## Global Constraints

- Server `src/` alias imports; eslint `--max-warnings 0`; Prettier 120-col.
- Targeted runs: unit `cd server && pnpm exec vitest --run <path>`; medium `cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run <path>`. Never `pnpm test:medium -- --run` (drops the path filter).
- `FacePersonVerdictSource = 'suggestion' | 'cleanup'` (`face-person-verdict.table.ts:33`).
- `markRejected`/`markIgnored`/`markRejectedForSpacePerson`/`markIgnoredForSpacePerson` ALREADY accept `opts?: { identityId?: string | null; source?: FacePersonVerdictSource; actorId?: string | null }` — the wrappers exist; the work is to (a) pass opts from the services and (b) fix the `doUpdateSet` coalesce.
- `faceIdentityRepository`, `facePersonVerdictRepository`, `sharedSpaceRepository` are all base-injected — **no DI/constructor changes**.
- Slice-2 scope only: do NOT re-key/re-target merges (Slice 1, done), do NOT add read-side owner gates or asset-state gates to the personal queue (Slice 6), do NOT touch manual-source preservation (Slice 4).
- One commit at the end. No `Co-Authored-By` trailers.

---

## File Structure

- **Modify** `server/src/services/person.service.ts` — `rejectFaceSuggestion` (~392-402), `ignoreFaceSuggestion` (~404-408): ensure identity + pass opts. Add a private `verdictOpts` helper.
- **Modify** `server/src/services/shared-space.service.ts` — `resolveSpacePersonFaceSuggestion` (~1327-1350): replace the `hasPendingForSpacePerson` gate with the new reachability check + pass opts. Add a private `spaceVerdictOpts` helper.
- **Modify** `server/src/repositories/face-person-verdict.repository.ts` — `recordPersonalVerdict` (~129-162) + `recordSpacePersonVerdict` (~182-215) `doUpdateSet` coalesce; add `isFaceReachableInSpace(spaceId, assetFaceId)` (built on `spaceAssetPathBranches`, mirroring the asset-reachability portion of `hasPendingForSpacePerson`, no pending/distance/spacePersonId predicates).
- **Modify** unit specs: `server/src/services/person.service.spec.ts` (pins at 6513/6525/6539/6551), `server/src/services/shared-space.service.spec.ts` (pins at 7397/7411/7425; rewrite the not-pending no-op test at ~7367-7388).
- **Modify** medium spec: `server/test/medium/specs/repositories/face-person-verdict.repository.spec.ts` (coalesce + reachability), `server/test/medium/specs/services/shared-space-face-suggestions.service.spec.ts` (drained-but-reachable still writes; unreachable refused).

**Interfaces produced (later tasks depend on these):**

```ts
// face-person-verdict.repository.ts
async isFaceReachableInSpace(spaceId: string, assetFaceId: string): Promise<boolean>;
```

---

## Task 1: Red — repo coalesce + reachability medium tests

**Files:** Modify `server/test/medium/specs/repositories/face-person-verdict.repository.spec.ts`

- [ ] **Step 1:** Add three medium tests (copy seeding patterns from the existing personal + `space-person suggestion methods` blocks in this file):

```ts
it('reject over an existing keep-here row preserves identityId, updates status/source/actor (D10)', async () => {
  // seed a cleanup keep-here (rejected) row WITH identityId + actorId via markRejected(personId, faceId, { identityId, source: 'cleanup', actorId: adminId })
  // then a plain user reject WITHOUT opts: markRejected(personId, faceId)  (degenerate caller)
  // assert the row still has the ORIGINAL identityId (coalesced, not nulled), status still 'rejected'
  // then a user reject WITH opts { identityId, source: 'suggestion', actorId: userId }
  // assert identityId present, source now 'suggestion', actorId now userId
});

it('isFaceReachableInSpace: true for a face whose asset is in the space, false when it is not', async () => {
  // seed a space + space asset + face -> reachable true
  // remove the shared_space_asset (or use a face on an asset not in the space) -> reachable false
});

it('isFaceReachableInSpace: true when reachable only via the album-contribution branch', async () => {
  // seed the face's asset into the space via a contributed album asset (3rd path) -> reachable true
});
```

- [ ] **Step 2: Run RED** — `cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/repositories/face-person-verdict.repository.spec.ts`. Expected: the coalesce test FAILS (existing code nulls identityId on the opts-less reject); `isFaceReachableInSpace` tests FAIL to compile / method missing. Confirm the file executed.

---

## Task 2: Green — coalesce upsert + reachability method

**Files:** Modify `server/src/repositories/face-person-verdict.repository.ts`

- [ ] **Step 1: Coalesce `identityId`** in BOTH `recordPersonalVerdict` and `recordSpacePersonVerdict` `doUpdateSet`. Change the `identityId: input.identityId ?? null` line to a coalesce that keeps the existing identity when the incoming one is null. Personal example (mirror for space, table alias `face_person_verdict`):

```ts
.doUpdateSet({
  status: input.status,
  // D10: never null a stronger existing key — keep the existing identity when the incoming write omits one.
  identityId: sql`coalesce(excluded."identityId", "face_person_verdict"."identityId")`,
  source: input.source ?? 'suggestion',
  actorId: input.actorId ?? null,
  updatedAt: sql`now()`,
})
```

> `excluded` is the Postgres ON CONFLICT alias for the row proposed for insertion. If the type-checker needs it, type the fragment `sql<string | null>\`…\``. `status`/`source`/`actorId` stay last-human-wins (incoming) per spec §3 "Never weaken a verdict row in place".

- [ ] **Step 2: Add `isFaceReachableInSpace`.** Copy the asset-reachability portion of `hasPendingForSpacePerson` (the `asset_face`→`asset` join + the `spaceAssetPathBranches` call with `correlateAssetId: 'asset.id'`, `correlateLibraryId: 'asset.libraryId'`, `scope: { spaceId }`, NO `requireShowInTimeline`), dropping the `status = 'pending'`, distance-band, and `spacePersonId` predicates:

```ts
async isFaceReachableInSpace(spaceId: string, assetFaceId: string): Promise<boolean> {
  const row = await this.db
    .selectFrom('asset_face')
    .innerJoin('asset', 'asset.id', 'asset_face.assetId')
    .select('asset_face.id')
    .where('asset_face.id', '=', assetFaceId)
    .where((eb) => eb.or(spaceAssetPathBranches(eb as unknown as ExpressionBuilder<DB, keyof DB>, {
      correlateAssetId: 'asset.id',
      correlateLibraryId: 'asset.libraryId',
      scope: { spaceId },
    })))
    .executeTakeFirst();
  return row !== undefined;
}
```

> Reachability is the RBAC boundary (is this face's asset in the space at all), decoupled from the display-state/pending gates — matches spec §3 "decouples from pendingness". Do NOT reuse `sharedSpaceRepository.isFaceInSpace` (it omits the contribution arm and hardcodes `showInTimeline=true`).

- [ ] **Step 3: Run GREEN** — the Task-1 medium tests pass. Confirm file executed.

---

## Task 3: Red+Green — person.service passes identity + actor

**Files:** Modify `server/src/services/person.service.ts`, `server/src/services/person.service.spec.ts`

- [ ] **Step 1 (Red):** Update the pinned unit assertions to expect full opts. At `person.service.spec.ts:6513`:

```ts
expect(mocks.facePersonVerdict.markRejected).toHaveBeenCalledWith('person-1', 'face-1', {
  identityId: expect.any(String),
  source: 'suggestion',
  actorId: authUser.id,
});
```

Apply the analogous 3-arg update at 6525 (markIgnored), 6539/6540, 6551 (dismiss → reject). Ensure `ensurePersonIdentity` is mocked to return an identity (`{ id: 'identity-1' }`) so the call resolves. Run: `cd server && pnpm exec vitest --run src/services/person.service.spec.ts`. Expected: RED — called with 2 args.

- [ ] **Step 2 (Green):** In `person.service.ts`, add a private helper and use it:

```ts
private async verdictOpts(auth: AuthDto, personId: string): Promise<{ identityId: string; source: 'suggestion'; actorId: string }> {
  const identity = await this.faceIdentityRepository.ensurePersonIdentity(personId);
  return { identityId: identity.id, source: 'suggestion', actorId: auth.user.id };
}
```

```ts
async rejectFaceSuggestion(auth: AuthDto, personId: string, assetFaceId: string): Promise<void> {
  await this.requireAccess({ auth, permission: Permission.PersonUpdate, ids: [personId] });
  await this.facePersonVerdictRepository.markRejected(personId, assetFaceId, await this.verdictOpts(auth, personId));
}
async ignoreFaceSuggestion(auth: AuthDto, personId: string, assetFaceId: string): Promise<void> {
  await this.requireAccess({ auth, permission: Permission.PersonUpdate, ids: [personId] });
  await this.facePersonVerdictRepository.markIgnored(personId, assetFaceId, await this.verdictOpts(auth, personId));
}
```

Run Step-1 command → GREEN.

---

## Task 4: Red+Green — space reject decouples from pendingness + carries identity/actor

**Files:** Modify `server/src/services/shared-space.service.ts`, `server/src/services/shared-space.service.spec.ts`

- [ ] **Step 1 (Red):** Rewrite the "no-ops stale/already-resolved" test (`shared-space.service.spec.ts:~7367-7388`) so that:
  - it mocks the NEW `isFaceReachableInSpace` (not `hasPendingForSpacePerson`): when reachability is `false` → assert `markRejectedForSpacePerson` is NOT called (still refuses genuinely-unreachable faces);
  - a NEW test: reachability `true` but no pending row (drained) → `markRejectedForSpacePerson` IS called with opts.
    Update the pinned 2-arg assertions at 7397/7411/7425 to 3-arg with `{ identityId: expect.any(String), source: 'suggestion', actorId: authUser.id }`. Mock `ensureSpacePersonIdentity` → `{ id: 'identity-1' }`. Run: `cd server && pnpm exec vitest --run src/services/shared-space.service.spec.ts`. Expected RED.

- [ ] **Step 2 (Green):** In `resolveSpacePersonFaceSuggestion`, replace the pending gate + 2-arg calls:

```ts
private async resolveSpacePersonFaceSuggestion(auth: AuthDto, spaceId: string, personId: string, assetFaceId: string, action: 'rejected' | 'ignored'): Promise<void> {
  await this.requireRole(auth, spaceId, SharedSpaceRole.Editor);
  const person = await this.requireSpacePersonInSpace(spaceId, personId);
  // D9: reachability (RBAC), not pendingness, gates the write; then upsert unconditionally like the personal path.
  const reachable = await this.facePersonVerdictRepository.isFaceReachableInSpace(spaceId, assetFaceId);
  if (!reachable) {
    return;
  }
  const identity = await this.faceIdentityRepository.ensureSpacePersonIdentity(person.id);
  const opts = { identityId: identity.id, source: 'suggestion' as const, actorId: auth.user.id };
  await (action === 'rejected'
    ? this.facePersonVerdictRepository.markRejectedForSpacePerson(person.id, assetFaceId, opts)
    : this.facePersonVerdictRepository.markIgnoredForSpacePerson(person.id, assetFaceId, opts));
}
```

Run Step-1 command → GREEN.

> `confirmSpacePersonFaceSuggestion` still uses `hasPendingForSpacePerson` (confirm is a claim-then-work op — leave it; Slice 3 revisits confirm). Only reject/ignore decouple here.

---

## Task 5: Green — medium coverage for space reject decoupling

**Files:** Modify `server/test/medium/specs/services/shared-space-face-suggestions.service.spec.ts`

- [ ] **Step 1:** Add two medium tests using `createSuggestionFixture`:
  - **"space reject on a drained-but-reachable face still records the verdict (D9)"** — seed the pending row, drain it (`claimPendingForSpacePerson` or delete the pending row) leaving the face reachable, call `rejectSpacePersonFaceSuggestion`, assert a `rejected` verdict row exists for the space person with `identityId` + `actorId` populated.
  - **"space reject on a genuinely unreachable face is refused"** — keep the existing edge-21 test (delete `shared_space_asset` → unreachable) green; assert no verdict row is written.
- [ ] **Step 2: Run** `cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/services/shared-space-face-suggestions.service.spec.ts` → GREEN.

---

## Task 6: Done gate + commit

- [ ] **Step 1: Full gate** (run in full):

```bash
cd server && pnpm check      # clean
cd server && pnpm lint       # --max-warnings 0, clean
cd server && pnpm exec vitest --run src/services/person.service.spec.ts src/services/shared-space.service.spec.ts
cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run \
  test/medium/specs/repositories/face-person-verdict.repository.spec.ts \
  test/medium/specs/services/shared-space-face-suggestions.service.spec.ts
```

Plus: if the resolutions web spec / its fixture asserts a null actor for a user verdict, update the fixture so the actor column is populated (edge case in spec §Slice 2). Verify `cd web && pnpm exec vitest --run <resolutions spec>` if one exists and touches actor; otherwise note none exists.

- [ ] **Step 2: Commit:**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/face-unified
git add server/src/services/person.service.ts server/src/services/shared-space.service.ts \
        server/src/repositories/face-person-verdict.repository.ts \
        server/src/services/person.service.spec.ts server/src/services/shared-space.service.spec.ts \
        server/test/medium/specs/repositories/face-person-verdict.repository.spec.ts \
        server/test/medium/specs/services/shared-space-face-suggestions.service.spec.ts \
        docs/superpowers/plans/2026-07-23-face-verdict-remediation-slice-2.md
git commit -m "fix(server): user face verdicts carry identity and actor; space rejects never no-op"
```

---

## Edge-case coverage map (spec §Slice 2 table → test)

| Edge case                                               | Covered by                                                                                                                                                                               |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reject a person with no identity yet                    | `verdictOpts` calls `ensurePersonIdentity` first — unit asserts `markRejected` receives a non-null `identityId`; medium: reject a person seeded without an identity → row carries `I(P)` |
| Reject after the face was CASCADE-deleted               | 0 rows affected, benign — medium: delete the face, reject → `markRejected` returns 0, no throw                                                                                           |
| Double reject / reject-then-ignore race                 | last human wins on status; identityId never nulled — medium extends the coalesce test with a second write                                                                                |
| Space reject by a viewer                                | still 403 via Editor gate — unit: viewer auth → `requireRole` throws (unchanged; assert still thrown)                                                                                    |
| Space reject reachable only via 3rd (contribution) path | accepted — repo medium test in Task 1 Step 1 (contribution branch → reachable true) + service accepts                                                                                    |
| Resolutions actor column populated                      | Task 6 Step 1 fixture/web-spec check                                                                                                                                                     |

## Self-review (author)

- **Spec coverage:** D2 (both personal + space writes carry opts), D9 (reachability replaces pendingness in reject/ignore), D10 (coalesce upsert) each have a task + test. ✅
- **Placeholder scan:** medium test bodies are described with exact seeding/asserting intent + the helper names to copy; the coalesce and reachability code is complete. The three medium `it` bodies in Task 1 are described rather than fully transcribed — the implementer copies the concrete `insertInto`/`getRow` calls from the sibling blocks named in each. Acceptable (fixture wiring is repo-specific and the source blocks are named); if the reviewer wants literal code, transcribe from the named blocks. ⚠️ borderline — flag for plan review.
- **Type consistency:** `isFaceReachableInSpace(spaceId, assetFaceId): Promise<boolean>` used identically in the interface block, Task 2 definition, and Task 4 call site. `verdictOpts`/`spaceVerdictOpts` return the `{ identityId, source: 'suggestion', actorId }` shape the wrappers accept. ✅
- **Scope:** no merge code, no read-side owner/asset gates (Slice 6), no manual preservation (Slice 4). ✅
