# Porting the Fork's Config Surface onto Upstream's Config Endpoints (#30881)

**Status**: design agreed 2026-08-20, not yet implemented
**Trigger**: upstream `e529557160d` "feat: new config endpoints (#30881)", quarantined during the
batch 128–129 rolling cycle (see `docs/upstream-reports/2026-08-20-upstream-sync-batches-128-129.md`)

## Problem

Upstream #30881 deletes the three files the fork's config surface lives in:

| Deleted file                           | Fork delta | Fork content                                                                                                                                                                                                   |
| -------------------------------------- | ---------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/src/config.ts`                 |        +72 | `clip.maxDistance`, `facialRecognition.suggestions`, `petDetection`, `memories`, `server.mergePeopleAcrossOwners`, `classification`, `storageUsage`, 3 fork queue concurrencies, OpenFreeMap map-tile defaults |
| `server/src/dtos/system-config.dto.ts` |        +62 | Classification / Memories / StorageUsage zod schemas                                                                                                                                                           |
| `server/src/dtos/model-config.dto.ts`  |        +33 | `PetDetectionConfigSchema`, CLIP threshold, face-suggestion config                                                                                                                                             |

They are replaced by a single zod-driven `server/src/dtos/config.dto.ts` in which `SystemConfig` is a
**derived** type (`z.infer` of the schema) rather than a hand-written interface. Fork fields therefore
can no longer be "added to a type" — they must exist as zod fragments composed into the schema.

Two fork-only files import the deleted modules and break outright:
`server/src/dtos/model-config.dto.spec.ts` (its entire subject disappears) and
`server/src/services/classification.service.ts`.

## What #30881 actually is

Findings that shaped this design, all verified against the commit:

- **`.alpha('v3.2.0')` is metadata, not a mechanism.** `HistoryBuilder.alpha()`
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
- **The web change is a pure rename.** `SystemConfigDto` → `AdminConfigDto` against the same
  endpoints, with `export { AdminConfigDto as SystemConfigDto }` retained as a deprecated alias.

## Decisions

### D1 — All fork config fields stay `Admin`

Fork fields carry **no visibility annotation**, so they default to `Admin`. This is behaviour-identical
to today.

This was not obvious and was nearly decided the other way. Only two fork config values reach non-admin
clients, and both are deliberately **lossy derivations** exposed through the fork's own
`/server/features` + `/server/config` extensions, not raw passthroughs:

| Fork config                                 | What the client receives                                                                                                    | Consumer                                                     |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `machineLearning.clip.maxDistance` (number) | `smartSearchHasCutoff` — a boolean, `isSmartSearchEnabled(...) && isActiveDistanceThreshold(...)` (`server.service.ts:129`) | web map page / feature flags                                 |
| `memories.types` + `birthday`/`recentTrips` | `availableMemoryTypes` — a resolved key list via `getAdminAvailableMemoryTypeKeys` (`server.service.ts:177`)                | `web/src/routes/(user)/user-settings/FeatureSettings.svelte` |

Promoting those raw fields to `User` visibility and retiring the projection would (a) expose _more_
than today — the actual tuning number and the raw sparse override record — and (b) force web **and**
mobile each to reimplement `isActiveDistanceThreshold` and `getAdminAvailableMemoryTypeKeys`,
including its deprecated `birthday`/`recentTrips` back-compat. The projection is a genuine API
boundary and a better-designed one than raw field exposure, so it stays.

Everything else — `petDetection`, `classification`, `mergePeopleAcrossOwners`, `storageUsage` — reaches
no client at all today. `mergePeopleAcrossOwners` appears in exactly one place, the admin
`ServerSettings.svelte` toggle.

### D2 — Fork config lives in a fork-owned module

Create **`server/src/gallery/config.dto.ts`**, exporting zod fragments and default objects, spread into
upstream's `config.dto.ts` at a small number of seams.

`server/src/gallery/**` is the manifest's declared preferred fork namespace
(`docs/fork/ownership.yml:17`), already home to the #979 storage-usage work.

The alternative — inlining ~160 fork lines into `config.dto.ts`, mirroring today's `config.ts` — was
rejected. Upstream has just rewritten that file wholesale, which is the strongest available evidence
they will do it again. Option B reduces the conflict surface from "160 lines inside a churning file"
to a handful of one-line spreads.

## Implementation

### Seams

| Fork config                                                           | Seam                                                                                             | Default                        |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------ |
| `machineLearning.clip.maxDistance`                                    | upstream CLIP schema                                                                             | `0`                            |
| `machineLearning.facialRecognition.suggestions.{enabled,maxDistance}` | upstream facial-recognition schema                                                               | `true` / `0.7`                 |
| `machineLearning.petDetection.{enabled,modelName,minScore}`           | new ML task object (see T1)                                                                      | `false` / `yolo11s` / `0.6`    |
| `memories.{retentionDays,birthday,recentTrips,types}`                 | new top-level block                                                                              | `365` / `true` / `true` / `{}` |
| `server.mergePeopleAcrossOwners`                                      | upstream server schema                                                                           | `false`                        |
| `classification.{enabled,categories[]}`                               | new top-level block, keeping the unique-name `refine` and the `ClassificationFaceExclusion` enum | `true` / `[]`                  |
| `storageUsage.includeDerivatives`                                     | new top-level block                                                                              | `false`                        |
| `job.{PeopleBackfill,PetDetection,Classification}`                    | job-concurrency map                                                                              | `1` each                       |
| Map tiles (OpenFreeMap `positron` / `dark`)                           | **defaults only** — value overrides on upstream fields, no schema change                         | —                              |

`birthday` and `recentTrips` keep their existing `@deprecated` doc comments (superseded by
`types['birthday']` / `types['recent_trip']`, retained for back-compat).

### T1 — The one trap

Upstream annotates `enabled` as `User` **on the shared `AdminConfigMachineLearningTaskSchema` leaf**.
Building the fork's `petDetection` by extending that schema would therefore make `petDetection.enabled`
user-visible, silently violating D1.

**The fork's pet-detection object must be defined independently rather than extending upstream's task
schema.** This is the easiest way to break D1 by accident, and the projection test below is what
catches it.

### Follow-on edits

- `server/src/dtos/model-config.dto.spec.ts` → retarget onto the new module as
  `server/src/gallery/config.dto.spec.ts`; its current subject no longer exists.
- `server/src/services/classification.service.ts` → swap the `src/config` import for the new path.
  One line; no logic moves. It imports `ClassificationFaceExclusion` and `SystemConfig`.
- Fork web files naming `SystemConfigDto` (10 files, incl. `ClassificationSettings.svelte`,
  `MemoriesSettings.spec.ts`, `NewVersionCheckSettings.spec.ts`) keep compiling via the deprecated
  alias. Renaming them is **optional cleanup, explicitly out of scope** for this port.

### Not in scope

No database migration is involved — this is config schema only, so `scripts/revert-to-immich.sql` and
`server/src/schema/migrations-gallery/` are untouched.

## Verification

D1 is mechanically testable, so it is enforced rather than reviewed:

1. **Projection test** — assert `mapUserConfig(defaults)` and `mapPublicConfig(defaults)` contain none
   of `memories`, `classification`, `storageUsage`, `petDetection`, `maxDistance`, `suggestions`,
   `mergePeopleAcrossOwners`. This is the regression guard for T1 and for anyone later reusing a
   `User`-annotated upstream leaf.
2. **Round-trip test** — `AdminConfigDto` still carries every fork field, and the deprecated
   `/system-config` and the new `/admin/config` return identical payloads.
3. **Untouched suites** — the fork's admin-settings web specs and `classification.service` tests must
   pass without modification. If they need changing, the port altered behaviour.

Existing gates cover the rest: `server pnpm check` catches the derived-`SystemConfig` typing, and
`test.yml`'s OpenAPI Clients job catches spec drift.

## Sequencing

Land as its own cycle, not folded into a routine rolling batch. `#30881` stays quarantined until this
is implemented; when it lands, pull `e529557160d`, `f9f73114183` (#30891, consumes the public config)
and `f88fb628ff5` (#30821, the Flutter iOS-simulator build patch, held only by commit ordering)
together in one batch.
