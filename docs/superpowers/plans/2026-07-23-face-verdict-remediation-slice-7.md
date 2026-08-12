# Face Verdict Remediation — Slice 7: Admin surfaces can actually see faces — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close **D7**. Admin cleanup + resolutions surfaces render face crops for **non-owned** clusters (today they use user-scoped `/people/...` thumbnails → broken images), and the resolutions page stops 404-ing structurally (a negative-verdict face has no person↔face join, so `getRepresentativeFaceForUpdate` returns nothing). Fix: a new admin-gated, **face-keyed** thumbnail route serving the crop by `asset_face` row alone (no person join), plus web wiring on all four admin call sites.

**Architecture:** New `GET /admin/face-repair/faces/:assetFaceId/thumbnail` (`@Authenticated({ admin: true })`, `@FileResponse()` + `sendFile`) → `FaceRepairService.getAdminFaceThumbnail(assetFaceId)` → a new join-free, **tombstone-inclusive** repo read → the inherited `getFaceThumbnailSource` + `generateFaceThumbnailResponse` crop pipeline (both on `BaseService`). Web gains `getAdminFaceThumbnailUrl(assetFaceId)` (a plain `createUrl` string) swapped into the four surfaces.

**Tech Stack:** NestJS `sendFile`/`ImmichStreamResponse`, Kysely, Vitest service-unit + Playwright e2e-web, SvelteKit.

## Global Constraints

- Server: `src/` alias, eslint `--max-warnings 0`. Web: `cd web && pnpm check:typescript && pnpm check:svelte && pnpm test`; `pnpm lint` may abort locally (tscompat) — if so, defer the web-lint verdict to CI.
- Unit run: `cd server && pnpm exec vitest --config test/vitest.config.mjs --run <path>`. Never `-- --run`.
- The new admin route follows `FaceRepairAdminController`'s existing convention: `@Authenticated({ admin: true })` ONLY, **no `requireAccess`/`checkAccess`** (the whole controller/service is admin-only by design — grep confirms zero `requireAccess` in `face-repair.service.ts`). Serve by `asset_face` row for ANY owner.
- **Tombstone-inclusive read:** the "not a face" action tombstones a face (`deletedAt = now()`, keeping `boundingBox*`/`imageWidth/Height`). The resolutions page must still render those, so the admin read MUST omit the `deletedAt IS NULL` filter that `getFaceById` has.
- **OpenAPI regen deferred to Slice 10:** the web helper is a plain `createUrl` string (no SDK), so web stays green locally without regen. The new route DOES change the OpenAPI surface → the `generated-api-up-to-date` CI job would fail — but no CI runs until Slice 10's dispatch, which does `make open-api`. Do NOT run `make open-api` in this slice.
- e2e-web needs the **:2285 e2e stack** (never :2283). If it's not up, author the e2e test and defer its run to Slice 10.
- One commit. No `Co-Authored-By` trailers.

---

## File Structure

- **Modify** `server/src/repositories/person.repository.ts` — add `getFaceByIdIncludingTombstoned(id)` (like `getFaceById` at ~445-455 but WITHOUT the `deletedAt IS NULL` filter). Or add an options param to `getFaceById`; a separate named method is clearer.
- **Modify** `server/src/services/face-repair.service.ts` — add `getAdminFaceThumbnail(assetFaceId)`: try `personRepository.getFaceByIdIncludingTombstoned(assetFaceId)` (catch → `NotFoundException`), `getFaceThumbnailSource(face.assetId)` (null → `NotFoundException`), `return generateFaceThumbnailResponse(face, sourcePath)`.
- **Modify** `server/src/controllers/face-repair-admin.controller.ts` — add the `@Get('faces/:assetFaceId/thumbnail')` route (template: `integrity-admin.controller.ts:50-64`). New imports: `Next`, `Res` (`@nestjs/common`), `NextFunction`, `Response` (`express`), `FileResponse` (`src/middleware/auth.guard`), `sendFile` (`src/utils/file`).
- **Modify** `web/src/lib/utils/people-utils.ts` — add `getAdminFaceThumbnailUrl(assetFaceId, updatedAt?)` → `createUrl(\`/admin/face-repair/faces/${assetFaceId}/thumbnail\`, { updatedAt })`.
- **Modify** the four web call sites: `web/src/routes/admin/face-cleanup/FaceCleanupTable.svelte` (:23/:165/:216), `.../[personId]/+page.svelte` (:112-113 / face-grid tiles :481,:589), `.../[personId]/PersonPicker.svelte` (:55/:173), `.../resolutions/+page.svelte` (:45-46/:146). Swap the person-scoped face-thumbnail helper to `getAdminFaceThumbnailUrl(<thumbnailFaceId | assetFaceId>)`. Each DTO already carries a `thumbnailFaceId`/`assetFaceId`.
- **Modify** `server/src/services/face-repair.service.spec.ts` — service-unit tests for `getAdminFaceThumbnail`.
- **Modify** `e2e/src/specs/web/face-cleanup.e2e-spec.ts` — second-user cluster + image-load assertions.

---

## Task 1: Red — service-unit tests for the admin thumbnail

**Files:** Modify `server/src/services/face-repair.service.spec.ts`.

- [ ] **Step 1:** Add (mirror `person.service.spec.ts:997-1024` `getFaceThumbnail`, but mock the NEW `getFaceByIdIncludingTombstoned` and assert NO access checks):

```ts
describe('getAdminFaceThumbnail', () => {
  it('serves a face crop for a face on ANOTHER user’s asset, with no ownership check', async () => {
    const face = AssetFaceFactory.create({ id: 'face-1', assetId: 'asset-1' });
    mocks.person.getFaceByIdIncludingTombstoned.mockResolvedValue(face);
    mocks.asset.getForThumbnail.mockResolvedValue({ path: '/preview.jpg' } as any);
    vi.spyOn(sut as any, 'ensureLocalFile').mockResolvedValue({ localPath: '/preview.jpg', cleanup: vi.fn() });
    mocks.media.decodeImage.mockResolvedValue({ data: Buffer.from('img'), info: { width: 100, height: 100 } } as any);
    mocks.media.generateThumbnail.mockImplementation(async (_i, _o, output) => writeFile(output, Buffer.from('crop')));
    const result = await sut.getAdminFaceThumbnail('face-1');
    expect(mocks.person.getFaceByIdIncludingTombstoned).toHaveBeenCalledWith('face-1');
    expect(mocks.access.person.checkOwnerAccess).not.toHaveBeenCalled();
    expect(mocks.media.generateThumbnail).toHaveBeenCalled();
    if (result instanceof ImmichStreamResponse) result.stream.destroy();
  });
  it('serves a tombstoned (deletedAt) face — resolutions history still renders', async () => {
    const face = AssetFaceFactory.create({ id: 'face-1', assetId: 'asset-1', deletedAt: new Date() } as any);
    mocks.person.getFaceByIdIncludingTombstoned.mockResolvedValue(face);
    // ... same media mocks ... assert generateThumbnail called (not NotFound)
  });
  it('throws NotFound for an unknown face id', async () => {
    mocks.person.getFaceByIdIncludingTombstoned.mockRejectedValue(new Error('no rows'));
    await expect(sut.getAdminFaceThumbnail('nope')).rejects.toThrow(NotFoundException);
  });
});
```

- [ ] **Step 2: Run RED** — `cd server && pnpm exec vitest --config test/vitest.config.mjs --run src/services/face-repair.service.spec.ts`. Expected RED: `getAdminFaceThumbnail`/`getFaceByIdIncludingTombstoned` don't exist. Confirm the file executed.

---

## Task 2: Green — repo read + service method + controller route

- [ ] **Step 1 (repo):** `person.repository.ts`, add next to `getFaceById`:

```ts
// Admin face-thumbnail read: no person join, and INCLUDES tombstoned faces (the "not a face"
// action sets deletedAt but keeps boundingBox/dims, and resolutions history must still render).
@GenerateSql({ params: [DummyValue.UUID] })
getFaceByIdIncludingTombstoned(id: string) {
  return this.db.selectFrom('asset_face').selectAll('asset_face').select(withPerson)
    .where('asset_face.id', '=', id)
    .executeTakeFirstOrThrow();
}
```

- [ ] **Step 2 (service):** `face-repair.service.ts`:

```ts
async getAdminFaceThumbnail(assetFaceId: string) {
  let face;
  try {
    face = await this.personRepository.getFaceByIdIncludingTombstoned(assetFaceId);
  } catch {
    throw new NotFoundException();
  }
  const sourcePath = await this.getFaceThumbnailSource(face.assetId);
  if (!sourcePath) {
    throw new NotFoundException();
  }
  return this.generateFaceThumbnailResponse(face, sourcePath);
}
```

- [ ] **Step 3 (controller):** `face-repair-admin.controller.ts`, add the route (mirror `integrity-admin.controller.ts:50-64`):

```ts
@Get('faces/:assetFaceId/thumbnail')
@FileResponse()
@Authenticated({ admin: true })
@Endpoint({ summary: 'Get an admin face-repair face thumbnail', history: new HistoryBuilder().added('v1') })
async getFaceRepairFaceThumbnail(
  @Res() res: Response, @Next() next: NextFunction,
  @Param('assetFaceId', new ParseUUIDPipe({ version: '4' })) assetFaceId: string,
): Promise<void> {
  await sendFile(res, next, () => this.service.getAdminFaceThumbnail(assetFaceId), this.logger);
}
```

Add the missing imports. Confirm `this.logger` is available on the controller (it may need injecting — check how `integrity-admin.controller.ts` gets its logger; if it uses `LoggingRepository`, mirror that).

- [ ] **Step 4:** Run the service spec GREEN + `pnpm check` + `pnpm lint`.

---

## Task 3: Green — web wiring (4 call sites)

- [ ] **Step 1:** Add `getAdminFaceThumbnailUrl` to `web/src/lib/utils/people-utils.ts`.
- [ ] **Step 2:** Swap each of the four call sites to build the face-thumbnail `<img src>` from `getAdminFaceThumbnailUrl(<the row's thumbnailFaceId / assetFaceId>)` instead of the person-scoped path. For person-row avatars that only have a `thumbnailFaceId` (FaceCleanupTable, PersonPicker), use it; where it's null, keep a graceful fallback (the existing person-thumbnail path or a placeholder). For the face grids ([personId], resolutions), use the face's `assetFaceId`.
- [ ] **Step 3:** `cd web && pnpm check:typescript && pnpm check:svelte`. Update any web component spec that pins the old `/people/.../faces/.../thumbnail` URL for these surfaces to expect the admin URL. `cd web && pnpm test` (run at least the affected component specs; the shared surfaces have wide blast radius — run the face-cleanup web specs).

---

## Task 4: Red+defer — e2e second-user image-load

**Files:** Modify `e2e/src/specs/web/face-cleanup.e2e-spec.ts`.

- [ ] **Step 1 (write):** Add a test that seeds a cluster under a **second user** (`utils.userSetup(admin.accessToken, {...})`, then `utils.createAsset(secondUser.accessToken)` + `utils.createPerson(secondUser.accessToken)` + `utils.createFace({assetId, personId})` + `seedFlaggedScan(db, { ownerUserId: secondUser.userId, ... })`), logs in as **admin**, navigates to `/admin/face-cleanup/{personId}` and the resolutions page, and asserts the face `<img>` elements actually loaded:

```ts
const nw = await faceImg.evaluate((img: HTMLImageElement) => img.naturalWidth);
expect(nw).toBeGreaterThan(0);
```

(mirror `photo-viewer-aspect-ratio.e2e-spec.ts:53-58`). This is the test that finally exercises admin-reads-non-owned-face — impossible today because the suite seeds everything under `admin`.

- [ ] **Step 2 (run or defer):** Check `lsof -nP -iTCP:2285 -sTCP:LISTEN`. If the e2e stack is up, run the face-cleanup web spec against :2285 (`--project=web`) and confirm the image-load assertions pass (they FAIL pre-fix: broken `<img>` → naturalWidth 0). If not up, do NOT start it — defer the run to Slice 10's e2e-web gate and note it.

---

## Task 5: Done gate + commit

- [ ] **Step 1:** Server: `pnpm check`, `pnpm lint`, `pnpm exec vitest --config test/vitest.config.mjs --run src/services/face-repair.service.spec.ts`. Web: `pnpm check:typescript`, `pnpm check:svelte`, `pnpm test` (affected specs). e2e authored (run if stack up, else deferred).
- [ ] **Step 2: Commit:**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/face-unified
git add server/src/repositories/person.repository.ts server/src/services/face-repair.service.ts \
        server/src/controllers/face-repair-admin.controller.ts server/src/services/face-repair.service.spec.ts \
        web/src/lib/utils/people-utils.ts \
        web/src/routes/admin/face-cleanup/FaceCleanupTable.svelte \
        web/src/routes/admin/face-cleanup/'[personId]'/+page.svelte \
        web/src/routes/admin/face-cleanup/'[personId]'/PersonPicker.svelte \
        web/src/routes/admin/face-cleanup/resolutions/+page.svelte \
        e2e/src/specs/web/face-cleanup.e2e-spec.ts \
        docs/superpowers/plans/2026-07-23-face-verdict-remediation-slice-7.md
git commit -m "feat(server+web): admin face thumbnails; cleanup surfaces render non-owned clusters"
```

Note in the report: OpenAPI regen for the new route is DEFERRED to Slice 10 (`make open-api`); the `generated-api-up-to-date` CI job will be satisfied then.

---

## Edge-case coverage map (spec §Slice 7 TDD → test)

| Case                                                   | Covered by                                                                                                                                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| admin 200 for a face on another user's asset           | Task 1 service test + Task 4 e2e second-user                                                                                                                                   |
| non-admin 403                                          | enforced by `@Authenticated({ admin: true })` (guard-level, tested in AuthService's own spec) — add a controller "is an admin route" assertion mirroring the file's convention |
| tombstoned face still served                           | Task 1 "serves a tombstoned face" test (the tombstone-inclusive read)                                                                                                          |
| unknown id 404                                         | Task 1 "throws NotFound" test                                                                                                                                                  |
| resolutions renders non-joinable negative-verdict face | Task 4 e2e resolutions image-load (the structural-404 site)                                                                                                                    |

## Self-review (author)

- **Spec coverage:** the route (admin-gated, face-keyed, tombstone-inclusive), the service method, the repo read, the web helper + 4 call sites, the service-unit tests, and the second-user e2e each have a task. The resolutions 404 is fixed by construction (join-free read). ✅
- **Placeholder scan:** concrete route/service/repo/helper code; the web swaps name each file + line + the DTO field to use. The e2e body names the exact helpers + the naturalWidth idiom. ⚠️ the `this.logger` availability on the controller is a "confirm" note (integrity-admin has it) — verify, not a placeholder.
- **Type consistency:** `getFaceByIdIncludingTombstoned` / `getAdminFaceThumbnail` / `getAdminFaceThumbnailUrl` used identically across tasks. ✅
- **Scope:** no verdict-layer changes; purely the read/render surface. OpenAPI regen correctly deferred to Slice 10 (safe — no CI until then). ✅
