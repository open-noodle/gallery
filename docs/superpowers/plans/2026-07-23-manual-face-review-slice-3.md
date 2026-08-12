# Slice 3 — Admin person metadata endpoint + SDK regen

Spec: `docs/superpowers/specs/2026-07-23-manual-face-review-mode-design.md` §5.5
Branch: `feat/face-manual-review`

## Goal

`GET admin/face-repair/person/:personId` → `{ id, name, ownerId, faceCount, thumbnailFaceId }`,
admin-gated, 404 for an unknown person. Then regenerate the clients so slice 8 has a caller.

## Why

The guided review page reads `personName` and `ownerId` off `getLatestScan()`
(`web/src/routes/admin/face-cleanup/[personId]/+page.svelte:105,222`), and `ownerId` is what scopes
the move-picker. Manual review has no scan, and the user-scoped `GET /people/:id` does **not**
admin-bypass for a person the admin does not own — the same class of gap already fixed for face
thumbnails. Without this endpoint the manual page cannot name the person or open the picker.

The endpoint and the regen ship together: until the client is regenerated the endpoint has no caller,
so splitting them would land dead code.

## Step 1 — RED (controller spec)

File: `server/src/controllers/face-repair-admin.controller.spec.ts`

Follow the existing describes in that file for shape (they mock the service entirely and assert
routing/auth/DTO only). Add:

```ts
describe('GET /admin/face-repair/person/:personId', () => {
  it('is admin-only', async () => {
    // unauthenticated / non-admin -> 403, mirroring the existing admin-only assertions in this file
  });

  it('validates the personId is a uuid', async () => {
    // GET .../person/not-a-uuid -> 400
  });

  it('returns the service result', async () => {
    // mock service.getPersonMetadata -> assert 200 + body passthrough
  });
});
```

Run: `pnpm exec vitest --config test/vitest.config.mjs --run src/controllers/face-repair-admin.controller.spec.ts`
**Expected RED:** 404 route-not-found / `getPersonMetadata is not a function`.

## Step 2 — RED (medium spec for the query)

File: `server/test/medium/specs/services/face-repair.service.spec.ts` (or a new
`face-repair.person-metadata.spec.ts` if that file is already large — either is fine, keep it
consistent with neighbours).

Cases, all from spec §7 "_Metadata endpoint_":

1. **existing person returns the row** — id, name, ownerId, faceCount, thumbnailFaceId all correct.
2. **404 for an unknown person id** — expect `NotFoundException`.
3. **succeeds for a person owned by a different user** — cross-user is the whole point (admin-gated
   at the controller). Seed with a second `ctx.newUser()`.
4. **unnamed person** returns its empty/null name unchanged so the client can apply its own fallback.
   Do not coerce to a display string server-side.
5. **zero-face person** returns `faceCount: 0` and `thumbnailFaceId: null`.
6. **faceCount excludes soft-deleted and non-visible faces** — mirrors `searchOwnerPeople`'s join
   conditions (`deletedAt is null`, `isVisible = true`). Seed one of each and assert they are not
   counted.

**Expected RED:** method does not exist.

## Step 3 — GREEN

### 3a. `server/src/repositories/face-repair.repository.ts`

Add `getPersonMetadata`, reusing `searchOwnerPeople`'s exact join conditions so face counts agree
between the browser grid and the review page header (a mismatch there reads as a bug):

```ts
async getPersonMetadata(personId: string): Promise<PersonMetadataRow | undefined> {
  const row = await this.db
    .selectFrom('person')
    .leftJoin('asset_face', (join) =>
      join
        .onRef('asset_face.personId', '=', 'person.id')
        .on('asset_face.deletedAt', 'is', null)
        .on('asset_face.isVisible', '=', true),
    )
    .select([
      'person.id as id',
      'person.name as name',
      'person.ownerId as ownerId',
      'person.faceAssetId as thumbnailFaceId',
    ])
    .select((eb) => eb.fn.count('asset_face.id').as('faceCount'))
    .where('person.id', '=', personId)
    .groupBy(['person.id'])
    .executeTakeFirst();

  return row && { ...row, faceCount: Number(row.faceCount) };
}
```

Export `PersonMetadataRow` next to the existing `OwnerPersonRow`. **No `@GenerateSql`** — this
repository has none.

### 3b. `server/src/services/face-repair.service.ts`

```ts
async getPersonMetadata(personId: string): Promise<PersonMetadataRow> {
  const person = await this.faceRepairRepository.getPersonMetadata(personId);
  if (!person) {
    throw new NotFoundException('Person not found');
  }
  return person;
}
```

### 3c. `server/src/dtos/face-repair.dto.ts`

Mirror `FaceRepairOwnerPersonRowSchema`:

```ts
export const FaceRepairPersonMetadataResponseSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    ownerId: z.string(),
    faceCount: z.number(),
    thumbnailFaceId: z.string().nullable(),
  })
  .meta({ id: 'FaceRepairPersonMetadataResponseDto' });
export class FaceRepairPersonMetadataResponseDto extends createZodDto(FaceRepairPersonMetadataResponseSchema) {}
```

### 3d. `server/src/controllers/face-repair-admin.controller.ts`

Place it next to the other person routes:

```ts
@Get('person/:personId')
@Authenticated({ admin: true })
@Endpoint({ summary: 'Get a person for manual review', history: new HistoryBuilder().added('v1') })
getFaceRepairPersonMetadata(
  @Param() { personId }: /* existing uuid param DTO used by sibling routes */,
): Promise<FaceRepairPersonMetadataResponseDto> {
  return this.service.getPersonMetadata(personId);
}
```

Reuse whichever `@Param()` DTO the sibling `scan/person/:personId` route uses — do not invent a new
one. Note `admin/face-repair/person/:personId` does not collide with `scan/person/:personId`.

## Step 4 — SDK regen

```
mise open-api
```

This regenerates both the TypeScript SDK and the Dart client. Then:

- Confirm `getFaceRepairPersonMetadata` (or the generated name) is exported from
  `open-api/typescript-sdk/`.
- Rebuild the SDK if the web build needs it: `make build-sdk`.
- Commit the generated output — this repo commits generated clients.

Do **not** run `mise sql`: no `@GenerateSql` decorator was added, so there is nothing to regenerate,
and running it without a migrated throwaway DB can emit empty/incorrect files.

## Step 5 — Verify

From `server/`:

1. `pnpm exec vitest --config test/vitest.config.mjs --run src/controllers/face-repair-admin.controller.spec.ts`
2. `pnpm exec vitest --config test/vitest.config.medium.mjs --run <the medium spec file you used>`
3. `pnpm lint` + `pnpm exec prettier --check src test`
4. From repo root: `cd open-api/typescript-sdk && pnpm build` (or `make build-sdk`) to prove the
   generated client compiles.

## Commit

`feat(server): add admin person metadata endpoint for manual face review`

Generated client output may be a second commit (`chore: regenerate open-api clients`) if that matches
repo convention; either is acceptable so long as both land in this slice.

## Out of scope

No web changes — slice 8 consumes this. No changes to `resolveFaces`.
