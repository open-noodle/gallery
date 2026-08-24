# Space-Editor Face Assignment — Slice 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Extract the face-linking transaction into one shared helper used by both the suggestion-confirm and the direct-attach paths, and implement §6.3.1 — an editor may override a name the asset owner already gave a face, **space-locally**, without rewriting the face's global identity.

**Architecture:** `linkFaceToSpacePerson(trx, person, assetFaceId, { writeIdentity })` becomes the single implementation of "this face belongs to this space person". The suggestion confirm always passes `writeIdentity: true`. Direct attach passes `false` in exactly one case: the face already belongs to an owner `person` whose identity differs from the target space person's. In that case only the space projection is written, plus a negative verdict, so the ML pipeline does not re-offer the face.

**Tech Stack:** NestJS 11, Kysely, Vitest (unit + medium with testcontainers Postgres).

**Spec:** `specs/2026-08-23-space-editor-face-assignment-design.md` — §5.1, §6.3, §6.3.1, §9.2

**Baseline (Slice 1, already committed):**

- `FacePersonVerdictRepository.isFaceAssignableInSpace(spaceId, assetFaceId)` — `face-person-verdict.repository.ts:910`
- `SharedSpaceService.attachFaceToSpacePerson(auth, spaceId, personId, assetFaceId)` — `shared-space.service.ts:1470`
- `PUT /shared-spaces/:id/people/:personId/faces/:assetFaceId` — `shared-space.controller.ts:546`
- Medium spec `server/test/medium/specs/repositories/shared-space-face-assign.medium.spec.ts` (13 tests)

## Global Constraints

- **No relative imports in `server/`** — use the `src/` path alias.
- **Do NOT touch** `server/src/utils/access.ts`, `person.controller.ts`, `face.controller.ts`.
- **Do NOT write `asset_face.personId`** on any path.
- **Never put `--` before a vitest filter** — it discards the filter and runs all 161 medium files, producing fake `too many clients already` failures. Correct forms:
  - `cd server && pnpm test --run shared-space.service`
  - `cd server && pnpm test:medium --run shared-space-face-assign --maxWorkers=4`
- **ESLint runs `--max-warnings 0`.** Unused imports fail the build.
- **`pnpm lint` is ESLint only** — prettier is a separate gate. Run both.
- **Do NOT run `make sql`** (deletes every query file without a live DB) or regenerate OpenAPI — both deferred to Slice 9.
- **Guard check** (the slice-1 plan got this wrong): verify against **this slice's own commit range**, not `origin/main...HEAD`. The branch already contains #992, which legitimately touches `utils/access.ts`. Use `git diff --name-only <slice-2-base-sha>..HEAD`.

## Discovery step (do this first, before Task 1)

The plan names the primitives it expects. Confirm each against the real codebase and correct the plan's usage where it differs — do not weaken an assertion to fit a wrong guess:

| Expected                                                                         | Where                                                                                                                                                                                              |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `faceIdentityRepository.ensureSpacePersonIdentity(spacePersonId, db?)`           | `face-identity.repository.ts:2291`                                                                                                                                                                 |
| `faceIdentityRepository.replaceFaceIdentity(input, db?)`                         | `face-identity.repository.ts:2426`                                                                                                                                                                 |
| `facePersonVerdictRepository.resolveAssignedFace(assetFaceId, db?)`              | `face-person-verdict.repository.ts:60`                                                                                                                                                             |
| `facePersonVerdictRepository.clearNegativeForTarget(target, ids, db?)`           | `face-person-verdict.repository.ts:501`                                                                                                                                                            |
| `facePersonVerdictRepository.markRejectedForSpacePerson(personId, faceId, opts)` | used by `resolveSpacePersonFaceSuggestion`                                                                                                                                                         |
| `sharedSpaceRepository.addPersonFaces(values, options?, db?)`                    | `shared-space.repository.ts:2617`                                                                                                                                                                  |
| `sharedSpaceRepository.removePersonFaceAssignmentsForSpaceFace(spaceId, faceId)` | `shared-space.repository.ts:3920` — **note: takes no `db`/trx param today.** Reassign needs it inside the transaction, so add an optional trailing `db` param following the idiom of its siblings. |
| `person.identityId`                                                              | `person.table.ts:82`, unique per `(ownerId, identityId)`                                                                                                                                           |

---

### Task 1: Extract `linkFaceToSpacePerson`, no behaviour change

Pure refactor. Its proof is that **every existing test passes unchanged** — if any existing spec needs editing, the extraction altered behaviour and is wrong.

**Files:**

- Modify: `server/src/services/shared-space.service.ts` — add the private helper; re-point `confirmSpacePersonFaceSuggestion` (`:1388`) and `attachFaceToSpacePerson` (`:1470`) at it.

**Interfaces:**

- Produces: `private async linkFaceToSpacePerson(trx: Transaction<DB>, person: SharedSpacePerson, assetFaceId: string, options: { writeIdentity: boolean }): Promise<void>`

- [ ] **Step 1: Record the pre-refactor baseline**

Run and record exact counts — these must not change:

```bash
cd server && pnpm test --run shared-space.service
cd server && pnpm test:medium --run shared-space-face-assign --maxWorkers=4
```

Expected today: 579 unit, 13 medium.

- [ ] **Step 2: Write the helper**

Add as a private method near the other space-person helpers. Body is the transaction currently inlined in **both** callers:

```ts
  /**
   * The single implementation of "this face belongs to this space person" (spec §6.3).
   *
   * `writeIdentity: false` is §6.3.1 row 3 — the face already belongs to an owner `person`
   * carrying a different identity. Writing the identity there would re-point an identity the
   * OWNER's person depends on, and `applyResolvedPersonMetadata` resolves the owner's own view
   * of names and ages through exactly that identity. Space-person reads go through
   * `shared_space_person_face`, not the identity layer, so the projection alone is enough for
   * the space to show the new name while the owner's library stays untouched.
   */
  private async linkFaceToSpacePerson(
    trx: Transaction<DB>,
    person: SharedSpacePerson,
    assetFaceId: string,
    { writeIdentity }: { writeIdentity: boolean },
  ): Promise<void> {
    if (writeIdentity) {
      const identity = await this.faceIdentityRepository.ensureSpacePersonIdentity(person.id, trx);
      await this.faceIdentityRepository.replaceFaceIdentity(
        { assetFaceId, identityId: identity.id, source: 'manual' },
        trx,
      );
      await this.facePersonVerdictRepository.clearNegativeForTarget(
        { spacePersonId: person.id, identityId: identity.id },
        [assetFaceId],
        trx,
      );
    }
    await this.facePersonVerdictRepository.resolveAssignedFace(assetFaceId, trx);
    await this.sharedSpaceRepository.addPersonFaces([{ personId: person.id, assetFaceId }], undefined, trx);
  }
```

Note the confirm path also calls `claimPendingForSpacePerson` and returns a claim count — that stays in `confirmSpacePersonFaceSuggestion`, **outside** the helper. Only the four writes above move.

- [ ] **Step 3: Re-point both callers**

`confirmSpacePersonFaceSuggestion` keeps its `hasPendingForSpacePerson` / `claimPendingForSpacePerson` gating and calls `linkFaceToSpacePerson(trx, person, assetFaceId, { writeIdentity: true })` in place of its four inline writes. `attachFaceToSpacePerson` does the same.

- [ ] **Step 4: Prove no behaviour changed**

Re-run both commands from Step 1. Counts and pass/fail must be **identical** — 579 unit, 13 medium, zero edits to any existing test.

If an existing test now fails or needed editing: STOP and report. That is the refactor being wrong, not the test.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/shared-space.service.ts
git commit -m "refactor(server): extract linkFaceToSpacePerson

One implementation of the face-to-space-person link, shared by the suggestion
confirm and the direct attach, so the two cannot drift. The writeIdentity flag
is unused so far (both callers pass true); slice 2 task 2 is its first false.

Pure refactor: all 579 unit and 13 medium tests pass unchanged."
```

---

### Task 2: §6.3.1 — the owner-named override

**Files:**

- Modify: `server/src/services/shared-space.service.ts` — `attachFaceToSpacePerson`
- Modify: `server/src/repositories/shared-space.repository.ts` — add an optional `db` param to `removePersonFaceAssignmentsForSpaceFace` (`:3920`)
- Test: `server/src/services/shared-space.service.spec.ts`, `server/test/medium/specs/repositories/shared-space-face-assign.medium.spec.ts`

**Behaviour (spec §6.3.1), three rows:**

| Face state                                                        | `writeIdentity` | Projection | Extra                                        |
| ----------------------------------------------------------------- | --------------- | ---------- | -------------------------------------------- |
| `personId IS NULL`                                                | `true`          | yes        | —                                            |
| `personId` set, owner person's identity **equals** space person's | `true`          | yes        | —                                            |
| `personId` set, owner person's identity **differs** or is null    | **`false`**     | yes        | negative verdict for the owner-side identity |

Plus reassign (F-13): if the face is already held by a **different** space person in this space, remove that projection row first and write a negative verdict for the old person, inside the same transaction.

- [ ] **Step 1: Write the failing tests — F-36 FIRST**

F-36 is the one that keeps the design's safety claim true, and it must assert the **absence** of an identity rewrite, not merely a 200. The natural implementation (always `writeIdentity: true`) returns 200 and passes every other test here while silently re-pointing the owner's identity.

Add to `server/src/services/shared-space.service.spec.ts`, inside the existing `attachFaceToSpacePerson` describe, using the file's `factory.auth()` and `makeMemberResult()` idioms:

```ts
// F-36 (§6.3.1 row 3): the owner already named this face under a DIFFERENT identity.
// The attach is ALLOWED, but the identity must NOT be rewritten — the owner's person
// depends on it, and applyResolvedPersonMetadata resolves their view through it.
it("overrides an owner-named face WITHOUT rewriting its identity (F-36)", async () => {
  // arrange: face has personId set, owner person identity 'owner-identity',
  // target space person identity 'space-identity'
  // ...mock per the file's idiom...

  await expect(sut.attachFaceToSpacePerson(auth, "space-id", "person-id", "face-id")).resolves.toBe(true);

  // the space sees the new name
  expect(mocks.sharedSpace.addPersonFaces).toHaveBeenCalledWith([{ personId: "person-id", assetFaceId: "face-id" }], undefined, expect.anything());
  // but the owner's identity is untouched
  expect(mocks.faceIdentity.replaceFaceIdentity).not.toHaveBeenCalled();
  // and the pipeline will not re-offer it
  expect(mocks.facePersonVerdict.markRejectedForSpacePerson).toHaveBeenCalled();
});

// F-34 (row 1): unrecognised face — ordinary path, identity IS written.
it("writes the identity for an unassigned face (F-34)", async () => {
  // ...personId null...
  expect(mocks.faceIdentity.replaceFaceIdentity).toHaveBeenCalled();
});

// F-35 (row 2): same identity on both sides — no rewrite needed, still succeeds.
it("succeeds without a rewrite when the identities already match (F-35)", async () => {
  // ...owner person identity === space person identity...
  await expect(sut.attachFaceToSpacePerson(auth, "space-id", "person-id", "face-id")).resolves.toBe(true);
});

// F-13: reassign between two space people in the SAME space.
it("moves the face off the previous space person and records a negative verdict (F-13)", async () => {
  // ...face already held by 'other-person-id' in this space...
  expect(mocks.sharedSpace.removePersonFaceAssignmentsForSpaceFace).toHaveBeenCalled();
  expect(mocks.facePersonVerdict.markRejectedForSpacePerson).toHaveBeenCalled();
});
```

Fill the arrange blocks by mirroring the mocking already used in the `confirmSpacePersonFaceSuggestion` and Slice-1 `attachFaceToSpacePerson` describes. You will need a repository read that returns the face's `personId` and the owner person's `identityId` — if none exists, add one to `FacePersonVerdictRepository` or `PersonRepository` following the sibling idiom, and register the mock.

- [ ] **Step 2: Run and confirm RED**

`cd server && pnpm test --run shared-space.service`

Expected: the four new tests fail. F-36 must fail on `replaceFaceIdentity` having been called — **not** on a 4xx. If F-36 fails because the request was refused, the implementation is the old refusal behaviour and the spec decision was reverted; STOP and report.

- [ ] **Step 3: Implement**

In `attachFaceToSpacePerson`, after the assignability check and inside the transaction:

1. Read the face's `personId` and, if set, its owner person's `identityId`.
2. Read the target space person's `identityId`.
3. `writeIdentity = personId === null || ownerIdentityId === spacePersonIdentityId`.
4. If `writeIdentity === false`, also write a negative verdict for the owner-side target so the suggestion pipeline does not re-offer the face.
5. Reassign: call `removePersonFaceAssignmentsForSpaceFace(spaceId, assetFaceId, trx)` for any **other** space person in this space holding the face, and write a negative verdict for each removed person.
6. Call `linkFaceToSpacePerson(trx, person, assetFaceId, { writeIdentity })`.

Add the optional `db` param to `removePersonFaceAssignmentsForSpaceFace` so step 5 runs inside the transaction; follow the trailing-`db` idiom used by `addPersonFaces`.

- [ ] **Step 4: Run and confirm GREEN**

`cd server && pnpm test --run shared-space.service` — all pass, including the 579 pre-existing.

- [ ] **Step 5: Add the medium tests F-37 and F-40**

Append to `server/test/medium/specs/repositories/shared-space-face-assign.medium.spec.ts`, using the `newMediumService(SharedSpaceService, ...)` → `{ sut, ctx }` destructure (NOT `ctx.get(SharedSpaceService)`, which throws — `ctx.get` constructs repositories only).

```ts
// F-40: the override is space-local. Bob's person, his asset_face.personId and the identity
// his own reads resolve through are all unchanged after Anna overrides in the space.
// Assert on the RESOLVED values, not just the columns.

// F-37: two editors attach the same face to different space people concurrently.
// One wins; never two shared_space_person_face rows for that face in this space,
// and no lost recount. Needs two real transactions racing — medium only.
```

Write both against real Postgres with real fixtures, mirroring the file's existing helpers.

- [ ] **Step 6: Run the full slice gate**

```bash
cd server && pnpm check
cd server && pnpm test --run shared-space.service
cd server && pnpm test --run shared-space.controller
cd server && pnpm test:medium --run shared-space-face-assign --maxWorkers=4
cd server && pnpm lint && npx prettier --check "src/**/*.ts" "test/**/*.ts"
```

- [ ] **Step 7: Commit**

```bash
git add server/src/services/shared-space.service.ts server/src/services/shared-space.service.spec.ts server/src/repositories/shared-space.repository.ts server/test/medium/specs/repositories/shared-space-face-assign.medium.spec.ts
git commit -m "feat(server): let an editor override an owner-named face, space-locally

Spec 6.3.1. The attach is allowed on a face its owner already named, but the
face's global identity is NOT rewritten -- space people are read through
shared_space_person_face, so the projection alone shows the new name while the
owner's person, asset_face.personId and resolved metadata stay untouched.
A negative verdict stops the suggestion pipeline re-offering the face.

Covers F-13, F-34, F-35, F-36, F-37, F-40."
```

---

## Slice 2 Done When

- One `linkFaceToSpacePerson` implementation, both callers using it, every pre-existing test passing unchanged.
- F-13, F-34, F-35, F-36, F-37, F-40 pass. F-36 asserts `replaceFaceIdentity` was NOT called.
- `git diff --name-only <slice-2-base>..HEAD` touches no forbidden file.
- No OpenAPI or SQL regeneration has run.
