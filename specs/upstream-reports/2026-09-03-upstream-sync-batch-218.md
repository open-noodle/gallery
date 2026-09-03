# Upstream Sync Report — 2026-09-03 (batch 218)

## Summary

- **Upstream commits pulled**: 1 (`26a25f0c3ab..da8131d5c2e`)
- **Fork commits synced from `origin/main`**: 0 (`integratedForkHead` `d44f0d2dece` is level with `origin/main`)
- **Conflicts resolved**: 1 (generated SDK artifact)
- **Risk level**: LOW
- **Recommendation**: PROCEED

Batch 218 is a single upstream web bugfix. The whole-tree diff against the pre-cycle tip matches
upstream's own commit stats byte for byte (7 files, +121/−105), which is the complete
"no fork content lost" proof for this cycle.

## Incoming Upstream Changes

| SHA           | Summary                                              | Area      | Risk to Fork | Notes                                                                                                     |
| ------------- | ---------------------------------------------------- | --------- | ------------ | --------------------------------------------------------------------------------------------------------- |
| `da8131d5c2e` | fix(web): album date range formatting (immich-28564) | web + DTO | LOW–MEDIUM   | Breaking signature change to a shared web util; shared date-format constant reaches a fork-only component |

### Detailed analysis

`immich-28564` rewrites `web/src/lib/utils/date-time.ts` (−49 net lines) and reworks how album
date ranges are formatted, moving from hand-rolled Luxon string assembly onto
`Intl.DateTimeFormat.formatRange`.

Three distinct fork-facing surfaces were checked:

**1. `getAlbumDateRange` signature change (breaking).**
`getAlbumDateRange(album: { startDate?, endDate? })` → `getAlbumDateRange(start: string, end: string)`.
This is the classic zero-conflict semantic-break shape (a fork call site would break in a file
upstream never touched). Grepped every call site on the branch: the only ones are
`web/src/lib/components/album-page/AlbumSummary.svelte` (an upstream file that upstream updates in
the same commit) and the spec. **No fork-only call site** — the change is self-contained.

**2. `getShortDateRange` behaviour change (signature stable).**
Still `(start, end)`, but now delegates to `Intl.formatRange`. Only call site is upstream's
`AlbumCard.svelte`. No fork usage.

**3. `dateFormats.album` silently gains `timeZone: 'UTC'` — and reaches a fork-only file.**
This is the non-compiler-visible one. `web/src/lib/constants.ts`'s `dateFormats.album` is consumed by
the fork-only `web/src/lib/components/spaces/space-albums-table.svelte`, whose `dateLocaleString`
helper is a verbatim sibling of upstream's `album-page/AlbumsTableRow.svelte`.

Both files call that helper with `album.updatedAt` / `album.createdAt` — real instants, not the
date-only values the `timeZone: 'UTC'` addition targets. So upstream's change shifts those two
columns from viewer-local to UTC **in upstream's own table as well as the fork's**, identically.

**Resolution: take upstream's behaviour, no fork divergence.** The fork component is a copy of the
upstream one; keeping them in lockstep is what prevents drift on every later rebase, and diverging
here would mean maintaining a fork-only date-format constant forever. Recorded as a deliberate,
cosmetic, upstream-aligned change rather than a regression.

## Per-batch product-direction gate

**Not triggered.** The batch is a formatting bugfix. It does not introduce or rework a feature
overlapping a fork surface, does not reshape the album/access/sync data model, and sets no product
direction. The album DTO change is description text only — no shape change.

## Zero-conflict semantic-break detectors

| Detector                                                    | Result                                                                                               |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Shape I — files upstream ADDS on a fork-touched path        | CLEAN (batch adds no files)                                                                          |
| Shape I (rename variant) — upstream renames onto fork paths | CLEAN (batch renames no files)                                                                       |
| Deleted-literal / silent no-op vs branding + tools          | CLEAN (no URLs or literals removed)                                                                  |
| i18n branding-override gap                                  | N/A (batch touches no `i18n/`)                                                                       |
| Changed-signature grep across fork-only code                | CLEAN (`getAlbumDateRange` / `getShortDateRange` have no fork call sites)                            |
| Shared-constant semantic change                             | **HIT** — `dateFormats.album` → fork's `space-albums-table.svelte`; analysed above, upstream-aligned |

## Conflict Resolutions

### Conflict: `packages/sdk/src/fetch-client.ts` (at fork commit #752)

- **Fork side**: adds `sharedSpaceLinks?: AlbumSharedSpaceLinkResponseDto[]` to `AlbumResponseDto`.
- **Upstream side**: rewords the adjacent `startDate` doc comment to
  `UTC representation of (local) start date (earliest asset)`.
- **Resolution**: kept both — the fork field plus upstream's new comment. The two sides touch
  adjacent lines of the same generated block, not the same content.
- **Risk**: LOW. This is a generated artifact; it was regenerated from source afterwards and the
  regenerated output confirms the resolution (fork field present, upstream comment present).
- **Verification**: `grep sharedSpaceLinks packages/sdk/src/fetch-client.ts` → present in both
  `AlbumResponseDto` and `SharedSpaceLinkedAlbumDto`; whole-tree diff shows only upstream's 4 lines.

## Generated artifacts — a real fork-side propagation

`make upstream-postrebase-audit` flagged `Generated Artifact Review` on
`open-api/immich-openapi-specs.json`. Reviewing it rather than waving it off surfaced genuine drift:

The fork's `SharedSpaceLinkedAlbumSchema` is defined as
`AlbumResponseSchema.omit({ albumUsers: true }).extend(...)` (`server/src/dtos/shared-space.dto.ts:174`).
Because it **derives** from the schema upstream just reworded, upstream's new `startDate`/`endDate`
descriptions propagate into `SharedSpaceLinkedAlbumDto` — a fork-only DTO that upstream does not
generate and therefore did not update in their commit.

Regenerating produced exactly that drift and nothing else. Committed as
`chore: regenerate OpenAPI artifacts after upstream rebase`. Left unregenerated, this would have
failed CI's "OpenAPI Clients" job a full round later.

`make sql` was correctly skipped: nothing under `server/src/repositories/` changed this batch.

## Fork Feature Verification

| Feature               | Status | Notes                                                                              |
| --------------------- | ------ | ---------------------------------------------------------------------------------- |
| Shared Spaces         | OK     | `sharedSpaceLinks` intact; `SharedSpaceLinkedAlbumDto` regenerated correctly       |
| Space Albums          | OK     | `space-albums-table.svelte` inherits upstream's date-format change, analysed above |
| Storage Migration     | OK     | tree byte-identical to last green tip                                              |
| Pet Detection         | OK     | tree byte-identical to last green tip                                              |
| Image Editing         | OK     | tree byte-identical to last green tip                                              |
| Branding              | OK     | `branding/` byte-identical to last green tip                                       |
| Google Photos Import  | OK     | tree byte-identical to last green tip                                              |
| Search V3 coexistence | OK     | `search-v3-not-dispatched` invariant passes                                        |

## Audit and gate results

| Gate                                  | Status | Notes                                                           |
| ------------------------------------- | ------ | --------------------------------------------------------------- |
| `upstream-postrebase-audit BATCH=218` | PASS\* | \*only `Generated Artifact Review`, resolved by the regen above |
| Fork-Owned File Survival              | OK     |                                                                 |
| Fork Extension Symbol Survival        | OK     |                                                                 |
| Gallery Migration Count               | OK     | 62 (expected 62)                                                |
| Migration Timestamp Collision Check   | OK     |                                                                 |
| Generated Query Block Survival        | OK     | no query block lost                                             |
| `fork-patches-check`                  | OK     | `@immich/ui` patch metadata consistent                          |
| `ci-invariants-check`                 | OK     | all 5, incl. `search-v3-not-dispatched`                         |
| `mobile-drift-rebase-check BATCH=218` | OK     | schemaVersion, snapshots, Gallery callbacks consistent          |
| `commit-autolink-check`               | OK     | 1416 messages scanned, fork PR ceiling 1060                     |

## Database / mobile migration analysis

No migrations changed this batch. The 7-file whole-tree diff contains nothing under
`server/src/schema/migrations/`, `server/src/schema/migrations-gallery/`, `mobile/drift_schemas/`,
or the mobile database file — so `scripts/revert-to-immich.sql` coverage is provably unchanged from
the green batch-217 state, and mobile Drift versioning is untouched (confirmed independently by
`mobile-drift-rebase-check`).

## Local CI Verification

Gates were scoped by **tree identity** against the last 10/10-green tip (`f94f8e01d12`, batch 217).
`machine-learning`, `i18n`, `.github`, `docker`, `deployment`, `branding`, `e2e`, `mobile`, `docs`
and `tools` are all **byte-identical** to that tip, so their gates carry no new information this
cycle and were deliberately skipped. Only `server`, `web`, `open-api` and `packages` changed.

| Check                                  | Status | Notes                                     |
| -------------------------------------- | ------ | ----------------------------------------- |
| `server pnpm build` (+ migration sync) | PASS   | 62 migrations, 1 compatibility alias      |
| `server pnpm check` (tsc)              | PASS   |                                           |
| `web check:typescript`                 | PASS   |                                           |
| `web check:svelte`                     | PASS   | 627 files, 0 errors, 0 warnings           |
| `server pnpm lint`                     | PASS   |                                           |
| `server prettier --check`              | PASS   |                                           |
| web eslint (`tscompat` off)            | PASS   |                                           |
| `web prettier --check`                 | PASS   |                                           |
| Server unit tests                      | PASS   | 198 files, 6130 passed, 12 skipped        |
| Web unit tests                         | PASS   | 373 files, 5988 passed, 2 skipped, 8 todo |
| `tools/upstream-preflight` suite       | PASS   | 24 files, 257 passed                      |
| OpenAPI regeneration                   | PASS   | drift found and committed (see above)     |

Mobile gates were skipped on tree identity (`mobile/` unchanged); the Dart client is gitignored and
regenerated cleanly as part of `mise run //:open-api`.

## Inconsistencies Found

One, fixed in-cycle: the fork's derived `SharedSpaceLinkedAlbumDto` needed regeneration after
upstream's description rewording (see "Generated artifacts" above). No others.

## Pattern Propagation

No broad architectural refactor in this batch.

## Skill Sync Anchor

Unchanged at `d44f0d2dece`. `git log d44f0d2dece..origin/main` is empty — no fork PR merged this
cycle — and the anchor remains an ancestor of `origin/main`, so scans stay clean.
`references/fork-surface.md` needs no new rows.

## Remote CI Verification

- **Test branch**: `rebase/upstream-batch-218`
- **Commit validated**: (filled in below after dispatch)

| Workflow                                  | Status | Notes |
| ----------------------------------------- | ------ | ----- |
| `test.yml`                                | TBD    |       |
| `docker.yml`                              | TBD    |       |
| `static_analysis.yml`                     | TBD    |       |
| `gallery-build-mobile.yml`                | TBD    |       |
| `gallery-rebase-smoke.yml`                | TBD    |       |
| `storage-migration-tests.yml`             | TBD    |       |
| `storage-migration-e2e.yml`               | TBD    |       |
| `gallery-revert-to-immich-validation.yml` | TBD    |       |
| `gallery-ml-smoke.yml`                    | TBD    |       |
| `gallery-mobile-smoke.yml`                | TBD    |       |

## Post-Rebase Verification

- Fork commits ahead of upstream: 1415 (+1 regen commit, +1 report commit)
- Commits behind upstream: 0
- Fork diff clean: YES — whole-tree diff vs pre-cycle tip is exactly upstream's own commit stats

## Landing

Per the standing rule, the branch stays **off `main`**: upstream has released no new tag
(latest FINAL remains v3.1.0; v3.2.0-rc.\* are RCs). Green + level + fork-synced is the expected
steady state of this workflow.
