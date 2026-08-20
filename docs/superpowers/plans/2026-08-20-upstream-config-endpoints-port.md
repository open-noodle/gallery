# Fork Config Surface → Upstream Config Endpoints (#30881) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-express the fork's config surface as zod fragments in a fork-owned module so the rolling branch can adopt upstream #30881, with behaviour identical to today.

**Architecture:** Upstream #30881 replaces `server/src/config.ts` + `system-config.dto.ts` + `model-config.dto.ts` with one zod-driven `server/src/dtos/config.dto.ts` where `SystemConfig` is `z.infer` of the schema and each leaf carries an optional `Public`/`User`/`Admin` visibility. The fork's fields move into a new leaf module `server/src/gallery/config.dto.ts` and are composed into upstream's schema and `defaults` at named seams. No fork field is annotated, so all default to `Admin` — identical to today's admin-only behaviour.

**Tech Stack:** TypeScript, zod v4, `nestjs-zod` (`createZodDto`), NestJS, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-20-upstream-config-endpoints-port-design.md`

## Global Constraints

- **No fork field carries a `visibility` annotation.** Unannotated leaves default to `Admin`. (Spec D1)
- **Never build fork ML tasks from `AdminConfigMachineLearningModelSchema` or `AdminConfigMachineLearningTaskSchema`** — their `enabled` leaf is annotated `visibility: User` and would leak. (Spec S2)
- **`server/src/gallery/config.dto.ts` must remain a leaf module**: it must not import from `src/dtos/config.dto.ts`. That import is circular and would leave `configBool` undefined at module-init time.
- **Preserve `configBool` coercion semantics** for fork booleans — it maps the strings `'true'`/`'false'` to booleans, which is what makes `IMMICH_CONFIG_FILE` values parse.
- **Keep `memories.types: {}` present in `defaults`** — `utils/config.ts:184-189` relies on it as a known empty-object leaf.
- Fork queue keys in the `job` schema are the **literal camelCase enum values**: `peopleBackfill`, `petDetection`, `classification`.
- Prettier: 120 cols, single quotes, trailing commas. Server imports use the `src/` alias; **no relative imports**.

---

### Task 1: Advance the quarantine boundary

Pulls #30881/#30891/#30821 so the port has something to port onto. Ends deliberately **red** — that red is the task's deliverable and the proof the port is needed.

**Files:**

- Modify: `.git/worktrees/<wt>/upstream-preflight/rolling-state.json` (`upstreamTargetHead`)
- Expect conflicts in: `server/src/utils/config.ts`, `server/src/types.ts`

**Interfaces:**

- Consumes: nothing
- Produces: a branch containing `server/src/dtos/config.dto.ts` with `AdminConfigDto`, `UserConfigDto`, `PublicConfigDto`, `mapAdminConfig`, `mapUserConfig`, `mapPublicConfig`, `defaults`, `SystemConfig`

- [ ] **Step 1: Set the new target and plan the batch**

```bash
SP="$(git rev-parse --git-path upstream-preflight)/rolling-state.json"
python3 - "$SP" <<'EOF'
import json,sys
p=sys.argv[1]; d=json.load(open(p))
d['upstreamTargetHead']='f88fb628ff5dc17aff246e3bb42061dde5e19878'
json.dump(d,open(p,'w'),indent=2); open(p,'a').write('\n')
EOF
make upstream-batch-plan
```

- [ ] **Step 2: Rebase through the quarantined commits**

```bash
git rebase f88fb628ff5dc17aff246e3bb42061dde5e19878
```

Two files are known reconciliation points, both carrying large fork deltas. Resolve each as **upstream's small delta on top of the fork's content**, never by taking a side wholesale:

- `server/src/utils/config.ts` (+116/−6 fork): take upstream's two changed lines only — the import becomes `import { AdminConfigDto, SystemConfig, defaults } from 'src/dtos/config.dto';` and `SystemConfigSchema.safeParse(rawConfig)` becomes `AdminConfigDto.schema.safeParse(rawConfig)`. Keep `foldLegacyFaceSuggestionConfig` and `deriveSuggestionBand` intact.
- `server/src/types.ts` (+186/−6 fork): take upstream's import change and its `DeepPartial` reordering. Keep the fork's `| QueueName.StorageBackendMigration` line in the `ConcurrentQueueName` exclusion list.

- [ ] **Step 3: Confirm the expected red**

Run: `cd server && pnpm check`

Expected FAIL. The errors should be confined to the three known breakages plus missing fork config fields:

- `src/dtos/model-config.dto.spec.ts` — cannot resolve `src/config` / `src/dtos/model-config.dto`
- `src/services/classification.service.ts` — cannot resolve `src/config`
- `src/services/queue.service.ts:104` — `config.job[queueName]` fails because `peopleBackfill` / `petDetection` / `classification` are absent from the job schema

If errors appear **outside** this set, the rebase resolution is wrong — fix it before continuing.

- [ ] **Step 4: Commit the rebase state**

The rebase itself rewrites history; no extra commit is needed. Record the tip:

```bash
git log --oneline -1
```

---

### Task 2: Create the fork-owned config module

**Files:**

- Create: `server/src/gallery/config.dto.ts`
- Test: `server/src/gallery/config.dto.spec.ts`

**Interfaces:**

- Consumes: Task 1's branch state
- Produces, all from `src/gallery/config.dto`:
  - `galleryConfigBool: z.ZodType<boolean>`
  - `ClassificationFaceExclusion` (type: `'off' | 'any_assigned_face' | 'named_people' | 'named_visible_people'`)
  - `GalleryClassificationSchema`, `GalleryMemoriesSchema`, `GalleryStorageUsageSchema`, `GalleryPetDetectionSchema`, `GalleryFaceSuggestionSchema` (all `z.ZodObject`)
  - `GalleryClipExtension: { maxDistance: z.ZodNumber }`
  - `GalleryServerExtension: { mergePeopleAcrossOwners: z.ZodType<boolean> }`
  - `galleryJobDefaults`, `galleryMachineLearningDefaults`, `galleryServerDefaults`, `galleryTopLevelDefaults`

- [ ] **Step 1: Write the failing test**

Create `server/src/gallery/config.dto.spec.ts`:

```ts
import {
  GalleryClassificationSchema,
  GalleryFaceSuggestionSchema,
  GalleryMemoriesSchema,
  GalleryPetDetectionSchema,
  galleryConfigBool,
} from 'src/gallery/config.dto';
import { describe, expect, it } from 'vitest';
import z from 'zod';

describe('gallery config fragments', () => {
  it('coerces string booleans the way configBool does', () => {
    expect(galleryConfigBool.parse('true')).toBe(true);
    expect(galleryConfigBool.parse('false')).toBe(false);
    expect(galleryConfigBool.parse(true)).toBe(true);
  });

  it('rejects duplicate classification category names', () => {
    const category = {
      name: 'dupe',
      prompts: ['a'],
      similarity: 0.5,
      action: 'tag' as const,
      enabled: true,
      faceExclusion: 'off' as const,
    };
    expect(() => GalleryClassificationSchema.parse({ enabled: true, categories: [category, { ...category }] })).toThrow(
      /Category names must be unique/,
    );
  });

  it('accepts distinct classification category names', () => {
    const base = {
      prompts: ['a'],
      similarity: 0.5,
      action: 'tag' as const,
      enabled: true,
      faceExclusion: 'off' as const,
    };
    const parsed = GalleryClassificationSchema.parse({
      enabled: true,
      categories: [
        { ...base, name: 'one' },
        { ...base, name: 'two' },
      ],
    });
    expect(parsed.categories).toHaveLength(2);
  });

  it('defaults memories.types to an empty object', () => {
    const parsed = GalleryMemoriesSchema.parse({ retentionDays: 365, birthday: true, recentTrips: true });
    expect(parsed.types).toEqual({});
  });

  it('rejects a face-suggestion distance below the 0.1 minimum', () => {
    expect(() => GalleryFaceSuggestionSchema.parse({ enabled: false, maxDistance: 0 })).toThrow();
  });

  it('does not inherit a user-visible enabled leaf on pet detection', () => {
    expect(z.globalRegistry.get(GalleryPetDetectionSchema.shape.enabled)?.visibility).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd server && npx vitest --config test/vitest.config.mjs --run src/gallery/config.dto.spec.ts`
Expected: FAIL — `Cannot find module 'src/gallery/config.dto'`

- [ ] **Step 3: Write the module**

Create `server/src/gallery/config.dto.ts`:

```ts
import { QueueName } from 'src/enum';
import z from 'zod';

// Deliberate copy of the module-private `configBool` in src/dtos/config.dto.ts. This module must
// stay a leaf — importing from config.dto.ts would be circular and leave this undefined at
// module-init time. Keep the two in sync; the coercion is what makes IMMICH_CONFIG_FILE string
// booleans parse.
export const galleryConfigBool = z
  .preprocess((val) => {
    if (val === 'true') {
      return true;
    }
    if (val === 'false') {
      return false;
    }
    return val;
  }, z.boolean())
  .meta({ type: 'boolean' });

const GalleryClassificationFaceExclusionSchema = z
  .enum(['off', 'any_assigned_face', 'named_people', 'named_visible_people'])
  .default('off')
  .describe('Face exclusion rule for this classification category')
  .meta({ id: 'ClassificationFaceExclusion' });

export type ClassificationFaceExclusion = z.infer<typeof GalleryClassificationFaceExclusionSchema>;

const GalleryClassificationCategorySchema = z
  .object({
    name: z.string().describe('Category name'),
    prompts: z.array(z.string()).min(1).describe('CLIP text prompts for this category'),
    similarity: z
      .number()
      .meta({ format: 'double' })
      .min(0)
      .max(1)
      .describe('Cosine similarity threshold for matching this category'),
    action: z.enum(['tag', 'tag_and_archive']).describe('Action to take when an asset matches'),
    enabled: z.boolean().describe('Whether this category is enabled'),
    faceExclusion: GalleryClassificationFaceExclusionSchema,
  })
  .meta({ id: 'AdminConfigClassificationCategoryDto' });

export const GalleryClassificationSchema = z
  .object({
    enabled: galleryConfigBool.describe('Enable classification globally'),
    categories: z
      .array(GalleryClassificationCategorySchema)
      .refine((cats) => new Set(cats.map((c) => c.name)).size === cats.length, {
        message: 'Category names must be unique',
      })
      .describe('Classification categories'),
  })
  .meta({ id: 'AdminConfigClassificationDto' });

export const GalleryMemoriesSchema = z
  .object({
    retentionDays: z.coerce.number().int().min(0).describe('Retention days'),
    /** @deprecated superseded by `types['birthday']`; kept for back-compat */
    birthday: galleryConfigBool.describe('Birthday memories'),
    /** @deprecated superseded by `types['recent_trip']`; kept for back-compat */
    recentTrips: galleryConfigBool.describe('Recent trip memories'),
    types: z.record(z.string(), z.boolean()).default({}).describe('Per-type memory availability overrides'),
  })
  .meta({ id: 'AdminConfigMemoriesDto' });

export const GalleryStorageUsageSchema = z
  .object({
    includeDerivatives: galleryConfigBool.describe('Include thumbnails and transcoded videos in storage usage'),
  })
  .meta({ id: 'AdminConfigStorageUsageDto' });

// NOT built from AdminConfigMachineLearningModelSchema: that schema's `enabled` leaf is annotated
// `visibility: User`, which would expose pet detection to every logged-in user. See spec S2.
export const GalleryPetDetectionSchema = z
  .object({
    enabled: z.boolean().describe('Whether the task is enabled'),
    modelName: z.string().min(1).describe('Name of the model to use'),
    minScore: z
      .number()
      .meta({ format: 'double' })
      .min(0.1)
      .max(1)
      .describe('Minimum confidence score for pet detection'),
  })
  .meta({ id: 'AdminConfigPetDetectionDto' });

export const GalleryFaceSuggestionSchema = z
  .object({
    enabled: z.boolean().describe('Whether face suggestions are enabled'),
    maxDistance: z
      .number()
      .meta({ format: 'double' })
      .min(0.1)
      .max(2)
      .describe('Maximum embedding distance for a face to be surfaced as a suggestion on a named person'),
  })
  .meta({ id: 'AdminConfigFaceSuggestionDto' });

export const GalleryClipExtension = {
  maxDistance: z
    .number()
    .meta({ format: 'double' })
    .min(0)
    .max(2)
    .describe('Maximum cosine distance for smart search results. 0 = disabled.'),
};

export const GalleryServerExtension = {
  mergePeopleAcrossOwners: galleryConfigBool.describe(
    "Allow a people merge to combine two of another user's people, or two people in a shared space the actor cannot edit, into one (a destructive collapse). Re-points that only move a single person to another identity are always allowed. When off, such combining merges are blocked; when on, each still requires an explicit confirmation.",
  ),
};

export const galleryJobDefaults = {
  [QueueName.PeopleBackfill]: { concurrency: 1 },
  [QueueName.PetDetection]: { concurrency: 1 },
  [QueueName.Classification]: { concurrency: 1 },
};

export const galleryMachineLearningDefaults = {
  clipMaxDistance: 0,
  faceSuggestions: { enabled: true, maxDistance: 0.7 },
  petDetection: { enabled: false, modelName: 'yolo11s', minScore: 0.6 },
};

export const galleryServerDefaults = { mergePeopleAcrossOwners: false };

export const galleryTopLevelDefaults = {
  memories: { retentionDays: 365, birthday: true, recentTrips: true, types: {} },
  classification: { enabled: true, categories: [] },
  // Gallery-fork: defaults to false, so out of the box storage usage matches upstream Immich
  // and counts original files only.
  storageUsage: { includeDerivatives: false },
};
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd server && npx vitest --config test/vitest.config.mjs --run src/gallery/config.dto.spec.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/gallery/config.dto.ts server/src/gallery/config.dto.spec.ts
git commit -m "feat(server): fork-owned config schema fragments for the #30881 port"
```

---

### Task 3: Compose the fragments into upstream's schema and defaults

**Files:**

- Modify: `server/src/dtos/config.dto.ts`
- Test: `server/src/gallery/config-composition.spec.ts` (create)

**Interfaces:**

- Consumes: every export from Task 2
- Produces: a `SystemConfig` type carrying the fork fields, so `queue.service.ts:104` compiles

- [ ] **Step 1: Write the failing no-silent-drop test**

This is the plan's highest-value test. The schema **strips** unknown keys rather than rejecting them, so a fork field missing from the schema vanishes silently at runtime rather than erroring.

Create `server/src/gallery/config-composition.spec.ts`:

```ts
import { AdminConfigDto, defaults } from 'src/dtos/config.dto';
import { describe, expect, it } from 'vitest';

describe('fork config survives schema composition', () => {
  const parsed = AdminConfigDto.schema.parse(defaults) as typeof defaults;

  it('keeps the fork top-level blocks', () => {
    expect(parsed.classification).toEqual({ enabled: true, categories: [] });
    expect(parsed.memories).toEqual({ retentionDays: 365, birthday: true, recentTrips: true, types: {} });
    expect(parsed.storageUsage).toEqual({ includeDerivatives: false });
  });

  it('keeps the fork machine-learning fields', () => {
    expect(parsed.machineLearning.clip.maxDistance).toBe(0);
    expect(parsed.machineLearning.facialRecognition.suggestions).toEqual({ enabled: true, maxDistance: 0.7 });
    expect(parsed.machineLearning.petDetection).toEqual({ enabled: false, modelName: 'yolo11s', minScore: 0.6 });
  });

  it('keeps the fork server flag and job concurrencies', () => {
    expect(parsed.server.mergePeopleAcrossOwners).toBe(false);
    expect(parsed.job.peopleBackfill).toEqual({ concurrency: 1 });
    expect(parsed.job.petDetection).toEqual({ concurrency: 1 });
    expect(parsed.job.classification).toEqual({ concurrency: 1 });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd server && npx vitest --config test/vitest.config.mjs --run src/gallery/config-composition.spec.ts`
Expected: FAIL — `parsed.classification` is `undefined` (stripped, not rejected — exactly the failure mode this guards)

- [ ] **Step 3: Compose the fragments**

In `server/src/dtos/config.dto.ts`, add the import:

```ts
import {
  GalleryClassificationSchema,
  GalleryClipExtension,
  GalleryFaceSuggestionSchema,
  GalleryMemoriesSchema,
  GalleryPetDetectionSchema,
  GalleryServerExtension,
  GalleryStorageUsageSchema,
  galleryJobDefaults,
  galleryMachineLearningDefaults,
  galleryServerDefaults,
  galleryTopLevelDefaults,
} from 'src/gallery/config.dto';
```

Then make these six edits inside `AdminConfigSchemaWithVisibility`:

1. `job` object — add three keys alongside the existing ones:

```ts
        peopleBackfill: AdminConfigJobSettingsSchema,
        petDetection: AdminConfigJobSettingsSchema,
        classification: AdminConfigJobSettingsSchema,
```

2. `clip` — currently `AdminConfigMachineLearningModelSchema.meta({ id: 'AdminConfigClipDto' })` used directly. Convert to an extend, keeping the `id`:

```ts
        clip: AdminConfigMachineLearningModelSchema.extend(GalleryClipExtension).meta({ id: 'AdminConfigClipDto' }),
```

3. `facialRecognition` — add to its existing `.extend({...})` object:

```ts
          suggestions: GalleryFaceSuggestionSchema,
```

4. `machineLearning` — add the fork task as a sibling of `clip` / `ocr`:

```ts
        petDetection: GalleryPetDetectionSchema,
```

5. `server` object — spread the fork extension in:

```ts
        ...GalleryServerExtension,
```

6. Top level, as siblings of `server` / `user`:

```ts
    classification: GalleryClassificationSchema,
    memories: GalleryMemoriesSchema,
    storageUsage: GalleryStorageUsageSchema,
```

Then in the `defaults` literal, add the matching values:

```ts
  // inside `job:`
  ...galleryJobDefaults,

  // inside `machineLearning.clip:`
  maxDistance: galleryMachineLearningDefaults.clipMaxDistance,

  // inside `machineLearning.facialRecognition:`
  suggestions: galleryMachineLearningDefaults.faceSuggestions,

  // inside `machineLearning:` as a sibling of clip/ocr
  petDetection: galleryMachineLearningDefaults.petDetection,

  // inside `server:`
  ...galleryServerDefaults,

  // top level
  ...galleryTopLevelDefaults,
```

Finally apply the fork's map-tile default overrides in the `map` block:

```ts
  map: {
    enabled: true,
    lightStyle: 'https://tiles.openfreemap.org/styles/positron',
    darkStyle: 'https://tiles.openfreemap.org/styles/dark',
  },
```

- [ ] **Step 4: Run the tests and the type check**

Run: `cd server && npx vitest --config test/vitest.config.mjs --run src/gallery/config-composition.spec.ts && pnpm check`
Expected: PASS, and `pnpm check` no longer reports `queue.service.ts:104`

- [ ] **Step 5: Commit**

```bash
git add server/src/dtos/config.dto.ts server/src/gallery/config-composition.spec.ts
git commit -m "feat(server): compose the fork config fragments into upstream's config schema"
```

---

### Task 4: Lock in the admin-only invariant

Guards Spec D1 and the S2 trap. Without this, a later refactor that builds a fork ML task from the shared model schema silently exposes it.

**Files:**

- Test: `server/src/gallery/config-visibility.spec.ts` (create)

**Interfaces:**

- Consumes: `mapUserConfig`, `mapPublicConfig`, `defaults` from `src/dtos/config.dto`
- Produces: nothing consumed downstream

- [ ] **Step 1: Write the test**

Assert on **key names**, not whole blocks: `machineLearning.clip` legitimately survives into the user projection because upstream's `clip.enabled` is user-visible. Only the fork's `maxDistance` must be absent.

```ts
import { defaults, mapPublicConfig, mapUserConfig } from 'src/dtos/config.dto';
import { describe, expect, it } from 'vitest';

const collectKeys = (value: unknown, path: string[] = [], out: string[] = []): string[] => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out.push([...path, key].join('.'));
      collectKeys(child, [...path, key], out);
    }
  }
  return out;
};

describe('fork config is admin-only', () => {
  const forbidden = [
    'classification',
    'memories',
    'storageUsage',
    'petDetection',
    'suggestions',
    'mergePeopleAcrossOwners',
    'maxDistance',
  ];

  it.each([
    ['user', mapUserConfig(defaults)],
    ['public', mapPublicConfig(defaults)],
  ])('exposes no fork config key to the %s projection', (_name, projection) => {
    const leaked = collectKeys(projection).filter((key) => forbidden.some((f) => key.split('.').includes(f)));
    expect(leaked).toEqual([]);
  });

  it('still exposes the upstream fields the clients rely on', () => {
    const userKeys = collectKeys(mapUserConfig(defaults));
    expect(userKeys).toContain('machineLearning.clip.enabled');
    expect(userKeys).toContain('map.lightStyle');
  });
});
```

Note `maxDistance` is in the forbidden list, and upstream's own `duplicateDetection.maxDistance` is **not** user-visible (its sibling `enabled` is, but `maxDistance` carries no annotation), so this assertion is safe. If a future upstream change annotates a `maxDistance` as `User`, this test correctly fails and forces a decision.

- [ ] **Step 2: Run it**

Run: `cd server && npx vitest --config test/vitest.config.mjs --run src/gallery/config-visibility.spec.ts`
Expected: PASS immediately — Task 3 left every fork field unannotated. If it FAILS, a fork fragment was built from `AdminConfigMachineLearningModelSchema`/`TaskSchema`; fix the fragment, not the test.

- [ ] **Step 3: Prove the test can fail**

Temporarily add `.meta({ visibility: User })` to `GalleryStorageUsageSchema.shape.includeDerivatives`, re-run, confirm FAIL, then revert. A guard that has never been seen red is not a guard.

- [ ] **Step 4: Assert the deprecated route is a true alias**

Spec Verification #6. `SystemConfigController.getConfig()` and `ConfigAdminController.getAdminConfig()` both delegate to `service.getAdminConfig()`, so fork fields reach both routes identically. Assert the delegation rather than diffing two payloads — the payload passes through untouched, so aliasing is the real property.

Append to `server/src/gallery/config-visibility.spec.ts`:

```ts
import { ConfigAdminController } from 'src/controllers/config-admin.controller';
import { SystemConfigController } from 'src/controllers/system-config.controller';
import { AdminConfigDto } from 'src/dtos/config.dto';
import { StorageTemplateService } from 'src/services/storage-template.service';
import { SystemConfigService } from 'src/services/system-config.service';
import { vi } from 'vitest';

describe('deprecated /system-config aliases /admin/config', () => {
  it('serves both routes from the same service method', async () => {
    const payload = { marker: true } as unknown as AdminConfigDto;
    const service = { getAdminConfig: vi.fn().mockResolvedValue(payload) } as unknown as SystemConfigService;
    const storageTemplateService = {} as unknown as StorageTemplateService;

    const legacy = new SystemConfigController(service, storageTemplateService);
    const modern = new ConfigAdminController(service);

    await expect(legacy.getConfig()).resolves.toBe(payload);
    await expect(modern.getAdminConfig()).resolves.toBe(payload);
    expect(service.getAdminConfig).toHaveBeenCalledTimes(2);
  });
});
```

Run: `cd server && npx vitest --config test/vitest.config.mjs --run src/gallery/config-visibility.spec.ts`
Expected: PASS. A failure here means the rebase dropped the deprecated controller's delegation.

- [ ] **Step 5: Commit**

```bash
git add server/src/gallery/config-visibility.spec.ts
git commit -m "test(server): assert fork config stays admin-only and both config routes alias"
```

---

### Task 5: Reconcile the config loader

`server/src/utils/config.ts` was reconciled textually in Task 1; this task proves the fork behaviours in it still hold against the new parser.

**Files:**

- Modify: `server/src/utils/config.ts` (only if Step 2 shows a defect)
- Test: `server/src/utils/config.spec.ts` (extend the existing file)

**Interfaces:**

- Consumes: `AdminConfigDto`, `defaults` from `src/dtos/config.dto`
- Produces: nothing consumed downstream

- [ ] **Step 1: Write the tests**

Append to `server/src/utils/config.spec.ts`, using the harness that file already establishes — `newConfigRepositoryMock()` / `newSystemMetadataRepositoryMock()` / `mockEnvData({})` driving `getConfig(repos(), { withCache: false })`. All imports it needs are already at the top of that file.

```ts
describe('gallery config loading', () => {
  let configRepo: ReturnType<typeof newConfigRepositoryMock>;
  let metadataRepo: ReturnType<typeof newSystemMetadataRepositoryMock>;
  let logger: { warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    configRepo = newConfigRepositoryMock(); // also clears the module-level config cache
    metadataRepo = newSystemMetadataRepositoryMock();
    logger = { warn: vi.fn(), error: vi.fn() };
    configRepo.getEnv.mockReturnValue(mockEnvData({})); // database source
  });

  const repos = () => ({
    configRepo: configRepo as unknown as ConfigRepository,
    metadataRepo: metadataRepo as unknown as SystemMetadataRepository,
    logger: logger as unknown as LoggingRepository,
  });

  it('treats an empty memories.types map as a known key, not an unknown one', async () => {
    metadataRepo.get.mockResolvedValue({ memories: { types: {} } });

    const config = await getConfig(repos(), { withCache: false });

    expect(config.memories.types).toEqual({});
    expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('Unknown keys found'));
  });

  it('keeps a populated defaults section when the partial supplies an empty object', async () => {
    metadataRepo.get.mockResolvedValue({ classification: {} });

    const config = await getConfig(repos(), { withCache: false });

    expect(config.classification.enabled).toBe(true);
  });

  it('preserves fork fields through validation', async () => {
    metadataRepo.get.mockResolvedValue({ storageUsage: { includeDerivatives: true } });

    const config = await getConfig(repos(), { withCache: false });

    expect(config.storageUsage.includeDerivatives).toBe(true);
    expect(config.machineLearning.petDetection.modelName).toBe('yolo11s');
  });
});
```

- [ ] **Step 2: Run them**

Run: `cd server && npx vitest --config test/vitest.config.mjs --run src/utils/config.spec.ts`
Expected: PASS. A failure on the first test means `getKeysDeep(defaults, [], { emptyObjectsAsLeaves: true })` lost its `emptyObjectsAsLeaves` option during the Task 1 reconciliation — restore it rather than changing the test.

- [ ] **Step 3: Verify the face-suggestion helpers still run**

Run: `cd server && npx vitest --config test/vitest.config.mjs --run src/utils/config.spec.ts -t suggestion`
Expected: the existing `foldLegacyFaceSuggestionConfig` / `deriveSuggestionBand` tests PASS unmodified. If they were deleted during the rebase, restore them from `git show <pre-rebase-tip>:server/src/utils/config.spec.ts`.

- [ ] **Step 4: Commit**

```bash
git add server/src/utils/config.spec.ts server/src/utils/config.ts
git commit -m "test(server): cover fork config loading against the new schema"
```

---

### Task 6: Repoint the two broken fork files

**Files:**

- Modify: `server/src/services/classification.service.ts:2`
- Delete: `server/src/dtos/model-config.dto.spec.ts`
- Test: `server/src/gallery/config.dto.spec.ts` (extend from Task 2)

**Interfaces:**

- Consumes: `ClassificationFaceExclusion`, `GalleryFaceSuggestionSchema` from `src/gallery/config.dto`; `SystemConfig` from `src/dtos/config.dto`
- Produces: nothing consumed downstream

- [ ] **Step 1: Repoint the classification service import**

Replace line 2 of `server/src/services/classification.service.ts`:

```ts
import { type SystemConfig } from 'src/dtos/config.dto';
import { type ClassificationFaceExclusion } from 'src/gallery/config.dto';
```

No logic changes.

- [ ] **Step 2: Migrate the orphaned spec's coverage**

`server/src/dtos/model-config.dto.spec.ts` tests `FacialRecognitionConfigSchema`'s `suggestions` block; that schema no longer exists. Its three assertions are already covered by the Task 2 fragment tests, except the "rejects a missing suggestions block" case. Add that to `server/src/gallery/config.dto.spec.ts`:

```ts
it('requires the suggestions block to be present when parsed as part of facial recognition', () => {
  expect(() => GalleryFaceSuggestionSchema.parse(undefined)).toThrow();
});
```

Then delete the orphan (this stages the deletion; Step 4 commits it):

```bash
git rm server/src/dtos/model-config.dto.spec.ts
```

- [ ] **Step 3: Run the affected suites**

Run: `cd server && npx vitest --config test/vitest.config.mjs --run src/gallery src/services/classification.service.spec.ts`
Expected: PASS, with `classification.service.spec.ts` passing **unmodified** — per spec Verification #7, needing to change it means the port altered behaviour.

- [ ] **Step 4: Commit**

```bash
git add server/src/services/classification.service.ts server/src/gallery/config.dto.spec.ts
git commit -m "refactor(server): repoint fork config consumers at the gallery module"
```

The `git rm` from Step 2 is already staged, so it rides along with this commit.

---

### Task 7: Regenerate artifacts and run the full gate

**Files:**

- Modify: `open-api/immich-openapi-specs.json`, `packages/sdk/src/fetch-client.ts`

**Interfaces:**

- Consumes: the composed schema from Task 3
- Produces: regenerated OpenAPI spec and TypeScript SDK

- [ ] **Step 1: Rebuild and regenerate**

```bash
cd server && pnpm build && cd ..
make open-api
git diff --stat
```

Expected: the spec gains `AdminConfigClassificationDto`, `AdminConfigMemoriesDto`, `AdminConfigStorageUsageDto`, `AdminConfigPetDetectionDto`, `AdminConfigFaceSuggestionDto`, and the fork fields on `AdminConfigClipDto` / `AdminConfigServerDto` / `AdminConfigJobDto`.

Do **not** judge this by `git status` alone after redirecting output — run it visibly and read the exit code.

`make open-api` regenerates the Dart client too, which needs Java. If Java is unavailable, run `make open-api-typescript` instead and note it — the Dart client is generated into gitignored `mobile/generated/openapi`, so there is no committed Dart artifact to drift, and CI regenerates it.

- [ ] **Step 2: Confirm no visibility metadata leaked into the spec**

```bash
grep -c '"visibility"' open-api/immich-openapi-specs.json
```

Expected: `0`. `stripVisibilityMetadata` handles this for upstream fields; fork fragments carry no visibility at all, so a non-zero count means a fragment picked up an annotation.

- [ ] **Step 3: Run the local gate**

```bash
cd server && pnpm check && pnpm lint && npx prettier --check . && npx vitest --config test/vitest.config.mjs --run && cd ..
cd web && pnpm check:typescript && pnpm check:svelte && npx vitest --run && cd ..
cd e2e && pnpm check && cd ..
```

Expected: all PASS. The five fork-owned web files naming `SystemConfigDto` keep compiling via upstream's retained alias — renaming them is out of scope.

- [ ] **Step 4: Commit**

```bash
git add open-api/ packages/sdk/
git commit -m "chore: regenerate OpenAPI spec and SDK after the config port"
```

- [ ] **Step 5: Push and dispatch CI**

```bash
git push origin HEAD:rebase/upstream-batch-131 --force
REF=rebase/upstream-batch-131
for wf in test.yml docker.yml static_analysis.yml gallery-rebase-smoke.yml storage-migration-tests.yml gallery-revert-to-immich-validation.yml gallery-ml-smoke.yml gallery-mobile-smoke.yml; do
  gh --repo open-noodle/gallery workflow run "$wf" --ref "$REF"
done
gh --repo open-noodle/gallery workflow run storage-migration-e2e.yml --ref "$REF" --field branch="$REF"
gh --repo open-noodle/gallery workflow run gallery-build-mobile.yml --ref "$REF" --field environment=development
```

`gallery-revert-to-immich-validation` matters here specifically: its section 5 strips the merged `classification` key from `system_metadata`, and this port touches how `classification` is declared.
