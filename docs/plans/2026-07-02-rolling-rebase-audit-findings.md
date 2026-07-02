# Rolling Rebase Audit — Findings & Handoff

**Date:** 2026-07-02
**Auditor:** Claude Code multi-agent swarm (36 agents: 15 domain finders → adversarial verification → completeness critic)
**Target branch:** `rebase/upstream-rolling-20260509-active`
**Tip audited:** `1647dca650` (batch 306); re-verified against live tip `8e57d08adc` (batch 307)
**Upstream base:** `237734bb26` (`feat(web): recently added link in sidebar (#29039)`) — ~641 upstream commits newer than the old v2.7.5 base
**Fork commits on top:** 850
**Known-good baseline for comparison:** `main` (Immich v2.7.5 base, fork lineage)
**Feature checklist used:** `docs/fork/ownership.yml`

## Method

Fanned out 15 read-only domain auditors over the rolling worktree, each comparing rolling against both the upstream base (`237734bb26`) and known-good fork `main`. CI is fully green on this branch, so the swarm deliberately ignored compile/test failures and hunted only for what CI cannot catch: fork logic silently dropped in conflict resolution, upstream refactors that bypass fork gates, half-applied renames, and new upstream features that ignore fork constraints. Every non-low finding was then attacked by 1–2 independent adversarial refuters; only findings that survived are listed as confirmed. A completeness critic cross-checked coverage against the feature manifest.

**Result:** 16 confirmed findings, **0 refuted**, 24 low-severity/hygiene, plus documented coverage gaps.

## Bottom line

The rebase is **structurally sound**. No conflict markers, no leftover `.orig`/`.rej` files, no duplicated code from bad merges, migrations interleave cleanly, and the mobile router/provider/i18n graph is intact. The real risks are _upstream-integration gaps_ — new upstream code (v3 search-visibility model, realtime HLS transcoding, per-user face threshold, a renamed Android nav shell) that does not yet route through fork constraints. One is a genuine privacy hole (H1).

---

## ⚠️ Process issue — resolve before the next force-push

**Local and origin rolling stacks are fully divergent (853 local-ahead / 851 origin-ahead), and fork commit #739 exists only on origin.**

- `origin/rebase/upstream-rolling-20260509-active` tip is `417b951d2b` — _"fix(mobile): populate the filter/search facets for a shared-space viewer (#727 family) (#739)"_ (11 files, +220 −35).
- The **local** batch-307 stack does **not** contain #739 (verified: `git log --oneline …-active | grep -c '(#739)'` = 0 local, 1 origin).
- Local instead carries batch 307 (`#29039` test fixtures + docs report) that origin lacks.

**Action:** whoever reconciles these must cherry-pick `417b951d2b` before force-pushing, or the shipped #739 mobile facets fix is silently lost. This is a rebase-workflow artifact, not a code bug.

---

## 🔴 HIGH

### H1 — `/search/random` leaks locked, archived & hidden assets to non-elevated sessions

- **File:** `server/src/services/search.service.ts:212` (in `searchRandom`)
- **Kind:** upstream-integration-gap · **Corroborated by 3 finders**, 2/2 refuters confirmed, not present on `main`
- **Status:** FIXED (slice S1)

Upstream v3 (#29385, `b4cc406a3f`) removed `searchAssetBuilder`'s implicit `visibility = Timeline` default (now `.$if(!!options.visibility, …)` in `server/src/utils/database.ts:648-652`) and compensated by having each search endpoint pass:

```ts
visibility: dto.visibility ?? (auth.session?.hasElevatedPermission ? undefined : 'not-locked');
```

Every sibling endpoint received this fallback (`search.service.ts` lines 156, 187, 238, 491) — **`searchRandom` did not.** It calls:

```ts
const items = await this.searchRepository.searchRandom(dto.size || 250, { ...resolvedDto, userIds });
```

with `visibility` unset, and `searchRandom` in `search.repository.ts` adds no visibility clause.

**Impact:** `POST /api/search/random` (guarded only by `@Authenticated`/`AssetRead`) with the `visibility` field omitted returns **Locked (PIN-protected folder), Archived, and Hidden** assets belonging to the caller _and their timeline partners_ (`getUserIdsToSearch` includes partner IDs), and to other **shared-space members** via the fork's space scoping. `requireElevatedPermission` only fires when `visibility=Locked` is _explicitly_ requested, so omitting the field bypasses the PIN gate. On `main`, `searchAssetBuilder` coerced unset visibility to `AssetVisibility.Timeline`, so the endpoint could only ever return Timeline assets. The hole exists in current upstream Immich too (upstream oversight), but the fork rewrote this exact call-site during the rebase and preserved it while adapting every neighbor. No first-party web/mobile caller today; live public API/SDK surface.

**Fix:** add the same fallback used by the sibling endpoints to the `searchRandom` options (or default to `AssetVisibility.Timeline`).

### H2 — Android view-intent replaces the nav stack with the upstream legacy `TabShellRoute`

- **File:** `mobile/lib/providers/view_intent/view_intent_handler_android.dart:100`
- **Kind:** upstream-integration-gap (rename miss) · 2/2 refuters confirmed, not on `main`
- **Status:** OPEN

When Android opens a photo via a view-intent (share-to / "open with"), the handler pushes the upstream **`TabShellRoute`** instead of the fork's **`GalleryTabShellRoute`** (the fork's 3-tab layout). The fork renamed the shell route during the rebase, but this call-site (and the locked-folder one in M4) kept the upstream name. Users entering through the Android intent land in the wrong/legacy shell.

---

## 🟡 MEDIUM

### M1 — Realtime HLS transcoding bypasses S3 persistence and the fork video-trim edit

- **File:** `server/src/services/transcoding.service.ts:240` · **Corroborated by 3 finders** · **Status:** OPEN

Upstream v3 added an on-the-fly HLS transcoding pipeline that spawns `ffmpeg` directly on `asset.originalPath` (a relative S3 key on S3-primary installs) with **no `ensureLocalFile`/`persistFile`**. Two fork consequences: (a) on S3 storage the ffmpeg invocation receives a key, not a readable local path → fails; (b) it streams the _original_, ignoring the fork's trimmed-video edit. Same bug shape as tracked gh#671 (video trim on S3), in a new upstream code path.

### M2 — New per-user "People face threshold" preference is a no-op on the fork's People surfaces

- **File:** `server/src/services/person.service.ts:101–124` · **Corroborated by 4 finders** · **Status:** OPEN

Upstream v3 added a per-user `people.minimumFaces` preference. The fork's default People paths (the `withSharedSpaces` variants) and people-stats still read `minFaces` from ML config, so the new setting does nothing on the surfaces users see, and the People-page **count diverges from the list**. Feature-degradation, not security.

### M3 — Space-scoped metadata/smart/statistics search surfaces other members' archived (and, when elevated, locked) assets

- **File:** `server/src/services/search.service.ts:156` · **Status:** FIXED (slice S2)

Same upstream `not-locked`/`undefined` default shift as H1. The sibling endpoints got the fallback, but combined with the fork's shared-space scoping, the "undefined visibility for elevated sessions" default lets space-scoped searches surface other members' **archived** assets (and locked ones for elevated sessions) that the fork previously excluded. Lower impact than H1 (no PIN bypass for non-elevated), same root cause.

### M4 — Locked-folder pause handler navigates to legacy `TabShellRoute`

- **File:** `mobile/lib/presentation/pages/drift_locked_folder.page.dart:46` · **Status:** OPEN

Sibling of H2 — same `GalleryTabShellRoute` rename miss. Likely fixable in the same patch as H2.

### M5 — Live-photo motion-asset hide sweep (#627) not applied to the new v3 `assetV2` sync path

- **File:** `mobile/lib/infrastructure/repositories/sync_stream.repository.dart:246` · **Status:** OPEN

The fork's #627 sweep that hides live-photo motion parts runs on the old sync path but not the new `assetV2` path that v3 servers use — so against a v3 server, motion assets reappear in the mobile timeline.

### M6 — `apply-branding` misses renamed `ServerStatus.svelte`

- **File:** `branding/scripts/apply-branding.sh:158` · **Status:** OPEN

Upstream renamed the file; the branding patch's target string no longer matches, so the sidebar new-release link and repo check ship **unbranded** (leak Immich).

### M7 — Nine new upstream i18n keys containing "Immich" are not covered by branding overrides

- **File:** `branding/i18n/overrides-en.json` · **Status:** OPEN

Visible Immich strings leak in What's New, the admin integrity page, notifications, and feature settings.

### M8 — `branding/config.json` `upstream.version` still `2.7.5` on the v3-based branch

- **File:** `branding/config.json:18` · **Status:** OPEN

GA release notes will claim _"Based on Immich v2.7.5"_ and revert-validation pins v2.7.5.

---

## 🟢 LOW (24 — hygiene / debt)

Notable clusters (full list in the audit run output):

- **Duplicate migration timestamp `1778800000000`** — `migrations-gallery/1778800000000-ReconcileFaceIdentityIndexOverrides.ts` collides with `TrimSpacePersonNameIndex`; silently clobbered by the postbuild copy that merges migration dirs.
- **Mobile `peopleSortBy` preference dropped on upgrade** (`mobile/lib/utils/migration.dart:75`) — legacy `StoreKey` removed with no `StoreKey→SettingsKey` migration.
- **Filter-suggestion sources still pinned to `visibility=Timeline`** (`server/src/repositories/search.repository.ts:1295`) while search/facet defaults moved to `not-locked` — suggestions omit values search now matches.
- **Gallery-branded loading spinner dropped** from `ActivityViewer.svelte` / `DetailPanel`.
- **Stale committed SDK build** at `open-api/typescript-sdk/build-old-root/` (dead directory).
- **`apply-branding` `patch_cli`/`patch_versions`** still target `cli/` and `open-api/typescript-sdk/` (moved to `packages/` in v3); stale iOS debug/profile bundle-id patterns; `ErrorLayout.svelte` moved out from under the branding target (also on main).
- **`gallery-build-mobile.yml` pigeon-regen list** missing the two new v3 inputs (`permission_api.dart`, `view_intent_api.dart`).
- **Fork shared-space sync streams owner's raw `isFavorite`** to all members (`sync.repository.ts:996`) while upstream now masks it for non-owned synced assets.
- **`ownership.yml` `web/src/lib/components/users/**`\*\* owned_path matches no files on either branch (stale manifest entry).
- **CLAUDE.md** still documents the postbuild hook as a plain `cp`, hiding the stale-cleanup + alias behavior.

---

## Coverage gaps NOT fully closed (from the completeness critic)

These areas had no dedicated finder or only shallow coverage — candidates for a focused second-pass audit:

1. **Server-side memories rule engine** (`server/src/services/memory-rules/**`, birthday + recent-trip rules). Spot-check: rules byte-identical to `main`, wiring/config toggles intact — but **memory-generation scheduling on the v3 job graph and mobile parsing of fork memory types via sync were never exercised.**
2. **`tools/upstream-preflight/**`\** (~1,600 lines of drift vs main) — the tooling that *enforces this manifest\* (mobile-drift / ci-invariants checks). Unreviewed; a weakened safety net there degrades future rebase safety invisibly.
3. **New upstream workflows/plugins asset-triggers** — no finder traced a workflow firing on a shared-space or partner asset end-to-end against fork space RBAC, or where plugin artifacts land on S3-primary installs.
4. **New upstream database-backup feature** — checked only for auth guards, not against the fork's dual-backend storage (likely fine — `pg_dump` targets local disk as upstream intends).

Closed by critic spot-check (confirmed intact): `server/src/utils/fetch.ts`, `server/helmet.json`, mobile map paths (`map_marker.provider.dart`, `map.service.dart`), `web/static/gallery-*`, `design/`.

---

## Suggested order of action

1. **H1** — one-line privacy fix (`searchRandom` visibility fallback).
2. **Reconcile local↔origin divergence** so #739 isn't lost on the next force-push.
3. **H2 / M4** — the two `GalleryTabShellRoute` rename misses (likely one patch).
4. **M1** — S3/HLS transcoding persistence + trim-awareness.
5. **M6–M8** — branding batch (fast; these leak Immich into shipped builds).
6. **M2 / M3 / M5** — per-user face threshold, space-scoped visibility, mobile motion-asset sweep.
7. Optional second-pass audit over coverage gaps 1–3.

---

## Reproduction / provenance

- Workflow run ID: `wf_d585237d-b87`
- Raw structured output: `/private/tmp/claude-501/-Users-pierre-dev-gallery/3b4604e3-ceef-4655-9e5d-2b95aee650d9/tasks/w3axvd5ir.output`
- Rolling worktree audited: `/Users/pierre/dev/gallery/.worktrees/rebase-upstream-rolling-20260509-active`

---

# Handoff prompt for a future session

> Copy-paste the block below into a fresh Claude Code session in `/Users/pierre/dev/gallery` to resume this work.

```
Read docs/plans/2026-07-02-rolling-rebase-audit-findings.md — it's the findings report from a
multi-agent audit of our rolling upstream-rebase branch (rebase/upstream-rolling-20260509-active),
a fork of Immich rebased onto upstream v3. Context you need:

- We are the Gallery fork of Immich and rebase onto upstream continuously (~850 fork commits on
  top of upstream base 237734bb26). `main` (Immich v2.7.5 base) is our known-good fork baseline;
  the rolling branch is those same fork commits rebased onto v3. The rolling worktree is at
  .worktrees/rebase-upstream-rolling-20260509-active. Compare rolling against BOTH `main` and the
  upstream base 237734bb26 when reasoning about whether something is a rebase regression.
- The audit found the rebase is structurally sound; the open items are upstream-integration gaps
  where new upstream v3 code doesn't route through fork constraints (RBAC, S3, branding, mobile nav).

I want to fix these, most critical first. Start with H1 (the /search/random visibility leak — a
one-line fallback like the sibling endpoints in server/src/services/search.service.ts). Before
touching code, use the superpowers TDD skill: write a failing server test proving a non-elevated
session gets Locked/Hidden assets from /api/search/random, then fix, then confirm green. After H1,
also resolve the local↔origin divergence (cherry-pick 417b951d2b / #739 so it isn't dropped on the
next force-push) — check with me before any force-push. Then work down the ranked list (H2/M4 the
GalleryTabShellRoute rename misses, M1 the S3/HLS transcoding gap, M6–M8 branding).

For each fix: work in the rolling worktree, keep changes minimal and consistent with how the
sibling code already solves the same problem, run the relevant package's tests/check (server:
`pnpm test` + `pnpm check`, web: `pnpm check`, mobile: scoped `mise exec -- dart analyze` +
`mise exec -- flutter test`), and update the Status line for that finding in the report doc.
Do NOT run the full lint per-fix — defer one lint pass to the end. Do NOT force-push without asking.
```
