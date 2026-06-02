import fs from 'node:fs';
import path from 'node:path';
import micromatch from 'micromatch';
import { findBroadOptionalOnlyFiles, findUncoveredFiles } from '../coverage';
import type {
  AuditResult,
  CoverageClassification,
  Manifest,
  ManifestHeadValidation,
} from '../types';

export type ConfidenceSurface =
  | 'branding'
  | 'docker'
  | 'ml'
  | 'mobile'
  | 'ownership'
  | 'release';

export type ConfidenceSurfaceMatch = {
  surface: ConfidenceSurface;
  files: string[];
};

export type WorkflowAssertionOptions = {
  requireDispatch?: boolean;
  requiredDispatchInputs?: string[];
  requireBranding?: boolean;
  brandingBeforeMarkers?: string[];
  requireServerImage?: boolean;
  requireMlImage?: boolean;
  requireRcSummaryLinks?: boolean;
  requiredWorkflowReferences?: string[];
};

export type RebaseConfidenceAuditInput = {
  upstreamTouchedFiles: string[];
  batch?: string;
  cwd?: string;
  workflowTexts?: Record<string, string>;
  ownership?: StrictOwnershipConfidenceInput;
};

export type StrictOwnershipConfidenceInput = {
  manifest: Manifest;
  forkFiles: string[];
  headValidation: ManifestHeadValidation;
  broadOptionalOnly: CoverageClassification[];
};

export type ConfidenceCheckAvailability = {
  makeTargets: ReadonlySet<string>;
  workflows: ReadonlySet<string>;
};

type PlannedCheck = {
  kind: 'make' | 'workflow';
  name: string;
  slice: number;
  reason: string;
  command?: string;
};

const surfaceGlobs: Record<ConfidenceSurface, string[]> = {
  branding: [
    'branding/**',
    'design/gallery-*',
    'web/static/gallery-*',
    '.github/actions/apply-branding/**',
    'mobile/android/**',
    'mobile/ios/**',
  ],
  docker: [
    'server/Dockerfile',
    'web/Dockerfile',
    'machine-learning/Dockerfile',
    'docker/**',
  ],
  ml: [
    'machine-learning/**',
    'server/src/dtos/model-config.dto.ts',
    'server/src/dtos/system-config.dto.ts',
    'server/src/config.ts',
  ],
  mobile: ['mobile/**'],
  ownership: ['docs/fork/ownership.yml'],
  release: [
    '.github/workflows/gallery-rc-build.yml',
    '.github/workflows/gallery-release-server-only.yml',
    '.github/workflows/gallery-release-mobile.yml',
    '.github/workflows/gallery-build-mobile.yml',
  ],
};

const workflowAssertions: Record<string, WorkflowAssertionOptions> = {
  '.github/workflows/gallery-rc-build.yml': {
    requireDispatch: true,
    requiredDispatchInputs: ['rc_tag', 'ref', 'build_ml'],
    requireBranding: true,
    brandingBeforeMarkers: ['docker/build-push-action'],
    requireServerImage: true,
    requireMlImage: true,
    requireRcSummaryLinks: true,
  },
  '.github/workflows/gallery-release-server-only.yml': {
    requireDispatch: true,
    requiredDispatchInputs: ['version', 'commit'],
    requireBranding: true,
    brandingBeforeMarkers: ['docker/build-push-action'],
    requireServerImage: true,
    requireMlImage: true,
  },
  '.github/workflows/gallery-release-mobile.yml': {
    requireDispatch: true,
    requiredDispatchInputs: ['version'],
    requiredWorkflowReferences: ['gallery-build-mobile.yml'],
  },
  '.github/workflows/gallery-build-mobile.yml': {
    requireDispatch: true,
    requiredDispatchInputs: ['environment', 'version', 'build_target'],
    requireBranding: true,
    brandingBeforeMarkers: ['Build signed Android App Bundle', 'flutter build'],
  },
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
};

export function classifyConfidenceSurfaces(
  files: string[],
): ConfidenceSurfaceMatch[] {
  return (Object.keys(surfaceGlobs) as ConfidenceSurface[])
    .map((surface) => ({
      surface,
      files: micromatch(files, surfaceGlobs[surface], { dot: true }),
    }))
    .filter((match) => match.files.length > 0)
    .sort((left, right) => left.surface.localeCompare(right.surface));
}

export function renderRequiredConfidenceChecks(
  matches: ConfidenceSurfaceMatch[],
  batch = '<id>',
  availability: ConfidenceCheckAvailability = {
    makeTargets: new Set(),
    workflows: new Set(),
  },
): string[] {
  if (matches.length === 0) {
    return [
      'No extra risk-based confidence checks are required for this batch',
    ];
  }

  const bySurface = new Map(
    matches.map((match) => [match.surface, match.files] as const),
  );
  const details: string[] = [];
  const reasonFor = (...surfaces: ConfidenceSurface[]) =>
    surfaces
      .filter((surface) => bySurface.has(surface))
      .map((surface) => `${surface}: ${bySurface.get(surface)?.join(', ')}`)
      .join('; ');

  if (
    bySurface.has('branding') ||
    bySurface.has('release') ||
    bySurface.has('docker')
  ) {
    details.push(
      renderPlannedCheck(
        {
          kind: 'make',
          name: 'gallery-branding-check',
          slice: 3,
          reason: reasonFor('branding', 'release', 'docker'),
        },
        availability,
      ),
    );
  }
  if (bySurface.has('ml') || bySurface.has('docker')) {
    details.push(
      renderPlannedCheck(
        {
          kind: 'make',
          name: 'gallery-ml-smoke',
          slice: 5,
          reason: reasonFor('docker', 'ml'),
        },
        availability,
      ),
    );
  }
  if (bySurface.has('mobile') || bySurface.has('branding')) {
    details.push(
      renderPlannedCheck(
        {
          kind: 'workflow',
          name: 'gallery-mobile-smoke.yml',
          slice: 4,
          reason: reasonFor('mobile', 'branding'),
          command: `gh workflow run gallery-mobile-smoke.yml --ref rebase/upstream-batch-${batch}`,
        },
        availability,
      ),
    );
  }
  if (bySurface.has('ml') || bySurface.has('docker')) {
    details.push(
      renderPlannedCheck(
        {
          kind: 'workflow',
          name: 'gallery-ml-smoke.yml',
          slice: 5,
          reason: reasonFor('docker', 'ml'),
          command: `gh workflow run gallery-ml-smoke.yml --ref rebase/upstream-batch-${batch}`,
        },
        availability,
      ),
    );
  }

  return details;
}

function renderPlannedCheck(
  check: PlannedCheck,
  availability: ConfidenceCheckAvailability,
): string {
  if (check.kind === 'make') {
    const command = `make ${check.name}`;
    if (availability.makeTargets.has(check.name)) {
      return `${command} (required by ${check.reason})`;
    }

    return `planned Slice ${check.slice} check: ${command} (target missing; required by ${check.reason})`;
  }

  if (availability.workflows.has(check.name)) {
    return `${check.command} (required by ${check.reason})`;
  }

  return `planned Slice ${check.slice} workflow: ${check.name} (workflow missing; required by ${check.reason})`;
}

export function validateGalleryWorkflowText(
  workflowPath: string,
  text: string,
  options: WorkflowAssertionOptions,
): AuditResult {
  const details: string[] = [];

  if (options.requireDispatch && !text.includes('workflow_dispatch')) {
    details.push(`${workflowPath} is missing workflow_dispatch`);
  }
  for (const input of options.requiredDispatchInputs ?? []) {
    if (!hasWorkflowDispatchInput(text, input)) {
      details.push(
        `${workflowPath} is missing workflow_dispatch input ${input}`,
      );
    }
  }
  if (
    options.requireBranding &&
    !text.includes('./.github/actions/apply-branding')
  ) {
    details.push(`${workflowPath} is missing ./.github/actions/apply-branding`);
  }
  if (options.requireBranding) {
    for (const marker of options.brandingBeforeMarkers ?? []) {
      const markerIndex = text.indexOf(marker);
      if (markerIndex === -1) {
        details.push(
          `${workflowPath} is missing mobile build marker ${marker}`,
        );
        continue;
      }

      const brandingIndex = text.indexOf('./.github/actions/apply-branding');
      if (brandingIndex !== -1 && brandingIndex > markerIndex) {
        details.push(`${workflowPath} must apply branding before ${marker}`);
      }
    }
  }
  for (const reference of options.requiredWorkflowReferences ?? []) {
    if (!text.includes(reference)) {
      details.push(
        `${workflowPath} is missing workflow reference ${reference}`,
      );
    }
  }
  if (
    options.requireServerImage &&
    !text.includes('ghcr.io/open-noodle/gallery-server')
  ) {
    details.push(
      `${workflowPath} is missing ghcr.io/open-noodle/gallery-server`,
    );
  }
  if (
    options.requireMlImage &&
    !text.includes('ghcr.io/open-noodle/gallery-ml')
  ) {
    details.push(`${workflowPath} is missing ghcr.io/open-noodle/gallery-ml`);
  }
  if (options.requireRcSummaryLinks) {
    for (const image of [
      'ghcr.io/open-noodle/gallery-server:${RC_TAG}',
      'ghcr.io/open-noodle/gallery-ml:${RC_TAG}',
    ]) {
      if (!text.includes(image)) {
        details.push(`${workflowPath} RC summary is missing ${image}`);
      }
    }
  }
  for (const image of [
    'ghcr.io/immich-app/immich-server',
    'ghcr.io/immich-app/immich-machine-learning',
    'ghcr.io/immich-app/immich-web',
  ]) {
    if (text.includes(image)) {
      details.push(`${workflowPath} contains upstream image ${image}`);
    }
  }

  return {
    ok: details.length === 0,
    title: `${workflowPath} static assertions`,
    details: details.length === 0 ? [`${workflowPath} passed`] : details,
  };
}

function hasWorkflowDispatchInput(text: string, input: string): boolean {
  const escapedInput = input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\n)\\s{6,}${escapedInput}:`, 'm').test(text);
}

export function runGalleryWorkflowAssertions(
  cwd = process.cwd(),
  workflowTexts?: Record<string, string>,
): AuditResult {
  const details = Object.entries(workflowAssertions).flatMap(
    ([workflowPath, options]) => {
      const text =
        workflowTexts?.[workflowPath] ?? readWorkflowText(cwd, workflowPath);
      return validateGalleryWorkflowText(
        workflowPath,
        text,
        options,
      ).details.filter((detail) => !detail.endsWith(' passed'));
    },
  );

  return {
    ok: details.length === 0,
    title: 'Gallery Release Workflow Static Assertions',
    details:
      details.length === 0
        ? ['All Gallery release workflow assertions passed']
        : details,
  };
}

export function runRebaseConfidenceAudits(
  input: RebaseConfidenceAuditInput,
): AuditResult[] {
  const matches = classifyConfidenceSurfaces(input.upstreamTouchedFiles);
  const requirementDetails = renderRequiredConfidenceChecks(
    matches,
    input.batch,
    readConfidenceCheckAvailability(input.cwd ?? process.cwd()),
  );

  const ownershipResults = input.ownership
    ? [runStrictOwnershipConfidenceAudit(input.ownership)]
    : [];

  return [
    runGalleryWorkflowAssertions(input.cwd, input.workflowTexts),
    ...ownershipResults,
    {
      ok: true,
      title: 'Risk-Based Confidence Requirements',
      details: requirementDetails,
    },
  ];
}

export function runStrictOwnershipConfidenceAudit(
  input: StrictOwnershipConfidenceInput,
): AuditResult {
  const uncovered = findUncoveredFiles(input.forkFiles, input.manifest);
  const broadOptionalOnly = findBroadOptionalOnlyFiles(
    input.forkFiles,
    input.manifest,
    input.headValidation.changedSinceBaseline,
  );
  const details = [
    ...input.headValidation.errors,
    ...uncovered.map((file) => `Ownership manifest does not cover ${file}`),
    ...broadOptionalOnly.map(
      (classification) =>
        `${classification.file} is covered only by broad optional glob ${classification.broadOptionalGlobs.join(', ')}`,
    ),
  ];

  if (details.length > 0) {
    return {
      ok: false,
      title: 'Strict Ownership Confidence',
      details,
    };
  }

  return {
    ok: true,
    title: 'Strict Ownership Confidence',
    details:
      input.headValidation.warnings.length > 0
        ? input.headValidation.warnings
        : [
            'Ownership manifest is current and all fork files have explicit or narrow coverage',
          ],
  };
}

function readWorkflowText(cwd: string, workflowPath: string): string {
  const fullPath = path.join(cwd, workflowPath);
  return fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf8') : '';
}

function readConfidenceCheckAvailability(
  cwd: string,
): ConfidenceCheckAvailability {
  return {
    makeTargets: readMakeTargets(path.join(cwd, 'Makefile')),
    workflows: readWorkflowFiles(path.join(cwd, '.github/workflows')),
  };
}

function readMakeTargets(makefilePath: string): Set<string> {
  if (!fs.existsSync(makefilePath)) return new Set();

  const text = fs.readFileSync(makefilePath, 'utf8');
  return new Set(
    [...text.matchAll(/^([A-Za-z0-9_.-]+):(?:\s|$)/gm)].map(
      (match) => match[1],
    ),
  );
}

function readWorkflowFiles(workflowDir: string): Set<string> {
  if (!fs.existsSync(workflowDir)) return new Set();

  return new Set(
    fs
      .readdirSync(workflowDir)
      .filter((entry) => entry.endsWith('.yml') || entry.endsWith('.yaml')),
  );
}
