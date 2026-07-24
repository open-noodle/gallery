# Slice 7 — Web: admin settings, queue wiring, pet badge

- **Spec:** [`../specs/2026-07-25-pet-recognition-phase2-implementation-slices.md`](../specs/2026-07-25-pet-recognition-phase2-implementation-slices.md) § Slice 7
- **Depends on:** Slice 3 (config DTO + regenerated SDK)
- **Scope:** `web/` and `i18n/en.json`.

## Objective

Admins can enable and tune pet recognition; a pet in a photo reads as a pet in the asset viewer.

## Why TypeScript is the main gate here

Three maps are `Record<QueueName, …>` and therefore **exhaustive by type** — omitting the new queue
is a compile error, not a silent gap:

- `web/src/lib/services/queue.service.ts` → `asQueueItem()`'s `items` record
- `web/src/routes/admin/queues/QueuePanel.svelte` → `queueDetails`
- `web/src/routes/admin/system-settings/JobSettings.svelte` → `queueTitles`

Plus one array that is **not** type-enforced and is easy to miss:
`web/src/lib/constants.ts` → `ADMIN_VISIBLE_QUEUES` (omit it and the queue simply never renders).

## Work

1. **`MachineLearningSettings.svelte`** — a `petRecognition` `SettingAccordion` inserted directly
   after the `petDetection` one (which ends at `:388`, immediately before `<SettingButtonsRow>`).
   Copy the `petDetection` block's structure verbatim and add the two numeric fields from the
   `facialRecognition` block:
   - `SettingSwitch` → `configToEdit.machineLearning.petRecognition.enabled`
   - `SettingSelect` `pet-recognition-model` → options `pet-recognition-small` (fast),
     `pet-recognition-base` (balanced, recommended), `pet-recognition-large` (slow, most accurate)
   - `SettingInputField` NUMBER → `maxDistance`, step `0.01`, min `0.1`, max `2`
   - `SettingInputField` NUMBER → `minFaces`, step `1`, min `1`
   - every control `disabled` unless both `machineLearning.enabled` and `petRecognition.enabled`
     (the switch itself only needs `machineLearning.enabled`), each with `isEdited` comparing to
     `config.machineLearning.petRecognition.*`
2. **Queue wiring** — add `QueueName.PetRecognition` to `ADMIN_VISIBLE_QUEUES`, to the three records
   above (icon: reuse the paw `mdiPaw` used by pet detection if that is what it uses; check), and a
   `getQueueJobTypeLabel` case. Add a force-confirmation prompt in `QueuePanel.svelte`'s
   `handleCommand` mirroring `QueueName.PetDetection`'s, because forcing pet recognition **deletes
   all pet people and re-detects** — the user must be warned.
3. **`DetailPanelPeople.svelte`** — render the paw badge + species title for `person.type === 'pet'`,
   reusing the treatment in `person-tile.svelte:68-75` (`mdiPaw`, `title={person.species ?? undefined}`).
   `PersonResponseDto` already carries `type` and `species`, so no API change is needed.
4. **`i18n/en.json`** — new keys only in this file (other locales are translated externally):
   `machine_learning_pet_recognition`, `machine_learning_pet_recognition_description`,
   `machine_learning_pet_recognition_setting`, `machine_learning_pet_recognition_setting_description`,
   `machine_learning_pet_recognition_model`, `machine_learning_pet_recognition_model_description`,
   `machine_learning_pet_recognition_max_distance`, `..._max_distance_description`,
   `machine_learning_pet_recognition_min_faces`, `..._min_faces_description`,
   `pet_recognition_job_description`, `confirm_reprocess_all_pet_recognition`.
   Keys go in the correct alphabetical position — the file is sorted and prettier enforces it.

## TDD steps

### Step 1 — RED

`web/src/lib/components/asset-viewer/DetailPanelPeople.spec.ts` (new), following
`web/src/lib/components/people/person-tile.spec.ts` (and its `.test-wrapper.svelte` pattern if the
component needs context/snippet props):

- 7.1 a person with `type: 'pet'`, `species: 'dog'` renders the paw badge, titled `dog`
- 7.2 a person with `type: 'person'` renders no paw badge

Run: `cd web && pnpm test -- --run src/lib/components/asset-viewer/DetailPanelPeople.spec.ts`
Expected red: badge not found.

### Step 2 — GREEN

Implement 1–4 above.

### Step 3 — verify

```bash
cd web
pnpm test -- --run src/lib/components/asset-viewer/DetailPanelPeople.spec.ts
pnpm test -- --run src/lib/components/people/person-tile.spec.ts   # regression
pnpm test -- --run                                                  # full web suite
pnpm check:typescript                                               # the exhaustive-record gate
pnpm check:svelte
```

**Do not trust a `check:svelte` run that reports 0 files** — that has been observed in this repo and
means the check did not actually run; investigate rather than treating it as a pass.

## Edge cases

- A person with `type: undefined` (older payloads) must render as a human, not a pet.
- `species: null` must not render a `title="null"` — pass `undefined`.
- The model `SettingSelect` must not offer the old `pet-reid-*` names; the published repos are
  `pet-recognition-{small,base,large}`.

## Commit

`feat(pet-recognition): admin settings and pet badge in the asset viewer`
