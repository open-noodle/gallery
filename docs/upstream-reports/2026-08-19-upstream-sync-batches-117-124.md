# Upstream Sync Report — 2026-08-19 (batches 117–124)

Second cycle of the day, run immediately after arc B of the v3.1.1 cycle closed
([`2026-08-19-upstream-sync-batches-107-116.md`](./2026-08-19-upstream-sync-batches-107-116.md)). These are
the 10 commits that landed on `upstream/main` while arc B was being verified and were deliberately excluded
from it.

## Summary

- **Upstream commits pulled**: 10 (`65b4b9b8fbe..7918ad9f792`), batches 117–124
- **Fork commits pulled**: 0 — `integratedForkHead` still equals `origin/main` (`690fd44e1`, #987), so no
  fork sync was owed and the anchor scan was empty
- **Conflicts resolved**: 7 (i18n ×2, a delete/modify, a docs merge, `Map.svelte` ×3)
- **Risk level**: MEDIUM — one genuine reconciliation (`Map.svelte`), everything else mechanical
- **Recommendation**: PROCEED (rolling branch stays off `main`)
- **Branch state**: 0 behind `upstream/main`, level at `7918ad9f792`

## Incoming Upstream Changes

| Batch | SHA           | Summary                                               | Area       | Risk     | Notes                                           |
| ----- | ------------- | ----------------------------------------------------- | ---------- | -------- | ----------------------------------------------- |
| 117   | `c8c9d703efc` | `chore(deps)`: update github-actions (#30838)         | CI         | LOW      | upstream-owned workflows                        |
| 118   | `93d2d30fe02` | `feat`: rotate an API key (#30801)                    | server+web | LOW      | zero fork divergence in api-key files           |
| 119   | `a5dc877ca2b` | `chore(deps)`: github-actions major (#30845)          | CI         | LOW      | targets a file the fork deleted — see Conflicts |
| 120   | `821c933c512` | `fix(cli)`: enforce node engine version (#30437)      | cli        | LOW      | touches `pnpm-lock.yaml`                        |
| 121   | `14c21f531db` | `fix`: redis cli ping command (#30329)                | docker     | MEDIUM   | fork diverges in compose (valkey via GHCR)      |
| 122   | `5274f8fcb74` | `docs`: oauth identity provider examples (#30828)     | docs       | LOW      | —                                               |
| 122   | `17d4e39af3d` | `fix(server)`: unparsable `DB_URL` in backup (#30759) | server     | LOW      | —                                               |
| 123   | `3c279983bc2` | `fix(server)`: sort stacked assets by date (#24033)   | server     | MEDIUM   | small change into a heavily-forked repository   |
| 124   | `d8e25b8df04` | `fix(web)`: handle map errors without WebGL (#26538)  | web        | **HIGH** | restructures a file carrying the Spaces map     |
| 124   | `7918ad9f792` | `docs`: update backup script (#26810)                 | docs       | LOW      | —                                               |

### Risk was measured, not guessed — and the first measurement was wrong

The initial divergence scan used `git diff upstream/main..HEAD`, which **inflates fork divergence** whenever
the branch is behind: upstream's own new code shows up as "fork delta". That made the API-key surface look
like a MEDIUM collision. Re-measured against the branch's real base (`65b4b9b8fbe..HEAD`), **every api-key
"divergence" was upstream's own new rotation code** and the fork has no competing API-key model at all —
LOW, and it applied without conflict. **Always measure fork divergence against the branch's own upstream
base, never against a moved `upstream/main`.**

### Product-direction gate: did NOT fire

Recorded affirmatively rather than by silence. Nothing here reworks sharing/Spaces, a sync contract, the
album/asset/person/access model, or adds a first-class entity. The one commit that sounds like it might —
API-key rotation touching auth — was checked directly and adds an endpoint plus a `Permission.ApiKeyRotate`
value to upstream's own feature. #26538 is robustness, #24033 a sort-order fix.

### Pre-rebase detectors

| Detector                        | Result                                              |
| ------------------------------- | --------------------------------------------------- |
| Silent-no-op removed literals   | clean                                               |
| Deleted exported symbols        | clean                                               |
| Shape I (fork-owned added path) | clean **after correcting the detector** — see below |

**The Shape I detector fired a false positive on its first real outing.** As written it used
`git log --all -- <path>`, which reaches the fetched `upstream` remote, so the very commit that _adds_ a
file reports as "fork history touched this path" — guaranteed to misfire on every added file. It flagged
`server/test/medium/specs/services/api-key.service.spec.ts`, whose "fork" commit was upstream's own #30801.
Corrected to scope on `origin/main`; the skill has been fixed so the next cycle does not repeat the chase.

## Conflict Resolutions

### 1–2. `i18n/en.json` (batches 118 and 124) — both sides added adjacent keys

- **Fork side**: image-editing keys (`rotate_180`, `rotate_error`, `rotate_left`, `rotate_right`,
  `rotated_count`) and `errors.unable_to_load_groups` (user groups).
- **Upstream side**: `rotate_api_key_prompt` / `rotate_key` (#30801) and
  `errors.unable_to_load_map` / `unable_to_load_map_description` (#26538).
- **Resolution**: kept every key, re-sorted alphabetically by hand (no regex on the markers).
- **Risk**: LOW. **Verification**: file parses as JSON, key list is fully sorted, and all 7 + 3 keys were
  asserted present — the nested `errors.*` keys via a recursive walk, since a top-level check reports them
  missing.
- **i18n locale rule**: upstream shipped these to `en.json` only, so other locales fall back to English —
  upstream's own norm. The fork's nine-locale rule governs fork-authored strings and is not triggered here.

### 3. `.github/workflows/prepare-release.yml` (batch 119) — delete/modify

- **Fork side**: the file was **deleted** in #207 (unified release versioning); confirmed absent on
  `origin/main`.
- **Upstream side**: #30845 bumps an action version inside it.
- **Resolution**: kept the deletion. Upstream's change is a no-op here.
- **Risk**: LOW — predicted at Checkpoint 1 from the fork-surface notes before the rebase started.

### 4. `docs/docs/guides/template-backup-script.md` (batch 124)

- **Fork side**: #167 rebrands the heading to "Backup Gallery database".
- **Upstream side**: #26810 replaces `pg_dumpall` with `pg_dump --clean --if-exists --dbname …`.
- **Resolution**: both — fork's heading over upstream's new command.

### 5–7. `web/.../map/Map.svelte` ×3 (batch 124) — the real reconciliation

Upstream #26538 wraps the entire `<MapLibre>` block in a `<svelte:boundary>` and **re-indents everything
inside it**, adding an `Alert`/`Container`/`Text` fallback for WebGL-disabled browsers. Three separate fork
commits touch the same regions, so the file conflicted three times.

- **Fork content that had to survive** (all four verified present afterwards):
  `getSpaceMapMarkers` + `spaceId` prop/routing (Shared-Spaces map), `withSharedSpaces: true`, the
  `mdiThemeLightDark` dark-mode `Control` (#189), and `data-testid="map-marker"` (e2e).
- **Resolution**: took **upstream's restructured file as the base** and re-applied the fork's additions on
  top — the order the skill prescribes for this class — rather than hand-merging hunks. For the third
  conflict the fork's real delta was a single attribute, so the HEAD side was kept by explicit line range
  and the one line re-added.
- **Risk**: MEDIUM at the time, LOW after verification.
- **Verification (the check that matters for this class)**:
  `git diff upstream/main..HEAD -- <file>` shows **only** the fork's additions — no `-` block of upstream
  content without a matching re-addition. `svelte:boundary`, `Alert`, `Container` and `Text` all still
  present.

## Fork Feature Verification

| Feature           | Status | Notes                                                              |
| ----------------- | ------ | ------------------------------------------------------------------ |
| Shared Spaces     | OK     | Spaces map routing intact through the `Map.svelte` restructure     |
| Gallery Map       | OK     | `getSpaceMapMarkers`, `withSharedSpaces`, dark-mode control intact |
| User Groups       | OK     | `errors.unable_to_load_groups` preserved                           |
| Image Editing     | OK     | all five `rotate_*` keys preserved                                 |
| Storage Migration | OK     | untouched                                                          |
| Pet Detection     | OK     | untouched                                                          |
| Branding          | OK     | literal no-op detector clean; docs rebrand preserved               |
| Release workflows | OK     | `prepare-release.yml` deletion held                                |

## CI and Infrastructure Verification

| Check                                 | Status | Notes                                       |
| ------------------------------------- | ------ | ------------------------------------------- |
| `upstream-postrebase-audit BATCH=124` | PASS   | 7/7                                         |
| `fork-patches-check`                  | PASS   | `@immich/ui` patch consistent               |
| `ci-invariants-check`                 | PASS   | no PUSH_O_MATIC, Gallery image names intact |
| `mobile-drift-rebase-check BATCH=124` | PASS   | no mobile changes this cycle                |
| Lockfile workspace linking            | PASS   | 9 `link:` / 0 `file:`; frozen install clean |

## Database / Mobile Migration Analysis

- **New upstream migrations**: none. Gallery migration count 58 (expected 58), no timestamp collisions,
  postbuild sync reports "Synced 58 … 1 compatibility aliases".
- **`revert-to-immich.sql`**: no new entries owed — no migration was added.
- **Mobile Drift**: no `mobile/` changes at all in these 10 commits, so no renumbering and no local mobile
  gate was required (the skill scopes that gate to batches touching `mobile/`). CI still exercises it.

## Inconsistencies Found

1. **Stale `packages/sdk/build/` masqueraded as a stale generated artifact.** `web check:typescript` failed
   with `'"@immich/sdk"' has no exported member named 'rotateApiKey'`. The instinct is "the generated SDK is
   stale — regenerate it", but both generators were already correct: `sync-open-api.js` produced **zero**
   spec drift and `oazapfts` produced **zero** `fetch-client.ts` drift, and `rotateApiKey` was already
   exported in the SDK _source_. `@immich/sdk` resolves to `packages/sdk/build/`, which predated the new
   endpoint. **Rebuilding the SDK fixed it; regenerating would have changed nothing.**
2. No other inconsistencies.

## Local CI Verification

| Check                                  | Status | Notes                                                        |
| -------------------------------------- | ------ | ------------------------------------------------------------ |
| `server pnpm build` (+ migration sync) | PASS   | Synced 58 Gallery migrations, 1 compatibility alias          |
| `server pnpm check` (tsc)              | PASS   | —                                                            |
| `web check:typescript`                 | PASS   | after the SDK rebuild                                        |
| `web check:svelte`                     | PASS   | 609 files, 0 errors, 0 warnings                              |
| `prettier --check` per package         | PASS   | server, web, e2e, docs, packages/cli all clean               |
| OpenAPI spec regen (visible, exit 0)   | PASS   | zero drift                                                   |
| TS SDK regen (`oazapfts`)              | PASS   | zero drift                                                   |
| Lockfile frozen install                | PASS   | —                                                            |
| `server pnpm lint` (eslint)            | PASS   | exit 0                                                       |
| `e2e pnpm lint`                        | PASS   | exit 0                                                       |
| `web pnpm lint` (real)                 | N/A    | plugin crash — see below; verified via the workaround        |
| web eslint (`tscompat` off)            | PASS   | exit 0; 13 findings, **all 13 tscompat phantoms, 0 real**    |
| Server unit tests                      | PASS   | 5692 passed, 12 skipped, 171 files (`--no-file-parallelism`) |
| Web unit tests                         | PASS   | 5694 passed, 2 skipped, 8 todo, 363 files                    |

### The web-lint `tscompat` crash is intermittent — record it as such

`cd web && pnpm lint` exited **2** with a `TypeError` inside
`@koddsson/eslint-plugin-tscompat`'s `convertToMDNName`, aborting **before reaching any real violation**.
This is the long-documented plugin bug, not a regression from this rebase.

Worth pinning down precisely, because the previous cycle recorded the opposite: in the arc-B run hours
earlier, on this same worktree, plain `pnpm lint` exited **0**, and that was written down as "the caveat may
be stale". It is **not** stale — it is **intermittent**, and one green run does not retire it. The standing
procedure is: run the real `pnpm lint`; on an exit-2 `Rule: "tscompat/tscompat"` stack, fall back to
`npx eslint . --rule '{"tscompat/tscompat":"off"}'` and **discount every "unused eslint-disable directive"
finding naming `tscompat`** — those are artefacts of the override itself, not real violations.

Server unit tests were run with `--no-file-parallelism` from the outset, on the strength of the previous
cycle's finding that parallel local runs produce a shifting failure set under contention.

## Post-Rebase Verification

- Commits behind upstream: **0**
- Fork diff clean: YES — `Map.svelte` diff against `upstream/main` contains only fork additions
- Working tree clean: YES

## Landing

Unchanged and not a question: the newest upstream tag is still **v3.1.0**, which `branding/config.json`
already tracks, so the branch stays off `main`.
