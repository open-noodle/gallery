# Rebase Confidence Gates Slice 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dispatchable Gallery mobile smoke workflow and wire `rebase-confidence-check` to print its exact dispatch command when mobile or mobile-branding surfaces are touched.

**Architecture:** Create `.github/workflows/gallery-mobile-smoke.yml` as a lightweight, dispatch-only Android smoke. The workflow checks out the requested ref, applies Gallery branding before mobile work, uses the repo-pinned mise toolchain, runs mobile dependency install, generated-artifact checks, Dart analysis, Flutter tests, and an unsigned Android APK build. Extend the existing TypeScript workflow static assertions so missing workflow structure fails locally before an operator relies on the smoke.

**Tech Stack:** GitHub Actions YAML, mise, Flutter/Dart, Vitest static workflow assertions, existing `rebase-confidence-check` availability detection.

---

## File Structure

- Create `.github/workflows/gallery-mobile-smoke.yml`
  - Dispatchable only.
  - Input `ref` defaults to the triggering branch/SHA.
  - Applies `./.github/actions/apply-branding` before mobile codegen/analyze/test/build.
  - Uses `immich-app/devtools/actions/use-mise`.
  - Runs `flutter pub get` for `mobile` and `mobile/packages/ui`.
  - Runs `mise //mobile:codegen:translation`, `mise //mobile:codegen:dart`, and `mise //mobile:codegen:pigeon`.
  - Fails on generated-file drift for `mobile/**/*.g.dart`, `mobile/**/*.gr.dart`, and `mobile/**/*.drift.dart`.
  - Runs `mise //mobile:analyze`, `mise //mobile:test`, and `flutter build apk --debug`.
- Modify `tools/upstream-preflight/src/audits/rebase-confidence.ts`
  - Add static assertions for `.github/workflows/gallery-mobile-smoke.yml`.
  - Assert dispatch, `ref` input, branding before mobile work, setup via mise, dependency install, generated-file drift check, analysis, tests, and unsigned Android build marker.
- Modify `tools/upstream-preflight/src/audits/rebase-confidence.spec.ts`
  - Add positive and negative mobile smoke workflow assertions.
  - Update availability-output tests so the exact `gh workflow run gallery-mobile-smoke.yml --ref rebase/upstream-batch-<id>` command appears when the workflow exists.

## Task 1: Red Tests For Mobile Smoke Workflow Assertions

**Files:**
- Modify: `tools/upstream-preflight/src/audits/rebase-confidence.spec.ts`
- Modify after red: `tools/upstream-preflight/src/audits/rebase-confidence.ts`

- [ ] **Step 1: Add a mobile smoke fixture**

Add near `minimalWorkflow` in `tools/upstream-preflight/src/audits/rebase-confidence.spec.ts`:

```ts
const mobileSmokeWorkflow = [
  'on:',
  '  workflow_dispatch:',
  '    inputs:',
  '      ref:',
  'jobs:',
  '  smoke:',
  '    steps:',
  '      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd',
  '      - uses: ./.github/actions/apply-branding',
  '      - uses: immich-app/devtools/actions/use-mise@7b8610a904d57da241e4ddba17fa62b62b15aed4',
  '      - run: flutter pub get',
  '      - run: mise //mobile:codegen:translation',
  '      - run: mise //mobile:codegen:dart',
  '      - run: mise //mobile:codegen:pigeon',
  '      - uses: tj-actions/verify-changed-files@a1c6acee9df209257a246f2cc6ae8cb6581c1edf',
  '      - run: mise //mobile:analyze',
  '      - run: mise //mobile:test',
  '      - run: flutter build apk --debug',
].join('\\n');
```

- [ ] **Step 2: Add failing positive assertion test**

Add in `describe('validateGalleryWorkflowText', ...)`:

```ts
  it('passes for the mobile smoke workflow structure', () => {
    const result = validateGalleryWorkflowText(
      'gallery-mobile-smoke.yml',
      mobileSmokeWorkflow,
      {
        requireDispatch: true,
        requiredDispatchInputs: ['ref'],
        requireBranding: true,
        brandingBeforeMarkers: [
          'mise //mobile:codegen:translation',
          'mise //mobile:codegen:dart',
          'mise //mobile:codegen:pigeon',
          'mise //mobile:analyze',
          'mise //mobile:test',
          'flutter build apk --debug',
        ],
        requiredWorkflowReferences: [
          'immich-app/devtools/actions/use-mise',
          'flutter pub get',
          'mise //mobile:codegen:translation',
          'mise //mobile:codegen:dart',
          'mise //mobile:codegen:pigeon',
          'tj-actions/verify-changed-files',
          'mobile/**/*.g.dart',
          'mobile/**/*.gr.dart',
          'mobile/**/*.drift.dart',
          'mise //mobile:analyze',
          'mise //mobile:test',
          'flutter build apk --debug',
        ],
      },
    );

    expect(result.ok).toBe(true);
  });
```

- [ ] **Step 3: Add failing negative assertion test**

Add in the same describe block:

```ts
  it('fails when the mobile smoke workflow misses branding or generated drift checks', () => {
    const result = validateGalleryWorkflowText(
      'gallery-mobile-smoke.yml',
      [
        'on:',
        '  workflow_dispatch:',
        '    inputs:',
        '      ref:',
        'jobs:',
        '  smoke:',
        '    steps:',
        '      - uses: immich-app/devtools/actions/use-mise@7b8610a904d57da241e4ddba17fa62b62b15aed4',
        '      - run: flutter pub get',
        '      - run: mise //mobile:codegen:dart',
        '      - run: mise //mobile:analyze',
        '      - run: mise //mobile:test',
        '      - run: flutter build apk --debug',
      ].join('\\n'),
      {
        requireDispatch: true,
        requiredDispatchInputs: ['ref'],
        requireBranding: true,
        brandingBeforeMarkers: ['flutter build apk --debug'],
        requiredWorkflowReferences: [
          'mise //mobile:codegen:translation',
          'mise //mobile:codegen:pigeon',
          'tj-actions/verify-changed-files',
          'mobile/**/*.g.dart',
          'mobile/**/*.gr.dart',
          'mobile/**/*.drift.dart',
        ],
      },
    );

    expect(result.ok).toBe(false);
    expect(result.details).toContain(
      'gallery-mobile-smoke.yml is missing ./.github/actions/apply-branding',
    );
    expect(result.details).toContain(
      'gallery-mobile-smoke.yml is missing workflow reference mise //mobile:codegen:translation',
    );
    expect(result.details).toContain(
      'gallery-mobile-smoke.yml is missing workflow reference tj-actions/verify-changed-files',
    );
    expect(result.details).toContain(
      'gallery-mobile-smoke.yml is missing workflow reference mobile/**/*.drift.dart',
    );
  });
```

- [ ] **Step 4: Add failing missing-workflow static assertion coverage**

Add in `describe('validateGalleryWorkflowText', ...)` or the existing current-workflow section:

```ts
  it('requires the Gallery mobile smoke workflow in release workflow assertions', () => {
    const result = runGalleryWorkflowAssertions('/tmp/gallery-missing-workflows', {
      '.github/workflows/gallery-rc-build.yml': minimalWorkflow,
      '.github/workflows/gallery-release-server-only.yml': minimalWorkflow,
      '.github/workflows/gallery-release-mobile.yml': minimalWorkflow,
      '.github/workflows/gallery-build-mobile.yml': minimalWorkflow,
    });

    expect(result.ok).toBe(false);
    expect(result.details).toContain(
      '.github/workflows/gallery-mobile-smoke.yml is missing workflow_dispatch',
    );
  });
```

This test must be red before production assertions are extended because the current assertion set does not know about `.github/workflows/gallery-mobile-smoke.yml`.

- [ ] **Step 5: Run focused tests to verify RED**

Run:

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
pnpm --filter @gallery/upstream-preflight run test -- src/audits/rebase-confidence.spec.ts
```

Expected: FAIL because `runGalleryWorkflowAssertions()` does not yet require `.github/workflows/gallery-mobile-smoke.yml`.

## Task 2: Add Production Static Assertions For The Mobile Smoke Workflow

**Files:**
- Modify: `tools/upstream-preflight/src/audits/rebase-confidence.ts`

- [ ] **Step 1: Extend `workflowAssertions`**

Add this entry to `workflowAssertions`:

```ts
  '.github/workflows/gallery-mobile-smoke.yml': {
    requireDispatch: true,
    requiredDispatchInputs: ['ref'],
    requireBranding: true,
    brandingBeforeMarkers: [
      'mise //mobile:codegen:translation',
      'mise //mobile:codegen:dart',
      'mise //mobile:codegen:pigeon',
      'mise //mobile:analyze',
      'mise //mobile:test',
      'flutter build apk --debug',
    ],
    requiredWorkflowReferences: [
      'immich-app/devtools/actions/use-mise',
      'flutter pub get',
      'mise //mobile:codegen:translation',
      'mise //mobile:codegen:dart',
      'mise //mobile:codegen:pigeon',
      'tj-actions/verify-changed-files',
      'mobile/**/*.g.dart',
      'mobile/**/*.gr.dart',
      'mobile/**/*.drift.dart',
      'mise //mobile:analyze',
      'mise //mobile:test',
      'flutter build apk --debug',
    ],
  },
```

- [ ] **Step 2: Run focused tests to verify the missing-workflow test passes and the real repo is RED**

Run:

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
pnpm --filter @gallery/upstream-preflight run test -- src/audits/rebase-confidence.spec.ts
```

Expected: FAIL because production assertions now require `.github/workflows/gallery-mobile-smoke.yml`, but the real workflow file has not been created yet. The failure details should include missing static assertions for `.github/workflows/gallery-mobile-smoke.yml`.

## Task 3: Create The Mobile Smoke Workflow

**Files:**
- Create: `.github/workflows/gallery-mobile-smoke.yml`

- [ ] **Step 1: Add the workflow**

Create `.github/workflows/gallery-mobile-smoke.yml`:

```yaml
name: Gallery Mobile Smoke

on:
  workflow_dispatch:
    inputs:
      ref:
        description: 'Branch, tag, or SHA to test. Defaults to the triggering ref.'
        required: false
        type: string
        default: ''

concurrency:
  group: gallery-mobile-smoke-${{ github.ref }}
  cancel-in-progress: true

permissions: {}

jobs:
  android-smoke:
    name: Android smoke
    runs-on: ubuntu-latest
    permissions:
      contents: read
    defaults:
      run:
        shell: bash
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

      - name: Setup Mise
        uses: immich-app/devtools/actions/use-mise@7b8610a904d57da241e4ddba17fa62b62b15aed4 # use-mise-action-v2.0.2
        with:
          github_token: ${{ github.token }}

      - name: Install mobile dependencies
        working-directory: ./mobile
        run: flutter pub get

      - name: Install mobile UI package dependencies
        working-directory: ./mobile/packages/ui
        run: flutter pub get

      - name: Generate translation files
        run: mise //mobile:codegen:translation

      - name: Run Build Runner
        run: mise //mobile:codegen:dart

      - name: Generate platform APIs
        run: mise //mobile:codegen:pigeon

      - name: Find generated file changes
        uses: tj-actions/verify-changed-files@a1c6acee9df209257a246f2cc6ae8cb6581c1edf # v20.0.4
        id: verify-changed-files
        with:
          files: |
            mobile/**/*.g.dart
            mobile/**/*.gr.dart
            mobile/**/*.drift.dart

      - name: Verify generated files are current
        if: steps.verify-changed-files.outputs.files_changed == 'true'
        env:
          CHANGED_FILES: ${{ steps.verify-changed-files.outputs.changed_files }}
        run: |
          echo "ERROR: Mobile generated files are not current."
          echo "Run 'mise //mobile:codegen:translation', 'mise //mobile:codegen:dart', and 'mise //mobile:codegen:pigeon'."
          echo "Changed files: ${CHANGED_FILES}"
          exit 1

      - name: Analyze mobile code
        run: mise //mobile:analyze

      - name: Run mobile tests
        run: mise //mobile:test

      - name: Build unsigned Android APK
        working-directory: ./mobile
        run: flutter build apk --debug
```

This workflow intentionally builds a debug APK. It is unsigned and does not require store signing secrets, which keeps it suitable for rebase smoke branches.

- [ ] **Step 2: Run focused workflow assertion tests to verify GREEN**

Run:

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
pnpm --filter @gallery/upstream-preflight run test -- src/audits/rebase-confidence.spec.ts
```

Expected: PASS.

## Task 4: Update Operator Output Expectations

**Files:**
- Modify: `tools/upstream-preflight/src/audits/rebase-confidence.spec.ts`

- [ ] **Step 1: Update real-repo availability-output test**

In `tools/upstream-preflight/src/audits/rebase-confidence.spec.ts`, update `emits available local commands while keeping missing future workflows planned` so it expects the mobile command when the workflow exists:

```ts
    expect(details).toContain(
      'gh workflow run gallery-mobile-smoke.yml --ref rebase/upstream-batch-176 (required by mobile: mobile/lib/routing/router.dart)',
    );
    expect(details).not.toContain(
      'planned Slice 4 workflow: gallery-mobile-smoke.yml (workflow missing; required by mobile: mobile/lib/routing/router.dart)',
    );
```

Keep the assertions that future Slice 5 ML checks remain planned.

- [ ] **Step 2: Run focused tests to verify GREEN**

Run:

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
pnpm --filter @gallery/upstream-preflight run test -- src/audits/rebase-confidence.spec.ts
```

Expected: PASS.

## Task 5: Final Verification And Commit

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

- [ ] **Step 4: Run the confidence check with Slice 4 availability**

Run:

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
make rebase-confidence-check BATCH=175
```

Expected: PASS. If batch 175 touches only Docker, output does not need the mobile smoke command. To verify mobile output directly, also run a focused unit test or `renderRequiredConfidenceChecks` coverage from Task 4. For a mobile-risk batch, the expected operator line is:

```text
- gh workflow run gallery-mobile-smoke.yml --ref rebase/upstream-batch-<id> (required by mobile: <matched mobile file>)
```

- [ ] **Step 5: Commit**

Run:

```bash
git status --short
git add .github/workflows/gallery-mobile-smoke.yml tools/upstream-preflight/src/audits/rebase-confidence.ts tools/upstream-preflight/src/audits/rebase-confidence.spec.ts docs/superpowers/plans/2026-06-02-rebase-confidence-gates-slice-4.md
git commit -m "feat(rebase): add gallery mobile smoke workflow"
```

Expected: commit created with red/green evidence in the implementer report.
