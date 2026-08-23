# Porting the Fork's Config Surface onto Upstream's Config Endpoints (#30881)

**Status**: design agreed 2026-08-20, reviewed against the codebase 2026-08-20, not yet implemented
**Trigger**: upstream `e529557160d` "feat: new config endpoints (#30881)", quarantined during the
batch 128–129 rolling cycle (see `docs/upstream-reports/2026-08-20-upstream-sync-batches-128-129.md`)

## Problem

Upstream #30881 deletes the three files the fork's config surface lives in:

| Deleted file                           | Fork lines added | Fork content                                                                                                                                                                                                   |
| -------------------------------------- | ---------------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/src/config.ts`                 |              +70 | `clip.maxDistance`, `facialRecognition.suggestions`, `petDetection`, `memories`, `server.mergePeopleAcrossOwners`, `classification`, `storageUsage`, 3 fork queue concurrencies, OpenFreeMap map-tile defaults |
| `server/src/dtos/system-config.dto.ts` |              +62 | Classification / Memories / StorageUsage zod schemas                                                                                                                                                           |
| `server/src/dtos/model-config.dto.ts`  |              +31 | `PetDetectionConfigSchema`, CLIP threshold, face-suggestion config                                                                                                                                             |

They are replaced by a single zod-driven `server/src/dtos/config.dto.ts` in which `SystemConfig` is a
**derived** type (`z.infer` of the schema) rather than a hand-written interface. Fork fields therefore
can no longer be "added to a type" — they must exist as zod fragments composed into the schema.

Fork code that breaks outright:

- `server/src/dtos/model-config.dto.spec.ts` — fork-only; its entire subject disappears.
- `server/src/services/classification.service.ts` — fork-only; imports `ClassificationFaceExclusion`
  and `SystemConfig` from `src/config`.
- `server/src/utils/config.ts` — **upstream file carrying +116/−6 fork lines** (see S4 below).

A sweep for every file importing the three doomed modules found 41 importers, of which exactly two are
fork-only (the first two above). All other importers are upstream-owned and upstream updates them
itself.

## What #30881 actually is

Findings that shaped this design, each verified against the commit:

- **`.alpha('v3.2.0')` is metadata, NOT a mechanism.** `HistoryBuilder.alpha()`
  (`server/src/decorators.ts:219`) pushes `{version, state: 'Alpha'}` into a history array emitted as
  an OpenAPI extension. No runtime gating, no feature flag, no alternate code path. The fork inherits
  these annotations verbatim by taking upstream's file; there is nothing to opt into or out of.
- **Old and new endpoints coexist over one schema.** `/system-config` survives, each endpoint marked
  `.deprecated('v3.2.0', { replacementId: 'getAdminConfig' })`, but it now imports `AdminConfigDto`
  from the new module and calls the same `service.getAdminConfig()`. There is exactly one config
  schema; the old routes are thin compatibility aliases. Adopting "half" is not possible, but there is
  also no dual-maintenance burden.
- **Visibility does not inherit.** `applyVisibilityRecursive` gates each **leaf** on its own
  annotation, defaulting to `Admin`; a parent object survives only if some child did. Nesting fork
  fields under `machineLearning` exposes nothing by accident.
- **Unknown keys are stripped, not rejected.** There is no `.strict()` anywhere in the new
  `config.dto.ts`. This is what makes the silent-drop failure mode in "Verification" possible, and it
  is also why a reverted-to-Immich database tolerates leftover fork config keys.
- **The web change is a pure rename** — `SystemConfigDto` → `AdminConfigDto`, same endpoints, with
  `export { AdminConfigDto as SystemConfigDto, ConfigSmtpDto as SystemConfigSmtpDto }` retained
  (`config.dto.ts:531`). Note the alias list covers the **DTOs only** — `SystemConfigSchema` is _not_
  re-exported, which is precisely why S4 below is a required edit rather than an optional one.

## Decisions

### D1 — All fork config fields stay `Admin`

Fork fields carry **no visibility annotation**, so they default to `Admin`. Behaviour-identical to
today.

This was nearly decided the other way. Only two fork config values reach non-admin clients, and both
are deliberately **lossy derivations** exposed through the fork's own `/server/features` +
`/server/config` extensions, not raw passthroughs:

| Fork config                                 | What the client receives                                                                                                    | Consumer                                                     |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `machineLearning.clip.maxDistance` (number) | `smartSearchHasCutoff` — a boolean, `isSmartSearchEnabled(...) && isActiveDistanceThreshold(...)` (`server.service.ts:129`) | web map page / feature flags                                 |
| `memories.types` + `birthday`/`recentTrips` | `availableMemoryTypes` — a resolved key list via `getAdminAvailableMemoryTypeKeys` (`server.service.ts:177`)                | `web/src/routes/(user)/user-settings/FeatureSettings.svelte` |

Promoting those raw fields to `User` visibility and retiring the projection would (a) expose _more_
than today — the actual tuning number and the raw sparse override record — and (b) force web **and**
mobile to each reimplement `isActiveDistanceThreshold` and `getAdminAvailableMemoryTypeKeys`,
including its deprecated `birthday`/`recentTrips` back-compat. The projection is a genuine API
boundary and a better-designed one than raw field exposure, so it stays.

Everything else — `petDetection`, `classification`, `mergePeopleAcrossOwners`, `storageUsage` — reaches
no client at all today. `mergePeopleAcrossOwners` appears in exactly one place, the admin
`ServerSettings.svelte` toggle.

**Accepted asymmetry.** Upstream annotates `enabled` as `User` on the shared
`AdminConfigMachineLearningTaskSchema` leaf, and `clip` / `duplicateDetection` / `facialRecognition` /
`ocr` all derive from it. Honouring D1 makes `petDetection.enabled` the **only** ML task whose
`enabled` is admin-only. That is deliberate — pet detection is surfaced to no client today, so D1
preserves current behaviour — but it will look like an oversight to a future reader. Do not "fix" it
without revisiting D1.

### D2 — Fork config lives in a fork-owned module

Create **`server/src/gallery/config.dto.ts`**, exporting zod fragments and default objects, composed
into upstream's `config.dto.ts` at the seams below.

`server/src/gallery/**` is the manifest's declared preferred fork namespace
(`docs/fork/ownership.yml:17`), already home to the #979 storage-usage work.

The alternative — inlining ~163 fork lines into `config.dto.ts`, mirroring today's `config.ts` — was
rejected. Upstream has just rewritten that file wholesale, which is the strongest available evidence
they will do it again.

## Implementation

### Seams

| Fork config                                                           | Seam                                                                                                                                 | Default                        |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| `machineLearning.clip.maxDistance`                                    | **S1** — see below; `clip` currently uses the shared model schema _directly_                                                         | `0`                            |
| `machineLearning.facialRecognition.suggestions.{enabled,maxDistance}` | added to upstream's existing `facialRecognition` `.extend({...})`                                                                    | `true` / `0.7`                 |
| `machineLearning.petDetection.{enabled,modelName,minScore}`           | **S2** — new object, defined independently                                                                                           | `false` / `yolo11s` / `0.6`    |
| `memories.{retentionDays,birthday,recentTrips,types}`                 | new top-level block                                                                                                                  | `365` / `true` / `true` / `{}` |
| `server.mergePeopleAcrossOwners`                                      | upstream server schema                                                                                                               | `false`                        |
| `classification.{enabled,categories[]}`                               | new top-level block; **must keep** the unique-name `.refine` (`system-config.dto.ts:225`) and the `ClassificationFaceExclusion` enum | `true` / `[]`                  |
| `storageUsage.includeDerivatives`                                     | new top-level block                                                                                                                  | `false`                        |
| `job.{PeopleBackfill,PetDetection,Classification}`                    | job-concurrency map                                                                                                                  | `1` each                       |
| Map tiles (OpenFreeMap `positron` / `dark`)                           | **defaults only** — value overrides on upstream fields, no schema change                                                             | —                              |
| `server/src/utils/config.ts`                                          | **S4** — required edit, see below                                                                                                    | —                              |

`birthday` and `recentTrips` keep their `@deprecated` doc comments (superseded by `types['birthday']`
/ `types['recent_trip']`, retained for back-compat).

### S1 — `clip` is used directly, so this is an edit, not a spread

`config.dto.ts:221` is `clip: AdminConfigMachineLearningModelSchema.meta({ id: 'AdminConfigClipDto' })`
— the shared schema used **as-is**. Adding `maxDistance` means converting that expression to
`.extend({ maxDistance: … }).meta({ id: 'AdminConfigClipDto' })`. Keep the `id` meta: dropping it
renames the generated DTO and churns the OpenAPI spec.

### S2 — The trap: do not build `petDetection` from the shared model schema

`AdminConfigMachineLearningModelSchema` is `AdminConfigMachineLearningTaskSchema.extend({ modelName })`,
and the task schema's `enabled` leaf carries `.meta({ visibility: User })`
(`config.dto.ts:79-85`).

The fork's `petDetection` shape is `{enabled, modelName, minScore}` — _exactly_ the model schema plus
`minScore` — so `AdminConfigMachineLearningModelSchema.extend({ minScore })` is the obvious
implementation and it **silently makes `petDetection.enabled` user-visible**, violating D1.

**Define the fork's pet-detection object independently.** The projection test in Verification is the
guard.

### S4 — `server/src/utils/config.ts` (omitted from the first draft of this spec)

This upstream file carries **+116/−6 fork lines**: `foldLegacyFaceSuggestionConfig` (line 92) and
`deriveSuggestionBand` (line 132), which fold and derive the fork's face-suggestion config. It is also
the single place system config is loaded, merged with defaults, and validated.

Upstream #30881 changes three lines in it:

- the import becomes `import { AdminConfigDto, SystemConfig, defaults } from 'src/dtos/config.dto'`
- `SystemConfigSchema.safeParse(rawConfig)` becomes `AdminConfigDto.schema.safeParse(rawConfig)`

Take upstream's three lines; keep all 116 fork lines. `SystemConfigSchema` is not among upstream's
re-exported aliases, so this cannot be deferred.

Two fork behaviours in this file must survive the port:

- **The empty-object default.** Lines 184–189 enumerate defaults with
  `getKeysDeep(defaults, [], { emptyObjectsAsLeaves: true })` _specifically_ so sparse-map defaults —
  the comment names `memories.types: {}` — count as known keys instead of being reported as unknown.
  Keeping `memories.types: {}` in `defaults` is therefore load-bearing.
- **Config-file strictness asymmetry.** On validation failure the config-file path
  (`IMMICH_CONFIG_FILE`) **throws** and fails boot; the database path only logs
  (`utils/config.ts:203-207`). A fork field with an over-tight constraint is therefore a hard boot
  failure for config-file deployments and a silent log line for everyone else.

### Follow-on edits

- `server/src/dtos/model-config.dto.spec.ts` → retarget onto the new module as
  `server/src/gallery/config.dto.spec.ts`; its current subject no longer exists.
- `server/src/services/classification.service.ts` → swap the `src/config` import for the new path. One
  line; no logic moves.
- `server/src/gallery/storage-usage.service.ts`, `pet-detection.service.ts`,
  `face-suggestion.service.ts` and `classification.service.ts` read fork config through
  `this.getConfig()` rather than importing the deleted modules. They need **no change** once the
  fields exist in the schema — but they are exactly what breaks if a field is silently dropped.
- **CORRECTED during implementation — the client rename is REQUIRED, not optional.** This spec
  originally claimed the fork's web files "keep compiling via the retained alias". That is true of
  the **server source** (`export { AdminConfigDto as SystemConfigDto }`) but **not** of the generated
  SDK: `@immich/sdk` is generated from the OpenAPI spec, whose schema ids contain only
  `AdminConfigDto`, so the alias does not survive generation. In practice this meant renaming
  `SystemConfigDto` → `AdminConfigDto` in **5 fork web files** and **3 fork e2e files**, plus the
  request-param rename `systemConfigDto` → `adminConfigDto` in **9 fork e2e files** and
  `ClassificationSettings.svelte`. Note `tsc` cannot see the `.svelte` occurrence — only
  `pnpm check:svelte` catches it.

### Not in scope

No database migration is involved — this is config schema only, so `server/src/schema/migrations-gallery/`
is untouched.

`scripts/revert-to-immich.sql` is **not** untouched-by-nature, contrary to this spec's first draft: its
section 5 (lines 202–208) strips the merged `classification` key out of `system_metadata`'s
`system-config` row. That section stays correct, because the port changes how config is _declared_,
not what is _stored_. Other fork keys left behind in that row (`memories`, `storageUsage`, …) are
harmless on a reverted instance because upstream's schema strips unknown keys rather than rejecting
them. No edit required — but do not re-derive "config is out of scope" without re-reading section 5.

## Verification

### The failure mode this must catch

`AdminConfigDto.schema.safeParse(rawConfig)` succeeds and `result.data` becomes the live config
(`utils/config.ts:209`). Because the schema strips unknown keys rather than rejecting them, **a fork
field omitted from the schema does not raise an error — it silently vanishes from the running
config.** The feature reading it then sees `undefined` and either dies or quietly turns itself off.
This is the single most likely way to get the port wrong, and neither `tsc` nor the audits see it.

### Tests

1. **No-silent-drop round trip** _(highest value — guards the failure mode above)_. Assert
   `AdminConfigDto.schema.parse(defaults)` retains every fork key: `classification.categories`,
   `memories.types`, `storageUsage.includeDerivatives`, `machineLearning.petDetection.*`,
   `machineLearning.clip.maxDistance`, `machineLearning.facialRecognition.suggestions.*`,
   `server.mergePeopleAcrossOwners`, and the three fork `job` concurrencies.
2. **Projection test** _(guards D1 and S2)_. Assert `mapUserConfig(defaults)` and
   `mapPublicConfig(defaults)` contain none of `memories`, `classification`, `storageUsage`,
   `petDetection`, `maxDistance`, `suggestions`, `mergePeopleAcrossOwners`. Assert against **key
   names**, not whole blocks: `machineLearning.clip` legitimately survives into the user projection
   because upstream's `clip.enabled` is user-visible — only `clip.maxDistance` must be absent.
3. **Classification refine survives.** A `categories` array with two identically-named entries must
   still fail validation with "Category names must be unique". A `.refine` is easy to drop in a
   schema port and nothing else would notice.
4. **Empty-object default.** Loading a config whose `memories.types` is `{}` must not emit the
   "Unknown keys found" warning, and must not wipe a populated defaults section.
5. **Legacy face-suggestion folding.** `foldLegacyFaceSuggestionConfig` and `deriveSuggestionBand`
   must still fold a legacy-shaped config and derive the suggestion band from the _parsed_ result.
6. **Round-trip through both routes.** Deprecated `/system-config` and new `/admin/config` return
   identical payloads, both including fork fields.
7. **Untouched suites.** The fork's admin-settings web specs and `classification.service` tests must
   pass without modification. If they need changing, the port altered behaviour.

Existing gates cover the rest: `server pnpm check` catches the derived-`SystemConfig` typing, and
`test.yml`'s OpenAPI Clients job catches spec drift.

## Sequencing

Land as its own cycle, not folded into a routine rolling batch. `#30881` stays quarantined until this
is implemented; when it lands, pull `e529557160d`, `f9f73114183` (#30891, consumes the public config)
and `f88fb628ff5` (#30821, the Flutter iOS-simulator build patch, held only by commit ordering)
together in one batch.
