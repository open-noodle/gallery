# Upstream Sync Report — 2026-06-18 (batches 270–272)

Second sync of the day, on top of `2026-06-18-upstream-sync.md` (batches 268–269).

## Summary

- **Mode**: rolling-upstream-rebase on `rebase/upstream-rolling-20260509-active` (v3-cutover branch, held off `main`)
- **Fork commits synced**: 0 (`origin/main` unchanged at #709 `37224e0b`)
- **Upstream commits pulled** (`9a3071ae5c..53fe26593c`): 5 (batches 270–272, rebased in one pass)
- **Conflicts resolved**: 20 files — **all generated** (`mobile/openapi/**` DTOs + `packages/sdk/src/fetch-client.ts`), auto-resolved fork-side + regenerated. **No source conflicts** (`validation.ts` auto-merged; verified below).
- **Post-rebase fixes**: 1 — OpenAPI regeneration (`e3581e88`)
- **New migrations**: 0 — Gallery migration count steady at **33**, mobile Drift unchanged
- **Risk level**: MEDIUM (driven by the `validation.ts` reconciliation + the wide datetime spec change)
- **Recommendation**: PROCEED — local gate fully green (server 4659 unit tests + web; `tsc`/`svelte-check`; SDK build; structural audits); remote CI pending dispatch.

> **Scope note:** held rolling branch — not pushed to `main`, no `branding.upstream.version` bump (stays `v2.7.5`).

## Upstream commits (5)

| SHA        | PR     | Area        | Risk    | Batch | Outcome                                                                                                                                                                                                     |
| ---------- | ------ | ----------- | ------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `83091d28` | #29186 | server      | MED     | 270   | allow non-utc datetime offsets — `validation.ts` `isoDatetimeToDate` gains `offset: true`; spec datetime `pattern`s widen to accept `±offset`; ~30 regenerated DTOs. OpenAPI-generated → conflicts + regen. |
| `09d03808` | #29189 | server      | LOW-MED | 271   | use zod time validation — removed `isValidTime` from `validation.ts`; localized (nightly-tasks config field).                                                                                               |
| `48861b08` | #29191 | server      | LOW-MED | 272   | organize integrity DTOs — moved `IntegrityReportParamSchema`/`IntegrityReportTypeParamDto` from `validation.ts` to `integrity.dto.ts` (internally consistent; upstream files only).                         |
| `40cffcd4` | #29188 | web         | LOW     | 272   | remove local-only step ids from workflow json (`workflows/[id]/+page.svelte`; upstream automation feature).                                                                                                 |
| `53fe2659` | #29190 | plugin-core | LOW     | 272   | asset type filter — `packages/plugin-core/*` (workflow plugin filter; **not** the fork filter panel).                                                                                                       |

## Conflict resolutions (all generated)

The cherry-picked **#672** `.gitattributes` marks generated files `-merge`, so each fork commit that regenerated a datetime-bearing DTO touched by #29186 surfaced as a pick-a-side conflict. **20 generated files** across 4 fork-commit replay steps (squash base + later commits) were auto-resolved by taking the **fork-commit side** (`--theirs`), then regenerated authoritatively. **No source-file conflicts arose.**

### Post-rebase reconciliation — `e3581e88`

`mise //:open-api` regenerated all clients from the final merged spec. **This time the spec itself changed (48 lines, balanced)** — the rebase's spec auto-merge had retained the fork-base's **UTC-only** datetime `pattern` on the fork's filter/search query params, but those params share the `isoDatetimeToDate` zod codec that #29186 gave `offset: true`. Regen (server→spec, authoritative) correctly propagated the offset alternation `Z|([+-]hh:mm)` to those fork params — keeping them consistent with the server. **No endpoint added or dropped** — purely the datetime pattern string. 25 generated DTOs + spec committed.

## `validation.ts` reconciliation (the flagged MEDIUM risk)

All three server commits touch `server/src/validation.ts`, which the fork also modifies (fork commit `2c63d1b6` "restore fork-needed zod validation helpers after rebase" + `08cb9601` video-trim). It **auto-merged with no conflict**; verified post-rebase:

- The rebase applied **only** upstream's three edits: `+offset: true` (#29186), removed `isValidTime` (#29189), removed the integrity DTO def now living in `integrity.dto.ts` (#29191).
- **All 11 fork zod helpers present**: `IsAxisAlignedRotation`, `IsGreaterThanOrEqualTo`, `IsGreaterThanProperty`, `IsUniqueEditActions`, `Optional`, `sanitizeFilename`, `ValidateBoolean`, `ValidateDate`, `ValidateEnum`, `ValidateUUID`, `emptyStringToNull`.
- No fork code references the upstream-removed `isValidTime` (the integrity symbols resolve to their new `integrity.dto.ts` home). **Server `tsc` clean** confirms.

## Audits & local verification

| Check                                       | Status | Notes                                                                               |
| ------------------------------------------- | ------ | ----------------------------------------------------------------------------------- |
| postrebase-audit (272)                      | GREEN  | fork files/symbols, 33 migrations, no collisions, Generated-Artifact-Review OK      |
| ci-invariants / fork-patches / mobile-drift | GREEN  | no PUSH_O_MATIC; gallery images; docs-deploy disabled; @immich/ui; Drift consistent |
| svelte.config.js fork resolution            | INTACT | fork's omit-`version.name` block                                                    |
| OpenAPI regen (TS SDK + Dart)               | DONE   | spec offset-pattern propagation; 25 clients reconciled & committed                  |
| SDK build (`tsc`)                           | PASS   | regenerated `fetch-client.ts` compiles                                              |
| Server `check` (`tsc`)                      | PASS   | validation.ts + integrity-DTO move consistent; no broken fork imports               |
| Web `check:typescript` / `check:svelte`     | PASS   | tsc clean; svelte-check 0 errors / 0 warnings                                       |
| Server unit tests                           | GREEN  | 4659 passed, 9 skipped, 0 failed (141 files)                                        |
| Web unit tests                              | GREEN  | 3166 passed, 2 skipped, 8 todo, 0 failed (239 files)                                |

## Remote CI verification

_Pending dispatch on `rebase/upstream-batch-272`. To record after green._

## Post-rebase state

- Upstream base: `53fe26593c` (`9a3071ae5c..53fe26593c`); fork commits ahead: **777**; behind: **0**.
- `integratedForkHead`: `37224e0b` (unchanged); `upstreamTargetHead`: `53fe26593c`.
- Tip `e3581e88` (regen fix) → `1bc1a2a7` (#672 cherry-pick) → prior history.
- Canonical `rebase/upstream-rolling-20260509-active` to be updated to the rebased tip; not pushed to `main` (held for v3 cutover).
