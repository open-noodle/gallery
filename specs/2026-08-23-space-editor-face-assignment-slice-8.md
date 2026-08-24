# Space-Editor Face Assignment — Slice 8 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** On a space surface, an Owner/Editor viewing a member's photo gets the people affordances — name an unrecognised face, correct a wrong one, draw a box — wired to the space endpoints. Everywhere else, and for viewers, the People row stays exactly as it is today.

**Architecture:** `DetailPanelPeople` gains a `canEditSpacePeople` prop **alongside** `isOwner`, never replacing it. When it wins, the affordances route to space-flavoured panels that call the Slice 1–6 endpoints. The owner path is untouched: an owner still edits their own people through the existing owner components.

**Tech Stack:** Svelte 5 (runes), `@immich/sdk`, Vitest + @testing-library/svelte (happy-dom).

**Spec:** `specs/2026-08-23-space-editor-face-assignment-design.md` — §7, §9.8

**Baseline (Slices 1–7, committed and pushed):** all five endpoints exist server-side —

| Endpoint                                                        | Purpose            |
| --------------------------------------------------------------- | ------------------ |
| `GET /shared-spaces/:id/assets/:assetId/faces`                  | list faces         |
| `POST /shared-spaces/:id/people`                                | create person      |
| `PUT /shared-spaces/:id/people/:personId/faces/:assetFaceId`    | attach / reassign  |
| `DELETE /shared-spaces/:id/people/:personId/faces/:assetFaceId` | detach             |
| `POST /shared-spaces/:id/assets/:assetId/faces`                 | draw a box         |
| `DELETE /shared-spaces/:id/faces/:assetFaceId`                  | delete a drawn box |

## Global Constraints

- **The SDK is not regenerated yet.** OpenAPI + SDK + Dart regeneration is Slice 9. Until then `@immich/sdk` has no functions for these endpoints. **Do the regeneration FIRST in this slice** (see Task 0) — the web code cannot be written against a client that does not exist, and hand-writing fetch calls would be thrown away.
- **Never put `--` before a vitest filter.** Use `cd web && pnpm test --run <substring>`.
- **Web gates:** `cd web && pnpm check:typescript && pnpm check:svelte`. `check:svelte` must report a real file count — if it scans 0 files it is a no-op and proves nothing.
- **This repo does NOT clear mocks between tests in a file.** Reset SDK mocks explicitly or state leaks into neighbours.
- **Assert presence with `getBy*`, absence with `expect(queryBy...).toBeNull()`.** A bare `queryBy` passes either way and would make F-28/F-29 — the security half — vacuous.
- **Do NOT touch** `server/src/utils/access.ts`, `person.controller.ts`, `face.controller.ts`.
- **Guard check:** `git diff --name-only <slice-8-base-sha>..HEAD` where the base is the commit immediately before your first commit. Do NOT use `origin/main...HEAD` — this branch already contains #992.

---

### Task 0: Regenerate the API clients

Do this before any web code.

- [ ] **Step 1:** `cd server && pnpm build`
- [ ] **Step 2:** `cd server && pnpm sync:open-api`
- [ ] **Step 3:** `make open-api` from the repo root (generates both the TypeScript SDK and the Dart client; Dart needs Java)
- [ ] **Step 4:** `cd server && pnpm check` and `cd web && pnpm check:typescript` — both must stay green.
- [ ] **Step 5:** Confirm the generated SDK exports functions for all six endpoints above. If any is missing, the endpoint's decorator or DTO is wrong — fix the server, do not hand-write a client.
- [ ] **Step 6:** Commit the generated artefacts on their own.

```bash
git add open-api/ packages/sdk/ mobile/openapi/
git commit -m "chore(api): regenerate clients for the space face-assignment endpoints"
```

The mobile Dart client changes only as a side effect of regeneration — mobile is out of scope (spec §4.3) and no Dart code should be written.

---

### Task 1: Thread the capability

**Files:**

- Modify: `web/src/lib/components/asset-viewer/DetailPanel.svelte:246`
- Modify: `web/src/lib/components/asset-viewer/DetailPanelPeople.svelte` — props at `:25-35`, affordance block at `:141-192`
- Test: `web/src/lib/components/asset-viewer/DetailPanelPeople.spec.ts`

**Interfaces:**

- Produces: `DetailPanelPeople` prop `canEditSpacePeople?: boolean` (default `false`)

**The rule:** `canEditSpacePeople` is true iff `spaceId` is present **and** the viewer is Owner/Editor of that space **and** `!isOwner`.

**Do not widen `isOwner`.** It stays the real ownership flag so the owner path keeps rendering the owner's own people through the owner components. This mirrors what #734 did for `DetailPanelTags`' `canEdit` — a sibling prop, not a redefinition. The two affordance sets are different code paths that happen to look similar.

- [ ] **Step 1: Write the failing component tests**

```ts
// F-27: editor on a space surface, member's photo -> affordances visible
it("shows the tag-people affordance to a space editor", () => {
  // render with { isOwner: false, canEditSpacePeople: true, spaceId: 'space-1' }
  expect(getByLabelText("tag_people")).toBeInTheDocument();
});

// F-28: same editor, but NOT on a space surface -> read-only
it("hides the affordances when there is no space context", () => {
  // render with { isOwner: false, canEditSpacePeople: false, spaceId: undefined }
  expect(queryByLabelText("tag_people")).toBeNull();
});

// F-29: viewer on a space surface -> read-only
it("hides the affordances from a space viewer", () => {
  // render with { isOwner: false, canEditSpacePeople: false, spaceId: 'space-1' }
  expect(queryByLabelText("tag_people")).toBeNull();
});

// F-30: the owner path is unchanged
it("still shows the owner their own affordances", () => {
  // render with { isOwner: true, canEditSpacePeople: false }
  expect(getByLabelText("tag_people")).toBeInTheDocument();
});
```

F-28 and F-29 are the security half. Written with `queryBy` + `.toBeNull()`, never a bare `queryBy`.

- [ ] **Step 2:** Run `cd web && pnpm test --run DetailPanelPeople`, confirm RED.

- [ ] **Step 3:** Add the prop, thread it from `DetailPanel.svelte:246`, and change the affordance guard at `:157` from `{#if isOwner}` to `{#if isOwner || canEditSpacePeople}`.

The hidden-people toggle inside that block stays on `isOwner` alone — a space editor has no business toggling the owner's hidden people, and the server would refuse it.

- [ ] **Step 4:** Run, confirm GREEN. Commit.

---

### Task 2: The space-flavoured panels

**Files:**

- Create: `web/src/lib/components/asset-viewer/SpacePersonSidePanel.svelte`
- Create: `web/src/lib/components/asset-viewer/face-editor/SpaceFaceEditor.svelte`
- Test: specs beside each

The owner path uses `PersonSidePanel.svelte` (391 lines, calls `reassignFacesById` / `createPerson` / `deleteFace`) and `face-editor/FaceEditor.svelte` (429 lines, calls `createFace`). Both are owner-shaped down to their SDK calls.

**Extract the shared presentation rather than copying it.** Crop rendering, drag geometry and the people-search list are identical; only the API calls and the gating differ. Two copies of the drag geometry will drift and silently misplace boxes.

- [ ] **Step 1: Write failing specs** covering: listing faces from `GET .../assets/:assetId/faces`; attaching an existing space person; creating a person from a face; detaching; drawing a box; and F-31 — when the faces request rejects, the panel shows an error state and offers **no** affordance rather than guessing one.

- [ ] **Step 2:** Run, confirm RED, implement, confirm GREEN.

- [ ] **Step 3: Full gate**

```bash
cd web && pnpm check:typescript && pnpm check:svelte
cd web && pnpm test --run DetailPanelPeople
cd web && pnpm test --run SpacePersonSidePanel
cd web && pnpm test --run SpaceFaceEditor
cd server && pnpm check
npx prettier --check "web/src/**/*.{ts,svelte}"
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(web): let a space editor name faces from the asset viewer

Space-flavoured siblings of PersonSidePanel and FaceEditor, wired to the
shared-space face endpoints. isOwner is untouched -- canEditSpacePeople is a
sibling prop, so the owner path keeps rendering the owner's own people.

Covers F-27, F-28, F-29, F-30, F-31."
```

---

## Slice 8 Done When

- The API clients are regenerated and committed, and both `pnpm check`s are green.
- A space editor sees the affordances on `/spaces/:id/...`; nobody sees them on the timeline; a viewer never sees them; the owner path is unchanged.
- F-27…F-31 pass, with absence asserted via `expect(queryBy...).toBeNull()`.
- `check:svelte` reports a real file count, not 0.
