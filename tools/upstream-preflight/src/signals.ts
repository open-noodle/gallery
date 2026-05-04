import micromatch from 'micromatch';
import type { ClassifiedCommit, Manifest } from './types';
import type { FeatureOverlap } from './report';

export function collectExtensionHotspots(
  manifest: Manifest,
  classifiedCommits: ClassifiedCommit[],
) {
  const byPath = new Map<
    string,
    { path: string; hits: number; features: Set<string> }
  >();

  for (const [featureId, feature] of Object.entries(manifest.features)) {
    for (const extensionPath of feature.upstream_extension_paths ?? []) {
      const hits = classifiedCommits.filter(
        (commit) => micromatch(commit.files, extensionPath).length > 0,
      ).length;
      if (hits === 0) continue;
      const existing = byPath.get(extensionPath) ?? {
        path: extensionPath,
        hits,
        features: new Set<string>(),
      };
      existing.hits = Math.max(existing.hits, hits);
      existing.features.add(featureId);
      byPath.set(extensionPath, existing);
    }
  }

  return [...byPath.values()]
    .map((hotspot) => ({
      path: hotspot.path,
      hits: hotspot.hits,
      features: [...hotspot.features].sort(),
    }))
    .sort((left, right) => right.hits - left.hits)
    .slice(0, 20);
}

export function collectFeatureOverlaps(
  manifest: Manifest,
  classifiedCommits: ClassifiedCommit[],
): FeatureOverlap[] {
  const byFeature = new Map<
    string,
    { commits: Set<string>; files: Set<string> }
  >();

  for (const commit of classifiedCommits) {
    for (const [featureId, feature] of Object.entries(manifest.features)) {
      const matchedFiles = micromatch(
        commit.files,
        featureSignalGlobs(feature),
        {
          dot: true,
        },
      );
      if (matchedFiles.length === 0) continue;

      const overlap = byFeature.get(featureId) ?? {
        commits: new Set<string>(),
        files: new Set<string>(),
      };
      overlap.commits.add(commit.shortSha);
      for (const file of matchedFiles) overlap.files.add(file);
      byFeature.set(featureId, overlap);
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

function featureSignalGlobs(feature: Manifest['features'][string]): string[] {
  return [
    ...(feature.owned_paths ?? []),
    ...(feature.upstream_extension_paths ?? []),
    ...(feature.mobile?.paths ?? []),
    ...(feature.database?.migration_globs ?? []),
    ...(feature.database?.expected_migrations ?? []),
    ...Object.keys(feature.expected_symbols ?? {}),
    ...(feature.generated_artifacts ?? []),
  ];
}
