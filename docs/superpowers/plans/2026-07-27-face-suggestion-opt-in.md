# Face Suggestion Opt-In Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `suggestionMaxDistance = 0` sentinel that enables face suggestions with an explicit `suggestions.enabled` toggle that auto-fills a sensible distance and starts the first scan by itself.

**Architecture:** `machineLearning.facialRecognition.suggestionMaxDistance` becomes a nested `suggestions: { enabled, maxDistance }` object. A single `isFaceSuggestionEnabled` helper in `src/utils/misc.ts` replaces eight scattered band comparisons and gains three new read-path guards. A `ConfigValidate` hook rejects a band that can never produce results; a `ConfigUpdate` hook queues the maintenance scan on the false → true transition. A load-time fold in `src/utils/config.ts` keeps already-configured instances working across the key rename, for both database- and file-sourced config.

**Tech Stack:** NestJS 11 + Kysely (server), Zod DTOs, SvelteKit 5 (web), Vitest (unit + medium), Playwright/Vitest (e2e), oazapfts TypeScript SDK, OpenAPI Generator (Dart).

**Spec:** `docs/superpowers/specs/2026-07-27-face-suggestion-opt-in-design.md`

## Global Constraints

- Worktree: `/Users/pierre/dev/gallery/.claude/worktrees/pr834-rebase`, branch `feat/face-review-unified`. All paths below are relative to that worktree root.
- Server has no relative imports — always use the `src/` path alias.
- ESLint runs with `--max-warnings 0`. Prettier is a separate CI gate from ESLint; passing one does not imply the other.
- Server unit tests **must** pass `--config test/vitest.config.mjs`, or collection fails with "describe is not defined".
- Run a single server test file with `pnpm test -- --run <path>`; the bare `pnpm test -- <path>` form silently drops the path filter and runs everything.
- Never run `make sql` / `mise //:sql` without a running database — it deletes all query files.
- `i18n/` is shared by web and mobile. New keys only need adding to `en.json`; translations land in the nine other locales in Task 7.
- Prettier reaches `docs/` and `docs/superpowers/**` — CI Docs Build is strict.
- Do not commit branded output; leave upstream Immich names in source.
- No `Co-Authored-By` or "Generated with" trailers on commits.

---

### Task 1: Nested config shape, the helper, and every guard

The config key rename is atomic — the tree does not compile until every consumer moves. This task therefore carries the shape change, the helper, all eight service guards, the three new read-path guards, and the specs that break.

**Files:**

- Modify: `server/src/config.ts` (interface ~`:96-103`, defaults ~`:344-351`)
- Modify: `server/src/dtos/model-config.dto.ts:32-52`
- Modify: `server/src/utils/misc.ts` (after `:113`)
- Modify: `server/src/services/person.service.ts` (`:372`, `:690`, `:854`, `:871`, `:928`, `:948`, `:1028`)
- Modify: `server/src/services/shared-space.service.ts` (`:1280`, `:1312`, `:3229`, `:3342`)
- Modify: `server/src/services/job.service.ts:100-101`
- Test: `server/src/utils/misc.spec.ts` (create if absent)
- Test: `server/src/dtos/model-config.dto.spec.ts`
- Test: `server/src/services/person.service.spec.ts`, `job.service.spec.ts`, `shared-space.service.spec.ts`, `system-config.service.spec.ts:137`
- Test: `server/src/repositories/machine-learning.repository.spec.ts:47`
- Test: `server/test/medium/specs/services/face-review-cross-flow.spec.ts:117-121`, `face-suggestion-exclusions.spec.ts:46-50`, `shared-space-face-suggestions.service.spec.ts:41`

**Interfaces:**

- Produces: `isFaceSuggestionEnabled(machineLearning: SystemConfig['machineLearning']): boolean` — used by Tasks 3 and 4.
- Produces: config path `machineLearning.facialRecognition.suggestions.{enabled,maxDistance}` — used by Tasks 2, 5, 6, 8.
- Note: the repository opts object keeps its existing field names `{ maxDistance, suggestionMaxDistance }`. It describes a distance band, not config keys. Callers pass `suggestionMaxDistance: facialRecognition.suggestions.maxDistance`. Do not rename it.

- [ ] **Step 1: Write the failing helper test**

Create `server/src/utils/misc.spec.ts` (if it exists, append the `describe` block):

```ts
import { defaults } from 'src/config';
import { isFaceSuggestionEnabled } from 'src/utils/misc';
import { describe, expect, it } from 'vitest';

const build = (overrides: {
  ml?: boolean;
  fr?: boolean;
  suggestions?: boolean;
  maxDistance?: number;
  suggestionMaxDistance?: number;
}) => ({
  ...defaults.machineLearning,
  enabled: overrides.ml ?? true,
  facialRecognition: {
    ...defaults.machineLearning.facialRecognition,
    enabled: overrides.fr ?? true,
    maxDistance: overrides.maxDistance ?? 0.5,
    suggestions: {
      enabled: overrides.suggestions ?? true,
      maxDistance: overrides.suggestionMaxDistance ?? 0.7,
    },
  },
});

describe('isFaceSuggestionEnabled', () => {
  it('is true when machine learning, facial recognition and suggestions are all on with a valid band', () => {
    expect(isFaceSuggestionEnabled(build({}))).toBe(true);
  });

  it('is false when machine learning is disabled', () => {
    expect(isFaceSuggestionEnabled(build({ ml: false }))).toBe(false);
  });

  it('is false when facial recognition is disabled', () => {
    expect(isFaceSuggestionEnabled(build({ fr: false }))).toBe(false);
  });

  it('is false when suggestions are disabled, even with a valid band', () => {
    expect(isFaceSuggestionEnabled(build({ suggestions: false }))).toBe(false);
  });

  it('is false when the band is inverted', () => {
    expect(isFaceSuggestionEnabled(build({ maxDistance: 0.5, suggestionMaxDistance: 0.5 }))).toBe(false);
  });

  it('is false when the suggestion distance is below the recognition distance', () => {
    expect(isFaceSuggestionEnabled(build({ maxDistance: 0.5, suggestionMaxDistance: 0.4 }))).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd server && pnpm test -- --run src/utils/misc.spec.ts`
Expected: FAIL — `isFaceSuggestionEnabled` is not exported, and `defaults.machineLearning.facialRecognition.suggestions` is undefined.

- [ ] **Step 3: Change the config interface and defaults**

In `server/src/config.ts`, replace `suggestionMaxDistance: number;` in the `facialRecognition` interface block with the following (it is an interface member, so keep the trailing semicolon after the closing brace):

```text
      suggestions: {
        enabled: boolean;
        maxDistance: number;
      };
```

and replace `suggestionMaxDistance: 0,` in the defaults block with:

```ts
      suggestions: {
        enabled: false,
        maxDistance: 0.7,
      },
```

- [ ] **Step 4: Add the helper**

In `server/src/utils/misc.ts`, immediately after the `isFacialRecognitionEnabled` definition:

```ts
export const isFaceSuggestionEnabled = (machineLearning: SystemConfig['machineLearning']) =>
  isFacialRecognitionEnabled(machineLearning) &&
  machineLearning.facialRecognition.suggestions.enabled &&
  machineLearning.facialRecognition.suggestions.maxDistance > machineLearning.facialRecognition.maxDistance;
```

- [ ] **Step 5: Run the helper test to verify it passes**

Run: `cd server && pnpm test -- --run src/utils/misc.spec.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Update the DTO schema**

In `server/src/dtos/model-config.dto.ts`, add above `FacialRecognitionConfigSchema`:

```ts
export const FaceSuggestionConfigSchema = z
  .object({
    enabled: z.boolean().describe('Whether face suggestions are enabled'),
    maxDistance: z
      .number()
      .meta({ format: 'double' })
      .min(0.1)
      .max(2)
      .describe('Maximum embedding distance for a face to be surfaced as a suggestion on a named person'),
  })
  .meta({ id: 'FaceSuggestionConfig' });
```

and inside `FacialRecognitionConfigSchema`, replace the whole `suggestionMaxDistance: z...` block with:

```ts
  suggestions: FaceSuggestionConfigSchema,
```

- [ ] **Step 7: Replace the eight service guards**

In `server/src/services/person.service.ts`, add `isFaceSuggestionEnabled` to the existing import on `:67`:

```ts
import { isFaceSuggestionEnabled, isFacialRecognitionEnabled } from 'src/utils/misc';
```

At `:689-690` (rename-triggered rescan) replace the two destructuring/derivation lines with:

```ts
const featureEnabled = isFaceSuggestionEnabled(machineLearning);
```

At `:853-854` replace the `const { maxDistance, suggestionMaxDistance } = ...` / `if (suggestionMaxDistance > maxDistance) {` pair with:

```ts
      if (isFaceSuggestionEnabled(machineLearning)) {
```

At `:870-872`, `:927-929`, `:947-949`, `:1027-1029` replace each `const { maxDistance, suggestionMaxDistance } = machineLearning.facialRecognition;` + `if (suggestionMaxDistance <= maxDistance) {` pair with:

```ts
if (!isFaceSuggestionEnabled(machineLearning)) {
  return JobStatus.Skipped;
}
```

In `server/src/services/job.service.ts`, import the helper and replace `:100-103` with:

```ts
const { machineLearning } = await this.getConfig({ withCache: false });
if (!isFaceSuggestionEnabled(machineLearning)) {
  return JobStatus.Skipped;
}
```

In `server/src/services/shared-space.service.ts`, import the helper and replace the body of `areSpacePersonSuggestionsEnabled` (`:3227-3231`) with:

```ts
  private async areSpacePersonSuggestionsEnabled({ withCache }: { withCache: boolean }): Promise<boolean> {
    const { machineLearning } = await this.getConfig({ withCache });
    return isFaceSuggestionEnabled(machineLearning);
  }
```

and update `getFaceSuggestionDistanceConfig` (`:3342-3348`) to read from the nested object:

```ts
  private async getFaceSuggestionDistanceConfig() {
    const { machineLearning } = await this.getConfig({ withCache: false });
    return {
      maxDistance: machineLearning.facialRecognition.maxDistance,
      suggestionMaxDistance: machineLearning.facialRecognition.suggestions.maxDistance,
    };
  }
```

- [ ] **Step 8: Write the failing read-path guard tests**

The repository short-circuits only know the band. With `enabled: false` and a retained valid band they do not fire, so each read path needs its own guard. Add to `server/src/services/person.service.spec.ts`, inside the existing `describe('getFaceSuggestions')` block (create the block if absent, following the file's `newTestService` setup):

```ts
it('returns an empty page without querying when suggestions are disabled but the band is still valid', async () => {
  mocks.systemMetadata.get.mockResolvedValue({
    machineLearning: {
      enabled: true,
      facialRecognition: { enabled: true, maxDistance: 0.5, suggestions: { enabled: false, maxDistance: 0.7 } },
    },
  });
  mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set(['person-1']));

  await expect(sut.getFaceSuggestions(authStub.admin, 'person-1', { page: 1, size: 10 })).resolves.toEqual({
    total: 0,
    items: [],
  });

  expect(mocks.facePersonVerdict.getPendingForPerson).not.toHaveBeenCalled();
});
```

Add the space equivalents to `server/src/services/shared-space.service.spec.ts`, matching that file's existing membership-mock setup for editor-role reads:

```ts
it('returns an empty page without querying when suggestions are disabled but the band is still valid', async () => {
  mocks.systemMetadata.get.mockResolvedValue({
    machineLearning: {
      enabled: true,
      facialRecognition: { enabled: true, maxDistance: 0.5, suggestions: { enabled: false, maxDistance: 0.7 } },
    },
  });

  await expect(
    sut.getSpacePersonFaceSuggestions(authStub.admin, 'space-1', 'person-1', { page: 1, size: 10 }),
  ).resolves.toEqual({ total: 0, items: [] });

  expect(mocks.facePersonVerdict.getPendingForSpacePerson).not.toHaveBeenCalled();
});

it('does not confirm a space suggestion when suggestions are disabled but the band is still valid', async () => {
  mocks.systemMetadata.get.mockResolvedValue({
    machineLearning: {
      enabled: true,
      facialRecognition: { enabled: true, maxDistance: 0.5, suggestions: { enabled: false, maxDistance: 0.7 } },
    },
  });

  await sut.confirmSpacePersonFaceSuggestion(authStub.admin, 'space-1', 'person-1', 'face-1');

  expect(mocks.facePersonVerdict.hasPendingForSpacePerson).not.toHaveBeenCalled();
});
```

- [ ] **Step 9: Run the read-path tests to verify they fail**

Run: `cd server && pnpm test -- --run src/services/person.service.spec.ts src/services/shared-space.service.spec.ts`
Expected: FAIL — the repositories are still called, because nothing guards the read paths.

- [ ] **Step 10: Add the three read-path guards**

In `person.service.ts`, in `getFaceSuggestions` replace `:371-378` with:

```ts
const { machineLearning } = await this.getConfig({ withCache: true });
if (!isFaceSuggestionEnabled(machineLearning)) {
  return { total: 0, items: [] };
}

const { maxDistance, suggestions } = machineLearning.facialRecognition;
const { total, items } = await this.facePersonVerdictRepository.getPendingForPerson(id, {
  maxDistance,
  suggestionMaxDistance: suggestions.maxDistance,
  page: dto.page,
  size: dto.size,
});
```

In `shared-space.service.ts`, insert before `:1280`:

```ts
if (!(await this.areSpacePersonSuggestionsEnabled({ withCache: true }))) {
  return { total: 0, items: [] };
}
```

and before `:1312`:

```ts
if (!(await this.areSpacePersonSuggestionsEnabled({ withCache: true }))) {
  return;
}
```

- [ ] **Step 11: Update the remaining specs to the nested shape**

Replace `suggestionMaxDistance: 0,` with `suggestions: { enabled: false, maxDistance: 0.7 },` in `server/src/services/system-config.service.spec.ts:137` and `server/src/repositories/machine-learning.repository.spec.ts:47`.

Rewrite `server/src/dtos/model-config.dto.spec.ts` to target the nested schema:

```ts
import { defaults } from 'src/config';
import { FacialRecognitionConfigSchema } from 'src/dtos/model-config.dto';
import { describe, expect, it } from 'vitest';

describe('FacialRecognitionConfigSchema suggestions', () => {
  const base = {
    enabled: true,
    modelName: 'buffalo_l',
    minScore: 0.7,
    maxDistance: 0.5,
    minFaces: 3,
  };

  it('accepts a valid suggestions block', () => {
    const parsed = FacialRecognitionConfigSchema.parse({ ...base, suggestions: { enabled: true, maxDistance: 0.7 } });
    expect(parsed.suggestions).toEqual({ enabled: true, maxDistance: 0.7 });
  });

  it('rejects a suggestion distance below the 0.1 minimum', () => {
    expect(() =>
      FacialRecognitionConfigSchema.parse({ ...base, suggestions: { enabled: false, maxDistance: 0 } }),
    ).toThrow();
  });

  it('rejects a missing suggestions block', () => {
    expect(() => FacialRecognitionConfigSchema.parse(base)).toThrow();
  });

  it('defaults to disabled with a 0.7 band', () => {
    expect(defaults.machineLearning.facialRecognition.suggestions).toEqual({ enabled: false, maxDistance: 0.7 });
  });
});
```

In `server/src/services/job.service.spec.ts:111` and `:124`, replace the inline config objects:

```ts
        machineLearning: {
          enabled: true,
          facialRecognition: { enabled: true, maxDistance: 0.5, minFaces: 3, suggestions: { enabled: true, maxDistance: 0.8 } },
        },
```

and for the disabled case at `:124`:

```ts
        machineLearning: {
          enabled: true,
          facialRecognition: { enabled: true, maxDistance: 0.5, minFaces: 3, suggestions: { enabled: false, maxDistance: 0.8 } },
        },
```

In the three medium specs, update only the config-shaped objects (leave repository opts alone):

- `server/test/medium/specs/services/face-review-cross-flow.spec.ts:117-121` — the comment names the config path; change it to `machineLearning.facialRecognition.{maxDistance,suggestions.maxDistance}` and set `suggestions: { enabled: true, maxDistance: 0.8 }` wherever the config object is built.
- `server/test/medium/specs/services/face-suggestion-exclusions.spec.ts:46-50` — keep `BAND` as-is for repository opts; where `BAND.suggestionMaxDistance` feeds a **config** object, emit `suggestions: { enabled: true, maxDistance: BAND.suggestionMaxDistance }`.
- `server/test/medium/specs/services/shared-space-face-suggestions.service.spec.ts:41` — replace with `machineLearning: { enabled: true, facialRecognition: { enabled: true, maxDistance: 0.5, suggestions: { enabled: true, maxDistance: 0.8 } } }`.

- [ ] **Step 12: Run the full server unit suite**

Run: `cd server && pnpm test -- --run && pnpm check`
Expected: all unit tests PASS, `tsc --noEmit` clean. Any remaining `suggestionMaxDistance` type error points at a config consumer that still needs converting — fix it before moving on.

- [ ] **Step 13: Commit**

```bash
git add server/src server/test
git commit -m "feat(server): explicit suggestions.enabled config with one enablement helper

Replaces the suggestionMaxDistance sentinel with a nested
suggestions.{enabled,maxDistance} object and routes all eight guards plus the
three read paths through isFaceSuggestionEnabled. The read-path guards are
load-bearing: disabling now retains a valid band, so the repository
short-circuits no longer imply the feature is off."
```

---

### Task 2: Legacy config fold

**Files:**

- Modify: `server/src/utils/config.ts:75-90`
- Create: `server/src/utils/config.spec.ts`

**Interfaces:**

- Consumes: `machineLearning.facialRecognition.suggestions` from Task 1.
- Produces: `foldLegacyFaceSuggestionConfig(partial: unknown): unknown` — exported for tests only.

- [ ] **Step 1: Write the failing fold tests**

Create `server/src/utils/config.spec.ts`:

```ts
import { foldLegacyFaceSuggestionConfig } from 'src/utils/config';
import { describe, expect, it } from 'vitest';

const legacy = (suggestionMaxDistance: number, maxDistance?: number) => ({
  machineLearning: {
    facialRecognition: {
      ...(maxDistance === undefined ? {} : { maxDistance }),
      suggestionMaxDistance,
    },
  },
});

describe('foldLegacyFaceSuggestionConfig', () => {
  it('enables suggestions when the legacy value exceeds the default recognition distance', () => {
    const result = foldLegacyFaceSuggestionConfig(legacy(0.7)) as any;
    expect(result.machineLearning.facialRecognition.suggestions).toEqual({ enabled: true, maxDistance: 0.7 });
    expect(result.machineLearning.facialRecognition.suggestionMaxDistance).toBeUndefined();
  });

  it('disables suggestions and restores the default band when the legacy value is 0', () => {
    const result = foldLegacyFaceSuggestionConfig(legacy(0)) as any;
    expect(result.machineLearning.facialRecognition.suggestions).toEqual({ enabled: false, maxDistance: 0.7 });
  });

  it('disables suggestions but retains a legacy value below the recognition distance', () => {
    const result = foldLegacyFaceSuggestionConfig(legacy(0.4)) as any;
    expect(result.machineLearning.facialRecognition.suggestions).toEqual({ enabled: false, maxDistance: 0.4 });
  });

  it('restores the default band when the legacy value is below the 0.1 schema minimum', () => {
    const result = foldLegacyFaceSuggestionConfig(legacy(0.05)) as any;
    expect(result.machineLearning.facialRecognition.suggestions).toEqual({ enabled: false, maxDistance: 0.7 });
  });

  it('compares against an overridden recognition distance, not the default', () => {
    const result = foldLegacyFaceSuggestionConfig(legacy(0.7, 0.8)) as any;
    expect(result.machineLearning.facialRecognition.suggestions).toEqual({ enabled: false, maxDistance: 0.7 });
  });

  it('lets an existing suggestions block win and drops the legacy key', () => {
    const partial = {
      machineLearning: {
        facialRecognition: { suggestionMaxDistance: 0.9, suggestions: { enabled: true, maxDistance: 0.6 } },
      },
    };
    const result = foldLegacyFaceSuggestionConfig(partial) as any;
    expect(result.machineLearning.facialRecognition.suggestions).toEqual({ enabled: true, maxDistance: 0.6 });
    expect(result.machineLearning.facialRecognition.suggestionMaxDistance).toBeUndefined();
  });

  it('passes through a partial with no legacy key untouched', () => {
    const partial = { machineLearning: { facialRecognition: { maxDistance: 0.6 } } };
    expect(foldLegacyFaceSuggestionConfig(partial)).toEqual(partial);
  });

  it('tolerates a null or non-object partial', () => {
    expect(foldLegacyFaceSuggestionConfig(null)).toBeNull();
    expect(foldLegacyFaceSuggestionConfig(undefined)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && pnpm test -- --run src/utils/config.spec.ts`
Expected: FAIL — `foldLegacyFaceSuggestionConfig` is not exported from `src/utils/config`.

- [ ] **Step 3: Implement the fold**

In `server/src/utils/config.ts`, add above `buildConfig`:

```ts
const LEGACY_SUGGESTION_PATH = 'machineLearning.facialRecognition.suggestionMaxDistance';
const SUGGESTIONS_PATH = 'machineLearning.facialRecognition.suggestions';

/**
 * Folds the pre-rename `facialRecognition.suggestionMaxDistance` sentinel into the nested
 * `facialRecognition.suggestions` block. Runs against the user-supplied partial (database or config
 * file) before it merges over defaults, so both config sources migrate identically. Without this,
 * the renamed key would land in the unknown-keys warn path and be silently dropped, switching the
 * feature off on every instance already running it.
 */
export const foldLegacyFaceSuggestionConfig = (partial: unknown): unknown => {
  if (!_.isObject(partial) || _.get(partial, LEGACY_SUGGESTION_PATH) === undefined) {
    return partial;
  }

  const folded = _.cloneDeep(partial);
  const legacy = _.get(folded, LEGACY_SUGGESTION_PATH) as number;
  unsetDeep(folded, LEGACY_SUGGESTION_PATH);

  if (_.get(folded, SUGGESTIONS_PATH) === undefined) {
    const maxDistance =
      (_.get(folded, 'machineLearning.facialRecognition.maxDistance') as number | undefined) ??
      defaults.machineLearning.facialRecognition.maxDistance;

    _.set(folded, SUGGESTIONS_PATH, {
      enabled: legacy > maxDistance,
      // The new field's minimum is 0.1, so a legacy 0 (or any sub-minimum value) must fall back to
      // the default rather than fold through into a config that fails its own schema.
      maxDistance: legacy >= 0.1 ? legacy : defaults.machineLearning.facialRecognition.suggestions.maxDistance,
    });
  }

  return folded;
};
```

- [ ] **Step 4: Wire it into `buildConfig`**

In `buildConfig`, replace the partial load and merge (`:79-90`) with:

```ts
// load partial
const rawPartial = configFile
  ? await loadFromFile(repos, configFile)
  : await metadataRepo.get(SystemMetadataKey.SystemConfig);
const partial = foldLegacyFaceSuggestionConfig(rawPartial);

// merge with defaults. Enumerate the user-supplied partial WITHOUT emptyObjectsAsLeaves: an empty
// object in the partial must yield no path so it can't `_.set` over (and wipe) a populated default
// section. Only the defaults enumeration below opts into empty-object leaves.
const rawConfig = _.cloneDeep(defaults);
for (const property of getKeysDeep(partial)) {
  _.set(rawConfig, property, _.get(partial, property));
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd server && pnpm test -- --run src/utils/config.spec.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add server/src/utils/config.ts server/src/utils/config.spec.ts
git commit -m "fix(server): fold the legacy suggestionMaxDistance key into suggestions

Unknown config keys only warn and are then dropped, so the rename would have
silently disabled face suggestions on every already-configured instance. The
fold runs on the partial before it merges over defaults, covering both database
and IMMICH_CONFIG_FILE sources."
```

---

### Task 3: Reject a band that can never produce suggestions

**Files:**

- Modify: `server/src/services/person.service.ts` (new `onConfigValidate` beside `onBootstrap` at `:96`)
- Test: `server/src/services/person.service.spec.ts`

**Interfaces:**

- Consumes: `machineLearning.facialRecognition.suggestions` from Task 1.

- [ ] **Step 1: Write the failing test**

`person.service.spec.ts` does not currently import `SystemConfig` — add `import { SystemConfig } from 'src/config';` alongside the existing imports before adding this block (Task 4 needs it too).

Add to `server/src/services/person.service.spec.ts`:

```ts
describe('onConfigValidate', () => {
  const config = (enabled: boolean, maxDistance: number, suggestionMaxDistance: number) =>
    ({
      machineLearning: {
        facialRecognition: { maxDistance, suggestions: { enabled, maxDistance: suggestionMaxDistance } },
      },
    }) as SystemConfig;

  it('rejects an enabled band at or below the recognition distance', () => {
    expect(() =>
      sut.onConfigValidate({ newConfig: config(true, 0.5, 0.5), oldConfig: config(false, 0.5, 0.7) }),
    ).toThrow(/must be greater than the maximum recognition distance/);
  });

  it('accepts an enabled band above the recognition distance', () => {
    expect(() =>
      sut.onConfigValidate({ newConfig: config(true, 0.5, 0.7), oldConfig: config(false, 0.5, 0.7) }),
    ).not.toThrow();
  });

  it('ignores the band when suggestions are disabled', () => {
    expect(() =>
      sut.onConfigValidate({ newConfig: config(false, 0.5, 0.3), oldConfig: config(false, 0.5, 0.7) }),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && pnpm test -- --run src/services/person.service.spec.ts -t onConfigValidate`
Expected: FAIL — `sut.onConfigValidate is not a function`.

- [ ] **Step 3: Implement the hook**

In `server/src/services/person.service.ts`, add `ArgOf` to the `src/repositories/event.repository` import and insert after `onBootstrap`:

```ts
  @OnEvent({ name: 'ConfigValidate' })
  onConfigValidate({ newConfig }: ArgOf<'ConfigValidate'>) {
    const { maxDistance, suggestions } = newConfig.machineLearning.facialRecognition;
    if (suggestions.enabled && suggestions.maxDistance <= maxDistance) {
      throw new Error(
        `Face suggestion max distance (${suggestions.maxDistance}) must be greater than the maximum recognition distance (${maxDistance}), otherwise no faces can ever be suggested.`,
      );
    }
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd server && pnpm test -- --run src/services/person.service.spec.ts -t onConfigValidate`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/person.service.ts server/src/services/person.service.spec.ts
git commit -m "feat(server): reject a face-suggestion band that can never match

An enabled band at or below the recognition distance selects nothing. Refusing
the save replaces the old failure mode where the setting saved cleanly and did
nothing."
```

---

### Task 4: Queue the scan when the feature is switched on

**Files:**

- Modify: `server/src/services/person.service.ts` (new `onConfigUpdate` beside `onConfigValidate`)
- Test: `server/src/services/person.service.spec.ts`

**Interfaces:**

- Consumes: `isFaceSuggestionEnabled` from Task 1.

- [ ] **Step 1: Write the failing test**

Add to `server/src/services/person.service.spec.ts`:

```ts
describe('onConfigUpdate', () => {
  const config = (enabled: boolean) =>
    ({
      machineLearning: {
        enabled: true,
        facialRecognition: { enabled: true, maxDistance: 0.5, suggestions: { enabled, maxDistance: 0.7 } },
      },
    }) as SystemConfig;

  it('queues the maintenance scan on the false to true transition', async () => {
    await sut.onConfigUpdate({ newConfig: config(true), oldConfig: config(false) });

    expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.FaceSuggestionMaintenance, data: {} });
  });

  it('does not queue when it was already enabled', async () => {
    await sut.onConfigUpdate({ newConfig: config(true), oldConfig: config(true) });

    expect(mocks.job.queue).not.toHaveBeenCalled();
  });

  it('does not queue when the feature is switched off', async () => {
    await sut.onConfigUpdate({ newConfig: config(false), oldConfig: config(true) });

    expect(mocks.job.queue).not.toHaveBeenCalled();
  });

  it('does not queue when suggestions are untouched', async () => {
    await sut.onConfigUpdate({ newConfig: config(false), oldConfig: config(false) });

    expect(mocks.job.queue).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && pnpm test -- --run src/services/person.service.spec.ts -t onConfigUpdate`
Expected: FAIL — `sut.onConfigUpdate is not a function`.

- [ ] **Step 3: Implement the hook**

In `server/src/services/person.service.ts`, after `onConfigValidate`:

```ts
  @OnEvent({ name: 'ConfigUpdate', workers: [ImmichWorker.Microservices], server: true })
  async onConfigUpdate({ oldConfig, newConfig }: ArgOf<'ConfigUpdate'>) {
    // Transition-only: re-saving settings must not re-queue a library-wide sweep. Widening the band
    // while already enabled is picked up by running the maintenance job manually.
    if (!isFaceSuggestionEnabled(oldConfig.machineLearning) && isFaceSuggestionEnabled(newConfig.machineLearning)) {
      await this.jobRepository.queue({ name: JobName.FaceSuggestionMaintenance, data: {} });
    }
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd server && pnpm test -- --run src/services/person.service.spec.ts -t onConfigUpdate`
Expected: PASS, 4 tests.

- [ ] **Step 5: Run the whole server gate**

Run: `cd server && pnpm test -- --run && pnpm check && pnpm lint && pnpm format`
Expected: all green. `pnpm format` is a separate gate from `pnpm lint` — both must pass.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/person.service.ts server/src/services/person.service.spec.ts
git commit -m "feat(server): queue the face-suggestion scan when the feature is enabled

Enabling the toggle now starts the first scan itself instead of silently
requiring a second trip to the Jobs page."
```

---

### Task 5: Regenerate the API clients

Web (Task 6) and e2e (Task 8) both consume the config type from the SDK, so the regen has to land before them.

**Files:**

- Modify: `open-api/immich-openapi-specs.json`
- Modify: `packages/sdk/src/fetch-client.ts` (the live SDK; `open-api/typescript-sdk/build/*` is a dead pre-move copy — do not hand-edit either)
- Modify: `mobile/openapi/lib/model/facial_recognition_config.dart`, `mobile/openapi/doc/FacialRecognitionConfig.md`, `mobile/openapi/test/facial_recognition_config_test.dart`, plus the new `FaceSuggestionConfig` files the generator adds

- [ ] **Step 1: Build the server and sync the spec**

Run: `cd server && pnpm build && pnpm sync:open-api`
Expected: `open-api/immich-openapi-specs.json` gains a `FaceSuggestionConfig` schema; `FacialRecognitionConfig` loses `suggestionMaxDistance` and gains `suggestions`.

- [ ] **Step 2: Regenerate both clients**

Run: `make open-api`
Expected: TypeScript SDK and Dart client regenerate. Java is required for the Dart generator.

- [ ] **Step 3: Verify no stale references remain in generated output**

Run: `grep -rn "suggestionMaxDistance" open-api packages/sdk mobile/openapi | grep -v "open-api/typescript-sdk/build"`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add open-api packages/sdk mobile/openapi
git commit -m "chore(open-api): regenerate clients for the nested suggestions config"
```

---

### Task 6: Admin toggle and auto-filled distance

**Files:**

- Modify: `web/src/routes/admin/system-settings/MachineLearningSettings.svelte:253-266`
- Modify: `i18n/en.json` (`admin.machine_learning_suggestion_max_distance_description` at `:470`, plus two new keys)

**Interfaces:**

- Consumes: the regenerated SDK config type from Task 5.

- [ ] **Step 1: Add the English strings**

In `i18n/en.json`, insert in `admin` (keys stay alphabetically sorted):

```json
    "machine_learning_face_suggestions_setting": "Enable face suggestions",
    "machine_learning_face_suggestions_setting_description": "Surface likely matches on a named person's page for one-tap review. Enabling this starts a scan of your library.",
```

and replace `machine_learning_suggestion_max_distance_description` with:

```json
    "machine_learning_suggestion_max_distance_description": "Maximum embedding distance for a face to be surfaced as a suggestion on a named person's page. Must be greater than the Maximum recognition distance.",
```

- [ ] **Step 2: Add the toggle and gate the number field**

In `MachineLearningSettings.svelte`, replace the `suggestionMaxDistance` `SettingInputField` block (`:253-266`) with:

```svelte
          <SettingSwitch
            title={$t('admin.machine_learning_face_suggestions_setting')}
            subtitle={$t('admin.machine_learning_face_suggestions_setting_description')}
            checked={configToEdit.machineLearning.facialRecognition.suggestions.enabled}
            onToggle={(enabled) => {
              configToEdit.machineLearning.facialRecognition.suggestions.enabled = enabled;
              if (enabled) {
                const { maxDistance, suggestions } = configToEdit.machineLearning.facialRecognition;
                if (suggestions.maxDistance <= maxDistance) {
                  suggestions.maxDistance = Math.min(Math.round((maxDistance + 0.2) * 100) / 100, 2);
                }
              }
            }}
            disabled={disabled ||
              !configToEdit.machineLearning.enabled ||
              !configToEdit.machineLearning.facialRecognition.enabled}
          />

          <SettingInputField
            inputType={SettingInputFieldType.NUMBER}
            label={$t('admin.machine_learning_suggestion_max_distance')}
            description={$t('admin.machine_learning_suggestion_max_distance_description')}
            bind:value={configToEdit.machineLearning.facialRecognition.suggestions.maxDistance}
            step="0.01"
            min={0.1}
            max={2}
            disabled={disabled ||
              !configToEdit.machineLearning.enabled ||
              !configToEdit.machineLearning.facialRecognition.enabled ||
              !configToEdit.machineLearning.facialRecognition.suggestions.enabled}
            isEdited={configToEdit.machineLearning.facialRecognition.suggestions.maxDistance !==
              config.machineLearning.facialRecognition.suggestions.maxDistance}
          />
```

If the local `SettingSwitch` exposes `bind:checked` rather than an `onToggle` callback, keep `bind:checked` and move the auto-fill into a `$effect` that watches `suggestions.enabled` — match whichever API the sibling switch on `:196-201` uses.

- [ ] **Step 3: Run the web gate**

Run: `cd web && pnpm check:typescript && pnpm check:svelte && pnpm lint`
Expected: all green. Tailwind **warnings** are tolerated by CI; errors are not. If `check:svelte` reports "0 files", that is a known local anomaly — the gate still runs in CI.

- [ ] **Step 4: Commit**

```bash
git add web/src/routes/admin/system-settings/MachineLearningSettings.svelte i18n/en.json
git commit -m "feat(web): explicit face-suggestions toggle in admin settings

Enabling auto-fills the distance from the recognition distance so the number
field stops being the hidden on/off switch."
```

---

### Task 7: Translate the two new strings

**Files:**

- Modify: `i18n/de.json`, `fr.json`, `es.json`, `it.json`, `nl.json`, `pl.json`, `ru.json`, `zh_Hans.json`, `zh_Hant.json`

- [ ] **Step 1: Add both keys to all nine locales**

Each locale's `admin` block gets the two new keys, and `machine_learning_suggestion_max_distance_description` is replaced. Wording below follows the terminology already in each file (the toggle title mirrors that locale's existing `machine_learning_facial_recognition_setting`, which is an "Enable …" imperative in every locale). Keep keys alphabetically sorted.

**`machine_learning_face_suggestions_setting`:**

| Locale    | Value                                |
| --------- | ------------------------------------ |
| `de`      | `Gesichtsvorschläge aktivieren`      |
| `fr`      | `Activer les suggestions de visages` |
| `es`      | `Habilitar sugerencias de rostros`   |
| `it`      | `Attiva suggerimenti volti`          |
| `nl`      | `Gezichtssuggesties inschakelen`     |
| `pl`      | `Włącz sugestie twarzy`              |
| `ru`      | `Включить подсказки лиц`             |
| `zh_Hans` | `启用人脸建议`                       |
| `zh_Hant` | `啟用人臉建議`                       |

**`machine_learning_face_suggestions_setting_description`:**

| Locale    | Value                                                                                                                                                                |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `de`      | `Zeigt wahrscheinliche Übereinstimmungen auf der Seite einer benannten Person zur schnellen Überprüfung. Beim Aktivieren wird ein Scan deiner Bibliothek gestartet.` |
| `fr`      | `Affiche les correspondances probables sur la page d'une personne nommée pour une révision rapide. L'activation lance une analyse de votre bibliothèque.`            |
| `es`      | `Muestra coincidencias probables en la página de una persona con nombre para revisarlas rápidamente. Al activarlo se inicia un análisis de tu biblioteca.`           |
| `it`      | `Mostra le corrispondenze probabili nella pagina di una persona con nome per una revisione rapida. L'attivazione avvia una scansione della libreria.`                |
| `nl`      | `Toont waarschijnlijke overeenkomsten op de pagina van een persoon met naam voor snelle beoordeling. Bij inschakelen wordt een scan van je bibliotheek gestart.`     |
| `pl`      | `Pokazuje prawdopodobne dopasowania na stronie nazwanej osoby do szybkiej weryfikacji. Włączenie rozpoczyna skanowanie biblioteki.`                                  |
| `ru`      | `Показывает вероятные совпадения на странице названного человека для быстрой проверки. При включении запускается сканирование библиотеки.`                           |
| `zh_Hans` | `在已命名人物的页面上显示可能的匹配，便于快速审核。启用后将开始扫描图库。`                                                                                           |
| `zh_Hant` | `在已命名人物的頁面上顯示可能的相符結果，便於快速審核。啟用後將開始掃描圖庫。`                                                                                       |

**`machine_learning_suggestion_max_distance_description`** (replaces the existing value, dropping the "Set to 0 to disable" clause):

| Locale    | Value                                                                                                                                                                         |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `de`      | `Maximale Embedding-Distanz, bis zu der ein Gesicht als Vorschlag auf der Seite einer benannten Person erscheint. Muss größer als die maximale Erkennungsdistanz sein.`       |
| `fr`      | `Distance d'embedding maximale pour qu'un visage soit proposé sur la page d'une personne nommée. Doit être supérieure à la distance de reconnaissance maximale.`              |
| `es`      | `Distancia máxima de embedding para que un rostro aparezca como sugerencia en la página de una persona con nombre. Debe ser mayor que la distancia máxima de reconocimiento.` |
| `it`      | `Distanza massima di embedding entro cui un volto viene proposto nella pagina di una persona con nome. Deve essere maggiore della distanza massima di riconoscimento.`        |
| `nl`      | `Maximale embedding-afstand waarbij een gezicht als suggestie verschijnt op de pagina van een persoon met naam. Moet groter zijn dan de maximale herkenningsafstand.`         |
| `pl`      | `Maksymalna odległość osadzenia, przy której twarz pojawi się jako sugestia na stronie nazwanej osoby. Musi być większa niż maksymalna odległość rozpoznawania.`              |
| `ru`      | `Максимальное расстояние эмбеддинга, при котором лицо появляется как подсказка на странице названного человека. Должно быть больше максимального расстояния распознавания.`   |
| `zh_Hans` | `人脸在已命名人物页面上显示为建议的最大嵌入距离。必须大于最大识别距离。`                                                                                                      |
| `zh_Hant` | `人臉在已命名人物頁面上顯示為建議的最大嵌入距離。必須大於最大辨識距離。`                                                                                                      |

None of these three strings contains an ICU placeholder or plural form, so there is no placeholder-parity risk. Do check for cross-script contamination before committing — a Cyrillic word leaking into a Chinese string has happened on this branch before.

- [ ] **Step 2: Verify placeholder parity and formatting**

Run: `npx prettier --check i18n && node -e "for (const f of ['de','fr','es','it','nl','pl','ru','zh_Hans','zh_Hant']) { const j = require('./i18n/' + f + '.json'); for (const k of ['machine_learning_face_suggestions_setting','machine_learning_face_suggestions_setting_description','machine_learning_suggestion_max_distance_description']) { if (!j.admin?.[k]) { throw new Error(f + ' missing ' + k); } } } console.log('all nine locales complete')"`
Expected: `All matched files use Prettier code style!` then `all nine locales complete`.

- [ ] **Step 3: Commit**

```bash
git add i18n
git commit -m "feat(i18n): translate the face-suggestions toggle into all nine locales"
```

---

### Task 8: Update the e2e suites

**Files:**

- Modify: `e2e/src/specs/server/api/person-face-suggestions.e2e-spec.ts:12-14,78-81`
- Modify: `e2e/src/specs/web/person-face-suggestions.e2e-spec.ts`
- Modify: `e2e/src/specs/web/space-person-face-suggestions.e2e-spec.ts`

**Interfaces:**

- Consumes: the regenerated SDK from Task 5.

- [ ] **Step 1: Switch every enablement site to the nested shape**

Replace each `config.machineLearning.facialRecognition.suggestionMaxDistance = 0.8;` with:

```ts
config.machineLearning.facialRecognition.suggestions = { enabled: true, maxDistance: 0.8 };
```

and update the header comment in the API spec (`:12-14`) to describe the toggle rather than the sentinel.

- [ ] **Step 2: Add a coverage case for the decoupled state**

In `e2e/src/specs/server/api/person-face-suggestions.e2e-spec.ts`, add a test that sets `suggestions = { enabled: false, maxDistance: 0.8 }` — disabled while the band stays valid — and asserts the endpoint returns `{ total: 0, items: [] }`. This is the exact state the repository short-circuits cannot catch, and it is the regression Task 1's read-path guards prevent.

- [ ] **Step 3: Run the API suite**

Run: `make e2e-api-dev` against a running stack, or `cd e2e && pnpm test` against the e2e stack on :2285.
Expected: PASS. Note the e2e stack (`immich-e2e` project, `:2285`) is machine-wide and shared across sessions; `make dev` on `:2283` is a different stack and serves empty bodies to Playwright.

- [ ] **Step 4: Commit**

```bash
git add e2e/src
git commit -m "test(e2e): drive face suggestions through the explicit toggle

Adds the enabled-false-with-valid-band case, which the repository band
short-circuits cannot catch."
```

---

### Task 9: Update the user documentation

**Files:**

- Modify: `docs/docs/features/facial-recognition.md` (suggestions section, ~`:71-79`)

- [ ] **Step 1: Rewrite the enablement instructions**

The existing "Face Suggestions" section (`:68-79`) documents the review flow but never says how to turn the feature on. Insert this immediately after the section heading, before the "When a named person has near-miss faces" paragraph:

```markdown
Face suggestions are **off by default**. To enable them, go to Administration → Settings →
Machine Learning → Facial Recognition and turn on **Enable face suggestions**.

Enabling the toggle fills in a suggestion distance for you and queues a scan of your library,
so there is nothing else to run. You can watch it progress in Administration → Jobs. To re-scan
later — for example after widening the suggestion distance — run the **Face suggestion
maintenance** job.

A person is only scanned if it has a name, is not hidden, and is a person rather than a pet.
People in a shared space are scanned only when that space has face recognition enabled.

:::note
The **Suggestion max distance** must be greater than the **Maximum recognition distance**;
a smaller value can never match anything, so the settings page refuses to save it. Face
suggestions also require facial recognition itself to stay enabled.
:::
```

Then check the rest of the page for any older instruction to set a distance value in order to enable the feature, or to run the maintenance job as a required first step, and remove it.

- [ ] **Step 2: Verify formatting**

Run: `npx prettier --check docs/docs/features/facial-recognition.md`
Expected: `All matched files use Prettier code style!`

- [ ] **Step 3: Commit**

```bash
git add docs/docs/features/facial-recognition.md
git commit -m "docs(facial-recognition): document the face-suggestions toggle"
```

---

## Final verification

- [ ] `cd server && pnpm test -- --run && pnpm check && pnpm lint && pnpm format`
- [ ] `cd server && pnpm test:medium -- --run` (requires Docker for testcontainers)
- [ ] `cd web && pnpm check:typescript && pnpm check:svelte && pnpm lint && pnpm test -- --run`
- [ ] `npx prettier --check i18n docs`
- [ ] `grep -rn "suggestionMaxDistance" server/src web/src e2e/src i18n docs` returns only the repository opts field in `face-person-verdict.repository.ts` and its medium specs, plus the fold's legacy-path constant in `utils/config.ts`
- [ ] Manual RC check: a fresh install shows the toggle off; enabling it auto-fills `0.7`, saves, and queues a visible scan in the Jobs dashboard with no further action
- [ ] Manual RC check: an instance whose stored config had `suggestionMaxDistance: 0.7` still reports suggestions enabled after boot, and its pending suggestions still render
- [ ] PR description calls out the two behaviour changes: suggestions now require facial recognition to be enabled, and disabling the toggle now genuinely hides pending suggestions
