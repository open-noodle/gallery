import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import micromatch from 'micromatch';
import { defaultManifestPath, loadManifest } from './manifest';
import type { FeatureEntry, Manifest } from './types';

const micromatchOptions = { dot: true };

export function manifestCoverageGlobs(manifest: Manifest): string[] {
  const globs = new Set<string>();

  for (const feature of Object.values(manifest.features)) {
    for (const glob of featureCoverageGlobs(feature)) {
      globs.add(glob);
    }
  }

  for (const invariant of manifest.ci_invariants ?? []) {
    for (const glob of invariant.paths) {
      globs.add(glob);
    }
    for (const exception of invariant.exceptions ?? []) {
      globs.add(exception);
    }
  }

  for (const patch of manifest.patches ?? []) {
    globs.add(patch.expected_patch);
    globs.add(patch.version_source);
  }

  return [...globs].sort();
}

export function findUncoveredFiles(
  files: string[],
  manifest: Manifest,
): string[] {
  const coverageGlobs = manifestCoverageGlobs(manifest);
  const ignoreGlobs = manifest.coverage_ignore ?? [];

  return files
    .filter((file) => !micromatch.isMatch(file, ignoreGlobs, micromatchOptions))
    .filter(
      (file) => !micromatch.isMatch(file, coverageGlobs, micromatchOptions),
    );
}

export function validateManifestForkHead(
  manifest: Manifest,
  expectedHead: string | undefined,
): string[] {
  if (!expectedHead) {
    return [];
  }

  if (manifest.metadata.last_verified_fork_head === expectedHead) {
    return [];
  }

  return [
    `Ownership manifest last_verified_fork_head ${manifest.metadata.last_verified_fork_head} does not match ${expectedHead}`,
  ];
}

export function runCoverageCli(argv = process.argv.slice(2)) {
  const options = parseCoverageArgs(argv);
  const { fileListPath, manifestPath, expectedHead } = options;
  if (!fileListPath) {
    throw new Error(
      'Usage: tsx src/coverage.ts <fork-file-list> [manifest-path] [--expected-head <sha>]',
    );
  }

  const manifest = loadManifest(resolveCliPath(manifestPath));
  const files = fs
    .readFileSync(resolveCliPath(fileListPath), 'utf8')
    .split(/\r?\n/)
    .filter(Boolean);
  const uncovered = findUncoveredFiles(files, manifest);
  const headErrors = validateManifestForkHead(manifest, expectedHead);

  if (uncovered.length > 0 || headErrors.length > 0) {
    for (const error of headErrors) {
      console.error(error);
    }
    if (uncovered.length > 0) {
      console.error(
        `Ownership manifest does not cover ${uncovered.length} fork files:`,
      );
      for (const file of uncovered) {
        console.error(file);
      }
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Ownership manifest covers ${files.length} fork files`);
}

function resolveCliPath(inputPath: string) {
  return path.resolve(process.env.INIT_CWD ?? process.cwd(), inputPath);
}

function parseCoverageArgs(argv: string[]) {
  const args = argv[0] === '--' ? argv.slice(1) : argv;
  const positional: string[] = [];
  let expectedHead: string | undefined;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--expected-head') {
      if (!args[index + 1]) {
        throw new Error('--expected-head requires a commit SHA');
      }
      expectedHead = args[index + 1];
      index++;
      continue;
    }
    positional.push(arg);
  }

  return {
    fileListPath: positional[0],
    manifestPath: positional[1] ?? defaultManifestPath,
    expectedHead,
  };
}

function featureCoverageGlobs(feature: FeatureEntry): string[] {
  return [
    ...(feature.owned_paths ?? []),
    ...(feature.upstream_extension_paths ?? []),
    ...(feature.optional_paths ?? []),
    ...Object.keys(feature.expected_symbols ?? {}),
    ...(feature.generated_artifacts ?? []),
    ...(feature.database?.migration_globs ?? []),
    ...(feature.database?.expected_migrations ?? []),
    ...(feature.mobile?.paths ?? []),
  ];
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runCoverageCli();
}
