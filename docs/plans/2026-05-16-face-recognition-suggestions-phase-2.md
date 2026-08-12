# Face Recognition Suggestions — Phase 2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make near-miss face suggestions appear **automatically** — a per-person scan job that
populates `person_face_suggestion`, a chunked queue-all chained after `FaceIdentityBackfill`,
and a single-person on-name trigger — with **no API and no UI**.

**Architecture:** Two new jobs on the existing `QueueName.PeopleBackfill` queue (never the hot
`FacialRecognition` queue). `PersonSuggestionScan({ id })` takes a named person's assigned-face
embeddings (≤20 sample), calls the Phase-1 tri-state `searchFaces({ hasPerson:false })` to find
the owner's unassigned faces within `suggestionMaxDistance`, keeps only the open band
`(maxDistance, suggestionMaxDistance]`, takes the min distance per candidate, and conditionally
upserts `pending` rows (Phase-1 `upsertPending` — never resurrects a resolved decision).
`PersonSuggestionScanQueueAll` streams scannable people and enqueues one scan each; it is
chained at the terminal of `handleFaceIdentityBackfill` so suggestions reflect the
post-maintenance assignment state. `PersonService.update` enqueues a single scan when a person
transitions into a scannable, named state. Everything is gated on
`suggestionMaxDistance > maxDistance` (feature off by default).

**Tech Stack:** NestJS, BullMQ jobs (`@OnJob`), Kysely, Vitest unit tests (`newTestService`
auto-mock factory) + Vitest medium tests (testcontainers Postgres). No `@GenerateSql` /
OpenAPI changes (the one new repo method is an undecorated `.stream()` enumeration).

**Design reference:** `docs/plans/2026-05-15-face-recognition-suggestions-design.md`
(Architecture → "Why a scan job", "Triggers", "End-to-end automatic chain"; Edge cases).
**Phase 1 output this builds on:** `PersonFaceSuggestionRepository.upsertPending`,
`PersonRepository.getAssignedFaceEmbeddings`, tri-state `SearchRepository.searchFaces`,
`facialRecognition.suggestionMaxDistance` config (default `0`).

**Edge cases covered by this phase:** 1, 2 (job-level), 5, 6, 7 (no-new-scans branch), 14, 15,
16, 19. **Out of scope (Phase 3+):** HTTP API, DTOs, web UI, the Confirm/Dismiss
resolve-in-reassign hook (edges 8–12, 18).

**Conventions for every task:** strict TDD (write the failing test, run it, watch it fail for
the expected reason, write the minimal code, run it green, commit). No `--no-verify`. Run all
commands from `/home/pierre/dev/gallery/.worktrees/face-recognition-suggestions`. Server
commands run in `server/`.

- Unit test: `cd server && pnpm test -- --run <file>`
- Medium test (real Postgres via testcontainers): `cd server && pnpm test:medium -- --run <file>`
- Type check: `make check-server`

There are **no** controller/DTO/OpenAPI changes in Phase 2, so do **not** run `make open-api`.
The one new repository method (Task 2) is an **undecorated streamed enumeration** (matching the
existing `getAll` / `getAllFaces` in the same file, which carry no `@GenerateSql`), so there is
**no new `@GenerateSql` method and `make sql` is not needed** — consistent with "no API
changes". Task 7 only runs `make check-server` + the full regression.

---

## Constants (added in Task 3, referenced throughout)

Add to the top of `server/src/services/person.service.ts` near
`FACE_IDENTITY_BACKFILL_CHUNK_SIZE` (`person.service.ts:68`):

```ts
// Per-person suggestion scan bounds (edge cases 14, 15).
const PERSON_SUGGESTION_EMBEDDING_SAMPLE = 20; // max source embeddings per person
const PERSON_SUGGESTION_NUM_RESULTS = 100; // max candidate faces per embedding search
```

These cap work for very large people (edge 14): at most 20 vector searches per scan, each
returning at most 100 candidates.

---

### Task 1: `JobName` enum + job payload types

> **TDD note (deliberate exception):** This is the one non-test-first task. An enum member /
> payload-type declaration has no runtime behavior to red-test in isolation — the failing
> test that drives it is **Task 3's** `handlePersonSuggestionScan` spec, which cannot compile
> or run until these symbols exist. Task 1 is the minimal scaffolding that makes Task 3's red
> test _expressible_; it adds no production logic. Keep it tiny (enum + type only); all
> behavior is TDD'd in Tasks 2–6.

**Files:**

- Modify: `server/src/enum.ts` (`JobName` enum, after line 728
  `FaceIdentityMaintenanceAfterRecognition`)
- Modify: `server/src/types.ts` (job payload interface near `IFaceIdentityBackfillJob:241`;
  `JobItem` union near line 424)
- Test: none — type/compile task; proof is `make check-server` and the Task 3–6 specs that
  consume these symbols.

**Step 1: Add the enum members**

In `server/src/enum.ts`, in `enum JobName` directly after
`FaceIdentityMaintenanceAfterRecognition = 'FaceIdentityMaintenanceAfterRecognition',`:

```ts
  PersonSuggestionScanQueueAll = 'PersonSuggestionScanQueueAll',
  PersonSuggestionScan = 'PersonSuggestionScan',
```

**Step 2: Add the payload type + union members**

In `server/src/types.ts`, after `IFaceIdentityBackfillJob` (ends line 245) add:

```ts
export interface IPersonSuggestionScanJob extends IBaseJob {
  id: string;
}
```

In the `JobItem` union, directly after
`| { name: JobName.FaceIdentityMaintenanceAfterRecognition; data: IDelayedJob }` (line 424):

```ts
  | { name: JobName.PersonSuggestionScanQueueAll; data: IBaseJob }
  | { name: JobName.PersonSuggestionScan; data: IPersonSuggestionScanJob }
```

**Step 3: Verify it compiles**

Run: `make check-server`
Expected: clean (no handler yet — the union members are declared but unhandled, which is
legal; the `@OnJob` handlers arrive in Tasks 3–4).

**Step 4: Commit**

```bash
git add server/src/enum.ts server/src/types.ts
git commit -m "feat(server): add PersonSuggestionScan job names + payload types"
```

---

### Task 2: `PersonRepository.getScannablePeopleWithUnassignedFaces()`

A streaming enumeration of people eligible for a suggestion scan: **named, not hidden,
`type='person'`**, whose owner has **≥1 unassigned ML face** (otherwise the scan is a
guaranteed no-op — don't enqueue it). Mirrors the `.stream()` enumeration style of
`PersonRepository.getAll` (`person.repository.ts:161`) and `getAllFaces:148`.

**Files:**

- Modify: `server/src/repositories/person.repository.ts` (add method after
  `getAssignedFaceEmbeddings`, ~line 757)
- Test: `server/test/medium/specs/repositories/person.repository.spec.ts` (append a
  `describe('getScannablePeopleWithUnassignedFaces')`)

**Step 1: Write the failing medium test**

Append to `server/test/medium/specs/repositories/person.repository.spec.ts`:

```ts
describe('getScannablePeopleWithUnassignedFaces', () => {
  it('streams only named, non-hidden, type=person people whose owner has an unassigned ML face', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { user: otherUser } = await ctx.newUser();

    const { person: named } = await ctx.newPerson({ ownerId: user.id, name: 'Alice', isHidden: false });
    const { person: unnamed } = await ctx.newPerson({ ownerId: user.id, name: '', isHidden: false });
    const { person: hidden } = await ctx.newPerson({ ownerId: user.id, name: 'Hidden', isHidden: true });
    const { person: pet } = await ctx.newPerson({ ownerId: user.id, name: 'Rex', isHidden: false, type: 'pet' });
    const { person: otherOwner } = await ctx.newPerson({ ownerId: otherUser.id, name: 'Bob', isHidden: false });

    // user owns an unassigned ML face → `named` is eligible
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newAssetFace({ assetId: asset.id, personId: null });
    // otherUser has NO unassigned face → `otherOwner` excluded
    const { asset: a2 } = await ctx.newAsset({ ownerId: otherUser.id });
    await ctx.newAssetFace({ assetId: a2.id, personId: otherOwner.id });

    const ids: string[] = [];
    for await (const p of sut.getScannablePeopleWithUnassignedFaces()) {
      ids.push(p.id);
    }

    expect(ids).toContain(named.id);
    expect(ids).not.toContain(unnamed.id);
    expect(ids).not.toContain(hidden.id);
    expect(ids).not.toContain(pet.id);
    expect(ids).not.toContain(otherOwner.id);
  });

  it('excludes a named person whose owner has only assigned/deleted/invisible faces', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Carol', isHidden: false });
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newAssetFace({ assetId: asset.id, personId: person.id }); // assigned
    await ctx.newAssetFace({ assetId: asset.id, personId: null, deletedAt: new Date() }); // deleted
    await ctx.newAssetFace({ assetId: asset.id, personId: null, isVisible: false }); // invisible

    const ids: string[] = [];
    for await (const p of sut.getScannablePeopleWithUnassignedFaces()) {
      ids.push(p.id);
    }
    expect(ids).not.toContain(person.id);
  });
});
```

> `ctx.newPerson`/`newAsset`/`newAssetFace` are the Phase-1 medium factory helpers (see
> `server/test/medium.factory.ts`; `type` defaults to `'person'`).

**Step 2: Run it — expect failure**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/repositories/person.repository.spec.ts`
Expected: FAIL — `sut.getScannablePeopleWithUnassignedFaces is not a function`.

**Step 3: Implement the method**

In `server/src/repositories/person.repository.ts`, after `getAssignedFaceEmbeddings`
(~line 757):

**No `@GenerateSql` decorator** — the sibling streamed enumerations `getAll`
(`person.repository.ts:161`) and `getAllFaces:148` are undecorated; match them exactly.
(`@GenerateSql` is for `.execute()`/`.executeTakeFirst()` query methods; `.stream()`
enumerations in this file are intentionally undecorated, so `make sql` has nothing to
regenerate.)

```ts
  getScannablePeopleWithUnassignedFaces() {
    return this.db
      .selectFrom('person')
      .select(['person.id', 'person.ownerId'])
      .where('person.name', '!=', '')
      .where('person.isHidden', '=', false)
      .where('person.type', '=', 'person')
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('asset_face')
            .innerJoin('asset', 'asset.id', 'asset_face.assetId')
            .select('asset_face.id')
            .whereRef('asset.ownerId', '=', 'person.ownerId')
            .where('asset.deletedAt', 'is', null)
            .where('asset_face.personId', 'is', null)
            .where('asset_face.deletedAt', 'is', null)
            .where('asset_face.isVisible', 'is', true)
            .where('asset_face.sourceType', '=', SourceType.MachineLearning),
        ),
      )
      .stream();
  }
```

`SourceType` is **already imported** in this file
(`person.repository.ts:7 — import { AssetFileType, AssetVisibility, SourceType } from 'src/enum'`);
no import change needed.

**Step 4: Run it — expect pass**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/repositories/person.repository.spec.ts`
Expected: PASS (both new tests; existing tests still green).

**Step 5: Commit**

```bash
git add server/src/repositories/person.repository.ts server/test/medium/specs/repositories/person.repository.spec.ts
git commit -m "feat(server): add PersonRepository.getScannablePeopleWithUnassignedFaces"
```

---

### Task 3: `handlePersonSuggestionScan` — the per-person scan job

The core generator. Feature-gated, scannable-gated, bounded, idempotent (delegates the
never-resurrect guarantee to Phase-1 `upsertPending`). Open lower bound:
`distance > maxDistance` (the `[0, maxDistance]` band is auto-assign's, untouched).

**Files:**

- Modify: `server/src/services/person.service.ts` (constants near line 68; new `@OnJob`
  handler — place it next to `handleFaceIdentityBackfill`, ~after line 579)
- Test: `server/src/services/person.service.spec.ts` (new
  `describe('handlePersonSuggestionScan')`)

**Step 1: Write the failing unit tests**

In `server/src/services/person.service.spec.ts`, add a new describe block (mirror the
config-mock style at spec line 2658 — `mocks.systemMetadata.get.mockResolvedValue({
machineLearning: { facialRecognition: { ... } } })`):

```ts
describe('handlePersonSuggestionScan', () => {
  const enabled = {
    machineLearning: { facialRecognition: { maxDistance: 0.5, suggestionMaxDistance: 0.8, minFaces: 3 } },
  };

  it('runs on the people backfill queue, not facial recognition', () => {
    const config = new Reflector().get(MetadataKey.JobConfig, sut.handlePersonSuggestionScan);
    expect(config).toEqual(expect.objectContaining({ queue: 'peopleBackfill' }));
  });

  it('skips when the feature is disabled (suggestionMaxDistance <= maxDistance)', async () => {
    mocks.systemMetadata.get.mockResolvedValue({
      machineLearning: { facialRecognition: { maxDistance: 0.5, suggestionMaxDistance: 0.5, minFaces: 3 } },
    });

    await expect(sut.handlePersonSuggestionScan({ id: 'person-1' })).resolves.toBe(JobStatus.Skipped);
    expect(mocks.person.getById).not.toHaveBeenCalled();
    expect(mocks.personFaceSuggestion.upsertPending).not.toHaveBeenCalled();
  });

  it('skips an unnamed / hidden / pet / missing person (edge 5, 7, 16)', async () => {
    mocks.systemMetadata.get.mockResolvedValue(enabled);

    mocks.person.getById.mockResolvedValueOnce(undefined);
    await expect(sut.handlePersonSuggestionScan({ id: 'gone' })).resolves.toBe(JobStatus.Skipped);

    mocks.person.getById.mockResolvedValueOnce({
      id: 'p',
      ownerId: 'u',
      name: '',
      isHidden: false,
      type: 'person',
    } as any);
    await expect(sut.handlePersonSuggestionScan({ id: 'p' })).resolves.toBe(JobStatus.Skipped);

    mocks.person.getById.mockResolvedValueOnce({
      id: 'p',
      ownerId: 'u',
      name: 'A',
      isHidden: true,
      type: 'person',
    } as any);
    await expect(sut.handlePersonSuggestionScan({ id: 'p' })).resolves.toBe(JobStatus.Skipped);

    mocks.person.getById.mockResolvedValueOnce({
      id: 'p',
      ownerId: 'u',
      name: 'Rex',
      isHidden: false,
      type: 'pet',
    } as any);
    await expect(sut.handlePersonSuggestionScan({ id: 'p' })).resolves.toBe(JobStatus.Skipped);

    expect(mocks.personFaceSuggestion.upsertPending).not.toHaveBeenCalled();
  });

  it('no-ops when the person has zero assigned-face embeddings (edge 15)', async () => {
    mocks.systemMetadata.get.mockResolvedValue(enabled);
    mocks.person.getById.mockResolvedValue({
      id: 'p',
      ownerId: 'u',
      name: 'A',
      isHidden: false,
      type: 'person',
    } as any);
    mocks.person.getAssignedFaceEmbeddings.mockResolvedValue([]);

    await expect(sut.handlePersonSuggestionScan({ id: 'p' })).resolves.toBe(JobStatus.Skipped);
    expect(mocks.search.searchFaces).not.toHaveBeenCalled();
    expect(mocks.personFaceSuggestion.upsertPending).not.toHaveBeenCalled();
  });

  it('keeps only the open band (maxDistance, suggestionMaxDistance], min distance per face, then upserts', async () => {
    mocks.systemMetadata.get.mockResolvedValue(enabled);
    mocks.person.getById.mockResolvedValue({
      id: 'p',
      ownerId: 'u',
      name: 'A',
      isHidden: false,
      type: 'person',
    } as any);
    mocks.person.getAssignedFaceEmbeddings.mockResolvedValue([{ embedding: 'e1' }, { embedding: 'e2' }] as any);
    mocks.search.searchFaces
      .mockResolvedValueOnce([
        { id: 'f-low', personId: null, distance: 0.45 }, // <= maxDistance → excluded (auto-assign band)
        { id: 'f-band', personId: null, distance: 0.7 }, // in band
        { id: 'f-edge', personId: null, distance: 0.8 }, // == suggestionMaxDistance → kept (closed upper)
      ] as any)
      .mockResolvedValueOnce([
        { id: 'f-band', personId: null, distance: 0.6 }, // same face, smaller distance → min wins
      ] as any);

    await expect(sut.handlePersonSuggestionScan({ id: 'p' })).resolves.toBe(JobStatus.Success);

    expect(mocks.search.searchFaces).toHaveBeenCalledTimes(2);
    expect(mocks.search.searchFaces).toHaveBeenCalledWith(
      expect.objectContaining({ userIds: ['u'], hasPerson: false, maxDistance: 0.8 }),
    );
    const rows = mocks.personFaceSuggestion.upsertPending.mock.calls[0][0];
    expect(rows).toEqual(
      expect.arrayContaining([
        { personId: 'p', assetFaceId: 'f-band', distance: 0.6 },
        { personId: 'p', assetFaceId: 'f-edge', distance: 0.8 },
      ]),
    );
    expect(rows).toHaveLength(2); // f-low excluded
  });

  it('caps embedding sample and candidate count (edge 14 — bounded work)', async () => {
    mocks.systemMetadata.get.mockResolvedValue(enabled);
    mocks.person.getById.mockResolvedValue({
      id: 'p',
      ownerId: 'u',
      name: 'A',
      isHidden: false,
      type: 'person',
    } as any);
    mocks.person.getAssignedFaceEmbeddings.mockResolvedValue([{ embedding: 'e' }] as any);
    mocks.search.searchFaces.mockResolvedValue([]);

    await sut.handlePersonSuggestionScan({ id: 'p' });

    expect(mocks.person.getAssignedFaceEmbeddings).toHaveBeenCalledWith('p', 20);
    expect(mocks.search.searchFaces).toHaveBeenCalledWith(expect.objectContaining({ numResults: 100 }));
  });
});
```

If `mocks.personFaceSuggestion` is not yet exposed on `ServiceMocks`, it already is —
Phase 1 added `personFaceSuggestion` to `test/utils.ts` (lines 253/341/414). `mocks.search`
and `mocks.person` exist.

**Step 2: Run it — expect failure**

Run: `cd server && pnpm test -- --run src/services/person.service.spec.ts -t handlePersonSuggestionScan`
Expected: FAIL — `sut.handlePersonSuggestionScan is not a function`.

**Step 3: Implement constants + handler**

Add the constants from the **Constants** section near `person.service.ts:68`. Then add the
handler next to `handleFaceIdentityBackfill` (after the
`getNextFaceIdentityBackfillContinuationId` helper, ~line 583):

```ts
  @OnJob({ name: JobName.PersonSuggestionScan, queue: QueueName.PeopleBackfill })
  async handlePersonSuggestionScan({ id }: JobOf<JobName.PersonSuggestionScan>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: true });
    const { maxDistance, suggestionMaxDistance } = machineLearning.facialRecognition;
    if (suggestionMaxDistance <= maxDistance) {
      return JobStatus.Skipped;
    }

    const person = await this.personRepository.getById(id);
    if (!person || person.name === '' || person.isHidden || person.type !== 'person') {
      return JobStatus.Skipped;
    }

    const embeddings = await this.personRepository.getAssignedFaceEmbeddings(
      id,
      PERSON_SUGGESTION_EMBEDDING_SAMPLE,
    );
    if (embeddings.length === 0) {
      return JobStatus.Skipped;
    }

    const bestByFace = new Map<string, number>();
    for (const { embedding } of embeddings) {
      const matches = await this.searchRepository.searchFaces({
        userIds: [person.ownerId],
        embedding,
        hasPerson: false,
        maxDistance: suggestionMaxDistance,
        numResults: PERSON_SUGGESTION_NUM_RESULTS,
      });
      for (const match of matches) {
        if (match.distance <= maxDistance) {
          continue; // [0, maxDistance] is auto-assign's band — never a suggestion
        }
        const prev = bestByFace.get(match.id);
        if (prev === undefined || match.distance < prev) {
          bestByFace.set(match.id, match.distance);
        }
      }
    }

    const rows = [...bestByFace].map(([assetFaceId, distance]) => ({ personId: id, assetFaceId, distance }));
    await this.personFaceSuggestionRepository.upsertPending(rows);
    return JobStatus.Success;
  }
```

Confirm `personFaceSuggestionRepository` is injected on `BaseService` (Phase 1 added it —
grep `base.service.ts` for `personFaceSuggestionRepository`). `searchRepository`,
`personRepository`, `JobOf`, `JobName`, `QueueName`, `JobStatus`, `OnJob` are already
imported in `person.service.ts`.

> **Note on `upsertPending([])`:** Phase-1 `upsertPending` early-returns on empty input, so a
> scan that finds nothing is a clean no-op (still `JobStatus.Success` — the scan ran).

**Step 4: Run it — expect pass**

Run: `cd server && pnpm test -- --run src/services/person.service.spec.ts -t handlePersonSuggestionScan`
Expected: PASS (all new cases).

**Step 5: Commit**

```bash
git add server/src/services/person.service.ts server/src/services/person.service.spec.ts
git commit -m "feat(server): add handlePersonSuggestionScan job (bounded, feature-gated)"
```

---

### Task 4: `handlePersonSuggestionScanQueueAll` — the chunked fan-out

Streams scannable people and enqueues one bounded `PersonSuggestionScan` each, batched at
`JOBS_ASSET_PAGINATION_SIZE` exactly like `handleQueueRecognizeFaces`
(`person.service.ts:830-846`). Feature-gated.

**Files:**

- Modify: `server/src/services/person.service.ts` (new `@OnJob` handler beside Task 3's)
- Test: `server/src/services/person.service.spec.ts`
  (`describe('handlePersonSuggestionScanQueueAll')`)

**Step 1: Write the failing unit tests**

```ts
describe('handlePersonSuggestionScanQueueAll', () => {
  const enabled = {
    machineLearning: { facialRecognition: { maxDistance: 0.5, suggestionMaxDistance: 0.8, minFaces: 3 } },
  };

  it('runs on the people backfill queue', () => {
    const config = new Reflector().get(MetadataKey.JobConfig, sut.handlePersonSuggestionScanQueueAll);
    expect(config).toEqual(expect.objectContaining({ queue: 'peopleBackfill' }));
  });

  it('skips and enumerates nothing when the feature is disabled', async () => {
    mocks.systemMetadata.get.mockResolvedValue({
      machineLearning: { facialRecognition: { maxDistance: 0.5, suggestionMaxDistance: 0, minFaces: 3 } },
    });

    await expect(sut.handlePersonSuggestionScanQueueAll({})).resolves.toBe(JobStatus.Skipped);
    expect(mocks.person.getScannablePeopleWithUnassignedFaces).not.toHaveBeenCalled();
    expect(mocks.job.queueAll).not.toHaveBeenCalled();
  });

  it('queues one PersonSuggestionScan per scannable person', async () => {
    mocks.systemMetadata.get.mockResolvedValue(enabled);
    mocks.person.getScannablePeopleWithUnassignedFaces.mockReturnValue(
      makeStream([
        { id: 'p1', ownerId: 'u' },
        { id: 'p2', ownerId: 'u' },
      ]),
    );

    await expect(sut.handlePersonSuggestionScanQueueAll({})).resolves.toBe(JobStatus.Success);

    expect(mocks.job.queueAll).toHaveBeenCalledWith([
      { name: JobName.PersonSuggestionScan, data: { id: 'p1' } },
      { name: JobName.PersonSuggestionScan, data: { id: 'p2' } },
    ]);
  });

  it('empty library → success, no scan jobs', async () => {
    mocks.systemMetadata.get.mockResolvedValue(enabled);
    mocks.person.getScannablePeopleWithUnassignedFaces.mockReturnValue(makeStream([]));

    await expect(sut.handlePersonSuggestionScanQueueAll({})).resolves.toBe(JobStatus.Success);
    expect(mocks.job.queueAll).toHaveBeenCalledWith([]);
  });
});
```

`makeStream` is already imported at spec line 37 (`from 'test/utils'`) and used by the
existing `handleQueueRecognizeFaces` tests — reuse it.

**Step 2: Run it — expect failure**

Run: `cd server && pnpm test -- --run src/services/person.service.spec.ts -t handlePersonSuggestionScanQueueAll`
Expected: FAIL — `sut.handlePersonSuggestionScanQueueAll is not a function`.

**Step 3: Implement the handler**

Beside Task 3's handler:

```ts
  @OnJob({ name: JobName.PersonSuggestionScanQueueAll, queue: QueueName.PeopleBackfill })
  async handlePersonSuggestionScanQueueAll(
    _data: JobOf<JobName.PersonSuggestionScanQueueAll>,
  ): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: false });
    const { maxDistance, suggestionMaxDistance } = machineLearning.facialRecognition;
    if (suggestionMaxDistance <= maxDistance) {
      return JobStatus.Skipped;
    }

    let jobs: { name: JobName.PersonSuggestionScan; data: { id: string } }[] = [];
    for await (const person of this.personRepository.getScannablePeopleWithUnassignedFaces()) {
      jobs.push({ name: JobName.PersonSuggestionScan, data: { id: person.id } });
      if (jobs.length === JOBS_ASSET_PAGINATION_SIZE) {
        await this.jobRepository.queueAll(jobs);
        jobs = [];
      }
    }
    await this.jobRepository.queueAll(jobs);
    return JobStatus.Success;
  }
```

`JOBS_ASSET_PAGINATION_SIZE` is already imported in `person.service.ts` (used by
`handleQueueRecognizeFaces`).

**Step 4: Run it — expect pass**

Run: `cd server && pnpm test -- --run src/services/person.service.spec.ts -t handlePersonSuggestionScanQueueAll`
Expected: PASS.

**Step 5: Commit**

```bash
git add server/src/services/person.service.ts server/src/services/person.service.spec.ts
git commit -m "feat(server): add handlePersonSuggestionScanQueueAll chunked fan-out"
```

---

### Task 5: Chain `PersonSuggestionScanQueueAll` after `FaceIdentityBackfill` (edge 19)

`PersonSuggestionScanQueueAll` must be enqueued **only at the terminal of
`handleFaceIdentityBackfill`** — the same point that queues `SharedSpacePersonMetadataBackfill`
via `queueSpacePersonMetadataBackfill()` (`person.service.ts:574-576`), reached only when all
cursor pages, continuations, and projection targets are drained. This guarantees suggestions
are computed against the post-maintenance assignment state (edge 19). Feature-gated so a
disabled feature adds zero jobs and the chain is byte-for-byte unchanged.

**Files:**

- Modify: `server/src/services/person.service.ts` (terminal block of
  `handleFaceIdentityBackfill`, ~lines 572-578)
- Test: `server/src/services/person.service.spec.ts` (extend
  `describe('handleFaceIdentityBackfill')`)

**Step 1: Write the failing unit tests**

Add inside the existing `describe('handleFaceIdentityBackfill')` (after the test at spec
line 2347 "queues one metadata backfill when identity work completes…"):

```ts
it('chains PersonSuggestionScanQueueAll when backfill completes and the feature is enabled (edge 19)', async () => {
  mocks.systemMetadata.get.mockResolvedValue({
    machineLearning: { facialRecognition: { maxDistance: 0.5, suggestionMaxDistance: 0.8, minFaces: 3 } },
  });
  mocks.faceIdentity.backfillPersonalIdentities.mockResolvedValue({ processed: 0 });
  mocks.faceIdentity.backfillSpacePersonIdentities.mockResolvedValue({ processed: 0, conflictCount: 0 });
  (mocks.faceIdentity as any).getBackfillWork.mockResolvedValue({
    hasPersonalIdentityWork: false,
    hasSpacePersonIdentityWork: false,
    hasSharedSpaceProjectionWork: false,
  });

  await expect(sut.handleFaceIdentityBackfill({ stage: 'person' })).resolves.toBe(JobStatus.Success);

  expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.PersonSuggestionScanQueueAll, data: {} });
});

it('does NOT chain PersonSuggestionScanQueueAll when the feature is disabled', async () => {
  mocks.systemMetadata.get.mockResolvedValue({
    machineLearning: { facialRecognition: { maxDistance: 0.5, suggestionMaxDistance: 0, minFaces: 3 } },
  });
  mocks.faceIdentity.backfillPersonalIdentities.mockResolvedValue({ processed: 0 });
  mocks.faceIdentity.backfillSpacePersonIdentities.mockResolvedValue({ processed: 0, conflictCount: 0 });
  (mocks.faceIdentity as any).getBackfillWork.mockResolvedValue({
    hasPersonalIdentityWork: false,
    hasSpacePersonIdentityWork: false,
    hasSharedSpaceProjectionWork: false,
  });

  await expect(sut.handleFaceIdentityBackfill({ stage: 'person' })).resolves.toBe(JobStatus.Success);

  expect(mocks.job.queue).not.toHaveBeenCalledWith({ name: JobName.PersonSuggestionScanQueueAll, data: {} });
});

it('does NOT chain PersonSuggestionScanQueueAll while cursor pages remain (edge 19 — strictly after)', async () => {
  mocks.systemMetadata.get.mockResolvedValue({
    machineLearning: { facialRecognition: { maxDistance: 0.5, suggestionMaxDistance: 0.8, minFaces: 3 } },
  });
  mocks.faceIdentity.backfillPersonalIdentities.mockResolvedValue({ processed: 1000, nextCursor: 'c' });
  mocks.faceIdentity.backfillSpacePersonIdentities.mockResolvedValue({ processed: 0, conflictCount: 0 });

  await expect(sut.handleFaceIdentityBackfill({ stage: 'person' })).resolves.toBe(JobStatus.Success);

  expect(mocks.job.queue).not.toHaveBeenCalledWith({ name: JobName.PersonSuggestionScanQueueAll, data: {} });
});
```

> The existing terminal tests (e.g. spec:2347 "queues one metadata backfill…",
> spec:2358 `expect(mocks.job.queue).toHaveBeenCalledTimes(1)`) will now see **2** queue
> calls when the feature is enabled. Those existing tests do **not** set
> `suggestionMaxDistance`, so under the default/whatever stub they must still pass — verify
> the config the existing tests mock yields `suggestionMaxDistance <= maxDistance` (disabled).
> If an existing terminal test mocks a config where the feature would be on, update only that
> test's expectation; do not weaken the new assertions. Run the full
> `handleFaceIdentityBackfill` describe in Step 4 to catch this.

**Step 2: Run it — expect failure**

Run: `cd server && pnpm test -- --run src/services/person.service.spec.ts -t handleFaceIdentityBackfill`
Expected: FAIL on the two new "chains/feature-enabled" cases (no chaining yet).

**Step 3: Implement the chaining**

In `handleFaceIdentityBackfill`, the terminal block currently reads
(`person.service.ts:572-578`):

```ts
const queuedTargets = await this.queueSharedSpaceFaceMatchTargets([...pendingTargets, ...affectedSpaceAssets]);
await this.faceIdentityRepository.deletePendingSharedSpaceFaceMatchBackfillTargets(pendingTargets);
if (queuedTargets.length === 0) {
  await this.queueSpacePersonMetadataBackfill();
}

return JobStatus.Success;
```

Chain the suggestion fan-out at **exactly the same terminal point** that enqueues
`SharedSpacePersonMetadataBackfill` — _inside_ the `if (queuedTargets.length === 0)` block,
immediately after `queueSpacePersonMetadataBackfill()`, feature-gated:

```ts
const queuedTargets = await this.queueSharedSpaceFaceMatchTargets([...pendingTargets, ...affectedSpaceAssets]);
await this.faceIdentityRepository.deletePendingSharedSpaceFaceMatchBackfillTargets(pendingTargets);
if (queuedTargets.length === 0) {
  await this.queueSpacePersonMetadataBackfill();

  const { machineLearning } = await this.getConfig({ withCache: true });
  const { maxDistance, suggestionMaxDistance } = machineLearning.facialRecognition;
  if (suggestionMaxDistance > maxDistance) {
    await this.jobRepository.queue({ name: JobName.PersonSuggestionScanQueueAll, data: {} });
  }
}

return JobStatus.Success;
```

> **Placement rationale (corrected).** `queuedTargets.length === 0` is this codebase's
> canonical "face-identity backfill fully drained, nothing more queued" signal — it is the
> exact gate the existing `SharedSpacePersonMetadataBackfill` uses. Reaching it requires
> every cursor page (`result.nextCursor` early-returns above), every bounded continuation
> (`getBackfillWork` early-returns above), and the shared-space projection fan-out to be
> exhausted, so the enqueue is **strictly after `FaceIdentityBackfill` completes** (edge 19)
> and fires **exactly once** per full drain. Putting it _outside_ the guard would enqueue on
> partial-drain passes where shared-space targets are still queued — inconsistent with the
> established terminal signal and the plan's own intro ("the same point that queues
> `SharedSpacePersonMetadataBackfill`"). The theoretical "never fires if `queuedTargets` is
> perpetually > 0" is the **identical, already-accepted tradeoff** of
> `SharedSpacePersonMetadataBackfill`; in practice `deletePendingSharedSpaceFaceMatchBackfillTargets`
> drains pending targets so a later cycle reaches `=== 0`. This keeps Phase 2 consistent
> with the existing terminal, not novel.

**Step 4: Run it — expect pass + full describe regression**

```bash
cd server && pnpm test -- --run src/services/person.service.spec.ts -t handleFaceIdentityBackfill
```

Expected: PASS for the new cases **and** every pre-existing `handleFaceIdentityBackfill`
test. If a pre-existing terminal test now fails on a queue-call count, inspect its mocked
config: if it does not set `suggestionMaxDistance`, the stub default must be disabled
(`0 <= maxDistance`) → no extra job → it should still pass. Only adjust a pre-existing test
if it explicitly mocks the feature on.

**Step 5: Commit**

```bash
git add server/src/services/person.service.ts server/src/services/person.service.spec.ts
git commit -m "feat(server): chain PersonSuggestionScanQueueAll after FaceIdentityBackfill"
```

---

### Task 6: On-name single-person trigger in `PersonService.update` (edges 5, 6, 7)

Enqueue a single `PersonSuggestionScan` when an `update` transitions a person **into** a
scannable, named state. Requires a pre-update read (the method does not currently read the
prior row). Fires on `'' → named` (edge 5) and `renameA→B` (edge 6); does **not** fire on
color/birthDate/favorite/visibility edits, on becoming hidden, on name-cleared, or while
still unnamed (edge 7). Feature-gated.

**Gate:** `featureEnabled && nowScannable && prior && prior.name !== person.name` where
`nowScannable = person.name !== '' && !person.isHidden && person.type === 'person'`.
Walk-through:

| transition                                                   | prior.name | person.name | nowScannable | fires?                     |
| ------------------------------------------------------------ | ---------- | ----------- | ------------ | -------------------------- |
| name a cluster (edge 5)                                      | `''`       | `'Alice'`   | ✓            | **yes**                    |
| rename A→B (edge 6)                                          | `'Alice'`  | `'Bob'`     | ✓            | **yes**                    |
| color/favorite/birthDate edit (name dto omitted → unchanged) | `'Alice'`  | `'Alice'`   | ✓            | no (name unchanged)        |
| name cleared (edge 7)                                        | `'Alice'`  | `''`        | ✗            | no                         |
| becomes hidden                                               | `'Alice'`  | `'Alice'`   | ✗            | no (name unchanged anyway) |
| still unnamed, birthDate edit                                | `''`       | `''`        | ✗            | no                         |

**Files:**

- Modify: `server/src/services/person.service.ts` (`update`, lines 419-457)
- Test: `server/src/services/person.service.spec.ts` (extend `describe('update')`,
  starts spec line 687)

**Step 1: Write the failing unit tests**

Add inside `describe('update')`. **Fixture API is pinned to the real conventions in this
spec** (`person.service.spec.ts:687-736`): `AuthFactory.create()` (imported spec:24),
`PersonFactory.create({...})` (imported spec:25), `mocks.access.person.checkOwnerAccess`,
`mocks.person.update`, `mocks.person.getById` (used spec:692). Build the prior/updated pair
from one factory person via spread so `id`/`ownerId` stay consistent:

```ts
describe('suggestion on-name trigger', () => {
  const enabled = {
    machineLearning: { facialRecognition: { maxDistance: 0.5, suggestionMaxDistance: 0.8, minFaces: 3 } },
  };

  it('enqueues a scan when an unnamed cluster is named (edge 5)', async () => {
    mocks.systemMetadata.get.mockResolvedValue(enabled);
    const auth = AuthFactory.create();
    const prior = PersonFactory.create({ name: '', isHidden: false });
    mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([prior.id]));
    mocks.person.getById.mockResolvedValue(prior);
    mocks.person.update.mockResolvedValue({ ...prior, name: 'Alice' });

    await sut.update(auth, prior.id, { name: 'Alice' });

    expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.PersonSuggestionScan, data: { id: prior.id } });
  });

  it('enqueues a scan on rename of an already-named person (edge 6)', async () => {
    mocks.systemMetadata.get.mockResolvedValue(enabled);
    const auth = AuthFactory.create();
    const prior = PersonFactory.create({ name: 'Alice', isHidden: false });
    mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([prior.id]));
    mocks.person.getById.mockResolvedValue(prior);
    mocks.person.update.mockResolvedValue({ ...prior, name: 'Bob' });

    await sut.update(auth, prior.id, { name: 'Bob' });

    expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.PersonSuggestionScan, data: { id: prior.id } });
  });

  it('does NOT enqueue on a color/favorite/birthDate edit (name unchanged) (edge 7)', async () => {
    mocks.systemMetadata.get.mockResolvedValue(enabled);
    const auth = AuthFactory.create();
    const prior = PersonFactory.create({ name: 'Alice', isHidden: false });
    mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([prior.id]));
    mocks.person.getById.mockResolvedValue(prior);
    mocks.person.update.mockResolvedValue({ ...prior }); // name unchanged

    await sut.update(auth, prior.id, { isFavorite: true });

    expect(mocks.job.queue).not.toHaveBeenCalledWith({
      name: JobName.PersonSuggestionScan,
      data: { id: prior.id },
    });
  });

  it('does NOT enqueue when name is cleared (edge 7)', async () => {
    mocks.systemMetadata.get.mockResolvedValue(enabled);
    const auth = AuthFactory.create();
    const prior = PersonFactory.create({ name: 'Alice', isHidden: false });
    mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([prior.id]));
    mocks.person.getById.mockResolvedValue(prior);
    mocks.person.update.mockResolvedValue({ ...prior, name: '' });

    await sut.update(auth, prior.id, { name: '' });

    expect(mocks.job.queue).not.toHaveBeenCalledWith({
      name: JobName.PersonSuggestionScan,
      data: { id: prior.id },
    });
  });

  it('does NOT enqueue when a person becomes hidden (edge 7)', async () => {
    mocks.systemMetadata.get.mockResolvedValue(enabled);
    const auth = AuthFactory.create();
    const prior = PersonFactory.create({ name: 'Alice', isHidden: false });
    mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([prior.id]));
    mocks.person.getById.mockResolvedValue(prior);
    mocks.person.update.mockResolvedValue({ ...prior, isHidden: true }); // name unchanged

    await sut.update(auth, prior.id, { isHidden: true });

    expect(mocks.job.queue).not.toHaveBeenCalledWith({
      name: JobName.PersonSuggestionScan,
      data: { id: prior.id },
    });
  });

  it('does NOT enqueue when the feature is disabled', async () => {
    mocks.systemMetadata.get.mockResolvedValue({
      machineLearning: { facialRecognition: { maxDistance: 0.5, suggestionMaxDistance: 0, minFaces: 3 } },
    });
    const auth = AuthFactory.create();
    const prior = PersonFactory.create({ name: '', isHidden: false });
    mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([prior.id]));
    mocks.person.getById.mockResolvedValue(prior);
    mocks.person.update.mockResolvedValue({ ...prior, name: 'Alice' });

    await sut.update(auth, prior.id, { name: 'Alice' });

    expect(mocks.job.queue).not.toHaveBeenCalledWith({
      name: JobName.PersonSuggestionScan,
      data: { id: prior.id },
    });
  });
});
```

> If `PersonFactory.create` does not accept `name`/`isHidden` overrides, set them on the
> returned object before mocking (`const prior = PersonFactory.create(); prior.name = '';
prior.isHidden = false;`). The behavioral assertions (`mocks.job.queue` called / not called
> with `PersonSuggestionScan`) are the contract; the factory mechanics are flexible.

**Step 2: Run it — expect failure**

Run: `cd server && pnpm test -- --run src/services/person.service.spec.ts -t "suggestion on-name trigger"`
Expected: FAIL — no scan is queued (trigger not implemented).

**Step 3: Implement the trigger**

In `update` (`person.service.ts:419`), add a pre-update read after the access check, and the
trigger after the existing post-update queues (before `return mapPerson(person)`, line 456):

```ts
  async update(auth: AuthDto, id: string, dto: PersonUpdateDto): Promise<PersonResponseDto> {
    await this.requireAccess({ auth, permission: Permission.PersonUpdate, ids: [id] });

    const prior = await this.personRepository.getById(id);

    // ... unchanged body through `const person = await this.personRepository.update({...});`
    // ... unchanged thumbnail + SharedSpacePersonMetadataBackfill queues ...

    const { machineLearning } = await this.getConfig({ withCache: true });
    const { maxDistance, suggestionMaxDistance } = machineLearning.facialRecognition;
    const featureEnabled = suggestionMaxDistance > maxDistance;
    const nowScannable = person.name !== '' && !person.isHidden && person.type === 'person';
    if (featureEnabled && nowScannable && prior && prior.name !== person.name) {
      await this.jobRepository.queue({ name: JobName.PersonSuggestionScan, data: { id } });
    }

    return mapPerson(person);
  }
```

Do **not** remove or reorder the existing `assetId`/`identityId` logic — only add the
`prior` read near the top and the trigger block just before `return mapPerson(person)`.

> Why `prior.name !== person.name` and not a separate "was unnamed" flag: when `dto.name` is
> omitted (color/favorite/visibility edits), `personRepository.update` preserves the existing
> name, so `person.name === prior.name` and the trigger correctly does not fire. The
> dedicated "does NOT enqueue on favorite edit" test asserts exactly this — keep it.

**Step 4: Run it — expect pass + full `update` regression**

```bash
cd server && pnpm test -- --run src/services/person.service.spec.ts -t "update"
```

Expected: all new on-name cases PASS and every pre-existing `update` test still green.

> **Why pre-existing `update` tests stay green (verified):** `update` did not previously call
> `getConfig`; the existing `describe('update')` tests therefore do **not** mock
> `systemMetadata.get`. With it unmocked, `getConfig` falls back to `defaults`
> (`config.ts` → `facialRecognition: { maxDistance: 0.5, suggestionMaxDistance: 0 }`), so
> `suggestionMaxDistance (0) > maxDistance (0.5)` is **false** → feature off → no
> `PersonSuggestionScan` is queued → existing assertions are unaffected. **Do not add config
> mocks to existing tests.** Likewise the new `prior = getById(id)` read: existing tests
> don't set `mocks.person.getById`, so it resolves to the automock default (`undefined`) →
> `prior` falsy → trigger short-circuits. Only if a pre-existing test asserts an _exact_
> `mocks.person.*` call list (none currently do in 687-836) add a
> `mocks.person.getById.mockResolvedValue(...)` default there. Run the full
> `describe('update')` in Step 4 to confirm.

**Step 5: Commit**

```bash
git add server/src/services/person.service.ts server/src/services/person.service.spec.ts
git commit -m "feat(server): enqueue PersonSuggestionScan on person naming/rename"
```

---

### Task 7: Edge-1 regression, queue-placement guard, final gates

**Files:**

- Test: `server/src/services/person.service.spec.ts` (two guard tests)
- No generated files: Phase 2 adds **no** `@GenerateSql` method and **no** API — `make sql`
  and `make open-api` are not run.

**Step 1: Edge-1 + queue-placement guard tests**

Add to `describe('handlePersonSuggestionScan')`:

```ts
it('never resurrects a resolved decision — delegates the guarantee to upsertPending (edge 1, 2)', async () => {
  mocks.systemMetadata.get.mockResolvedValue({
    machineLearning: { facialRecognition: { maxDistance: 0.5, suggestionMaxDistance: 0.8, minFaces: 3 } },
  });
  mocks.person.getById.mockResolvedValue({ id: 'p', ownerId: 'u', name: 'A', isHidden: false, type: 'person' } as any);
  mocks.person.getAssignedFaceEmbeddings.mockResolvedValue([{ embedding: 'e' }] as any);
  mocks.search.searchFaces.mockResolvedValue([{ id: 'f-dismissed', personId: null, distance: 0.7 }] as any);

  await sut.handlePersonSuggestionScan({ id: 'p' });

  // The scan unconditionally calls the conditional upsert; the WHERE status='pending'
  // guard (Phase 1, proven in person-face-suggestion.repository.spec.ts) is the single
  // source of the never-resurrect guarantee. The job must not pre-filter resolved rows.
  expect(mocks.personFaceSuggestion.upsertPending).toHaveBeenCalledWith([
    { personId: 'p', assetFaceId: 'f-dismissed', distance: 0.7 },
  ]);
});
```

Add a queue-placement guard in `describe('handleRecognizeFaces')` (the design's
"jobs never enqueued onto FacialRecognition" + "handleRecognizeFaces unchanged when feature
disabled"):

```ts
it('does not enqueue any PersonSuggestionScan from the recognition path (zero-regression)', async () => {
  // Pick any existing handleRecognizeFaces happy-path setup in this describe and assert:
  expect(mocks.job.queue).not.toHaveBeenCalledWith(expect.objectContaining({ name: JobName.PersonSuggestionScan }));
  expect(mocks.job.queue).not.toHaveBeenCalledWith(
    expect.objectContaining({ name: JobName.PersonSuggestionScanQueueAll }),
  );
});
```

> Place the guard after an existing `handleRecognizeFaces` invocation in that describe
> (reuse the nearest happy-path test's arrange/act, or add the two `expect` lines to it).
> The point is a standing guard that Phase 2 did not couple the hot recognition path to
> suggestions (edge 1 zero-regression; design "handleRecognizeFaces unchanged").

**Step 2: Run the full person.service suite**

Run: `cd server && pnpm test -- --run src/services/person.service.spec.ts`
Expected: PASS (entire file).

**Step 3: No `make sql` / `make open-api`**

Phase 2 adds **no** `@GenerateSql`-decorated method (the only new repo method,
`getScannablePeopleWithUnassignedFaces`, is an undecorated `.stream()` enumeration like
`getAll`/`getAllFaces`) and **no** API. So `make sql` would produce an empty diff and is not
run; `make open-api` is not run. This keeps Phase 2 free of generated-file churn (consistent
with the "no API changes" scope; memory `feedback_ci_generated_files` does not apply — no
decorated query was added or changed).

**Step 4: Full Phase-2 regression**

```bash
cd server && pnpm test -- --run src/services/person.service.spec.ts
cd server && pnpm test:medium -- --run test/medium/specs/repositories/person.repository.spec.ts
make check-server
```

Expected: all green; `make check-server` clean; `git status` shows **no** changes under
`server/src/queries/` or `open-api/`.

**Step 5: Commit**

```bash
git add server/src/services/person.service.spec.ts
git commit -m "test(server): edge-1 + recognition zero-regression guards"
```

---

## Phase 2 exit criteria

- `JobName.PersonSuggestionScan` / `PersonSuggestionScanQueueAll` + payload types exist;
  both handlers decorated `@OnJob(... queue: QueueName.PeopleBackfill)` — **never**
  `FacialRecognition` (asserted).
- `handlePersonSuggestionScan`: feature-gated; skips unnamed/hidden/pet/missing person and
  zero-embedding person (edges 5, 7, 15, 16); enforces the open band
  `(maxDistance, suggestionMaxDistance]`; min distance per candidate; bounded by the ≤20 /
  ≤100 caps (edge 14); delegates never-resurrect to Phase-1 `upsertPending` (edges 1, 2).
- `handlePersonSuggestionScanQueueAll`: feature-gated; one scan per scannable person, batched
  at `JOBS_ASSET_PAGINATION_SIZE`; empty library → no jobs.
- `PersonSuggestionScanQueueAll` chained **strictly after** `FaceIdentityBackfill` fully
  drains, feature-gated; not enqueued mid-cursor (edge 19).
- `PersonService.update` enqueues a single scan only on a true transition into a scannable,
  named state (edges 5, 6); silent on color/favorite/birthDate/visibility/name-clear/hidden
  edits and while unnamed (edge 7); feature-gated.
- Recognition path proven untouched (edge 1 zero-regression guard).
- `make check-server` clean; **no** generated-file changes (`make sql` / `make open-api` not
  run — no `@GenerateSql` method or API added); **no** API/UI/OpenAPI changes.

**Not in this phase (Phase 3+):** `GET/POST /people/:id/face-suggestions`, DTOs, the
Confirm/Dismiss resolve-in-reassign hook, web UI. The repository `resolveAssignedFace` and
`getPendingForPerson` from Phase 1 still have no caller after Phase 2 — that is intentional;
they are wired by Phase 3 (API) and Phase 4 (UI).
