# Slice 3 — Server: config block, queue, job registration

- **Spec:** [`../specs/2026-07-25-pet-recognition-phase2-implementation-slices.md`](../specs/2026-07-25-pet-recognition-phase2-implementation-slices.md) § Slice 3
- **Scope:** `server/` only. No web, no ML service, no pipeline behaviour yet.

## Objective

Introduce `machineLearning.petRecognition`, the `petRecognition` queue and its two jobs, with real
`@OnJob` handlers that are gated off by default. After this slice the server boots, the config
round-trips, and the queue is startable — but nothing clusters yet (Slice 5).

## Why the handlers must exist now

`JobRepository.setup()` (`server/src/repositories/job.repository.ts:119-125`) throws
`ImmichStartupError` if any `JobName` member lacks an `@OnJob` handler. So the enum members and the
service land together, or the server will not boot.

## Files

| File                                             | Change                                                                                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `server/src/enum.ts`                             | `QueueName.PetRecognition`, `JobName.PetRecognitionQueueAll`, `JobName.PetRecognition`, `SystemMetadataKey.PetRecognitionState` |
| `server/src/config.ts`                           | `petRecognition` type + defaults; `[QueueName.PetRecognition]: { concurrency: 1 }`                                              |
| `server/src/types.ts`                            | two `JobItem` union entries; `SystemMetadata` entry for the new key                                                             |
| `server/src/dtos/model-config.dto.ts`            | `PetRecognitionConfigSchema`                                                                                                    |
| `server/src/dtos/system-config.dto.ts`           | wire schema into `SystemConfigMachineLearningSchema` + `petRecognition: JobSettingsSchema` in `SystemConfigJobSchema`           |
| `server/src/utils/misc.ts`                       | `isPetRecognitionEnabled`                                                                                                       |
| `server/src/services/pet-recognition.service.ts` | **new** — `handleQueuePetRecognition`, `handlePetRecognition`                                                                   |
| `server/src/services/index.ts`                   | register `PetRecognitionService`                                                                                                |
| `server/src/services/queue.service.ts`           | `case QueueName.PetRecognition` in `start()`                                                                                    |

## Locked values

```ts
// config.ts type
petRecognition: {
  enabled: boolean;
  modelName: string;
  maxDistance: number;
  minFaces: number;
};

// config.ts defaults
petRecognition: {
  enabled: false,
  modelName: 'pet-recognition-base',
  maxDistance: 0.55,
  minFaces: 1,
},
```

DTO bounds (mirror `FacialRecognitionConfigSchema`): `maxDistance` `z.number().min(0.1).max(2)`,
`minFaces` `z.int().min(1)`.

`JobItem` entries:

```ts
| { name: JobName.PetRecognitionQueueAll; data: INightlyJob }
| { name: JobName.PetRecognition; data: IDeferrableJob & IEntityJob }
```

## TDD steps

### Step 1 — RED

1. **`server/src/services/system-config.service.spec.ts`** — add `petRecognition` to the machineLearning
   defaults fixture and `[QueueName.PetRecognition]: { concurrency: 1 }` to the job fixture. These
   fixtures are hardcoded copies of `config.ts`; they fail loudly until the defaults exist. Run:
   `cd server && pnpm test -- --run src/services/system-config.service.spec.ts`
   Expected red: deep-equal mismatch listing the missing `petRecognition` key.

2. **`server/src/services/pet-recognition.service.spec.ts`** (new) — tests 3.2/3.3 from the spec:
   - `handleQueuePetRecognition` returns `JobStatus.Skipped` when `petRecognition.enabled` is false
   - `handlePetRecognition` returns `JobStatus.Skipped` when disabled and never calls the search repo

   Use `newTestService(PetRecognitionService)` from `test/utils.ts` — copy the setup shape from
   `src/services/pet-detection.service.spec.ts`.
   Expected red: `Cannot find module 'src/services/pet-recognition.service'`.

3. **`server/src/services/queue.service.spec.ts`** — test 3.5: starting `QueueName.PetRecognition`
   queues `JobName.PetRecognitionQueueAll`. Expected red: `BadRequestException: Invalid job name`.

4. **`server/src/utils/misc.spec.ts`** (or wherever the sibling helpers are tested) — test 3.4:
   `isPetRecognitionEnabled` is false when global ML is off. Expected red: not exported.

Capture all four red outputs before implementing.

### Step 2 — GREEN

Implement in the order of the file table above. The service skeleton:

```ts
@Injectable()
export class PetRecognitionService extends BaseService {
  @OnJob({ name: JobName.PetRecognitionQueueAll, queue: QueueName.PetRecognition })
  async handleQueuePetRecognition({ force, nightly }: JobOf<JobName.PetRecognitionQueueAll>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: false });
    if (!isPetRecognitionEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }
    // Slice 6 fills in purge / nightly / fan-out
    return JobStatus.Success;
  }

  @OnJob({ name: JobName.PetRecognition, queue: QueueName.PetRecognition })
  async handlePetRecognition({ id, deferred }: JobOf<JobName.PetRecognition>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: true });
    if (!isPetRecognitionEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }
    // Slice 5 fills in clustering
    return JobStatus.Skipped;
  }
}
```

Leave a `// implemented in slice 5/6` comment rather than a TODO with no owner. Do **not** implement
clustering here — that is Slice 5 and has its own tests.

### Step 3 — verify

```bash
cd server
pnpm test -- --run src/services/pet-recognition.service.spec.ts src/services/system-config.service.spec.ts src/services/queue.service.spec.ts src/utils/misc.spec.ts
pnpm test -- --run src/repositories/job.repository.spec.ts   # proves every JobName has a handler
pnpm test -- --run                                            # full unit suite: nothing else broke
pnpm check                                                    # tsc
```

The full unit suite matters here: adding a `QueueName` member can break exhaustive `Record<QueueName, …>`
types and fixtures elsewhere in the server.

### Step 4 — regenerate the SDK (needed by Slice 7)

Because the system-config DTO changed, the generated clients are now stale and web work cannot
typecheck against `petRecognition`:

```bash
cd server && pnpm build && pnpm sync:open-api
cd .. && make open-api-typescript
```

Commit the regenerated `open-api/` + `packages/sdk/` output with this slice. (The Dart client is
regenerated in Slice 8, which needs Java.)

## Edge cases

- `isPetRecognitionEnabled` must be false when **either** global ML or the block is disabled.
- The job-settings key in `SystemConfigJobSchema` is the QueueName **string value** (`petRecognition`),
  not the enum member name.
- Keep `QueueName.PetRecognition` **out** of the `isConcurrentQueue` exclude list
  (`queue.service.ts:290-298`) so it stays a concurrent queue with a configurable concurrency; that
  is also what makes the `config.job` entry required.

## Done criteria

- All four spec files green, full server unit suite green, tsc clean.
- Server boots (proved by `job.repository.spec.ts`).
- SDK regenerated and committed.

## Commit

`feat(pet-recognition): config block, queue and job registration`
