# Slice 4 — M11: `unlinkAlbum` activity injection + 500 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. TDD, red→green.

**Goal:** `DELETE /shared-spaces/:spaceId/albums/:albumId` (`unlinkAlbum`) must not (1) inject an
`AlbumUnlink` activity into a space the album is not linked to, nor (2) 500 on a nonexistent `spaceId`.
Both stem from `logActivity` firing unconditionally in the owner arm after a no-op `removeAlbum`.

**Architecture:** After the existing auth block (space-Editor short-circuit OR album-owner check), add a
single `hasAlbumLink(spaceId, albumId)` guard that throws `NotFoundException` when no link exists —
before `logActivity`, orphaned-face cleanup, and grant reconcile. This closes both vectors for both
paths and preserves the leak-free ordering (a random non-owner/non-editor still gets 403 at the owner
auth check, before the link probe).

**Tech Stack:** NestJS. Server-only, no DTO/SDK change.

## Global Constraints (spec §0)

- TDD, positive control before negative. No co-author trailers. Targeted specs + `make check-server`/tsc
  - lint; write e2e, defer running to CI.

## Key facts (verified)

- `unlinkAlbum` (`shared-space.service.ts:697-727`): auth block at `:701-708` (Editor short-circuit else
  `checkAccess(AlbumDelete)` → `ForbiddenException`); then `getById` (`:710`),
  `getAlbumAssetIdsWithoutOtherSpacePath` (`:711`), `removeAlbum` (`:712`, silent no-op if no link),
  `logActivity` (`:713-718`, **unconditional**), face cleanup (`:719-723`), `queueAlbumGrantReconcile`
  (`:726`).
- `hasAlbumLink(spaceId, albumId)` (`shared-space.repository.ts:705-713`) → `Promise<boolean>`.
- Controller `shared-space.controller.ts` `unlinkAlbum` returns `void` (204). Param DTOs already
  UUID-validate (non-UUID → 400).

---

### Task 1: Add the `hasAlbumLink` guard

**Files:**

- Modify: `server/src/services/shared-space.service.ts` — `unlinkAlbum` (insert after `:708`, before
  `getById` at `:710`)
- Test (unit): `server/src/services/shared-space.service.spec.ts`
- Test (e2e): extend the shared-space album e2e (find via
  `grep -rl "unlinkAlbum\|albums.*spaceId\|AlbumUnlink\|shared-spaces.*albums" e2e/src`)

**Interfaces:**

- Consumes: `this.sharedSpaceRepository.hasAlbumLink(spaceId, albumId): Promise<boolean>`.

- [ ] **Step 1: Write failing unit tests** in `shared-space.service.spec.ts` (mock repo):
  - **Owner path, no link:** `getMember` → null (not editor), `checkAccess(AlbumDelete)` → Set([albumId])
    (owner), `hasAlbumLink` → **false** → `unlinkAlbum` throws `NotFoundException`, and
    `logActivity`, `removeAlbum` side effects, `queueAlbumGrantReconcile` are **NOT** called.
  - **Positive control, owner path, linked:** `hasAlbumLink` → **true** → proceeds; `removeAlbum` +
    `logActivity` called once.
  - (Editor path, no link: `getMember` → editor member, `hasAlbumLink` → false → `NotFoundException`.)

- [ ] **Step 2: Run — expect RED.** `cd server && pnpm test -- --run src/services/shared-space.service.spec.ts`.
      Expected: the no-link owner test FAILS (today `logActivity` is called; no throw).

- [ ] **Step 3: Implement.** In `unlinkAlbum`, immediately after the auth `if (!isSpaceEditor) {…}` block
      (`:708`) and before `const album = await this.albumRepository.getById(...)`:

```ts
// Fork RBAC (Slice 4 / M11): the owner arm authorizes on album ownership only and never verified
// the album is actually linked to this space. Without this guard, logActivity below injects an
// AlbumUnlink row into an arbitrary space's feed (activity spam via a leaked spaceId), and a
// nonexistent spaceId 500s on the FK. Guard both paths: no link -> 404, before any side effect.
const linked = await this.sharedSpaceRepository.hasAlbumLink(spaceId, albumId);
if (!linked) {
  throw new NotFoundException('Album is not linked to this space');
}
```

Ensure `NotFoundException` is imported from `@nestjs/common`.

- [ ] **Step 4: Run — expect GREEN.** No-link → throws, no side effects; linked → proceeds.

- [ ] **Step 5: Write the e2e negatives** (write; CI runs): in the shared-space album e2e:
  - Album owner O (not a member of space S) whose album is **not** linked to S:
    `DELETE /shared-spaces/{S}/albums/{ownAlbum}` → **404**; assert the space activity feed count is
    unchanged (no `AlbumUnlink` injected). Positive control: link the album, then unlink → 204 + exactly
    one `AlbumUnlink` activity.
  - `DELETE /shared-spaces/{random-uuid-nonexistent}/albums/{ownAlbum}` → **404, not 500**.
  - Editor unlinking a genuinely linked album → 204 (unchanged).

- [ ] **Step 6: `make check-server`/tsc + lint, then commit.**

```bash
git add server/src/services/shared-space.service.ts server/src/services/shared-space.service.spec.ts e2e/src
git commit -m "fix(spaces): guard unlinkAlbum owner path against activity injection + FK 500 (M11)"
```

---

## Edge cases (assert each — spec §Slice 4)

- [ ] Owner, album genuinely linked → unlink succeeds; exactly one `AlbumUnlink`; reconcile/cleanup run once.
- [ ] Owner, album not linked to this (real) space → 404; no activity, no cleanup, no reconcile.
- [ ] Nonexistent `spaceId` → 404, no FK 500.
- [ ] Non-UUID `spaceId`/`albumId` → 400 (param DTO — regression-assert, unchanged).
- [ ] Random non-owner non-editor caller → still **403** at the owner auth check (before the link probe —
      no 404-vs-403 info leak about link existence).
- [ ] Repeated calls (spam attempt) → each a clean 404; feed never grows.

## Definition of done

- Unit green; e2e written (CI). tsc + lint clean. No DTO/SDK change. One commit pushed. Scope-clean.
