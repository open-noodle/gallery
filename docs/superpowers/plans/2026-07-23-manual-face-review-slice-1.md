# Slice 1 — Relax E15 for `lock`, with the eligibility read

Spec: `docs/superpowers/specs/2026-07-23-manual-face-review-mode-design.md` §5.1, §5.2, §5.3
Branch: `feat/face-manual-review`

## Goal

`lock` stops being gated on the scan's flagged snapshot and becomes gated on "this face is currently
eligible **on this person**" instead. `stay` keeps its snapshot gate. `detach`/`unknown` are **not**
touched in this slice (slice 2).

## Why the eligibility read is mandatory

`replaceFaceIdentities` (`server/src/repositories/face-identity.repository.ts:2369-2402`) is a bare
insert keyed only by FK — no join to `asset_face`, no person predicate — and it upserts with
`ON CONFLICT ... DO UPDATE` **with no `WHERE`**. Snapshot membership was the only thing proving a
`lock` id belonged to this person. Remove it without a replacement and an admin can re-point **any**
face in the database, including another user's, onto this person's identity.

## Step 1 — RED: `stay` regression guard (must be GREEN on arrival)

Write these first, before touching any source. They pin the invariant that slice 1 must not disturb.

File: `server/test/medium/specs/services/face-repair.resolve.spec.ts`

Existing `describe('FaceRepairService.resolveFaces: stay on a non-flagged face ...')` at ~`:1201`
already covers stay-on-non-flagged. **Add** one case in that same describe:

```ts
it('throws BadRequestException for a stay id when no scan has ever run', async () => {
  const { sut, ctx } = setup();
  const { user } = await ctx.newUser();
  const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
  const f1 = await seedFace(ctx, user.id, source.id);
  // No seedFlaggedSnapshot call at all — there is no scan, so no snapshot and no suspected owner.
  await expect(
    sut.resolveFaces({ personId: source.id, moveToPerson: [], stay: [f1], detach: [], lock: [], unknown: [] }, user.id),
  ).rejects.toThrow(new BadRequestException('Some faces are not in the flagged snapshot for this person'));
});
```

**Expected: GREEN immediately.** If it is red, stop — the premise of §3.2 is wrong and the spec needs
revisiting before proceeding.

Command:
`pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/services/face-repair.resolve.spec.ts -t "stay"`
(run from `server/`)

## Step 2 — RED: the new `lock` behaviour

Rewrite the existing describe at `:1372`
(`'FaceRepairService.resolveFaces: lock on a non-flagged face (M14, E15)'`). Rename it to
`'FaceRepairService.resolveFaces: lock eligibility (manual review, E15 relaxed)'` and replace its
single throwing test with:

### 2a. Non-flagged face on this person now SUCCEEDS (inverts the old assertion)

```ts
it('locks a non-flagged face that is currently on this person', async () => {
  const { sut, ctx, scanRepo } = setup();
  const { user } = await ctx.newUser();
  const { person: ownerA } = await ctx.newPerson({ ownerId: user.id, name: '' });
  const { person: source } = await ctx.newPerson({ ownerId: user.id, name: '' });
  const f1 = await seedFace(ctx, user.id, source.id);
  const notFlagged = await seedFace(ctx, user.id, source.id);
  await seedFlaggedSnapshot(scanRepo, user.id, source.id, [{ assetFaceId: f1, suspectedOwnerId: ownerA.id }]);

  const result = await sut.resolveFaces(
    { personId: source.id, moveToPerson: [], stay: [], lock: [notFlagged], detach: [], unknown: [] },
    user.id,
  );

  expect(result.locked).toBe(1);
  const rows = await manualLinkFor(notFlagged);
  expect(rows).toHaveLength(1);
  expect(rows[0].source).toBe('manual');
});
```

Old assertions that **invert**: `manualLinkFor(notFlagged)` was `toHaveLength(0)`, now `1`.

### 2b. Lock with NO scan at all succeeds (the actual manual-review path)

```ts
it('locks a face when no scan has ever run', async () => {
  /* no seedFlaggedSnapshot; expect locked: 1 */
});
```

### 2c. A face on a DIFFERENT person is rejected — the §5.3 hazard

```ts
it('rejects a lock id that belongs to a different person', async () => {
  // seed `other` person + a face on it; resolveFaces({ personId: source.id, lock: [foreignFace] })
  await expect(...).rejects.toThrow(BadRequestException);
  expect(await manualLinkFor(foreignFace)).toHaveLength(0); // and it was NOT re-pointed
});
```

### 2d. A face owned by a DIFFERENT USER is rejected

Same shape as 2c but the other person belongs to `ctx.newUser()` #2. This is the cross-tenant arm of
the hazard and must be asserted separately — it is the one that makes the missing check a security
issue rather than a correctness nit.

### 2e. A nonexistent face id is rejected

`lock: [randomUUID()]` → `BadRequestException`.

### 2f. A soft-deleted face is rejected

Seed a face on `source`, set `deletedAt`, then lock it → `BadRequestException`.

### 2g. Locking a face on this person that is linked to ANOTHER identity re-points it (documented)

This is the upsert's `DO UPDATE` behaviour. It is **correct** once eligibility constrains the face to
this person — the admin is asserting "this face is this person" — but it must be pinned so nobody
later mistakes it for a no-op:

```ts
it('re-points a face already linked to another identity onto this person (upsert, not no-op)', async () => {
  // link f1 to otherIdentity first, then lock it on `source`
  // expect exactly ONE row for f1, now pointing at source's identity, source='manual'
});
```

### 2h. Guided regression — a flagged face still locks

Keep one test proving the flagged path is unchanged.

### Expected results — and why this slice needs a THREE-phase red/green

**Corrected during execution.** The original plan predicted 2c–2f would be red against `HEAD`. They
are not, and the reason matters: `getScanFlaggedFacesForPersons`
(`server/src/repositories/face-repair-scan.repository.ts:293-316`) INNER JOINs `asset_face` and
re-validates `personId`, `deletedAt`, `isVisible` and `sourceType` **at snapshot-read time**. So
`flaggedIds` is already re-validated, and today a foreign / deleted / nonexistent lock id is rejected
by the _snapshot_ gate before it can ever reach the unscoped upsert.

That does not make 2c–2f worthless — it makes them **guards on a protection this slice removes**.
Their real red state is after the gate drops `lock` but before the eligibility check exists. So:

| Phase      | Action                                                             | 2a / 2b / 2g            | 2c–2f                                                                                     |
| ---------- | ------------------------------------------------------------------ | ----------------------- | ----------------------------------------------------------------------------------------- |
| 0 (`HEAD`) | —                                                                  | **RED** (snapshot gate) | GREEN (incidentally, via the same gate)                                                   |
| 1          | Step 3b only — drop `lock` from the gate, **no** eligibility check | GREEN                   | **RED** — the incidental protection is gone and a lock can now re-point an arbitrary face |
| 2          | Step 3a — add the eligibility check                                | GREEN                   | GREEN, now for the intended reason                                                        |

Phase 1 must actually be run and observed. It is the only point at which the hazard in §5.3 is
demonstrable, and it is what proves `getEligibleFaceIdsForPerson` earns its place rather than being
defensive decoration.

## Step 3 — GREEN: implementation (run 3b first, then 3a — see the phase table above)

### 3a. `server/src/repositories/face-repair.repository.ts`

Add after `getClusterFacePage` (~`:208`). **Mirror `getClusterFacePage`'s predicate exactly** —
including the `asset` and `face_search` joins — so "lockable" is precisely "visible on the manual
page". Do **not** add `@GenerateSql`: this repository carries none, and adding one would require
`mise sql` regeneration and a new `.sql` fixture.

```ts
// Which of `faceIds` are currently eligible ON `personId`. Mirrors getClusterFacePage's predicate so
// "lockable" is exactly "listed on the manual review page" — a third, subtly different eligibility
// predicate would be a bug farm. Advisory only: the write-time guards in reattributeFaces/detachFaces
// remain authoritative; this exists so a manual lock that cannot apply is an explicit 400 rather than
// a silent no-op.
async getEligibleFaceIdsForPerson(personId: string, faceIds: string[]): Promise<Set<string>> {
  if (faceIds.length === 0) {
    return new Set();
  }
  const rows = await this.db
    .selectFrom('asset_face')
    .innerJoin('asset', 'asset.id', 'asset_face.assetId')
    .innerJoin('face_search', 'face_search.faceId', 'asset_face.id')
    .select(['asset_face.id as assetFaceId'])
    .where('asset_face.id', 'in', faceIds)
    .where('asset_face.personId', '=', personId)
    .where('asset_face.sourceType', '=', sql.lit(SourceType.MachineLearning))
    .where('asset_face.deletedAt', 'is', null)
    .where('asset_face.isVisible', '=', true)
    .where('asset.deletedAt', 'is', null)
    .execute();
  return new Set(rows.map((row) => row.assetFaceId));
}
```

### 3b. `server/src/services/face-repair.service.ts` (~`:841-845`)

Drop `lock` from the snapshot gate and add the eligibility gate immediately after:

```ts
// stay/detach/unknown (E15) act only on this person's raw flagged snapshot. `lock` is exempt: it is
// meaningful for ANY face on this person (manual review), and is gated on eligibility below instead.
const unresolvable = findUnresolvableIds([...stay, ...detach, ...unknown], flaggedIds);
if (unresolvable.length > 0) {
  throw new BadRequestException('Some faces are not in the flagged snapshot for this person');
}

// `lock` writes through replaceFaceIdentities, which is keyed only by assetFaceId — no person scope and
// an unconditional ON CONFLICT DO UPDATE. Snapshot membership used to prove the face was on this person;
// with that gate lifted the check must be explicit, or a lock could re-point any face in the database
// (including another user's) onto this person's identity.
if (lock.length > 0) {
  const eligible = await this.faceRepairRepository.getEligibleFaceIdsForPerson(personId, lock);
  const ineligible = lock.filter((id) => !eligible.has(id));
  if (ineligible.length > 0) {
    throw new BadRequestException('Some faces are not eligible for this person');
  }
}
```

Place this **after** the existing concurrency/validation guards and **before** any mutation, so a bad
lock id rejects the whole request without partial commits.

## Step 4 — Verify

From `server/`:

1. `pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/services/face-repair.resolve.spec.ts`
   — the whole file must pass, not just the new tests. This is where a regression in the drain gate
   (`:299`, `:2173`) would surface.
2. `pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/services/face-review-cross-flow.spec.ts`
3. `pnpm exec vitest --config test/vitest.config.mjs --run src/services/face-repair.execute-repair.spec.ts src/services/face-repair.cluster-faces.spec.ts`
4. `pnpm lint` and `pnpm exec prettier --check src test` — prettier is a separate CI gate from eslint.

## Commit

`feat(server): allow locking any eligible face on a person, not only flagged ones`

Body must state that `stay` keeps its snapshot gate, and why the eligibility read is required
(`replaceFaceIdentities` is unscoped + unconditional upsert).

## Out of scope

`detach` and `unknown` stay in the snapshot gate — slice 2. No web changes. No new endpoint.
