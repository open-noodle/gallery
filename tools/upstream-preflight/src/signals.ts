import micromatch from 'micromatch';
import type { ClassifiedCommit, Manifest } from './types';

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
