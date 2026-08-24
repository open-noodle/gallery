# Space-Editor Face Assignment — Slice 7 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** When an editor names or unnames a face on someone else's photo, the space's activity feed says so — and when the owner does it to their own, it stays quiet.

**Architecture:** Two new `SharedSpaceActivityType` members alongside the existing `person_update` / `person_delete` / `person_merge`. Written from the attach and detach service methods, inside the same transaction as the change itself, so a row can never describe a write that rolled back. Rendered by the existing feed component with new i18n keys in all ten locale files.

**Tech Stack:** NestJS 11, Kysely, Svelte 5, Vitest.

**Spec:** `specs/2026-08-23-space-editor-face-assignment-design.md` — §6.7, §9.7

**Baseline (Slices 1–6, committed):** attach, detach, create, the space face read, draw and delete boxes, and the cross-space pins.

## Global Constraints

- **No relative imports in `server/`** — use the `src/` path alias.
- **Do NOT touch** `server/src/utils/access.ts`, `person.controller.ts`, `face.controller.ts`.
- **Never put `--` before a vitest filter** — it discards the filter and runs all 161 medium files, producing fake `too many clients already` failures. Use `pnpm test --run shared-space.service`, `pnpm test:medium --run shared-space-face-assign --maxWorkers=4`.
- **ESLint runs `--max-warnings 0`.** `pnpm lint` is ESLint only; prettier is a separate gate. Run both — and web has its own: `cd web && pnpm check:typescript && pnpm check:svelte`.
- **Do NOT run `make sql`** or regenerate OpenAPI — Slice 9.
- **`logActivity` takes a trailing `db` param** (`shared-space.repository.ts:1590`). Pass the transaction. A row written outside the transaction can survive a rollback and describe a change that never happened.
- **Guard check:** `git diff --name-only <slice-7-base-sha>..HEAD`, never `origin/main...HEAD`.

## The i18n rule is not optional

Per `CLAUDE.md`, every user-facing string change must update **nine locales in the same commit**, not just `en.json`:

`de` · `fr` · `it` · `nl` · `pl` · `es` · `ru` · `zh_Hans` · `zh_Hant`

- These are **new** keys, so every locale needs a real translation — a missing key falls back to English, which is acceptable-but-poor, whereas a wrong one is worse.
- **Match each file's register.** German, Italian and Spanish address the user informally (`du` / `tu` / `tú`); French and Russian use formal `vous` / `вы`.
- Reuse the word each file already uses for a concept — look up the nearest existing `spaces_activity_*` key rather than inventing a synonym.
- Keys are **alphabetically sorted**, 2-space indent, unescaped Unicode. Insert in place, then run `npx prettier --write i18n/*.json` from the repo root. CI checks the formatting.
- `i18n/` is shared by web **and** mobile — grep both before renaming anything.
- Do **not** hand-edit the other ~80 locale files.

---

### Task 1: The activity types and the writes

**Files:**

- Modify: `server/src/enum.ts` — `SharedSpaceActivityType` (~`:79-95`)
- Modify: `server/src/services/shared-space.service.ts` — `attachFaceToSpacePerson`, `detachFaceFromSpacePerson`
- Test: `server/src/services/shared-space.service.spec.ts`

**Interfaces:**

- Produces: `SharedSpaceActivityType.PersonFaceAssign = 'person_face_assign'`, `SharedSpaceActivityType.PersonFaceDetach = 'person_face_detach'`
- Data payload: `{ personId: string; personName: string; count: number }`

**The owner-self rule (F-26):** log nothing when the acting user is the asset's owner. This matches what #992 established for `asset_edit` and is what keeps the feed low-volume — an owner tidying their own photos would otherwise flood it. Determine ownership from the **asset**, not from space role.

- [ ] **Step 1: Write F-24, F-25, F-26 as failing tests**

In `server/src/services/shared-space.service.spec.ts`, inside the existing `attachFaceToSpacePerson` / `detachFaceFromSpacePerson` describes, using the file's `factory.auth()` and `makeMemberResult()` idioms:

```ts
// F-24
it('logs a person_face_assign activity attributed to the editor', async () => {
  // ...attach as Anna on Bob's asset...
  expect(mocks.sharedSpace.logActivity).toHaveBeenCalledWith(
    expect.objectContaining({
      type: SharedSpaceActivityType.PersonFaceAssign,
      userId: /* Anna */,
      data: expect.objectContaining({ count: 1 }),
    }),
    expect.anything(), // the transaction
  );
});

// F-25: the detach twin, type person_face_detach.

// F-26: Bob attaching on his OWN asset logs nothing.
it('logs nothing when the actor owns the asset', async () => {
  // ...attach as Bob on Bob's asset...
  expect(mocks.sharedSpace.logActivity).not.toHaveBeenCalled();
});
```

F-26 is the one that constrains the implementation — F-24 and F-25 both pass under an implementation that logs unconditionally.

- [ ] **Step 2: Run, confirm RED** — `cd server && pnpm test --run shared-space.service`.

- [ ] **Step 3: Implement.** Add the two enum members; call `logActivity(..., trx)` inside the existing transaction in both methods, skipping when the actor owns the asset. You already have the face's owner link available from `getFaceOwnerLink`; if it does not carry the asset owner, extend it rather than adding a second round-trip.

- [ ] **Step 4: Run, confirm GREEN.**

- [ ] **Step 5: Commit** (server only — i18n and web follow in Task 2, but the feed would render a raw key until then, so keep the two commits adjacent).

---

### Task 2: The feed rendering and the ten locales

**Files:**

- Modify: `web/src/lib/components/spaces/space-activity-feed.svelte`
- Modify: `i18n/en.json` + the nine maintained locales
- Test: `web/src/lib/components/spaces/space-activity-feed.spec.ts`

- [ ] **Step 1: Write the failing component tests**

Assert the two new types render their translated string, and that both sit in `MEDIUM_TYPES` (they are not high-impact like `asset_add` / `asset_remove`).

Per `feedback_web_test_assertions_that_cannot_fail`: assert presence with `getBy*`, absence with `expect(queryBy...).toBeNull()`. A bare `queryBy` passes either way.

Per `feedback_web_vitest_no_clearmocks`: this repo does not clear mocks between tests in a file — reset explicitly or state leaks into neighbours.

- [ ] **Step 2: Run, confirm RED** — `cd web && pnpm test --run space-activity-feed`.

- [ ] **Step 3: Add the keys to `i18n/en.json`**

```json
"spaces_activity_assigned_faces": "{name} named {count, plural, one {# face} other {# faces}}",
"spaces_activity_unassigned_faces": "{name} removed {count, plural, one {# face} other {# faces}}"
```

Insert alphabetically — they sit near the existing `spaces_activity_*` block.

- [ ] **Step 4: Translate into all nine maintained locales**

Read the neighbouring `spaces_activity_*` keys in each file first and match their register, terminology and plural forms. Russian and Polish need more than two plural categories — follow what the sibling keys in those files already do.

- [ ] **Step 5: Render them**

In `space-activity-feed.svelte`, add both types to `MEDIUM_TYPES` and add the two `case` arms to the label switch, following the existing `asset_edit` arm's shape.

- [ ] **Step 6: Run, confirm GREEN, and format**

```bash
npx prettier --write i18n/*.json
cd web && pnpm test --run space-activity-feed
cd web && pnpm check:typescript && pnpm check:svelte
```

- [ ] **Step 7: Full gate**

```bash
cd server && pnpm check && pnpm lint && npx prettier --check "src/**/*.ts" "test/**/*.ts"
cd server && pnpm test --run shared-space.service
cd server && pnpm test:medium --run shared-space-face-assign --maxWorkers=4
cd web && pnpm check:typescript && pnpm check:svelte && pnpm test --run space-activity-feed
npx prettier --check "i18n/*.json"
```

- [ ] **Step 8: Commit**

```bash
git add i18n/ web/src/lib/components/spaces/
git commit -m "feat(web): show face assignment in the space activity feed

Two new medium-impact activity types with their strings in all nine maintained
locales, matching each file's register -- de/it/es informal, fr/ru formal.

Covers F-24, F-25, F-26."
```

---

## Slice 7 Done When

- An editor's attach and detach each write one attributed activity row, inside the same transaction as the change.
- An owner acting on their own asset writes none (F-26).
- Both strings exist in `en` plus the nine maintained locales, alphabetically placed, prettier-clean.
- Web `check:typescript`, `check:svelte` and the feed spec all pass.
