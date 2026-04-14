# Revert-to-Immich nightly validation workflow — design

**Date:** 2026-04-14
**Status:** Approved design, awaiting implementation
**Related:** `scripts/revert-to-immich.sql` (landed 2026-04-14)

## Problem

`scripts/revert-to-immich.sql` lets a user who ran Gallery without a pg_dump
reset their database to a state where upstream Immich will start cleanly. The
script is only useful if it actually works — and the set of things it must
clean up grows every time Gallery adds a fork migration. There is currently
no automated check that the script stays in sync with `migrations-gallery/`.

The failure mode we care about is silent drift: a new Gallery migration adds
a table or column, nobody updates the revert script, and a user runs the
(now-stale) script months later and bricks their database. We want a nightly
job that catches this within 24 hours of the drift-causing commit.

## Pass criterion

After running the revert script, upstream Immich must:

1. Respond to `GET /api/server/ping` within 180 seconds of start (HTTP 200), and
2. Boot without logging any schema drift warnings.

- No data-preservation checks (no "did my test user survive")
- No full e2e test suite
- No ML, no web, no microservices split — just the API worker booting

### Why both conditions matter

`NestFactory.create(ApiModule)` awaits `DatabaseService.onModuleInit`, which
calls `runMigrations()` and only then starts the HTTP listener (verified at
`server/src/services/database.service.ts:126` and
`server/src/app.common.ts:90`). So a 200 from `/api/server/ping` proves the
kysely migrator accepted `kysely_migration`'s contents and ran to completion
— that catches the classic "corrupted migrations" hard failure.

**But it does not catch schema drift.** Right after `runMigrations()`,
`database.service.ts:128-135` calls `getSchemaDrift()` and, if drift is
found, emits `this.logger.warn(${ErrorMessages.SchemaDrift} ...)` and
**continues booting**. The HTTP server starts, `/api/server/ping` returns
200, and the test passes — even though the revert script left behind a
Gallery column or table that Immich didn't know about. That is precisely
the regression we want the nightly to catch, so the pass criterion has to
include a log-grep for "schema drift".

Data-preservation validation is still deferred — the ping + no-drift combo
catches every regression the revert script itself can introduce, because
every Gallery-only schema object omitted from the script is reported as
drift at boot. If that assumption ever changes we can layer seeding on
later.

## Location and triggers

`.github/workflows/gallery-revert-to-immich-validation.yml` — the `gallery-*`
prefix matches the repository's convention for fork-only workflows
(`gallery-build-mobile.yml`, `gallery-release.yml`, etc.).

```yaml
on:
  schedule:
    - cron: '0 5 * * *'  # 05:00 UTC nightly — leaves ~1h buffer after late-night
                         # main merges so docker.yml has time to publish :main
  workflow_dispatch:
    inputs:
      gallery_image:
        description: 'Gallery server image tag to test'
        default: 'ghcr.io/open-noodle/immich-server:main'
        required: true

concurrency:
  group: gallery-revert-validation
  cancel-in-progress: false

permissions:
  contents: read
  packages: read
```

The default `ghcr.io/open-noodle/immich-server:main` is the tag that
`.github/workflows/docker.yml` publishes on every push to `main` (confirmed
at `docker.yml:96-102`). The compose file's `ghcr.io/open-noodle/gallery-server`
is a release-only alias published by `gallery-release.yml`. Manual dispatches
can override the tag to target `pr-123`, `commit-<sha>`, or any other tag
`docker.yml` publishes for in-flight work.

## Job

Single `validate` job, `runs-on: ubuntu-latest`, `timeout-minutes: 15`.

### Env

```yaml
env:
  POSTGRES_IMAGE: ghcr.io/immich-app/postgres:14-vectorchord0.4.3-pgvectors0.2.0@sha256:bcf63357191b76a916ae5eb93464d65c07511da41e3bf7a8416db519b40b1c23
  REDIS_IMAGE: docker.io/valkey/valkey:9@sha256:3b55fbaa0cd93cf0d9d961f405e4dfcc70efe325e2d84da207a0a8e6d8fde4f9
  NETWORK_NAME: immich-revert-test
  DB_USERNAME: postgres
  DB_PASSWORD: postgres
  DB_DATABASE_NAME: immich
  GALLERY_IMAGE: ${{ inputs.gallery_image || 'ghcr.io/open-noodle/immich-server:main' }}
```

`POSTGRES_IMAGE` and `REDIS_IMAGE` are lifted verbatim from
`docker/docker-compose.yml` (including SHA256 pins) so the test runs the
same images a user would run in production.

Notable absence: no `JWT_SECRET`, admin email, or other secrets. Verified
against `docker/docker-compose.yml` — Immich bootstraps without them for a
ping-only test. If that changes upstream, the server boot will fail loudly
in the pre-phase and the workflow will point at the missing env var.

### Step sequence

1. **Checkout** — `actions/checkout@v4` pinned by commit SHA.
2. **ghcr login** — `docker/login-action` with `${{ github.token }}`. Cheap
   belt-and-braces in case `open-noodle/*` packages are private now or
   become private later; no-op for public packages.
3. **Determine upstream version** — inline in a later shell step:
   `UPSTREAM_TAG=v$(jq -r .version server/package.json)`. Gallery's
   `server/package.json` tracks the upstream Immich version Gallery is
   rebased from (current value `2.7.5`, confirmed against the latest
   upstream-sync report). Rebasing onto a new Immich version automatically
   bumps this file, so the workflow auto-follows Gallery's base without
   manual edits.
4. **Create docker network** — `docker network create "$NETWORK_NAME"`.
5. **Start postgres** — `docker run -d --name database --network "$NETWORK_NAME"
   -e POSTGRES_USER -e POSTGRES_PASSWORD -e POSTGRES_DB
   -e POSTGRES_INITDB_ARGS=--data-checksums "$POSTGRES_IMAGE"`.
   Container name `database` matches the server's default `DB_HOSTNAME`
   (verified at `server/src/repositories/config.repository.ts:248`), so no
   `DB_HOSTNAME` env plumbing is needed.
6. **Start redis** — `docker run -d --name redis --network "$NETWORK_NAME" "$REDIS_IMAGE"`.
   Same default-hostname trick.
7. **Wait for postgres** — `docker exec database pg_isready -U postgres`
   in a loop up to **60s**. Using `docker exec` rather than host-side
   `pg_isready` because `ubuntu-latest` does not ship `postgresql-client`
   by default. The 60s cap (up from 30s in the first draft) gives
   `--data-checksums` initdb enough headroom on a congested runner.
8. **Boot upstream Immich (pre-phase)** — explicit `docker pull` (for clean
   error messages if the tag is gone) then `docker run -d --name server
   --network "$NETWORK_NAME" -p 2283:2283
   -e DB_USERNAME -e DB_PASSWORD -e DB_DATABASE_NAME
   "ghcr.io/immich-app/immich-server:$UPSTREAM_TAG"`. Then `wait_for_server
   pre` (see below). On success, `docker stop server && docker rm server`
   (`rm -f` is synchronous on Linux, so `:2283` releases before the next
   `docker run` binds it — no `sleep` needed). This phase seeds
   `kysely_migration` with all upstream rows — the realistic "I was running
   Immich before Gallery" starting point.

   **No `/data` volume mount.** The ping-only test does not write anything
   to `/data`. Skipping the mount avoids a permissions footgun where a
   GHA-owned `mktemp -d` dir (`0700` on the runner user) would be unwritable
   by the container's non-root user on first write.
9. **Boot Gallery phase** — same pattern with `${GALLERY_IMAGE}`. Gallery's
   migrator applies the 27 fork migrations (using
   `allowUnorderedMigrations: true`, so interleaved timestamps work against
   the pre-seeded upstream rows). `wait_for_server gallery`, stop, rm.
10. **Sanity check that Gallery actually ran** —
    ```bash
    gallery_rows=$(docker exec database psql -U postgres -d immich -Atc \
      "SELECT count(*) FROM kysely_migration WHERE name LIKE '%SharedSpace%'")
    if [ "$gallery_rows" -eq 0 ]; then
      echo "::error::Gallery phase applied 0 SharedSpace migrations — \
    GALLERY_IMAGE is probably pointing at an upstream Immich image, not Gallery."
      exit 1
    fi
    ```
    Without this check, pointing the workflow at an upstream-only image by
    mistake would give a vacuous pass: no Gallery rows added → revert script
    is a no-op → post-phase boots cleanly → green check on a test that
    validated nothing. Cheap insurance.
11. **Run revert script** —
    ```bash
    # SET must come BEFORE the script's BEGIN — `cat` appends after `echo`,
    # so the ordering is guaranteed.
    { echo "SET gallery.revert_token = 'i_accept_data_loss';"; \
      cat scripts/revert-to-immich.sql; } | \
      docker exec -i database psql -U postgres -d immich -v ON_ERROR_STOP=1
    ```
    Pipe form guarantees the `SET` and the script's `BEGIN` execute in the
    same psql session in one unambiguous statement stream. The alternative
    `-c "SET..." -f file.sql` form also works (verified locally against a
    throwaway postgres), but the pipe form is more obviously-correct to a
    reviewer.
12. **Boot upstream Immich (post-phase)** — the actual validation. Same
    upstream image, same host port, same network. `wait_for_server post`.
    Failure here means `kysely_migration` still has stale rows or schema
    drift makes the migrator bail.
13. **Schema drift check** — after the post-phase probe succeeds, grep
    server logs for drift warnings:
    ```bash
    if docker logs server 2>&1 | grep -qi 'schema drift'; then
      echo "::error::Schema drift detected after revert — \
    revert-to-immich.sql is missing cleanup for one or more Gallery objects"
      docker logs server
      exit 1
    fi
    ```
    Matches `database.service.ts:133`'s
    `this.logger.warn(${ErrorMessages.SchemaDrift} ...)`. The grep is
    case-insensitive and substring-based to survive minor wording changes.
    This is the step that turns "catches most regressions" into "catches
    every regression the revert script can cause."
14. **Cleanup** — `if: always()` step:
    ```bash
    docker rm -f server database redis || true
    docker network rm "$NETWORK_NAME" || true
    ```
    Separate lines so the second command still runs if the first partially
    fails. Errors ignored because a failed earlier step may have already
    torn down some resources.

### Health probe helper

```bash
wait_for_server() {
  local phase=$1
  local deadline=$(( $(date +%s) + 180 ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if curl -fsS http://localhost:2283/api/server/ping >/dev/null 2>&1; then
      echo "::notice::${phase}: /api/server/ping OK"
      return 0
    fi
    sleep 2
  done
  echo "::error::${phase}: server did not respond to /api/server/ping within 180s"
  docker logs server || true
  return 1
}
```

Defined once at the top of a multi-step `run:` block and reused. Called as

```bash
if ! wait_for_server pre; then exit 1; fi
```

rather than the shorthand `wait_for_server pre || exit 1` so `set -e`
interacts cleanly with the helper's own `return 1` path.

`/api/server/ping` is the correct health route: verified at
`server/src/controllers/server.controller.ts:67`
(`@Controller('server')` + `@Get('ping')`). 200 OK means the HTTP layer is
up, which in turn means the migrator completed — which is exactly the signal
we want.

## Failure modes and their signals

| Scenario                                              | Where it fires     | How it surfaces                                             |
| ----------------------------------------------------- | ------------------ | ----------------------------------------------------------- |
| Upstream image tag gone                               | pre-phase pull     | `docker pull` exits non-zero, `::error::` annotation        |
| Gallery image missing or private                      | Gallery pull       | same                                                        |
| Upstream boot broken (unrelated to this test)         | pre-phase probe    | 180s timeout, `docker logs server` dumped                   |
| Gallery migration broken                              | Gallery probe      | same, with Gallery logs                                     |
| Gallery image is actually upstream Immich (wrong tag) | Gallery sanity step | `SELECT count(*) ... LIKE '%SharedSpace%'` = 0, hard error   |
| Revert SQL syntax error                               | revert step        | `ON_ERROR_STOP=1` exits psql non-zero, step fails           |
| Revert SQL leaves a stale `kysely_migration` row      | post-phase probe   | `NestFactory.create` throws, 180s timeout, logs dumped      |
| Revert SQL leaves schema drift (a table or column)    | drift-check step   | **the headline failure mode.** log grep matches, hard error |
| Post-phase takes > 180s on a slow runner              | post-phase probe   | False positive. If we see one flake, bump to 240s. Don't pre-optimize. |

## YAGNI

Explicitly not doing:

- Building the Gallery image from source. The published `:main` tag is ~30s
  to pull and lags HEAD by at most one `docker.yml` run; a fresh build would
  add ~10 min for marginal signal.
- A matrix over multiple upstream Immich versions. The revert script targets
  exactly one upstream version at a time (whatever Gallery's current base
  is). Testing the base is sufficient; we'll rebuild the check if the policy
  changes.
- Slack or GitHub issue auto-filing on failure. GitHub Actions' built-in
  email-on-failure is enough for the cadence.
- Seeding test data / asserting Immich-native row preservation. Deferred —
  the ping-only check catches every failure mode we know about today.

## Review outcomes

### First review (code-reviewer subagent, pre-doc)

1. **`UPLOAD_TMP` was undefined** in the draft; first fix added `mktemp -d`
   and mounted it into each server boot (superseded below).
2. **`pg_isready` was called on the GHA host**; `ubuntu-latest` doesn't
   ship `postgresql-client` by default. Fixed by switching to `docker exec
   database pg_isready`.
3. **GUC carryover via `-c "SET..." -f file.sql`** is correct but
   non-obvious; switched to an explicit pipe that makes the single-session
   guarantee visible at a glance.
4. **Image pulls were implicit** inside `docker run`; added explicit
   `docker pull` so pull errors surface cleanly with annotations.
5. **Concurrency guard missing**; added.
6. Timeout dropped 30 → 15 min.

### Second review (`/review` on this doc)

Caught that the pass criterion as originally written was **weaker than
claimed**. Issues fixed in this revision:

1. **Schema drift was a silent pass.** `database.service.ts:130` emits
   `logger.warn` and keeps going when drift is found, so the original
   `/api/server/ping` check would pass even on a broken revert script.
   Added step 13 (schema drift log grep) and rewrote the "Pass criterion"
   section to state both conditions.
2. **No sanity check that Gallery phase actually did anything.** If a
   manual dispatch mis-set `gallery_image` to an upstream tag, the entire
   test was vacuous. Added step 10 (`SELECT count(*) ... LIKE '%SharedSpace%'`).
3. **`UPLOAD_TMP` permissions trap** — `mktemp -d` creates `0700` owned
   by the runner user, which the non-root immich container can't write to.
   Since the ping-only test doesn't need `/data`, **dropped the mount
   entirely** rather than chmod-hacking around it (YAGNI win).
4. **Postgres initdb wait 30s was tight** on congested runners; bumped to
   60s.
5. **Cron moved 04:00 → 05:00 UTC** to leave headroom for `docker.yml` to
   publish `:main` after late-night merges.
6. **Port-rebind safety note** added inline next to the pre-phase boot so
   a future reader doesn't add a defensive `sleep`.
7. **Missing failure-mode row** for "Gallery image is actually upstream":
   added.

## Open questions

None blocking. Implementation can proceed.
