# Pre-release server workflow (`gallery-prerelease-server.yml`)

**Date:** 2026-07-02
**Status:** Design approved, pending implementation

## Goal

Publish a Gallery **pre-release** the way Immich shipped
[`v3.0.0-rc.0`](https://github.com/immich-app/immich/releases/tag/v3.0.0-rc.0):
multi-arch server + ML images under a semver RC tag, a git tag, and a GitHub
Release flagged **pre-release** — without any of the "this is now the stable
version" side effects.

This fills the gap between the two existing workflows:

- `gallery-rc-build.yml` — throwaway RC images under an arbitrary tag. No git
  tag, no GitHub Release, no version endpoint. Stamps the _nearest fork tag_ as
  the server version (e.g. `v4.56.7`), which mislabels the build.
- `gallery-release-server-only.yml` — the GA release. Moves the
  `release` / `vN` / `latest` docker tags, marks the GitHub Release `--latest`,
  and **flips the version-poll endpoint** self-hosted instances check.

The pre-release workflow wants the GitHub-Release object and reproducibility of
the GA path, but the update-safety of the RC builder.

## Why the version endpoint must not move (the core constraint)

The server's update check (`VersionService.handleVersionCheck` →
`ServerInfoRepository.getLatestRelease`) fetches the Bunny `/gallery` endpoint
and broadcasts an "update available" notification when:

```ts
semver.gt(endpointVersion, serverVersion);
```

Because `5.0.0-rc.0 > 4.58.0`, publishing an RC to that endpoint would prompt
**every stable install** to "upgrade" to a release candidate. Therefore the
pre-release workflow **must not** run a `publish-version-endpoint` job. The
endpoint stays on the current GA version (`v4.58.0`).

Corollaries handled correctly by leaving the endpoint alone:

- An RC tester running `5.0.0-rc.0` sees the endpoint still reporting `4.58.0`;
  `semver.gt('4.58.0', '5.0.0-rc.0')` is `false`, so no downgrade prompt.
- When GA `v5.0.0` later ships and flips the endpoint,
  `semver.gt('5.0.0', '5.0.0-rc.0')` is `true`, so RC testers are correctly
  prompted to move to GA.

## Decisions

| Decision         | Choice                                  | Rationale                                                                                                                                                                                  |
| ---------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Architecture     | New standalone workflow                 | The GA workflow's tail (move `release`/`vN`/`latest`, `--latest`, flip endpoint) is exactly what an RC must not do. A separate workflow leaves the dangerous GA path untouched.            |
| Tag format       | `v5.0.0-rc.0` (Immich dot-style)        | Numeric identifier sorts correctly in semver (`rc.10 > rc.9`). The dot-less `rcN` form makes `rc10` a single alphanumeric identifier that sorts _below_ `rc9` — a real footgun past rc9.   |
| Version stamp    | Pass the RC version to `apply-branding` | `apply-branding.sh` strips the leading `v` and stamps `5.0.0-rc.0`, which is valid semver (`new SemVer('5.0.0-rc.0')` succeeds). The server reports its true version, not the nearest tag. |
| Scope            | Server + ML only                        | Mobile releases independently (`gallery-build-mobile.yml`), matching the current decoupled split. RC testers get mobile via that separate pipeline.                                        |
| ML matrix        | cpu + cuda + openvino                   | Mirrors the GA release matrix so RC testers on any inference backend can actually test.                                                                                                    |
| Version endpoint | Never published                         | See constraint above.                                                                                                                                                                      |

## Workflow shape

`workflow_dispatch` inputs:

- `version` (required) — validated against `^v[0-9]+\.[0-9]+\.[0-9]+-rc\.[0-9]+$`
  (e.g. `v5.0.0-rc.0`). Rejects GA versions and typos.
- `commit` (optional) — SHA to release up to; defaults to HEAD of the dispatched
  ref. Reuses the GA workflow's "must be an ancestor of the triggering ref"
  check so only merged commits ship.

Jobs:

1. **`validate`** — check the `version` shape; resolve/verify `commit`.
2. **`build-server`** (matrix: `linux/amd64`, `linux/arm64`) — `apply-branding`
   **with `version`**, build + push-by-digest to
   `ghcr.io/open-noodle/gallery-server`.
3. **`merge-server`** — `docker buildx imagetools create -t gallery-server:<version>`
   from the per-arch digests. **Only** the `<version>` tag — no `release`/`vN`/`latest`.
4. **`build-ml`** (matrix: cpu/cuda/openvino × platforms per GA workflow) —
   `apply-branding` with `version`, build + push-by-digest to `gallery-ml`.
5. **`merge-ml`** (matrix: cpu → ``, cuda → `-cuda`, openvino → `-openvino`) —
`imagetools create -t gallery-ml:<version><suffix>`.
6. **`tag-and-release`**:
   - Create the annotated git tag `<version>` at the resolved SHA. **Does not**
     move `release` / `vN` / `latest`.
   - `gh release create <version> --prerelease` (never `--latest`) with
     auto-generated notes and `docker/docker-compose.yml` + `docker/example.env`
     attached.
   - Notes header: testing instructions ("set `IMMICH_VERSION=<version>` in your
     `.env`, then `docker compose pull && docker compose up -d`"), followed by
     the commit list since the previous release/RC (reuse the GA workflow's
     gallery-vs-upstream commit split).

Explicitly **absent**: any `publish-version-endpoint` job, any floating-tag
moves, any `--latest` marking, any branch guard restricting to `main`.

## How it is dispatched (branch mechanics)

`workflow_dispatch` runs the workflow file _as it exists on the selected ref_.
The v5 work lives on the rolling branch
(`rebase/upstream-rolling-20260509-active`), so to cut `v5.0.0-rc.0` the workflow
file must be present on that branch. Plan:

- Land the workflow on `main` (default branch → visible/dispatchable in the
  Actions UI, carried into future rebases as a fork commit).
- Ensure it is present on the current rolling branch (it is replayed as a fork
  commit on the next rebase; for an immediate cut, add it to the rolling branch
  directly).

## Cleanup of ad-hoc RC images

The earlier throwaway RC builds left `v5.0.0-rc1` and `v5.0.0-rc5` tagged in both
`gallery-server` and `gallery-ml`. Since the series restarts clean at `rc.0`,
these four tagged versions are deleted so the registry shows a single coherent
`rc.N` series. (Requires `delete:packages` scope on the `gh` token.)

## Verification plan

- YAML/action lint (the repo pins action SHAs; keep the same pinned versions).
- Dry-run reasoning: confirm `merge-*` jobs emit only the `<version>`(+suffix)
  tags and that no job references the Bunny endpoint vars.
- First real cut of `v5.0.0-rc.0` from the rolling branch: verify the pushed
  image reports version `5.0.0-rc.0` at `/api/server/about`, the GitHub Release
  is marked pre-release and **not** latest, and the `/gallery` endpoint is
  unchanged.
