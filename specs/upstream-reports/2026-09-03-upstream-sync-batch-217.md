# Upstream Sync Report — 2026-09-03 (batch 217)

## Summary

- **Upstream commits pulled**: 1 (`fa8a191aaa7` → `26a25f0c3ab`)
- **Fork commits synced from `origin/main`**: 0
- **Conflicts resolved**: 0
- **Fork-side repairs bundled**: none
- **Risk level**: LOW
- **Recommendation**: PROCEED

The smallest cycle of the arc so far: a single upstream commit, confined to the
Rockchip NPU session pool in `machine-learning/`, and no fork commits pending.
The rebase applied with zero conflicts, and the whole-tree diff against the last
10/10-green tip is **exactly** upstream's own three files with identical stats —
so no fork line was disturbed anywhere in the tree.

## Incoming Upstream Changes

| SHA           | Summary                                                              | Area | Risk to Fork | Notes                                                                                                                                                 |
| ------------- | -------------------------------------------------------------------- | ---- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `26a25f0c3ab` | fix(ml): race when submitting to rknn execution queue (immich-31143) | ML   | LOW          | Replaces `RknnPoolExecutor.put()`/`get()` (a `Queue` of `Future`s) with a single lock-guarded `run()`. The fork owns no RKNN code and adds no caller. |

### What the commit actually does

The old pool submitted work with `put()` and collected it with `get()`, keeping a
`Queue[Future]` and a `self.num` round-robin counter mutated without a lock. Two
concurrent `RknnSession.run()` calls could interleave between `put` and `get` and
collect each other's futures. Upstream collapses the pair into one `run()` that
takes a `threading.Lock` only to pick the device index, then blocks on its own
future — so the result can no longer be handed to the wrong caller.

### Product-direction gate

**Did not fire.** This is a thread-safety fix inside a hardware-accelerator
session pool. It introduces no feature, reshapes no data model or sync contract,
and touches none of the fork surfaces the gate protects (sharing / Shared Spaces,
faces & people, albums, timeline, library, storage, memories, search, RBAC).

### Zero-conflict semantic-break gate

Run before the rebase; **nothing fired**. Evidence:

- **Deleted symbols** (`put`, `get`, `Queue`, `Future`): the fork adds no caller.
  The only fork-adjacent reference is `machine-learning/conftest.py:155`, which is
  a `mock.patch("immich_ml.sessions.rknn.RknnPoolExecutor")` — an auto-speccing
  mock whose attributes follow the class, so it needs no edit.
- **Deleted literals**: the commit removes no string literal, so the
  branding/`sed` silent-no-op detector has nothing to match.
- **Shape I / renames**: `--diff-filter=A` and `--diff-filter=R` are both empty —
  no file created or renamed onto a path fork history ever owned.
- **Shape H (dependency behaviour)**: no dependency, lockfile or base image moved.
- **Shape J (enumerated sets)**: no spec enumerates RKNN members.
- **`machine-learning/test_main.py` is fork-extended** (+244 lines of pet-detection
  tests across 5 fork commits) and upstream edits one assertion in it, so this was
  the one real conflict candidate. `git log -L 560,575` over the fork range
  confirmed **no fork commit touches that region**, and the replay bore that out.

## Conflict Resolutions

None — the batch rebased cleanly.

## Fork Content Survival

The decisive check for this cycle. Diffing the pre-cycle tip against the new tip:

```
git diff 9f6c3cb7765..HEAD --stat
 machine-learning/immich_ml/sessions/rknn/__init__.py |  3 +--
 machine-learning/immich_ml/sessions/rknn/rknnpool.py | 18 ++++++++----------
 machine-learning/test_main.py                        |  2 +-
 3 files changed, 10 insertions(+), 13 deletions(-)
```

That is byte-for-byte the stat of upstream's own commit, so every fork line in the
tree is untouched. Spot checks confirm both directions landed:

- Upstream's fix is present: `rknnpool.py` has `run()` + `threading.Lock` and no
  `put`/`get`; `sessions/rknn/__init__.py:67` calls `self.rknnpool.run(...)`;
  `test_main.py:571` asserts on `.run`.
- Fork content is intact: the pet-detection tests and the fork's `cv_image`
  fixture in `conftest.py` are both still present.

## Post-Rebase Audits

| Check                               | Status | Notes                                             |
| ----------------------------------- | ------ | ------------------------------------------------- |
| Fork-Owned File Survival            | OK     | all literal fork-owned files present              |
| Fork Extension Symbol Survival      | OK     | all manifest symbols present                      |
| Gallery Migration Count             | OK     | 62 (expected 62)                                  |
| Gallery Migration Filename Survival | OK     |                                                   |
| Gallery Migration Manifest Coverage | OK     |                                                   |
| Migration Timestamp Collision Check | OK     | no upstream/Gallery collision                     |
| Generated Artifact Review           | OK     | no generated artifact needs review                |
| Generated Query Block Survival      | OK     | no query block lost vs baseline                   |
| `fork-patches-check`                | OK     | `@immich/ui` patch metadata consistent            |
| `ci-invariants-check`               | OK     | 5/5, incl. `search-v3-not-dispatched`             |
| `mobile-drift-rebase-check`         | OK     | schemaVersion, snapshots, Gallery callbacks agree |
| `commit-autolink-check`             | OK     | 1413 messages scanned, fork PR ceiling 1060       |

## Generated Artifacts

No regeneration was required, and none was run:

- **OpenAPI / SQL queries**: nothing under `server/src/controllers/`, `dtos/` or
  `repositories/` changed — `server/` is tree-identical to the last green tip.
- **Mobile codegen**: `mobile/` is tree-identical.
- **`revert-to-immich.sql`**: the batch adds no migration and `branding/config.json`
  `upstream.version` is unchanged (3.1.0), so migration coverage is unchanged from
  a state that already passed this gate.

## Local CI Verification

Scoped by tree identity against `9f6c3cb7765`, the tip that went 10/10 green on
2026-09-02. Every top-level area is **IDENTICAL** except `machine-learning/`:

```
IDENTICAL  server web open-api packages i18n .github docker deployment
IDENTICAL  branding e2e mobile docs tools scripts specs
CHANGED    machine-learning
```

So the applicable local gate is the ML block (which no `tsc`, `svelte-check`,
`dart analyze` or post-rebase audit can see), plus the fork's own preflight suite:

| Check                             | Status | Notes                              |
| --------------------------------- | ------ | ---------------------------------- |
| `uv sync --locked --extra cpu`    | PASS   | lock and `pyproject.toml` agree    |
| `uv run ruff format immich_ml`    | PASS   | 31 files unchanged                 |
| `uv run ruff check immich_ml`     | PASS   | all checks passed                  |
| `uv run mypy --strict immich_ml/` | PASS   | no issues in 31 source files       |
| `uv run pytest`                   | PASS   | **117 passed, 3 skipped** (exit 0) |
| `tools/upstream-preflight` vitest | PASS   | 24 files / 257 tests               |

The preflight suite was run despite `tools/` being identical: it re-implements
third-party tool behaviour (openapi-generator's type mapping) and is therefore a
gate upstream can invalidate at a distance, as it did in the previous cycle.

## Inconsistencies Found

None.

Two zero-byte tracked files (`CODEOWNERS`, `docs/static/CNAME`) surfaced in the
Shape-I corollary scan. Both are **pre-existing** — `git cat-file -s origin/main:<path>`
reports size 0 for each — so neither is a delete/modify artefact of this rebase.

## Pattern Propagation

No broad upstream refactor in this batch.

## Fork Surface / Skill Anchor

The anchor scan (`git log d44f0d2dece..origin/main`) returns nothing — no fork PR
merged to `main` since the last cycle, so `references/fork-surface.md` needs no new
rows and the anchor stays at `d44f0d2dece`.

## Remote CI Verification

- **Test branch**: `rebase/upstream-batch-217`
- **Commit validated**: `8975230ac6ce6ad69257cdf1dbadb56e83409143`
- **Result**: **10 / 10 green**

| Workflow                                  | Status | Notes                         |
| ----------------------------------------- | ------ | ----------------------------- |
| `test.yml`                                | GREEN  | green on re-run (flake below) |
| `docker.yml`                              | GREEN  | first try                     |
| `static_analysis.yml`                     | GREEN  | first try                     |
| `gallery-build-mobile.yml`                | GREEN  | first try                     |
| `gallery-rebase-smoke.yml`                | GREEN  | first try                     |
| `storage-migration-tests.yml`             | GREEN  | first try                     |
| `storage-migration-e2e.yml`               | GREEN  | first try                     |
| `gallery-revert-to-immich-validation.yml` | GREEN  | green on re-run (flake below) |
| `gallery-ml-smoke.yml`                    | GREEN  | first try                     |
| `gallery-mobile-smoke.yml`                | GREEN  | first try                     |

### Confirmed flakes — all self-inflicted by an unstaggered dispatch

The first round reported four failing jobs across two workflows. **Every one died
in infrastructure before running a single assertion**, and all were the container
registry rate limit that the skill warns about when workflows are dispatched
simultaneously:

| Job                                  | Failing step                                      | Error                                           |
| ------------------------------------ | ------------------------------------------------- | ----------------------------------------------- |
| SQL Schema Checks                    | Initialize containers                             | `toomanyrequests: allowed: 44000/minute`        |
| End-to-End Tests (Server & CLI, arm) | Start Docker Compose                              | `toomanyrequests: allowed: 44000/minute`        |
| Validate revert-to-immich.sql        | Run validation → `pre: pull immich-server:v3.1.0` | `toomanyrequests: allowed: 44000/minute`        |
| ShellCheck                           | Download shellcheck                               | curl exit 35 (SSL connect); later steps skipped |

`End-to-End Tests Success` was the aggregate gate reporting the arm above, not a
fifth failure.

Two facts identified these as infrastructure before the re-run, rather than after:

1. `server/`, `scripts/` and `.github/` are **byte-identical** to the tip that went
   10/10 green the previous day, so those jobs contain no changed code at all.
2. The revert gate's **coverage grep job — the half that reads branch code —
   passed**; only its Docker-boot half, which pulls a published image, failed.

Both workflows were re-run **staggered** (150 s apart) and came back
`completed|success` with zero failing jobs, confirming the diagnosis.

**Process note for the next cycle**: dispatching all ten workflows in one loop is
what tripped the 44000/minute limit. Stagger the dispatch, as the skill's step 10
already advises for re-dispatches — it applies to the first dispatch too.
