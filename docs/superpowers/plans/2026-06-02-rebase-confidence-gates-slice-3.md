# Rebase Confidence Gates Slice 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `make gallery-branding-check` so rebase operators can run the real Gallery branding verification locally without dirtying the active worktree.

**Architecture:** Add a small shell wrapper under `branding/scripts/` that creates a temporary detached Git worktree at the current `HEAD`, runs the existing branding dependency/template/apply/verify scripts there, removes the temporary worktree on success or failure, and verifies the active worktree status is unchanged. Wire the wrapper through `Makefile`, then let the existing `rebase-confidence-check` availability detection replace the Slice 1 planned branding line with the exact `make gallery-branding-check` command.

**Tech Stack:** Bash, Git worktrees, Make, TypeScript/Vitest upstream-preflight tests, existing branding scripts.

---

## File Structure

- Create `branding/scripts/gallery-branding-check.sh`
  - Runs the existing branding checks in a temporary detached worktree.
  - Cleans the temporary worktree on success and failure.
  - Verifies the active worktree status after cleanup matches the status before the check started.
- Modify `Makefile`
  - Add `.PHONY: gallery-branding-check`.
  - Add target that runs `branding/scripts/gallery-branding-check.sh`.
- Modify `tools/upstream-preflight/src/cli-wiring.spec.ts`
  - Add static test coverage for the Make target and wrapper script safety structure.
- Modify `tools/upstream-preflight/src/audits/rebase-confidence.spec.ts`
  - Update the real-repo availability test so it expects `make gallery-branding-check` once the target exists while still expecting future Slice 4/5 checks to remain planned.

## Task 1: Red Tests For Branding Target Wiring

**Files:**
- Modify: `tools/upstream-preflight/src/cli-wiring.spec.ts`
- Modify: `tools/upstream-preflight/src/audits/rebase-confidence.spec.ts`

- [ ] **Step 1: Add failing Makefile and wrapper structure tests**

Patch `tools/upstream-preflight/src/cli-wiring.spec.ts`:

```ts
  it('exposes a local Gallery branding verification Make target', () => {
    const makefile = fs.readFileSync(
      path.resolve(process.cwd(), '../../Makefile'),
      'utf8',
    );

    expect(makefile).toContain('.PHONY: gallery-branding-check');
    expect(makefile).toContain(
      'branding/scripts/gallery-branding-check.sh',
    );
  });

  it('keeps the Gallery branding check isolated in a temporary worktree', () => {
    const script = fs.readFileSync(
      path.resolve(
        process.cwd(),
        '../../branding/scripts/gallery-branding-check.sh',
      ),
      'utf8',
    );

    expect(script).toContain('trap cleanup EXIT');
    expect(script).toContain('git -C "$REPO_ROOT" worktree add');
    expect(script).toContain('git -C "$REPO_ROOT" worktree remove --force');
    expect(script).toContain(
      'ruby .github/actions/apply-branding/dependencies_test.rb',
    );
    expect(script).toContain(
      'branding/scripts/test-email-branding.sh',
    );
    expect(script).toContain(
      'branding/scripts/test-app-download-branding.sh',
    );
    expect(script).toContain('branding/scripts/apply-branding.sh');
    expect(script).toContain('branding/scripts/verify-branding.sh');
    expect(script).toContain('active worktree status changed');
  });
```

These tests intentionally inspect the exact wrapper structure because the main behavioral guarantee is shell isolation and cleanup.

- [ ] **Step 2: Update the real-repo confidence availability expectation**

In `tools/upstream-preflight/src/audits/rebase-confidence.spec.ts`, change the test named `does not emit runnable commands for missing repo targets and workflows` to:

```ts
  it('emits available local commands while keeping missing future workflows planned', () => {
    const results = runRebaseConfidenceAudits({
      upstreamTouchedFiles: [
        'mobile/lib/routing/router.dart',
        'server/Dockerfile',
        'machine-learning/Dockerfile',
      ],
      batch: '176',
      cwd: path.resolve(process.cwd(), '../..'),
      workflowTexts: {
        '.github/workflows/gallery-rc-build.yml': minimalWorkflow,
        '.github/workflows/gallery-release-server-only.yml': minimalWorkflow,
        '.github/workflows/gallery-release-mobile.yml': minimalWorkflow,
        '.github/workflows/gallery-build-mobile.yml': minimalWorkflow,
      },
    });
    const details = results.find(
      (result) => result.title === 'Risk-Based Confidence Requirements',
    )?.details;

    expect(details).toContain(
      'make gallery-branding-check (required by docker: server/Dockerfile, machine-learning/Dockerfile)',
    );
    expect(details).not.toContain(
      'planned Slice 3 check: make gallery-branding-check (target missing; required by docker: server/Dockerfile, machine-learning/Dockerfile)',
    );
    expect(details).toContain(
      'planned Slice 4 workflow: gallery-mobile-smoke.yml (workflow missing; required by mobile: mobile/lib/routing/router.dart)',
    );
    expect(details).toContain(
      'planned Slice 5 check: make gallery-ml-smoke (target missing; required by docker: server/Dockerfile, machine-learning/Dockerfile; ml: machine-learning/Dockerfile)',
    );
    expect(details).not.toContain(
      'gh workflow run gallery-mobile-smoke.yml --ref rebase/upstream-batch-176 (required by mobile: mobile/lib/routing/router.dart)',
    );
  });
```

- [ ] **Step 3: Run focused tests to verify RED**

Run:

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
pnpm --filter @gallery/upstream-preflight run test -- src/cli-wiring.spec.ts src/audits/rebase-confidence.spec.ts
```

Expected: FAIL because `gallery-branding-check` is not in `Makefile`, `branding/scripts/gallery-branding-check.sh` does not exist, and the real-repo availability test still sees the planned Slice 3 line.

## Task 2: Implement The Branding Check Wrapper And Make Target

**Files:**
- Create: `branding/scripts/gallery-branding-check.sh`
- Modify: `Makefile`

- [ ] **Step 1: Create the shell wrapper**

Add `branding/scripts/gallery-branding-check.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TMP_ROOT=""
CHECK_WORKTREE=""
INITIAL_STATUS="$(git -C "$REPO_ROOT" status --short)"

cleanup() {
  local status=$?
  set +e

  if [[ -n "$CHECK_WORKTREE" ]]; then
    git -C "$REPO_ROOT" worktree remove --force "$CHECK_WORKTREE" >/dev/null 2>&1
  fi
  if [[ -n "$TMP_ROOT" ]]; then
    rm -rf "$TMP_ROOT"
  fi

  local final_status
  final_status="$(git -C "$REPO_ROOT" status --short)"
  if [[ "$final_status" != "$INITIAL_STATUS" ]]; then
    echo "ERROR: gallery-branding-check active worktree status changed" >&2
    echo "Before:" >&2
    printf '%s\n' "$INITIAL_STATUS" >&2
    echo "After:" >&2
    printf '%s\n' "$final_status" >&2
    exit 1
  fi

  exit "$status"
}
trap cleanup EXIT

if [[ "$(uname)" == "Darwin" ]]; then
  export PATH="/opt/homebrew/opt/gnu-sed/libexec/gnubin:/opt/homebrew/opt/coreutils/libexec/gnubin:$PATH"
fi

TMP_ROOT="$(mktemp -d)"
CHECK_WORKTREE="$TMP_ROOT/worktree"

echo "=== Gallery branding check ==="
echo "Creating temporary worktree at $CHECK_WORKTREE"
git -C "$REPO_ROOT" worktree add --quiet --detach "$CHECK_WORKTREE" HEAD

cd "$CHECK_WORKTREE"

echo "--- Checking branding action dependencies ---"
ruby .github/actions/apply-branding/dependencies_test.rb

echo "--- Checking email branding transform ---"
branding/scripts/test-email-branding.sh

echo "--- Checking app download branding transform ---"
branding/scripts/test-app-download-branding.sh

echo "--- Applying branding overlay ---"
branding/scripts/apply-branding.sh

echo "--- Verifying applied branding ---"
branding/scripts/verify-branding.sh

echo "=== Gallery branding check passed ==="
```

The wrapper intentionally compares the active worktree status before and after the run. If the caller started clean, it must end clean. If the caller had unrelated local changes, the wrapper must not add, remove, or mutate them.

- [ ] **Step 2: Make the wrapper executable**

Run:

```bash
chmod +x branding/scripts/gallery-branding-check.sh
```

- [ ] **Step 3: Add the Make target**

Patch `Makefile` near the other rebase confidence targets:

```make
.PHONY: gallery-branding-check
gallery-branding-check:
	branding/scripts/gallery-branding-check.sh
```

- [ ] **Step 4: Run focused tests to verify GREEN**

Run:

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
pnpm --filter @gallery/upstream-preflight run test -- src/cli-wiring.spec.ts src/audits/rebase-confidence.spec.ts
```

Expected: PASS.

## Task 3: Command Verification And Worktree Cleanliness

**Files:**
- No file edits expected unless verification exposes a bug.

- [ ] **Step 1: Capture active worktree status**

Run:

```bash
git status --short
```

Expected before the command: only the Slice 3 implementation files are dirty if the implementation has not been committed yet. If the implementer has already committed the slice for command verification, expected output is empty.

- [ ] **Step 2: Run the local branding check**

Run:

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
make gallery-branding-check
```

Expected: PASS. The output must show these steps in order:

```text
--- Checking branding action dependencies ---
--- Checking email branding transform ---
--- Checking app download branding transform ---
--- Applying branding overlay ---
--- Verifying applied branding ---
=== Gallery branding check passed ===
```

If local dependencies are missing, the command should fail through the relevant branding script with a normal nonzero exit. Do not silently skip the check.

- [ ] **Step 3: Verify the active worktree status is unchanged**

Run:

```bash
git status --short
```

Expected: same output as Step 1. If the slice has already been committed, this must be empty.

## Task 4: Final Verification And Commit

- [ ] **Step 1: Run upstream-preflight full test suite**

Run:

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
pnpm --filter @gallery/upstream-preflight run test
```

Expected: PASS.

- [ ] **Step 2: Run upstream-preflight typecheck**

Run:

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
pnpm --filter @gallery/upstream-preflight run check
```

Expected: PASS.

- [ ] **Step 3: Run upstream-preflight formatting check**

Run:

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
pnpm --filter @gallery/upstream-preflight run format
```

Expected: PASS. If formatting fails only for changed files, run `pnpm --filter @gallery/upstream-preflight run format:fix`, then re-run format.

- [ ] **Step 4: Run the confidence check with Slice 3 availability**

Run:

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
make rebase-confidence-check BATCH=175
```

Expected: PASS. The `Risk-Based Confidence Requirements` section should now include the runnable branding command and should still leave future Slice 5 ML checks planned:

```text
OK: Risk-Based Confidence Requirements
- make gallery-branding-check (required by docker: server/Dockerfile)
- planned Slice 5 check: make gallery-ml-smoke (target missing; required by docker: server/Dockerfile)
- planned Slice 5 workflow: gallery-ml-smoke.yml (workflow missing; required by docker: server/Dockerfile)
```

- [ ] **Step 5: Commit**

Run:

```bash
git status --short
git add Makefile branding/scripts/gallery-branding-check.sh tools/upstream-preflight/src/cli-wiring.spec.ts tools/upstream-preflight/src/audits/rebase-confidence.spec.ts docs/superpowers/plans/2026-06-02-rebase-confidence-gates-slice-3.md
git commit -m "feat(rebase): add gallery branding check"
```

Expected: commit created with red/green evidence in the implementer report.
