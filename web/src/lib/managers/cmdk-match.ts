const NON_ALNUM = /[^a-z0-9]+/;
const WHITESPACE = /\s+/;

/**
 * How many characters of a label word the user is allowed to leave untyped and
 * still have it count as "that word". One character covers the common
 * singular/plural slip (`album` → `Albums`, `tag` → `Tags`) without letting a
 * short English word stand in for a longer one (`the` → `Theme`).
 */
const MAX_UNTYPED_CHARS = 1;

function isClosePrefix(token: string, labelWord: string): boolean {
  return labelWord.startsWith(token) && labelWord.length - token.length <= MAX_UNTYPED_CHARS;
}

/**
 * Shared "almost exact" word match used by both the navigation and commands
 * providers for top-result promotion under the `'all'` scope.
 *
 * Promotion steals the top slot *and* suppresses the free-text "search for …"
 * row, so a false positive makes a query unsearchable. The gate is therefore
 * deliberately narrow — two rules, both of which must hold:
 *
 * 1. **Close prefix.** A query token only counts as a label word when it spells
 *    that word out to within {@link MAX_UNTYPED_CHARS} characters. Plain prefix
 *    matching let `the` claim `Theme`, which hijacked every smart search
 *    containing the word "the".
 * 2. **Every word matches.** Each whitespace-separated query word (that carries
 *    at least one token ≥ `minLength`) must match some label word. A sentence
 *    like `photos of the beach` therefore cannot be promoted by the incidental
 *    `photos` collision with "Add photos to this space", while a query that
 *    spells a label out in full — `run face detection` — still is.
 *
 * Words are split on whitespace but matched on their alphanumeric sub-tokens,
 * so a compound query like `auto-classification` counts as one word and still
 * promotes `Classification Settings` via its second token.
 *
 * Only the label is inspected, not the description — the description is richer
 * and would promote items the user did not visually intend to pick.
 */
export function isAlmostExactWordMatch(query: string, label: string, minLength: number): boolean {
  const q = query.trim().toLowerCase();
  if (q.length < minLength) {
    return false;
  }
  const labelWords = label.toLowerCase().split(NON_ALNUM).filter(Boolean);
  let significantWords = 0;
  for (const word of q.split(WHITESPACE)) {
    const tokens = word.split(NON_ALNUM).filter((token) => token.length >= minLength);
    if (tokens.length === 0) {
      // Filler too short to be meaningful ("of", "a") — never disqualifies.
      continue;
    }
    significantWords++;
    const wordMatches = tokens.some((token) => labelWords.some((labelWord) => isClosePrefix(token, labelWord)));
    if (!wordMatches) {
      return false;
    }
  }
  return significantWords > 0;
}
