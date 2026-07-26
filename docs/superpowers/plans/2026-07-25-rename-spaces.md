# Rename / Edit Spaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let space owners **and editors** rename a shared space (plus edit its description and color) from the web app.

**Architecture:** The server endpoint `PATCH /shared-spaces/:id` already exists and already logs renames to the activity feed — only its RBAC gate changes, from "all metadata is owner-only" to "only the processing settings are owner-only". On the web, a new `updateSpaceDetails` service function wraps the SDK call (toast + error handling), a new `SpaceEditModal` collects the three fields, and two entry points open it: the space header's ⋮ overflow menu and the hero's ✎ menu.

**Tech Stack:** NestJS 11 + Kysely + Zod (server), SvelteKit + Svelte 5 runes + `@immich/ui` (web), Vitest everywhere, supertest for e2e API.

**Spec:** `docs/superpowers/specs/2026-07-25-rename-spaces-design.md`

## Global Constraints

- **Do not touch** the DTO, controller, permissions, migrations, or the OpenAPI/SDK. This feature needs none of them.
- `faceRecognitionEnabled` and `petsEnabled` **stay owner-only**. Never fold them into the editor-permitted set.
- No relative imports in `server/` — use the `src/` path alias.
- New i18n keys go in `i18n/en.json` **only** (web and mobile share one `i18n/` directory; other locales are handled separately). Keys are **alphabetically sorted** — insert at the right position.
- Prettier: 120-char lines, single quotes, trailing commas, semicolons.
- Mobile is out of scope. Do not modify anything under `mobile/`.
- **Never** add `Co-Authored-By` or `Generated-with` trailers to commits.

## Environment Prerequisites (do this once, before Task 1)

This worktree needs three workspace packages built or **every server spec dies at collection** with `Failed to resolve entry for package "@immich/plugin-sdk"`:

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
pnpm install --frozen-lockfile
pnpm --filter @immich/sdk build
pnpm --filter @immich/plugin-sdk build
pnpm --filter @immich/plugin-core build
```

**Test invocation traps — use these exact forms:**

| Package | Correct command                                                       |
| ------- | --------------------------------------------------------------------- |
| server  | `cd server && pnpm vitest --config test/vitest.config.mjs run <path>` |
| web     | `cd web && pnpm vitest run <path>`                                    |

The server's vitest config lives at `test/vitest.config.mjs`, **not** the package root. Running plain `pnpm vitest run <path>` from `server/` starts vitest with no config, disabling `globals`, and every spec fails with `ReferenceError: describe is not defined` — that error means a missing `--config` flag, not a broken test. Also note `pnpm test -- --run <path>` silently **drops** the path filter and runs the whole suite.

## File Structure

| File                                                           | Responsibility                                                                 | Task |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---- |
| `server/src/services/shared-space.service.ts`                  | Modify `update()` RBAC gate (lines 275-281)                                    | 1    |
| `server/src/services/shared-space.service.spec.ts`             | Invert 3 tests, retitle 1, add editor-allow + settings-deny + no-partial-write | 1    |
| `server/src/dtos/shared-space.dto.spec.ts`                     | Add `SharedSpaceUpdateDto` validation-bound tests                              | 2    |
| `e2e/src/specs/server/api/spaces-update.e2e-spec.ts`           | **Create** — full 4-actor × 3-field-group RBAC matrix                          | 3    |
| `i18n/en.json`                                                 | 3 new keys                                                                     | 4    |
| `web/src/lib/services/space.service.ts`                        | Add `updateSpaceDetails`                                                       | 4    |
| `web/src/lib/services/space.service.spec.ts`                   | Test `updateSpaceDetails`                                                      | 4    |
| `web/src/lib/modals/SpaceEditModal.svelte`                     | **Create** — the edit form                                                     | 5    |
| `web/src/lib/modals/SpaceEditModal.spec.ts`                    | **Create** — modal behaviour                                                   | 5    |
| `web/src/routes/(user)/spaces/[spaceId]/+layout.svelte`        | ⋮ menu entry + handler                                                         | 6    |
| `web/src/routes/(user)/spaces/[spaceId]/space-layout.spec.ts`  | ⋮ entry role-gating tests                                                      | 6    |
| `web/src/lib/components/spaces/space-hero.svelte`              | ✎ menu entry + gate restructure                                                | 7    |
| `web/src/lib/components/spaces/space-hero.test-wrapper.svelte` | Forward new `onEditSpace` prop                                                 | 7    |
| `web/src/lib/components/spaces/space-hero.spec.ts`             | Rename testid, invert no-cover test, add new                                   | 7    |

---

### Task 1: Server — split the RBAC bucket

**Files:**

- Modify: `server/src/services/shared-space.service.ts:275-281`
- Test: `server/src/services/shared-space.service.spec.ts` (in `describe('update', …)`, which starts at line 1015)

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: the runtime rule every later task depends on — `PATCH /shared-spaces/:id` requires `Owner` if and only if the DTO contains `faceRecognitionEnabled` or `petsEnabled`; otherwise `Editor`.

**Background:** `update()` currently computes `isMetadataUpdate` over five fields and demands `Owner` for all of them. Naming and appearance move to `Editor`; the cover fields were already `Editor`. That leaves only the two settings fields on `Owner`, so the condition inverts and collapses to a single check.

- [ ] **Step 1: Invert the three editor-denial tests**

In `server/src/services/shared-space.service.spec.ts`, **replace** the test at line 1141 (`should not allow editor to update name`), the one at line 1151 (`should not allow editor to update description`), and the one at line 1188 (`should not allow editor to update color`) with these three. Each becomes a positive assertion that also checks the payload — a test that only asserted "does not throw" would still pass if the update silently wrote nothing.

```ts
it('should allow editor to update name', async () => {
  const auth = factory.auth();
  const space = factory.sharedSpace();
  const member = makeMemberResult({ spaceId: space.id, userId: auth.user.id, role: SharedSpaceRole.Editor });
  const updatedSpace = { ...space, name: 'New Name' };

  mocks.sharedSpace.getMember.mockResolvedValue(member);
  mocks.sharedSpace.getById.mockResolvedValue(space);
  mocks.sharedSpace.update.mockResolvedValue(updatedSpace);
  mocks.sharedSpace.logActivity.mockResolvedValue(void 0);

  const result = await sut.update(auth, space.id, { name: 'New Name' });

  expect(result.name).toBe('New Name');
  expect(mocks.sharedSpace.update).toHaveBeenCalledWith(space.id, { name: 'New Name' });
});

it('should allow editor to update description', async () => {
  const auth = factory.auth();
  const space = factory.sharedSpace();
  const member = makeMemberResult({ spaceId: space.id, userId: auth.user.id, role: SharedSpaceRole.Editor });
  const updatedSpace = { ...space, description: 'New Description' };

  mocks.sharedSpace.getMember.mockResolvedValue(member);
  mocks.sharedSpace.getById.mockResolvedValue(space);
  mocks.sharedSpace.update.mockResolvedValue(updatedSpace);
  mocks.sharedSpace.logActivity.mockResolvedValue(void 0);

  const result = await sut.update(auth, space.id, { description: 'New Description' });

  expect(result.description).toBe('New Description');
  expect(mocks.sharedSpace.update).toHaveBeenCalledWith(space.id, { description: 'New Description' });
});

it('should allow editor to update color', async () => {
  const auth = factory.auth();
  const space = factory.sharedSpace();
  const member = makeMemberResult({ spaceId: space.id, userId: auth.user.id, role: SharedSpaceRole.Editor });
  const updatedSpace = { ...space, color: 'blue' };

  mocks.sharedSpace.getMember.mockResolvedValue(member);
  mocks.sharedSpace.getById.mockResolvedValue(space);
  mocks.sharedSpace.update.mockResolvedValue(updatedSpace);
  mocks.sharedSpace.logActivity.mockResolvedValue(void 0);

  const result = await sut.update(auth, space.id, { color: UserAvatarColor.Blue });

  expect(result.color).toBe('blue');
  expect(mocks.sharedSpace.update).toHaveBeenCalledWith(space.id, { color: UserAvatarColor.Blue });
});
```

**Note on the payload assertion:** the two pre-existing owner tests (lines 1045 and ~1176) assert `toHaveBeenCalledWith(space.id, { name: …, description: undefined, thumbnailAssetId: undefined, … })` — every key present, most `undefined`. That does not match the current implementation, which builds `updatePayload` with **only defined keys** (`shared-space.service.ts:299-320`). Those assertions pass anyway because Vitest's `toHaveBeenCalledWith` treats an explicit `undefined` value and an absent key as equal. Your three new tests assert the tighter, literally-correct shape. **Do not "fix" the existing owner tests to match** — they are out of scope and currently green.

- [ ] **Step 2: Retitle the misleading viewer test**

The test at line 1200 is titled `should treat color update as metadata change (owner-only)` but its body uses a **Viewer**. Its assertion stays correct; only the title is now a lie. Change the title line to:

```ts
    it('should not allow viewer to update color', async () => {
```

- [ ] **Step 3: Add the settings-deny and no-partial-write tests**

Add these four tests inside the same `describe('update', …)` block, after the tests you just changed:

```ts
it('should not allow editor to update faceRecognitionEnabled', async () => {
  const auth = factory.auth();
  const space = factory.sharedSpace();
  const member = makeMemberResult({ spaceId: space.id, userId: auth.user.id, role: SharedSpaceRole.Editor });

  mocks.sharedSpace.getMember.mockResolvedValue(member);

  await expect(sut.update(auth, space.id, { faceRecognitionEnabled: true })).rejects.toBeInstanceOf(ForbiddenException);
  expect(mocks.sharedSpace.update).not.toHaveBeenCalled();
  expect(mocks.job.queue).not.toHaveBeenCalled();
});

it('should not allow editor to update petsEnabled', async () => {
  const auth = factory.auth();
  const space = factory.sharedSpace();
  const member = makeMemberResult({ spaceId: space.id, userId: auth.user.id, role: SharedSpaceRole.Editor });

  mocks.sharedSpace.getMember.mockResolvedValue(member);

  await expect(sut.update(auth, space.id, { petsEnabled: true })).rejects.toBeInstanceOf(ForbiddenException);
  expect(mocks.sharedSpace.update).not.toHaveBeenCalled();
});

it('should reject an editor mixing naming and settings fields without writing anything', async () => {
  const auth = factory.auth();
  const space = factory.sharedSpace();
  const member = makeMemberResult({ spaceId: space.id, userId: auth.user.id, role: SharedSpaceRole.Editor });

  mocks.sharedSpace.getMember.mockResolvedValue(member);

  // The role check runs against the WHOLE dto before any write, so the permitted
  // `name` must NOT sneak through alongside the forbidden `petsEnabled`.
  await expect(sut.update(auth, space.id, { name: 'Sneaky', petsEnabled: true })).rejects.toBeInstanceOf(
    ForbiddenException,
  );
  expect(mocks.sharedSpace.update).not.toHaveBeenCalled();
  expect(mocks.sharedSpace.logActivity).not.toHaveBeenCalled();
});

it('should not allow a viewer to update name', async () => {
  const auth = factory.auth();
  const space = factory.sharedSpace();
  const member = makeMemberResult({ spaceId: space.id, userId: auth.user.id, role: SharedSpaceRole.Viewer });

  mocks.sharedSpace.getMember.mockResolvedValue(member);

  await expect(sut.update(auth, space.id, { name: 'Nope' })).rejects.toBeInstanceOf(ForbiddenException);
  expect(mocks.sharedSpace.update).not.toHaveBeenCalled();
});

it('should attribute an editor rename to the editor in the activity feed', async () => {
  // The feed renders "<user> renamed the space" from this userId. Every existing
  // space_rename activity test uses an Owner, so editor attribution is a newly
  // reachable path with no coverage — an editor's rename must not be logged as
  // the owner's.
  const auth = factory.auth();
  const space = factory.sharedSpace({ name: 'Old Name' });
  const member = makeMemberResult({ spaceId: space.id, userId: auth.user.id, role: SharedSpaceRole.Editor });

  mocks.sharedSpace.getMember.mockResolvedValue(member);
  mocks.sharedSpace.getById.mockResolvedValue(space);
  mocks.sharedSpace.update.mockResolvedValue({ ...space, name: 'New Name' });
  mocks.sharedSpace.logActivity.mockResolvedValue(void 0);

  await sut.update(auth, space.id, { name: 'New Name' });

  expect(mocks.sharedSpace.logActivity).toHaveBeenCalledWith({
    spaceId: space.id,
    userId: auth.user.id,
    type: SharedSpaceActivityType.SpaceRename,
    data: { oldName: 'Old Name', newName: 'New Name' },
  });
});
```

**Activity logging is otherwise already covered** — `should log space_rename when name changes` (line 1281), `should log space_color_change when color changes` (line 1299), and the "no activity when nothing changed" case (line ~1341) all exist and use an Owner. Do not duplicate them; just keep them green.

- [ ] **Step 4: Run the tests to verify they fail**

```bash
cd server && pnpm vitest --config test/vitest.config.mjs run src/services/shared-space.service.spec.ts
```

Expected: **four** tests FAIL — the three inverted ones plus `should attribute an editor rename to the editor in the activity feed`, all with `ForbiddenException` being thrown. The new `faceRecognitionEnabled` / `petsEnabled` / mixed-payload / viewer tests PASS already, because they encode behaviour that exists today. That is fine — the four failures are the ones driving the change.

- [ ] **Step 5: Implement the RBAC split**

In `server/src/services/shared-space.service.ts`, replace lines 275-281:

```ts
const isMetadataUpdate =
  dto.name !== undefined ||
  dto.description !== undefined ||
  dto.color !== undefined ||
  dto.faceRecognitionEnabled !== undefined ||
  dto.petsEnabled !== undefined;
const minimumRole = isMetadataUpdate ? SharedSpaceRole.Owner : SharedSpaceRole.Editor;
```

with:

```ts
// Space-wide processing settings stay owner-only: faceRecognitionEnabled gates ML work and
// the People tab for every member (and queues a full re-match when switched on), petsEnabled
// changes the whole space's people list. Naming/appearance (name, description, color) and the
// cover are editor-level. The check runs against the WHOLE dto before any write, so a mixed
// payload from an editor is rejected outright rather than partially applied.
const isOwnerOnlySettingsUpdate = dto.faceRecognitionEnabled !== undefined || dto.petsEnabled !== undefined;
const minimumRole = isOwnerOnlySettingsUpdate ? SharedSpaceRole.Owner : SharedSpaceRole.Editor;
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd server && pnpm vitest --config test/vitest.config.mjs run src/services/shared-space.service.spec.ts
```

Expected: PASS, with a higher test count than the 516 baseline.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/shared-space.service.ts server/src/services/shared-space.service.spec.ts
git commit -m "feat(spaces): let editors rename a space, keep processing settings owner-only"
```

---

### Task 2: Server — DTO validation bounds

**Files:**

- Test: `server/src/dtos/shared-space.dto.spec.ts`

**Interfaces:**

- Consumes: `SharedSpaceUpdateDto` from `src/dtos/shared-space.dto` (already exported, unchanged).
- Produces: nothing consumed by later tasks. This task locks the validation bounds the web modal's `maxlength` values mirror.

**Background:** `SharedSpaceUpdateSchema` bounds `name` with `.trim().min(1).max(100)` and `description` with `.max(500)`. Nothing tests those bounds today. No production code changes in this task — these are characterization tests that pin the contract the client caps are derived from.

- [ ] **Step 1: Write the failing tests**

Append to `server/src/dtos/shared-space.dto.spec.ts`. Match the existing import style at the top of that file — if `SharedSpaceUpdateDto` is not already imported, add it to the existing import from `src/dtos/shared-space.dto`.

```ts
describe('SharedSpaceUpdateDto', () => {
  it('should accept a rename', () => {
    const result = SharedSpaceUpdateDto.schema.safeParse({ name: 'Family & Friends' });
    expect(result.success).toBe(true);
  });

  it('should trim surrounding whitespace from the name', () => {
    const result = SharedSpaceUpdateDto.schema.safeParse({ name: '  Padded  ' });
    expect(result.success).toBe(true);
    expect(result.data?.name).toBe('Padded');
  });

  it('should reject a whitespace-only name', () => {
    // .trim() runs before .min(1), so "   " collapses to "" and fails the minimum.
    const result = SharedSpaceUpdateDto.schema.safeParse({ name: '   ' });
    expect(result.success).toBe(false);
  });

  it('should reject an empty name', () => {
    const result = SharedSpaceUpdateDto.schema.safeParse({ name: '' });
    expect(result.success).toBe(false);
  });

  it('should accept a name at exactly 100 characters', () => {
    const result = SharedSpaceUpdateDto.schema.safeParse({ name: 'a'.repeat(100) });
    expect(result.success).toBe(true);
  });

  it('should reject a name over 100 characters', () => {
    const result = SharedSpaceUpdateDto.schema.safeParse({ name: 'a'.repeat(101) });
    expect(result.success).toBe(false);
  });

  it('should accept an empty description, which clears the field', () => {
    const result = SharedSpaceUpdateDto.schema.safeParse({ description: '' });
    expect(result.success).toBe(true);
    expect(result.data?.description).toBe('');
  });

  it('should accept a description at exactly 500 characters', () => {
    const result = SharedSpaceUpdateDto.schema.safeParse({ description: 'a'.repeat(500) });
    expect(result.success).toBe(true);
  });

  it('should reject a description over 500 characters', () => {
    const result = SharedSpaceUpdateDto.schema.safeParse({ description: 'a'.repeat(501) });
    expect(result.success).toBe(false);
  });

  it('should accept an empty object, since every field is optional', () => {
    const result = SharedSpaceUpdateDto.schema.safeParse({});
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
cd server && pnpm vitest --config test/vitest.config.mjs run src/dtos/shared-space.dto.spec.ts
```

Expected: PASS immediately — this is characterization coverage of behaviour that already exists, not a driver for new code. **Never edit the schema to make one of these pass.** If one fails, sort it into one of two buckets:

- **A rejection test fails** (whitespace-only, empty, or over-length is _accepted_). That contradicts the spec and undermines the modal's guard rationale — **stop and report**, do not proceed to later tasks.
- **Only the trimmed-value assertion fails** (`result.data?.name` is `'  Padded  '` rather than `'Padded'`, i.e. Zod applies `.trim()` differently than assumed). That is a cosmetic detail, not a contract break — correct the test to match observed behaviour, leave a comment noting it, and continue.

- [ ] **Step 3: Commit**

```bash
git add server/src/dtos/shared-space.dto.spec.ts
git commit -m "test(spaces): pin SharedSpaceUpdateDto name and description bounds"
```

---

### Task 3: e2e — the full RBAC matrix

**Files:**

- Create: `e2e/src/specs/server/api/spaces-update.e2e-spec.ts`

**Interfaces:**

- Consumes: the Task 1 runtime rule; `buildSpaceContext`, `forEachActor`, `authHeaders`, `type SpaceContext` from `src/actors`.
- Produces: nothing consumed by later tasks.

**Background:** `buildSpaceContext()` provisions admin + owner + editor + viewer + non-member, a space owned by `spaceOwner`, and three assets — including `spaceAssetId`, which is already **in** the space (needed for the cover-field arm, since the service rejects a thumbnail asset that does not belong to the space). `forEachActor` runs one HTTP call per actor and throws an error naming the actor that got the wrong status, which `expect` would not.

Note the anon actor is `{ id: 'anon' }` with no token, and expects **401** rather than 403.

- [ ] **Step 1: Write the failing spec**

Create `e2e/src/specs/server/api/spaces-update.e2e-spec.ts`:

```ts
/**
 * RBAC matrix for PATCH /shared-spaces/:id.
 *
 * The endpoint splits its DTO into three field groups with two different role floors
 * (shared-space.service.ts, `update`):
 *
 *   naming     — name, description, color            → Editor
 *   cover      — thumbnailAssetId, thumbnailCropY    → Editor
 *   settings   — faceRecognitionEnabled, petsEnabled → Owner
 *
 * The role check runs against the WHOLE dto before any write, so a mixed payload is
 * rejected outright — never partially applied. That last property is the one most
 * likely to regress silently if the gate is ever refactored per-field, so it gets a
 * dedicated read-back assertion.
 */

import { authHeaders, buildSpaceContext, forEachActor, type SpaceContext } from 'src/actors';
import { app, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

describe('PATCH /shared-spaces/:id — rename and edit RBAC', () => {
  let ctx: SpaceContext;
  const anon = { id: 'anon' as const };

  beforeAll(async () => {
    await utils.resetDatabase();
    ctx = await buildSpaceContext();
  });

  describe('naming fields (name, description, color) — Editor floor', () => {
    it('owner and editor may rename; viewer, non-member and anon may not', async () => {
      await forEachActor(
        [ctx.spaceOwner, ctx.spaceEditor, ctx.spaceViewer, ctx.spaceNonMember, anon],
        (actor) =>
          request(app).put(`/shared-spaces/${ctx.spaceId}`).set(authHeaders(actor)).send({ name: 'Renamed Space' }),
        { spaceOwner: 200, spaceEditor: 200, spaceViewer: 403, spaceNonMember: 403, anon: 401 },
      );
    });

    it('owner and editor may edit the description', async () => {
      await forEachActor(
        [ctx.spaceOwner, ctx.spaceEditor, ctx.spaceViewer, ctx.spaceNonMember, anon],
        (actor) =>
          request(app).put(`/shared-spaces/${ctx.spaceId}`).set(authHeaders(actor)).send({ description: 'Edited' }),
        { spaceOwner: 200, spaceEditor: 200, spaceViewer: 403, spaceNonMember: 403, anon: 401 },
      );
    });

    it('owner and editor may edit the color', async () => {
      await forEachActor(
        [ctx.spaceOwner, ctx.spaceEditor, ctx.spaceViewer, ctx.spaceNonMember, anon],
        (actor) => request(app).put(`/shared-spaces/${ctx.spaceId}`).set(authHeaders(actor)).send({ color: 'blue' }),
        { spaceOwner: 200, spaceEditor: 200, spaceViewer: 403, spaceNonMember: 403, anon: 401 },
      );
    });

    it('an editor rename actually persists', async () => {
      const { status, body } = await request(app)
        .put(`/shared-spaces/${ctx.spaceId}`)
        .set(authHeaders(ctx.spaceEditor))
        .send({ name: 'Editor Renamed This' });

      expect(status).toBe(200);
      expect((body as { name: string }).name).toBe('Editor Renamed This');

      const readBack = await request(app).get(`/shared-spaces/${ctx.spaceId}`).set(authHeaders(ctx.spaceOwner));
      expect((readBack.body as { name: string }).name).toBe('Editor Renamed This');
    });

    it('an editor can clear the description with an empty string', async () => {
      await request(app)
        .put(`/shared-spaces/${ctx.spaceId}`)
        .set(authHeaders(ctx.spaceEditor))
        .send({ description: 'Temporary' });

      const { status, body } = await request(app)
        .put(`/shared-spaces/${ctx.spaceId}`)
        .set(authHeaders(ctx.spaceEditor))
        .send({ description: '' });

      expect(status).toBe(200);
      expect((body as { description: string | null }).description).toBe('');
    });
  });

  describe('cover fields (thumbnailAssetId) — Editor floor, unchanged', () => {
    it('owner and editor may set the cover; viewer, non-member and anon may not', async () => {
      await forEachActor(
        [ctx.spaceOwner, ctx.spaceEditor, ctx.spaceViewer, ctx.spaceNonMember, anon],
        (actor) =>
          request(app)
            .put(`/shared-spaces/${ctx.spaceId}`)
            .set(authHeaders(actor))
            .send({ thumbnailAssetId: ctx.spaceAssetId }),
        { spaceOwner: 200, spaceEditor: 200, spaceViewer: 403, spaceNonMember: 403, anon: 401 },
      );
    });
  });

  describe('settings fields (faceRecognitionEnabled, petsEnabled) — Owner floor', () => {
    it('only the owner may toggle faceRecognitionEnabled', async () => {
      await forEachActor(
        [ctx.spaceOwner, ctx.spaceEditor, ctx.spaceViewer, ctx.spaceNonMember, anon],
        (actor) =>
          request(app)
            .put(`/shared-spaces/${ctx.spaceId}`)
            .set(authHeaders(actor))
            .send({ faceRecognitionEnabled: true }),
        { spaceOwner: 200, spaceEditor: 403, spaceViewer: 403, spaceNonMember: 403, anon: 401 },
      );
    });

    it('only the owner may toggle petsEnabled', async () => {
      await forEachActor(
        [ctx.spaceOwner, ctx.spaceEditor, ctx.spaceViewer, ctx.spaceNonMember, anon],
        (actor) =>
          request(app).put(`/shared-spaces/${ctx.spaceId}`).set(authHeaders(actor)).send({ petsEnabled: true }),
        { spaceOwner: 200, spaceEditor: 403, spaceViewer: 403, spaceNonMember: 403, anon: 401 },
      );
    });
  });

  describe('mixed payloads', () => {
    it('rejects an editor mixing a permitted name with a forbidden setting, and writes neither', async () => {
      const before = await request(app).get(`/shared-spaces/${ctx.spaceId}`).set(authHeaders(ctx.spaceOwner));
      const nameBefore = (before.body as { name: string }).name;

      const { status } = await request(app)
        .put(`/shared-spaces/${ctx.spaceId}`)
        .set(authHeaders(ctx.spaceEditor))
        .send({ name: 'Should Not Persist', petsEnabled: true });

      expect(status).toBe(403);

      const after = await request(app).get(`/shared-spaces/${ctx.spaceId}`).set(authHeaders(ctx.spaceOwner));
      expect((after.body as { name: string }).name).toBe(nameBefore);
    });
  });

  describe('validation', () => {
    it('rejects a whitespace-only name with 400', async () => {
      const { status } = await request(app)
        .put(`/shared-spaces/${ctx.spaceId}`)
        .set(authHeaders(ctx.spaceEditor))
        .send({ name: '   ' });

      expect(status).toBe(400);
    });

    it('rejects a name over 100 characters with 400', async () => {
      const { status } = await request(app)
        .put(`/shared-spaces/${ctx.spaceId}`)
        .set(authHeaders(ctx.spaceEditor))
        .send({ name: 'a'.repeat(101) });

      expect(status).toBe(400);
    });
  });
});
```

- [ ] **Step 2: Run the spec**

The e2e API suite needs the e2e stack running. **Warning:** the `immich-e2e` Docker project and the `immich-server:latest` image are machine-wide singletons shared with any other session — starting or resetting the stack can disrupt another session's run.

```bash
make e2e-api-dev   # against an already-running `make dev` stack
```

or run the file directly against a running stack:

```bash
cd e2e && pnpm vitest run src/specs/server/api/spaces-update.e2e-spec.ts
```

Expected: PASS, because Task 1 already shipped the rule. If Task 1 were reverted, the naming arms would fail with `spaceEditor` getting 403 instead of 200.

If you cannot start the stack, **say so explicitly** in your report rather than marking this task done — an unrun e2e spec is not a passing one.

- [ ] **Step 3: Commit**

```bash
git add e2e/src/specs/server/api/spaces-update.e2e-spec.ts
git commit -m "test(e2e): RBAC matrix for PATCH /shared-spaces/:id"
```

---

### Task 4: Web — i18n keys and the `updateSpaceDetails` service

**Files:**

- Modify: `i18n/en.json`
- Modify: `web/src/lib/services/space.service.ts`
- Test: `web/src/lib/services/space.service.spec.ts`

**Interfaces:**

- Consumes: `updateSpace` from `@immich/sdk`; `handleError` from `$lib/utils/handle-error`.
- Produces:
  ```ts
  export const updateSpaceDetails = (
    spaceId: string,
    dto: { name: string; description: string; color: UserAvatarColor },
  ) => Promise<boolean>;
  ```
  Tasks 5 imports this. Returns `true` on success, `false` on failure — it never throws.

**Background:** The modal must not call the SDK directly. Both existing edit modals (`ApiKeyUpdateModal`, `TagEditModal`) delegate to a service function that owns the API call, the success toast, and `handleError`, returning a boolean the modal uses to decide whether to close. `space.service.ts:10-32` already has exactly this shape in `addAssetsToSpace`.

- [ ] **Step 1: Add the i18n keys**

`i18n/en.json` is alphabetically sorted. Insert **in these exact positions**:

After `"unable_to_update_settings"` and **before** `"unable_to_update_space_cover"` (currently line 1403), inside the `errors` object:

```json
    "unable_to_update_space": "Unable to update space",
```

After `"spaces_delete_person_confirmation"` (currently line 2753) and **before** `"spaces_empty"`:

```json
  "spaces_edit": "Edit Space",
  "spaces_edit_success": "Space updated",
```

- [ ] **Step 2: Write the failing tests**

Append to `web/src/lib/services/space.service.spec.ts`. Also extend the existing `@immich/sdk` mock at the top of the file (currently lines 19-22) so `updateSpace` is mocked:

```ts
vi.mock('@immich/sdk', async (orig) => ({
  ...(await orig<typeof import('@immich/sdk')>()),
  addAssets: vi.fn().mockResolvedValue(undefined),
  updateSpace: vi.fn().mockResolvedValue(undefined),
}));
```

Add `updateSpace` and `UserAvatarColor` to the `@immich/sdk` import on line 1, and `updateSpaceDetails` to the `./space.service` import on line 7. Then append:

```ts
describe('updateSpaceDetails', () => {
  const dto = { name: 'Family & Friends', description: 'Our photos', color: UserAvatarColor.Blue };

  it('sends the edited fields and reports success', async () => {
    await expect(updateSpaceDetails('space-1', dto)).resolves.toBe(true);

    expect(updateSpace).toHaveBeenCalledWith({ id: 'space-1', sharedSpaceUpdateDto: dto });
    expect(toastManager.primary).toHaveBeenCalledOnce();
  });

  it('sends an emptied description as an empty string, not undefined', async () => {
    // The server builds its update payload from keys that are `!== undefined`, so sending
    // `undefined` for a cleared description would silently keep the old value.
    await updateSpaceDetails('space-1', { ...dto, description: '' });

    const [call] = vi.mocked(updateSpace).mock.calls[0];
    expect(call.sharedSpaceUpdateDto.description).toBe('');
  });

  it('handles failures without throwing and reports failure', async () => {
    const error = new Error('forbidden');
    vi.mocked(updateSpace).mockRejectedValueOnce(error);

    await expect(updateSpaceDetails('space-1', dto)).resolves.toBe(false);

    expect(handleErrorSpy).toHaveBeenCalledWith(error, expect.any(String));
    expect(toastManager.primary).not.toHaveBeenCalled();
  });
});
```

Add to the existing `beforeEach` (after line 29):

```ts
vi.mocked(updateSpace).mockResolvedValue(undefined as never);
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd web && pnpm vitest run src/lib/services/space.service.spec.ts
```

Expected: FAIL — `updateSpaceDetails is not a function` / import error.

- [ ] **Step 4: Implement the service function**

In `web/src/lib/services/space.service.ts`, extend the `@immich/sdk` import on line 1 to `import { addAssets, updateSpace, type UserAvatarColor } from '@immich/sdk';` and append:

```ts
export const updateSpaceDetails = async (
  spaceId: string,
  dto: { name: string; description: string; color: UserAvatarColor },
) => {
  const $t = get(t);

  try {
    // `description` is passed through verbatim — an empty string clears it server-side,
    // whereas `undefined` would be dropped from the update payload and keep the old value.
    await updateSpace({ id: spaceId, sharedSpaceUpdateDto: dto });
    toastManager.primary($t('spaces_edit_success'));

    return true;
  } catch (error) {
    handleError(error, $t('errors.unable_to_update_space'));
    return false;
  }
};
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd web && pnpm vitest run src/lib/services/space.service.spec.ts
```

Expected: PASS (7 tests — 4 existing + 3 new).

- [ ] **Step 6: Commit**

```bash
git add i18n/en.json web/src/lib/services/space.service.ts web/src/lib/services/space.service.spec.ts
git commit -m "feat(web): add updateSpaceDetails service for editing space name, description and color"
```

---

### Task 5: Web — `SpaceEditModal`

**Files:**

- Create: `web/src/lib/modals/SpaceEditModal.svelte`
- Create: `web/src/lib/modals/SpaceEditModal.spec.ts`

**Interfaces:**

- Consumes: `updateSpaceDetails` from Task 4; `ColorPicker` from `$lib/components/spaces/color-picker.svelte`.
- Produces: the component `SpaceEditModal` with props
  ```ts
  { space: SharedSpaceResponseDto; onClose: (updated?: boolean) => void }
  ```
  Tasks 6 and 7 open it via `modalManager.show(SpaceEditModal, { space })`, which resolves to `true` on a saved edit and `undefined` on cancel.

**Background:** Mirrors `SpaceCreateModal.svelte` (same `FormModal` + `Field`/`Input`/`Textarea`/`ColorPicker` composition), with four deliberate differences: fields are prefilled; `description` is sent verbatim rather than `description || undefined`; the submit button is disabled for a blank name; and both text inputs carry `maxlength`. `@immich/ui`'s `Input` and `Textarea` spread `{...restProps}` last onto the underlying element, so `maxlength` and `onfocus` pass straight through.

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/modals/SpaceEditModal.spec.ts`:

```ts
import { UserAvatarColor, type SharedSpaceResponseDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
// userEvent (not fireEvent) for the submit button: it dispatches the full pointer/click sequence
// that actually triggers form submission in happy-dom. PersonEditBirthDateModal.spec does the same.
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SpaceEditModal from './SpaceEditModal.svelte';

const updateSpaceDetailsMock = vi.hoisted(() => vi.fn());
vi.mock('$lib/services/space.service', () => ({ updateSpaceDetails: updateSpaceDetailsMock }));

const space = (o: Partial<SharedSpaceResponseDto> = {}): SharedSpaceResponseDto =>
  ({
    id: 's1',
    name: 'Family Trip',
    description: 'Our holiday photos',
    color: UserAvatarColor.Blue,
    ...o,
  }) as never;

// Queries pinned to data-testid, not labels: @immich/ui's Field/Label wiring uses
// aria-labelledby, which happy-dom does not reliably associate (PersonEditBirthDateModal.spec
// resorts to a raw document.querySelector for the same reason).
const nameInput = () => screen.getByTestId('space-edit-name') as HTMLInputElement;
const descriptionInput = () => screen.getByTestId('space-edit-description') as HTMLTextAreaElement;
// "Save" is capitalised because FormModal's submitText comes from @immich/ui's OWN translation
// service (dist/services/translation.svelte.js → `save: 'Save'`), not svelte-i18n — so it is real
// English here, unlike the raw i18n keys ('spaces_edit', 'name') that svelte-i18n yields in tests.
const saveButton = () => screen.getByRole('button', { name: 'Save' });

beforeEach(() => {
  vi.clearAllMocks();
  updateSpaceDetailsMock.mockResolvedValue(true);
});

describe('SpaceEditModal', () => {
  it('prefills every field from the space', () => {
    render(SpaceEditModal, { space: space(), onClose: vi.fn() });

    expect(nameInput()).toHaveValue('Family Trip');
    expect(descriptionInput()).toHaveValue('Our holiday photos');
    expect(screen.getByTestId('color-swatch-blue')).toBeInTheDocument();
  });

  it('treats a null description as an empty field rather than the string "null"', () => {
    render(SpaceEditModal, { space: space({ description: null }), onClose: vi.fn() });

    expect(descriptionInput()).toHaveValue('');
  });

  it('saves the edited name and closes with true', async () => {
    const onClose = vi.fn();
    render(SpaceEditModal, { space: space(), onClose });

    await fireEvent.input(nameInput(), { target: { value: 'Renamed Trip' } });
    await userEvent.click(saveButton());

    await waitFor(() => {
      expect(updateSpaceDetailsMock).toHaveBeenCalledWith('s1', {
        name: 'Renamed Trip',
        description: 'Our holiday photos',
        color: UserAvatarColor.Blue,
      });
    });
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it('trims surrounding whitespace from the name before sending', async () => {
    render(SpaceEditModal, { space: space(), onClose: vi.fn() });

    await fireEvent.input(nameInput(), { target: { value: '  Padded Name  ' } });
    await userEvent.click(saveButton());

    await waitFor(() => {
      expect(updateSpaceDetailsMock).toHaveBeenCalledWith('s1', expect.objectContaining({ name: 'Padded Name' }));
    });
  });

  it('sends an emptied description as an empty string, not undefined', async () => {
    render(SpaceEditModal, { space: space(), onClose: vi.fn() });

    await fireEvent.input(descriptionInput(), { target: { value: '' } });
    await userEvent.click(saveButton());

    await waitFor(() => {
      expect(updateSpaceDetailsMock).toHaveBeenCalledWith('s1', expect.objectContaining({ description: '' }));
    });
  });

  it('sends the selected color', async () => {
    render(SpaceEditModal, { space: space(), onClose: vi.fn() });

    // Targeted by data-testid, not aria-label: the ColorPicker's labels are raw lowercase
    // enum values, a pre-existing a11y wart this component does not own.
    await fireEvent.click(screen.getByTestId('color-swatch-green'));
    await userEvent.click(saveButton());

    await waitFor(() => {
      expect(updateSpaceDetailsMock).toHaveBeenCalledWith(
        's1',
        expect.objectContaining({ color: UserAvatarColor.Green }),
      );
    });
  });

  it('submits unchanged values without error', async () => {
    const onClose = vi.fn();
    render(SpaceEditModal, { space: space(), onClose });

    await userEvent.click(saveButton());

    await waitFor(() => {
      expect(updateSpaceDetailsMock).toHaveBeenCalledWith('s1', {
        name: 'Family Trip',
        description: 'Our holiday photos',
        color: UserAvatarColor.Blue,
      });
    });
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it('disables save for an empty name', async () => {
    render(SpaceEditModal, { space: space(), onClose: vi.fn() });

    await fireEvent.input(nameInput(), { target: { value: '' } });

    expect(saveButton()).toBeDisabled();
  });

  it('disables save for a whitespace-only name, which native `required` would let through', async () => {
    render(SpaceEditModal, { space: space(), onClose: vi.fn() });

    await fireEvent.input(nameInput(), { target: { value: '   ' } });

    expect(saveButton()).toBeDisabled();
  });

  it('re-enables save once a valid name is restored', async () => {
    render(SpaceEditModal, { space: space(), onClose: vi.fn() });

    await fireEvent.input(nameInput(), { target: { value: '' } });
    expect(saveButton()).toBeDisabled();

    await fireEvent.input(nameInput(), { target: { value: 'Back' } });
    expect(saveButton()).not.toBeDisabled();
  });

  it('caps the inputs at the server bounds so an over-length value cannot be submitted', () => {
    render(SpaceEditModal, { space: space(), onClose: vi.fn() });

    expect(nameInput()).toHaveAttribute('maxlength', '100');
    expect(descriptionInput()).toHaveAttribute('maxlength', '500');
  });

  it('selects the existing name on first focus so typing replaces it', async () => {
    render(SpaceEditModal, { space: space(), onClose: vi.fn() });

    const input = nameInput();
    await fireEvent.focus(input);

    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('Family Trip'.length);
  });

  it('stays open when the save fails', async () => {
    updateSpaceDetailsMock.mockResolvedValue(false);
    const onClose = vi.fn();
    render(SpaceEditModal, { space: space(), onClose });

    await userEvent.click(saveButton());

    await waitFor(() => {
      expect(updateSpaceDetailsMock).toHaveBeenCalled();
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});
```

**One note for the implementer:** the `selectionStart`/`selectionEnd` assertion depends on happy-dom implementing `HTMLInputElement.select()`. If it does not, replace that single test with one asserting the input has focus, and leave a comment saying why. Do **not** delete the select-on-focus behaviour from the component to make a test go away.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd web && pnpm vitest run src/lib/modals/SpaceEditModal.spec.ts
```

Expected: FAIL — cannot resolve `./SpaceEditModal.svelte`.

- [ ] **Step 3: Implement the modal**

Create `web/src/lib/modals/SpaceEditModal.svelte`:

```svelte
<script lang="ts">
  import ColorPicker from '$lib/components/spaces/color-picker.svelte';
  import { updateSpaceDetails } from '$lib/services/space.service';
  import { UserAvatarColor, type SharedSpaceResponseDto } from '@immich/sdk';
  import { Field, FormModal, Input, Textarea } from '@immich/ui';
  import { mdiAccountGroup } from '@mdi/js';
  import { t } from 'svelte-i18n';

  type Props = {
    space: SharedSpaceResponseDto;
    onClose: (updated?: boolean) => void;
  };

  let { space, onClose }: Props = $props();

  let name = $state(space.name);
  let description = $state(space.description ?? '');
  let color = $state<UserAvatarColor>(space.color ?? UserAvatarColor.Primary);

  // Renaming is the dominant path, so the autofocused name arrives pre-selected and typing
  // replaces it. Only on the FIRST focus — otherwise clicking to place the caret mid-word
  // would keep re-selecting the whole value.
  let hasSelectedName = false;
  const selectNameOnce = (event: FocusEvent & { currentTarget: HTMLInputElement }) => {
    if (hasSelectedName) {
      return;
    }
    hasSelectedName = true;
    event.currentTarget.select();
  };

  const onSubmit = async () => {
    // `description` goes through verbatim — '' clears it server-side, `undefined` would not.
    const success = await updateSpaceDetails(space.id, { name: name.trim(), description, color });
    if (success) {
      onClose(true);
    }
  };
</script>

<FormModal
  icon={mdiAccountGroup}
  title={$t('spaces_edit')}
  size="small"
  disabled={name.trim().length === 0}
  {onClose}
  {onSubmit}
>
  <div class="flex flex-col gap-4 m-4">
    <Field label={$t('name')} required>
      <Input bind:value={name} maxlength={100} autofocus onfocus={selectNameOnce} data-testid="space-edit-name" />
    </Field>
    <Field label={$t('description')}>
      <Textarea bind:value={description} maxlength={500} data-testid="space-edit-description" />
    </Field>
    <Field label={$t('color')}>
      <ColorPicker value={color} onchange={(c) => (color = c)} />
    </Field>
  </div>
</FormModal>
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd web && pnpm vitest run src/lib/modals/SpaceEditModal.spec.ts
```

Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/modals/SpaceEditModal.svelte web/src/lib/modals/SpaceEditModal.spec.ts
git commit -m "feat(web): add SpaceEditModal for renaming and editing a space"
```

---

### Task 6: Web — ⋮ overflow menu entry

**Files:**

- Modify: `web/src/routes/(user)/spaces/[spaceId]/+layout.svelte`
- Test: `web/src/routes/(user)/spaces/[spaceId]/space-layout.spec.ts`

**Interfaces:**

- Consumes: `SpaceEditModal` from Task 5.
- Produces: `handleEditSpace` in the layout; Task 7 passes the same handler down to `SpaceHero` as `onEditSpace`.

**Background:** The layout already derives `isEditor` (line 53) and already opens modals via `modalManager.show`. The spec file mocks `modalManager` and provides `openOverflow()` / `clickOverflowOption(label)` helpers; `svelte-i18n` returns raw keys, so menu labels match i18n keys verbatim.

- [ ] **Step 1: Write the failing tests**

Append inside the top-level `describe('space [spaceId] +layout.svelte', …)` in `space-layout.spec.ts`:

```ts
describe('edit space', () => {
  it('offers Edit space to an owner', async () => {
    renderLayout(SharedSpaceRole.Owner);
    await openOverflow();
    expect(await screen.findByText('spaces_edit')).toBeInTheDocument();
  });

  it('offers Edit space to an editor', async () => {
    renderLayout(SharedSpaceRole.Editor);
    await openOverflow();
    expect(await screen.findByText('spaces_edit')).toBeInTheDocument();
  });

  it('does NOT offer Edit space to a viewer', async () => {
    renderLayout(SharedSpaceRole.Viewer);
    await openOverflow();
    expect(screen.queryByText('spaces_edit')).not.toBeInTheDocument();
  });

  it('opens the modal with the current space and revalidates after a saved edit', async () => {
    vi.mocked(modalManager.show).mockResolvedValue(true as never);
    renderLayout(SharedSpaceRole.Editor);

    await clickOverflowOption('spaces_edit');

    await waitFor(() => {
      expect(modalManager.show).toHaveBeenCalledWith(expect.anything(), {
        space: expect.objectContaining({ id: 's1' }),
      });
    });
    expect(invalidateAllMock).toHaveBeenCalled();
  });

  it('does not revalidate when the edit is cancelled', async () => {
    vi.mocked(modalManager.show).mockResolvedValue(undefined as never);
    renderLayout(SharedSpaceRole.Editor);

    await clickOverflowOption('spaces_edit');

    await waitFor(() => {
      expect(modalManager.show).toHaveBeenCalled();
    });
    expect(invalidateAllMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd web && pnpm vitest run "src/routes/(user)/spaces/[spaceId]/space-layout.spec.ts"
```

Expected: FAIL — `spaces_edit` is not in the document.

- [ ] **Step 3: Implement the menu entry**

In `web/src/routes/(user)/spaces/[spaceId]/+layout.svelte`:

Add the modal import next to the other `$lib` imports:

```ts
import SpaceEditModal from '$lib/modals/SpaceEditModal.svelte';
```

Add `mdiPencilOutline` to the existing `@mdi/js` import block (keep the list alphabetical — it goes after `mdiPaw`).

Add the handler after `handleSavePosition` (which ends at line 105):

```ts
const handleEditSpace = async () => {
  const updated = await modalManager.show(SpaceEditModal, { space });
  if (updated) {
    await invalidateAll();
  }
};
```

In the overflow menu, inside the existing `{#if isEditor}` block (currently lines 249-252), add the new option **above** "Add all photos":

```svelte
            {#if isEditor}
              <hr class="my-1 border-gray-300" />
              <MenuOption text={$t('spaces_edit')} icon={mdiPencilOutline} onClick={handleEditSpace} />
              <MenuOption text={$t('add_all_photos')} icon={mdiImageMultipleOutline} onClick={handleBulkAddAssets} />
            {/if}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd web && pnpm vitest run "src/routes/(user)/spaces/[spaceId]/space-layout.spec.ts"
```

Expected: PASS (31 tests — 26 existing + 5 new).

- [ ] **Step 5: Commit**

```bash
git add "web/src/routes/(user)/spaces/[spaceId]/+layout.svelte" "web/src/routes/(user)/spaces/[spaceId]/space-layout.spec.ts"
git commit -m "feat(web): add Edit space to the space overflow menu"
```

---

### Task 7: Web — ✎ hero menu entry and gate restructure

**Files:**

- Modify: `web/src/lib/components/spaces/space-hero.svelte:167-182`
- Modify: `web/src/lib/components/spaces/space-hero.test-wrapper.svelte`
- Modify: `web/src/routes/(user)/spaces/[spaceId]/+layout.svelte` (pass `onEditSpace`)
- Test: `web/src/lib/components/spaces/space-hero.spec.ts`

**Interfaces:**

- Consumes: `handleEditSpace` from Task 6.
- Produces: `SpaceHero` gains an `onEditSpace?: () => void` prop.

**Background — why this task exists:** discussion #856 is a _discoverability_ failure. The ✎ on the hero is where a user hunting for "rename" clicks first, and today it holds only cover actions, so they conclude renaming is impossible. Two changes fix that:

1. "Edit space" joins the hero menu.
2. The menu's gate drops from `canEdit && hasCover` to `canEdit`, so cover-less spaces get a pencil at all.

But **"Reposition" stays gated on `hasCover`** — dragging a gradient to reposition a non-existent image is a broken affordance. The `data-testid` also gets renamed from `hero-edit-cover` to `hero-edit-menu`, because the menu is no longer cover-only.

The existing top-left "Set cover photo" button (`canEdit && !hasCover`) **stays**. It now duplicates "Change cover photo" for cover-less spaces; that is accepted as a deliberate empty-state call to action.

- [ ] **Step 1: Update the test wrapper**

`space-hero.test-wrapper.svelte` forwards props verbatim, so add `onEditSpace` to its `Props` interface after `onChangeCover`:

```ts
    onEditSpace?: () => void;
```

- [ ] **Step 2: Rename the testid in the three existing tests, and invert the no-cover one**

In `space-hero.spec.ts`, replace every `hero-edit-cover` with `hero-edit-menu` (5 occurrences, at lines 116, 121, 128, 133, 146). Then **replace** the test at lines 131-134 — it currently asserts the menu is absent without a cover, which is exactly the behaviour being fixed:

```ts
it('shows the edit menu even when there is no cover, so renaming stays reachable', () => {
  render(SpaceHero, {
    space: makeSpace({ thumbnailAssetId: null }),
    canEdit: true,
    onChangeCover: () => {},
    onEditSpace: () => {},
  });
  expect(screen.getByTestId('hero-edit-menu')).toBeInTheDocument();
});
```

Also update the title of the test at line 109 — it says "for editors with a cover", which is no longer the condition:

```ts
  it('shows the edit control without requiring hover (always visible for editors)', () => {
```

- [ ] **Step 3: Add the new tests**

Append these to the `// --- Edit control (✎) ---` section of `space-hero.spec.ts`:

```ts
it('offers Edit space in the hero menu for an editor', async () => {
  render(SpaceHero, {
    space: makeSpace({ thumbnailAssetId: 'a1' }),
    canEdit: true,
    onChangeCover: () => {},
    onReposition: () => {},
    onEditSpace: () => {},
  });

  await fireEvent.click(within(screen.getByTestId('hero-edit-menu')).getByLabelText('edit'));

  expect(await screen.findByText('spaces_edit')).toBeInTheDocument();
});

it('calls onEditSpace when Edit space is chosen', async () => {
  const onEditSpace = vi.fn();
  render(SpaceHero, {
    space: makeSpace({ thumbnailAssetId: 'a1' }),
    canEdit: true,
    onChangeCover: () => {},
    onReposition: () => {},
    onEditSpace,
  });

  await fireEvent.click(within(screen.getByTestId('hero-edit-menu')).getByLabelText('edit'));
  await fireEvent.click(await screen.findByText('spaces_edit'));

  expect(onEditSpace).toHaveBeenCalledOnce();
});

it('omits Reposition when there is no cover, since there is no image to drag', async () => {
  render(SpaceHero, {
    space: makeSpace({ thumbnailAssetId: null }),
    canEdit: true,
    onChangeCover: () => {},
    onEditSpace: () => {},
  });

  await fireEvent.click(within(screen.getByTestId('hero-edit-menu')).getByLabelText('edit'));

  expect(await screen.findByText('spaces_edit')).toBeInTheDocument();
  expect(screen.getByText('change_cover_photo')).toBeInTheDocument();
  expect(screen.queryByText('reposition')).not.toBeInTheDocument();
});

it('offers Reposition when there IS a cover', async () => {
  render(SpaceHero, {
    space: makeSpace({ thumbnailAssetId: 'a1' }),
    canEdit: true,
    onChangeCover: () => {},
    onReposition: () => {},
    onEditSpace: () => {},
  });

  await fireEvent.click(within(screen.getByTestId('hero-edit-menu')).getByLabelText('edit'));

  expect(await screen.findByText('reposition')).toBeInTheDocument();
});

it('shows no edit menu for a viewer, with or without a cover', async () => {
  const { rerender } = render(SpaceHero, { space: makeSpace({ thumbnailAssetId: 'a1' }), canEdit: false });
  expect(screen.queryByTestId('hero-edit-menu')).not.toBeInTheDocument();

  await rerender({ space: makeSpace({ thumbnailAssetId: null }), canEdit: false });
  expect(screen.queryByTestId('hero-edit-menu')).not.toBeInTheDocument();
});

it('still shows the empty-state Set cover button alongside the menu', () => {
  render(SpaceHero, {
    space: makeSpace({ thumbnailAssetId: null }),
    canEdit: true,
    onChangeCover: () => {},
    onEditSpace: () => {},
  });

  expect(screen.getByTestId('hero-edit-menu')).toBeInTheDocument();
  expect(screen.getByTestId('hero-set-cover-button')).toBeInTheDocument();
});
```

Ensure `fireEvent` and `within` are imported from `@testing-library/svelte` at the top of the file — the current import is `import { render, screen } from '@testing-library/svelte';`, so extend it:

```ts
import { fireEvent, render, screen, within } from '@testing-library/svelte';
```

- [ ] **Step 4: Run the tests to verify they fail**

```bash
cd web && pnpm vitest run src/lib/components/spaces/space-hero.spec.ts
```

Expected: FAIL — `hero-edit-menu` not found, and `spaces_edit` not in the menu.

- [ ] **Step 5: Implement the hero changes**

In `web/src/lib/components/spaces/space-hero.svelte`:

Add the prop to the `Props` interface after `onChangeCover`:

```ts
    onEditSpace?: () => void;
```

and to the destructuring after `onChangeCover`:

```ts
    onEditSpace,
```

Replace the edit-control block (currently lines 168-182):

```svelte
    <!-- Mockup: hover ✎ (editors) + role badge grouped at the top-right of the cover. -->
    <div class="absolute top-3 right-3 flex items-center gap-2">
      {#if canEdit}
        <div class="transition" data-testid="hero-edit-menu">
          <ButtonContextMenu
            icon={mdiPencilOutline}
            title={$t('edit')}
            color="secondary"
            align="top-right"
            direction="left"
          >
            <MenuOption text={$t('spaces_edit')} icon={mdiPencilOutline} onClick={() => onEditSpace?.()} />
            <MenuOption text={$t('change_cover_photo')} icon={mdiImageEditOutline} onClick={() => onChangeCover?.()} />
            {#if hasCover}
              <!-- Repositioning drags the cover image; with only a gradient there is nothing to drag. -->
              <MenuOption text={$t('reposition')} icon={mdiCursorMove} onClick={() => onReposition?.()} />
            {/if}
          </ButtonContextMenu>
        </div>
      {/if}
```

Leave the role-badge block that follows it, and the closing `</div>`, untouched.

- [ ] **Step 6: Wire the handler through the layout**

In `web/src/routes/(user)/spaces/[spaceId]/+layout.svelte`, add `onEditSpace` to the `<SpaceHero …>` props (currently lines 286-299), after `onChangeCover`:

```svelte
          onEditSpace={handleEditSpace}
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
cd web && pnpm vitest run src/lib/components/spaces/space-hero.spec.ts "src/routes/(user)/spaces/[spaceId]/space-layout.spec.ts"
```

Expected: PASS both files.

- [ ] **Step 8: Commit**

```bash
git add web/src/lib/components/spaces/space-hero.svelte web/src/lib/components/spaces/space-hero.test-wrapper.svelte web/src/lib/components/spaces/space-hero.spec.ts "web/src/routes/(user)/spaces/[spaceId]/+layout.svelte"
git commit -m "feat(web): surface Edit space in the hero menu and show it without a cover"
```

---

### Task 8: Full verification gate

**Files:** none modified unless a check fails.

**Interfaces:** consumes everything above.

**Background:** Subagents routinely report "green" on a narrow test run while a full-package lint or type-check fails. Run the whole gate yourself. Note that `pnpm lint` and Prettier are **separate CI gates** — passing ESLint does not mean Prettier is satisfied.

- [ ] **Step 1: Server checks**

```bash
cd server && pnpm vitest --config test/vitest.config.mjs run && pnpm lint && pnpm check
```

Expected: all pass. `pnpm check` is the type-check (there is no `make check-server` target).

- [ ] **Step 2: Web checks**

```bash
cd web && pnpm vitest run && pnpm check:typescript && pnpm lint
```

Expected: all pass. Tailwind **warnings** are tolerated; errors are not.

`pnpm check:svelte` has been observed scanning 0 files locally while working correctly in CI — if it reports 0 files, treat it as a push-only gate rather than a pass, and say so in your report.

- [ ] **Step 3: Formatting**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/feat-rename-spaces
npx prettier --check "web/src/**/*.{ts,svelte}" "server/src/**/*.ts" "e2e/src/**/*.ts" i18n/en.json
```

If anything is unformatted, run the same command with `--write` and amend the relevant commit.

- [ ] **Step 4: Confirm nothing out of scope changed**

```bash
git diff --stat main...HEAD
```

Expected: changes confined to `server/src/services/`, `server/src/dtos/`, `e2e/src/specs/`, `i18n/en.json`, `web/src/lib/`, `web/src/routes/`, and `docs/superpowers/`. **No** files under `mobile/`, `open-api/`, or `server/src/schema/`. If any appear, stop and report.

- [ ] **Step 5: Report**

State plainly which suites ran and their counts, and name anything you could **not** verify (most likely the e2e suite, if the Docker stack was unavailable). Do not describe unrun checks as passing.

---

## Manual verification (optional, after Task 8)

With a dev stack running (`make dev`, web on :2283), signed in as a **space editor** who is not the owner:

1. Open a space → ⋮ → "Edit Space" is present. Rename it, save.
2. The hero title, the browser tab title, and the `/spaces` list all show the new name.
3. The space's Activity tab shows a rename entry naming the old and new values.
4. On a space with **no cover photo**, the ✎ appears; its menu offers "Edit Space" and "Change cover photo" but **not** "Reposition".
5. As the same editor, confirm the ⋮ menu still does **not** offer "Show pets" or "Delete Space" — those stay owner-only.
