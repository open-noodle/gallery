const NON_ALNUM = /[^a-z0-9]+/;

/**
 * Shared "almost exact" word-prefix match used by both the navigation and
 * commands providers for top-result promotion under the `'all'` scope.
 *
 * Rule: after case-folding and splitting both sides on non-alphanumerics, at
 * least one query word ≥ minLength chars must be a prefix of some label word.
 */
export function isAlmostExactWordMatch(query: string, label: string, minLength: number): boolean {
  const q = query.trim().toLowerCase();
  if (q.length < minLength) {
    return false;
  }
  const qWords = q.split(NON_ALNUM).filter((w) => w.length >= minLength);
  if (qWords.length === 0) {
    return false;
  }
  const labelWords = label.toLowerCase().split(NON_ALNUM).filter(Boolean);
  for (const qw of qWords) {
    for (const lw of labelWords) {
      if (lw.startsWith(qw)) {
        return true;
      }
    }
  }
  return false;
}
