# Slice 4 — Move the guided dashboard to `/admin/face-cleanup/scan`, and repair the e2e it breaks

Spec: `docs/superpowers/specs/2026-07-23-manual-face-review-mode-design.md` §6.1, §6.6
Branch: `feat/face-manual-review`

## Goal

Free `/admin/face-cleanup` for the chooser (slice 5) by relocating the guided dashboard to
`/admin/face-cleanup/scan`, with **no behaviour change**. The e2e repairs ship in this slice because
the move alone leaves CI red.

## Step 1 — Move the files

`git mv` these ten from `web/src/routes/admin/face-cleanup/` to
`web/src/routes/admin/face-cleanup/scan/`:

```
+page.svelte  +page.ts  page.spec.ts
FaceCleanupTable.svelte
face-cleanup.svelte.ts  face-cleanup.spec.ts
ScanChecklist.svelte    ScanChecklist.spec.ts
AdvancedScanModal.svelte AdvancedScanModal.spec.ts
```

They are a self-contained cluster — no imports reach them from `[personId]/`, `resolutions/`, or
`declined/`. Their specs import their subjects by relative path, so the specs travel with them
unchanged. Do **not** move `[personId]/`, `resolutions/`, or `declined/`.

The `$app/stores` URL mocks inside the moved specs (e.g. `new URL('http://localhost/admin/face-cleanup')`)
are mocks, not assertions — update them to `/admin/face-cleanup/scan` for accuracy, but nothing fails
if they lag.

## Step 2 — Routes

`web/src/lib/route.ts` (~`:169`):

```ts
faceCleanup: () => '/admin/face-cleanup',            // now the chooser
faceCleanupScan: () => '/admin/face-cleanup/scan',   // NEW — the guided dashboard
```

Add a temporary redirect so this slice ships without a dead entry point. New
`web/src/routes/admin/face-cleanup/+page.ts`:

```ts
import { redirect } from '@sveltejs/kit';
// Temporary: slice 5 replaces this with the mode chooser.
export const load = () => redirect(307, Route.faceCleanupScan());
```

Precedent for the pattern: `admin/+page.ts:5` and `face-cleanup/declined/+page.ts:7`.

## Step 3 — Repoint navigation (six call sites)

- `web/src/routes/admin/face-cleanup/[personId]/+page.svelte`
  - `:278` Cancel `goto` → `Route.faceCleanupScan()`
  - `:305` post-Apply `goto` → `Route.faceCleanupScan()`
  - `:347` breadcrumb href → `Route.faceCleanupScan()`
  - `:351` back link → `Route.faceCleanupScan()`
- `web/src/routes/admin/face-cleanup/resolutions/+page.svelte`
  - `:97` breadcrumb → `Route.faceCleanupScan()`
  - `:145` back button → `Route.faceCleanupScan()`

(Line numbers are pre-slice; locate by the `Route.faceCleanup()` call.)

**Do NOT touch the navbar.** `AdminPageLayout.svelte:46` points at `/admin/face-cleanup` and
`NavbarItem` highlights via `page.url.pathname.startsWith(href)`, so it stays correctly active across
`/scan`, `/people`, and the chooser. Changing it would be a regression, not a fix.

`FaceCleanupTable.svelte`'s `Route.viewFaceCleanupPerson(...)` is **unchanged** — the guided review
route itself does not move.

## Step 4 — Repair the four e2e assertions

File: `e2e/src/specs/web/face-cleanup.e2e-spec.ts`

1. `:151` — `page.goto('/admin/face-cleanup')` then asserts the header + **Re-scan** button at
   `:154,:157`. → `page.goto('/admin/face-cleanup/scan')`.
2. `:295` — `page.goto('/admin/face-cleanup')` then asserts the seeded person's name at `:297`.
   → `/admin/face-cleanup/scan`.
3. `:361` — `page.waitForURL('**/admin/face-cleanup', { timeout: 15_000 })`. Playwright globs match
   the **whole** URL, so `/admin/face-cleanup/scan` will not match and this times out.
   → `'**/admin/face-cleanup/scan'`.
4. `:541` — the same `waitForURL` in Consistency X1. → same fix.

### The one that must be FIXED, not repointed

`:363-365` asserts `expect(page.getByText(sourceName)).toHaveCount(0)` — the post-apply drain check.
Its value depends entirely on landing on a page that _would_ show the name. Pointed at a chooser (or
any page that never lists people) it passes **vacuously**, silently gutting the check.

After fixing `:361` to land on `/scan`, verify this assertion is still meaningful: the dashboard must
have loaded its scan list before the assertion runs. If the redirect or navigation timing makes the
assertion race an empty list, add an explicit wait for the dashboard's loaded state (e.g. the stat
strip or table) **before** asserting the absence. An absence assertion that can pass on an unloaded
page is worthless.

## Step 5 — Verify

1. `cd web && pnpm exec vitest --run src/routes/admin/face-cleanup` — all nine guided specs still pass
   from their new locations.
2. `cd web && pnpm check:typescript && pnpm check:svelte`
3. `cd web && pnpm lint`
4. e2e: run the face-cleanup web spec against the e2e stack. **Use the e2e stack on :2285**, not a
   `make dev` stack on :2283 — :2283 has been observed serving 0-byte bodies, producing bogus
   "element not found" failures. The file is `test.describe.serial`, so a failure early skips
   everything after it; read the DOM snapshot artifact rather than trusting the summary.

## Step 6 — Manual sanity

Confirm `/admin/face-cleanup` redirects to `/scan`, the navbar entry stays highlighted on `/scan`, and
the guided review page's Cancel/Apply return to `/scan`.

## Commit

`refactor(web): move the guided face-cleanup dashboard to /admin/face-cleanup/scan`

Body: note the temporary redirect (replaced by the chooser in slice 5), that the navbar deliberately
does not change (prefix matching), and that four e2e assertions were repaired — one of which would
otherwise have passed vacuously.

## Out of scope

No chooser (slice 5). No new pages. No behaviour change to the dashboard itself — this is a
relocation.
