# Upstream Sync Report — 2026-11-07 (v3.4 rolling → v3.4.0-rc.3)

## Summary

- **Fork sync**: the 10 PRs merged to `main` since `3b3f35f85b7` (#1274, #1248, #1249, #1250, #1267, #1273,
  #1268, #1261, #1277, #1279). `make upstream-sync-fork-main` threw on the first, so all ten were applied by
  hand; `integratedForkHead` → `3983e438171`.
- **Upstream**: Immich tagged `v3.4.0-rc.3` (`25692ae428d`). 9 commits on top of rc.2, one replay of 1851 fork
  commits onto the tag.
- **Base**: `upstream.version` → `3.4.0-rc.3` (AGENTS.md, README, both switching guides, the revert-script note,
  the branding-targets pin, the OpenAPI version). rc.3 adds no migrations;
  `ghcr.io/immich-app/immich-server:v3.4.0-rc.3` is published.
- **Product gate**: did not fire. Two owner decisions at Checkpoint 1: port every fork web spec to Vitest browser
  mode now (immich-33008), and take mobile passkeys (immich-33005) but switched off in Gallery builds.
- **Risk**: MEDIUM (the web test port touches ~330 files). **Remote CI**: green; see the end of this report.
- Backups: `backup/rolling-v34-pre-forksync-1107` (pre-cycle tip `991afe2b8d8`, pushed),
  `backup/rolling-v34-post-forksync-1107` (after the fork sync, pushed).

## Upstream changes

| SHA           | Summary                                       | Area           | Risk   | Notes                                                                                   |
| ------------- | --------------------------------------------- | -------------- | ------ | --------------------------------------------------------------------------------------- |
| `eca3091b87f` | person page shortcuts (immich-32992)          | web            | LOW    | mapped onto the fork's person actions; `PersonIndicator` on the thumbnail               |
| `6e5fef68eef` | Android Flutter config before Fastlane        | CI             | LOW    | clean                                                                                   |
| `efb64da6590` | ML model load error message                   | ML             | LOW    | clean                                                                                   |
| `8e3f8f695a4` | mobile passkeys (immich-33005)                | mobile         | MEDIUM | taken, off in Gallery builds; zero-conflict break in `demoLogin` (see below)            |
| `f93e38a946f` | web tests refactor (immich-33008)             | web, CI        | HIGH   | happy-dom + testing-library removed; the fork's specs ported (see below)                |
| `74f48a86766` | server import sorting back to prettier        | server         | MEDIUM | 242 files; carried to fork files with a symbol-level import merge and prettier          |
| `756da5e81b0` | web import ordering                           | web            | MEDIUM | 219 files; same                                                                         |
| `846c0c97479` | FUTO backups state in the Immich DB           | server, deps   | MEDIUM | `sql-tools` 0.7; `--ignore-prefix futo_backups_` added to the fork's migrator dispatch  |
| `25692ae428d` | version v3.4.0-rc.3                           | all            | LOW    | `mobile/pubspec.yaml` keeps the fork's version                                          |

No upstream migrations (rc.3 only reformats five), no Drift schema change, no FK-registry key touched.

## Fork sync

Main's PRs are written against `main`'s vocabulary, so each needed the SvelteKit 3 carry (`$lib` → `#lib/….ts`,
`{@const}` → `{const … = $derived()}`, `$app/env`, the unit `factory`). The real port: rolling has no
`userInteraction` spaces store, so #1248's library view, #1249's space badges and #1250's remove-from-space button
read rolling's spaces query (`gallery/spaces/space.query.ts`): the library view holds the query open while the
timeline is on screen; the badges follow the query cache; space edits call `invalidateSpaces()`, and
`SpaceUpdate` now invalidates the list. #1249's e2e mock-network route became a default in the medium handlers.
Server, web and mobile suites were green after the sync, before the rc.3 replay.

## How the replay was driven

One `git rebase v3.4.0-rc.3`, `rerere` off. The driver took the fork side only for files rc.3 touches and for
regenerated artifacts; a DU on an rc.3-deleted (or fork-tip) path kept the fork's file, a UD kept the fork's
deletion; anything else would have stopped it. Every file rc.3 does not touch came out byte-identical to the
pre-replay tip. `chore(fork): reconcile the fork with v3.4.0-rc.3` then merged each rc.3 file three ways (fork tip,
rc.2, rc.3): 334 took rc.3, 105 merged clean, 26 resolved by hand, the rest import-only. A symbol-level merge of
each file's imports replaced git's line merge for imports (a line merge kept rc.3's moved line and the fork's
original, which the sort plugin then folded into duplicates). A line-level audit confirmed every fork line and
every rc.3 line is present except the deliberate divergences below.

Trap worth keeping: `git show <ref>:<path>` exits 0 with empty output when a path containing brackets
(`[[assetId=id]]`) does not exist at that ref. Check with `git cat-file -e` first.

## Resolutions worth knowing

- **Passkeys off**: `mobile/lib/gallery/passkeys.dart` wraps the platform passkey API so it reports passkeys
  unsupported; `platform.provider.dart` carries one call into it. Upstream's passkey tests override that provider
  and still pass. The `webcredentials:my.immich.app` entitlement is dropped. Turn on with a Gallery associated
  domain (AASA + assetlinks).
- **Zero-conflict break** (Shape S): immich-33005 removed `AuthApiRepository._mapLoginReponse`; the fork's
  `demoLogin` uses `LoginResponse.fromDto`. Only `dart analyze` saw it.
- **Login form**: rc.3's `onLogin`/`finishLogin` split, with the fork's `GalleryTabShellRoute` and call order.
- **FaceEditor** keeps the `space-face-editor` id (fork e2e) and takes rc.3's `data-testid`.
- **Branding**: overrides for rc.3's `passkeys_on_server` strings.
- **Root layout**: the import merge dropped `themeManager`, which rc.3 stopped using but the fork's Shift+T
  shortcut still uses; restored. Only eslint `no-undef` caught it (svelte-check did not).
- **ownership.yml** gained the two fork migrations the fork sync brought. `main` lacks them too.

## Web test port (immich-33008)

rc.3 converted upstream's specs to Vitest browser mode and removed happy-dom and `@testing-library/*`. The fork's
~330 specs were ported in two waves (eight batches, then the 40 files the first wave's grep could not find). The
suite: 461 files, 7055 tests.

- Test infra: the fork's medium handlers moved to `test/common/gallery/` and register in rc.3's shared dispatcher;
  fork DTO fields reach upstream's payload fixtures through `test/common/gallery/payloads.ts` (one call per
  constant); `test/unit/setup.ts` is upstream's (the happy-dom teardown workarounds went with happy-dom); the
  deleted upstream SDK mock is kept as `gallery/__mocks__/sdk.mock.ts`; `gallery-setup.ts` leaves specs on
  upstream's page fixtures alone.
- Upstream specs rc.3 deleted: those with fork cases keep only those, renamed `*.gallery.spec.ts` (AGENTS.md rule
  8); those without were removed.
- rc.3's search page spec drives the dormant upstream search bar; its two cases are `test.skip`ped and DORMANT.md
  names it.
- Traps found: Node APIs do not exist in the browser (use `?raw`, `import.meta.glob`, `commands.readFile`);
  `vi.mock('svelte-i18n')` has no effect; `vi.spyOn` on a module namespace throws; partial `vi.mock` factories fail
  to load; static imports beat `sdk.mock.ts` (load the module under test with `await import`); Vitest 5
  `toHaveTextContent` is exact; `process.env.TZ` does nothing in a browser.
- **Runner stability**: a spec that followed a real `<a href>` navigated its iframe away (fixed in the spec). With
  one iframe per core (17 here) Vitest's browser connection dropped partway through most runs; `vite.config.ts`
  now turns HMR off in tests and caps `maxWorkers` at 3 (what CI's 4-core runners get anyway). Specs share the
  real pointer across parallel files, so pointer-sensitive specs drop trusted input or click through the DOM.
  The remaining drops had one cause: `gallery-setup.ts` started four imports with `Promise.all`; when one
  failed to link (a spec's `@immich/sdk` mock lacking `getPublicConfig`), the spec went on while the other
  imports still fetched factory-mocked modules (`$app/navigation`, `$app/state`). A short spec then ended, Vitest
  removed its iframe, and the pending mock request rejected unhandled in the Vitest process, which aborted the
  run. The setup now lets every import settle first. Verified: 11 of 11 full runs clean (8 at 17 workers),
  the triggering spec 24 of 24. Vitest 5.0.5 does not catch that rejection in its Playwright route handler;
  worth reporting upstream to Vitest. `maxWorkers: 3` stays for now: at 17 workers two pointer-sensitive specs
  (`detail-panel-star-rating`, `cleanup-hub-page`) still fail now and then.
- Findings not changed: upstream's `SettingInputField` points `aria-labelledby` at an id nothing carries;
  `space-albums-table`'s flex header row does not expose column headers.

## Layering

- Upstream files whose fork diff grew: `web/vite.config.ts` (HMR off, worker cap), `test/common/payloads.ts` (four
  hooks), `test/common/dispatcher.ts` (one registration), `platform.provider.dart` (one call), the two
  entitlements (one line removed each), `server/mise.toml` (the ignore-prefix on the fork's migrator lines), rc.3's
  search page spec (two skips). Everything else moved toward rc.3 or stayed.
- `i18n/*.json` identical to upstream; `merge.mjs --check` passes.
- Access and RBAC oracle snapshots unchanged.

## Local CI verification

| Check                                                | Status | Notes                                         |
| ---------------------------------------------------- | ------ | --------------------------------------------- |
| server build, `tsc`, lint, prettier                  | PASS   |                                               |
| server unit                                          | PASS   | 7782                                          |
| server medium: both oracles, ledger, new fork specs  | PASS   | after the fork sync                           |
| OpenAPI + SDK regeneration                           | PASS   | version string only                           |
| SQL query regeneration                               | PASS   | no change                                     |
| web `tsc`, svelte-check, lint, prettier              | PASS   |                                               |
| web unit (browser mode)                              | PASS*  | 7049/7055 (2 skipped, 4 todo); see stability  |
| mobile codegen, analyze, format, tests               | PASS   | 4300                                          |
| ML ruff, mypy, pytest                                | PASS   | 305                                           |
| e2e `tsc`, lint                                      | PASS   |                                               |
| i18n overlay check, branding gap scan                | PASS   |                                               |
| preflight suite, CI invariants, fork patches, audits | PASS   | artifact review informational                 |
| revert-script coverage                               | PASS   |                                               |
| commit autolink check                                | PASS   |                                               |

## Remote CI verification

GitHub had switched Actions off for the repository on 2026-11-06 (every dispatch: HTTP 422 "Actions has been
disabled for this repository", while every setting the API shows said enabled). Re-enabled from the banner on the
repository's Actions tab. Final tip `4d48956f4db`; every later commit only touches tests or CI.

| Workflow                                 | Run           | Commit        | Result |
| ---------------------------------------- | ------------- | ------------- | ------ |
| Test (21 jobs)                           | `42680443566` | `4d48956f4db` | PASS   |
| Static Code Analysis                     | `42658035075` | `da453100139` | PASS   |
| Docker                                   | `42676122470` | `82f442c25f5` | PASS   |
| Gallery Rebase Smoke                     | `42658046000` | `da453100139` | PASS   |
| Gallery Build Mobile (development)       | `42519907423` | `2a68a9f2247` | PASS   |
| Storage Migration Tests / E2E            | `42520042018` / `42520086134` | `2a68a9f2247` | PASS |
| Gallery ML Smoke / Mobile Smoke          | `42520171704` / `42520215713` | `2a68a9f2247` | PASS |
| Release Candidate Build `rolling-v34-rc12` | `42658066317` | `da453100139` | PASS |
| Revert-to-Immich (rc12 + stock `v3.4.0-rc.3`) | `42672141531` | `366ed2d888a` | PASS |

Mobile, ML and storage code did not change after `2a68a9f2247`.

What CI found, fixed on the branch:

- **Production**: rc.3 replaced `ControlAppBar`'s `id="control-bar"` with a `data-testid`. The fork's viewer zoom
  used the id to tell a selecting click from an opening one, and `motion.css` animated the selection bar by it:
  selecting photos put a stray zoom copy up and the bar no longer slid in. Both follow the test id; a
  viewer-zoom case covers the guard. Same rename for `detail-panel`, `data-icon-favorite` → `favorite-icon`,
  `memory-viewer`: fork e2e and medium specs follow it.
- **rc.3's medium harness**: every POST counts as a mutation a spec must assert; Gallery's POST reads
  (`getAssetSpaces` and seven more) are declared in `test/common/gallery/handlers.ts` and added to the
  dispatcher's read list by one loop. One page per worker leaked state: two fork specs left it at 390px, and
  localStorage kept the info panel open into the next test (the fork's init script now clears storage on each
  test's first load, keyed on a cookie the teardown clears). Upstream specs edited where Gallery differs, each
  with a `// Gallery:` comment: the location pencil is an `IconButton` (title is a tooltip, not an attribute),
  the scrubber is measured after its fly-in, the duplicates viewer test waits for the URL (Gallery mounts the
  viewer through `lazyComponent`), and the add-to-album count case is skipped (Gallery's album-or-space picker).
- **Web unit**: `global-search` seeded live filter rows that any caret sync (CI's Chromium fires `select` after
  render) reset; the spec stubs the live scheduler. `cleanup-hub-page` hovers through `mouseenter`, since
  parallel files share the real mouse.
- **Server lint** ran out of Node's default 4 GB heap on CI (it peaks near 4.7 GB); the task gets 8 GB.
- **Revert gate, upstream bug**: since rc.3 (its four `futo_backups_*` enums), a vacuumed `pg_enum` is read
  through its `(enumtypid, enumlabel)` index, and `@immich/sql-tools` 0.7.0 reads enum values without
  `ORDER BY`, so stock Immich reports every non-alphabetical enum as drift after any VACUUM. Reproduced on
  stock rc.3 alone (fresh database, `VACUUM ANALYZE`, boot: six enums). Users of either app see only drift
  warnings. The gate now takes its stock baseline on a vacuumed database. Worth reporting to sql-tools.

Open, not fixed:

- `gallery-album-filters.e2e-spec.ts:101` passed on retry once (`42680443566`): with the add-photos picker open,
  the album page's own filter query (Album Tag) ran again and the picker showed its result instead of the Picker
  Tag one. The album page keeps one timeline whose options switch between the album's filters and the picker's;
  something reloads it with the album's while picking. Likely a real, rare bug; not seen in eight runs on
  `main`.
- The ARM server e2e job once lost its server mid-run (exit 135, SIGBUS, nothing logged); it passed on the next
  three runs.
- Locally only (a German macOS region): three medium timeline specs type dates in month-first order into a native
  date input that the region shows day-first; they pass on CI.
