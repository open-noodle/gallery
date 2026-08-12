# Asset Viewer Contextual Filters — Slice 8 (e2e) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** prove the feature end-to-end, in a real browser against a real server. Everything below already passes at the unit/component level; this slice is the proof it works when wired to Postgres.

**Spec:** `docs/superpowers/specs/2026-07-12-asset-viewer-contextual-filters-design.md` §9 Slice 8; coverage rows **E5**, **E10**, **E17**.

## Already covered by Slice 7's e2e — do NOT duplicate

`e2e/src/specs/web/asset-viewer/contextual-filters.e2e-spec.ts` already has:

1. clicking the camera inside a **Space** filters the Space, closes the viewer, leaves a removable chip;
2. the 🔍 icon escapes to `/photos` instead of filtering the Space;
3. a **person** inside a Space filters by the **bare** space-person id and the timeline does not error (the R8 400 guard).

## What Slice 8 owes

| #   | Scenario                                                                                                                                                          | Why it matters                                                                                                                                                   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | Camera click filters an **album** and **`/photos`** (the two surfaces slice 7's e2e didn't cover). **E5:** on `/photos` there is **no 🔍** (it would be a no-op). | The grammar must work on every surface, not just a Space.                                                                                                        |
| S2  | The location **🗺️ pin** on an asset inside a Space opens `/map` **carrying the `spaceId`** (**E10**).                                                             | The pin is the one affordance that changes surface.                                                                                                              |
| S3  | **A filtered Space carries its filter to the map (#767).** Filter a Space to `make=Apple`, click the map icon → the map is filtered to `make=Apple`.              | **This is the original bug report.** It is the whole reason slices 3–5 exist.                                                                                    |
| S4  | **RBAC (E17) — MUST NOT BE CUT.** A Space **VIEWER** opens **another member's** asset, clicks its camera value, and sees **that member's** matching assets.       | The end-to-end proof of §4.4: a non-owner can filter assets they do not own. Every layer below this is already tested; this is the one that proves they compose. |

The spec is explicit: _"The RBAC scenario is the end-to-end proof of §4.4 and **must not be dropped for time**."_

## Global Constraints

- **Playwright runs against the `make e2e` stack on :2285**, not the dev :2283 stack.
- ⚠️ **`mise e2e` is interactive** (compose up in the foreground; `e2e-down` as `depends_post`) — **backgrounding it tears the stack straight back down.** Start it detached yourself:
  `cd e2e && COMPOSE_BAKE=true docker compose -f ./docker-compose.yml up -d --remove-orphans`, poll `curl :2285/api/server/ping`, run, then `docker compose -f ./docker-compose.yml down`.
- ⚠️ **The e2e server image BUNDLES the web build.** A stale image silently tests the old UI. **Rebuild it, and verify freshness** by grepping the served bundle inside the container for a branch-only i18n key (e.g. `Filter by this camera`) **before trusting a pass**.
- ⚠️ `immich-e2e-server` cannot be restarted after a run (`resetDatabase` wipes `system_metadata`'s `MediaLocation` → `InconsistentMediaLocation` → exit 1). Use a full `down` + `up --build`; `--renew-anon-volumes` if a stale volume bites.
- **Fixtures:** `thompson-springs.jpg` = GPS + `lensModel`; `prairie_falcon.jpg` = full Canon EXIF, **no GPS**. A **map/pin** test needs GPS; a **camera** test needs make/model. Pick accordingly — a test that filters on an EXIF field the fixture lacks passes vacuously.
- Known pre-existing e2e flake, do not chase: `shared-space.e2e-spec.ts > should exclude videos from recentAssetIds` (fixed on this branch, but if it reappears it is not yours).
- e2e package: `pnpm check` + `pnpm lint` must be clean.
- No `Co-Authored-By` / `Generated-with` trailers.

---

### Task 1 — S1 + S2 + S3 (the grammar on every surface, and #767)

- [ ] **S1:** extend `contextual-filters.e2e-spec.ts`. Album surface: open an asset inside an album, click the camera → the album grid is filtered, a camera chip renders, the viewer closed. `/photos`: same, **and assert the 🔍 is absent** (E5).
- [ ] **S2:** an asset **with GPS** inside a Space → click the 🗺️ pin → lands on `/map` with `spaceId=` in the URL (E10).
- [ ] **S3 (#767 — the original bug):** filter a Space to a camera make, click the map icon, assert the **map** carries `make=` too. Prove it **narrows**: seed two GPS assets in the Space with **different** makes and assert only the matching one's marker is present. A test that only checks the URL would pass even if the map ignored the filter — which is precisely the bug.
- [ ] Run locally; commit.

### Task 2 — S4: the RBAC scenario (E17)

- [ ] Build a **two-owner Space**: owner A uploads a GPS/EXIF asset; user B is added as a **Viewer**; B owns nothing in the Space.
- [ ] As **B**, open **A's** asset in the Space, click its **camera** value.
- [ ] Assert: the Space timeline is filtered, and **A's matching asset is visible to B**. Seed a **second** asset of A's with a **different** camera and assert it is **excluded** — otherwise "filtered" is unproven and the test passes even if the filter did nothing.
- [ ] Also assert B sees **no owner-only affordance** on A's asset (no location pencil / no date pencil), so the value stays clickable for a non-owner while editing stays gated.
- [ ] Run locally; commit.

## Done When

- [ ] All four scenarios pass **locally** against a **freshness-verified** :2285 stack.
- [ ] The RBAC scenario proves a **Viewer** can filter by a **camera they do not own** and gets **that owner's** assets — with a negative control proving the filter actually narrowed.
- [ ] #767's exact repro (a filtered Space → the map) is green.
- [ ] `e2e` typecheck + lint clean; CI green.
