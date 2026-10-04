# Upstream Sync Report — 2026-10-04

## Summary

- **Upstream ref**: `upstream/release/v3.3`, `20f103c4b99` (v3.3.0-rc.2) → `d15972e7223` (no rc.3 tag yet)
- **Upstream commits pulled**: 1 (batch 82)
- **Conflicts resolved**: 0
- **Fork sync**: none (`origin/main` still `da5480ae42b`)
- **Risk level**: LOW
- **Recommendation**: PROCEED (stays off `main`; v3.3.0 is still an RC)
- **Backup**: local branch `backup/rolling-pre-2026-10-04` (`c4d4fd4d8c8`)

## Incoming Upstream Changes

| SHA           | Summary                                                                                              | Area   | Risk to Fork | Notes                                                                                                                       |
| ------------- | ---------------------------------------------------------------------------------------------------- | ------ | ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `d15972e7223` | fix(server): don't select an audio stream ffprobe could not identify (#32062, cherry-pick of #30901) | server | LOW          | One line in `media.repository.ts` `probe()`: drop audio streams whose `codec_name` is `unknown` (iPhone APAC spatial audio) |

The fork diverges in `media.repository.ts` only in `extractVideoFrames` (video duplicate detection) and its `path`
import; the `audioStreams` filter line is untouched by the fork. Fork consumers of `audioStreams`
(`metadata.service.ts`, specs) read the filtered array, so an asset whose only audio is unidentified is now
treated as having no audio, which is upstream's intent.

## Conflict Resolutions

None.

## Whole-tree audit

`git diff backup/rolling-pre-2026-10-04..HEAD --stat` → exactly `server/src/repositories/media.repository.ts | 2 +-`,
identical to upstream's own delta.

## Housekeeping

`rolling-state.json` still carried `activeForkSync.status = checks-failed` from the 2026-10-01 sync of #1145
(which is on the branch, `integratedForkHead` already `da5480ae42b`). It blocked `make upstream-next-batch`;
cleared via the sanctioned `make upstream-sync-fork-main ROLLING_CONTINUE=1`, which reran the fork checks and
passed.

## Local CI Verification

| Check                                                                                                | Status | Notes                                                 |
| ---------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------- |
| `make upstream-postrebase-audit BATCH=82`                                                            | PASS   | 8/8 OK                                                |
| `fork-patches-check` / `ci-invariants-check` / `commit-autolink-check` / `mobile-drift-rebase-check` | PASS   |                                                       |
| `server pnpm build` (+ postbuild migration sync)                                                     | PASS   |                                                       |
| `server pnpm check` (tsc)                                                                            | PASS   |                                                       |
| server eslint (`media.repository.ts`)                                                                | PASS   |                                                       |
| Server unit tests                                                                                    | PASS   | 6485 passed                                           |
| Web / mobile / ML / e2e gates                                                                        | N/A    | trees byte-identical to the 10/10-green `19a3768321b` |

## Remote CI Verification

See the follow-up commit on this branch.
