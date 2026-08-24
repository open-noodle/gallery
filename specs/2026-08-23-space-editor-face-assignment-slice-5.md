# Space-Editor Face Assignment — Slice 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Pin the cross-space propagation contract (§5.1) **before** Slice 6 adds a second way to reach it.

**Architecture:** No implementation. This slice is four medium tests and nothing else. It exists because §5.1 makes a claim about existing behaviour — that a face carries one identity globally, and that the §6.3.1 override is space-local — and that claim is currently only argued, never executed. If F-20 fails, the design's premise is wrong and the remaining slices must not be built on it.

**Tech Stack:** Vitest medium tests against real Postgres (testcontainers).

**Spec:** `specs/2026-08-23-space-editor-face-assignment-design.md` — §5.1, §6.3.1, §9.5

**Baseline (Slices 1–4, committed):** attach, the shared `linkFaceToSpacePerson` helper with its `writeIdentity` flag, the space-scoped face read, create and detach.

## Global Constraints

- **No relative imports in `server/`** — use the `src/` path alias.
- **Do NOT touch** `server/src/utils/access.ts`, `person.controller.ts`, `face.controller.ts`.
- **Add no production code in this slice.** If a test cannot be written without changing behaviour, STOP and report — that is a finding, not a licence to change the implementation.
- **Never put `--` before a vitest filter** — it discards the filter and runs all 161 medium files, producing fake `too many clients already` failures. Use `pnpm test:medium --run shared-space-face-assign --maxWorkers=4`.
- **ESLint runs `--max-warnings 0`.** `pnpm lint` is ESLint only; prettier is a separate gate. Run both.
- **Do NOT run `make sql`** or regenerate OpenAPI.
- **Guard check:** `git diff --name-only <slice-5-base-sha>..HEAD` — the only files that may appear are the medium spec and this plan.

---

### Task 1: The four propagation tests

**Files:**

- Test only: `server/test/medium/specs/repositories/shared-space-face-assign.medium.spec.ts`

Reuse the file's existing `setup()`, `newSpaceWithEditorAndMember` and `reachPathBuilders` helpers throughout.

- [ ] **Step 1: F-20 — an attach in space A propagates to space B through the shared identity**

Two spaces, both containing Bob's asset. B has a space person already carrying identity X. Anna attaches the face to A's person, which also resolves to identity X (use `ensureSpacePersonIdentity` to line them up, or attach in A first and read the resulting identity).

Assert the face is now visible under **B's** person too.

This documents behaviour rather than changing it. If it fails, STOP: §5.1's premise is wrong and the whole design needs revisiting before Slice 6.

- [ ] **Step 2: F-21 — naming does not propagate**

Same fixture as F-20, but B's person carries a different `name`. After Anna's attach in A, assert `B.shared_space_person.name` is **unchanged**.

This is the other half of §5.1: identity is shared, naming is per space. A test that only checked F-20 would let a future change leak names across spaces unnoticed.

- [ ] **Step 3: F-23 — the owner's columns are untouched**

After an attach in A on a face the owner owns, assert:

- `asset_face.personId` is unchanged (still whatever it was, including `null`)
- no new row appeared in the owner's `person` table

- [ ] **Step 4: F-39 — the owner's RESOLVED metadata is untouched**

The strict one, and the reason F-23 alone is not enough. F-23 checks columns; Bob's own view of names and ages resolves at read time **through the identity**, via `applyResolvedPersonMetadata` (`asset.service.ts:180`) → `FaceIdentityRepository.getResolvedPersonByIdentityId`.

So: give Bob a named person with a birthday, carrying identity X. Have Anna attach a **different, unrelated** face in space A. Then assert what `getResolvedPersonByIdentityId(bob.id, X)` returns for Bob is unchanged — same name, same birthDate.

Assert on the **resolved values**, not the `person` row's columns. A column-level assertion passes vacuously here, because the entire point of §5.1 is that resolution happens at read time.

- [ ] **Step 5: Run the suite**

`cd server && pnpm test:medium --run shared-space-face-assign --maxWorkers=4`

All four new tests plus every pre-existing test must pass. **These tests should pass on the first run** — unlike every other slice, there is no red step, because they pin behaviour that already exists. That is expected here and only here.

If any of the four fails, do NOT change production code to make it pass. Report the failure with the exact output: it means the spec's §5.1 or §6.3.1 claim is false, which is a design finding that must reach the human before Slice 6 starts.

- [ ] **Step 6: Gate and commit**

```bash
cd server && pnpm check
cd server && pnpm test:medium --run shared-space-face-assign --maxWorkers=4
cd server && pnpm lint && npx prettier --check "src/**/*.ts" "test/**/*.ts"
```

```bash
git add server/test/medium/specs/repositories/shared-space-face-assign.medium.spec.ts
git commit -m "test(server): pin the cross-space face identity contract

Spec 5.1 claims a face carries one identity globally, that naming stays per
space, and that the 6.3.1 override is space-local. All three were argued and
none was executed. These four tests pin them before slice 6 adds a second way
to reach the identity layer.

F-39 asserts the RESOLVED name and birthday the owner sees, not the person
row's columns -- resolution happens at read time through the identity, so a
column-level assertion would pass vacuously.

Covers F-20, F-21, F-23, F-39. No production code."
```

---

## Slice 5 Done When

- F-20, F-21, F-23, F-39 all pass.
- `git diff --name-only <base>..HEAD` shows the medium spec and this plan, and nothing else.
- No production file changed.
