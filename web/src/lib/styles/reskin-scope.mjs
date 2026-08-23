// Pure scope-guard logic for the re-skin's "fork-owned files only" invariant —
// no node builtins, so it type-checks cleanly. Unit-tested in reskin-scope.spec.ts;
// run ad hoc with: git diff --name-only main...HEAD | (feed to isInScope).
export const ALLOWED_PREFIXES = [
  'web/src/styles/',
  'web/src/lib/styles/',
  'web/scripts/',
  'web/src/lib/assets/fonts/',
  'specs/', // the design docs for this work
  'e2e/src/specs/web/reskin-', // the re-skin hardening e2e specs (+ their snapshots)
];
// pnpm-lock.yaml is the single monorepo lockfile at the repo root (not under web/).
export const ALLOWED_EXACT = new Set(['web/package.json', 'pnpm-lock.yaml', 'e2e/package.json']);

/**
 * @param {string[]} changedPaths
 * @param {string[]} appCssAddedLines
 * @returns {{ ok: boolean, violations: string[] }}
 */
export function isInScope(changedPaths, appCssAddedLines) {
  const violations = [];
  for (const p of changedPaths) {
    if (ALLOWED_EXACT.has(p)) {
      continue;
    }
    if (ALLOWED_PREFIXES.some((prefix) => p.startsWith(prefix))) {
      continue;
    }
    if (p === 'web/src/app.css') {
      const offending = appCssAddedLines
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !/^@import\s+['"]\.\/styles\/gallery-theme\.css['"];$/.test(l));
      if (offending.length > 0) {
        violations.push(`web/src/app.css (non-import additions: ${offending.join(' | ')})`);
      }
      continue;
    }
    violations.push(p);
  }
  return { ok: violations.length === 0, violations };
}
