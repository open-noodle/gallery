# Pet Detection RF-DETR — Slice 3: Server config and legacy migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `rfdetr-nano` / `minScore 0.3` as the pet detection defaults, and transparently migrate existing installs whose persisted config still names a YOLO model.

**Architecture:** The defaults change is a two-line edit to `server/src/config.ts`. The migration is a small exported helper called from `buildConfig` in `server/src/utils/config.ts`, after the persisted partial is merged over the defaults and before Zod validation. Every config read in the server — admin API, background jobs, the ML repository — funnels through `getConfig` → `buildConfig`, so one normalisation covers all of them.

**Tech Stack:** NestJS 11, TypeScript (strict), Zod v4, Vitest, lodash.

## Global Constraints

Copied from the spec (`docs/superpowers/specs/2026-07-23-pet-detection-rfdetr-design.md`):

- Default `modelName` is `rfdetr-nano`; default `minScore` is `0.3`.
- Any persisted `modelName` starting `yolo` (case-insensitive) becomes `rfdetr-nano` on read.
- `rfdetr-nano` and `rfdetr-small` pass through untouched. So does any other non-`yolo` value.
- **Do not** add a Zod `.transform()` or `.preprocess()` to `PetDetectionConfigSchema`. Transforming a field changes the schema's inferred output type, that type flows into the generated OpenAPI document, and both the TypeScript SDK and the Dart client would need regenerating via `make open-api`. The migration must not touch the API contract.
- No relative imports in `server/` — use the `src/` path alias.
- Prettier: 120 columns, single quotes, trailing commas, semicolons. CI runs `prettier --check` over the **whole** package, not just changed files.
- ESLint runs with `--max-warnings 0` in `server/`.
- Scope is `server/` and `e2e/` only. No ML, web, or docs changes — those are Slices 2, 4 and 5.

## Scope

Slice 3 of 5. Slice 2 (the RF-DETR detector) is already merged into this branch. Slice 1 (publishing weights) is blocked on a HuggingFace write token and is a **merge gate** for the branch, but does not block this slice's code or tests.

---

## File Structure

| File                                                          | Status     | Responsibility                                           |
| ------------------------------------------------------------- | ---------- | -------------------------------------------------------- |
| `server/src/config.ts`                                        | **Modify** | New default `modelName` / `minScore`.                    |
| `server/src/utils/config.ts`                                  | **Modify** | Export the migration helper; call it from `buildConfig`. |
| `server/src/utils/config.spec.ts`                             | **Create** | Unit tests for the helper (spec #27–#29).                |
| `server/src/services/system-config.service.spec.ts`           | **Modify** | Default fixture (spec #26).                              |
| `server/src/services/pet-detection.service.spec.ts`           | **Modify** | Fixture uses a valid model name.                         |
| `server/src/repositories/machine-learning.repository.spec.ts` | **Modify** | Fixture uses a valid model name.                         |
| `e2e/src/specs/server/api/pet-detection.e2e-spec.ts`          | **Modify** | Defaults + model-switch scenarios (spec #30a–#30c).      |

## Reference: commands

```bash
cd server
pnpm test -- --run src/utils/config.spec.ts          # this slice's new unit tests
pnpm test                                             # full server unit suite
pnpm lint                                             # eslint, --max-warnings 0
pnpm prettier --check .                               # CI checks the WHOLE package
```

Note: `pnpm test -- --run <path>` is known to drop the path filter in this repo. If it runs the
whole suite, that is expected — read the summary rather than assuming the filter applied.

---

## Task 1: Change the defaults

**Files:**

- Modify: `server/src/config.ts:357-361`
- Modify: `server/src/services/system-config.service.spec.ts:145-149`
- Modify: `server/src/services/pet-detection.service.spec.ts:192`
- Modify: `server/src/repositories/machine-learning.repository.spec.ts:51`

**Interfaces:**

- Produces: `defaults.machineLearning.petDetection = { enabled: false, modelName: 'rfdetr-nano', minScore: 0.3 }`. Task 2 relies on this shape.

- [ ] **Step 1: Update the failing fixture first**

In `server/src/services/system-config.service.spec.ts`, find the `petDetection` block (around line 145) and change it to:

```typescript
    petDetection: {
      enabled: false,
      modelName: 'rfdetr-nano',
      minScore: 0.3,
    },
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && pnpm test -- --run src/services/system-config.service.spec.ts`
Expected: FAIL — the fixture now expects `rfdetr-nano` / `0.3` while `defaults` still says `yolo11s` / `0.6`.

- [ ] **Step 3: Change the defaults**

In `server/src/config.ts`, replace lines 357-361:

```typescript
    petDetection: {
      enabled: false,
      modelName: 'yolo11s',
      minScore: 0.6,
    },
```

with:

```typescript
    petDetection: {
      enabled: false,
      modelName: 'rfdetr-nano',
      minScore: 0.3,
    },
```

- [ ] **Step 4: Update the two remaining fixtures**

In `server/src/repositories/machine-learning.repository.spec.ts:51`, change `modelName: 'yolo11s',` to `modelName: 'rfdetr-nano',`.

In `server/src/services/pet-detection.service.spec.ts:192`, change:

```typescript
        petDetection: { enabled: true, modelName: 'yolo11n', minScore: 0.6 },
```

to:

```typescript
        petDetection: { enabled: true, modelName: 'rfdetr-nano', minScore: 0.3 },
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd server && pnpm test`
Expected: PASS, zero failures.

- [ ] **Step 6: Commit**

```bash
git add server/src/config.ts server/src/services/system-config.service.spec.ts server/src/services/pet-detection.service.spec.ts server/src/repositories/machine-learning.repository.spec.ts
git commit -m "feat(server): default pet detection to rfdetr-nano at 0.3"
```

---

## Task 2: Migrate legacy YOLO model names

**Files:**

- Create: `server/src/utils/config.spec.ts`
- Modify: `server/src/utils/config.ts`

**Interfaces:**

- Consumes: `defaults` from Task 1.
- Produces: `export const migrateLegacyPetDetectionModel = (config: SystemConfig): SystemConfig` — mutates and returns the config. Called from `buildConfig`.

- [ ] **Step 1: Write the failing tests**

Create `server/src/utils/config.spec.ts`:

```typescript
import { defaults } from 'src/config';
import { migrateLegacyPetDetectionModel } from 'src/utils/config';
import { describe, expect, it } from 'vitest';

const configWith = (modelName: string) => {
  const config = structuredClone(defaults);
  config.machineLearning.petDetection.modelName = modelName;
  return config;
};

describe('migrateLegacyPetDetectionModel', () => {
  // Spec #27 — the three model names the admin UI used to offer.
  it.each(['yolo11n', 'yolo11s', 'yolo11m'])('maps the legacy %s to rfdetr-nano', (legacy) => {
    const result = migrateLegacyPetDetectionModel(configWith(legacy));
    expect(result.machineLearning.petDetection.modelName).toBe('rfdetr-nano');
  });

  // Spec #28 — anything else in the yolo family, including casing we never shipped.
  it.each(['yolov8n-animals', 'yolo26m', 'YOLO11S'])('maps the unknown legacy %s to rfdetr-nano', (legacy) => {
    const result = migrateLegacyPetDetectionModel(configWith(legacy));
    expect(result.machineLearning.petDetection.modelName).toBe('rfdetr-nano');
  });

  // Spec #29 — current values must survive untouched.
  it.each(['rfdetr-nano', 'rfdetr-small'])('leaves %s untouched', (current) => {
    const result = migrateLegacyPetDetectionModel(configWith(current));
    expect(result.machineLearning.petDetection.modelName).toBe(current);
  });

  it('leaves an unrelated custom model name untouched', () => {
    const result = migrateLegacyPetDetectionModel(configWith('my-custom-detector'));
    expect(result.machineLearning.petDetection.modelName).toBe('my-custom-detector');
  });

  it('does not touch any other machine learning model name', () => {
    const config = configWith('yolo11s');
    const before = config.machineLearning.clip.modelName;
    const result = migrateLegacyPetDetectionModel(config);
    expect(result.machineLearning.clip.modelName).toBe(before);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && pnpm test -- --run src/utils/config.spec.ts`
Expected: FAIL — `migrateLegacyPetDetectionModel` is not exported from `src/utils/config`.

- [ ] **Step 3: Implement the helper**

In `server/src/utils/config.ts`, add after the `RepoDeps` type (around line 17):

```typescript
const LEGACY_PET_MODEL_PREFIX = 'yolo';
const DEFAULT_PET_MODEL = 'rfdetr-nano';

/**
 * Pet detection moved from YOLO11 to RF-DETR. Installs that persisted a `yolo*`
 * model name would otherwise keep requesting a model the ML service no longer
 * knows how to build, so rewrite it to the current default on read. Applied in
 * `buildConfig` rather than in the Zod schema on purpose: transforming the DTO
 * field would change the generated OpenAPI types and force an SDK regeneration.
 */
export const migrateLegacyPetDetectionModel = (config: SystemConfig): SystemConfig => {
  const { petDetection } = config.machineLearning;
  if (petDetection.modelName.toLowerCase().startsWith(LEGACY_PET_MODEL_PREFIX)) {
    petDetection.modelName = DEFAULT_PET_MODEL;
  }

  return config;
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && pnpm test -- --run src/utils/config.spec.ts`
Expected: PASS.

- [ ] **Step 5: Wire it into `buildConfig`**

In `server/src/utils/config.ts`, inside `buildConfig`, immediately after the merge loop that ends with `_.set(rawConfig, property, _.get(partial, property));` and its closing brace — that is, directly before the `// check for extra properties` comment — insert:

```typescript
// Rewrite retired model names before validation so every consumer, including the
// admin settings UI, sees the migrated value rather than a stale one.
migrateLegacyPetDetectionModel(rawConfig);
```

- [ ] **Step 6: Run the full server suite**

Run: `cd server && pnpm test`
Expected: PASS, zero failures.

- [ ] **Step 7: Commit**

```bash
git add server/src/utils/config.ts server/src/utils/config.spec.ts
git commit -m "feat(server): migrate persisted yolo pet detection models to rfdetr-nano"
```

---

## Task 3: Update the e2e pet detection spec

**Files:**

- Modify: `e2e/src/specs/server/api/pet-detection.e2e-spec.ts:40-47`, `:61-76`, `:148-156`

**Interfaces:**

- Consumes: the defaults from Task 1 and the migration from Task 2.

Two of these tests currently write a `yolo*` value and assert it reads back unchanged. The
migration deliberately breaks that, so they are rewritten rather than patched.

- [ ] **Step 1: Update the defaults assertion (spec #30a)**

Replace lines 40-47:

```typescript
it('should have pet detection disabled by default with yolo11s and 0.6 minScore', async () => {
  const config = await getSystemConfig(admin.accessToken);

  expect(config.machineLearning.petDetection).toEqual({
    enabled: false,
    modelName: 'yolo11s',
    minScore: 0.6,
  });
});
```

with:

```typescript
it('should have pet detection disabled by default with rfdetr-nano and 0.3 minScore', async () => {
  const config = await getSystemConfig(admin.accessToken);

  expect(config.machineLearning.petDetection).toEqual({
    enabled: false,
    modelName: 'rfdetr-nano',
    minScore: 0.3,
  });
});
```

- [ ] **Step 2: Replace both model-switch tests (spec #30b, #30c)**

Replace the two blocks at lines 61-76 (`should change model to yolo11n` and
`should change model to yolo11m`) with:

```typescript
it('should change model to rfdetr-small', async () => {
  const config = await getSystemConfig(admin.accessToken);
  config.machineLearning.petDetection.modelName = 'rfdetr-small';
  await updateConfig({ systemConfigDto: config }, { headers: asBearerAuth(admin.accessToken) });

  const refetched = await getSystemConfig(admin.accessToken);
  expect(refetched.machineLearning.petDetection.modelName).toBe('rfdetr-small');
});

it('should migrate a persisted legacy yolo model to rfdetr-nano', async () => {
  const config = await getSystemConfig(admin.accessToken);
  config.machineLearning.petDetection.modelName = 'yolo11m';
  await updateConfig({ systemConfigDto: config }, { headers: asBearerAuth(admin.accessToken) });

  const refetched = await getSystemConfig(admin.accessToken);
  expect(refetched.machineLearning.petDetection.modelName).toBe('rfdetr-nano');
});
```

- [ ] **Step 3: Update the reset-to-defaults assertion**

At what was line 148-156, replace:

```typescript
expect(config.machineLearning.petDetection).toEqual({
  enabled: false,
  modelName: 'yolo11s',
  minScore: 0.6,
});
```

with:

```typescript
expect(config.machineLearning.petDetection).toEqual({
  enabled: false,
  modelName: 'rfdetr-nano',
  minScore: 0.3,
});
```

- [ ] **Step 4: Verify no YOLO references remain in the e2e spec**

Run: `grep -n "yolo" e2e/src/specs/server/api/pet-detection.e2e-spec.ts`
Expected: exactly one match — the string `'yolo11m'` inside the migration test from Step 2.

- [ ] **Step 5: Type-check the e2e package**

Run: `cd e2e && pnpm exec tsc --noEmit`
Expected: no errors.

The e2e suite itself needs a running stack and is not required to pass locally for this slice;
CI runs it. Type-checking is the local gate.

- [ ] **Step 6: Commit**

```bash
git add e2e/src/specs/server/api/pet-detection.e2e-spec.ts
git commit -m "test(e2e): assert rfdetr defaults and legacy model migration"
```

---

## Task 4: Full verification

- [ ] **Step 1: Server unit tests**

Run: `cd server && pnpm test`
Expected: zero failures.

- [ ] **Step 2: Lint**

Run: `cd server && pnpm lint`
Expected: zero errors, zero warnings (`--max-warnings 0`).

- [ ] **Step 3: Prettier across the whole package**

Run: `cd server && pnpm prettier --check .`
Expected: "All matched files use Prettier code style!". If not, run `pnpm prettier --write .`
limited to the files this slice touched, then re-check.

- [ ] **Step 4: Type-check**

Run: `cd server && pnpm check`
Expected: no errors.

- [ ] **Step 5: Confirm no stale YOLO references in server source**

Run: `grep -rn "yolo" server/src/`
Expected: exactly one match — `LEGACY_PET_MODEL_PREFIX = 'yolo'` in `src/utils/config.ts`.

- [ ] **Step 6: Commit any formatting fixes**

```bash
git add -A server/ e2e/
git commit -m "style(server): formatting for rfdetr config migration"
```

Skip this commit if there is nothing to stage.

---

## Self-Review

**Spec coverage.** #26 → Task 1 Step 1. #27, #28, #29 → Task 2 Step 1. #30 (a persisted override surfacing migrated through the API) → Task 3 Step 2's migration test, which is the true end-to-end form of it; the unit tests in Task 2 cover the pure logic. #30a, #30b, #30c → Task 3.

**Placeholders.** None. Every step has literal code or a literal command.

**Type consistency.** `migrateLegacyPetDetectionModel` takes and returns `SystemConfig`, which `buildConfig`'s `rawConfig` already is (`_.cloneDeep(defaults)`). `SystemConfig` is already imported in `src/utils/config.ts:4`. The helper mutates in place and also returns, so the `buildConfig` call site can ignore the return value while the tests can use it.

**One judgement call flagged.** The prefix match is `startsWith('yolo')` on a lowercased name, so it also captures `yolov8n-animals` from the original 2026-03 design and any hypothetical `yolo26*`. That is deliberate — every `yolo*` name is now unbuildable by the ML service, so mapping them all to the default is strictly better than letting them fail at download. It would wrongly rewrite a user's custom model that happened to start with "yolo", which is an acceptable trade given the ML service could not load it either.
