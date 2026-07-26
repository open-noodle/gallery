# Slice 5 — Model lifecycle: validation, switch detection, scoped reprocess (F6, force half of F9)

Plan for [the review-fixes spec](../specs/2026-07-26-pet-recognition-review-fixes-implementation-slices.md),
Slice 5. Baseline: Slices 1–4 and 7 landed.

## Verified ground truth

| Thing                               | Fact                                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `DatabaseLock` highest value        | `HlsSessionCleanup = 850` (`enum.ts:1081`) — **860 is free**                                           |
| `PetRecognitionState`               | `types.ts:737` — `{ lastRun?: string; modelName?: string }`                                            |
| Decorator precedent                 | `smart-info.service.ts:18` (ConfigInit), `:23` (ConfigUpdate + `server: true`), `:28` (ConfigValidate) |
| Mid-flight guard precedent          | `smart-info.service.ts:132-136`                                                                        |
| `withLock`                          | `databaseRepository.withLock(lock, cb)` (`database.repository.ts:446`)                                 |
| `empty`                             | `jobRepository.empty(name: QueueName, delayed = false)` (`job.repository.ts:215`)                      |
| enable helpers                      | `isPetDetectionEnabled` / `isPetRecognitionEnabled` (`utils/misc.ts:110-113`), both also require ML on |
| current `handleQueuePetRecognition` | order is: enabled check → nightly date-skip → force/else → stamp state                                 |

## Implementation

### 1. `src/constants.ts`

```ts
export const PET_RECOGNITION_MODEL_NAMES = [
  'pet-recognition-small',
  'pet-recognition-base',
  'pet-recognition-large',
] as const;
```

### 2. `src/enum.ts`

`PetRecognitionModelSwitch = 860` in `DatabaseLock`.

### 3. `src/types.ts`

`[SystemMetadataKey.PetRecognitionState]: { lastRun?: string; modelName?: string; pendingReprocess?: boolean }`

### 4. `person.repository.ts` — scoped purge

Extract the Slice-1 statement so both purges share it:

```ts
const deleteEmbeddedPetFaces = (trx: Transaction<DB>) =>
  trx
    .deleteFrom('asset_face')
    .where('asset_face.id', 'in', (eb) => eb.selectFrom('pet_search').select('pet_search.faceId'))
    .execute();
```

`deleteAllPets()` calls it as its first statement (unchanged behaviour).

New `purgePetRecognitionArtifacts()` — the **scoped** purge. Species buckets are detector output and
are not model-coupled, so they must survive:

```ts
async purgePetRecognitionArtifacts(): Promise<void> {
  await this.db.transaction().execute(async (trx) => {
    // 1. Every embedded pet face. Bucket faces have no pet_search row, so they are untouched.
    await deleteEmbeddedPetFaces(trx);

    // 2. Pet people left with zero faces are exactly the recognition-created individuals — a
    //    species bucket still holds its (embedding-less) faces after step 1.
    const orphaned = await trx
      .selectFrom('person')
      .select(['person.id', 'person.identityId'])
      .where('person.type', '=', 'pet')
      .where((eb) =>
        eb.not(
          eb.exists(
            eb.selectFrom('asset_face').select(sql`1`.as('one')).whereRef('asset_face.personId', '=', 'person.id'),
          ),
        ),
      )
      .execute();

    if (orphaned.length > 0) {
      const identityIds = orphaned.map((row) => row.identityId).filter((id): id is string => !!id);
      if (identityIds.length > 0) {
        await trx.deleteFrom('shared_space_person').where('identityId', 'in', identityIds).execute();
      }
      await trx.deleteFrom('person').where('person.id', 'in', orphaned.map((row) => row.id)).execute();
    }

    // 3. Belt and braces: step 1 already cascaded these away.
    await sql`truncate ${sql.table('pet_search')}`.execute(trx);
  });
}
```

Kysely rule (§3): everything uses `trx`, never `this.db`, inside the callback.

### 5. `pet-recognition.service.ts` — validation + switch

```ts
@OnEvent({ name: 'ConfigValidate' })
onConfigValidate({ newConfig }: ArgOf<'ConfigValidate'>) {
  const modelName = newConfig.machineLearning.petRecognition.modelName;
  if (!(PET_RECOGNITION_MODEL_NAMES as readonly string[]).includes(modelName)) {
    throw new Error(
      `Unknown pet recognition model: ${modelName}. Please check the model name for typos and confirm this is a supported model.`,
    );
  }
}

@OnEvent({ name: 'ConfigInit', workers: [ImmichWorker.Microservices] })
async onConfigInit({ newConfig }: ArgOf<'ConfigInit'>) {
  await this.handleModelSwitch(newConfig);
}

@OnEvent({ name: 'ConfigUpdate', workers: [ImmichWorker.Microservices], server: true })
async onConfigUpdate({ oldConfig, newConfig }: ArgOf<'ConfigUpdate'>) {
  await this.handleModelSwitch(newConfig, oldConfig);
}
```

Copy the decorator options **exactly** — `ConfigInit` fires per-worker at bootstrap and its payload
has no `oldConfig`; `ConfigUpdate` only reaches non-API workers through the `server: true` relay.

`handleModelSwitch(newConfig, oldConfig?)`, entire body under
`withLock(DatabaseLock.PetRecognitionModelSwitch)`, in this order:

**a. Idempotency first — re-read state inside the lock.** `withLock` serializes, it does not dedupe;
two deliveries of the same ConfigUpdate both carry the stale `oldConfig`, so without this they would
each purge and requeue, double-detecting every asset (both pet writers are additive).

```ts
const state = await this.systemMetadataRepository.get(SystemMetadataKey.PetRecognitionState);
const newModel = newConfig.machineLearning.petRecognition.modelName;
const recognitionEnabled = isPetRecognitionEnabled(newConfig.machineLearning);
const detectionEnabled = isPetDetectionEnabled(newConfig.machineLearning);
const detectionTurnedOn = !!oldConfig && !isPetDetectionEnabled(oldConfig.machineLearning) && detectionEnabled;

if (state?.modelName === newModel) {
  // f. Deferred reprocess: the switch already happened while detection was off.
  if (detectionTurnedOn && state.pendingReprocess) {
    await this.systemMetadataRepository.set(SystemMetadataKey.PetRecognitionState, {
      ...state,
      pendingReprocess: false,
    });
    await this.jobRepository.queue({ name: JobName.PetDetectionQueueAll, data: { force: true } });
  }
  return;
}
```

**b. Reference model.**

```ts
const referenceModel = oldConfig?.machineLearning.petRecognition.modelName ?? state?.modelName;
if (!referenceModel) {
  // Fresh install / ConfigInit before any state. Adopt the current model as the reference so a
  // later offline switch is detectable — the enable→first-nightly window is otherwise blind.
  if (recognitionEnabled) {
    await this.systemMetadataRepository.set(SystemMetadataKey.PetRecognitionState, { ...state, modelName: newModel });
  }
  return;
}
if (referenceModel === newModel) {
  return;
}
```

**c. Scoped purge.** Empty **both** pet queues first — pending old-model detection jobs would
re-embed with mixed state and duplicate faces against the requeued force run.

```ts
await this.jobRepository.empty(QueueName.PetRecognition, true);
await this.jobRepository.empty(QueueName.PetDetection, true);
// empty() drains waiting/delayed jobs; it does NOT kill an ACTIVE one. An in-flight recognition
// job can still create a person after this purge — it ends up face-less, and generic person
// cleanup collects it (see R2.6).
await this.personRepository.purgePetRecognitionArtifacts();
```

**d. Stamp state before any requeue** (this is what makes (a) sound).

```ts
const pendingReprocess = recognitionEnabled && !detectionEnabled;
await this.systemMetadataRepository.set(SystemMetadataKey.PetRecognitionState, {
  lastRun: new Date().toISOString(),
  modelName: newModel,
  ...(pendingReprocess ? { pendingReprocess: true } : {}),
});
```

Omitting the key when not pending is what clears a previously-set flag.

**e. Requeue gate.**

```ts
if (recognitionEnabled && detectionEnabled) {
  await this.jobRepository.queue({ name: JobName.PetDetectionQueueAll, data: { force: true } });
} else if (recognitionEnabled) {
  this.logger.warn(
    `Pet recognition model changed to ${newModel} but pet detection is disabled. Run a FORCE pet detection once detection is re-enabled — a non-force run skips assets already stamped with petsDetectedAt and would rebuild nothing.`,
  );
}
```

Recognition off ⇒ no requeue and no flag: the buckets survived, and re-enabling recognition later
follows the documented manual-reset flow.

### 6. `handleQueuePetRecognition`

- Capture the whole config (`const config = await this.getConfig({ withCache: false })`), not just
  `machineLearning`, so the drift path can hand it to `handleModelSwitch`.
- **Force branch:** `await this.jobRepository.empty(QueueName.PetRecognition, true)` **before** the
  existing purge (F9's force half). The force branch keeps its **full** purge semantics
  (`deleteAllPets` + `sharedSpace.deleteAllPets` + `deleteAllPetSearch`) — deliberately broader than
  the scoped switch purge, because the admin Reset button promises exactly that and the requeue
  rebuilds the buckets.
- **Drift check (non-force only), after the enabled check and BEFORE the nightly date-skip** — an
  idle library's date-skip would otherwise mask drift forever:

```ts
if (!force) {
  const state = await this.systemMetadataRepository.get(SystemMetadataKey.PetRecognitionState);
  if (state?.modelName && state.modelName !== config.machineLearning.petRecognition.modelName) {
    this.logger.warn(`Pet recognition model changed from ${state.modelName} to ... — reprocessing`);
    await this.handleModelSwitch(config);
    return JobStatus.Success;
  }
}
```

Slice 6's pending-work skip goes in the non-force path **after** this check and must never gate it.

### 7. `pet-detection.service.ts` — mid-flight guard

After the ML call, when `recognitionEnabled`, re-fetch `getConfig({ withCache: true })`; if
`petRecognition.modelName` differs from the one the request used, return `JobStatus.Skipped` before
writing anything (no `refreshPetFaces`, no bucket write, no `petsDetectedAt`). The config cache is
invalidated on every worker on ConfigUpdate, so the re-fetch observes the new value. The switch hook
has already requeued detection, so the asset is not lost.

## Tests (write first)

Unit R5.1–R5.12 in `pet-recognition.service.spec.ts` / `pet-detection.service.spec.ts`, medium
R5.13–R5.14 in `test/medium/specs/services/pet-recognition.service.spec.ts`. Full table in the spec.
Note R5.7 (recognition off) must assert **bucket persons and bucket faces are untouched** — that is
the whole point of the purge being scoped, and is the assertion that would catch a regression back
to `deleteAllPets`.

R5.14 is a pin (`state.modelName` equals the config model after a normal queue-all) — follow §2's
mutate-red-revert protocol.

## Verify

```
cd server && pnpm exec vitest --config test/vitest.config.mjs --run src/services/pet-recognition.service.spec.ts src/services/pet-detection.service.spec.ts
cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/services/pet-recognition.service.spec.ts
cd server && pnpm exec vitest --config test/vitest.config.mjs --run     # full unit
cd server && pnpm exec tsc --noEmit -p tsconfig.json
```

## Commit

`feat(pet-recognition): model whitelist, idempotent switch detection and scoped reprocess`
