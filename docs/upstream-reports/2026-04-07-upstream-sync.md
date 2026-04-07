# Upstream Sync Report — 2026-04-07

## Summary

- **Upstream commits pulled**: 43 (Immich v2.7.0)
- **Previous base**: v2.6.3
- **Fork commits rebased**: 206
- **Conflicts resolved**: 5 (all LOW risk, auto-resolved by rerere on retry)
- **Post-rebase fixes**: 3 commits (lockfile regen, CI restore, test fixes + version bump)
- **Risk level**: LOW
- **Recommendation**: PROCEED

## Key Upstream Changes

- **TypeScript v6** — major version bump, all fork code compiles cleanly
- **MonthGroup → TimelineMonth** — 16-file rename, 3 stale refs fixed in fork test
- **Person face editor** — new `findOrFail()` call in `createFace`, 2 test mocks added
- **Version checks** — moved to `version.immich.cloud`, API method renamed
- **withExif → withExifInner** — search repo import merged with fork's `asUuid`

## Conflict Resolutions

All conflicts were identical to the first rebase attempt and auto-resolved by git rerere:

1. **pnpm-lock.yaml** — took upstream, regenerated with fork deps
2. **server/test/medium person.service.spec.ts** — upstream reordered mock array
3. **storage-space.svelte** — upstream's @immich/ui Meter import kept
4. **timeline-manager files** (3 files) — MonthGroup→TimelineMonth naming preserved with fork's space loading block
5. **mobile/pubspec.yaml** — kept fork's 1.0.0+1 version
6. **search.repository.ts** — combined asUuid (fork) + withExifInner (upstream)
7. **mobile/openapi/README.md** — binary, took fork's version

## Local CI Verification

| Check               | Status | Notes                |
| ------------------- | ------ | -------------------- |
| `make build-server` | PASS   |                      |
| `make build-sdk`    | PASS   |                      |
| `make check-server` | PASS   | 0 errors             |
| `make check-web`    | PASS   | 0 errors, 0 warnings |
| Server unit tests   | PASS   | 3780 passed          |
| Web unit tests      | PASS   | 1248 passed          |

## Post-Rebase Verification

- Fork commits ahead of upstream: 209
- Commits behind upstream: 0
