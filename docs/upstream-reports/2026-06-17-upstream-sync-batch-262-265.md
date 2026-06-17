# Upstream Sync Report — 2026-06-17 (batches 262–265)

Second sync of the day, on top of `2026-06-17-upstream-sync.md` (batches 255–261, v3.0.0-rc.1).

## Summary

- **Mode**: rolling-upstream-rebase on `rebase/upstream-rolling-20260509-active` (v3-cutover branch, held off `main`)
- **Fork commits synced**: 0 (origin/main still at #705 `c1387721`)
- **Upstream commits pulled** (`c9aa9ba711..3f2e51c5d4`): 4 (batches 262–265)
- **Conflicts resolved**: 1 file (`asset-response.dto.ts`, twice — zod-uuid + a dedup)
- **Post-rebase fixes**: 1 — `app-metrics.service.ts` switch made exhaustive for #29029 (`87721313`)
- **New migrations**: 0 — Gallery migration count steady at **33**, mobile Drift unchanged
- **Risk level**: LOW–MEDIUM
- **Recommendation**: PROCEED — server build + lint + unit suite (4652) green locally; structural audits green.

> **Scope note:** held rolling branch — not pushed to `main`, no `branding.upstream.version` bump (stays `v2.7.5`).

## Upstream commits (4)

| SHA        | PR     | Area      | Risk    | Outcome                                                                                       |
| ---------- | ------ | --------- | ------- | --------------------------------------------------------------------------------------------- |
| `8d30cfa2` | #29163 | ML/Docker | LOW     | clean — `machine-learning/Dockerfile` Intel dep bump; fork has zero divergence                |
| `fbb0bc6e` | #29153 | CI/deps   | LOW     | clean — `server/Dockerfile*` mise tag → v2026.6.10                                            |
| `430a2bbf` | #29029 | server/CI | MED     | clean replay (fork doesn't touch `eslint.config.mjs`); new lint rule fixed 1 fork switch (C2) |
| `3f2e51c5` | #29140 | server    | LOW-MED | **reconciled** `asset-response.dto.ts` (C1) — `z.string()`→`z.uuidv4()` on ID fields          |

## Conflict resolutions (C1)

### `server/src/dtos/asset-response.dto.ts` (×2)

1. **at fork #243** (`1188e596` space-context fallback): #29140 tightened `duplicateId` to `z.uuidv4()`; fork #243 added `resolvedSpaceId`. Kept upstream's `uuidv4()` on `duplicateId` + the fork's `resolvedSpaceId`.
2. **at fork `44f4feb5`** (style/lint cleanup): that commit removed a **duplicate** `resolvedSpaceId` (the canonical one lives further down in the same `extend`). Step 1's resolution re-introduced the duplicate, so this hunk re-applied the dedup — kept `duplicateId: z.uuidv4()`, dropped the duplicate `resolvedSpaceId` (final file has exactly one, verified).

- Kept fork `resolvedSpaceId` as `z.string()` (not `uuidv4()`) — conservative; output zod validation isn't enforced yet (controllers still `// TODO: ZodSerializerDto`), so the broader fork-DTO uuidv4 propagation is a deferred follow-up rather than an inline risk.

## Post-rebase fix (C2)

### `server/src/services/app-metrics.service.ts` — #29029 switch-exhaustiveness

Upstream #29029 added `@typescript-eslint/switch-exhaustiveness-check` (`considerDefaultExhaustiveForUnions: true`) to `server/eslint.config.mjs`. The **fork-only** `app-metrics.service.ts` switches on `getWorker()` (`ImmichWorker | undefined`) and handled only `Api`/`Microservices`, so the rule flagged it as non-exhaustive (missing `Maintenance` + `undefined`). Added `default: break` (the Maintenance worker and `undefined` register no metrics gauges — correct behavior). `ImmichWorker.Maintenance` is upstream; the fork service just hadn't covered it. **Server lint: clean (was the only flagged switch).**

## Pattern propagation (deferred follow-up)

#29140 converts ID fields to `z.uuidv4()` across upstream zod DTOs. Fork-only DTOs (shared-space, user-group, classification, storage-migration, gallery-map, + `resolvedSpaceId`) still use `z.string()` for IDs. Low-impact (spec annotation; output validation not yet enforced). Deferred to a follow-up PR rather than bundled.

## Audits & local verification

| Check                                       | Status    | Notes                                                                                                       |
| ------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------- |
| postrebase-audit (262–265)                  | GREEN     | fork files/symbols, 33 migrations, no collisions; Generated-Artifact-Review flag satisfied by no-diff regen |
| ci-invariants / fork-patches / mobile-drift | GREEN     | —                                                                                                           |
| OpenAPI/SDK/Dart regen                      | GREEN     | **no diff** (artifacts consistent incl. #29140 uuid spec)                                                   |
| Server build (nest)                         | PASS      | via regen                                                                                                   |
| Server lint (eslint)                        | PASS      | after C2 fix (1 switch)                                                                                     |
| Server unit tests                           | GREEN     | 4652 passed, 9 skipped, 0 failed                                                                            |
| Web / mobile                                | N/A local | zero web/mobile code changes this batch — CI gate                                                           |

## Post-rebase state

- Upstream base: `3f2e51c5d4` (`c9aa9ba711..3f2e51c5d4`); fork commits ahead: 767; behind: 0.
- `integratedForkHead`: `c1387721`; `upstreamTargetHead`: `3f2e51c5d4`.
