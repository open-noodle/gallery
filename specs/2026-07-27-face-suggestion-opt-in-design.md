# Face suggestions: explicit opt-in

Date: 2026-07-27
Branch: `feat/face-review-unified` (PR #834)

## Problem

Face suggestions are enabled by a sentinel value rather than a switch. `machineLearning.facialRecognition.suggestionMaxDistance` defaults to `0`, and the feature is considered on only when that number exceeds `maxDistance` (default `0.5`). An admin who wants suggestions must:

1. know the setting exists,
2. know that `0` means disabled,
3. know the value must exceed a _different_ setting to have any effect, and
4. separately run the **Face suggestion maintenance** job, because saving the config scans nothing.

Every one of those steps fails silently. Setting `0.4` saves cleanly and does nothing. Setting `0.7` saves cleanly and still does nothing until the job runs. This was reported as "the feature seems to be missing" by a tester on a live RC.

The sentinel is also re-derived at every consumer instead of being expressed once: eight service-level guards plus three repository short-circuits each independently compute `suggestionMaxDistance <= maxDistance`.

## Goals

- Enabling the feature is a single, discoverable toggle.
- Enabling it makes it work, with no second trip to the Jobs page.
- A configuration that cannot possibly produce suggestions is rejected at save time, not accepted and ignored.
- "Is this feature on?" has exactly one answer in the codebase.
- Instances already running the feature keep running it across the upgrade, whether configured via the database or a config file.

## Non-goals

- Changing how suggestions are computed, ranked, or presented.
- Changing the verdict layer, the review UI, or the manual review mode.
- Mobile support. Face suggestions remain web-only; only generated Dart DTOs change.

## Design

### 1. Config shape

`machineLearning.facialRecognition` gains a nested `suggestions` object and loses `suggestionMaxDistance`:

```ts
facialRecognition: {
  enabled: true,
  modelName: 'buffalo_l',
  minScore: 0.7,
  maxDistance: 0.5,
  minFaces: 3,
  suggestions: {
    enabled: false,
    maxDistance: 0.7,
  },
}
```

`0.7` is a static default — the shipped `maxDistance` (`0.5`) plus `0.2`. The config default deliberately does **not** track `maxDistance` at runtime; a default that reads another field would make the effective value depend on evaluation order and would silently move when an admin tunes recognition. The `maxDistance + 0.2` derivation happens exactly once, in the admin UI, at the moment the toggle is switched on (§6).

`suggestions` is a non-empty object, so it is unaffected by the empty-object `getKeysDeep` defect that produced false "Unknown keys" warnings in #783.

**Files:** `server/src/config.ts` (interface ~line 102, defaults ~line 350).

### 2. One helper replaces the eight service-level guards

Add to `server/src/utils/misc.ts`, alongside the five existing `is*Enabled` helpers:

```ts
export const isFaceSuggestionEnabled = (machineLearning: SystemConfig['machineLearning']) =>
  isFacialRecognitionEnabled(machineLearning) &&
  machineLearning.facialRecognition.suggestions.enabled &&
  machineLearning.facialRecognition.suggestions.maxDistance > machineLearning.facialRecognition.maxDistance;
```

The distance comparison stays inside the helper as a correctness backstop: a band where the upper bound is at or below the lower bound selects nothing, so treating it as enabled would mean scans that always return empty. §3 makes that state unreachable through the API, but config can also arrive from a file.

The eight service-level sites collapse to `!isFaceSuggestionEnabled(machineLearning)`. The three repository short-circuits are listed for completeness but stay as they are — they read a band from their opts, not config, and remain valid defence in depth:

| File                                             | Site                                                                                                                                                                                                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/person.service.ts`                     | `:690` rename-triggered rescan, `:854` backfill-complete queue-all, `:871` `handlePersonSuggestionScan`, `:928` `handlePersonSuggestionScanQueueAll`, `:948` `handleSpacePersonSuggestionScan`, `:1028` `handleSpacePersonSuggestionScanQueueAll` |
| `services/shared-space.service.ts`               | `:3229` `areSpacePersonSuggestionsEnabled` becomes a thin wrapper over the helper                                                                                                                                                                 |
| `services/job.service.ts`                        | `:101` `handleFaceSuggestionMaintenance`                                                                                                                                                                                                          |
| `repositories/face-person-verdict.repository.ts` | `:332`, `:434`, `:551` short-circuits stay as defence in depth, reading the band from their opts                                                                                                                                                  |

**The three read paths need their own guard — this is load-bearing.** Today "disabled" _is_ an inverted band, so the repository short-circuits make every read path return empty for free. After this change the two states decouple: toggling off retains the distance value (§6), so `enabled: false` coexists with a valid band, the short-circuits stop firing, and the read paths would keep serving pending suggestions to a UI that believes the feature is off. Each read path therefore gains an explicit `isFaceSuggestionEnabled` check that returns the empty result **before** calling the repository:

| Read path                                                        | Empty result              |
| ---------------------------------------------------------------- | ------------------------- |
| `person.service.ts:372` `getFaceSuggestions`                     | `{ total: 0, items: [] }` |
| `shared-space.service.ts:1280` space suggestion page             | `{ total: 0, items: [] }` |
| `shared-space.service.ts:1312` `hasPendingForSpacePerson` caller | `false`                   |

The repository short-circuits are not a substitute: they only know the band, and the band no longer encodes enablement.

**Approved behaviour change.** The current guards check only the distance band. They never consult `machineLearning.enabled` or `facialRecognition.enabled`, so suggestions keep running when facial recognition is switched off — suggestions are a pure vector query over embeddings that already exist and never call the ML service. Routing through `isFacialRecognitionEnabled` means an admin who scanned their library and later disabled facial recognition also loses suggestions. This is intended: it is a facial-recognition feature, it lives under that accordion, and the admin UI already disables its fields when facial recognition is off. Call it out in the PR description — it is the one change here that alters behaviour for an existing working configuration.

### 3. Validation rejects impossible configurations

Add `onConfigValidate` to `person.service.ts`, following the `smart-info.service.ts` precedent that rejects unknown CLIP models:

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

This is the change that eliminates the original failure mode. A band that cannot produce results is no longer a saveable state.

### 4. Enabling the feature starts the work

Add a `ConfigUpdate` hook to `person.service.ts`, which owns the suggestion jobs:

```ts
@OnEvent({ name: 'ConfigUpdate', workers: [ImmichWorker.Microservices], server: true })
async onConfigUpdate({ oldConfig, newConfig }: ArgOf<'ConfigUpdate'>) {
  if (!isFaceSuggestionEnabled(oldConfig.machineLearning) && isFaceSuggestionEnabled(newConfig.machineLearning)) {
    await this.jobRepository.queue({ name: JobName.FaceSuggestionMaintenance, data: {} });
  }
}
```

Fires only on the false → true transition, so re-saving the settings page does not re-queue a library-wide sweep. Widening `suggestions.maxDistance` while already enabled does **not** trigger a rescan — a rescan on every keystroke-sized edit was explicitly rejected. The manual **Face suggestion maintenance** job remains for re-runs and for picking up a widened band.

`FaceSuggestionMaintenance` already fans out to `PersonSuggestionScanQueueAll` and `SpacePersonSuggestionScanQueueAll` (`job.service.ts:97`), so no new job type is needed.

### 5. Back-compat: a load-time fold, not a database migration

Unknown config keys only `logger.warn` (`server/src/utils/config.ts:99`) — they do not fail boot, they are **silently dropped**. Renaming the key without a back-compat path would therefore quietly switch the feature off on every instance already running it, with no error anyone would notice.

In `server/src/utils/config.ts`, before the stored partial merges over defaults, fold the legacy key:

- If `machineLearning.facialRecognition.suggestionMaxDistance` is present **and** no `suggestions` block exists:
  - `suggestions.enabled = legacy > effectiveMaxDistance`, where `effectiveMaxDistance` is the stored `facialRecognition.maxDistance` override if present, otherwise the default `0.5`
  - `suggestions.maxDistance = legacy >= 0.1 ? legacy : 0.7` — the threshold is `0.1`, not `0`, because the new field's minimum is `0.1` (§8). Folding a legacy `0.05` through unchanged would produce a config that fails its own schema on the next save.
- Delete the legacy key from the raw object so the unknown-keys warning stays quiet.
- If a `suggestions` block already exists, the legacy key is ignored and deleted — the new shape always wins.

**Why not a `migrations-gallery/` migration.** Config can also come from a file via `IMMICH_CONFIG_FILE`. A database migration cannot reach those instances, so it would fix the DB-configured case and silently disable the feature for the file-configured case. The fold covers both sources uniformly. Stored database config rewrites itself into the new shape the first time an admin saves settings; file-based config keeps folding on every load until the operator edits the file. Removal point is a future major version.

### 6. Admin UI

`web/src/routes/admin/system-settings/MachineLearningSettings.svelte`, facial-recognition accordion:

- A `SettingSwitch` titled "Face suggestions" sits directly above the distance field, gated on `disabled || !machineLearning.enabled || !facialRecognition.enabled` like its siblings.
- The existing `SettingInputField` binds to `facialRecognition.suggestions.maxDistance` and additionally gates on `!facialRecognition.suggestions.enabled`, so it greys out when the feature is off while retaining its value.
- Switching the toggle **on** auto-fills the distance with `Math.min(maxDistance + 0.2, 2)` when the current value is at or below `maxDistance` (covering both the `0` default and any stale sub-threshold value). A value already above `maxDistance` is left alone.
- `min` on the field rises from `0` to `0.1`, matching `maxDistance` — `0` is no longer meaningful.

### 7. Strings and docs

- New: `admin.machine_learning_face_suggestions_setting` and `..._setting_description`.
- Reworded: `admin.machine_learning_suggestion_max_distance_description` drops "Set to 0 to disable face suggestions" and keeps the must-exceed-recognition-distance constraint.
- Both land in `en.json` plus the nine translated locales (`de`, `fr`, `es`, `it`, `nl`, `pl`, `ru`, `zh_Hans`, `zh_Hant`), reusing each file's established terminology. `prettier --check i18n` gates this in CI.
- `docs/docs/features/facial-recognition.md` — the enablement instructions become wrong and must describe the toggle plus the automatic first scan.

### 8. Generated artefacts

`FacialRecognitionConfigSchema` in `server/src/dtos/model-config.dto.ts` gains a nested `FaceSuggestionConfigSchema` (`enabled: boolean`, `maxDistance: number` with `.min(0.1).max(2)`) and drops `suggestionMaxDistance`. Then, per the OpenAPI workflow: `pnpm build` → `pnpm sync:open-api` → `make open-api`, refreshing `open-api/immich-openapi-specs.json`, the TypeScript SDK, and `mobile/openapi/**` (three Dart files).

The repository opts object keeps its current field names (`{ maxDistance, suggestionMaxDistance }`). It describes a distance band, not config keys, and renaming it would churn four medium-test files for no behavioural gain. Callers pass `suggestionMaxDistance: facialRecognition.suggestions.maxDistance`.

## Testing

New coverage:

- `isFaceSuggestionEnabled` truth table: ML off, facial recognition off, `suggestions.enabled` false, band inverted, band valid.
- Legacy fold: legacy above threshold → enabled; legacy `0` → disabled with default `0.7`; legacy below `maxDistance` → disabled retaining the legacy value; legacy alongside an existing `suggestions` block → block wins, legacy dropped; legacy with a non-default stored `maxDistance` → threshold uses the override.
- `onConfigValidate` rejects `enabled` with an inverted band, and accepts it with a valid one.
- `onConfigUpdate` queues on false → true only: no queue on true → true, true → false, or an unrelated config change.
- Each of the three read paths returns its empty result, without touching the repository, when `suggestions.enabled` is false **while the band is still valid** — the state that the repository short-circuits cannot catch.

Updated for the nested shape: `person.service.spec.ts`, `job.service.spec.ts`, `shared-space.service.spec.ts`, `system-config.service.spec.ts`, `model-config.dto.spec.ts`, `machine-learning.repository.spec.ts`; medium specs `face-person-verdict.repository.spec.ts`, `face-review-cross-flow.spec.ts`, `face-suggestion-exclusions.spec.ts`, `shared-space-face-suggestions.service.spec.ts`; e2e `person-face-suggestions` (api + web) and `space-person-face-suggestions`.

Manual verification on an RC: fresh install shows the toggle off; enabling it auto-fills `0.7`, saves, and queues a scan visible in the Jobs dashboard without further action; an upgraded instance that had `suggestionMaxDistance: 0.7` still reports the feature enabled after boot and its suggestions still render.

## Risks

| Risk                                                                 | Mitigation                                                                                                                        |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Fold misfires and disables the feature on upgrade                    | Unit-tested against the five cases above; manual RC check against a real upgraded instance before merge                           |
| Auto-scan surprises an admin with library-wide work on settings save | Transition-only; `FaceSuggestionMaintenance` runs on the `PeopleBackfill` queue and is visible and pausable in the Jobs dashboard |
| Gating on facial recognition removes suggestions for someone         | Intended and approved; called out in the PR description and release notes                                                         |
| Toggling off leaves suggestions visible because the band stays valid | The three read-path guards in §2, each with a test for the enabled-false-band-valid state                                         |
