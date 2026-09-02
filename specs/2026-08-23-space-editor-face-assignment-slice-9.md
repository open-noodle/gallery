# Space-Editor Face Assignment — Slice 9 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close the last functional gap (`isEditorDrawn` never reaches the client), then prove the whole feature end to end — including the half that must be refused.

**Architecture:** Slice 6 added `asset_face.createdBy` but Slice 3's response DTO predates it, so the client cannot tell which boxes it may delete and Slice 8 shipped no delete affordance. Task 1 surfaces the field and adds the UI. Task 2 is the API journey; Task 3 the browser proof.

**Tech Stack:** NestJS 11, Svelte 5, Vitest (e2e API), Playwright (web).

**Spec:** `specs/2026-08-23-space-editor-face-assignment-design.md` — §6.1, §6.6, §9.9

**Baseline (Slices 1–8 + wiring, all pushed and green):** six endpoints, SDK regenerated, People-row affordances wired to space-flavoured panels for editors and owner panels for owners.

## Global Constraints

- **No relative imports in `server/`** — use the `src/` path alias.
- **Do NOT touch** `server/src/utils/access.ts`, `person.controller.ts`, `face.controller.ts`.
- **Never put `--` before a vitest filter** — it discards the filter and runs everything.
- **`make open-api` is STALE in CLAUDE.md.** The repo uses `mise run open-api-typescript` and `mise run open-api-dart`. Regenerate after Task 1 changes the DTO. Fix that CLAUDE.md line as part of Task 1.
- **Do NOT run `make sql`** without a live database — it deletes every query file.
- **Web prettier must run from `web/`**, not the repo root: `web/.prettierrc`'s import-sort plugin only resolves from `web/node_modules`.
- **`check:svelte` must report ~618 files.** 0 files means it scanned nothing.
- **Guard check:** `git diff --name-only <base>..HEAD` where base is the commit immediately before your first — never `origin/main...HEAD`.

---

### Task 1: Surface `isEditorDrawn` and add the delete affordance

Slice 6 made editor-drawn boxes deletable server-side (`DELETE /shared-spaces/:id/faces/:assetFaceId`, gated on `createdBy IS NOT NULL`). But `SpaceAssetFaceResponseDto` exposes no such field — a stale comment in `shared-space-person.dto.ts` still says the column does not exist — so the client cannot tell which boxes are deletable and no UI offers it.

- [ ] **Step 1: Write the failing tests**

Server: extend the `getAssetFacesForSpace` medium tests — a face created with `createdBy` set reads back `isEditorDrawn: true`; a detected face reads `false`.

Web: `SpacePersonSidePanel` shows a delete control for a face with `isEditorDrawn: true` and **not** for one with `false`. Assert absence with `expect(queryBy...).toBeNull()`, never a bare `queryBy`.

- [ ] **Step 2: Run both, confirm RED.**

- [ ] **Step 3: Implement**

- Add `isEditorDrawn: boolean` to `SpaceAssetFaceResponseSchema`, derived server-side as `createdBy !== null`. **Expose the boolean, not `createdBy` itself** — who drew a box is not something every space member needs to know, and the client only needs the yes/no.
- Delete the stale comment in `shared-space-person.dto.ts` claiming `createdBy` does not exist.
- Select `createdBy` in `getAssetFacesForSpace` and map it.
- Add the delete control to `SpacePersonSidePanel`, calling `deleteSpaceAssetFace`.
- Add an `unassign`/`delete_face` i18n key if one is needed, in **en + all nine maintained locales** (`de fr it nl pl es ru zh_Hans zh_Hant`), alphabetically placed, then `npx prettier --write i18n/*.json`.

- [ ] **Step 4: Regenerate the clients** — `cd server && pnpm build`, then the `sync-open-api` mise task, then `mise run open-api-typescript` and `mise run open-api-dart`. Commit generated artefacts separately.

- [ ] **Step 5: Fix the stale `make open-api` line in `CLAUDE.md`** to name the mise tasks.

- [ ] **Step 6: Gate and commit.**

---

### Task 2: The API journey

**Files:** create `e2e/src/specs/server/api/space-editor-face-assign-journey.e2e-spec.ts`

Mirror `space-editor-asset-edit-journey.e2e-spec.ts` — its header comment, `buildSpaceContext()` fixture and `forEachActor` helper are the pattern.

The journey, as one narrative:

1. Anna (Editor) lists the faces on Bob's photo.
2. She names an unrecognised face — creating a space person.
3. She corrects a wrong match, moving a face to a different space person.
4. She draws a box and names it.
5. She deletes the box she drew.
6. Both activity rows appear in the space feed, attributed to her.

**Then the half that proves the line held** — each must be refused:

- Vic (Viewer) attempting any of the above → 4xx.
- Anna renaming Bob's **personal** person (`PUT /people/:id`) → still owner-only.
- Anna deleting a **detected** face → refused.
- Anna acting on a face whose asset is not in her space → refused.

The negative half is the point. A journey that only walks the happy path proves the feature works and says nothing about whether it is safe.

Use `forEachActor` with an explicit expected-status map per route, as the sibling journey does — `{ spaceOwner: 200, spaceEditor: 200, spaceViewer: 400, spaceNonMember: 400 }`.

**Watch for non-throwing access checks.** Some services use `checkAccess` rather than `requireAccess` and return 200 with an empty result instead of 4xx. Where that happens, assert on the **body**, not the status — a status-only check would pass even with the access filter removed. The sibling journey's `PUT /tags/assets` case documents this exact trap.

- [ ] Run: `cd e2e && pnpm test space-editor-face-assign` (the e2e script already includes `--run`; adding it again crashes).

---

### Task 3: The browser proof

**Files:** create `e2e/src/specs/web/spaces-editor-face-affordances.e2e-spec.ts`

Mirror `spaces-editor-asset-viewer-affordances.e2e-spec.ts`. Prove in a real browser that:

- On `/spaces/:id/...`, an editor viewing a member's photo sees the tag-people affordance and clicking it opens the **space** panel.
- On the main timeline, the same photo shows no such affordance.
- A viewer sees none.

This exists because the wiring gap Slice 8 left — affordance visible, wrong panel behind it — is invisible to component tests that stub the panels. Only a real click-through catches it.

- [ ] Run via `make e2e-web-dev` against a running dev stack, or the Playwright project the sibling spec uses.

---

### Task 4: Final full-repo gate

```bash
cd server && pnpm check && pnpm lint && npx prettier --check "src/**/*.ts" "test/**/*.ts"
cd server && pnpm test --run shared-space
cd server && pnpm test:medium --run shared-space-face-assign --maxWorkers=4
cd server && pnpm test:medium --run schema-drift
cd web && pnpm check:typescript && pnpm check:svelte && pnpm test --run
cd web && npx prettier --check "src/**/*.{ts,svelte}"
npx prettier --check "i18n/*.json"
```

Report any failure rather than working around it.

---

## Slice 9 Done When

- `isEditorDrawn` reaches the client and gates a working delete control.
- The API journey passes, including every refusal.
- The Playwright spec proves the affordance opens the space panel on a space surface and is absent elsewhere.
- The full gate above is green.
- `CLAUDE.md`'s `make open-api` line names the real mise tasks.
