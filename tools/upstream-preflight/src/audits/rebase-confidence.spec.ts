import { describe, expect, it } from 'vitest';
import path from 'node:path';
import type { Manifest } from '../types';
import {
  classifyConfidenceSurfaces,
  renderRequiredConfidenceChecks,
  runGalleryWorkflowAssertions,
  runRebaseConfidenceAudits,
  runStrictOwnershipConfidenceAudit,
  validateGalleryWorkflowText,
} from './rebase-confidence';

const minimalWorkflow = [
  'on:',
  '  workflow_dispatch:',
  '    inputs:',
  '      rc_tag:',
  '      ref:',
  '      build_ml:',
  '      version:',
  '      commit:',
  '      environment:',
  '      build_target:',
  'jobs:',
  '  build:',
  '    steps:',
  '      - uses: ./.github/actions/apply-branding',
  '      - uses: docker/build-push-action@v6',
  '      - name: Build signed Android App Bundle',
  '      - run: flutter build appbundle --release',
  '      - uses: ./.github/workflows/gallery-build-mobile.yml',
  '      - run: echo ghcr.io/open-noodle/gallery-server',
  '      - run: echo ghcr.io/open-noodle/gallery-ml',
  '      - run: echo ghcr.io/open-noodle/gallery-server:${RC_TAG}',
  '      - run: echo ghcr.io/open-noodle/gallery-ml:${RC_TAG}',
].join('\n');

const ownershipManifest: Manifest = {
  version: 1,
  metadata: {
    upstream_remote: 'upstream',
    upstream_branch: 'main',
    fork_remote: 'origin',
    fork_branch: 'main',
    last_verified_fork_head: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  },
  features: {
    mobile: {
      title: 'Mobile',
      risk: 'high',
      domains: ['mobile'],
      owned_paths: ['mobile/lib/explicit.dart'],
      optional_paths: ['mobile/**', 'mobile/lib/narrow-*.dart'],
    },
  },
};

describe('classifyConfidenceSurfaces', () => {
  it('treats ordinary server files as low confidence risk', () => {
    expect(
      classifyConfidenceSurfaces(['server/src/services/asset.service.ts']),
    ).toEqual([]);
  });

  it('classifies mobile, ml, branding, release, docker, and ownership surfaces', () => {
    expect(
      classifyConfidenceSurfaces([
        'mobile/lib/routing/router.dart',
        'machine-learning/immich_ml/main.py',
        'branding/scripts/apply-branding.sh',
        '.github/workflows/gallery-rc-build.yml',
        'server/Dockerfile',
        'docs/fork/ownership.yml',
      ]),
    ).toEqual([
      { surface: 'branding', files: ['branding/scripts/apply-branding.sh'] },
      { surface: 'docker', files: ['server/Dockerfile'] },
      { surface: 'ml', files: ['machine-learning/immich_ml/main.py'] },
      { surface: 'mobile', files: ['mobile/lib/routing/router.dart'] },
      { surface: 'ownership', files: ['docs/fork/ownership.yml'] },
      { surface: 'release', files: ['.github/workflows/gallery-rc-build.yml'] },
    ]);
  });
});

describe('renderRequiredConfidenceChecks', () => {
  it('renders matched-file reasons and exact remote commands for risky batches', () => {
    const details = renderRequiredConfidenceChecks(
      classifyConfidenceSurfaces([
        'mobile/lib/routing/router.dart',
        'server/Dockerfile',
        'machine-learning/Dockerfile',
      ]),
      '176',
      {
        makeTargets: new Set(['gallery-branding-check', 'gallery-ml-smoke']),
        workflows: new Set([
          'gallery-mobile-smoke.yml',
          'gallery-ml-smoke.yml',
        ]),
      },
    );

    expect(details).toContain(
      'make gallery-branding-check (required by docker: server/Dockerfile, machine-learning/Dockerfile)',
    );
    expect(details).toContain(
      'make gallery-ml-smoke (required by docker: server/Dockerfile, machine-learning/Dockerfile; ml: machine-learning/Dockerfile)',
    );
    expect(details).toContain(
      'gh workflow run gallery-mobile-smoke.yml --ref rebase/upstream-batch-176 (required by mobile: mobile/lib/routing/router.dart)',
    );
    expect(details).toContain(
      'gh workflow run gallery-ml-smoke.yml --ref rebase/upstream-batch-176 (required by docker: server/Dockerfile, machine-learning/Dockerfile; ml: machine-learning/Dockerfile)',
    );
  });

  it('renders planned checks and workflows when targets and workflows are missing', () => {
    const details = renderRequiredConfidenceChecks(
      classifyConfidenceSurfaces([
        'mobile/lib/routing/router.dart',
        'server/Dockerfile',
        'machine-learning/Dockerfile',
      ]),
      '176',
      { makeTargets: new Set(), workflows: new Set() },
    );

    expect(details).toContain(
      'planned Slice 3 check: make gallery-branding-check (target missing; required by docker: server/Dockerfile, machine-learning/Dockerfile)',
    );
    expect(details).toContain(
      'planned Slice 5 check: make gallery-ml-smoke (target missing; required by docker: server/Dockerfile, machine-learning/Dockerfile; ml: machine-learning/Dockerfile)',
    );
    expect(details).toContain(
      'planned Slice 4 workflow: gallery-mobile-smoke.yml (workflow missing; required by mobile: mobile/lib/routing/router.dart)',
    );
    expect(details).toContain(
      'planned Slice 5 workflow: gallery-ml-smoke.yml (workflow missing; required by docker: server/Dockerfile, machine-learning/Dockerfile; ml: machine-learning/Dockerfile)',
    );
  });

  it('does not emit runnable commands for missing repo targets and workflows', () => {
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
      'planned Slice 3 check: make gallery-branding-check (target missing; required by docker: server/Dockerfile, machine-learning/Dockerfile)',
    );
    expect(details).toContain(
      'planned Slice 4 workflow: gallery-mobile-smoke.yml (workflow missing; required by mobile: mobile/lib/routing/router.dart)',
    );
    expect(details).not.toContain(
      'make gallery-branding-check (required by docker: server/Dockerfile, machine-learning/Dockerfile)',
    );
    expect(details).not.toContain(
      'gh workflow run gallery-mobile-smoke.yml --ref rebase/upstream-batch-176 (required by mobile: mobile/lib/routing/router.dart)',
    );
  });

  it('reports no extra confidence checks for low-risk batches', () => {
    expect(renderRequiredConfidenceChecks([], '176')).toEqual([
      'No extra risk-based confidence checks are required for this batch',
    ]);
  });

  it('does not emit strict ownership checks before Slice 2', () => {
    expect(
      renderRequiredConfidenceChecks(
        classifyConfidenceSurfaces(['docs/fork/ownership.yml']),
        '176',
      ),
    ).toEqual([]);
  });
});

describe('validateGalleryWorkflowText', () => {
  it('passes for a workflow text containing dispatch, branding, Gallery images, and RC summary links', () => {
    const result = validateGalleryWorkflowText(
      'gallery-rc-build.yml',
      minimalWorkflow,
      {
        requireDispatch: true,
        requiredDispatchInputs: ['rc_tag', 'ref', 'build_ml'],
        requireBranding: true,
        brandingBeforeMarkers: ['docker/build-push-action'],
        requireServerImage: true,
        requireMlImage: true,
        requireRcSummaryLinks: true,
      },
    );

    expect(result.ok).toBe(true);
  });

  it('fails when workflow dispatch is missing', () => {
    const result = validateGalleryWorkflowText(
      'gallery-rc-build.yml',
      'on:\n  push:\n',
      {
        requireDispatch: true,
        requiredDispatchInputs: ['rc_tag', 'ref', 'build_ml'],
      },
    );

    expect(result.details).toEqual([
      'gallery-rc-build.yml is missing workflow_dispatch',
      'gallery-rc-build.yml is missing workflow_dispatch input rc_tag',
      'gallery-rc-build.yml is missing workflow_dispatch input ref',
      'gallery-rc-build.yml is missing workflow_dispatch input build_ml',
    ]);
  });

  it('fails when required workflow dispatch inputs are missing', () => {
    const result = validateGalleryWorkflowText(
      'gallery-rc-build.yml',
      [
        'on:',
        '  workflow_dispatch:',
        '    inputs:',
        '      rc_tag:',
        '      build_ml:',
      ].join('\n'),
      {
        requireDispatch: true,
        requiredDispatchInputs: ['rc_tag', 'ref', 'build_ml'],
      },
    );

    expect(result.details).toEqual([
      'gallery-rc-build.yml is missing workflow_dispatch input ref',
    ]);
  });

  it('fails when branding is missing before a required release build', () => {
    const result = validateGalleryWorkflowText(
      'gallery-release-server-only.yml',
      minimalWorkflow.replace(
        '      - uses: ./.github/actions/apply-branding\n',
        '',
      ),
      {
        requireBranding: true,
        brandingBeforeMarkers: ['docker/build-push-action'],
      },
    );

    expect(result.details).toEqual([
      'gallery-release-server-only.yml is missing ./.github/actions/apply-branding',
    ]);
  });

  it('fails when branding appears after a Docker build marker', () => {
    const result = validateGalleryWorkflowText(
      'gallery-release-server-only.yml',
      [
        'on:',
        '  workflow_dispatch:',
        'jobs:',
        '  build:',
        '    steps:',
        '      - uses: docker/build-push-action@v6',
        '      - uses: ./.github/actions/apply-branding',
      ].join('\n'),
      {
        requireBranding: true,
        brandingBeforeMarkers: ['docker/build-push-action'],
      },
    );

    expect(result.details).toEqual([
      'gallery-release-server-only.yml must apply branding before docker/build-push-action',
    ]);
  });

  it('fails when gallery-build-mobile branding appears after mobile build markers', () => {
    const result = validateGalleryWorkflowText(
      'gallery-build-mobile.yml',
      [
        'on:',
        '  workflow_dispatch:',
        'jobs:',
        '  build:',
        '    steps:',
        '      - name: Build signed Android App Bundle',
        '      - run: flutter build appbundle --release',
        '      - uses: ./.github/actions/apply-branding',
      ].join('\n'),
      {
        requireBranding: true,
        brandingBeforeMarkers: [
          'Build signed Android App Bundle',
          'flutter build',
        ],
      },
    );

    expect(result.details).toEqual([
      'gallery-build-mobile.yml must apply branding before Build signed Android App Bundle',
      'gallery-build-mobile.yml must apply branding before flutter build',
    ]);
  });

  it('fails when release-mobile stops delegating to the branded mobile build workflow', () => {
    const result = validateGalleryWorkflowText(
      'gallery-release-mobile.yml',
      [
        'on:',
        '  workflow_dispatch:',
        '    inputs:',
        '      version:',
        'jobs:',
        '  build-mobile:',
        '    steps:',
        '      - run: flutter build appbundle --release',
      ].join('\n'),
      {
        requireDispatch: true,
        requiredDispatchInputs: ['version'],
        requiredWorkflowReferences: ['gallery-build-mobile.yml'],
      },
    );

    expect(result.details).toEqual([
      'gallery-release-mobile.yml is missing workflow reference gallery-build-mobile.yml',
    ]);
  });

  it('reports path-specific failures for malformed workflow structure', () => {
    const result = validateGalleryWorkflowText(
      'gallery-build-mobile.yml',
      'not a workflow',
      {
        requireDispatch: true,
        requiredDispatchInputs: ['environment', 'version', 'build_target'],
        requireBranding: true,
        brandingBeforeMarkers: ['flutter build'],
      },
    );

    expect(result.details).toEqual([
      'gallery-build-mobile.yml is missing workflow_dispatch',
      'gallery-build-mobile.yml is missing workflow_dispatch input environment',
      'gallery-build-mobile.yml is missing workflow_dispatch input version',
      'gallery-build-mobile.yml is missing workflow_dispatch input build_target',
      'gallery-build-mobile.yml is missing ./.github/actions/apply-branding',
      'gallery-build-mobile.yml is missing mobile build marker flutter build',
    ]);
  });

  it('fails on upstream Immich image names in Gallery release workflows', () => {
    const result = validateGalleryWorkflowText(
      'gallery-release-server-only.yml',
      'ghcr.io/immich-app/immich-server\n',
      {
        requireServerImage: true,
      },
    );

    expect(result.details).toEqual([
      'gallery-release-server-only.yml is missing ghcr.io/open-noodle/gallery-server',
      'gallery-release-server-only.yml contains upstream image ghcr.io/immich-app/immich-server',
    ]);
  });

  it('fails when a required release workflow is missing or renamed', () => {
    const result = runGalleryWorkflowAssertions(
      '/tmp/gallery-missing-workflows',
      {
        '.github/workflows/gallery-rc-build.yml': minimalWorkflow,
        '.github/workflows/gallery-release-mobile.yml': minimalWorkflow,
        '.github/workflows/gallery-build-mobile.yml': minimalWorkflow,
      },
    );

    expect(result.ok).toBe(false);
    expect(result.details).toContain(
      '.github/workflows/gallery-release-server-only.yml is missing workflow_dispatch',
    );
    expect(result.details).toContain(
      '.github/workflows/gallery-release-server-only.yml is missing ./.github/actions/apply-branding',
    );
  });

  it('passes the current Gallery release workflow static assertions', () => {
    expect(
      runGalleryWorkflowAssertions(path.resolve(process.cwd(), '../..')).ok,
    ).toBe(true);
  });
});

describe('runStrictOwnershipConfidenceAudit', () => {
  it('passes when the manifest baseline is current and fork files are covered', () => {
    const result = runStrictOwnershipConfidenceAudit({
      manifest: ownershipManifest,
      forkFiles: ['mobile/lib/explicit.dart'],
      headValidation: {
        ok: true,
        errors: [],
        warnings: [],
        changedSinceBaseline: [],
      },
      broadOptionalOnly: [],
    });

    expect(result).toEqual({
      ok: true,
      title: 'Strict Ownership Confidence',
      details: [
        'Ownership manifest is current and all fork files have explicit or narrow coverage',
      ],
    });
  });

  it('passes with baseline drift details when changed files have narrow coverage', () => {
    const result = runStrictOwnershipConfidenceAudit({
      manifest: ownershipManifest,
      forkFiles: ['mobile/lib/narrow-gallery.dart'],
      headValidation: {
        ok: true,
        errors: [],
        warnings: [
          'Ownership manifest last_verified_fork_head aaaaaaaa is behind bbbbbbbb; 1 files changed since manifest verification.',
          'Changed since manifest baseline: mobile/lib/narrow-gallery.dart',
        ],
        changedSinceBaseline: ['mobile/lib/narrow-gallery.dart'],
      },
      broadOptionalOnly: [],
    });

    expect(result.ok).toBe(true);
    expect(result.details).toContain(
      'Ownership manifest last_verified_fork_head aaaaaaaa is behind bbbbbbbb; 1 files changed since manifest verification.',
    );
    expect(result.details).toContain(
      'Changed since manifest baseline: mobile/lib/narrow-gallery.dart',
    );
  });

  it('fails when a post-baseline file is covered only by a broad optional glob', () => {
    const result = runStrictOwnershipConfidenceAudit({
      manifest: ownershipManifest,
      forkFiles: ['mobile/lib/broad-only.dart'],
      headValidation: {
        ok: true,
        errors: [],
        warnings: [],
        changedSinceBaseline: ['mobile/lib/broad-only.dart'],
      },
      broadOptionalOnly: [
        {
          file: 'mobile/lib/broad-only.dart',
          explicitGlobs: [],
          broadOptionalGlobs: ['mobile/**'],
          narrowOptionalGlobs: [],
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.details).toEqual([
      'mobile/lib/broad-only.dart is covered only by broad optional glob mobile/**',
    ]);
  });

  it('derives broad-only failures when caller-provided classifications are stale', () => {
    const result = runStrictOwnershipConfidenceAudit({
      manifest: ownershipManifest,
      forkFiles: ['mobile/lib/broad-only.dart'],
      headValidation: {
        ok: true,
        errors: [],
        warnings: [],
        changedSinceBaseline: ['mobile/lib/broad-only.dart'],
      },
      broadOptionalOnly: [],
    });

    expect(result.ok).toBe(false);
    expect(result.details).toEqual([
      'mobile/lib/broad-only.dart is covered only by broad optional glob mobile/**',
    ]);
  });

  it('fails for uncovered fork files', () => {
    const result = runStrictOwnershipConfidenceAudit({
      manifest: ownershipManifest,
      forkFiles: ['web/src/routes/uncovered.svelte'],
      headValidation: {
        ok: true,
        errors: [],
        warnings: [],
        changedSinceBaseline: [],
      },
      broadOptionalOnly: [],
    });

    expect(result.ok).toBe(false);
    expect(result.details).toEqual([
      'Ownership manifest does not cover web/src/routes/uncovered.svelte',
    ]);
  });

  it('fails for missing or non-ancestor manifest baseline errors', () => {
    const result = runStrictOwnershipConfidenceAudit({
      manifest: ownershipManifest,
      forkFiles: ['mobile/lib/explicit.dart'],
      headValidation: {
        ok: false,
        errors: [
          'Ownership manifest last_verified_fork_head missing is not present in this repository; fetch fork history or reconcile docs/fork/ownership.yml.',
          'Ownership manifest last_verified_fork_head side is not an ancestor of head; reconcile docs/fork/ownership.yml before rebasing.',
        ],
        warnings: [],
        changedSinceBaseline: [],
      },
      broadOptionalOnly: [],
    });

    expect(result.ok).toBe(false);
    expect(result.details).toEqual([
      'Ownership manifest last_verified_fork_head missing is not present in this repository; fetch fork history or reconcile docs/fork/ownership.yml.',
      'Ownership manifest last_verified_fork_head side is not an ancestor of head; reconcile docs/fork/ownership.yml before rebasing.',
    ]);
  });
});

describe('runRebaseConfidenceAudits', () => {
  it('returns passing workflow assertions and low-risk requirement details', () => {
    const results = runRebaseConfidenceAudits({
      upstreamTouchedFiles: ['server/src/services/asset.service.ts'],
      batch: '176',
      workflowTexts: {
        '.github/workflows/gallery-rc-build.yml': minimalWorkflow,
        '.github/workflows/gallery-release-server-only.yml': minimalWorkflow,
        '.github/workflows/gallery-release-mobile.yml': minimalWorkflow,
        '.github/workflows/gallery-build-mobile.yml': minimalWorkflow,
      },
    });

    expect(results).toEqual([
      {
        ok: true,
        title: 'Gallery Release Workflow Static Assertions',
        details: ['All Gallery release workflow assertions passed'],
      },
      {
        ok: true,
        title: 'Risk-Based Confidence Requirements',
        details: [
          'No extra risk-based confidence checks are required for this batch',
        ],
      },
    ]);
  });

  it('includes strict ownership confidence results when ownership input is provided', () => {
    const results = runRebaseConfidenceAudits({
      upstreamTouchedFiles: ['docs/fork/ownership.yml'],
      batch: '176',
      workflowTexts: {
        '.github/workflows/gallery-rc-build.yml': minimalWorkflow,
        '.github/workflows/gallery-release-server-only.yml': minimalWorkflow,
        '.github/workflows/gallery-release-mobile.yml': minimalWorkflow,
        '.github/workflows/gallery-build-mobile.yml': minimalWorkflow,
      },
      ownership: {
        manifest: ownershipManifest,
        forkFiles: ['mobile/lib/broad-only.dart'],
        headValidation: {
          ok: true,
          errors: [],
          warnings: [],
          changedSinceBaseline: ['mobile/lib/broad-only.dart'],
        },
        broadOptionalOnly: [
          {
            file: 'mobile/lib/broad-only.dart',
            explicitGlobs: [],
            broadOptionalGlobs: ['mobile/**'],
            narrowOptionalGlobs: [],
          },
        ],
      },
    });

    expect(results).toContainEqual({
      ok: false,
      title: 'Strict Ownership Confidence',
      details: [
        'mobile/lib/broad-only.dart is covered only by broad optional glob mobile/**',
      ],
    });
  });
});
