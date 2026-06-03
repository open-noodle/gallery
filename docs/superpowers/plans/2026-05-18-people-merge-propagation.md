# People Merge Propagation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement manual people merge propagation so personal and shared-space merges collapse the same identities across personal people and shared spaces while preserving local metadata and keeping automatic reconciliation conservative.

**Architecture:** Add a focused `IdentityMergePropagationService` helper created from existing repositories in `BaseService`, following the existing core/helper pattern instead of adding broad constructor injection to `PersonService` and `SharedSpaceService`. The helper builds a structured plan, executes profile merges before identity collapse, and queues follow-up work. Existing personal and shared-space merge entry points keep permission validation and delegate the manual propagation behavior to the helper.

**Tech Stack:** NestJS services, TypeScript, Kysely/Postgres, Vitest unit tests, Vitest medium database tests, existing Gallery/Immich repository and job infrastructure.

---

## Source Spec

- Design spec: `docs/superpowers/specs/2026-05-18-people-merge-propagation-design.md`
- Worktree: `/home/pierre/dev/gallery/.worktrees/people-merge-propagation`

## Required TDD Process

For every behavior:

1. Write the smallest failing test first.
2. Run the focused test and confirm it fails for the expected reason.
3. Implement the minimum code to pass.
4. Re-run the focused test and relevant surrounding tests.
5. Refactor only while tests stay green.

Do not write production propagation code before the failing test for that behavior exists and has been observed failing.

## File Map

Create:

- `server/src/services/identity-merge-propagation.service.ts` - central propagation planner and executor.
- `server/src/services/identity-merge-propagation.service.spec.ts` - unit tests for planner, service-level execution, follow-up jobs, and activity fanout.
- `server/test/medium/specs/services/identity-merge-propagation.service.spec.ts` - database-backed transaction, uniqueness, rollback, and concurrency tests.

Modify:

- `server/src/services/base.service.ts` - instantiate a protected propagation helper from existing repositories.
- `server/src/services/person.service.ts` - keep access validation, delegate manual personal merges.
- `server/src/services/person.service.spec.ts` - assert personal merge delegates only after validation and preserves bulk failure behavior.
- `server/src/services/shared-space.service.ts` - keep editor+ validation, delegate manual shared-space merges.
- `server/src/services/shared-space.service.spec.ts` - assert shared-space merge validation and conservative automatic reconciliation.
- `server/src/repositories/database.repository.ts` - add a typed transaction helper.
- `server/src/repositories/face-identity.repository.ts` - profile lookup, identity ensuring with caller transaction, identity collapse after profile resolution.
- `server/src/repositories/person.repository.ts` - transactional personal profile merge helper.
- `server/src/repositories/shared-space.repository.ts` - transactional shared-space profile merge helper, profile lookup by identities, and transaction-aware activity logging.

Prefer the `BaseService` helper approach:

```ts
// server/src/services/base.service.ts
import { IdentityMergePropagationService } from 'src/services/identity-merge-propagation.service';

export class BaseService {
  protected identityMergePropagationService: IdentityMergePropagationService;

  constructor(/* existing repository arguments stay in place */) {
    // existing setup
    this.identityMergePropagationService = new IdentityMergePropagationService({
      logger: this.logger,
      databaseRepository: this.databaseRepository,
      faceIdentityRepository: this.faceIdentityRepository,
      jobRepository: this.jobRepository,
      personRepository: this.personRepository,
      sharedSpaceRepository: this.sharedSpaceRepository,
    });
  }
}
```

This avoids changing every service constructor and keeps the feature central.

## Verification Commands

Use focused commands during TDD:

```bash
pnpm --filter immich test -- --run src/services/identity-merge-propagation.service.spec.ts
pnpm --filter immich test -- --run src/services/person.service.spec.ts src/services/shared-space.service.spec.ts
pnpm --filter immich test:medium -- --run test/medium/specs/services/identity-merge-propagation.service.spec.ts
```

Use broader verification before finishing a slice:

```bash
pnpm --filter immich test -- --run src/services/identity-merge-propagation.service.spec.ts src/services/person.service.spec.ts src/services/shared-space.service.spec.ts
pnpm --filter immich test:medium -- --run test/medium/specs/services/identity-merge-propagation.service.spec.ts
pnpm --filter immich check
```

## Task 1: Slice 1, Personal-Origin Planning

**Files:**

- Create: `server/src/services/identity-merge-propagation.service.ts`
- Create: `server/src/services/identity-merge-propagation.service.spec.ts`
- Modify: `server/src/services/base.service.ts`
- Modify: `server/src/repositories/face-identity.repository.ts`

- [ ] **Step 1: Write failing planner tests for personal-origin propagation**

Add `server/src/services/identity-merge-propagation.service.spec.ts` with tests named:

```ts
describe('IdentityMergePropagationService', () => {
  describe('buildPersonalMergePlan', () => {
    it('plans personal merge propagation into duplicate space people across multiple spaces', async () => {});
    it('keeps a single affected space profile and updates it to the target identity', async () => {});
    it('uses deterministic survivor fallback outside the initiating scope', async () => {});
    it('deduplicates duplicate source ids before planning', async () => {});
    it('ensures origin profiles with missing identities before planning attached profiles', async () => {});
    it('ignores source identity ids already equal to the target identity', async () => {});
    it('rejects missing initiating target or source profiles before execution', async () => {});
    it('rejects mixed person and pet identities before execution', async () => {});
    it('includes actor, follow-up jobs, and propagated activity events in the plan', async () => {});
  });
});
```

The first test should arrange:

```ts
const target = {
  kind: 'person',
  id: 'person-x',
  ownerId: 'owner-1',
  identityId: 'identity-x',
  type: 'person',
  name: 'X',
  faceCount: 10,
};
const source = {
  kind: 'person',
  id: 'person-y',
  ownerId: 'owner-1',
  identityId: 'identity-y',
  type: 'person',
  name: 'Y',
  faceCount: 4,
};
const spaceAX = {
  kind: 'space-person',
  id: 'space-a-x',
  spaceId: 'space-a',
  identityId: 'identity-x',
  type: 'person',
  name: 'X',
  faceCount: 3,
};
const spaceAY = {
  kind: 'space-person',
  id: 'space-a-y',
  spaceId: 'space-a',
  identityId: 'identity-y',
  type: 'person',
  name: 'Y',
  faceCount: 2,
};
const spaceBX = {
  kind: 'space-person',
  id: 'space-b-x',
  spaceId: 'space-b',
  identityId: 'identity-x',
  type: 'person',
  name: 'X',
  faceCount: 8,
};
const spaceBY = {
  kind: 'space-person',
  id: 'space-b-y',
  spaceId: 'space-b',
  identityId: 'identity-y',
  type: 'person',
  name: 'Y',
  faceCount: 1,
};
```

Expected plan assertions:

```ts
expect(plan.actorUserId).toBe('owner-1');
expect(plan.origin).toEqual({
  type: 'person',
  targetProfileId: 'person-x',
  sourceProfileIds: ['person-y'],
  ownerId: 'owner-1',
});
expect(plan.targetIdentityId).toBe('identity-x');
expect(plan.sourceIdentityIds).toEqual(['identity-y']);
expect(plan.personalProfileMerges).toEqual([
  { ownerId: 'owner-1', targetPersonId: 'person-x', sourcePersonIds: ['person-y'] },
]);
expect(plan.spaceProfileMerges).toEqual([
  { spaceId: 'space-a', targetPersonId: 'space-a-x', sourcePersonIds: ['space-a-y'] },
  { spaceId: 'space-b', targetPersonId: 'space-b-x', sourcePersonIds: ['space-b-y'] },
]);
expect(plan.affectedSpaceIds).toEqual(['space-a', 'space-b']);
expect(plan.followUpJobs).toEqual([
  { name: JobName.SharedSpacePersonMetadataBackfill, data: { identityId: 'identity-x' } },
  { name: JobName.SharedSpacePersonDedup, data: { spaceId: 'space-a' } },
  { name: JobName.SharedSpacePersonDedup, data: { spaceId: 'space-b' } },
]);
expect(plan.activityEvents).toEqual([
  expect.objectContaining({ spaceId: 'space-a', userId: 'owner-1', type: SharedSpaceActivityType.PersonMerge }),
  expect.objectContaining({ spaceId: 'space-b', userId: 'owner-1', type: SharedSpaceActivityType.PersonMerge }),
]);
```

- [ ] **Step 2: Run the failing planner tests**

Run:

```bash
pnpm --filter immich test -- --run src/services/identity-merge-propagation.service.spec.ts
```

Expected: failure because `IdentityMergePropagationService` does not exist or `buildPersonalMergePlan` is not implemented.

- [ ] **Step 3: Add the initial service types and minimal planner**

Create `server/src/services/identity-merge-propagation.service.ts` with these public types and methods:

```ts
import { JobName, SharedSpaceActivityType } from 'src/enum';

export type MergeProfileKind = 'person' | 'space-person';

export type MergeProfile = {
  kind: MergeProfileKind;
  id: string;
  ownerId?: string;
  spaceId?: string;
  identityId: string | null;
  type: string;
  name: string;
  faceCount: number;
};

export type ProfileMergeStep = {
  targetPersonId: string;
  sourcePersonIds: string[];
};

export type PersonalProfileMergeStep = ProfileMergeStep & { ownerId: string };
export type SpaceProfileMergeStep = ProfileMergeStep & { spaceId: string };

export type MergePropagationActivityPayload = {
  originScope: MergeProfileKind;
  actorUserId: string;
  activityRole: 'initiating' | 'propagated';
  originatingSpaceId: string | null;
  targetProfileId: string;
  sourceProfileIds: string[];
  targetIdentityId: string;
  sourceIdentityIds: string[];
  affectedPersonalProfileMergeCount: number;
  affectedSharedSpaceProfileMergeCount: number;
  affectedSpaceIds: string[];
};

export type MergePropagationActivityEvent = {
  spaceId: string;
  userId: string;
  type: SharedSpaceActivityType.PersonMerge;
  data: MergePropagationActivityPayload;
};

export type MergePropagationFollowUpJob =
  | { name: JobName.SharedSpacePersonMetadataBackfill; data: { identityId: string } }
  | { name: JobName.SharedSpacePersonDedup; data: { spaceId: string } }
  | { name: JobName.PersonGenerateThumbnail; data: { id: string } }
  | { name: JobName.FileDelete; data: { files: string[] } };

export type IdentityMergePropagationPlan = {
  actorUserId: string;
  origin: {
    type: MergeProfileKind;
    targetProfileId: string;
    sourceProfileIds: string[];
    ownerId?: string;
    spaceId?: string;
  };
  targetIdentityId: string;
  sourceIdentityIds: string[];
  personalProfileMerges: PersonalProfileMergeStep[];
  spaceProfileMerges: SpaceProfileMergeStep[];
  profileIdentityUpdates: Array<{ kind: MergeProfileKind; profileId: string; identityId: string }>;
  affectedOwnerIds: string[];
  affectedSpaceIds: string[];
  followUpJobs: MergePropagationFollowUpJob[];
  activityEvents: MergePropagationActivityEvent[];
};

export class IdentityMergePropagationService {
  async buildPersonalMergePlan(input: {
    actorUserId: string;
    targetPersonId: string;
    sourcePersonIds: string[];
  }): Promise<IdentityMergePropagationPlan> {
    throw new Error('not implemented');
  }
}
```

Give the constructor this dependency shape so tests can provide repository mocks directly:

```ts
type IdentityMergePropagationDependencies = {
  databaseRepository: DatabaseRepository;
  faceIdentityRepository: FaceIdentityRepository;
  jobRepository: JobRepository;
  logger: LoggingRepository;
  personRepository: PersonRepository;
  sharedSpaceRepository: SharedSpaceRepository;
};

constructor(private deps: IdentityMergePropagationDependencies) {}
```

- [ ] **Step 4: Implement survivor grouping for personal-origin plans**

Implement planner behavior:

- ensure the initiating target and source profiles have identity ids before loading attached profiles
- ensure the initiating target survives in the owner scope
- group `person` profiles by `ownerId`
- group `space-person` profiles by `spaceId`
- choose one survivor per group
- create merge steps for groups with more than one affected profile
- create identity update steps for groups with exactly one affected profile whose identity differs from target
- create one metadata backfill job for the target identity and one deduplicated shared-space dedup job per affected space
- create one propagated activity event per affected space for personal-origin merges
- sort owner ids, space ids, and steps deterministically

- [ ] **Step 5: Run focused tests until green**

Run:

```bash
pnpm --filter immich test -- --run src/services/identity-merge-propagation.service.spec.ts
```

Expected: the planner tests pass.

- [ ] **Step 6: Commit slice 1 planner**

```bash
git add server/src/services/identity-merge-propagation.service.ts server/src/services/identity-merge-propagation.service.spec.ts
git commit -m "feat: plan personal merge propagation"
```

## Task 2: Slice 1, Personal-Origin Execution And PersonService Routing

**Files:**

- Modify: `server/src/services/identity-merge-propagation.service.ts`
- Modify: `server/src/services/base.service.ts`
- Modify: `server/src/services/person.service.ts`
- Modify: `server/src/services/person.service.spec.ts`
- Modify: `server/src/repositories/person.repository.ts`
- Modify: `server/src/repositories/shared-space.repository.ts`
- Modify: `server/src/repositories/face-identity.repository.ts`

- [ ] **Step 1: Write failing execution tests**

Add tests to `server/src/services/identity-merge-propagation.service.spec.ts`:

```ts
describe('executePlan for personal-origin propagation', () => {
  it('merges personal profiles before collapsing identities', async () => {});
  it('links moved personal faces to the target identity with manual source before collapsing identities', async () => {});
  it('merges duplicate space profiles before collapsing identities', async () => {});
  it('updates single affected profiles to the target identity without deleting them', async () => {});
  it('queues metadata backfill and shared-space dedup for affected spaces once', async () => {});
});
```

Assert call order:

```ts
expect(mocks.person.mergePersonProfile.mock.invocationCallOrder[0]).toBeLessThan(
  mocks.faceIdentity.mergeIdentitiesAfterProfileResolution.mock.invocationCallOrder[0],
);
expect(mocks.sharedSpace.mergeSpacePersonProfile.mock.invocationCallOrder[0]).toBeLessThan(
  mocks.faceIdentity.mergeIdentitiesAfterProfileResolution.mock.invocationCallOrder[0],
);
expect(mocks.faceIdentity.linkPersonFaces).toHaveBeenCalledWith(
  { personId: 'person-x', identityId: 'identity-x', source: 'manual' },
  expect.anything(),
);
expect(mocks.faceIdentity.linkPersonFaces.mock.invocationCallOrder[0]).toBeLessThan(
  mocks.faceIdentity.mergeIdentitiesAfterProfileResolution.mock.invocationCallOrder[0],
);
```

- [ ] **Step 2: Write failing `PersonService.mergePerson` routing tests**

In `server/src/services/person.service.spec.ts`, update the merge-person describe block with:

```ts
it('delegates valid personal merges to identity merge propagation after access validation', async () => {});
it('returns bulk failure and does not delegate when a source person is missing or inaccessible', async () => {});
it('rejects an empty source list before delegation', async () => {});
it('rejects self-merge before delegation', async () => {});
```

Expected assertions:

```ts
expect(mocks.access.person.checkOwnerAccess).toHaveBeenCalled();
expect(identityMergePropagation.mergePersonalPeople).toHaveBeenCalledWith(auth, 'person-x', ['person-y']);
```

Expose a test-only override by replacing `sut['identityMergePropagationService']` in the test, matching the `BaseService` helper approach used by this plan.

- [ ] **Step 3: Run failing tests**

```bash
pnpm --filter immich test -- --run src/services/identity-merge-propagation.service.spec.ts src/services/person.service.spec.ts
```

Expected: failures for missing executor/repository helpers and old `PersonService.mergePerson` behavior.

- [ ] **Step 4: Add repository helper signatures**

Add these methods with transaction-capable signatures:

```ts
// server/src/repositories/person.repository.ts
async mergePersonProfile(input: {
  sourcePersonId: string;
  targetPersonId: string;
  targetIdentityId: string;
}, db = this.db): Promise<{ deletedThumbnailPath: string | null }> {}

async updatePersonIdentity(input: {
  personId: string;
  identityId: string;
}, db = this.db): Promise<void> {}

// server/src/repositories/shared-space.repository.ts
async mergeSpacePersonProfile(input: {
  sourcePersonId: string;
  targetPersonId: string;
}, db = this.db): Promise<void> {}

async updateSpacePersonIdentity(input: {
  personId: string;
  identityId: string;
}, db = this.db): Promise<void> {}

// server/src/repositories/face-identity.repository.ts
async mergeIdentitiesAfterProfileResolution(input: {
  targetIdentityId: string;
  sourceIdentityIds: string[];
  source: 'manual' | 'shared-space-evidence';
}, db = this.db): Promise<void> {}

async linkPersonFaces(input: LinkPersonFacesInput, db = this.db): Promise<void> {}
```

Use existing logic from `PersonService.mergePerson`, `FaceIdentityRepository.linkPersonFaces`, `SharedSpaceRepository.reassignPersonFacesSafe`, `SharedSpaceRepository.migrateAliases`, and `FaceIdentityRepository.mergeIdentities`.

- [ ] **Step 5: Implement `mergePersonalPeople` and execution**

Add:

```ts
async mergePersonalPeople(auth: AuthDto, targetPersonId: string, sourcePersonIds: string[]): Promise<BulkIdResponseDto[]> {
  const plan = await this.buildPersonalMergePlan({ actorUserId: auth.user.id, targetPersonId, sourcePersonIds });
  await this.executePlan(plan, { actorUserId: auth.user.id });
  return sourcePersonIds.map((id) => ({ id, success: true }));
}
```

Keep validation for missing/inaccessible initiating source ids in `PersonService.mergePerson` before this call, so propagation is all-or-nothing once it starts.

- [ ] **Step 6: Route `PersonService.mergePerson`**

Keep:

- self-merge rejection
- `Permission.PersonUpdate` on target
- `Permission.PersonMerge` on all sources
- bulk failures for missing/inaccessible initiating source ids before mutation

Replace manual loop mutation with:

```ts
return this.identityMergePropagationService.mergePersonalPeople(auth, id, dto.ids);
```

- [ ] **Step 7: Run focused tests**

```bash
pnpm --filter immich test -- --run src/services/identity-merge-propagation.service.spec.ts src/services/person.service.spec.ts
```

Expected: focused tests pass.

- [ ] **Step 8: Commit slice 1 execution**

```bash
git add server/src/services/base.service.ts server/src/services/identity-merge-propagation.service.ts server/src/services/identity-merge-propagation.service.spec.ts server/src/services/person.service.ts server/src/services/person.service.spec.ts server/src/repositories/person.repository.ts server/src/repositories/shared-space.repository.ts server/src/repositories/face-identity.repository.ts
git commit -m "feat: propagate personal people merges"
```

## Task 3: Slice 2, Shared-Space-Origin Propagation To Personal People

**Files:**

- Modify: `server/src/services/identity-merge-propagation.service.ts`
- Modify: `server/src/services/identity-merge-propagation.service.spec.ts`
- Modify: `server/src/services/shared-space.service.ts`
- Modify: `server/src/services/shared-space.service.spec.ts`

- [ ] **Step 1: Write failing planner and service tests**

Add tests:

```ts
describe('buildSpaceMergePlan', () => {
  it('plans initiating-space merge and personal profile merges for affected owners', async () => {});
  it('plans identity updates for owners with only one affected personal profile', async () => {});
  it('includes initiating-space activity and propagated activity for other affected spaces', async () => {});
  it('plans propagation to personal people and other spaces without requiring actor membership in those other scopes', async () => {});
});

describe('mergeSpacePeople delegation', () => {
  it('rejects viewer-initiated requests before delegation', async () => {});
  it('rejects an empty source list before delegation', async () => {});
  it('rejects source ids equal to the target id before delegation', async () => {});
  it('rejects missing target or source people before delegation', async () => {});
  it('rejects mixed person and pet space profiles before delegation', async () => {});
  it('delegates editor-initiated merges after validating source people belong to the initiating space', async () => {});
  it('keeps automatic shared-space reconciliation conservative', async () => {});
});
```

- [ ] **Step 2: Run failing tests**

```bash
pnpm --filter immich test -- --run src/services/identity-merge-propagation.service.spec.ts src/services/shared-space.service.spec.ts
```

Expected: failures for missing `buildSpaceMergePlan` and old `SharedSpaceService.mergeSpacePeople` implementation.

- [ ] **Step 3: Implement `buildSpaceMergePlan`**

Add:

```ts
async buildSpaceMergePlan(input: {
  actorUserId: string;
  spaceId: string;
  targetPersonId: string;
  sourcePersonIds: string[];
}): Promise<IdentityMergePropagationPlan> {}
```

Rules:

- ensure the initiating target and source space profiles have identity ids before loading attached profiles
- initiating target profile survives in the initiating space
- source people must belong to the initiating space
- target and source profile types must match
- affected personal profiles are grouped by `ownerId`
- owners with duplicate profiles get personal merge steps
- owners with one affected profile get identity update steps
- propagated personal and other-space profile merges do not perform separate permission checks beyond the initiating editor+ check
- build activity events with role `initiating` for the origin space and `propagated` for every other affected space

- [ ] **Step 4: Implement `mergeSpacePeople` in propagation service**

Add:

```ts
async mergeSpacePeople(auth: AuthDto, spaceId: string, targetPersonId: string, sourcePersonIds: string[]): Promise<void> {
  const plan = await this.buildSpaceMergePlan({ actorUserId: auth.user.id, spaceId, targetPersonId, sourcePersonIds });
  await this.executePlan(plan, { actorUserId: auth.user.id });
}
```

- [ ] **Step 5: Route `SharedSpaceService.mergeSpacePeople`**

Keep existing validation:

- `requireRole(auth, spaceId, SharedSpaceRole.Editor)`
- target exists in initiating space
- source ids are not target id
- sources exist in initiating space
- source and target types match

Replace the local merge loop with:

```ts
await this.identityMergePropagationService.mergeSpacePeople(auth, spaceId, targetPersonId, dto.ids);
```

- [ ] **Step 6: Preserve conservative automatic reconciliation**

Keep `applySharedSpaceIdentityReconciliationClaim` on the existing conservative path. Add or update an assertion in `server/src/services/shared-space.service.spec.ts` proving it calls `faceIdentityRepository.getMergeConflicts()` and does not call `identityMergePropagationService.mergeSpacePeople()`.

- [ ] **Step 7: Run focused tests**

```bash
pnpm --filter immich test -- --run src/services/identity-merge-propagation.service.spec.ts src/services/shared-space.service.spec.ts
```

Expected: slice 2 tests pass.

- [ ] **Step 8: Commit slice 2**

```bash
git add server/src/services/identity-merge-propagation.service.ts server/src/services/identity-merge-propagation.service.spec.ts server/src/services/shared-space.service.ts server/src/services/shared-space.service.spec.ts
git commit -m "feat: propagate space people merges to personal people"
```

## Task 4: Slice 3, Space-To-Space Propagation And Activity Fanout

**Files:**

- Modify: `server/src/services/identity-merge-propagation.service.ts`
- Modify: `server/src/services/identity-merge-propagation.service.spec.ts`
- Modify: `server/src/repositories/shared-space.repository.ts`
- Modify: `server/src/services/shared-space.service.spec.ts`

- [ ] **Step 1: Write failing multi-space planner tests**

Add tests:

```ts
it('plans propagated merges in every other space with duplicate profiles', async () => {});
it('keeps other-space single profiles and updates identity only', async () => {});
it('deduplicates affected space ids for jobs and activity', async () => {});
```

Arrange Space A, Space B, and Space C as described in the spec:

- Space A has target and source
- Space B has target and source
- Space C has only source or only target

- [ ] **Step 2: Write failing activity fanout tests**

Add tests:

```ts
it('writes initiating activity for the origin space and propagated activity for every affected other space', async () => {});
it('does not write duplicate activity when duplicate source ids are provided', async () => {});
```

Expected activity payload keys:

```ts
expect.objectContaining({
  originScope: 'space-person',
  activityRole: 'propagated',
  originatingSpaceId: 'space-a',
  targetIdentityId: 'identity-x',
  sourceIdentityIds: ['identity-y'],
  affectedSpaceIds: ['space-a', 'space-b', 'space-c'],
});
```

- [ ] **Step 3: Run failing tests**

```bash
pnpm --filter immich test -- --run src/services/identity-merge-propagation.service.spec.ts src/services/shared-space.service.spec.ts
```

- [ ] **Step 4: Extend planner fanout**

Ensure `buildSpaceMergePlan` and `buildPersonalMergePlan` both:

- load all profiles attached to the target/source identity set
- group every `shared_space_person` by `spaceId`
- create merge steps for every space with multiple profiles
- create identity update steps for every space with one affected profile and a non-target identity

- [ ] **Step 5: Add activity payload generation**

Add a private method:

```ts
private buildActivityPayload(plan: IdentityMergePropagationPlan, role: 'initiating' | 'propagated', spaceId: string) {
  return {
    originScope: plan.origin.type,
    actorUserId: plan.actorUserId,
    activityRole: role,
    originatingSpaceId: plan.origin.type === 'space-person' ? plan.origin.spaceId : null,
    targetProfileId: plan.origin.targetProfileId,
    sourceProfileIds: plan.origin.sourceProfileIds,
    targetIdentityId: plan.targetIdentityId,
    sourceIdentityIds: plan.sourceIdentityIds,
    affectedPersonalProfileMergeCount: plan.personalProfileMerges.length,
    affectedSharedSpaceProfileMergeCount: plan.spaceProfileMerges.length,
    affectedSpaceIds: plan.affectedSpaceIds,
  };
}
```

- [ ] **Step 6: Write activity entries**

Update `SharedSpaceRepository.logActivity` to accept an optional transaction handle:

```ts
async logActivity(
  values: { spaceId: string; userId: string; type: SharedSpaceActivityType; data?: Record<string, unknown> },
  db = this.db,
) {
  await db
    .insertInto('shared_space_activity')
    .values({
      spaceId: values.spaceId,
      userId: values.userId,
      type: values.type,
      data: (values.data ?? {}) as Record<string, unknown>,
    })
    .execute();
}
```

Then write `plan.activityEvents` inside the propagation transaction. For each affected space:

- role is `initiating` for the origin space when origin is `space-person`
- role is `propagated` for all other spaces
- personal-origin propagated space activity uses `originScope: 'person'`

- [ ] **Step 7: Run focused tests**

```bash
pnpm --filter immich test -- --run src/services/identity-merge-propagation.service.spec.ts src/services/shared-space.service.spec.ts
```

- [ ] **Step 8: Commit slice 3**

```bash
git add server/src/services/identity-merge-propagation.service.ts server/src/services/identity-merge-propagation.service.spec.ts server/src/repositories/shared-space.repository.ts server/src/services/shared-space.service.spec.ts
git commit -m "feat: propagate people merges across spaces"
```

## Task 5: Slice 4, Metadata, Alias, And Representative Preservation

**Files:**

- Modify: `server/src/repositories/person.repository.ts`
- Modify: `server/src/repositories/shared-space.repository.ts`
- Modify: `server/src/services/identity-merge-propagation.service.ts`
- Modify: `server/src/services/identity-merge-propagation.service.spec.ts`

- [ ] **Step 1: Write failing repository/service tests for personal metadata**

Add tests:

```ts
it('preserves target personal name, birth date, color, species, hidden, favorite, and feature face', async () => {});
it('fills blank personal target metadata from source without copying hidden or favorite', async () => {});
it('links moved personal faces to the survivor identity with manual source', async () => {});
it('queues source person thumbnail cleanup for deleted personal profiles', async () => {});
```

- [ ] **Step 2: Write failing repository/service tests for shared-space metadata**

Add tests:

```ts
it('preserves target shared-space name, birth date, hidden state, representative face, and metadata sources', async () => {});
it('migrates aliases while keeping existing survivor aliases', async () => {});
it('recounts face and asset counts after shared-space profile merge', async () => {});
```

- [ ] **Step 3: Run failing tests**

```bash
pnpm --filter immich test -- --run src/services/identity-merge-propagation.service.spec.ts
```

- [ ] **Step 4: Harden personal merge helper**

`PersonRepository.mergePersonProfile` must:

- update `asset_face.personId`
- fill `name`, `birthDate`, `color`, and `species` only when the target field is blank/null
- keep target `isHidden`, `isFavorite`, and `faceAssetId`
- leave identity relinking to `IdentityMergePropagationService`, which must call `faceIdentityRepository.linkPersonFaces({ personId: targetPersonId, identityId: targetIdentityId, source: 'manual' }, trx)` after moving faces and before collapsing identities
- delete the source person
- return the source `thumbnailPath` for file cleanup

- [ ] **Step 5: Harden shared-space merge helper**

`SharedSpaceRepository.mergeSpacePersonProfile` must:

- call safe face reassignment
- migrate aliases with existing target alias winning
- keep target `name`, `birthDate`, and `isHidden`
- keep target `representativeFaceId` and `representativeFaceSource`
- keep manual `nameSource` and `birthDateSource`
- delete the source person
- recount the target person

- [ ] **Step 6: Repair missing representatives only when needed**

In the propagation executor, after shared-space merges:

- if representative source is manual and still valid, keep it
- for each affected space, call `sharedSpaceRepository.repairInvalidRepresentativeFaces(spaceId)` and `sharedSpaceRepository.repairOrphanedRepresentativeFaces(spaceId)` before queueing the space dedup job
- for personal survivors with no valid `faceAssetId`, add a private helper that calls `personRepository.getRandomFace(personId)`, updates `{ id: personId, faceAssetId: assetFace.id }`, and queues `{ name: JobName.PersonGenerateThumbnail, data: { id: personId } }`

- [ ] **Step 7: Run focused tests**

```bash
pnpm --filter immich test -- --run src/services/identity-merge-propagation.service.spec.ts
```

- [ ] **Step 8: Commit slice 4**

```bash
git add server/src/repositories/person.repository.ts server/src/repositories/shared-space.repository.ts server/src/services/identity-merge-propagation.service.ts server/src/services/identity-merge-propagation.service.spec.ts
git commit -m "feat: preserve merge propagation metadata"
```

## Task 6: Slice 5, Transactionality And Identity Collapse

**Files:**

- Create: `server/test/medium/specs/services/identity-merge-propagation.service.spec.ts`
- Modify: `server/src/services/identity-merge-propagation.service.spec.ts`
- Modify: `server/src/repositories/database.repository.ts`
- Modify: `server/src/repositories/face-identity.repository.ts`
- Modify: `server/src/repositories/person.repository.ts`
- Modify: `server/src/repositories/shared-space.repository.ts`
- Modify: `server/src/services/identity-merge-propagation.service.ts`

- [ ] **Step 1: Write failing medium rollback and uniqueness tests**

Add medium tests:

```ts
describe('IdentityMergePropagationService medium tests', () => {
  it('rolls back all profile and identity changes when one profile merge fails', async () => {});
  it('does not violate owner identity uniqueness while collapsing personal duplicates', async () => {});
  it('does not violate space identity uniqueness while collapsing shared-space duplicates', async () => {});
  it('collapses identity faces for identities that have no profile in a scope', async () => {});
});
```

- [ ] **Step 2: Write failing concurrency and failure-injection tests**

Add these medium tests to `server/test/medium/specs/services/identity-merge-propagation.service.spec.ts`:

```ts
it('handles concurrent overlapping merges with one success and one clean retry or failure', async () => {});
it('rolls back when activity write fails inside the transaction', async () => {});
```

Add this unit test to `server/src/services/identity-merge-propagation.service.spec.ts`:

```ts
it('logs and returns success when follow-up queueing fails after the transaction commits', async () => {});
```

- [ ] **Step 3: Run failing transaction and failure-injection tests**

```bash
pnpm --filter immich test:medium -- --run test/medium/specs/services/identity-merge-propagation.service.spec.ts
pnpm --filter immich test -- --run src/services/identity-merge-propagation.service.spec.ts
```

Expected: failures until transaction support and medium setup exist.

- [ ] **Step 4: Add transaction helper**

Add to `DatabaseRepository`:

```ts
transaction<T>(callback: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
  return this.db.transaction().execute(callback);
}
```

- [ ] **Step 5: Make repository helpers transaction-aware**

Update helper signatures so the executor passes one transaction object through all profile and identity changes:

```ts
type DbOrTransaction = Kysely<DB> | Transaction<DB>;
```

Avoid nested transactions in `ensurePersonIdentity`, `ensureSpacePersonIdentity`, and identity collapse when a transaction is supplied.

- [ ] **Step 6: Execute the plan atomically**

In `IdentityMergePropagationService.executePlan`:

```ts
const deletedThumbnailPaths: string[] = [];

await this.databaseRepository.transaction(async (trx) => {
  for (const step of plan.personalProfileMerges) {
    for (const sourcePersonId of step.sourcePersonIds) {
      const result = await this.personRepository.mergePersonProfile(
        { sourcePersonId, targetPersonId: step.targetPersonId, targetIdentityId: plan.targetIdentityId },
        trx,
      );
      await this.faceIdentityRepository.linkPersonFaces(
        { personId: step.targetPersonId, identityId: plan.targetIdentityId, source: 'manual' },
        trx,
      );
      if (result.deletedThumbnailPath) {
        deletedThumbnailPaths.push(result.deletedThumbnailPath);
      }
    }
  }
  for (const step of plan.spaceProfileMerges) {
    for (const sourcePersonId of step.sourcePersonIds) {
      await this.sharedSpaceRepository.mergeSpacePersonProfile(
        { sourcePersonId, targetPersonId: step.targetPersonId },
        trx,
      );
    }
  }
  for (const update of plan.profileIdentityUpdates) {
    if (update.kind === 'person') {
      await this.personRepository.updatePersonIdentity(
        { personId: update.profileId, identityId: update.identityId },
        trx,
      );
    } else {
      await this.sharedSpaceRepository.updateSpacePersonIdentity(
        { personId: update.profileId, identityId: update.identityId },
        trx,
      );
    }
  }
  await this.faceIdentityRepository.mergeIdentitiesAfterProfileResolution(
    { targetIdentityId: plan.targetIdentityId, sourceIdentityIds: plan.sourceIdentityIds, source: 'manual' },
    trx,
  );
  await this.writeActivities(plan, trx);
});
await this.queueFollowUpsBestEffort(plan, deletedThumbnailPaths);
```

`queueFollowUpsBestEffort` must not roll back or fail the already-committed merge. Implement it as a best-effort wrapper:

```ts
private async queueFollowUpsBestEffort(plan: IdentityMergePropagationPlan, deletedThumbnailPaths: string[]) {
  try {
    await this.queueFollowUps(plan, deletedThumbnailPaths);
  } catch (error: Error | any) {
    this.logger.error(`Failed to queue merge propagation follow-up jobs: ${error}`, error?.stack);
  }
}
```

The failure-injection test must assert the transaction work and activity writes have completed, `logger.error` is called, and the initiating API still returns its normal success response.

- [ ] **Step 7: Re-run the conservative automatic reconciliation test**

Use the `server/src/services/shared-space.service.spec.ts` test added in Task 3 Step 6. Expected: `applySharedSpaceIdentityReconciliationClaim` still calls `faceIdentityRepository.getMergeConflicts()` and does not call `identityMergePropagationService.mergeSpacePeople()`.

- [ ] **Step 8: Run medium and focused unit tests**

```bash
pnpm --filter immich test:medium -- --run test/medium/specs/services/identity-merge-propagation.service.spec.ts
pnpm --filter immich test -- --run src/services/identity-merge-propagation.service.spec.ts src/services/person.service.spec.ts src/services/shared-space.service.spec.ts
```

- [ ] **Step 9: Commit slice 5**

```bash
git add server/test/medium/specs/services/identity-merge-propagation.service.spec.ts server/src/services/identity-merge-propagation.service.spec.ts server/src/repositories/database.repository.ts server/src/repositories/face-identity.repository.ts server/src/repositories/person.repository.ts server/src/repositories/shared-space.repository.ts server/src/services/identity-merge-propagation.service.ts server/src/services/shared-space.service.spec.ts
git commit -m "feat: harden merge propagation transactions"
```

## Task 7: Final Verification And Cleanup

**Files:**

- Modify only files needed for fixes found by verification.

- [ ] **Step 1: Run full focused unit coverage**

```bash
pnpm --filter immich test -- --run src/services/identity-merge-propagation.service.spec.ts src/services/person.service.spec.ts src/services/shared-space.service.spec.ts
```

Expected: all focused unit tests pass.

- [ ] **Step 2: Run medium transaction coverage**

```bash
pnpm --filter immich test:medium -- --run test/medium/specs/services/identity-merge-propagation.service.spec.ts
```

Expected: all medium tests pass.

- [ ] **Step 3: Run type checking**

```bash
pnpm --filter immich check
```

Expected: TypeScript check passes.

- [ ] **Step 4: Run the broader server unit suite**

```bash
pnpm --filter immich test -- --run
```

Expected: server unit suite passes.

- [ ] **Step 5: Review edge-case coverage against the spec**

Verify every edge case in the spec appears in one of:

- `server/src/services/identity-merge-propagation.service.spec.ts`
- `server/src/services/person.service.spec.ts`
- `server/src/services/shared-space.service.spec.ts`
- `server/test/medium/specs/services/identity-merge-propagation.service.spec.ts`

- [ ] **Step 6: Commit verification fixes**

```bash
git status --short
git add server/src/services/base.service.ts server/src/services/identity-merge-propagation.service.ts server/src/services/identity-merge-propagation.service.spec.ts server/src/services/person.service.ts server/src/services/person.service.spec.ts server/src/services/shared-space.service.ts server/src/services/shared-space.service.spec.ts server/src/repositories/database.repository.ts server/src/repositories/face-identity.repository.ts server/src/repositories/person.repository.ts server/src/repositories/shared-space.repository.ts server/test/medium/specs/services/identity-merge-propagation.service.spec.ts
git commit -m "test: complete merge propagation coverage"
```

Only commit if verification required fixes. If no files changed, do not create an empty commit.

## Edge-Case Coverage Map

| Edge Case                                                               | Planned Test Location                                                             |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Empty source list                                                       | `person.service.spec.ts`, `shared-space.service.spec.ts`                          |
| Source id equals target id                                              | `person.service.spec.ts`, `shared-space.service.spec.ts`                          |
| Duplicate source ids                                                    | `identity-merge-propagation.service.spec.ts`                                      |
| Missing initiating target                                               | `identity-merge-propagation.service.spec.ts`, service specs                       |
| Missing/inaccessible initiating source                                  | `person.service.spec.ts`, `shared-space.service.spec.ts`                          |
| Source already has target identity                                      | `identity-merge-propagation.service.spec.ts`                                      |
| Profile has no identity                                                 | `identity-merge-propagation.service.spec.ts`                                      |
| Identity has faces but no profile in a scope                            | medium spec                                                                       |
| Scope has one affected profile                                          | planner unit spec                                                                 |
| Scope has multiple affected profiles                                    | planner and executor unit specs                                                   |
| No affected shared spaces                                               | personal-origin planner and executor unit specs                                   |
| Other space has duplicates                                              | space-to-space unit and integration specs                                         |
| Other space has only one profile                                        | space-to-space unit spec                                                          |
| Actor is not a member of another affected space                         | shared-space-origin planner unit spec                                             |
| Multiple owners have different profile layouts                          | shared-space-origin unit spec                                                     |
| Hidden source or target profiles                                        | metadata preservation unit spec                                                   |
| Favorite source profile                                                 | metadata preservation unit spec                                                   |
| Manual personal feature face                                            | metadata preservation unit spec                                                   |
| Moved personal faces are relinked to target identity with manual source | executor and metadata preservation unit specs                                     |
| Manual shared-space representative face                                 | metadata preservation unit spec                                                   |
| Shared-space target name, birth date, and hidden state preservation     | metadata preservation unit spec                                                   |
| Manual shared-space name or birthday source                             | metadata preservation unit spec                                                   |
| Blank survivor metadata and useful source metadata                      | metadata preservation unit spec                                                   |
| Conflicting aliases during space merge                                  | metadata preservation unit spec                                                   |
| Mixed `person` and `pet` identities                                     | planner and executor specs                                                        |
| Concurrent merge of overlapping identities                              | medium spec                                                                       |
| Follow-up queue failure after DB transaction                            | unit spec with failure injection proving best-effort logging and success response |
| Activity write failure during transaction                               | medium or unit spec with failure injection                                        |
| Activity actor id, origin scope, initiating role, and propagated role   | activity fanout unit spec                                                         |
| Deduplicated follow-up jobs per affected space                          | executor unit spec                                                                |
| Executor error midway                                                   | medium rollback spec                                                              |
| Existing automatic reconciliation conflict                              | `shared-space.service.spec.ts`                                                    |
