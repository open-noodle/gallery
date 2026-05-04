import fs from 'node:fs';
import path from 'node:path';
import type { AuditResult, Manifest } from '../types';

export type MobileDriftInput = {
  galleryOwnedVersions: number[];
  galleryVersionsShipped: boolean;
  currentDbRepository: string;
  currentSnapshots: string[];
  upstreamTouchedFiles: string[];
  expectedGalleryCallbacks?: Record<number, string[]>;
};

export function analyzeMobileDriftFiles(input: MobileDriftInput): AuditResult {
  const details: string[] = [];
  const schemaVersionMatch = input.currentDbRepository.match(
    /schemaVersion\s*=>\s*(\d+)/,
  );
  const schemaVersion = schemaVersionMatch
    ? Number(schemaVersionMatch[1])
    : undefined;
  const snapshotVersions = input.currentSnapshots
    .map((file) => file.match(/drift_schema_v(\d+)\.json/)?.[1])
    .filter((value): value is string => Boolean(value))
    .map(Number)
    .sort((left, right) => left - right);
  const highestSnapshot = snapshotVersions.at(-1);
  const lowestSnapshot = snapshotVersions[0];
  const snapshotCounts = new Map<number, number>();
  for (const version of snapshotVersions) {
    snapshotCounts.set(version, (snapshotCounts.get(version) ?? 0) + 1);
  }

  if (schemaVersion === undefined)
    details.push('Could not read mobile schemaVersion');
  if (highestSnapshot !== undefined && schemaVersion !== highestSnapshot) {
    details.push(
      `schemaVersion ${String(schemaVersion)} does not match highest snapshot v${highestSnapshot}`,
    );
  }
  for (const [version, count] of snapshotCounts.entries()) {
    if (count > 1) details.push(`Duplicate Drift snapshot version v${version}`);
  }
  for (
    let version = lowestSnapshot ?? 1;
    version <= (schemaVersion ?? 0);
    version++
  ) {
    if (!snapshotCounts.has(version))
      details.push(`Missing Drift snapshot v${version}`);
  }

  for (const version of input.galleryOwnedVersions) {
    const upstreamTouchesVersion = input.upstreamTouchedFiles.some((file) =>
      file.includes(`drift_schema_v${version}.json`),
    );
    if (input.galleryVersionsShipped && upstreamTouchesVersion) {
      details.push(
        `Upstream touches shipped Gallery Drift version v${version}; keep Gallery v23/v24 and renumber incoming upstream migrations to v25/v26`,
      );
    }

    const expectedMarkers = input.expectedGalleryCallbacks?.[version] ?? [];
    const callbackName = `from${version - 1}To${version}`;
    if (!input.currentDbRepository.includes(callbackName)) {
      details.push(`Missing migration callback ${callbackName}`);
    }
    const callbackStart = input.currentDbRepository.indexOf(callbackName);
    const callbackText =
      callbackStart >= 0
        ? input.currentDbRepository.slice(
            callbackStart,
            input.currentDbRepository.indexOf(
              'from',
              callbackStart + callbackName.length,
            ) >= 0
              ? input.currentDbRepository.indexOf(
                  'from',
                  callbackStart + callbackName.length,
                )
              : undefined,
          )
        : '';
    for (const marker of expectedMarkers) {
      if (!callbackText.includes(marker)) {
        details.push(`${callbackName} is missing Gallery marker ${marker}`);
      }
    }
  }

  return {
    ok: details.length === 0,
    title: 'Mobile Drift Migration Check',
    details:
      details.length > 0
        ? details
        : [
            'Mobile Drift schemaVersion, snapshots, and Gallery callbacks are consistent',
          ],
  };
}

export function runMobileDriftAudit(
  manifest: Manifest,
  upstreamTouchedFiles: string[],
  cwd = process.cwd(),
): AuditResult {
  const ownedVersions = Object.values(manifest.features).flatMap(
    (feature) => feature.mobile?.drift_versions?.owned ?? [],
  );
  const expectedGalleryCallbacks = Object.assign(
    {},
    ...Object.values(manifest.features).map(
      (feature) => feature.mobile?.drift_versions?.expected_callbacks ?? {},
    ),
  ) as Record<number, string[]>;
  const shipped = Object.values(manifest.features).some(
    (feature) => feature.mobile?.drift_versions?.shipped,
  );
  const repositoryPath = path.join(
    cwd,
    'mobile/lib/infrastructure/repositories/db.repository.dart',
  );
  const snapshotsPath = path.join(cwd, 'mobile/drift_schemas/main');

  return analyzeMobileDriftFiles({
    galleryOwnedVersions: [...new Set(ownedVersions)],
    galleryVersionsShipped: shipped,
    currentDbRepository: fs.existsSync(repositoryPath)
      ? fs.readFileSync(repositoryPath, 'utf8')
      : '',
    currentSnapshots: fs.existsSync(snapshotsPath)
      ? fs.readdirSync(snapshotsPath)
      : [],
    upstreamTouchedFiles,
    expectedGalleryCallbacks,
  });
}
