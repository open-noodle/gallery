#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import micromatch from 'micromatch';
import { Command } from 'commander';
import { runCiInvariantAudits } from './audits/ci-invariants';
import { runCommitAutolinkAudit } from './audits/commit-autolinks';
import { runMobileDriftAudit } from './audits/mobile-drift';
import { runPatchAudits } from './audits/patches';
import {
  parseQueryBlocks,
  runPostRebaseAudits,
  writePostRebaseAuditReport,
} from './audits/post-rebase';
import { runRebaseConfidenceAudits } from './audits/rebase-confidence';
import {
  planBatches,
  readPersistedBatchAuditScope,
  readPersistedBatchPlan,
  renderBatchMarkdown,
  runNextBatchCommand,
  selectBatchAuditScope,
  validatePersistedBatchPlan,
  writeBatchPlanReports,
} from './batch';
import {
  findBroadOptionalOnlyFiles,
  findUncoveredFiles,
  validateManifestForkHead,
} from './coverage';
import {
  collectGitRange,
  getGitPath,
  getMergeBase,
  revParse,
  runGit,
} from './git';
import { defaultManifestPath, loadManifest } from './manifest';
import {
  evaluateReadiness,
  readinessExitCode,
  renderReadinessMarkdown,
  writeReadinessReports,
} from './ready';
import { renderPreflightMarkdown } from './report';
import {
  assertNoActiveRollingSync,
  readRollingState,
  rollingStatePath,
  runRollingFinalCheckCommand,
  runRollingStartCommand,
  runRollingStatusCommand,
  runRollingSyncForkMainCommand,
} from './rolling';
import { classifyCommit, detectDomain } from './risk';
import {
  collectExtensionHotspots,
  collectFeatureOverlaps,
  collectForkSurfaceSignals,
} from './signals';
import type { ClassifiedCommit, Manifest } from './types';

const program = new Command()
  .name('gallery-upstream-preflight')
  .description('Gallery upstream rebase preflight and audit tooling');
const defaultBatchSoftCap = 10;

function resolveCliPath(inputPath: string) {
  return path.resolve(process.env.INIT_CWD ?? process.cwd(), inputPath);
}

function repoRoot() {
  return process.env.INIT_CWD ?? process.cwd();
}

function buildPreflightContext(manifestPath: string) {
  const manifest = loadManifest(resolveCliPath(manifestPath));
  const upstreamRef = `${manifest.metadata.upstream_remote}/${manifest.metadata.upstream_branch}`;
  const forkRef = `${manifest.metadata.fork_remote}/${manifest.metadata.fork_branch}`;
  const mergeBase = getMergeBase(process.cwd(), forkRef, upstreamRef);
  const upstreamHead = revParse(process.cwd(), upstreamRef);
  const forkHead = revParse(process.cwd(), forkRef);
  const upstreamRange = collectGitRange(
    process.cwd(),
    `${mergeBase}..${upstreamRef}`,
  );
  const forkRange = collectGitRange(process.cwd(), `${mergeBase}..${forkRef}`);
  const classifiedCommits = upstreamRange.commits.map((commit) =>
    classifyCommit(commit, manifest, forkRange.files),
  );
  const overlapFiles = upstreamRange.files.filter((file) =>
    forkRange.files.includes(file),
  );
  const batchPlan = planBatches(classifiedCommits, {
    metadata: {
      generatedAt: new Date().toISOString(),
      mergeBase,
      upstreamRef,
      upstreamHead,
      forkRef,
      forkHead,
      manifestForkBaseline: manifest.metadata.last_verified_fork_head,
      softCap: defaultBatchSoftCap,
    },
    softCap: defaultBatchSoftCap,
    checks: manifest.checks,
  });
  const batchMarkdown = renderBatchMarkdown(batchPlan, manifest.checks);
  const headValidation = validateManifestForkHead(manifest, {
    repoPath: process.cwd(),
    expectedHead: forkHead,
  });
  const broadOptionalOnly = findBroadOptionalOnlyFiles(
    forkRange.files,
    manifest,
    headValidation.changedSinceBaseline,
  );
  const forkSurfaceSignals = collectForkSurfaceSignals({
    manifest,
    forkFiles: forkRange.files,
    overlapFiles,
    broadOnlyRecentFiles: broadOptionalOnly,
  });

  return {
    manifest,
    mergeBase,
    upstreamRange,
    forkRange,
    batchPlan,
    classifiedCommits,
    overlapFiles,
    batchMarkdown,
    headValidation,
    broadOptionalOnly,
    forkSurfaceSignals,
  };
}

function collectDomainOverlaps(overlapFiles: string[]) {
  const byDomain = new Map<string, string[]>();
  for (const file of overlapFiles) {
    const domain = detectDomain(file);
    byDomain.set(domain, [...(byDomain.get(domain) ?? []), file]);
  }
  return [...byDomain.entries()]
    .map(([domain, files]) => ({ domain, files: files.sort() }))
    .sort((left, right) => left.domain.localeCompare(right.domain));
}

function collectSignalFiles(files: string[], globs: string[]): string[] {
  return micromatch(files, globs).sort();
}

function collectServerTableOverlaps(
  manifest: Manifest,
  upstreamFiles: string[],
) {
  const upstreamText = upstreamFiles.join('\n');
  const tables = Object.values(manifest.features).flatMap(
    (feature) => feature.database?.tables ?? [],
  );
  return [...new Set(tables)]
    .filter(
      (table) =>
        upstreamText.includes(table) ||
        upstreamText.includes(table.replaceAll('_', '-')),
    )
    .sort();
}

function collectBroadRefactorHints(commits: ClassifiedCommit[]): string[] {
  return commits
    .filter(
      (commit) =>
        commit.files.length >= 25 ||
        commit.reasons.some((reason) => reason.includes('breaking-refactor')),
    )
    .map(
      (commit) =>
        `${commit.shortSha} touches ${commit.files.length} files: ${commit.subject}`,
    );
}

function renderPreflightForContext(
  context: ReturnType<typeof buildPreflightContext>,
  date: string,
) {
  return renderPreflightMarkdown({
    date,
    mergeBase: context.mergeBase.slice(0, 9),
    upstreamShortStat: context.upstreamRange.shortStat,
    forkShortStat: context.forkRange.shortStat,
    classifiedCommits: context.classifiedCommits,
    incomingCommits: context.classifiedCommits,
    forkFileCount: context.forkRange.files.length,
    upstreamFileCount: context.upstreamRange.files.length,
    overlapFiles: context.overlapFiles,
    domainOverlaps: collectDomainOverlaps(context.overlapFiles),
    featureOverlaps: collectFeatureOverlaps(
      context.manifest,
      context.classifiedCommits,
    ),
    dependencyChanges: collectSignalFiles(context.upstreamRange.files, [
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      '**/package.json',
      'machine-learning/pyproject.toml',
      'machine-learning/uv.lock',
    ]),
    serverMigrationChanges: collectSignalFiles(context.upstreamRange.files, [
      'server/src/schema/migrations/**',
      'server/src/schema/tables/**',
    ]),
    serverTableOverlaps: collectServerTableOverlaps(
      context.manifest,
      context.upstreamRange.files,
    ),
    mobileDriftChanges: collectSignalFiles(context.upstreamRange.files, [
      'mobile/lib/data/db/main/database.dart',
      'mobile/drift_schemas/main/**',
    ]),
    ciWorkflowChanges: collectSignalFiles(context.upstreamRange.files, [
      '.github/workflows/**',
    ]),
    broadRefactorHints: collectBroadRefactorHints(context.classifiedCommits),
    batchMarkdown: context.batchMarkdown,
    auditResults: [
      runMobileDriftAudit(
        context.manifest,
        context.upstreamRange.files,
        repoRoot(),
      ),
      ...runCiInvariantAudits(context.manifest, repoRoot()),
      ...runPatchAudits(context.manifest, repoRoot()),
    ],
    extensionHotspots: collectExtensionHotspots(
      context.manifest,
      context.classifiedCommits,
    ),
    forkSurfaceSignals: context.forkSurfaceSignals,
  });
}

function writePreflightReports(
  outputDir: string,
  context: ReturnType<typeof buildPreflightContext>,
  date: string,
) {
  fs.mkdirSync(outputDir, { recursive: true });
  const markdown = renderPreflightForContext(context, date);
  const markdownPath = path.join(outputDir, `preflight-${date}.md`);
  const jsonPath = path.join(outputDir, 'preflight.json');

  fs.writeFileSync(markdownPath, markdown);
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        mergeBase: context.mergeBase,
        classifiedCommits: context.classifiedCommits,
        forkSurfaceSignals: context.forkSurfaceSignals,
      },
      null,
      2,
    ),
  );

  return { markdown, markdownPath, jsonPath };
}

program
  .command('preflight')
  .option('--manifest <path>', 'ownership manifest path', defaultManifestPath)
  .option('--output-dir <path>', 'generated report directory')
  .action((options: { manifest: string; outputDir?: string }) => {
    const context = buildPreflightContext(options.manifest);
    const date = new Date().toISOString().slice(0, 10);
    const outputDir = options.outputDir
      ? resolveCliPath(options.outputDir)
      : getGitPath(process.cwd(), 'upstream-preflight');

    const { markdown } = writePreflightReports(outputDir, context, date);
    console.log(markdown);
  });

program
  .command('ready')
  .option('--manifest <path>', 'ownership manifest path', defaultManifestPath)
  .option('--output-dir <path>', 'generated report directory')
  .action((options: { manifest: string; outputDir?: string }) => {
    const outputDir = options.outputDir
      ? resolveCliPath(options.outputDir)
      : getGitPath(process.cwd(), 'upstream-preflight');
    let result = evaluateReadiness({});

    try {
      const context = buildPreflightContext(options.manifest);
      const date = new Date().toISOString().slice(0, 10);
      const preflight = writePreflightReports(outputDir, context, date);
      const batchPlan = writeBatchPlanReports(
        context.batchPlan,
        outputDir,
        context.manifest.checks,
      );
      const postRebaseAuditResults = runPostRebaseAudits(
        context.manifest,
        context.upstreamRange.files,
        repoRoot(),
      );

      result = evaluateReadiness({
        uncoveredFiles: findUncoveredFiles(
          context.forkRange.files,
          context.manifest,
        ),
        headValidation: context.headValidation,
        broadOptionalOnly: context.broadOptionalOnly,
        ciResults: runCiInvariantAudits(context.manifest, repoRoot()),
        patchResults: runPatchAudits(context.manifest, repoRoot()),
        postRebaseAuditResults,
        planningResults: [
          runMobileDriftAudit(
            context.manifest,
            context.upstreamRange.files,
            repoRoot(),
          ),
        ],
        reportPaths: [
          preflight.markdownPath,
          preflight.jsonPath,
          batchPlan.markdownPath,
          batchPlan.jsonPath,
        ],
      });
    } catch (error) {
      result = evaluateReadiness({ batchPlanError: errorMessage(error) });
    }

    const { result: writtenResult } = writeReadinessReports(outputDir, result);
    console.log(renderReadinessMarkdown(writtenResult));
    process.exitCode = readinessExitCode(writtenResult);
  });

program
  .command('batch-plan')
  .option('--manifest <path>', 'ownership manifest path', defaultManifestPath)
  .option('--output-dir <path>', 'generated batch plan directory')
  .action((options: { manifest: string; outputDir?: string }) => {
    const context = buildPreflightContext(options.manifest);
    const outputDir = options.outputDir
      ? resolveCliPath(options.outputDir)
      : getGitPath(process.cwd(), 'upstream-preflight');
    const { markdownPath, jsonPath } = writeBatchPlanReports(
      context.batchPlan,
      outputDir,
      context.manifest.checks,
    );
    console.log(context.batchMarkdown);
    console.log(`Wrote batch plan Markdown: ${markdownPath}`);
    console.log(`Wrote batch plan JSON: ${jsonPath}`);
  });

program
  .command('next-batch')
  .option('--manifest <path>', 'ownership manifest path', defaultManifestPath)
  .option('--output-dir <path>', 'generated batch plan directory')
  .action((options: { manifest: string; outputDir?: string }) => {
    const outputDir = options.outputDir
      ? resolveCliPath(options.outputDir)
      : undefined;
    try {
      assertNoActiveRollingSync(process.cwd(), outputDir);
    } catch (error) {
      console.error(errorMessage(error));
      process.exitCode = 1;
      return;
    }

    const manifest = loadManifest(resolveCliPath(options.manifest));
    const rollingStateFile = rollingStatePath(process.cwd(), outputDir);
    const expectedUpstreamHead = fs.existsSync(rollingStateFile)
      ? readRollingState(process.cwd(), outputDir).upstreamTargetHead
      : undefined;
    process.exitCode = runNextBatchCommand({
      repoPath: process.cwd(),
      outputDir,
      expectedUpstreamHead,
      checks: manifest.checks,
    });
  });

program
  .command('rolling-start')
  .option('--output-dir <path>', 'rolling state and batch plan directory')
  .option('--resume', 'resume an existing rolling state')
  .action((options: { outputDir?: string; resume?: boolean }) => {
    process.exitCode = runRollingStartCommand({
      repoPath: process.cwd(),
      outputDir: options.outputDir
        ? resolveCliPath(options.outputDir)
        : undefined,
      resume: options.resume,
    });
  });

program
  .command('rolling-status')
  .option('--output-dir <path>', 'rolling state and batch plan directory')
  .action((options: { outputDir?: string }) => {
    process.exitCode = runRollingStatusCommand({
      repoPath: process.cwd(),
      outputDir: options.outputDir
        ? resolveCliPath(options.outputDir)
        : undefined,
    });
  });

program
  .command('sync-fork-main')
  .option('--output-dir <path>', 'rolling state and batch plan directory')
  .option('--continue', 'continue a fork sync after checks failed')
  .action((options: { outputDir?: string; continue?: boolean }) => {
    process.exitCode = runRollingSyncForkMainCommand({
      repoPath: process.cwd(),
      outputDir: options.outputDir
        ? resolveCliPath(options.outputDir)
        : undefined,
      continue: options.continue,
    });
  });

program
  .command('rolling-final-check')
  .option('--output-dir <path>', 'rolling state and batch plan directory')
  .action((options: { outputDir?: string }) => {
    process.exitCode = runRollingFinalCheckCommand({
      repoPath: process.cwd(),
      outputDir: options.outputDir
        ? resolveCliPath(options.outputDir)
        : undefined,
    });
  });

program
  .command('mobile-drift-check')
  .option('--manifest <path>', 'ownership manifest path', defaultManifestPath)
  .option('--batch <id>', 'upstream batch id')
  .option('--plan-dir <path>', 'persisted batch plan directory')
  .action((options: { manifest: string; batch?: string; planDir?: string }) => {
    const batch = options.batch ?? process.env.BATCH;
    const auditInput = batch
      ? {
          manifest: loadManifest(resolveCliPath(options.manifest)),
          auditScope: readPersistedBatchAuditScope(
            process.cwd(),
            options.planDir ? resolveCliPath(options.planDir) : undefined,
            batch,
          ),
        }
      : (() => {
          const context = buildPreflightContext(options.manifest);
          return {
            manifest: context.manifest,
            auditScope: {
              batch: undefined,
              upstreamTouchedFiles: context.upstreamRange.files,
            },
          };
        })();
    const result = runMobileDriftAudit(
      auditInput.manifest,
      auditInput.auditScope.upstreamTouchedFiles,
      repoRoot(),
    );
    console.log(`${result.ok ? 'OK' : 'ISSUE'}: ${result.title}`);
    for (const detail of result.details) console.log(`- ${detail}`);
    process.exitCode = result.ok ? 0 : 1;
  });

program
  .command('ci-invariants-check')
  .option('--manifest <path>', 'ownership manifest path', defaultManifestPath)
  .action((options: { manifest: string }) => {
    const results = runCiInvariantAudits(
      loadManifest(resolveCliPath(options.manifest)),
      repoRoot(),
    );
    for (const result of results) {
      console.log(`${result.ok ? 'OK' : 'ISSUE'}: ${result.title}`);
      for (const detail of result.details) console.log(`- ${detail}`);
    }
    process.exitCode = results.every((result) => result.ok) ? 0 : 1;
  });

program
  .command('commit-autolink-check')
  .option('--range <range>', 'commit range to scan', 'upstream/main..HEAD')
  .option(
    '--fork-pr-ceiling <n>',
    'highest PR number that belongs to this repo; above it, #N resolves upstream',
  )
  .action((options: { range: string; forkPrCeiling?: string }) => {
    const ceiling = options.forkPrCeiling
      ? Number(options.forkPrCeiling)
      : undefined;
    if (ceiling !== undefined && !Number.isInteger(ceiling)) {
      throw new Error(
        `--fork-pr-ceiling must be an integer, got ${options.forkPrCeiling}`,
      );
    }
    const result = runCommitAutolinkAudit(options.range, repoRoot(), ceiling);
    console.log(`${result.ok ? 'OK' : 'ISSUE'}: ${result.title}`);
    for (const detail of result.details) console.log(`- ${detail}`);
    process.exitCode = result.ok ? 0 : 1;
  });

program
  .command('fork-patches-check')
  .option('--manifest <path>', 'ownership manifest path', defaultManifestPath)
  .action((options: { manifest: string }) => {
    const results = runPatchAudits(
      loadManifest(resolveCliPath(options.manifest)),
      repoRoot(),
    );
    for (const result of results) {
      console.log(`${result.ok ? 'OK' : 'ISSUE'}: ${result.title}`);
      for (const detail of result.details) console.log(`- ${detail}`);
    }
    process.exitCode = results.every((result) => result.ok) ? 0 : 1;
  });

program
  .command('rebase-confidence-check')
  .option('--manifest <path>', 'ownership manifest path', defaultManifestPath)
  .option('--batch <id>', 'upstream batch id')
  .option('--plan-dir <path>', 'persisted batch plan directory')
  .action((options: { manifest: string; batch?: string; planDir?: string }) => {
    const batch = options.batch ?? process.env.BATCH;
    const context = batch ? undefined : buildPreflightContext(options.manifest);
    const auditScope = batch
      ? (() => {
          const root = repoRoot();
          const batchPlan = readPersistedBatchPlan(
            root,
            options.planDir ? resolveCliPath(options.planDir) : undefined,
          );
          validatePersistedBatchPlan(batchPlan, root);
          const upstreamTouchedFiles = [
            ...new Set(
              batchPlan.batches.flatMap((planBatch) =>
                planBatch.commits.flatMap((commit) => commit.files),
              ),
            ),
          ].sort();
          return selectBatchAuditScope({
            batch,
            batchPlan,
            upstreamTouchedFiles,
          });
        })()
      : {
          batch: undefined,
          upstreamTouchedFiles: context!.upstreamRange.files,
        };
    const ownershipContext = context ?? buildPreflightContext(options.manifest);
    const results = runRebaseConfidenceAudits({
      upstreamTouchedFiles: auditScope.upstreamTouchedFiles,
      batch: auditScope.batch ?? batch,
      cwd: repoRoot(),
      ownership: {
        manifest: ownershipContext.manifest,
        forkFiles: ownershipContext.forkRange.files,
        headValidation: ownershipContext.headValidation,
        broadOptionalOnly: ownershipContext.broadOptionalOnly,
      },
    });
    for (const result of results) {
      console.log(`${result.ok ? 'OK' : 'ISSUE'}: ${result.title}`);
      for (const detail of result.details) console.log(`- ${detail}`);
    }
    process.exitCode = results.every((result) => result.ok) ? 0 : 1;
  });

program
  .command('postrebase-audit')
  .option('--manifest <path>', 'ownership manifest path', defaultManifestPath)
  .option('--batch <id>', 'upstream batch id')
  .option('--plan-dir <path>', 'persisted batch plan directory')
  .option('--output-dir <path>', 'post-rebase audit output directory')
  .option(
    '--base <ref>',
    'baseline ref for generated-query-block survival (default: newest backup/rolling-pre-* branch)',
  )
  .action(
    (options: {
      manifest: string;
      batch?: string;
      planDir?: string;
      outputDir?: string;
      base?: string;
    }) => {
      const batch = options.batch ?? process.env.BATCH;
      const auditInput = batch
        ? {
            manifest: loadManifest(resolveCliPath(options.manifest)),
            auditScope: readPersistedBatchAuditScope(
              process.cwd(),
              options.planDir ? resolveCliPath(options.planDir) : undefined,
              batch,
            ),
          }
        : (() => {
            const context = buildPreflightContext(options.manifest);
            return {
              manifest: context.manifest,
              auditScope: {
                batch: undefined,
                upstreamTouchedFiles: context.upstreamRange.files,
              },
            };
          })();
      const results = runPostRebaseAudits(
        auditInput.manifest,
        auditInput.auditScope.upstreamTouchedFiles,
        repoRoot(),
        readBaselineQueryBlocks(repoRoot(), options.base),
      );
      for (const result of results) {
        console.log(`${result.ok ? 'OK' : 'ISSUE'}: ${result.title}`);
        for (const detail of result.details) console.log(`- ${detail}`);
      }
      if (batch || options.outputDir) {
        const outputDir = options.outputDir
          ? resolveCliPath(options.outputDir)
          : path.join(
              getGitPath(process.cwd(), 'upstream-preflight'),
              'batches',
            );
        const { markdownPath } = writePostRebaseAuditReport(outputDir, {
          date: new Date().toISOString().slice(0, 10),
          batch: auditInput.auditScope.batch,
          results,
          upstreamTouchedFiles: auditInput.auditScope.upstreamTouchedFiles,
        });
        console.log(`Wrote post-rebase audit report: ${markdownPath}`);
      }
      process.exitCode = results.every((result) => result.ok) ? 0 : 1;
    },
  );

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Query blocks in `server/src/queries/*.sql` as of the baseline, for the survival check.
 *
 * Defaults to the newest `backup/rolling-pre-*` branch, which the rolling flow creates before every
 * cycle. Returns undefined when there is no baseline to compare against, which skips the check
 * rather than inventing one — a wrong baseline is worse than none.
 */
function readBaselineQueryBlocks(
  cwd: string,
  base?: string,
): Record<string, string[]> | undefined {
  let ref = base;
  if (!ref) {
    const branches = runGit(cwd, [
      'for-each-ref',
      '--format=%(refname:short)',
      '--sort=-committerdate',
      'refs/heads/backup/rolling-pre-*',
    ])
      .split('\n')
      .filter(Boolean);
    ref = branches[0];
  }
  if (!ref) return undefined;

  try {
    const files = runGit(cwd, [
      'ls-tree',
      '-r',
      '--name-only',
      ref,
      '--',
      'server/src/queries',
    ])
      .split('\n')
      .filter((file) => file.endsWith('.sql'));
    if (files.length === 0) return undefined;

    return Object.fromEntries(
      files.map((file) => [
        file,
        parseQueryBlocks(runGit(cwd, ['show', `${ref}:${file}`])),
      ]),
    );
  } catch {
    // An unreadable baseline (pruned backup branch, shallow clone) must not fail the audit.
    return undefined;
  }
}

program.parse(process.argv);
