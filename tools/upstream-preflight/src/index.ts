#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import micromatch from 'micromatch';
import { Command } from 'commander';
import { planBatches, renderBatchMarkdown } from './batch';
import { collectGitRange, getGitPath, getMergeBase } from './git';
import { defaultManifestPath, loadManifest } from './manifest';
import { renderPreflightMarkdown } from './report';
import { classifyCommit, detectDomain } from './risk';
import { collectExtensionHotspots } from './signals';
import type { ClassifiedCommit, Manifest } from './types';

const program = new Command()
  .name('gallery-upstream-preflight')
  .description('Gallery upstream rebase preflight and audit tooling');

function resolveCliPath(inputPath: string) {
  return path.resolve(process.env.INIT_CWD ?? process.cwd(), inputPath);
}

function buildPreflightContext(manifestPath: string) {
  const manifest = loadManifest(resolveCliPath(manifestPath));
  const upstreamRef = `${manifest.metadata.upstream_remote}/${manifest.metadata.upstream_branch}`;
  const forkRef = `${manifest.metadata.fork_remote}/${manifest.metadata.fork_branch}`;
  const mergeBase = getMergeBase(process.cwd(), forkRef, upstreamRef);
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
  const batchPlan = planBatches(classifiedCommits);
  const batchMarkdown = renderBatchMarkdown(batchPlan);

  return {
    manifest,
    mergeBase,
    upstreamRange,
    forkRange,
    classifiedCommits,
    overlapFiles,
    batchMarkdown,
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

function collectFeatureOverlaps(classifiedCommits: ClassifiedCommit[]) {
  const byFeature = new Map<
    string,
    { commits: Set<string>; files: Set<string> }
  >();
  for (const commit of classifiedCommits) {
    for (const feature of commit.features) {
      const overlap = byFeature.get(feature) ?? {
        commits: new Set<string>(),
        files: new Set<string>(),
      };
      overlap.commits.add(commit.shortSha);
      for (const file of commit.files) overlap.files.add(file);
      byFeature.set(feature, overlap);
    }
  }
  return [...byFeature.entries()]
    .map(([feature, overlap]) => ({
      feature,
      commits: [...overlap.commits].sort(),
      files: [...overlap.files].sort(),
    }))
    .sort((left, right) => left.feature.localeCompare(right.feature));
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

program
  .command('preflight')
  .option('--manifest <path>', 'ownership manifest path', defaultManifestPath)
  .option('--output-dir <path>', 'generated report directory')
  .action((options: { manifest: string; outputDir?: string }) => {
    const context = buildPreflightContext(options.manifest);
    const date = new Date().toISOString().slice(0, 10);
    const markdown = renderPreflightMarkdown({
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
      featureOverlaps: collectFeatureOverlaps(context.classifiedCommits),
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
        'mobile/lib/infrastructure/repositories/db.repository.dart',
        'mobile/drift_schemas/main/**',
      ]),
      ciWorkflowChanges: collectSignalFiles(context.upstreamRange.files, [
        '.github/workflows/**',
      ]),
      broadRefactorHints: collectBroadRefactorHints(context.classifiedCommits),
      batchMarkdown: context.batchMarkdown,
      auditResults: [],
      extensionHotspots: collectExtensionHotspots(
        context.manifest,
        context.classifiedCommits,
      ),
    });
    const outputDir = options.outputDir
      ? resolveCliPath(options.outputDir)
      : getGitPath(process.cwd(), 'upstream-preflight');

    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, `preflight-${date}.md`), markdown);
    fs.writeFileSync(
      path.join(outputDir, 'preflight.json'),
      JSON.stringify(
        {
          mergeBase: context.mergeBase,
          classifiedCommits: context.classifiedCommits,
        },
        null,
        2,
      ),
    );
    console.log(markdown);
  });

program
  .command('batch-plan')
  .option('--manifest <path>', 'ownership manifest path', defaultManifestPath)
  .action((options: { manifest: string }) => {
    console.log(buildPreflightContext(options.manifest).batchMarkdown);
  });

for (const command of [
  'postrebase-audit',
  'mobile-drift-check',
  'ci-invariants-check',
  'fork-patches-check',
]) {
  program.command(command).action(() => {
    console.log(`${command} scaffold`);
  });
}

program.parse(process.argv);
