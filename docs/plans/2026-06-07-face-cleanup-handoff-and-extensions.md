# Face Cleanup — session handoff & extension prompt

**Purpose:** paste this into a fresh Claude Code session (or point it here: _"read
`docs/plans/2026-06-07-face-cleanup-handoff-and-extensions.md` and continue"_) to pick up
PR #664 and build extensions. Reflects the **shipped** state as of 2026-06-07 — it supersedes
the mid-execution resume note in `2026-06-06-face-cleanup-advanced-scan-HANDOFF.md` (that one is
now stale: it predates the push, the rebase, and the styling work).

---

## 0. Orient yourself first

- **Worktree:** `/Users/pierre/dev/gallery/.claude/worktrees/face-cleanup-console`
  ⚠️ **Worktree trap:** plain `git` from `.claire/…` resolves to the **main** repo. Always
  `cd` into the `.claude/…` path above and confirm `git branch --show-current` ==
  `feat/face-cleanup-console`.
- **Branch / PR:** `feat/face-cleanup-console` → **PR #664** (`feat: Face Cleanup admin console`).
- **State at handoff:** HEAD `1a1f79c0c7`, **86 commits ahead of `main`**, **rebased onto latest
  `origin/main`**, **CI green**, **+14.9k/−145 across ~92 files**.
- **Live test instance:** personal clone `personal-test-feat-face-cleanup-console`, currently on
  image `…-rc10`, at **http://pierre-gallery-test-feat-face-cleanup-console.taild637f7.ts.net**
  (Admin → Face Cleanup; same login as personal; real photo library, S3 read-only).
- `export PATH="$HOME/.local/share/mise/shims:$PATH"` before any node/pnpm shell command
  (background bash is non-login). Pipes mask exit codes — read the tool's own summary line.

---

## 1. What the feature is (the why)

The automatic re-attribution repair (#652) **diagnoses** contaminated face clusters
(impostor faces wrongly attributed to a person after the misattribution event) but deliberately
**won't auto-fix** the ambiguous / over-cap ones (Hagen: ~10,486 faces / 627 people). Face Cleanup
is the **admin console to resolve those by hand**, safely.

Core operation = **per-person re-attribution override**: re-home a person's impostor faces to their
true owners, **keeping** that person's real faces, name, and thumbnail. It is **NOT** a person-merge
and **never empties a cluster**. That invariant is load-bearing — preserve it in any extension.

Three layers shipped:

1. **Console (triage + review)** — scan finds flagged people, classifies them confident vs
   review-first, admin bulk-approves or opens a person to review face-by-face, then applies.
2. **Advanced scan (tuning)** — a modal to tune 3 knobs for a **single** scan run
   (per-scan transient, no persistence; engine unchanged).
3. **Decline** — mark a person's suggestion as declined so it doesn't reappear in future scans
   (`/admin/face-cleanup/declined` lists them; can be undone).

---

## 2. Architecture map

### Server (NestJS / Kysely, all under `immich` package)

| File                                                                | Role                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/controllers/face-repair-admin.controller.ts`                   | Routes under `@Controller('admin/face-repair')` → `/api/admin/face-repair/*`                                                                                                                                                                       |
| `src/services/face-repair.service.ts`                               | Orchestration: `triggerScan(by, overrides?)`, `handleFaceRepairScan` (`@OnJob FaceRepairScan`, `BackgroundTask` queue), `getScanDefaults()`, apply, decline. Defaults: `DEFAULT_MAX_ATTRIBUTION_DISTANCE=0.35`, `DEFAULT_MAX_FLAGGED_FRACTION=0.5` |
| `src/services/face-repair.summary.ts`                               | Scan totals / enrichment                                                                                                                                                                                                                           |
| `src/utils/face-repair.ts`                                          | **Pure** `classifyFlaggedPerson(person, ctx)` → confident vs review-first (named / large-cluster / multiple-owners / bad-target). Engine math lives here — unit-tested in isolation                                                                |
| `src/repositories/face-repair.repository.ts`                        | The repair engine queries (plan build, attribution, apply)                                                                                                                                                                                         |
| `src/repositories/face-repair-scan.repository.ts`                   | `face_repair_scan` lifecycle, single-flight guard, retention, enrichment                                                                                                                                                                           |
| `src/repositories/face-repair-decline.repository.ts`                | Declined-suggestion persistence                                                                                                                                                                                                                    |
| `src/schema/tables/face-repair-scan.table.ts`, `…-decline.table.ts` | Kysely table defs (migrations are in `migrations-gallery/`)                                                                                                                                                                                        |
| `src/dtos/face-repair.dto.ts`                                       | DTOs. **`FaceRepairScanParams = z.infer<…>`** is the single source of truth for the tuning params (`maxDistance`, `minFaces` int, `maxFlaggedFraction`)                                                                                            |

**HTTP surface** (`/api/admin/face-repair`): `POST /scan` (optional `{ params }` body),
`GET /scan/latest`, `GET /scan/defaults`, `GET /scan/person/:personId`, `POST /apply`
(`approvedPersonIds` + `excludeFaceIds`), `POST /decline`, `GET /decline`. Apply refuses while
facial recognition is active or a scan is running (idempotent, scoped).

### Web (SvelteKit / Svelte 5 runes / `@immich/ui`, Immich theme)

| File                                                                             | Role                                                                                          |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `web/src/routes/admin/face-cleanup/+page.svelte`                                 | List/triage page: scan + poll, header action toolbar, stat cards, grouped table, bulk approve |
| `web/src/routes/admin/face-cleanup/face-cleanup.svelte.ts`                       | Page view-model (runes class) — scan polling, selection, totals                               |
| `web/src/routes/admin/face-cleanup/FaceCleanupTable.svelte`                      | Grouped table (review-first pinned, confident auto-selected)                                  |
| `web/src/routes/admin/face-cleanup/AdvancedScanModal.svelte`                     | The 3-knob tuning modal (pre-fills from `/scan/defaults`)                                     |
| `web/src/routes/admin/face-cleanup/[personId]/+page.svelte` + `review.svelte.ts` | Per-person review: decision strip + faces-leaving crop grid + per-face deselect               |
| `web/src/routes/admin/face-cleanup/declined/+page.svelte`                        | Declined suggestions list                                                                     |
| i18n keys: `i18n/en.json` → `admin.face_cleanup_*`                               |

Data flow: page VM calls SDK (`triggerScan`, `getLatestScan`, `getFaceRepairScanPerson`,
`applyFaceRepair`, …) → polls scan status → renders. SDK is generated; see §4.

---

## 3. Design decisions & invariants (don't break these)

- **Re-attribution, not merge. Never empties a cluster.** Keeps real faces + name + thumbnail.
- **Advanced-scan params are per-run transient** — sent in the trigger body, stored on the scan row,
  never written back as defaults. Re-opening the modal always reloads server defaults.
- **Engine is untouched by the UI/Advanced layers** — tuning only forwards existing params
  (`maxDistance`/`minFaces`/`maxFlaggedFraction`) into the existing scan. New behaviour belongs in
  `face-repair.repository.ts` / `utils/face-repair.ts`, gated behind a param + a medium test.
- **`unAttributable` faces are an intentional no-op** (no clean owner → left as-is).
- **Apply is gated** while recognition/scan run, and is idempotent.

---

## 4. Build / test / ship loop

**Local checks (run BEFORE pushing — CI is the real gate but catch what you can):**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
# server
make check-server && make lint-server          # tsc + eslint; prettier is SEPARATE: pnpm -C server exec prettier --write <files>
pnpm -C server test -- --run                    # unit (medium/real-DB tests are CI-only — need Docker)
# web
pnpm -C web exec eslint --max-warnings 0 <changed.svelte>   # Lint Web is a separate eslint gate
pnpm -C web exec vitest --run <changed.spec.ts>
# OpenAPI/SDK when DTOs change (see gotchas):
cd server && pnpm build && pnpm sync:open-api && cd .. && make open-api   # regenerates TS + Dart
```

**Ship an RC to the clone so the user can test on real data** (see skills `rc-personal` /
`clone-personal`; the clone already exists, so just rebuild + repoint):

```bash
gh --repo open-noodle/gallery workflow run gallery-rc-build.yml \
  --ref feat/face-cleanup-console -f rc_tag=feat-face-cleanup-console-rcN
gh --repo open-noodle/gallery run watch <run-id> --exit-status     # ~7–16 min
export KUBECONFIG=~/.kube/noodle-k3s.yaml
kubectl -n personal-test-feat-face-cleanup-console set image \
  deploy/gallery-server server=ghcr.io/open-noodle/gallery-server:feat-face-cleanup-console-rcN
kubectl -n personal-test-feat-face-cleanup-console rollout status deploy/gallery-server
# verify: curl …/api/server/ping → {"res":"pong"}; …/api/admin/face-repair/scan/defaults → 401 (wired)
```

In-place `set image` is safe **iff** the change adds no migration (rc7→rc10 added none). If you add a
migration, the clone DB (recovered from personal's main-based backup) forward-applies it; check
`migrations-gallery/` and watch startup logs. RC tags so far: rc7 = decline-only, rc9 = +advanced
scan (rebased), **rc10 = +styling**. Next is rc11.

**Babysit CI** with the `babysit` skill (PR #664). Known transient: `mise install --cd plugins`
GitHub-403 and DockerHub `registry-1.docker.io … context deadline exceeded` in Docker builds →
just re-run the failed jobs (`gh run rerun <id> --failed`), not a code issue.

---

## 5. Environment gotchas (carry forward)

- **Medium tests need Docker** (unavailable locally) → CI-gated. Locally rely on `make check-server`
  (tsc covers `test/`) + `make lint-server`.
- **`make check-web` / svelte-check is NOT a CI job for web**, and vitest doesn't typecheck. There is
  pre-existing repo-wide svelte-check noise (~100 errors across ~56 files, incl. these `*.spec.ts`:
  `PageData` now requires an `error` field after a `main` change). Not from this feature, not gated —
  but if you touch a spec's mock `PageData`, add `error: undefined`. When editing, verify _your_ file
  is clean: `pnpm -C web exec svelte-check … | grep <yourfile>` → empty.
- **SDK `triggerScan` body is REQUIRED** (`@Body()` → required requestBody). Web must call
  `triggerScan({ faceRepairScanTriggerRequestDto: params ? { params } : {} })` — never `undefined`.
- **OpenAPI regen must do Dart too** — `make open-api-typescript` leaves Dart stale; the
  "OpenAPI Clients" CI job runs the full generator + `git diff`. Run `make open-api`.
- **oazapfts anonymous-enum renumbering**: adding inline `z.enum` fields named `type` renumbers
  `Type`/`Type2` in the SDK. Scan params are all numbers so it isn't triggered today — re-check on any
  future DTO change that adds an enum.
- **`@immich/ui` `Field` does not surface its `label`** for raw `<input>` children (it pairs with
  `@immich/ui` `Input`/`Switch`). The modal now uses explicit heading+value+help blocks instead.
- **`@immich/ui` `Button`** supports `href` (renders an anchor), `variant` (`ghost`/`outline`/
  `filled`), `size` (`small` is the admin-toolbar norm), `color`, `shape`.
- **Server `BaseService.create`** is a hand-ordered positional repo list — if you add a repo to the
  service ctor, also add it there (a misorder silently breaks plugin-host medium tests).

---

## 6. Possible extensions (pick up here)

**Deferred in the original PR (lowest-friction next steps):**

- **List sort-by-contamination-fraction** on the console (filters exist; sort doesn't).
- **Full flagged-flow e2e** — the e2e stack is ML-disabled so it can't produce flagged persons;
  currently covered by component + medium tests. Would need a seeded fixture or an ML stub.

**Natural feature extensions:**

- **Persisted scan presets** — let an admin save a tuned param set as a named preset (today they're
  per-run transient). New table + `GET/POST /scan/presets`; keep run-time params overriding presets.
- **Before/after preview in the Advanced modal** — show how many people/faces a tuned scan _would_
  flag vs the default, without running the full repair (a dry-run count endpoint).
- **Scan history / audit** — `face_repair_scan` rows already persist; expose a history view
  (who ran, params, totals, outcomes) and an apply audit log.
- **Per-owner review filters** — filter the triage table by suspected owner; batch by owner.
- **Undo apply** — a reversible apply (mirror the decline/undo pattern) within a retention window.
- **Surface `unAttributable` people** — today a no-op; could offer "create new person from these
  faces" or "send to manual tagging".
- **Tune `minFaces` lower bound UX** — the number input could be a stepper with guidance on cost.

**When extending the engine** (not just UI): add the knob to `FaceRepairScanParams` (the `z.infer`
DTO), thread it through `triggerScan` → stored params → `handleFaceRepairScan` →
`face-repair.repository.ts` / `classifyFlaggedPerson`, add a **medium test** that proves the param
changes the engine's output (the Task-3 pattern: pick a fixture where the count straddles the
default vs tuned threshold so the test fails if the param is ignored), regen OpenAPI + SDKs, then
wire the modal.

---

## 7. Reference docs

- Console design + Immich-styled mockups: `docs/plans/2026-06-03-face-cleanup-console-design.md`
- Console build slices (TDD): `docs/plans/2026-06-03-face-cleanup-console-slice-{1..7}.md`
- Advanced scan: `docs/plans/2026-06-06-face-cleanup-advanced-scan-{design,plan}.md`
- Upstream root cause: `docs/plans/2026-05-30-hagen-face-cluster-corruption-diagnosis.md`,
  `docs/plans/2026-05-31-face-reattribution-repair-*` (the #652 engine this stacks on)
- Stale (historical) resume note: `docs/plans/2026-06-06-face-cleanup-advanced-scan-HANDOFF.md`
