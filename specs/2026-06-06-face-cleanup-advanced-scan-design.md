# Face Cleanup Console — advanced scan tuning — design

**Status:** approved (brainstorm 2026-06-06); ready for slice-by-slice implementation
**Branch / PR:** `feat/face-cleanup-console` (#664) — to be implemented and shipped on the same branch as the console.
**Prereq:** the Face Cleanup Console and its scan engine
([`2026-06-03-face-cleanup-console-design.md`](2026-06-03-face-cleanup-console-design.md),
`FaceRepairService.triggerScan` / `handleFaceRepairScan` / `buildRepairPlan`) are already on this branch.

## Motivation

The scan that powers the console is governed by seven tuning parameters (`maxDistance`, `minFaces`,
`voteWindow`, `voteMargin`, `maxAttributionDistance`, `maxFlaggedFraction`, `largeClusterThreshold`).
Today an admin cannot influence any of them from the console — the **Re-scan** button calls
`POST /admin/face-repair/scan`, which takes no body and hardcodes the parameters
(`triggerScan`: config-derived `maxDistance`/`minFaces` + `DEFAULT_*` for the rest). Different libraries
contaminate differently, so a one-size run either over-flags (noisy review queue) or under-flags (misses
real leakage), with no way to adjust short of editing global facial-recognition settings (which has
side effects on live recognition).

The good news: the parameters are **already first-class** below the trigger.

- The synchronous repair endpoint (`POST /admin/face-repair`, `FaceRepairRequestSchema`) already accepts
  all six request-time knobs with full range validation.
- The scan pipeline **already stores and reads per-scan params**: `createScan({ requestedBy, params })`
  persists a `params` object onto the `face_repair_scan` row, and the async job `handleFaceRepairScan`
  reads `storedParams` and applies them (falling back to config/defaults).

The **only** gap is that `triggerScan` does not accept caller-supplied params and forwards a hardcoded set.
This feature closes that gap and surfaces a curated subset in the UI. **The scan engine does not change.**

## Requirements (locked in brainstorm)

1. **Curated subset, not all seven.** The modal exposes the three most legible knobs:
   - **Match sensitivity** — `maxDistance` (0–2). How close two faces must look to be treated as the same
     person. Lower = stricter (fewer matches); higher = looser (more matches). Default = live FR config.
   - **Minimum faces per person** — `minFaces` (integer ≥ 1). Skip people with fewer faces than this.
     Default = live FR config.
   - **Contamination cap** — `maxFlaggedFraction` (0–1). If more than this share of a person's faces look
     wrong, send the whole cluster to review-only instead of auto-repairing. Higher = more aggressive
     auto-repair. Default = `DEFAULT_MAX_FLAGGED_FRACTION`.

   The interacting vote trio (`voteWindow`, `voteMargin`, `maxAttributionDistance`) and
   `largeClusterThreshold` stay at smart defaults — they govern the attribution vote jointly and exposing
   them individually invites incoherent combinations.

2. **Per-scan, transient.** Tuned values apply to **this scan run only**. The next plain **Re-scan**
   reverts to defaults. No new persistence: the `face_repair_scan` row already records the params it ran
   with. The modal opens pre-filled with the current effective defaults.

3. **Endpoint accepts the full optional set.** Although the UI sends only the curated three, the
   scan-trigger DTO accepts every parameter as optional (reusing existing validation). This keeps the
   endpoint complete and lets a future "raw parameters" panel ship with zero server change.

4. **Quick path preserved.** The existing one-click **Re-scan** (defaults) stays. **Advanced** is a
   secondary affordance that opens the modal; the modal has its own **Run scan** action.

## Architecture

### Server

**1. Scan-trigger request DTO** (`face-repair.dto.ts`). New optional schema reusing the existing range
rules:

```ts
const FaceRepairScanParamsSchema = z.object({
  maxDistance: z.number().gt(0).max(2).optional(),
  minFaces: z.number().int().min(1).optional(),
  voteWindow: z.number().int().min(1).optional(),
  voteMargin: z.number().int().min(0).optional(),
  maxAttributionDistance: z.number().gt(0).max(2).optional(),
  maxFlaggedFraction: z.number().min(0).max(1).optional(),
  largeClusterThreshold: z.number().int().min(1).optional(),
});

export const FaceRepairScanTriggerRequestSchema = z
  .object({ params: FaceRepairScanParamsSchema.optional() })
  .meta({ id: 'FaceRepairScanTriggerRequestDto' });
```

The controller's `POST scan` adds `@Body() dto: FaceRepairScanTriggerRequestDto` (body optional → empty
body still valid for the quick path).

**2. `triggerScan(requestedBy, overrides?)`** merges caller overrides over the current hardcoded defaults,
then stores the merged set via `createScan` (which the job already reads). The merge mirrors `runRepair`'s
existing `options.X ?? default` pattern. Omitted knobs fall back exactly as today — so the quick path is
byte-for-byte unchanged.

**3. Effective-defaults read.** New `GET /admin/face-repair/scan/defaults` →
`FaceRepairScanDefaultsDto { maxDistance, minFaces, maxFlaggedFraction }`. `maxDistance`/`minFaces` come
from live FR config; `maxFlaggedFraction` from the server constant. Server stays the single source of
truth; the modal pre-fills from this rather than the web hardcoding the constant.

> Decision: dedicated tiny endpoint (approved) over having the modal read the global admin-config API and
> hardcode the cap default in the web.

### Web (`web/src/routes/admin/face-cleanup/`)

**4. Dashboard (`+page.svelte`).** Add an **Advanced** button beside **Re-scan**. It opens a modal,
pre-fetching defaults via `getFaceRepairScanDefaults()` on open.

**5. Modal component** (`AdvancedScanModal.svelte`, new). Three labeled controls with help text and valid
ranges:

```
┌─ Advanced scan  ──────────────────────────────┐
│ Fine-tune this scan. Applies to this run only. │
│                                                │
│ Match sensitivity        [───●─────]  0.50     │
│   How close two faces must look to be the same │
│   person. Lower = stricter, fewer matches.     │
│                                                │
│ Minimum faces per person [  3  ▲▼]             │
│   Skip people with fewer faces than this.      │
│                                                │
│ Contamination cap        [─────●───]  0.50     │
│   If more than this share of a person's faces  │
│   look wrong, send the whole cluster to        │
│   review-only instead of auto-repairing.       │
│                                                │
│         Reset to defaults    [Cancel] [Run scan]│
└────────────────────────────────────────────────┘
```

Two fraction sliders (`maxDistance`, `maxFlaggedFraction`) + one integer stepper (`minFaces`). **Run scan**
calls `triggerScan({ params })` sending only fields that differ from the defaults (or all three — both are
valid since each is optional; sending all three is simplest and explicit). **Reset to defaults** reloads
from the defaults payload. Reuses the existing post-scan flow (`fetchLatestScan` + `startPolling`).

### Data flow

```
Advanced modal → triggerScan({ params }) → POST /scan {params}
  → triggerScan merges over defaults → createScan({ params: merged })
  → job FaceRepairScan → handleFaceRepairScan reads storedParams → buildRepairPlan (unchanged)
```

## Error handling

- Out-of-range values are rejected by the DTO (400) before any scan row is created; the modal shows valid
  ranges and clamps inputs so a 400 is not normally reachable.
- The existing 409 paths are preserved: "Refusing to scan while facial recognition is active" and
  "A face-repair scan is already in progress" surface as the current scan-conflict toast.
- Defaults fetch failure → modal falls back to showing empty/last-known and still allows a run (server
  re-applies defaults for any omitted field).

## Testing

- **Server unit:** trigger DTO accepts valid params and rejects out-of-range (`maxDistance` > 2,
  `maxFlaggedFraction` > 1, `minFaces` < 1); `triggerScan` passes merged params to `createScan` and falls
  back to defaults for omitted knobs; the quick path (no body) stores exactly today's defaults; defaults
  endpoint returns config-derived values.
- **Server medium:** a scan triggered with a low `maxFlaggedFraction` flags differently than the default
  run on the same seeded fixture — proving the params flow through to the engine, not just the DTO.
- **Web:** modal renders, pre-fills from the defaults payload, **Run scan** sends the params, **Reset**
  restores defaults.

## Scope / non-goals

- **No new persistence** — per-scan only; the `face_repair_scan` row already records what ran.
- **No scan-engine change** — `buildRepairPlan` / attribution untouched; this is wiring + UI only.
- **No change** to apply / decline / review flows.
- **No raw/all-seven panel** now — the DTO accepts them so it can be added later without server changes.

## OpenAPI / SDK

New request body on `POST scan`, new `GET scan/defaults`. Regenerate the spec
(`pnpm -C server sync:open-api`) and both clients (`make open-api`).
