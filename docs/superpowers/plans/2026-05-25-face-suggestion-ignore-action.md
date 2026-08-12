# Face Suggestion Ignore Action Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third face-suggestion review action, **Ignore face**, while preserving **Different person** as a distinct rejected intent and keeping old `dismiss` API calls compatible.

**Architecture:** Persist suggestion intent in `person_face_suggestion.status` with `rejected` and `ignored` resolved states. Server APIs expose explicit `reject` and `ignore` endpoints while `dismiss` remains a compatibility alias for `reject`; the web review modal renders three actions and wires global and shared-space pages to the generated SDK.

**Tech Stack:** NestJS controllers/services, Kysely repositories and migrations, Vitest server and web tests, Playwright E2E, Svelte 5, generated OpenAPI TypeScript and Dart clients.

---

## Reference Documents

- Spec: `docs/superpowers/specs/2026-05-25-face-suggestion-ignore-action-design.md`
- Existing feature docs: `docs/docs/features/facial-recognition.md`

## File Map

Migration and schema:

- Create: `server/src/schema/migrations-gallery/1779100000000-AddFaceSuggestionIntentStatuses.ts`
- Modify: `server/src/schema/tables/person-face-suggestion.table.ts`
- Modify: `server/test/medium/specs/migrations/person-face-suggestion.migration.spec.ts`

Backend behavior:

- Modify: `server/src/repositories/person-face-suggestion.repository.ts`
- Modify: `server/src/queries/person.face.suggestion.repository.sql`
- Modify: `server/test/medium/specs/repositories/person-face-suggestion.repository.spec.ts`
- Modify: `server/src/services/person.service.ts`
- Modify: `server/src/services/person.service.spec.ts`
- Modify: `server/src/services/shared-space.service.ts`
- Modify: `server/src/services/shared-space.service.spec.ts`
- Modify: `server/src/controllers/person.controller.ts`
- Modify: `server/src/controllers/person.controller.spec.ts`
- Modify: `server/src/controllers/shared-space.controller.ts`
- Modify: `server/src/controllers/shared-space.controller.spec.ts`

Generated clients and OpenAPI:

- Modify: `open-api/immich-openapi-specs.json`
- Modify: `open-api/typescript-sdk/src/fetch-client.ts`
- Modify: `mobile/openapi/lib/api/people_api.dart`
- Modify: `mobile/openapi/lib/api/shared_spaces_api.dart`
- Review `git status --short mobile/openapi` after generation and include every changed file under `mobile/openapi` in the OpenAPI commit.

Web:

- Modify: `web/src/lib/modals/PersonSuggestionReviewModal.svelte`
- Modify: `web/src/lib/modals/PersonSuggestionReviewModal.spec.ts`
- Modify: `web/src/routes/(user)/people/[personId]/[[photos=photos]]/[[assetId=id]]/+page.svelte`
- Modify: `web/src/routes/(user)/people/[personId]/[[photos=photos]]/[[assetId=id]]/person-detail-page.spec.ts`
- Modify: `web/src/routes/(user)/spaces/[spaceId]/people/[personId]/[[photos=photos]]/[[assetId=id]]/+page.svelte`
- Modify: `web/src/routes/(user)/spaces/[spaceId]/people/[personId]/[[photos=photos]]/[[assetId=id]]/space-person-detail-page.spec.ts`
- Modify: `i18n/en.json`

E2E and docs:

- Modify: `e2e/src/specs/server/api/person-face-suggestions.e2e-spec.ts`
- Modify: `e2e/src/specs/web/person-face-suggestions.e2e-spec.ts`
- Modify: `e2e/src/specs/web/space-person-face-suggestions.e2e-spec.ts`
- Modify: `docs/docs/features/facial-recognition.md`

## Task 1: Migration and Schema Status Vocabulary

**Files:**

- Create: `server/src/schema/migrations-gallery/1779100000000-AddFaceSuggestionIntentStatuses.ts`
- Modify: `server/src/schema/tables/person-face-suggestion.table.ts`
- Modify: `server/test/medium/specs/migrations/person-face-suggestion.migration.spec.ts`

- [ ] **Step 1: Write the failing migration/schema tests**

In `server/test/medium/specs/migrations/person-face-suggestion.migration.spec.ts`, replace the current status constraint test with this stricter assertion:

```ts
it('defines the face suggestion intent status check constraint', async () => {
  const r = await sql<{ definition: string }>`
    SELECT pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conname = 'person_face_suggestion_status_chk'
      AND contype = 'c'
  `.execute(db);
  expect(r.rows).toHaveLength(1);
  expect(r.rows[0].definition).toContain('pending');
  expect(r.rows[0].definition).toContain('confirmed');
  expect(r.rows[0].definition).toContain('rejected');
  expect(r.rows[0].definition).toContain('ignored');
  expect(r.rows[0].definition).not.toContain('dismissed');
});
```

Add this import near the top of the file:

```ts
import {
  up as upIntentStatuses,
  down as downIntentStatuses,
} from 'src/schema/migrations-gallery/1779100000000-AddFaceSuggestionIntentStatuses';
import { BaseService } from 'src/services/base.service';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PersonFaceSuggestionRepository } from 'src/repositories/person-face-suggestion.repository';
import { newMediumService } from 'test/medium.factory';
```

Add this helper below `afterAll`:

```ts
async function seedPendingSuggestion(testDb: Kysely<DB>) {
  const { ctx } = newMediumService(BaseService, {
    database: testDb,
    real: [PersonFaceSuggestionRepository],
    mock: [LoggingRepository],
  });
  const { user } = await ctx.newUser();
  const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Migration Person', isHidden: false });
  const { asset } = await ctx.newAsset({ ownerId: user.id });
  const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
  await testDb
    .insertInto('person_face_suggestion')
    .values({ personId: person.id, assetFaceId: assetFace.id, distance: 0.6 })
    .execute();
  return { personId: person.id, assetFaceId: assetFace.id };
}
```

Add this conversion test:

```ts
it('converts old dismissed rows to rejected on up and back to dismissed on down', async () => {
  const rollback = new Error('rollback-intent-status-test');
  await expect(
    db.transaction().execute(async (trx) => {
      await downIntentStatuses(trx as unknown as Kysely<unknown>);
      const { personId, assetFaceId } = await seedPendingSuggestion(trx as unknown as Kysely<DB>);
      await trx
        .updateTable('person_face_suggestion')
        .set({ status: 'dismissed' as never })
        .where('personId', '=', personId)
        .where('assetFaceId', '=', assetFaceId)
        .execute();

      await upIntentStatuses(trx as unknown as Kysely<unknown>);
      const afterUp = await trx
        .selectFrom('person_face_suggestion')
        .select('status')
        .where('personId', '=', personId)
        .where('assetFaceId', '=', assetFaceId)
        .executeTakeFirstOrThrow();
      expect(afterUp.status).toBe('rejected');

      await downIntentStatuses(trx as unknown as Kysely<unknown>);
      const afterDown = await trx
        .selectFrom('person_face_suggestion')
        .select('status')
        .where('personId', '=', personId)
        .where('assetFaceId', '=', assetFaceId)
        .executeTakeFirstOrThrow();
      expect(afterDown.status).toBe('dismissed');

      throw rollback;
    }),
  ).rejects.toThrow('rollback-intent-status-test');
});
```

Add this constraint behavior test:

```ts
it('accepts rejected and ignored statuses and rejects legacy or unknown statuses', async () => {
  const { personId, assetFaceId } = await seedPendingSuggestion(db);

  await expect(
    db
      .updateTable('person_face_suggestion')
      .set({ status: 'rejected' })
      .where('personId', '=', personId)
      .where('assetFaceId', '=', assetFaceId)
      .execute(),
  ).resolves.toBeDefined();

  await expect(
    db
      .updateTable('person_face_suggestion')
      .set({ status: 'ignored' })
      .where('personId', '=', personId)
      .where('assetFaceId', '=', assetFaceId)
      .execute(),
  ).resolves.toBeDefined();

  await expect(
    db
      .updateTable('person_face_suggestion')
      .set({ status: 'dismissed' as never })
      .where('personId', '=', personId)
      .where('assetFaceId', '=', assetFaceId)
      .execute(),
  ).rejects.toThrow('person_face_suggestion_status_chk');

  await expect(
    db
      .updateTable('person_face_suggestion')
      .set({ status: 'bogus' as never })
      .where('personId', '=', personId)
      .where('assetFaceId', '=', assetFaceId)
      .execute(),
  ).rejects.toThrow('person_face_suggestion_status_chk');
});
```

- [ ] **Step 2: Run the migration/schema tests and verify they fail**

Run:

```bash
pnpm --filter immich exec vitest --config test/vitest.config.medium.mjs run person-face-suggestion.migration.spec.ts
```

Expected: fail because `1779100000000-AddFaceSuggestionIntentStatuses.ts` does not exist and the current check constraint still contains `dismissed`.

- [ ] **Step 3: Add the migration**

Create `server/src/schema/migrations-gallery/1779100000000-AddFaceSuggestionIntentStatuses.ts`:

```ts
import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE "person_face_suggestion"
    DROP CONSTRAINT "person_face_suggestion_status_chk"
  `.execute(db);

  await sql`
    UPDATE "person_face_suggestion"
    SET "status" = 'rejected'
    WHERE "status" = 'dismissed'
  `.execute(db);

  await sql`
    ALTER TABLE "person_face_suggestion"
    ADD CONSTRAINT "person_face_suggestion_status_chk"
    CHECK ("status" IN ('pending', 'confirmed', 'rejected', 'ignored'))
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE "person_face_suggestion"
    DROP CONSTRAINT "person_face_suggestion_status_chk"
  `.execute(db);

  await sql`
    UPDATE "person_face_suggestion"
    SET "status" = 'dismissed'
    WHERE "status" IN ('rejected', 'ignored')
  `.execute(db);

  await sql`
    ALTER TABLE "person_face_suggestion"
    ADD CONSTRAINT "person_face_suggestion_status_chk"
    CHECK ("status" IN ('pending', 'confirmed', 'dismissed'))
  `.execute(db);
}
```

- [ ] **Step 4: Update the schema table type and check**

In `server/src/schema/tables/person-face-suggestion.table.ts`, change:

```ts
export type PersonFaceSuggestionStatus = 'pending' | 'confirmed' | 'dismissed';
```

to:

```ts
export type PersonFaceSuggestionStatus = 'pending' | 'confirmed' | 'rejected' | 'ignored';
```

Change the check expression to:

```ts
expression: `"status" IN ('pending', 'confirmed', 'rejected', 'ignored')`,
```

- [ ] **Step 5: Run the migration/schema tests and verify they pass**

Run:

```bash
pnpm --filter immich exec vitest --config test/vitest.config.medium.mjs run person-face-suggestion.migration.spec.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add server/src/schema/migrations-gallery/1779100000000-AddFaceSuggestionIntentStatuses.ts \
  server/src/schema/tables/person-face-suggestion.table.ts \
  server/test/medium/specs/migrations/person-face-suggestion.migration.spec.ts
git commit -m "feat(server): add face suggestion intent statuses"
```

## Task 2: Repository Intent Methods

**Files:**

- Modify: `server/src/repositories/person-face-suggestion.repository.ts`
- Modify: `server/src/queries/person.face.suggestion.repository.sql`
- Modify: `server/test/medium/specs/repositories/person-face-suggestion.repository.spec.ts`

- [ ] **Step 1: Write failing repository tests for personal rows**

In `server/test/medium/specs/repositories/person-face-suggestion.repository.spec.ts`, update existing references from `dismissed` to `rejected` where the old UI label meant **Different person**. Add an ignored-specific upsert test in `describe('upsertPending')`:

```ts
it('never resurrects rejected or ignored rows', async () => {
  const { sut } = setup();

  await sut.upsertPending([{ personId, assetFaceId, distance: 0.6 }]);
  await defaultDatabase
    .updateTable('person_face_suggestion')
    .set({ status: 'rejected' })
    .where('personId', '=', personId)
    .where('assetFaceId', '=', assetFaceId)
    .execute();
  await sut.upsertPending([{ personId, assetFaceId, distance: 0.4 }]);
  let row = await getRow(personId, assetFaceId);
  expect(row).toMatchObject({ status: 'rejected', distance: 0.6 });

  await defaultDatabase
    .deleteFrom('person_face_suggestion')
    .where('personId', '=', personId)
    .where('assetFaceId', '=', assetFaceId)
    .execute();
  await sut.upsertPending([{ personId, assetFaceId, distance: 0.61 }]);
  await defaultDatabase
    .updateTable('person_face_suggestion')
    .set({ status: 'ignored' })
    .where('personId', '=', personId)
    .where('assetFaceId', '=', assetFaceId)
    .execute();
  await sut.upsertPending([{ personId, assetFaceId, distance: 0.41 }]);
  row = await getRow(personId, assetFaceId);
  expect(row).toMatchObject({ status: 'ignored', distance: 0.61 });
});
```

Replace the `markDismissed` tests with:

```ts
it('markRejected flips a pending row to rejected and returns 1; re-running returns 0', async () => {
  const { sut } = setup();
  await sut.upsertPending([{ personId, assetFaceId, distance: 0.6 }]);

  expect(await sut.markRejected(personId, assetFaceId)).toBe(1);
  let row = await getRow(personId, assetFaceId);
  expect(row.status).toBe('rejected');

  expect(await sut.markRejected(personId, assetFaceId)).toBe(0);
  row = await getRow(personId, assetFaceId);
  expect(row.status).toBe('rejected');
});

it('markIgnored flips a pending row to ignored and returns 1; re-running returns 0', async () => {
  const { sut } = setup();
  await sut.upsertPending([{ personId, assetFaceId, distance: 0.6 }]);

  expect(await sut.markIgnored(personId, assetFaceId)).toBe(1);
  let row = await getRow(personId, assetFaceId);
  expect(row.status).toBe('ignored');

  expect(await sut.markIgnored(personId, assetFaceId)).toBe(0);
  row = await getRow(personId, assetFaceId);
  expect(row.status).toBe('ignored');
});

it('resolved rows are pending-only and cannot be overwritten by another resolution', async () => {
  const { sut } = setup();
  await sut.upsertPending([{ personId, assetFaceId, distance: 0.6 }]);
  await sut.markIgnored(personId, assetFaceId);

  expect(await sut.markRejected(personId, assetFaceId)).toBe(0);
  expect(await sut.markConfirmed(personId, assetFaceId)).toBe(0);
  const row = await getRow(personId, assetFaceId);
  expect(row.status).toBe('ignored');
});

it('reject and ignore race through the same pending-only guard', async () => {
  const { sut } = setup();
  await sut.upsertPending([{ personId, assetFaceId, distance: 0.6 }]);

  const results = await Promise.all([sut.markRejected(personId, assetFaceId), sut.markIgnored(personId, assetFaceId)]);
  expect(results.toSorted()).toEqual([0, 1]);

  const row = await getRow(personId, assetFaceId);
  expect(['rejected', 'ignored']).toContain(row.status);
});

it('reject and ignore resolve only the target suggestion row', async () => {
  const { ctx, sut } = setup();
  const { user } = await ctx.newUser();
  const { person: target } = await ctx.newPerson({ ownerId: user.id, name: 'Target Person', isHidden: false });
  const { person: sibling } = await ctx.newPerson({ ownerId: user.id, name: 'Sibling Person', isHidden: false });
  const { asset } = await ctx.newAsset({ ownerId: user.id });
  const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
  const { assetFace: ignoredFace } = await ctx.newAssetFace({ assetId: asset.id, personId: null });

  await sut.upsertPending([
    { personId: target.id, assetFaceId: assetFace.id, distance: 0.6 },
    { personId: sibling.id, assetFaceId: assetFace.id, distance: 0.62 },
    { personId: target.id, assetFaceId: ignoredFace.id, distance: 0.61 },
    { personId: sibling.id, assetFaceId: ignoredFace.id, distance: 0.63 },
  ]);

  expect(await sut.markRejected(target.id, assetFace.id)).toBe(1);
  expect((await getRow(target.id, assetFace.id)).status).toBe('rejected');
  expect((await getRow(sibling.id, assetFace.id)).status).toBe('pending');

  expect(await sut.markIgnored(target.id, ignoredFace.id)).toBe(1);
  expect((await getRow(target.id, ignoredFace.id)).status).toBe('ignored');
  expect((await getRow(sibling.id, ignoredFace.id)).status).toBe('pending');
});
```

In the `resolveAssignedFace` tests, replace the old `dismissed` setup/assertion with both `rejected` and `ignored` rows. The final assertion should verify `resolveAssignedFace` deletes only `pending` rows and preserves all resolved rows:

```ts
expect(await countRows(faceXId, 'rejected')).toBe(1);
expect(await countRows(faceXId, 'ignored')).toBe(1);
expect(await countRows(faceXId, 'confirmed')).toBe(1);
```

- [ ] **Step 2: Write failing repository tests for space-person rows**

In the space-person repository section, update the existing `upserts pending rows by spacePersonId and never resurrects dismissed rows` test so it checks both `rejected` and `ignored`. Add:

```ts
it('markRejectedForSpacePerson and markIgnoredForSpacePerson are idempotent and status-guarded', async () => {
  const { ctx, sut } = setup();
  const { user } = await ctx.newUser();
  const { sharedSpace } = await ctx.newSharedSpace({ ownerId: user.id, name: 'Intent Space' });
  const { sharedSpacePerson } = await ctx.newSharedSpacePerson({
    spaceId: sharedSpace.id,
    name: 'Intent Person',
    isHidden: false,
  });
  const { asset } = await ctx.newAsset({ ownerId: user.id });
  const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: null });

  await sut.upsertPendingForSpacePerson([
    { spacePersonId: sharedSpacePerson.id, assetFaceId: assetFace.id, distance: 0.6 },
  ]);

  expect(await sut.markRejectedForSpacePerson(sharedSpacePerson.id, assetFace.id)).toBe(1);
  expect(await sut.markRejectedForSpacePerson(sharedSpacePerson.id, assetFace.id)).toBe(0);
  expect(await sut.markIgnoredForSpacePerson(sharedSpacePerson.id, assetFace.id)).toBe(0);

  const row = await defaultDatabase
    .selectFrom('person_face_suggestion')
    .select('status')
    .where('spacePersonId', '=', sharedSpacePerson.id)
    .where('assetFaceId', '=', assetFace.id)
    .executeTakeFirstOrThrow();
  expect(row.status).toBe('rejected');
});

it('space-person reject and ignore race through the same pending-only guard', async () => {
  const { ctx, sut } = setup();
  const { user } = await ctx.newUser();
  const { sharedSpace } = await ctx.newSharedSpace({ ownerId: user.id, name: 'Intent Race Space' });
  const { sharedSpacePerson } = await ctx.newSharedSpacePerson({
    spaceId: sharedSpace.id,
    name: 'Intent Race Person',
    isHidden: false,
  });
  const { asset } = await ctx.newAsset({ ownerId: user.id });
  const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: null });

  await sut.upsertPendingForSpacePerson([
    { spacePersonId: sharedSpacePerson.id, assetFaceId: assetFace.id, distance: 0.6 },
  ]);

  const results = await Promise.all([
    sut.markRejectedForSpacePerson(sharedSpacePerson.id, assetFace.id),
    sut.markIgnoredForSpacePerson(sharedSpacePerson.id, assetFace.id),
  ]);
  expect(results.toSorted()).toEqual([0, 1]);

  const row = await defaultDatabase
    .selectFrom('person_face_suggestion')
    .select('status')
    .where('spacePersonId', '=', sharedSpacePerson.id)
    .where('assetFaceId', '=', assetFace.id)
    .executeTakeFirstOrThrow();
  expect(['rejected', 'ignored']).toContain(row.status);
});

it('space-person reject and ignore resolve only the target suggestion row', async () => {
  const { ctx, sut } = setup();
  const { user } = await ctx.newUser();
  const { sharedSpace } = await ctx.newSharedSpace({ ownerId: user.id, name: 'Intent Target Space' });
  const { sharedSpacePerson: target } = await ctx.newSharedSpacePerson({
    spaceId: sharedSpace.id,
    name: 'Target Space Person',
    isHidden: false,
  });
  const { sharedSpacePerson: sibling } = await ctx.newSharedSpacePerson({
    spaceId: sharedSpace.id,
    name: 'Sibling Space Person',
    isHidden: false,
  });
  const { asset } = await ctx.newAsset({ ownerId: user.id });
  const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
  const { assetFace: ignoredFace } = await ctx.newAssetFace({ assetId: asset.id, personId: null });

  await sut.upsertPendingForSpacePerson([
    { spacePersonId: target.id, assetFaceId: assetFace.id, distance: 0.6 },
    { spacePersonId: sibling.id, assetFaceId: assetFace.id, distance: 0.62 },
    { spacePersonId: target.id, assetFaceId: ignoredFace.id, distance: 0.61 },
    { spacePersonId: sibling.id, assetFaceId: ignoredFace.id, distance: 0.63 },
  ]);

  expect(await sut.markRejectedForSpacePerson(target.id, assetFace.id)).toBe(1);
  expect(await sut.markIgnoredForSpacePerson(target.id, ignoredFace.id)).toBe(1);

  const rows = await defaultDatabase
    .selectFrom('person_face_suggestion')
    .select(['spacePersonId', 'assetFaceId', 'status'])
    .where('spacePersonId', 'in', [target.id, sibling.id])
    .where('assetFaceId', 'in', [assetFace.id, ignoredFace.id])
    .execute();
  const statusByKey = new Map(rows.map((row) => [`${row.spacePersonId}:${row.assetFaceId}`, row.status]));
  expect(statusByKey.get(`${target.id}:${assetFace.id}`)).toBe('rejected');
  expect(statusByKey.get(`${sibling.id}:${assetFace.id}`)).toBe('pending');
  expect(statusByKey.get(`${target.id}:${ignoredFace.id}`)).toBe('ignored');
  expect(statusByKey.get(`${sibling.id}:${ignoredFace.id}`)).toBe('pending');
});
```

- [ ] **Step 3: Run repository tests and verify they fail**

Run:

```bash
pnpm --filter immich exec vitest --config test/vitest.config.medium.mjs run person-face-suggestion.repository.spec.ts
```

Expected: fail because `markRejected`, `markIgnored`, `markRejectedForSpacePerson`, and `markIgnoredForSpacePerson` are not implemented.

- [ ] **Step 4: Implement repository methods**

In `server/src/repositories/person-face-suggestion.repository.ts`, add a private resolver helper after `markConfirmed`:

```ts
  private async markPersonalResolved(
    personId: string,
    assetFaceId: string,
    status: 'rejected' | 'ignored',
  ): Promise<number> {
    const result = await this.db
      .updateTable('person_face_suggestion')
      .set({ status })
      .where('personId', '=', personId)
      .where('assetFaceId', '=', assetFaceId)
      .where('status', '=', 'pending')
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0n);
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async markRejected(personId: string, assetFaceId: string): Promise<number> {
    return this.markPersonalResolved(personId, assetFaceId, 'rejected');
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async markIgnored(personId: string, assetFaceId: string): Promise<number> {
    return this.markPersonalResolved(personId, assetFaceId, 'ignored');
  }
```

Keep this temporary compatibility method so Task 2 remains buildable before service callers are renamed. Do not decorate temporary compatibility aliases with `@GenerateSql`; only the final public intent methods should appear in the generated SQL snapshot.

```ts
  async markDismissed(personId: string, assetFaceId: string): Promise<number> {
    return this.markRejected(personId, assetFaceId);
  }
```

After `markConfirmedForSpacePerson`, add:

```ts
  private async markSpacePersonResolved(
    spacePersonId: string,
    assetFaceId: string,
    status: 'rejected' | 'ignored',
  ): Promise<number> {
    const result = await this.db
      .updateTable('person_face_suggestion')
      .set({ status })
      .where('spacePersonId', '=', spacePersonId)
      .where('assetFaceId', '=', assetFaceId)
      .where('status', '=', 'pending')
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0n);
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async markRejectedForSpacePerson(spacePersonId: string, assetFaceId: string): Promise<number> {
    return this.markSpacePersonResolved(spacePersonId, assetFaceId, 'rejected');
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async markIgnoredForSpacePerson(spacePersonId: string, assetFaceId: string): Promise<number> {
    return this.markSpacePersonResolved(spacePersonId, assetFaceId, 'ignored');
  }
```

Keep this temporary compatibility method so Task 2 remains buildable before shared-space service callers are renamed. Do not decorate temporary compatibility aliases with `@GenerateSql`.

```ts
  async markDismissedForSpacePerson(spacePersonId: string, assetFaceId: string): Promise<number> {
    return this.markRejectedForSpacePerson(spacePersonId, assetFaceId);
  }
```

- [ ] **Step 5: Run repository tests and verify they pass**

Run:

```bash
pnpm --filter immich exec vitest --config test/vitest.config.medium.mjs run person-face-suggestion.repository.spec.ts
make sql
rg -n "markRejected|markIgnored|markRejectedForSpacePerson|markIgnoredForSpacePerson" server/src/queries/person.face.suggestion.repository.sql
```

Expected: the repository tests pass, `make sql` exits 0, and the generated SQL snapshot contains the four renamed intent methods.

- [ ] **Step 6: Commit**

```bash
git add server/src/repositories/person-face-suggestion.repository.ts \
  server/src/queries/person.face.suggestion.repository.sql \
  server/test/medium/specs/repositories/person-face-suggestion.repository.spec.ts
git commit -m "feat(server): persist face suggestion rejection and ignore intents"
```

## Task 3: Personal Suggestion API

**Files:**

- Modify: `server/src/services/person.service.ts`
- Modify: `server/src/services/person.service.spec.ts`
- Modify: `server/src/controllers/person.controller.ts`
- Modify: `server/src/controllers/person.controller.spec.ts`
- Modify: `server/src/repositories/person-face-suggestion.repository.ts`

- [ ] **Step 1: Write failing service tests**

In `server/src/services/person.service.spec.ts`, rename the `dismissFaceSuggestion` block to cover reject, ignore, and compatibility:

```ts
describe('rejectFaceSuggestion / ignoreFaceSuggestion / dismissFaceSuggestion', () => {
  it('denies a non-owner with no state change', async () => {
    mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set());

    await expect(sut.rejectFaceSuggestion(AuthFactory.create(), 'person-1', 'face-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(sut.ignoreFaceSuggestion(AuthFactory.create(), 'person-1', 'face-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(mocks.personFaceSuggestion.markRejected).not.toHaveBeenCalled();
    expect(mocks.personFaceSuggestion.markIgnored).not.toHaveBeenCalled();
  });

  it('reject marks the row rejected and never assigns the face', async () => {
    mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set(['person-1']));
    mocks.personFaceSuggestion.markRejected.mockResolvedValue(1);

    await expect(sut.rejectFaceSuggestion(AuthFactory.create(), 'person-1', 'face-1')).resolves.toBeUndefined();
    expect(mocks.personFaceSuggestion.markRejected).toHaveBeenCalledWith('person-1', 'face-1');
    expect(mocks.person.reassignFace).not.toHaveBeenCalled();
  });

  it('ignore marks the row ignored and never assigns the face', async () => {
    mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set(['person-1']));
    mocks.personFaceSuggestion.markIgnored.mockResolvedValue(1);

    await expect(sut.ignoreFaceSuggestion(AuthFactory.create(), 'person-1', 'face-1')).resolves.toBeUndefined();
    expect(mocks.personFaceSuggestion.markIgnored).toHaveBeenCalledWith('person-1', 'face-1');
    expect(mocks.person.reassignFace).not.toHaveBeenCalled();
  });

  it('reject and ignore no-op stale or already-resolved rows', async () => {
    mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set(['person-1']));
    mocks.personFaceSuggestion.markRejected.mockResolvedValue(0);
    mocks.personFaceSuggestion.markIgnored.mockResolvedValue(0);

    await expect(sut.rejectFaceSuggestion(AuthFactory.create(), 'person-1', 'face-1')).resolves.toBeUndefined();
    await expect(sut.ignoreFaceSuggestion(AuthFactory.create(), 'person-1', 'face-1')).resolves.toBeUndefined();
    expect(mocks.person.reassignFace).not.toHaveBeenCalled();
  });

  it('dismiss remains a compatibility wrapper around reject', async () => {
    mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set(['person-1']));
    mocks.personFaceSuggestion.markRejected.mockResolvedValue(1);

    await expect(sut.dismissFaceSuggestion(AuthFactory.create(), 'person-1', 'face-1')).resolves.toBeUndefined();
    expect(mocks.personFaceSuggestion.markRejected).toHaveBeenCalledWith('person-1', 'face-1');
    expect(mocks.personFaceSuggestion.markIgnored).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Write failing controller tests**

In `server/src/controllers/person.controller.spec.ts`, import `Permission` from `src/enum` if it is not already imported. Add a `face suggestion routes` block using valid UUID params:

```ts
describe('face suggestion routes', () => {
  const personId = '00000000-0000-4000-8000-000000000001';
  const assetFaceId = '00000000-0000-4000-8000-000000000002';

  it('POST reject should require person update permission and respond with 200', async () => {
    const { status } = await request(ctx.getHttpServer())
      .post(`/people/${personId}/face-suggestions/${assetFaceId}/reject`)
      .set('Authorization', `Bearer token`);

    expect(status).toBe(200);
    expect(ctx.authenticate).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ permission: Permission.PersonUpdate }),
      }),
    );
    expect(service.rejectFaceSuggestion).toHaveBeenCalledWith(undefined, personId, assetFaceId);
  });

  it('POST ignore should require person update permission and respond with 200', async () => {
    const { status } = await request(ctx.getHttpServer())
      .post(`/people/${personId}/face-suggestions/${assetFaceId}/ignore`)
      .set('Authorization', `Bearer token`);

    expect(status).toBe(200);
    expect(ctx.authenticate).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ permission: Permission.PersonUpdate }),
      }),
    );
    expect(service.ignoreFaceSuggestion).toHaveBeenCalledWith(undefined, personId, assetFaceId);
  });

  it('POST dismiss should remain a compatibility route', async () => {
    const { status } = await request(ctx.getHttpServer())
      .post(`/people/${personId}/face-suggestions/${assetFaceId}/dismiss`)
      .set('Authorization', `Bearer token`);

    expect(status).toBe(200);
    expect(ctx.authenticate).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ permission: Permission.PersonUpdate }),
      }),
    );
    expect(service.dismissFaceSuggestion).toHaveBeenCalledWith(undefined, personId, assetFaceId);
  });

  it('POST reject should validate assetFaceId independently', async () => {
    const { status, body } = await request(ctx.getHttpServer())
      .post(`/people/${personId}/face-suggestions/not-a-uuid/reject`)
      .set('Authorization', `Bearer token`);

    expect(status).toBe(400);
    expect(body).toEqual(errorDto.badRequest(['[assetFaceId] Invalid UUID']));
    expect(service.rejectFaceSuggestion).not.toHaveBeenCalled();
  });

  it('POST ignore should validate assetFaceId independently', async () => {
    const { status, body } = await request(ctx.getHttpServer())
      .post(`/people/${personId}/face-suggestions/not-a-uuid/ignore`)
      .set('Authorization', `Bearer token`);

    expect(status).toBe(400);
    expect(body).toEqual(errorDto.badRequest(['[assetFaceId] Invalid UUID']));
    expect(service.ignoreFaceSuggestion).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run personal API tests and verify they fail**

Run:

```bash
pnpm --filter immich exec vitest --config test/vitest.config.mjs run src/services/person.service.spec.ts src/controllers/person.controller.spec.ts
```

Expected: fail because service/controller methods are not implemented and repository mock names are not updated.

- [ ] **Step 4: Implement personal service methods**

In `server/src/services/person.service.ts`, replace `dismissFaceSuggestion` with:

```ts
  async rejectFaceSuggestion(auth: AuthDto, personId: string, assetFaceId: string): Promise<void> {
    await this.requireAccess({ auth, permission: Permission.PersonUpdate, ids: [personId] });
    await this.personFaceSuggestionRepository.markRejected(personId, assetFaceId);
  }

  async ignoreFaceSuggestion(auth: AuthDto, personId: string, assetFaceId: string): Promise<void> {
    await this.requireAccess({ auth, permission: Permission.PersonUpdate, ids: [personId] });
    await this.personFaceSuggestionRepository.markIgnored(personId, assetFaceId);
  }

  async dismissFaceSuggestion(auth: AuthDto, personId: string, assetFaceId: string): Promise<void> {
    return this.rejectFaceSuggestion(auth, personId, assetFaceId);
  }
```

Keep `confirmFaceSuggestion(auth, personId, assetFaceId)` unchanged except for comments and existing test descriptions that mention `dismissed`; update that language to `rejected/ignored`.

- [ ] **Step 5: Remove the personal repository compatibility method**

In `server/src/repositories/person-face-suggestion.repository.ts`, remove this temporary method because personal service callers now use `markRejected`:

```ts
  async markDismissed(personId: string, assetFaceId: string): Promise<number> {
    return this.markRejected(personId, assetFaceId);
  }
```

- [ ] **Step 6: Implement personal controller endpoints**

In `server/src/controllers/person.controller.ts`, add these routes between confirm and dismiss:

```ts
  @Post(':id/face-suggestions/:assetFaceId/reject')
  @Authenticated({ permission: Permission.PersonUpdate })
  @HttpCode(HttpStatus.OK)
  @Endpoint({
    summary: 'Reject a face suggestion',
    description: 'Record that the suggested face is a different person. The face stays unassigned. Idempotent.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  rejectPersonFaceSuggestion(
    @Auth() auth: AuthDto,
    @Param() { id, assetFaceId }: PersonFaceSuggestionParamsDto,
  ): Promise<void> {
    return this.service.rejectFaceSuggestion(auth, id, assetFaceId);
  }

  @Post(':id/face-suggestions/:assetFaceId/ignore')
  @Authenticated({ permission: Permission.PersonUpdate })
  @HttpCode(HttpStatus.OK)
  @Endpoint({
    summary: 'Ignore a face suggestion',
    description: 'Suppress this suggestion without making an identity judgment. The face stays unassigned. Idempotent.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  ignorePersonFaceSuggestion(
    @Auth() auth: AuthDto,
    @Param() { id, assetFaceId }: PersonFaceSuggestionParamsDto,
  ): Promise<void> {
    return this.service.ignoreFaceSuggestion(auth, id, assetFaceId);
  }
```

Update the existing dismiss endpoint description to:

```ts
description: 'Compatibility alias for rejecting a face suggestion. The face stays unassigned. Idempotent.',
```

- [ ] **Step 7: Run personal API tests and verify they pass**

Run:

```bash
pnpm --filter immich exec vitest --config test/vitest.config.mjs run src/services/person.service.spec.ts src/controllers/person.controller.spec.ts
```

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add server/src/services/person.service.ts server/src/services/person.service.spec.ts \
  server/src/controllers/person.controller.ts server/src/controllers/person.controller.spec.ts \
  server/src/repositories/person-face-suggestion.repository.ts
git commit -m "feat(server): add personal face suggestion reject and ignore APIs"
```

## Task 4: Shared-Space Suggestion API

**Files:**

- Modify: `server/src/services/shared-space.service.ts`
- Modify: `server/src/services/shared-space.service.spec.ts`
- Modify: `server/src/controllers/shared-space.controller.ts`
- Modify: `server/src/controllers/shared-space.controller.spec.ts`
- Modify: `server/src/repositories/person-face-suggestion.repository.ts`

- [ ] **Step 1: Write failing shared-space service tests**

In `server/src/services/shared-space.service.spec.ts`, replace the `dismissSpacePersonFaceSuggestion` describe block with one that tests reject, ignore, and dismiss compatibility:

```ts
describe('rejectSpacePersonFaceSuggestion / ignoreSpacePersonFaceSuggestion / dismissSpacePersonFaceSuggestion', () => {
  const enabled = {
    machineLearning: { facialRecognition: { maxDistance: 0.5, suggestionMaxDistance: 0.8, minFaces: 3 } },
  };

  beforeEach(() => {
    mocks.systemMetadata.get.mockResolvedValue(enabled);
    mocks.sharedSpace.getPersonById.mockResolvedValue(
      factory.sharedSpacePerson({ id: 'space-person-1', spaceId: 'space-1' }),
    );
    mocks.personFaceSuggestion.hasPendingForSpacePerson.mockResolvedValue(true);
  });

  it('denies viewers with no state change', async () => {
    mocks.sharedSpace.getMember.mockResolvedValue(makeMemberResult({ role: SharedSpaceRole.Viewer }));

    await expect(
      sut.rejectSpacePersonFaceSuggestion(factory.auth(), 'space-1', 'space-person-1', 'face-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      sut.ignoreSpacePersonFaceSuggestion(factory.auth(), 'space-1', 'space-person-1', 'face-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mocks.personFaceSuggestion.markRejectedForSpacePerson).not.toHaveBeenCalled();
    expect(mocks.personFaceSuggestion.markIgnoredForSpacePerson).not.toHaveBeenCalled();
  });

  it('denies removed members before lookup or mutation', async () => {
    mocks.sharedSpace.getMember.mockResolvedValue(void 0);

    await expect(
      sut.rejectSpacePersonFaceSuggestion(factory.auth(), 'space-1', 'space-person-1', 'face-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      sut.ignoreSpacePersonFaceSuggestion(factory.auth(), 'space-1', 'space-person-1', 'face-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mocks.sharedSpace.getPersonById).not.toHaveBeenCalled();
    expect(mocks.personFaceSuggestion.hasPendingForSpacePerson).not.toHaveBeenCalled();
    expect(mocks.personFaceSuggestion.markRejectedForSpacePerson).not.toHaveBeenCalled();
    expect(mocks.personFaceSuggestion.markIgnoredForSpacePerson).not.toHaveBeenCalled();
  });

  it('rejects a person from another space before mutation', async () => {
    mocks.sharedSpace.getMember.mockResolvedValue(makeMemberResult({ role: SharedSpaceRole.Editor }));
    mocks.sharedSpace.getPersonById.mockResolvedValue(
      factory.sharedSpacePerson({ id: 'space-person-1', spaceId: 'other-space' }),
    );

    await expect(
      sut.rejectSpacePersonFaceSuggestion(factory.auth(), 'space-1', 'space-person-1', 'face-1'),
    ).rejects.toThrow(new BadRequestException('Person not found'));
    await expect(
      sut.ignoreSpacePersonFaceSuggestion(factory.auth(), 'space-1', 'space-person-1', 'face-1'),
    ).rejects.toThrow(new BadRequestException('Person not found'));
    expect(mocks.personFaceSuggestion.hasPendingForSpacePerson).not.toHaveBeenCalled();
    expect(mocks.personFaceSuggestion.markRejectedForSpacePerson).not.toHaveBeenCalled();
    expect(mocks.personFaceSuggestion.markIgnoredForSpacePerson).not.toHaveBeenCalled();
  });

  it('no-ops stale or already-resolved candidates', async () => {
    mocks.sharedSpace.getMember.mockResolvedValue(makeMemberResult({ role: SharedSpaceRole.Editor }));
    mocks.personFaceSuggestion.hasPendingForSpacePerson.mockResolvedValue(false);

    await expect(
      sut.rejectSpacePersonFaceSuggestion(factory.auth(), 'space-1', 'space-person-1', 'face-1'),
    ).resolves.toBeUndefined();
    await expect(
      sut.ignoreSpacePersonFaceSuggestion(factory.auth(), 'space-1', 'space-person-1', 'face-1'),
    ).resolves.toBeUndefined();

    expect(mocks.personFaceSuggestion.markRejectedForSpacePerson).not.toHaveBeenCalled();
    expect(mocks.personFaceSuggestion.markIgnoredForSpacePerson).not.toHaveBeenCalled();
    expect(mocks.faceIdentity.replaceFaceIdentity).not.toHaveBeenCalled();
  });

  it('reject marks only the target suggestion', async () => {
    mocks.sharedSpace.getMember.mockResolvedValue(makeMemberResult({ role: SharedSpaceRole.Editor }));
    mocks.personFaceSuggestion.markRejectedForSpacePerson.mockResolvedValue(1);

    await sut.rejectSpacePersonFaceSuggestion(factory.auth(), 'space-1', 'space-person-1', 'face-1');

    expect(mocks.personFaceSuggestion.markRejectedForSpacePerson).toHaveBeenCalledWith('space-person-1', 'face-1');
    expect(mocks.faceIdentity.replaceFaceIdentity).not.toHaveBeenCalled();
    expect(mocks.personFaceSuggestion.resolveAssignedFace).not.toHaveBeenCalled();
  });

  it('ignore marks only the target suggestion', async () => {
    mocks.sharedSpace.getMember.mockResolvedValue(makeMemberResult({ role: SharedSpaceRole.Editor }));
    mocks.personFaceSuggestion.markIgnoredForSpacePerson.mockResolvedValue(1);

    await sut.ignoreSpacePersonFaceSuggestion(factory.auth(), 'space-1', 'space-person-1', 'face-1');

    expect(mocks.personFaceSuggestion.markIgnoredForSpacePerson).toHaveBeenCalledWith('space-person-1', 'face-1');
    expect(mocks.faceIdentity.replaceFaceIdentity).not.toHaveBeenCalled();
    expect(mocks.personFaceSuggestion.resolveAssignedFace).not.toHaveBeenCalled();
  });

  it('dismiss remains a compatibility wrapper around reject', async () => {
    mocks.sharedSpace.getMember.mockResolvedValue(makeMemberResult({ role: SharedSpaceRole.Editor }));
    mocks.personFaceSuggestion.markRejectedForSpacePerson.mockResolvedValue(1);

    await sut.dismissSpacePersonFaceSuggestion(factory.auth(), 'space-1', 'space-person-1', 'face-1');

    expect(mocks.personFaceSuggestion.markRejectedForSpacePerson).toHaveBeenCalledWith('space-person-1', 'face-1');
    expect(mocks.personFaceSuggestion.markIgnoredForSpacePerson).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Write failing shared-space controller tests**

In `server/src/controllers/shared-space.controller.spec.ts`, add tests next to the existing confirm/dismiss tests:

```ts
it('POST reject should require shared-space update permission and respond with 200', async () => {
  const { status } = await request(ctx.getHttpServer())
    .post(`/shared-spaces/${spaceId}/people/${personId}/face-suggestions/${assetFaceId}/reject`)
    .set('Authorization', `Bearer token`);

  expect(status).toBe(200);
  expect(ctx.authenticate).toHaveBeenCalledWith(
    expect.objectContaining({
      metadata: expect.objectContaining({ permission: Permission.SharedSpaceUpdate }),
    }),
  );
  expect(service.rejectSpacePersonFaceSuggestion).toHaveBeenCalledWith(undefined, spaceId, personId, assetFaceId);
});

it('POST ignore should require shared-space update permission and respond with 200', async () => {
  const { status } = await request(ctx.getHttpServer())
    .post(`/shared-spaces/${spaceId}/people/${personId}/face-suggestions/${assetFaceId}/ignore`)
    .set('Authorization', `Bearer token`);

  expect(status).toBe(200);
  expect(ctx.authenticate).toHaveBeenCalledWith(
    expect.objectContaining({
      metadata: expect.objectContaining({ permission: Permission.SharedSpaceUpdate }),
    }),
  );
  expect(service.ignoreSpacePersonFaceSuggestion).toHaveBeenCalledWith(undefined, spaceId, personId, assetFaceId);
});

it('POST reject should validate assetFaceId independently', async () => {
  const { status, body } = await request(ctx.getHttpServer())
    .post(`/shared-spaces/${spaceId}/people/${personId}/face-suggestions/not-a-uuid/reject`)
    .set('Authorization', `Bearer token`);

  expect(status).toBe(400);
  expect(body).toEqual(errorDto.badRequest(['[assetFaceId] Invalid UUID']));
  expect(service.rejectSpacePersonFaceSuggestion).not.toHaveBeenCalled();
});

it('POST ignore should validate assetFaceId independently', async () => {
  const { status, body } = await request(ctx.getHttpServer())
    .post(`/shared-spaces/${spaceId}/people/${personId}/face-suggestions/not-a-uuid/ignore`)
    .set('Authorization', `Bearer token`);

  expect(status).toBe(400);
  expect(body).toEqual(errorDto.badRequest(['[assetFaceId] Invalid UUID']));
  expect(service.ignoreSpacePersonFaceSuggestion).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Run shared-space API tests and verify they fail**

Run:

```bash
pnpm --filter immich exec vitest --config test/vitest.config.mjs run src/services/shared-space.service.spec.ts src/controllers/shared-space.controller.spec.ts
```

Expected: fail because shared-space reject/ignore service and controller methods do not exist.

- [ ] **Step 4: Implement shared-space negative-action helper**

In `server/src/services/shared-space.service.ts`, replace `dismissSpacePersonFaceSuggestion` with:

```ts
  private async resolveSpacePersonFaceSuggestion(
    auth: AuthDto,
    spaceId: string,
    personId: string,
    assetFaceId: string,
    action: 'rejected' | 'ignored',
  ): Promise<void> {
    await this.requireRole(auth, spaceId, SharedSpaceRole.Editor);
    const person = await this.requireSpacePersonInSpace(spaceId, personId);
    const distanceConfig = await this.getFaceSuggestionDistanceConfig();
    const isPending = await this.personFaceSuggestionRepository.hasPendingForSpacePerson(
      spaceId,
      person.id,
      assetFaceId,
      distanceConfig,
    );
    if (!isPending) {
      return;
    }

    if (action === 'rejected') {
      await this.personFaceSuggestionRepository.markRejectedForSpacePerson(person.id, assetFaceId);
      return;
    }
    await this.personFaceSuggestionRepository.markIgnoredForSpacePerson(person.id, assetFaceId);
  }

  async rejectSpacePersonFaceSuggestion(
    auth: AuthDto,
    spaceId: string,
    personId: string,
    assetFaceId: string,
  ): Promise<void> {
    return this.resolveSpacePersonFaceSuggestion(auth, spaceId, personId, assetFaceId, 'rejected');
  }

  async ignoreSpacePersonFaceSuggestion(
    auth: AuthDto,
    spaceId: string,
    personId: string,
    assetFaceId: string,
  ): Promise<void> {
    return this.resolveSpacePersonFaceSuggestion(auth, spaceId, personId, assetFaceId, 'ignored');
  }

  async dismissSpacePersonFaceSuggestion(
    auth: AuthDto,
    spaceId: string,
    personId: string,
    assetFaceId: string,
  ): Promise<void> {
    return this.rejectSpacePersonFaceSuggestion(auth, spaceId, personId, assetFaceId);
  }
```

- [ ] **Step 5: Remove the shared-space repository compatibility method**

In `server/src/repositories/person-face-suggestion.repository.ts`, remove this temporary method because shared-space service callers now use `markRejectedForSpacePerson`:

```ts
  async markDismissedForSpacePerson(spacePersonId: string, assetFaceId: string): Promise<number> {
    return this.markRejectedForSpacePerson(spacePersonId, assetFaceId);
  }
```

- [ ] **Step 6: Implement shared-space controller endpoints**

In `server/src/controllers/shared-space.controller.ts`, add routes before `dismiss`:

```ts
  @Post(':id/people/:personId/face-suggestions/:assetFaceId/reject')
  @Authenticated({ permission: Permission.SharedSpaceUpdate })
  @HttpCode(HttpStatus.OK)
  @Endpoint({
    summary: 'Reject a face suggestion for a person in a shared space',
    description: 'Record that the suggested face is a different person. The face stays unassigned. Idempotent.',
    history: new HistoryBuilder().added('v2').stable('v2'),
  })
  rejectSpacePersonFaceSuggestion(
    @Auth() auth: AuthDto,
    @Param() { id, personId, assetFaceId }: SpacePersonFaceSuggestionParamsDto,
  ): Promise<void> {
    return this.service.rejectSpacePersonFaceSuggestion(auth, id, personId, assetFaceId);
  }

  @Post(':id/people/:personId/face-suggestions/:assetFaceId/ignore')
  @Authenticated({ permission: Permission.SharedSpaceUpdate })
  @HttpCode(HttpStatus.OK)
  @Endpoint({
    summary: 'Ignore a face suggestion for a person in a shared space',
    description: 'Suppress this suggestion without making an identity judgment. The face stays unassigned. Idempotent.',
    history: new HistoryBuilder().added('v2').stable('v2'),
  })
  ignoreSpacePersonFaceSuggestion(
    @Auth() auth: AuthDto,
    @Param() { id, personId, assetFaceId }: SpacePersonFaceSuggestionParamsDto,
  ): Promise<void> {
    return this.service.ignoreSpacePersonFaceSuggestion(auth, id, personId, assetFaceId);
  }
```

Update the existing dismiss description to:

```ts
description: 'Compatibility alias for rejecting a face suggestion. The face stays unassigned. Idempotent.',
```

- [ ] **Step 7: Run shared-space API tests and verify they pass**

Run:

```bash
pnpm --filter immich exec vitest --config test/vitest.config.mjs run src/services/shared-space.service.spec.ts src/controllers/shared-space.controller.spec.ts
```

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add server/src/services/shared-space.service.ts server/src/services/shared-space.service.spec.ts \
  server/src/controllers/shared-space.controller.ts server/src/controllers/shared-space.controller.spec.ts \
  server/src/repositories/person-face-suggestion.repository.ts
git commit -m "feat(server): add shared-space face suggestion reject and ignore APIs"
```

## Task 5: OpenAPI and Generated Clients

**Files:**

- Modify: `open-api/immich-openapi-specs.json`
- Modify: `open-api/typescript-sdk/src/fetch-client.ts`
- Modify: `mobile/openapi/lib/api/people_api.dart`
- Modify: `mobile/openapi/lib/api/shared_spaces_api.dart`
- Review `git status --short mobile/openapi` after generation and include every changed file under `mobile/openapi` in the OpenAPI commit.

- [ ] **Step 1: Verify generated clients are stale before regeneration**

Run:

```bash
rg -n "rejectPersonFaceSuggestion|ignorePersonFaceSuggestion|rejectSpacePersonFaceSuggestion|ignoreSpacePersonFaceSuggestion" \
  open-api/immich-openapi-specs.json \
  open-api/typescript-sdk/src/fetch-client.ts \
  mobile/openapi/lib/api/people_api.dart \
  mobile/openapi/lib/api/shared_spaces_api.dart
```

Expected: fail or return incomplete results because the controller endpoints exist but generated clients have not been regenerated yet.

- [ ] **Step 2: Run OpenAPI generation**

Run:

```bash
make open-api
```

Expected: server builds, OpenAPI spec syncs, TypeScript SDK builds, and Dart client regenerates. If the command fails because Java is unavailable for Dart generation, run `make open-api-typescript`, keep the TypeScript/OpenAPI changes, and record the exact Java failure in the final implementation notes before handing off for Dart generation on a machine with Java.

- [ ] **Step 3: Verify generated functions exist**

Run:

```bash
rg -n "rejectPersonFaceSuggestion|ignorePersonFaceSuggestion|rejectSpacePersonFaceSuggestion|ignoreSpacePersonFaceSuggestion" \
  open-api/immich-openapi-specs.json \
  open-api/typescript-sdk/src/fetch-client.ts \
  mobile/openapi/lib/api/people_api.dart \
  mobile/openapi/lib/api/shared_spaces_api.dart
```

Expected: each new operation appears in the OpenAPI JSON, TypeScript SDK, and Dart API files.

- [ ] **Step 4: Commit**

```bash
git add open-api/immich-openapi-specs.json open-api/typescript-sdk/src/fetch-client.ts mobile/openapi
git commit -m "chore: regenerate face suggestion API clients"
```

## Task 6: Web Modal and Page Wiring

**Files:**

- Modify: `web/src/lib/modals/PersonSuggestionReviewModal.svelte`
- Modify: `web/src/lib/modals/PersonSuggestionReviewModal.spec.ts`
- Modify: `web/src/routes/(user)/people/[personId]/[[photos=photos]]/[[assetId=id]]/+page.svelte`
- Modify: `web/src/routes/(user)/people/[personId]/[[photos=photos]]/[[assetId=id]]/person-detail-page.spec.ts`
- Modify: `web/src/routes/(user)/spaces/[spaceId]/people/[personId]/[[photos=photos]]/[[assetId=id]]/+page.svelte`
- Modify: `web/src/routes/(user)/spaces/[spaceId]/people/[personId]/[[photos=photos]]/[[assetId=id]]/space-person-detail-page.spec.ts`
- Modify: `i18n/en.json`

- [ ] **Step 1: Write failing modal tests**

In `web/src/lib/modals/PersonSuggestionReviewModal.spec.ts`, change the setup overrides from `dismiss` to `reject` and `ignore`:

```ts
function setup(
  overrides: Partial<{
    loadPage: ReturnType<typeof vi.fn>;
    confirm: ReturnType<typeof vi.fn>;
    reject: ReturnType<typeof vi.fn>;
    ignore: ReturnType<typeof vi.fn>;
    onClose: ReturnType<typeof vi.fn>;
  }> = {},
) {
  const props = {
    person,
    referenceThumbnailUrl: '/api/people/p1/thumbnail',
    loadPage: overrides.loadPage ?? vi.fn().mockResolvedValue(page1),
    confirm: overrides.confirm ?? vi.fn().mockResolvedValue(undefined),
    reject: overrides.reject ?? vi.fn().mockResolvedValue(undefined),
    ignore: overrides.ignore ?? vi.fn().mockResolvedValue(undefined),
    onClose: overrides.onClose ?? vi.fn(),
  };
  render(PersonSuggestionReviewModal, { props });
  return props;
}
```

Replace the Different-person test with:

```ts
it('Different person calls reject and advances', async () => {
  const reject = vi.fn().mockResolvedValue(undefined);
  setup({ reject });
  await waitFor(() => screen.getByTestId('suggestion-different-btn'));
  await userEvent.click(screen.getByTestId('suggestion-different-btn'));
  expect(reject).toHaveBeenCalledWith('f1');
});
```

Add:

```ts
it('renders three actions without adding explanatory copy to the modal surface', async () => {
  setup();
  await waitFor(() => screen.getByTestId('suggestion-same-btn'));

  expect(screen.getByTestId('suggestion-same-btn')).toHaveTextContent('face_suggestion_same');
  expect(screen.getByTestId('suggestion-different-btn')).toHaveTextContent('face_suggestion_different');
  expect(screen.getByTestId('suggestion-ignore-btn')).toHaveTextContent('face_suggestion_ignore');
  expect(screen.queryByText(/not useful|identity judgment|tiny background/i)).not.toBeInTheDocument();
});

it('Ignore face calls ignore and advances', async () => {
  const ignore = vi.fn().mockResolvedValue(undefined);
  setup({ ignore });
  await waitFor(() => screen.getByTestId('suggestion-ignore-btn'));
  await userEvent.click(screen.getByTestId('suggestion-ignore-btn'));
  expect(ignore).toHaveBeenCalledWith('f1');
});

it('keyboard: ArrowRight confirms, ArrowLeft rejects, and no ignore shortcut is registered', async () => {
  const confirm = vi.fn().mockResolvedValue(undefined);
  const reject = vi.fn().mockResolvedValue(undefined);
  const ignore = vi.fn().mockResolvedValue(undefined);
  setup({ confirm, reject, ignore });
  await waitFor(() => screen.getByTestId('suggestion-same-btn'));
  await userEvent.keyboard('{ArrowRight}');
  expect(confirm).toHaveBeenCalledWith('f1');
  await userEvent.keyboard('{ArrowLeft}');
  expect(reject).toHaveBeenCalledWith('f2');
  expect(ignore).not.toHaveBeenCalled();
});
```

Update the stale-action tests so both negative callbacks are covered:

```ts
it('a stale item (reject rejects) still advances', async () => {
  const reject = vi.fn().mockRejectedValue(new Error('404'));
  const onClose = vi.fn();
  setup({ reject, onClose });
  await waitFor(() => screen.getByTestId('suggestion-different-btn'));
  await userEvent.click(screen.getByTestId('suggestion-different-btn'));
  await userEvent.click(screen.getByTestId('suggestion-different-btn'));
  await waitFor(() => expect(onClose).toHaveBeenCalledWith({ confirmed: 0 }));
});

it('a stale item (ignore rejects) still advances', async () => {
  const ignore = vi.fn().mockRejectedValue(new Error('404'));
  const onClose = vi.fn();
  setup({ ignore, onClose });
  await waitFor(() => screen.getByTestId('suggestion-ignore-btn'));
  await userEvent.click(screen.getByTestId('suggestion-ignore-btn'));
  await userEvent.click(screen.getByTestId('suggestion-ignore-btn'));
  await waitFor(() => expect(onClose).toHaveBeenCalledWith({ confirmed: 0 }));
});
```

- [ ] **Step 2: Run modal tests and verify they fail**

Run:

```bash
pnpm --filter immich-web exec vitest run src/lib/modals/PersonSuggestionReviewModal.spec.ts
```

Expected: fail because the modal still expects `dismiss` and does not render `suggestion-ignore-btn`.

- [ ] **Step 3: Implement modal props, actions, and layout**

In `web/src/lib/modals/PersonSuggestionReviewModal.svelte`, change the props interface to:

```ts
confirm: (assetFaceId: string) => Promise<void>;
reject: (assetFaceId: string) => Promise<void>;
ignore: (assetFaceId: string) => Promise<void>;
```

Change the props destructuring to include `reject` and `ignore`.

Change `act` to:

```ts
async function act(kind: 'confirm' | 'reject' | 'ignore') {
  if (busy || !current) {
    return;
  }
  busy = true;
  const face = current.assetFaceId;
  try {
    if (kind === 'confirm') {
      await confirm(face);
      confirmed++;
    } else if (kind === 'reject') {
      await reject(face);
    } else {
      await ignore(face);
    }
  } catch {
    // stale/deleted suggestions are benign; advance to keep review flow moving
  } finally {
    busy = false;
  }
  await advance();
}
```

Change keyboard handling from `act('dismiss')` to `act('reject')`.

Import `mdiEyeOffOutline`:

```ts
import {
  mdiAccountCheckOutline,
  mdiAccountRemoveOutline,
  mdiChevronLeft,
  mdiChevronRight,
  mdiEyeOffOutline,
} from '@mdi/js';
```

Change the footer action buttons to this structure:

```svelte
      <div class="grid min-w-0 flex-1 grid-cols-2 gap-2 sm:flex sm:flex-none sm:justify-center sm:gap-3">
        <Button
          shape="round"
          color="secondary"
          variant="ghost"
          class="order-3 sm:order-1"
          disabled={busy || !current}
          leadingIcon={mdiEyeOffOutline}
          data-testid="suggestion-ignore-btn"
          onclick={() => act('ignore')}
        >
          {$t('face_suggestion_ignore')}
        </Button>
        <Button
          shape="round"
          color="secondary"
          class="order-2 sm:order-2"
          disabled={busy || !current}
          leadingIcon={mdiAccountRemoveOutline}
          data-testid="suggestion-different-btn"
          onclick={() => act('reject')}
        >
          {$t('face_suggestion_different')}
        </Button>
        <Button
          shape="round"
          class="order-1 col-span-2 sm:order-3 sm:col-span-1"
          disabled={busy || !current}
          leadingIcon={mdiAccountCheckOutline}
          data-testid="suggestion-same-btn"
          onclick={() => act('confirm')}
        >
          {$t('face_suggestion_same')}
        </Button>
      </div>
```

In `i18n/en.json`, add:

```json
  "face_suggestion_ignore": "Ignore face",
```

Place it next to the other `face_suggestion_*` keys.

- [ ] **Step 4: Wire global and shared-space pages to generated SDK methods**

In `web/src/routes/(user)/people/[personId]/[[photos=photos]]/[[assetId=id]]/+page.svelte`, replace the SDK import:

```ts
    dismissPersonFaceSuggestion,
```

with:

```ts
    ignorePersonFaceSuggestion,
    rejectPersonFaceSuggestion,
```

Update the modal props:

```ts
      reject: (assetFaceId: string) => rejectPersonFaceSuggestion({ id: person.id, assetFaceId }),
      ignore: (assetFaceId: string) => ignorePersonFaceSuggestion({ id: person.id, assetFaceId }),
```

In the shared-space route, replace:

```ts
    dismissSpacePersonFaceSuggestion,
```

with:

```ts
    ignoreSpacePersonFaceSuggestion,
    rejectSpacePersonFaceSuggestion,
```

Update the modal props:

```ts
      reject: (assetFaceId: string) =>
        rejectSpacePersonFaceSuggestion({ id: currentSpaceId, personId: currentPersonId, assetFaceId }),
      ignore: (assetFaceId: string) =>
        ignoreSpacePersonFaceSuggestion({ id: currentSpaceId, personId: currentPersonId, assetFaceId }),
```

- [ ] **Step 5: Update page wiring tests**

In the global and shared-space page specs, update SDK mocks and expectations:

```ts
sdkMock.rejectPersonFaceSuggestion.mockResolvedValue(undefined as never);
sdkMock.ignorePersonFaceSuggestion.mockResolvedValue(undefined as never);
```

For modal callback assertions, expect:

```ts
expect(sdkMock.rejectPersonFaceSuggestion).toHaveBeenCalledWith({ id: 'person-1', assetFaceId: 'face-1' });
expect(sdkMock.ignorePersonFaceSuggestion).toHaveBeenCalledWith({ id: 'person-1', assetFaceId: 'face-2' });
```

For shared-space:

```ts
expect(sdkMock.rejectSpacePersonFaceSuggestion).toHaveBeenCalledWith({
  id: 'space-1',
  personId: 'space-person-1',
  assetFaceId: 'face-1',
});
expect(sdkMock.ignoreSpacePersonFaceSuggestion).toHaveBeenCalledWith({
  id: 'space-1',
  personId: 'space-person-1',
  assetFaceId: 'face-2',
});
```

- [ ] **Step 6: Run web tests and verify they pass**

Run:

```bash
pnpm --filter immich-web exec vitest run src/lib/modals/PersonSuggestionReviewModal.spec.ts \
  'src/routes/(user)/people/[personId]/[[photos=photos]]/[[assetId=id]]/person-detail-page.spec.ts' \
  'src/routes/(user)/spaces/[spaceId]/people/[personId]/[[photos=photos]]/[[assetId=id]]/space-person-detail-page.spec.ts'
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/modals/PersonSuggestionReviewModal.svelte web/src/lib/modals/PersonSuggestionReviewModal.spec.ts \
  'web/src/routes/(user)/people/[personId]/[[photos=photos]]/[[assetId=id]]/+page.svelte' \
  'web/src/routes/(user)/people/[personId]/[[photos=photos]]/[[assetId=id]]/person-detail-page.spec.ts' \
  'web/src/routes/(user)/spaces/[spaceId]/people/[personId]/[[photos=photos]]/[[assetId=id]]/+page.svelte' \
  'web/src/routes/(user)/spaces/[spaceId]/people/[personId]/[[photos=photos]]/[[assetId=id]]/space-person-detail-page.spec.ts' \
  i18n/en.json
git commit -m "feat(web): add ignore action to face suggestion review"
```

## Task 7: E2E, Docs, and Final Verification

**Files:**

- Modify: `e2e/src/specs/server/api/person-face-suggestions.e2e-spec.ts`
- Modify: `e2e/src/specs/web/person-face-suggestions.e2e-spec.ts`
- Modify: `e2e/src/specs/web/space-person-face-suggestions.e2e-spec.ts`
- Modify: `docs/docs/features/facial-recognition.md`

- [ ] **Step 1: Update API E2E coverage**

In `e2e/src/specs/server/api/person-face-suggestions.e2e-spec.ts`, update header comments to list `reject`, `ignore`, and compatibility `dismiss`. Add new seeded faces:

```ts
let faceForReject: string;
let faceForIgnore: string;
```

Seed them in `beforeAll`:

```ts
faceForReject = await insertUnassignedFace(db, ownerAssetId);
faceForIgnore = await insertUnassignedFace(db, ownerAssetId);
await insertSuggestion(db, namedPerson.id, faceForReject, 0.61);
await insertSuggestion(db, namedPerson.id, faceForIgnore, 0.63);
```

Add helper:

```ts
async function getSuggestionStatus(db: Awaited<ReturnType<(typeof utils)['connectDatabase']>>, assetFaceId: string) {
  const result = await db.query<{ status: string }>(
    `SELECT status FROM person_face_suggestion WHERE "assetFaceId" = $1`,
    [assetFaceId],
  );
  return result.rows[0].status;
}

async function getAssetFacePersonId(db: Awaited<ReturnType<(typeof utils)['connectDatabase']>>, assetFaceId: string) {
  const result = await db.query<{ personId: string | null }>(`SELECT "personId" FROM asset_face WHERE id = $1`, [
    assetFaceId,
  ]);
  return result.rows[0].personId;
}
```

Add tests:

```ts
describe('POST /people/:id/face-suggestions/:assetFaceId/reject', () => {
  it('owner can reject a suggestion and store rejected intent', async () => {
    const db = await utils.connectDatabase();
    const { status } = await request(app)
      .post(`/people/${namedPerson.id}/face-suggestions/${faceForReject}/reject`)
      .set(asBearerAuth(owner.accessToken));
    expect(status).toBe(200);
    expect(await getSuggestionStatus(db, faceForReject)).toBe('rejected');
    expect(await getAssetFacePersonId(db, faceForReject)).toBeNull();
  });
});

describe('POST /people/:id/face-suggestions/:assetFaceId/ignore', () => {
  it('owner can ignore a suggestion and store ignored intent', async () => {
    const db = await utils.connectDatabase();
    const { status } = await request(app)
      .post(`/people/${namedPerson.id}/face-suggestions/${faceForIgnore}/ignore`)
      .set(asBearerAuth(owner.accessToken));
    expect(status).toBe(200);
    expect(await getSuggestionStatus(db, faceForIgnore)).toBe('ignored');
    expect(await getAssetFacePersonId(db, faceForIgnore)).toBeNull();
  });
});
```

Update the old dismiss status assertion so compatibility stores `rejected` and leaves the face unassigned.

- [ ] **Step 2: Update web E2E coverage**

In `e2e/src/specs/web/person-face-suggestions.e2e-spec.ts`, add assertions after opening the modal:

```ts
await expect(page.locator('[data-testid="suggestion-ignore-btn"]')).toBeVisible();
await expect(page.locator('[data-testid="suggestion-different-btn"]')).toBeVisible();
await expect(page.locator('[data-testid="suggestion-same-btn"]')).toBeVisible();
```

Add a test that clicks Ignore face and verifies the pending count drops:

```ts
test('Ignore face suppresses a suggestion without assignment', async ({ context, page }) => {
  await utils.setAuthCookies(context, admin.accessToken);
  await page.goto(`/people/${personId}`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const before = await page.request.get(`/api/people/${personId}/face-suggestions`);
  const beforeBody = await before.json();

  await page.locator('[data-testid="suggestion-review-btn"]').click();
  const ignoreResponse = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().includes('/face-suggestions/'),
  );
  await page.locator('[data-testid="suggestion-ignore-btn"]').click();
  expect((await ignoreResponse).status()).toBe(200);

  const res = await page.request.get(`/api/people/${personId}/face-suggestions`);
  const body = await res.json();
  expect(body.total).toBe(beforeBody.total - 1);
});
```

In `e2e/src/specs/web/space-person-face-suggestions.e2e-spec.ts`, add modal visibility assertions for all three buttons in the editor test. Add fixture-backed tests for both **Different person** and **Ignore face**:

- Editor clicking **Different person** sends `POST /api/shared-spaces/:spaceId/people/:personId/face-suggestions/:assetFaceId/reject`, the response is `200`, the suggestion row status is `rejected`, the candidate face remains unassigned, and the GET total drops by one.
- Editor clicking **Ignore face** sends `POST /api/shared-spaces/:spaceId/people/:personId/face-suggestions/:assetFaceId/ignore`, the response is `200`, the suggestion row status is `ignored`, the candidate face remains unassigned, and the GET total drops by one.
- Viewer direct `POST /api/shared-spaces/:spaceId/people/:personId/face-suggestions/:assetFaceId/reject` and `POST /api/shared-spaces/:spaceId/people/:personId/face-suggestions/:assetFaceId/ignore` requests are denied, matching the existing viewer no-banner coverage.

- [ ] **Step 3: Update user docs**

In `docs/docs/features/facial-recognition.md`, replace the current suggestion bullets with:

```md
- **Same person** assigns the face to the person.
- **Different person** rejects the suggestion as the wrong identity. It will never be suggested for this person again. The face itself stays unassigned.
- **Ignore face** hides the suggestion without making an identity judgment. Use this for tiny background faces or other correct-but-not-useful detections.
```

Keep and update the existing note:

```md
> Rejecting or ignoring only hides the _suggestion_. If a future, more confident match puts that same
> face within the automatic-recognition threshold, it can still be auto-assigned. These actions do not
> train the machine-learning model or create negative embedding examples.
```

- [ ] **Step 4: Run targeted E2E/API tests**

Run:

```bash
pnpm --filter immich-e2e exec vitest run src/specs/server/api/person-face-suggestions.e2e-spec.ts
```

Expected: pass.

Run web E2E only if the local dev stack is running:

```bash
pnpm --filter immich-e2e exec playwright test --project=web src/specs/web/person-face-suggestions.e2e-spec.ts src/specs/web/space-person-face-suggestions.e2e-spec.ts
```

Expected: pass with visible `suggestion-ignore-btn` and successful reject/ignore POSTs.

- [ ] **Step 5: Run final verification**

Run:

```bash
pnpm --filter immich check
pnpm --filter immich-web check:svelte
pnpm --filter immich-web check:typescript
pnpm --filter immich exec vitest --config test/vitest.config.mjs run src/services/person.service.spec.ts src/services/shared-space.service.spec.ts src/controllers/person.controller.spec.ts src/controllers/shared-space.controller.spec.ts
pnpm --filter immich exec vitest --config test/vitest.config.medium.mjs run person-face-suggestion.migration.spec.ts person-face-suggestion.repository.spec.ts
pnpm --filter immich-web exec vitest run src/lib/modals/PersonSuggestionReviewModal.spec.ts \
  'src/routes/(user)/people/[personId]/[[photos=photos]]/[[assetId=id]]/person-detail-page.spec.ts' \
  'src/routes/(user)/spaces/[spaceId]/people/[personId]/[[photos=photos]]/[[assetId=id]]/space-person-detail-page.spec.ts'
pnpm --filter immich-e2e exec vitest run src/specs/server/api/person-face-suggestions.e2e-spec.ts
make sql
git diff --exit-code server/src/queries/person.face.suggestion.repository.sql
! rg -n "dismissed" server/src/repositories/person-face-suggestion.repository.ts server/src/schema/tables/person-face-suggestion.table.ts
```

Expected:

- `pnpm --filter immich check` exits 0.
- Web Svelte and TypeScript checks pass.
- Server service/controller tests pass.
- Migration and repository medium tests pass.
- Web tests pass.
- API E2E tests pass.
- `make sql` exits 0 and the generated SQL diff check reports no drift.
- The final `rg` command returns no matches in active repository/schema code.

- [ ] **Step 6: Commit**

```bash
git add e2e/src/specs/server/api/person-face-suggestions.e2e-spec.ts \
  e2e/src/specs/web/person-face-suggestions.e2e-spec.ts \
  e2e/src/specs/web/space-person-face-suggestions.e2e-spec.ts \
  docs/docs/features/facial-recognition.md
git commit -m "test: cover face suggestion reject and ignore flows"
```
