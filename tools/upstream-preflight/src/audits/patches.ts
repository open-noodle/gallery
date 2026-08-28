import fs from 'node:fs';
import path from 'node:path';
import type { AuditResult, Manifest, PackagePatch } from '../types';

/**
 * Versions an importer actually resolved for `pkg`, read from pnpm-lock.yaml.
 *
 * Only the `importers:` section states a dependency as a `'<pkg>':` key followed by
 * `specifier:` / `version:` lines; `snapshots:` states them inline as
 * `'<pkg>': <version>`, which this deliberately does not match.
 */
export function resolvedImporterVersions(
  lockText: string,
  pkg: string,
): string[] {
  const lines = lockText.split('\n');
  const key = `'${pkg}':`;
  const versions: string[] = [];

  for (const [index, line] of lines.entries()) {
    if (line.trim() !== key) continue;
    for (const next of lines.slice(index + 1, index + 4)) {
      const match = /^\s+version:\s*(.+)$/.exec(next);
      if (match) {
        versions.push(match[1].trim());
        break;
      }
    }
  }

  return versions;
}

/** `patches/@immich__ui@0.86.0.patch` -> `0.86.0` */
function patchFileVersion(expectedPatch: string): string | undefined {
  return /@(\d[^@]*)\.patch$/.exec(path.basename(expectedPatch))?.[1];
}

export function checkPackagePatchText(
  patch: PackagePatch,
  sourceText: string,
  existingPatchFiles: string[],
  lockText?: string,
): AuditResult {
  const details: string[] = [];

  if (!sourceText.includes(patch.expected_patch)) {
    details.push(
      `${patch.version_source} does not reference ${patch.expected_patch}`,
    );
  }

  if (!existingPatchFiles.includes(patch.expected_patch)) {
    details.push(`Missing patch file ${patch.expected_patch}`);
  }

  // patchedDependencies pins by exact version, so an upstream bump leaves the entry
  // matching nothing and pnpm installs the package unpatched WITHOUT failing. Assert
  // against what the lockfile actually resolved rather than against the declaration.
  if (lockText !== undefined) {
    const resolved = resolvedImporterVersions(lockText, patch.package);
    const declared = patchFileVersion(patch.expected_patch);

    for (const version of resolved) {
      const base = version.split('(')[0];

      if (declared !== undefined && base !== declared) {
        details.push(
          `${patch.package} resolves to ${base} but ${patch.expected_patch} is pinned to ${declared} — re-derive the patch against ${base}`,
        );
        continue;
      }

      if (!version.includes('patch_hash=')) {
        details.push(
          `${patch.package} resolves to ${base} with no patch applied — the fork patch is silently inactive`,
        );
      }
    }
  }

  return {
    ok: details.length === 0,
    title: `Patch check: ${patch.package}`,
    details:
      details.length > 0
        ? details
        : [`${patch.package} patch metadata is consistent`],
  };
}

export function runPatchAudits(
  manifest: Manifest,
  cwd = process.cwd(),
): AuditResult[] {
  const patchFiles = listPatchFiles(path.join(cwd, 'patches')).map(
    (file) => `patches/${file}`,
  );
  const lockPath = path.join(cwd, 'pnpm-lock.yaml');
  const lockText = fs.existsSync(lockPath)
    ? fs.readFileSync(lockPath, 'utf8')
    : undefined;

  return (manifest.patches ?? []).map((patch) => {
    const sourcePath = path.join(cwd, patch.version_source);
    const sourceText = fs.existsSync(sourcePath)
      ? fs.readFileSync(sourcePath, 'utf8')
      : '';
    return checkPackagePatchText(patch, sourceText, patchFiles, lockText);
  });
}

function listPatchFiles(patchRoot: string): string[] {
  if (!fs.existsSync(patchRoot)) {
    return [];
  }

  return fs
    .readdirSync(patchRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
}
