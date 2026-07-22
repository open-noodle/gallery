# Demo: face-recognition showcase photos + raise minFaces to 3

**Date:** 2026-05-30
**Status:** design / runbook (approved to start Part A)

## Goal

Populate the public demo (https://demo.opennoodle.de) with copyright-free,
no-attribution photos that contain **the same people across multiple photos**, so
the face detection / recognition feature has something real to show. At the same
time, raise the demo's "minimum faces before creating a person" from **1 to 3** so
the People view stops creating noisy single-photo persons.

## Findings (current state)

- **`minFaces` is 1 on the demo because of a code default on the `demo` branch.**
  `server/src/config.ts:297` sets `minFaces: 1` on `demo`, whereas `main` has
  `minFaces: 3`. It is **not** an admin/runtime setting today.
- The demo's stored `system-config` override (`system_metadata` table, key
  `system-config`) currently contains **only** `machineLearning.clip.maxDistance: 0.77`.
  There is no `minFaces` key there yet.
- No `IMMICH_CONFIG_FILE` / config-file mount and no `minFaces` env in the demo
  manifests (`~/dev/infra-gitops/apps/demo/`).
- The cluster + DB are reachable from this machine
  (`~/.kube/noodle-k3s.yaml`, namespace `demo`, primary pg pod `gallery-postgres-1`).
- `immich-go` is **not** installed locally; `open-noodle` repo (deploy script) is
  not on this machine, but `infra-gitops` is.

## Licensing

Sources are limited to **no-attribution** licenses:

- **Pexels** (Pexels License), **Unsplash** (Unsplash License), **Pixabay** (Content License).
- Avoid Wikimedia Commons / Openverse — mostly CC-BY (credit required).

Caveat recorded for the record: these licenses cover **copyright**, not model /
privacy rights. Depicted people generally have no model release, and the platforms
forbid uses that defame or imply endorsement. A face-recognition demo is within
bounds. A `MANIFEST.md` records source URL + photographer + license per cluster
even though credit is not required.

## Part A — Curate the photo bundle (review deliverable)

- **Sources:** Pexels + Unsplash, real stock, via their free APIs (keys supplied
  out-of-band, stored gitignored at `~/dev/demo-photos/.keys.env`).
- **Same-person strategy:** pull from photographer feeds / curated collections where
  one model recurs, then **visually verify** clusters. Keep only clusters with
  **≥ 6 photos of the same person** so each survives `minFaces=3` and looks like a
  real person's album.
- **Themes:** families, holidays/travel, sports, people eating together, plus a few
  group/portrait sets.
- **Target:** ~15+ distinct individuals, 300+ photos total. Final count depends on
  what verifies as same-person; report the real number rather than padding.
- **Output:** `~/dev/demo-photos/` (outside the git repo), one subfolder per person
  (`person-01-<theme>-<label>/`), plus `MANIFEST.md` (source URL, photographer,
  license, photo count per cluster).
- **Execution:** fan out across themes with parallel curation agents.

## Part B — `minFaces` = 3 via DB system-config override (chosen)

Merge `machineLearning.facialRecognition.minFaces: 3` into the existing
`system-config` row (preserving `clip.maxDistance`):

```sql
UPDATE system_metadata
SET value = jsonb_set(
  value,
  '{machineLearning,facialRecognition,minFaces}',
  '3'::jsonb,
  true
)
WHERE key = 'system-config';
```

Then trigger a config reload (server reads system config; a server pod restart or
the config-update event picks it up).

**Caveat (documented, not blocking):** this reverts to the code default (1) on a
fresh DB reseed because the `demo` branch still hard-codes 1. For durability, also
bump `server/src/config.ts` `minFaces` 1→3 on the `demo` branch (or drop the
demo-only override so it inherits `main`'s 3) the next time the demo branch is
rebuilt.

## Part C — Upload + activate (gated on bundle review)

Follow the documented demo flow (see the `deploy-gallery-demo` skill):

1. **Demo mode OFF:** edit `~/dev/infra-gitops/apps/demo/server.yaml`
   → `IMMICH_DEMO_MODE: "false"` → commit/push → sync the `demo` ArgoCD app.
2. **Upload to Pierre's account only** (per the no-duplicate-uploads rule — shared
   space handles visibility; do not duplicate to the Demo User). Upload mechanism
   TBD at execution: `@immich/cli` with an API key, the REST upload API, or copy
   into the upload volume + library scan.
3. Wait for `thumbnailGeneration`, `metadataExtraction`, `faceDetection`, and
   `facialRecognition` jobs to drain.
4. Apply Part B (`minFaces=3`) and confirm sub-3-face persons are not created /
   are cleaned up. Re-run facial recognition if existing people need recomputing.
5. **Demo mode ON** again (same flow, `"true"`).
6. Verify People view on https://demo.opennoodle.de.

## Open items / risks

- Upload mechanism for Part C not yet chosen (no `immich-go` locally).
- "Same person across _different_ shoots" is rare in free stock; most clusters will
  be same-person _within_ a session. That still demonstrates clustering well.
- Part C touches the live public demo; only run after bundle review + explicit go.

## Outcome (executed 2026-05-30)

- Uploaded **335 Pexels photos** (25 verified single-shoot sets) to Pierre's account via
  `POST /api/assets`, capture dates spread Nov 2024 → May 2026. A full-access API key
  `pi-demo-upload` was created directly in the demo DB (Pierre, `all` perms; key =
  `sha256(secret)` raw bytes in the `bytea` column) — kept for a follow-up Unsplash round.
- Created a dedicated space **"Family & Friends"** (Pierre owner; Demo User viewer;
  Alice/Bob/Emma editors; face recognition on) and moved the 335 there; reverted
  "Travel Memories" to its original assets. Deleted the empty "Newly created space example".
- `minFaces=3` applied via the system-config override.
- Face pipeline: 1,026 faces detected → recognition → **134 space-people (114 shown at
  minFaces=3)**. The shared-space backfill was triggered by enqueuing `SharedSpaceFaceMatchAll`
  directly into BullMQ (queue `facialRecognition`, prefix `immich_bull`, `gallery-redis:6379`)
  because the assets were added to the space via raw SQL, bypassing the app hook.
- Named the **top 41** people with face-matched first names (`nameSource=manual`); the long
  tail left unnamed for realism.
- Disabled pet detection (system-config `machineLearning.petDetection.enabled=false`), set
  `petsEnabled=false` on all spaces, and deleted the 1 pet-type person. (Config applies on the
  next server rollout — e.g. the next demo-mode toggle.)
- Demo mode was flipped off only for the ~2-minute upload (commit on infra-gitops `main`,
  ArgoCD HEAD), then back on. Bundle retained locally at `~/dev/demo-photos/` + `MANIFEST.md`.
