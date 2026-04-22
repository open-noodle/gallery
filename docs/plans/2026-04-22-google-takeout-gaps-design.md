# Google Photos Takeout Import: Gap Fixes — Design

Branch: `feat/google-takeout-gaps` (worktree at `.worktrees/google-takeout-gaps`, based on `investigate/issue-404-gphotos-metadata` = open PR #405).

## Context

PR #405 (Apr 2026) fixed the 2024+ `.supplemental-metadata.json` sidecar format in
`matchSidecarToMedia`. Five follow-up gaps remain, tracked in
`docs/plans/2026-04-22-google-takeout-gaps.md`. This PR bundles four of them
(gap #5 is explicitly deferred, see below) into a single change across two
files — small for #1, a principled port for #2–#4 + bonus — because splitting
would fragment review of what is effectively one concern: "Takeout import
quality".

## Scope

In scope:

- **Gap #1** — Localized Google Photos root folder (Fotos/Foto/Фото/フォト/相册/…).
- **Gap #2** — `(N)` duplicate-index sidecars (index in either position).
- **Gap #3** — `-edited` / localized edited variants sharing the original's sidecar.
- **Gap #4** — Missing media extension on sidecar (`Peanut Butter Balls.supplemental-metadata.json`).
- **Bonus** — `matchForgottenDuplicates` (immich-go: `original_<uuid>_.json` → `original_<uuid>_P(1).jpg`).

Out of scope:

- Localized `.supplemental-metadata` suffix — Google keeps suffix English regardless of locale.
- **Gap #5 — Live Photo `(N)` pairs** (e.g. `IMG.HEIC` + `IMG(1).mp4` sharing
  `IMG.HEIC.supplemental-metadata(1).json`). Traced through the ported cascade:
  `matchFastTrack` miss (stems differ), `matchNormal` miss (stems `IMG.HEIC`
  vs `IMG` aren't equal even with matching `(N)`), `matchForgottenDuplicates`
  miss (`IMG(1).mp4` does not start with `IMG.HEIC`), `matchEditedName` miss
  (fileName has `(N)`). This is the same open upstream case as immich-go
  issue #1321; they haven't solved it either, and fixing it properly
  requires extension-agnostic cross-candidate matching that doesn't fit the
  4-matcher structure. Leaving unaddressed in this PR.
- Nested-album path flattening (`Takeout/Google Fotos/Parent/Child/img.jpg`)
  — `detectAlbums` uses `parts.at(-2)`, so the album name comes out as
  `Child`, losing the parent. Not a regression (same behavior as today);
  documented here so it's not a follow-up surprise.

## Approach

### Gap #1: Localized Google Photos root via JSON shape detection

Current code hard-codes `parts.indexOf('Google Photos')` at four sites:
`web/src/lib/utils/google-takeout-scanner.ts:126,198,252` and
`web/src/lib/utils/google-takeout-parser.ts:227`. Any non-English Takeout silently
drops album detection.

Replace folder-name heuristic with JSON shape detection. A sidecar is a Takeout
photo sidecar iff `parseGoogleTakeoutSidecar` returns non-null (requires
`photoTakenTime` or `creationTime` — Photos-specific fields, not present in
Drive/Keep/Gmail sidecars). For each such sidecar at path `Takeout/<root>/…`,
add `<root>` to a `photoRoots: Set<string>`. Album detection uses that set.

No additional locale or prefix guard. The `photoTakenTime` / `creationTime`
fields are themselves the filter; future Takeout service drift would break
this assumption and require a follow-up, but that is not a risk worth
pre-empting today. Slovak's `Fotky Google` and every other confirmed locale
pass through this check transparently.

**Why shape detection, not "any direct child of Takeout/":** a full Google
account export includes `Takeout/YouTube/`, `Takeout/Gmail/`, `Takeout/Drive/`,
etc. "Any child" would hallucinate albums from those services. Shape detection
filters them out.

**Why not a locale table:** maintenance burden, incomplete for future locales,
immich-go themselves don't use one (they detect by JSON content — same idea).

**Where detection runs:** `scanTakeoutFiles` currently interleaves media +
sidecar extraction. Add a post-extraction pass that builds `photoRoots` by
calling `parseGoogleTakeoutSidecar` on each collected sidecar text. Pass that
set to `detectAlbums` and use it to finalize `item.albumName`.

**Progress display during extraction:** `progress.albumNames` is rendered live
in `import-scan-step.svelte:66` as the user watches the scan run — it is
user-visible, not cosmetic. The hot loop in `scanZipFile` (line 198) and
`trackItemStats` currently mutate it on the fly.

Before `photoRoots` is known, use a tentative heuristic: if
`parts[0] === 'Takeout' && parts.length >= 4`, count `parts[2]` as a candidate
album name. This may over-count (a full Google account export would briefly
show `playlists` and `inbox` as albums while sidecars are still being read).

To correct this before the scan finishes: after the sidecar pass builds
`photoRoots`, rebuild `progress.albumNames` from the final `detectAlbums`
output (or equivalently, filter the existing set to names whose source items
live under a `photoRoots` folder) and fire one last `onProgress?.(progress)`
so the UI snaps to the right count. Add a comment on the rebuild step making
this explicit — the transient over-count is intentional, the reconciliation
is mandatory.

**API changes (internal, web only):**

- New helper in `google-takeout-parser.ts`:
  `derivePhotoRoots(items: TakeoutMediaItem[]): Set<string>`. Iterates items
  with `metadata !== undefined` (a successful sidecar match already proves
  valid Takeout photo content), extracts `parts[1]` where `parts[0] === 'Takeout'`,
  returns the distinct set. No extra JSON re-parsing needed.
- `detectAlbums(items)` stays the same signature: it calls `derivePhotoRoots`
  internally. Existing callers don't change. (Exported separately so tests
  can construct `photoRoots` manually when needed.)
- `trackItemStats(metadata, filePath, progress)` — no signature change;
  internal tentative heuristic changes from `indexOf('Google Photos')` to
  the `parts[2]` heuristic above.
- In `scanTakeoutFiles`, after `scanZipFile` + `scanFolderFiles` finish and
  before returning: call `detectAlbums(allItems)`, rebuild
  `progress.albumNames` from the final album set, and fire `onProgress` once
  more so the UI snaps to the authoritative count.

### Gaps #2–#4 + forgotten-dupes: port immich-go's 4-matcher cascade

Current `matchSidecarToMedia` = strip `.json` → strip `.supplemental-metadata` →
exact match → 47-char truncated match. Misses `(N)` in either position,
`-edited` / localized variants, sidecars missing the media extension, and the
UUID-based forgotten-duplicate pattern.

Replace with a direct TypeScript port of immich-go's four pure matchers from
`adapters/googlePhotos/matchers.go`. All four share signature
`(jsonName: string, fileName: string) => boolean` and are self-contained string
manipulation. Apply in order; first truthy wins.

1. **`matchFastTrack`** — strip `.json`; exact equality with fileName.
2. **`matchNormal`** — extract trailing `(N)` index from both; indexes must
   match; strip supplemental-metadata segment (any prefix from
   `.supplemental-metadata` to `.s`); compare stems, tolerating Google's
   46-rune basename truncation via `[...fileName].slice(0, 46).join('')`.
   Any additional rune-level retries (e.g. "drop last rune") get ported only
   if the test table requires them — TDD from the ported rows determines
   the minimum needed.
3. **`matchForgottenDuplicates`** — `fileName.startsWith(jsonStem)` AND
   code-point length diff < 10. Catches the `original_<uuid>_.json` →
   `original_<uuid>_P(1).jpg` pattern. (Does NOT cover Live Photo `(N)`
   pairs — see Out of Scope §Gap #5.)
4. **`matchEditedName`** — fileName must have no `(N)` index; strip
   supplemental-metadata; if jsonStem ends in a known media extension, drop
   it; then `fileName.startsWith(jsonStem)` AND fileName contains a known
   edited suffix immediately before the extension.

`matchSidecarToMedia(sidecarPath, sidecarContent, mediaFilePaths)` signature is
unchanged. Internally:

1. Parse sidecar; invalid Takeout JSON → return undefined (unchanged).
2. Compute sidecar directory; filter `mediaFilePaths` to same dir. (Comment
   at this line: same-dir is Takeout's invariant and makes basename-collision
   across albums a non-issue by construction.)
3. Iterate candidates; for each, try matchers in order; return first hit.
4. No match → undefined.

**Same-dir restriction:** Google Takeout always colocates sidecar + media
(and duplicates media into each album folder when a photo belongs to
multiple albums, sidecars alongside). immich-go relaxes this because they
also handle bundle/album semantics, which we don't. Keep same-dir.

**Edited-suffix list:** only the four confirmed entries from immich-go's
`docs/misc/google-takeout.md`:
`-edited` (en), `-modifié` (fr), `-bearbeitet` (de), `-modificato` (it).

The ~12 unconfirmed variants (`-editado`, `-отредактировано`, `-编辑`,
`-編集済み`, `-편집됨`, `-bewerkt`, `-muokattu`, `-відредаговано`,
`-edytowane`, `-redigeret`, `-upravené`) are deliberately omitted: an
incorrect suffix risks false-match chains (e.g. a real media file that
happens to contain one of those strings). Documented in a code comment
with a pointer to `docs/plans/2026-04-22-google-takeout-gaps.md` so they
can be added on user report.

**Known media extensions:** reuse the existing `MEDIA_EXTENSIONS` set from
`google-takeout-scanner.ts`. Move it into `google-takeout-parser.ts` so both
files share one source of truth (scanner re-exports it to avoid churning
imports elsewhere).

**Rune vs UTF-16:** JS `str.length` counts code units, Go `rune` counts
code points. Use `[...str].length` / `[...str].slice(0, 46).join('')` at the
two comparison sites so surrogate-pair emoji count the same way Go would.
(Grapheme clusters like ZWJ sequences behave identically in both languages —
both split into multiple units — so no further normalization is needed.)

**Attribution:** single block comment above the new matcher cascade:

```ts
/**
 * Sidecar-to-media matching cascade. Ported from simulot/immich-go
 * (AGPL-3.0), adapters/googlePhotos/matchers.go @ <commit-sha>.
 * See docs/plans/2026-04-22-google-takeout-gaps.md for context.
 */
```

Commit SHA captured at port time from the latest main commit touching that
file.

## Testing

### Unit tests — `google-takeout-parser.spec.ts`

Port immich-go's `matcher_test.go` table. Shape per row:
`{ jsonName, fileName, shouldMatch: boolean }`. ~30 rows including their cited
issues (#405 burst `~2`, #613 short-stem `.j`, #674 / #698 `-edited`
variants). Feed each through `matchSidecarToMedia` with the corresponding
`mediaFilePaths`; assert match/no-match.

Retain existing specs for `parseGoogleTakeoutSidecar`, `detectAlbums`,
`isAutoGeneratedAlbum`. `detectAlbums` signature is unchanged, so existing
callers need no update.

### Scanner tests — `google-takeout-scanner.spec.ts`

Add `describe('localized Takeout folder', …)`. Synthesize zips via the
existing `createZipBlob` helper at the top of the spec file
(`google-takeout-scanner.spec.ts:5-17`) — already in use for 47 passing
tests, so the `@zip.js/zip.js` + happy-dom combination is confirmed
reliable. Minimum fixtures:

- `Takeout/Google Fotos/Chengdu City 2009/img.jpg` + sidecar → 1 album named
  "Chengdu City 2009", `photoRoots === { 'Google Fotos' }`.
- `Takeout/Google Photos/Summer/img.jpg` + sidecar
  PLUS `Takeout/YouTube/playlists/playlists.json` (standalone, non-photo JSON)
  → 1 Photos album, YouTube not hallucinated as an album, photoRoots ===
  `{ 'Google Photos' }`.
- `Takeout/Google フォト/旅行/img.jpg` + sidecar → Japanese folder works.
- `Takeout/Google Fotos/Album/img(1).jpg.supplemental-metadata(1).json` +
  sidecar → sidecar matched via `matchNormal`, no regression from gap #2.

### End-to-end manual repro (pre-PR, documented in PR body)

`make dev` → Import wizard → upload `~/Downloads/sample.zip` → expected:
20 media items, 1 album ("Chengdu City 2009"), 20 with date. Record the
actual counts and any UI oddities in the PR description.

## Rollout

Single PR on `feat/google-takeout-gaps`. Merge order:

1. PR #405 merges to main (currently MERGEABLE, awaiting review).
2. Rebase this branch onto main.
3. Open this PR.

If #405 drags, we can rebase this onto whatever shape it lands in — no merge
dependency beyond the matcher changes it makes.

## Risks & mitigations

| Risk                                                                       | Mitigation                                                                                                                                                                                                |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shape detect fails if Photos root has zero valid sidecars                  | Can't realistically happen — Takeout always ships sidecars. If it did, worst case is unchanged from today (no albums).                                                                                    |
| User selects too shallow a folder (`MyBackup/`)                            | Same as today — no `Takeout/` prefix, no detection, no albums. Not a regression.                                                                                                                          |
| Transient over-counted albums during extraction                            | Intentional: the tentative heuristic counts `parts[2]`-under-`Takeout/` while sidecars are still being read. Reconciled and re-fired as `onProgress` once `detectAlbums` runs; final UI count is correct. |
| Rune vs UTF-16 miscount at truncation sites                                | `[...str].length` / code-point truncation at both comparison sites; covered by an emoji row in the ported test table.                                                                                     |
| Edited-suffix list misses an unconfirmed locale                            | Only ship the 4 confirmed suffixes. Affected files still import; they just lack metadata. Graceful degradation. False-match risk from a wrong unconfirmed suffix avoided by omission.                     |
| `matchForgottenDuplicates` false positive with short names                 | Rune-diff < 10 + `startsWith` is conservative. Ported test table catches regressions.                                                                                                                     |
| Attribution drift across rebases                                           | Single block comment co-located with the cascade; diff-stable.                                                                                                                                            |
| Future Google Takeout drift (e.g. Drive sidecar emitting `photoTakenTime`) | Not pre-empted. If it happens, we add a secondary shape check then. Today's risk is near-zero.                                                                                                            |

## Non-goals

- No changes to `TakeoutMediaItem` / `TakeoutAlbum` / `TakeoutMetadata` shapes.
- No changes to uploader, album-creation, or progress-UI components.
- No server or mobile changes — web-only.
- "Google Photos" remains the English feature-card label in the import wizard
  UI (`import-source-step.svelte`, source-card tests). We only change path
  parsing.
- Extension-agnostic cross-candidate matching for Live Photo `(N)` pairs —
  see Out of Scope §Gap #5.
- Nested-album name reconstruction — see Out of Scope.
