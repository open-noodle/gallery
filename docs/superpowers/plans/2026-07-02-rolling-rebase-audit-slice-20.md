# Slice 20 — LOW#3: fix stale `ownership.yml` owned_path

**Spec:** `docs/superpowers/specs/2026-07-02-rolling-rebase-audit-remediation.md` §"Slice 20"
**Findings:** `docs/plans/2026-07-02-rolling-rebase-audit-findings.md` LOW#3
**Branch / worktree:** `rebase/upstream-rolling-20260509-active`

---

## Step A — investigation

`docs/fork/ownership.yml`, feature `release-ci-and-infrastructure` (alias `user-groups`,
line 282) lists an `owned_paths` entry `web/src/lib/components/users/**`. That directory
does not exist on this branch:

```
$ ls web/src/lib/components/users
ls: web/src/lib/components/users: No such file or directory
```

The actual user-group management UI lives at:

- `web/src/lib/components/user-settings-page/group-settings.svelte` — the
  create/list/rename/delete-group panel rendered on the user settings page (imports
  `createGroup`, `getAllGroups`, `removeGroup`, `setMembers`, `updateGroup` from
  `@immich/sdk`, and `UserGroupModal`).
- `web/src/lib/modals/UserGroupModal.svelte` — the create/edit-group modal (name, color,
  member picker) opened from `group-settings.svelte`.

Two other modals (`web/src/lib/modals/SpaceAddMemberModal.svelte`,
`web/src/lib/modals/AlbumAddUsersModal.svelte`) also import `UserGroupResponseDto` and let
a caller pick an existing group to bulk-add its members, but they are consumers of the
user-groups feature (already owned by the spaces/albums surfaces), not the group-management
UI itself — they stay out of scope for this fix.

Replacement: swap the stale glob for the two real paths above (not a broad
`web/src/lib/modals/**`, since that directory is shared by many unrelated features and a
broad glob there would blur ownership rather than fix it).

## Step B — guard, RED first

Extend `tools/upstream-preflight/src/manifest.spec.ts` with a new `describe` block that
loads the **real** `docs/fork/ownership.yml` (not a synthetic fixture) and the real tracked
file list (`git ls-files` at repo root, mirroring the `path.resolve(process.cwd(), '../..')`
repo-root convention already used in `mobile-nav.spec.ts` / `cli-wiring.spec.ts`), then
asserts every feature's `owned_paths` glob (via `micromatch`, `{ dot: true }`, same options
as `coverage.ts`) matches at least one tracked file.

- **Expected RED:** `web/src/lib/components/users/**` (feature
  `release-ci-and-infrastructure`) is the sole offender.
- **Command:** `cd tools/upstream-preflight && npx vitest run src/manifest.spec.ts`

A second assertion (edge case) checks the *replacement* globs resolve to the known
`group-settings.svelte` file, so the guard would also catch a future regression that
deletes/moves the group-settings component without updating ownership.

## Step C — minimal implementation (GREEN)

`docs/fork/ownership.yml` line 282: replace

```yaml
      - web/src/lib/components/users/**
```

with

```yaml
      - web/src/lib/components/user-settings-page/group-settings.svelte
      - web/src/lib/modals/UserGroupModal.svelte
```

No other `owned_path` in the file changes.

## Edge cases covered

- The replacement globs match real, tracked files (RED → GREEN proves this).
- The guard is generic (loops every feature's `owned_paths`), so it also proves no other
  `owned_path` in the manifest is currently stale — a true regression guard, not a
  single-glob patch.
- Non-owned-path glob categories (`upstream_extension_paths`, `optional_paths`,
  `database.migration_globs`, `ci_invariants.paths`, `patches.*`) are intentionally left out
  of scope here — some are documented as intentionally-broad/optional and matching zero
  files is not itself an error for those categories (see `coverage.ts`'s "broad optional"
  concept). Only `owned_paths` — meant to be a strict "this exists in the tree" contract —
  gets the strict guard.

## GREEN commands

```
cd tools/upstream-preflight && npx vitest run src/manifest.spec.ts
```

## Commit

`fix(fork): correct stale user-groups owned_path in ownership.yml (LOW #3)`
