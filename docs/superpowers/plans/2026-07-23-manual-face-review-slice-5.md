# Slice 5 — Chooser landing at `/admin/face-cleanup`, all states

Spec: `docs/superpowers/specs/2026-07-23-manual-face-review-mode-design.md` §6.2
Branch: `feat/face-manual-review`
Depends on: slice 4 (dashboard moved to `/scan`; `Route.faceCleanupScan()` exists; a temporary 307
redirect sits at `/admin/face-cleanup` and **this slice replaces it**).

## Goal

Replace slice 4's redirect with the two-card mode chooser, covering all five scan states.

## Design constraints (from §6.2 — do not re-litigate these)

- **Two equal-weight cards**, `lg:grid-cols-2`, identical footprint. **Neither is marked recommended.**
- Two presentations: **first visit** (no scan ever) and **returning** (a scan exists).
- **The manual card is DISABLED while a scan is running** — this is the UI half of `resolveFaces`'s
  409 guard and is the single most important assertion in this slice.
- Reuse the dashboard's visual vocabulary; invent nothing:
  - card shell: `rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800`
  - stat rhythm: dot (`size-2 rounded-full bg-*`) + `text-xs font-medium` label +
    `text-2xl font-semibold tabular-nums` value + `text-xs text-gray-400` sub
  - dashed empty treatment: `rounded-2xl border border-dashed border-gray-200 dark:border-gray-700`
  - semantic colours already in use: amber = flagged, green = done/clean, red = failure
  - only `Button` and `Icon` come from `@immich/ui`; cards are hand-rolled Tailwind
- Icons: `mdiRadar` (guided), `mdiAccountSearch` (manual) — or the nearest available `@mdi/js` exports.

## Step 1 — Data loading

Replace `web/src/routes/admin/face-cleanup/+page.ts` (currently slice 4's redirect):

```ts
import { getLatestScan, searchUsersAdmin } from '@immich/sdk';
import { authenticate } from '$lib/utils/auth';
import { getFormatter } from '$lib/utils/i18n';
import type { PageLoad } from './$types';

export const load = (async ({ url }) => {
  await authenticate(url, { admin: true });
  const users = await searchUsersAdmin({ withDeleted: true });
  // Resolve the scan in `load` and swallow its failure into a flag, rather than awaiting a rejecting
  // promise in onMount: that pattern is untestable under vitest 4 + happy-dom (its unhandled-rejection
  // detector fails the test even when the component catches correctly) and has already cost this
  // feature hours. A null scan with scanFailed=false means "never scanned"; scanFailed=true means
  // "could not load".
  const scan = await getLatestScan().catch(() => null);
  const $t = await getFormatter();
  return { users, scan, meta: { title: $t('admin.face_cleanup') } };
}) satisfies PageLoad;
```

> If `getLatestScan()` genuinely needs to distinguish "no scan" (resolves `null`) from "load failed"
> (rejects), return both `scan` and a `scanFailed` boolean. Check the SDK's return type first and
> implement whichever is accurate — do not guess.

## Step 2 — RED: the spec file

New: `web/src/routes/admin/face-cleanup/page.spec.ts` (the old one moved to `scan/` in slice 4, so
this filename is free).

Model it on the moved `scan/page.spec.ts` for harness shape (render helper, `$app/stores` URL mock,
`@immich/sdk` mocks). URL mock: `http://localhost/admin/face-cleanup`.

Cases — every row of §6.2's state matrix, plus the equal-weight and no-recommendation rules:

1. **first visit (scan = null)** — renders the explanatory header; the guided card shows the
   "needs a scan first" copy and a **Run first scan** action pointing at `Route.faceCleanupScan()`;
   the manual card shows the **"no scan needed"** affordance and links to
   `Route.faceCleanupPeople()`. Assert the manual card is **enabled** — manual review must be
   reachable on a brand-new instance; that is the whole point of this state.
2. **returning, completed, flagged > 0** — guided card shows the flagged count and affected-people
   count from `scan.totals`, with a **Continue** action to `/scan`; manual card shows the user count.
3. **running** — guided card shows progress; **manual card is DISABLED** (assert it is not a working
   link: `aria-disabled="true"` and/or no `href`) and shows the scan-conflict explanation. This is
   the load-bearing assertion of the slice.
4. **completed, 0 flagged** — guided card shows the green "nothing flagged" state and a **Re-scan**
   action.
5. **failed** — guided card shows the error state and a **View details** action to `/scan`.
6. **equal weight** — both cards render in the same grid with the same column span; **neither**
   contains a "recommended" marker. (Assert on the absence of any recommendation testid/text.)
7. **destinations** — guided → `Route.faceCleanupScan()`, manual → `Route.faceCleanupPeople()`.

Give the cards stable testids (`data-testid="chooser-card-guided"` / `"chooser-card-manual"`) so the
assertions do not depend on copy.

Run: `cd web && pnpm exec vitest --run src/routes/admin/face-cleanup/page.spec.ts`
**Expected RED:** the route currently redirects; there is no component to render.

## Step 3 — GREEN: the component

New `web/src/routes/admin/face-cleanup/+page.svelte`. Structure:

```
AdminPageLayout breadcrumbs={[{ title: data.meta.title }]}
  {#if firstVisit}  explanatory header  {/if}
  <div class="grid gap-4 lg:grid-cols-2">
    guided card   (state-driven: firstVisit | running | flagged | clean | failed)
    manual card   (disabled iff scanRunning)
  </div>
```

Derive state once, explicitly, so the template stays flat:

```ts
const scan = $derived(data.scan);
const firstVisit = $derived(!scan);
const scanRunning = $derived(scan?.status === 'pending' || scan?.status === 'running');
const scanFailed = $derived(scan?.status === 'failed');
const flagged = $derived(scan?.totals?.flaggedFaces ?? 0);
```

Manual card disabled treatment: `pointer-events-none opacity-50` plus `aria-disabled="true"` and no
`href`, with an amber explanatory line. Do not rely on opacity alone — it must not be activatable by
keyboard either.

Add `Route.faceCleanupPeople: () => '/admin/face-cleanup/people'` to `web/src/lib/route.ts` if slice 6
has not already (it is needed here first; slice 6 builds the destination).

## Step 4 — i18n

Add the keys this slice renders to `i18n/en.json` under the existing `admin.face_cleanup_*` prefix
(e.g. `admin.face_cleanup_mode_guided`, `..._mode_guided_sub`, `..._mode_manual`, `..._mode_manual_sub`,
`..._mode_manual_no_scan_needed`, `..._mode_manual_blocked_scanning`, `..._mode_first_visit_intro`,
`..._mode_run_first_scan`, `..._mode_continue`, `..._mode_browse_people`, `..._mode_view_progress`,
`..._mode_view_details`).

**`i18n/` is shared by web AND mobile** — only `en.json` needs new keys, but grep both before touching
any existing key.

## Step 5 — Verify

From `web/`:

1. `pnpm exec vitest --run src/routes/admin/face-cleanup/` — the chooser spec plus the moved guided
   specs under `scan/`.
2. `pnpm check:typescript` and `pnpm check:svelte`
3. `pnpm lint` — tailwind warnings are tolerated; errors are not.

Note: `check:svelte` has previously been seen reporting "0 FILES" locally. If that happens, treat it
as an anomaly to investigate, not a pass.

## Commit

`feat(web): add the face-cleanup mode chooser`

Body: note the equal-weight/no-recommendation decision, the two presentations, and that the manual
card is disabled during a scan because `resolveFaces` 409s mid-scan.

## Out of scope

The people browser itself (slice 6) — this slice only links to it. No changes to the guided dashboard.
