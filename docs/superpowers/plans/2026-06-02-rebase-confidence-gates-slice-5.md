# Rebase Confidence Gates Slice 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local and dispatchable Gallery ML smoke checks, wire exact ML smoke commands into `rebase-confidence-check`, and document the risk-based confidence gate in the upstream rebase process.

**Architecture:** Add `machine-learning/scripts/gallery-ml-smoke.sh` as the single source of truth for the CPU ML container smoke. The script checks Docker availability, builds the CPU ML image from `machine-learning/Dockerfile`, starts a container, waits for Docker health, runs `/ping` through the bundled healthcheck, imports Gallery ML modules inside the container, prints container logs on failure, and cleans the container. Add `make gallery-ml-smoke`, a dispatchable `.github/workflows/gallery-ml-smoke.yml` that applies branding then calls the same script, and static workflow assertions so missing or weakened ML smoke structure fails locally.

**Tech Stack:** Bash, Docker, Make, GitHub Actions, TypeScript/Vitest upstream-preflight tests, existing ML FastAPI `/ping` and Docker `HEALTHCHECK`.

---

## File Structure

- Create `machine-learning/scripts/gallery-ml-smoke.sh`
  - Checks Docker availability and fails clearly if Docker is missing or not running.
  - Builds `gallery-ml-smoke:local` with `DEVICE=cpu`.
  - Runs the container and waits for `healthy`.
  - Executes `python3 healthcheck.py`.
  - Imports `immich_ml.main`, `immich_ml.models`, `immich_ml.config`, and `immich_ml.metrics` inside the container.
  - Prints Docker logs on any failure after container startup.
  - Removes the container on success or failure.
- Modify `Makefile`
  - Add `.PHONY: gallery-ml-smoke`.
  - Add target that runs `machine-learning/scripts/gallery-ml-smoke.sh`.
- Create `.github/workflows/gallery-ml-smoke.yml`
  - Dispatchable with `ref` input.
  - Checks out the requested ref.
  - Applies branding.
  - Sets up Docker Buildx.
  - Runs `machine-learning/scripts/gallery-ml-smoke.sh`.
- Modify `tools/upstream-preflight/src/cli-wiring.spec.ts`
  - Add Make/script static coverage for `gallery-ml-smoke`.
- Modify `tools/upstream-preflight/src/audits/rebase-confidence.ts`
  - Add static assertions for `.github/workflows/gallery-ml-smoke.yml`.
- Modify `tools/upstream-preflight/src/audits/rebase-confidence.spec.ts`
  - Add positive and negative ML smoke workflow assertions.
  - Update real-repo availability-output tests so ML local and remote checks are exact when the target/workflow exists.
- Modify `docs/docs/developer/upstream-rebase-process.md`
  - Document `make rebase-confidence-check BATCH=NN` and its risk-based local/remote checks.

## Task 1: Red Tests For ML Smoke Target And Script Wiring

**Files:**
- Modify: `tools/upstream-preflight/src/cli-wiring.spec.ts`

- [ ] **Step 1: Add failing Makefile and script structure tests**

Patch `tools/upstream-preflight/src/cli-wiring.spec.ts`:

```ts
  it('exposes a local Gallery ML smoke Make target', () => {
    const makefile = fs.readFileSync(
      path.resolve(process.cwd(), '../../Makefile'),
      'utf8',
    );

    expect(makefile).toContain('.PHONY: gallery-ml-smoke');
    expect(makefile).toContain(
      'machine-learning/scripts/gallery-ml-smoke.sh',
    );
  });

  it('checks Docker availability and probes the ML container in the ML smoke script', () => {
    const script = fs.readFileSync(
      path.resolve(
        process.cwd(),
        '../../machine-learning/scripts/gallery-ml-smoke.sh',
      ),
      'utf8',
    );

    expect(script).toContain('Docker is required for gallery-ml-smoke');
    expect(script).toContain('buildx build');
    expect(script).toContain('--load');
    expect(script).toContain('--build-arg DEVICE=cpu');
    expect(script).toContain('"$DOCKER_BIN" run --detach');
    expect(script).toContain('"$DOCKER_BIN" inspect');
    expect(script).toContain('python3 healthcheck.py');
    expect(script).toContain('immich_ml.main');
    expect(script).toContain('immich_ml.models');
    expect(script).toContain('"$DOCKER_BIN" logs');
    expect(script).toContain('"$DOCKER_BIN" rm --force');
  });
```

- [ ] **Step 2: Run focused tests to verify RED**

Run:

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
pnpm --filter @gallery/upstream-preflight run test -- src/cli-wiring.spec.ts
```

Expected: FAIL because `gallery-ml-smoke` is not in `Makefile` and `machine-learning/scripts/gallery-ml-smoke.sh` does not exist.

## Task 2: Implement The Local ML Smoke Script And Make Target

**Files:**
- Create: `machine-learning/scripts/gallery-ml-smoke.sh`
- Modify: `Makefile`

- [ ] **Step 1: Create the smoke script**

Create `machine-learning/scripts/gallery-ml-smoke.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DOCKER_BIN="${GALLERY_ML_SMOKE_DOCKER_BIN:-docker}"
IMAGE_NAME="${GALLERY_ML_SMOKE_IMAGE:-gallery-ml-smoke:local}"
CONTAINER_NAME="${GALLERY_ML_SMOKE_CONTAINER:-gallery-ml-smoke-$$}"
CONTAINER_STARTED=0

cleanup() {
  local status=$?
  set +e

  if [[ "$CONTAINER_STARTED" == "1" ]]; then
    if [[ "$status" -ne 0 ]]; then
      echo "--- gallery-ml-smoke container logs ---" >&2
      "$DOCKER_BIN" logs "$CONTAINER_NAME" >&2 || true
      echo "--- end gallery-ml-smoke container logs ---" >&2
    fi
    "$DOCKER_BIN" rm --force "$CONTAINER_NAME" >/dev/null 2>&1 || true
  fi

  exit "$status"
}
trap cleanup EXIT

if ! command -v "$DOCKER_BIN" >/dev/null 2>&1; then
  echo "ERROR: Docker is required for gallery-ml-smoke; install Docker or run the dispatchable gallery-ml-smoke workflow." >&2
  exit 1
fi

if ! "$DOCKER_BIN" info >/dev/null 2>&1; then
  echo "ERROR: Docker is required for gallery-ml-smoke, but the Docker daemon is not reachable." >&2
  exit 1
fi

if ! "$DOCKER_BIN" buildx version >/dev/null 2>&1; then
  echo "ERROR: Docker Buildx is required for gallery-ml-smoke; install Buildx or run the dispatchable gallery-ml-smoke workflow." >&2
  exit 1
fi

echo "=== Gallery ML smoke ==="
echo "--- Building CPU ML image: $IMAGE_NAME ---"
"$DOCKER_BIN" buildx build \
  --load \
  --build-arg DEVICE=cpu \
  --tag "$IMAGE_NAME" \
  --file "$REPO_ROOT/machine-learning/Dockerfile" \
  "$REPO_ROOT/machine-learning"

echo "--- Starting ML container: $CONTAINER_NAME ---"
"$DOCKER_BIN" run --detach --name "$CONTAINER_NAME" "$IMAGE_NAME" >/dev/null
CONTAINER_STARTED=1

echo "--- Waiting for ML container health ---"
for attempt in $(seq 1 90); do
  health_status="$("$DOCKER_BIN" inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$CONTAINER_NAME")"
  case "$health_status" in
    healthy)
      echo "ML container is healthy"
      break
      ;;
    unhealthy|exited|dead)
      echo "ERROR: ML container became $health_status" >&2
      exit 1
      ;;
  esac

  if [[ "$attempt" -eq 90 ]]; then
    echo "ERROR: ML container did not become healthy within 90 seconds; last status: $health_status" >&2
    exit 1
  fi

  sleep 2
done

echo "--- Probing ML /ping healthcheck ---"
"$DOCKER_BIN" exec "$CONTAINER_NAME" python3 healthcheck.py

echo "--- Verifying Gallery ML imports ---"
"$DOCKER_BIN" exec "$CONTAINER_NAME" python3 - <<'PY'
import importlib

for module_name in (
    "immich_ml.main",
    "immich_ml.models",
    "immich_ml.config",
    "immich_ml.metrics",
):
    importlib.import_module(module_name)

print("Gallery ML imports loaded")
PY

echo "=== Gallery ML smoke passed ==="
```

- [ ] **Step 2: Make the script executable**

Run:

```bash
chmod +x machine-learning/scripts/gallery-ml-smoke.sh
```

- [ ] **Step 3: Add the Make target**

Patch `Makefile` near the other confidence targets:

```make
.PHONY: gallery-ml-smoke
gallery-ml-smoke:
	machine-learning/scripts/gallery-ml-smoke.sh
```

- [ ] **Step 4: Run focused wiring tests to verify GREEN**

Run:

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
pnpm --filter @gallery/upstream-preflight run test -- src/cli-wiring.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Verify the no-Docker error path**

Run:

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
GALLERY_ML_SMOKE_DOCKER_BIN=/tmp/gallery-missing-docker make gallery-ml-smoke
```

Expected: FAIL with:

```text
ERROR: Docker is required for gallery-ml-smoke; install Docker or run the dispatchable gallery-ml-smoke workflow.
```

## Task 3: Red Tests For ML Smoke Workflow Assertions

**Files:**
- Modify: `tools/upstream-preflight/src/audits/rebase-confidence.spec.ts`
- Modify after red: `tools/upstream-preflight/src/audits/rebase-confidence.ts`

- [ ] **Step 1: Add an ML smoke workflow fixture**

Add near the other workflow fixtures:

```ts
const mlSmokeWorkflow = [
  'on:',
  '  workflow_dispatch:',
  '    inputs:',
  '      ref:',
  'jobs:',
  '  smoke:',
  '    steps:',
  '      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd',
  '      - uses: ./.github/actions/apply-branding',
  '      - uses: docker/setup-buildx-action@b5ca514318bd6ebac0fb2aedd5d36ec1b5c232a2',
  '      - run: machine-learning/scripts/gallery-ml-smoke.sh',
].join('\\n');
```

- [ ] **Step 2: Add failing positive assertion test**

Add in `describe('validateGalleryWorkflowText', ...)`:

```ts
  it('passes for the ML smoke workflow structure', () => {
    const result = validateGalleryWorkflowText(
      'gallery-ml-smoke.yml',
      mlSmokeWorkflow,
      {
        requireDispatch: true,
        requiredDispatchInputs: ['ref'],
        requireBranding: true,
        brandingBeforeMarkers: ['machine-learning/scripts/gallery-ml-smoke.sh'],
        requiredWorkflowReferences: [
          'docker/setup-buildx-action',
          'machine-learning/scripts/gallery-ml-smoke.sh',
        ],
      },
    );

    expect(result.ok).toBe(true);
  });
```

- [ ] **Step 3: Add failing negative assertion test**

Add in the same describe block:

```ts
  it('fails when the ML smoke workflow misses branding or the smoke script', () => {
    const result = validateGalleryWorkflowText(
      'gallery-ml-smoke.yml',
      [
        'on:',
        '  workflow_dispatch:',
        '    inputs:',
        '      ref:',
        'jobs:',
        '  smoke:',
        '    steps:',
        '      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd',
        '      - uses: docker/setup-buildx-action@b5ca514318bd6ebac0fb2aedd5d36ec1b5c232a2',
      ].join('\\n'),
      {
        requireDispatch: true,
        requiredDispatchInputs: ['ref'],
        requireBranding: true,
        brandingBeforeMarkers: ['machine-learning/scripts/gallery-ml-smoke.sh'],
        requiredWorkflowReferences: [
          'docker/setup-buildx-action',
          'machine-learning/scripts/gallery-ml-smoke.sh',
        ],
      },
    );

    expect(result.ok).toBe(false);
    expect(result.details).toContain(
      'gallery-ml-smoke.yml is missing ./.github/actions/apply-branding',
    );
    expect(result.details).toContain(
      'gallery-ml-smoke.yml is missing workflow reference machine-learning/scripts/gallery-ml-smoke.sh',
    );
  });
```

- [ ] **Step 4: Add failing missing-workflow static assertion coverage**

Add:

```ts
  it('requires the Gallery ML smoke workflow in release workflow assertions', () => {
    const result = runGalleryWorkflowAssertions('/tmp/gallery-missing-workflows', {
      '.github/workflows/gallery-rc-build.yml': minimalWorkflow,
      '.github/workflows/gallery-release-server-only.yml': minimalWorkflow,
      '.github/workflows/gallery-release-mobile.yml': minimalWorkflow,
      '.github/workflows/gallery-build-mobile.yml': minimalWorkflow,
      '.github/workflows/gallery-mobile-smoke.yml': mobileSmokeWorkflow,
    });

    expect(result.ok).toBe(false);
    expect(result.details).toContain(
      '.github/workflows/gallery-ml-smoke.yml is missing workflow_dispatch',
    );
  });
```

- [ ] **Step 5: Run focused tests to verify RED**

Run:

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
pnpm --filter @gallery/upstream-preflight run test -- src/audits/rebase-confidence.spec.ts
```

Expected: FAIL because production assertions do not yet require `.github/workflows/gallery-ml-smoke.yml`.

## Task 4: Add ML Smoke Workflow And Production Assertions

**Files:**
- Modify: `tools/upstream-preflight/src/audits/rebase-confidence.ts`
- Create: `.github/workflows/gallery-ml-smoke.yml`

- [ ] **Step 1: Extend `workflowAssertions`**

Add this entry to `workflowAssertions`:

```ts
  '.github/workflows/gallery-ml-smoke.yml': {
    requireDispatch: true,
    requiredDispatchInputs: ['ref'],
    requireBranding: true,
    brandingBeforeMarkers: ['machine-learning/scripts/gallery-ml-smoke.sh'],
    requiredWorkflowReferences: [
      'docker/setup-buildx-action',
      'machine-learning/scripts/gallery-ml-smoke.sh',
    ],
  },
```

- [ ] **Step 2: Run focused tests to verify RED for missing workflow**

Run:

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
pnpm --filter @gallery/upstream-preflight run test -- src/audits/rebase-confidence.spec.ts
```

Expected: FAIL with missing static assertions for `.github/workflows/gallery-ml-smoke.yml`.

- [ ] **Step 3: Create the workflow**

Create `.github/workflows/gallery-ml-smoke.yml`:

```yaml
name: Gallery ML Smoke

on:
  workflow_dispatch:
    inputs:
      ref:
        description: 'Branch, tag, or SHA to test. Defaults to the triggering ref.'
        required: false
        type: string
        default: ''

concurrency:
  group: gallery-ml-smoke-${{ github.ref }}
  cancel-in-progress: true

permissions: {}

jobs:
  cpu-ml-smoke:
    name: CPU ML container smoke
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - name: Checkout code
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
        with:
          ref: ${{ inputs.ref || github.sha }}
          persist-credentials: false
          token: ${{ github.token }}
          fetch-depth: 0
          fetch-tags: true

      - uses: ./.github/actions/apply-branding

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@b5ca514318bd6ebac0fb2aedd5d36ec1b5c232a2 # v3.10.0

      - name: Run ML smoke
        run: machine-learning/scripts/gallery-ml-smoke.sh
```

- [ ] **Step 4: Run focused tests to verify GREEN**

Run:

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
pnpm --filter @gallery/upstream-preflight run test -- src/audits/rebase-confidence.spec.ts
```

Expected: PASS.

## Task 5: Update Operator Output And Docs

**Files:**
- Modify: `tools/upstream-preflight/src/audits/rebase-confidence.spec.ts`
- Modify: `docs/docs/developer/upstream-rebase-process.md`

- [ ] **Step 1: Update real-repo availability-output test**

In `tools/upstream-preflight/src/audits/rebase-confidence.spec.ts`, update `emits available local commands while keeping missing future workflows planned` so it now expects exact ML local and remote commands:

```ts
    expect(details).toContain(
      'make gallery-ml-smoke (required by docker: server/Dockerfile, machine-learning/Dockerfile; ml: machine-learning/Dockerfile)',
    );
    expect(details).toContain(
      'gh workflow run gallery-ml-smoke.yml --ref rebase/upstream-batch-176 (required by docker: server/Dockerfile, machine-learning/Dockerfile; ml: machine-learning/Dockerfile)',
    );
    expect(details).not.toContain(
      'planned Slice 5 check: make gallery-ml-smoke (target missing; required by docker: server/Dockerfile, machine-learning/Dockerfile; ml: machine-learning/Dockerfile)',
    );
    expect(details).not.toContain(
      'planned Slice 5 workflow: gallery-ml-smoke.yml (workflow missing; required by docker: server/Dockerfile, machine-learning/Dockerfile; ml: machine-learning/Dockerfile)',
    );
```

- [ ] **Step 2: Add risk-based confidence docs**

Patch `docs/docs/developer/upstream-rebase-process.md` after the `CI And Patch Checks` section:

````markdown
## Risk-Based Confidence Checks

After each batch, run:

```bash
make rebase-confidence-check BATCH=NN
```

This check always verifies Gallery release workflow structure and strict
ownership freshness. It also prints extra local or remote confidence checks when
the batch touches high-risk surfaces:

- `make gallery-branding-check` for branding, release, and Docker surfaces.
- `make gallery-ml-smoke` for ML and Docker surfaces.
- `gh workflow run gallery-mobile-smoke.yml --ref rebase/upstream-batch-NN` for
  mobile or mobile-branding surfaces.
- `gh workflow run gallery-ml-smoke.yml --ref rebase/upstream-batch-NN` for ML
  and Docker surfaces.

The command verifies local/static requirements and prints dispatch commands; it
does not prove those remote workflows are green. Dispatch and babysit any
required workflow before claiming the batch is fully verified.
````

Also add `make rebase-confidence-check` to the final verification command list.

- [ ] **Step 3: Run focused tests to verify GREEN**

Run:

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
pnpm --filter @gallery/upstream-preflight run test -- src/audits/rebase-confidence.spec.ts src/cli-wiring.spec.ts
```

Expected: PASS.

## Task 6: Command Verification And Commit

- [ ] **Step 1: Run full upstream-preflight test suite**

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

- [ ] **Step 4: Run confidence check**

Run:

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
make rebase-confidence-check BATCH=175
```

Expected: PASS. Batch 175 currently touches Docker, so the risk requirements should now include exact local and remote ML smoke commands:

```text
- make gallery-ml-smoke (required by docker: server/Dockerfile)
- gh workflow run gallery-ml-smoke.yml --ref rebase/upstream-batch-175 (required by docker: server/Dockerfile)
```

- [ ] **Step 5: Run local ML smoke when Docker is available**

Run:

```bash
if docker info >/dev/null 2>&1; then
  make gallery-ml-smoke
else
  echo "Docker is unavailable; verify the no-Docker error path instead."
fi
```

Expected when Docker is available: PASS with:

```text
=== Gallery ML smoke passed ===
```

If Docker is unavailable, verify the no-Docker error path from Task 2 Step 5 and report that the real container smoke was not run locally.

- [ ] **Step 6: Commit**

Run:

```bash
git status --short
git add Makefile machine-learning/scripts/gallery-ml-smoke.sh .github/workflows/gallery-ml-smoke.yml tools/upstream-preflight/src/cli-wiring.spec.ts tools/upstream-preflight/src/audits/rebase-confidence.ts tools/upstream-preflight/src/audits/rebase-confidence.spec.ts docs/docs/developer/upstream-rebase-process.md docs/superpowers/plans/2026-06-02-rebase-confidence-gates-slice-5.md
git commit -m "feat(rebase): add gallery ml smoke gate"
```

Expected: commit created with red/green evidence in the implementer report.
