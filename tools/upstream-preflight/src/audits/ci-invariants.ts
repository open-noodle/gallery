import fs from 'node:fs';
import path from 'node:path';
import micromatch from 'micromatch';
import type { AuditResult, CiInvariant, Manifest } from '../types';

export type TextFile = { path: string; text: string };

export function checkCiInvariantText(
  invariant: CiInvariant,
  files: TextFile[],
): AuditResult {
  const details: string[] = [];
  const matchedFiles = files.filter((file) =>
    micromatch.isMatch(file.path, invariant.paths, { dot: true }),
  );

  for (const file of matchedFiles) {
    if (
      invariant.exceptions &&
      micromatch.isMatch(file.path, invariant.exceptions, { dot: true })
    ) {
      continue;
    }
    for (const pattern of invariant.forbidden_patterns) {
      if (file.text.includes(pattern)) {
        details.push(`${file.path} contains forbidden pattern ${pattern}`);
      }
    }
  }

  return {
    ok: details.length === 0,
    title: invariant.title,
    details: details.length > 0 ? details : [`${invariant.id} passed`],
  };
}

export function runCiInvariantAudits(
  manifest: Manifest,
  cwd = process.cwd(),
): AuditResult[] {
  const workflowRoot = path.join(cwd, '.github/workflows');
  const files = fs.existsSync(workflowRoot)
    ? fs
        .readdirSync(workflowRoot)
        .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
        .map((file) => ({
          path: `.github/workflows/${file}`,
          text: fs.readFileSync(path.join(workflowRoot, file), 'utf8'),
        }))
    : [];

  return (manifest.ci_invariants ?? []).map((invariant) => {
    const { sources, missing } = readInvariantSourceFiles(invariant, cwd);

    // A declared non-glob path that does not resolve means the invariant read ZERO files and would
    // otherwise report "passed" — so an upstream relocation of the file it pins turns the gate green
    // instead of red, which is the exact failure mode the gate exists to prevent. Fail this
    // invariant (rather than throwing) so the remaining ones still report.
    if (missing.length > 0) {
      return {
        ok: false,
        title: invariant.title,
        details: missing.map(
          (candidate) =>
            `declares path ${candidate}, which does not exist — update it in docs/fork/ownership.yml ` +
            `(the file was probably moved upstream) or drop the invariant if it no longer applies`,
        ),
      };
    }

    return checkCiInvariantText(invariant, [...files, ...sources]);
  });
}

/**
 * Invariants are not all about workflows. Some pin a source-level shape the fork must keep — e.g.
 * the person joins that must NOT be filtered to `viewingUserId`, because under option M a
 * person_group holds exactly one row (the owner's) and that filter silently nulls the person for
 * every non-owner. Those invariants name concrete paths outside `.github/workflows`, so load them
 * too; workflow globs still come from the directory scan above.
 */
function readInvariantSourceFiles(
  invariant: CiInvariant,
  cwd: string,
): { sources: TextFile[]; missing: string[] } {
  const sources: TextFile[] = [];
  const missing: string[] = [];

  for (const candidate of invariant.paths) {
    if (candidate.startsWith('.github/workflows') || candidate.includes('*')) {
      continue;
    }
    const absolute = path.join(cwd, candidate);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
      missing.push(candidate);
      continue;
    }
    sources.push({ path: candidate, text: fs.readFileSync(absolute, 'utf8') });
  }

  return { sources, missing };
}
