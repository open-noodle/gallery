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

export function runCoverageCli(argv = process.argv.slice(2)) {
  const [fileListPath, manifestPath = defaultManifestPath] =
    argv[0] === '--' ? argv.slice(1) : argv;
  if (!fileListPath) {
    throw new Error(
      'Usage: tsx src/coverage.ts <fork-file-list> [manifest-path]',
    );
  }

  const manifest = loadManifest(resolveCliPath(manifestPath));
  const files = fs
    .readFileSync(resolveCliPath(fileListPath), 'utf8')
    .split(/\r?\n/)
    .filter(Boolean);
  const uncovered = findUncoveredFiles(files, manifest);

  if (uncovered.length > 0) {
    console.error(
      `Ownership manifest does not cover ${uncovered.length} fork files:`,
    );
    for (const file of uncovered) {
      console.error(file);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Ownership manifest covers ${files.length} fork files`);
}

function resolveCliPath(inputPath: string) {
  return path.resolve(process.env.INIT_CWD ?? process.cwd(), inputPath);
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
