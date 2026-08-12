# Face Repair read-only preview on demo — design

**Date:** 2026-08-12
**Branch:** `demo` (demo-only change; never merges to `main`)
**Status:** approved, pending implementation

## Problem

The admin **Face Repair** console (`/admin/face-cleanup/*`, API `/api/admin/face-repair/*`) is reachable
from the demo user's admin preview but does not work there:

1. `AdminPageLayout.svelte` renders the `admin.face_cleanup` nav item unconditionally, so the demo user
   sees the entry — unlike Users, Queues, Maintenance, System Settings, Storage Migration and Library
   Management, which are all demo-gated.
2. Every face-repair endpoint is `@Authenticated({ admin: true })`, and the demo user is **not** a real
   admin. Access depends on `DEMO_ADMIN_PREVIEW_READ_ROUTES` in `server/src/services/auth.service.ts`,
   which contains no face-repair entry — so every GET 403s.
3. `DemoInterceptor` blocks every non-allowlisted write, so the console's actions 403 as well.

Net effect: a demo visitor can click into Face Repair and land on a dead, erroring console. This is a
bug independent of any new feature work.

Separately, demo has never run a face-repair scan (`face_repair_scan` = 0 rows), so even with the reads
opened the console would be empty.

## Goals

- Face Repair is a working, read-only exhibit on demo, consistent with every other admin console there.
- It shows real findings — real faces, real thumbnails, real confidence — in both lanes.
- No loosening of demo's write protection. Every mutation stays 403.

## Non-goals

- Letting demo visitors accept/decline/merge. Explicitly deferred; it would need a reset story for
  findings consumed by visitors, and it breaks the "demo blocks all writes" invariant.
- Any change to `main`. This is demo-branch-only.

## Design

### 1. Server — open the reads

Add to `DEMO_ADMIN_PREVIEW_READ_ROUTES` (`server/src/services/auth.service.ts`):

```ts
/^\/api\/admin\/face-repair\/scan\/latest$/,
/^\/api\/admin\/face-repair\/scan\/defaults$/,
/^\/api\/admin\/face-repair\/scan\/person\/[^/]+$/,
/^\/api\/admin\/face-repair\/person\/[^/]+$/,
/^\/api\/admin\/face-repair\/decline$/,
/^\/api\/admin\/face-repair\/resolutions$/,
/^\/api\/admin\/face-repair\/owner\/[^/]+\/people$/,
/^\/api\/admin\/face-repair\/faces\/[^/]+\/thumbnail$/,
```

`DemoInterceptor` is **not** modified. The POST/DELETE half of the controller (`scan`, `resolve`,
`decline`, `unconfirm`, `cluster-faces`, `resolutions/remove`, `owner/:id/people`) stays blocked.

**The allowlist cannot leak a write, by construction.** `owner/:ownerId/people` is both an allowlisted
GET and a blocked POST, which only reconciles because the allowlist is method-gated. In
`auth.service.ts` the preview branch requires **all** of: `demo.enabled`, the caller's email equals
`demo.email`, `metadata.method === 'GET'`, no API key, and no shared link — before the regex is even
tested. A same-path POST never reaches `isDemoAdminPreviewReadRoute`, and `DemoInterceptor` refuses it
independently. Two layers, either sufficient.

**Thumbnail route — deliberate departure.** The maintenance-console entries are anchored specifically to
keep file-serving sub-routes (`/database-backups/:filename`, `/integrity/report/:id/file`) closed to the
demo user. `faces/:assetFaceId/thumbnail` _is_ a file-serving route, and we are opening it anyway: it
returns a face crop of a demo photo that is already publicly visible on the demo instance, and without it
the console renders as grey placeholders. This exception is intentional and must not be "fixed" by a
later anchoring pass.

### 2. Web — strip the mutating controls

Gate on `authManager.isReadOnlyDemo`, matching the existing consoles, and render `<ReadOnlyDemoNotice />`
on each page:

| File                                                    | Hide when `isReadOnlyDemo`                      |
| ------------------------------------------------------- | ----------------------------------------------- |
| `routes/admin/face-cleanup/+page.svelte`                | notice only (its buttons are `href` navigation) |
| `routes/admin/face-cleanup/scan/+page.svelte`           | **Rescan**, **Advanced**                        |
| `routes/admin/face-cleanup/scan/ConfidentLane.svelte`   | per-item accept / decline                       |
| `routes/admin/face-cleanup/scan/ReviewFirstLane.svelte` | per-item accept / decline                       |
| `routes/admin/face-cleanup/resolutions/+page.svelte`    | **Undo**                                        |
| `routes/admin/face-cleanup/[personId]/+page.svelte`     | resolve / destination-apply action              |
| `routes/admin/face-cleanup/people/+page.svelte`         | notice only (read-only already)                 |

Retry and "load more" controls stay — they are reads.

`canPreviewAdmin` is **not** used for control-hiding: it opens the door (routing, nav), while
`isReadOnlyDemo` strips controls once inside. Using the former would hide these buttons from real admins.

### 3. Data — one real scan, enqueued through Redis

`DemoInterceptor` keys off `demo.enabled` with **no user check**, so even the real admin cannot
`POST /api/admin/face-repair/scan` while demo mode is on. Rather than flip `IMMICH_DEMO_MODE` (which
would open the public instance to writes for the duration), the scan is enqueued directly:

1. `INSERT INTO face_repair_scan (status, "requestedBy", params) VALUES ('pending', <admin-id>, <params>)`
   — mirrors `FaceRepairService.triggerScan`. A partial unique index
   (`face_repair_scan_in_flight_uq`) already prevents a second pending/running scan.
2. Add a BullMQ job from inside the server pod:

   ```js
   const { Queue } = require('/usr/src/app/server/node_modules/bullmq');
   new Queue('backgroundTask', {
     prefix: 'immich_bull',
     connection: { host: 'gallery-redis', port: 6379, password: process.env.REDIS_PASSWORD },
   }).add('FaceRepairScan', { scanId });
   ```

   The absolute `require` path matters: a script in `/tmp` resolves modules from `/tmp`, not cwd.

Demo runs a single `gallery-server` pod hosting all worker types, so the job is picked up in-process.

**Verified 2026-08-12.** The scan completed in ~1.2 s over 895 eligible faces.

**Scan parameters.** At shipped defaults (`maxDistance` 0.5, `minFaces` 3, `voteMargin` 2) demo yields
exactly 1 flagged face — an empty-looking console. The seeded scan therefore uses a more sensitive
threshold:

| Param                    | Default | Demo |
| ------------------------ | ------- | ---- |
| `maxDistance`            | 0.5     | 0.7  |
| `minFaces`               | 3       | 2    |
| `voteMargin`             | 2       | 1    |
| `maxAttributionDistance` | 0.35    | 0.5  |
| `maxFlaggedFraction`     | 0.5     | 0.8  |
| `voteWindow`             | 200     | 200  |
| `largeClusterThreshold`  | 50      | 50   |

Yield: **41 flagged faces / 28 affected people / 8 to repair / 24 review-only people (all `overCap`)**.
Both lanes populate, and the review-only group demonstrates the `maxFlaggedFraction` safety cap rather
than rendering an empty state. The findings are genuine; only the sensitivity is tuned. This is a
demo-data choice, not a product default change — `server/src/config.ts` is untouched.

A scan only _finds_; repair happens on resolve, which stays blocked. Re-scanning is therefore
non-destructive and fully reversible (`DELETE FROM face_repair_scan WHERE id = …` cascades to
`face_repair_scan_flagged_face`).

## Testing

- `server/src/services/auth.service.demo.spec.ts` — one case per new allowlist regex asserting the demo
  user may GET it, plus a negative case asserting `POST /api/admin/face-repair/scan` is still refused.
  The negative case is the important one: it is what fails if someone later widens a regex to a prefix.
- `web/src/routes/admin/face-cleanup/**/page.demo.spec.ts` — one spec per gated page, modelled on
  `routes/admin/storage-migration/page.demo.spec.ts`, asserting each listed control is absent when
  `isReadOnlyDemo` is true and present when false.
- Existing face-cleanup specs must stay green: they run with `isReadOnlyDemo` false and assert the full
  control set.

## Rollout

1. Implement, run the demo-touched server + web suites, prettier.
2. Build `demo-v5.4.0-2` via `gallery-rc-build` (`ref=demo`, `fork_version=5.4.0`).
3. Pin with `./scripts/deploy-demo.sh --rollback v5.4.0-2`.
4. Post-deploy: confirm the surviving pod holds advisory lock 42.

Wait ~30 min after the 19:09 UTC `demo-v5.4.0-1` rollout before deploying, so the pod-overlap window
does not cost the backup cron its lock.

## Risks

- **Allowlist over-reach.** A regex written as a prefix instead of an anchored match would expose the
  write half of the controller. Every entry is `^…$`-anchored and the negative test guards it.
- **Findings look tuned.** Mitigated by treating this as demo seed data and documenting the parameters
  here; product defaults are unchanged.
- **A later default-parameter rescan flattens the demo.** Anyone triggering a scan from the UI at
  defaults replaces `scan/latest` with a 1-finding result. Re-run the seeded scan to restore.
