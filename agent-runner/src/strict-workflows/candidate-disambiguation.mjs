// Shared disambiguation-continuation helper — used by space/user-pick workflows
// (manage_space_members, change_member_role, rename_or_describe_space,
//  manage_space_assets).  Generalises the trip-workflow's candidate-selection
// model for generic {index,id,name} candidates.
//
// TTL mirrors strictWorkflowPendingTtlMs from strict-workflows.mjs (10 min).
// We do not import it to keep this helper self-contained and avoid a circular
// dependency if strict-workflows.mjs ever imports from this file.
const DEFAULT_TTL_MS = 10 * 60 * 1000; // same as strictWorkflowPendingTtlMs

// ─── ordinal + normalise helpers (self-contained — no import from parent) ────

const normalizeText = (value) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// Returns 1-5 for ordinal words/digits, undefined otherwise.
const ordinalChoice = (prompt) => {
  const text = normalizeText(prompt);
  if (/\b(?:1|first)\b/.test(text)) return 1;
  if (/\b(?:2|second)\b/.test(text)) return 2;
  if (/\b(?:3|third)\b/.test(text)) return 3;
  if (/\b(?:4|fourth)\b/.test(text)) return 4;
  if (/\b(?:5|fifth)\b/.test(text)) return 5;
  return undefined;
};

// Single-candidate affirmation pattern (mirrors yesChoicePattern in strict-workflows.mjs).
const YES_PATTERN = /^(?:yes|yeah|yep|use it|use that|that one|ok|okay)$/i;

// ─── buildCandidateContinuation ───────────────────────────────────────────────

/**
 * Build a storable continuation state for a candidate-disambiguation turn.
 *
 * @param {object} opts
 * @param {string} opts.kind          – workflow-specific kind token (guards resumeFromCandidates)
 * @param {Array<{id:string,name:string}>} opts.candidates – raw candidate list (capped at 5, extra fields dropped)
 * @param {number} opts.nowMs         – current clock value (injectable for tests)
 * @param {...*}   rest               – any additional fields are carried verbatim into the
 *                                     continuation for multi-stage flows (e.g. resolvedSpaceId,
 *                                     slots).  Raw candidate internals (extraAssetIds etc.) never
 *                                     bleed through because per-candidate compaction happens here.
 *
 * @returns {{ kind:string, createdAtMs:number, candidates:Array<{index,id,name}>, ...rest }}
 *
 * Multi-stage carry note: callers building a two-stage space→user flow pass already-resolved
 * context as extra (e.g. resolvedSpaceId:'abc').  resumeFromCandidates returns the full pending
 * object in matched results so the workflow's resumeContinuation can read those fields and feed
 * them into the next run() call without a second server round-trip.
 */
export const buildCandidateContinuation = ({ kind, candidates, nowMs, ...extra }) => ({
  kind,
  createdAtMs: nowMs,
  candidates: (Array.isArray(candidates) ? candidates : [])
    .slice(0, 5)
    .map((c, i) => ({ index: i + 1, id: c.id, name: c.name })),
  ...extra,
});

// ─── resumeFromCandidates ─────────────────────────────────────────────────────

/**
 * Resolve a candidate pick from a free-text follow-up prompt.
 *
 * Precedence (to handle a space literally named "2"):
 *   1. Ordinal (digit or word: first/1 … fifth/5) — index-based, always wins.
 *   2. Single-candidate yes/use-it affirmation.
 *   3. Exact name match (case-insensitive, then normalised).
 *   4. Substring name match — only when exactly one candidate matches.
 *
 * @param {object} opts
 * @param {object|null} opts.pending  – stored continuation from buildCandidateContinuation
 * @param {string} opts.prompt        – free-text reply from the user
 * @param {number} opts.nowMs         – current clock value
 * @param {number} [opts.ttlMs]       – TTL in ms (default: 10 min)
 * @param {string} opts.kind          – expected pending.kind value
 *
 * @returns {{ status:'matched', choice:{index,id,name}, pending }
 *          |{ status:'needs_input', text:string }
 *          |{ status:'expired',    text:string }
 *          |{ status:'missing',    text:string }}
 *
 * matched carries pending so callers can read extra fields (e.g. resolvedSpaceId)
 * without the caller needing to keep a separate reference.
 */
export const resumeFromCandidates = ({
  pending,
  prompt,
  nowMs,
  ttlMs = DEFAULT_TTL_MS,
  kind,
}) => {
  if (!pending || pending.kind !== kind) {
    return {
      status: 'missing',
      text: 'I no longer have pending candidates for this request. Please start over.',
    };
  }

  if (nowMs - pending.createdAtMs > ttlMs) {
    return { status: 'expired', text: 'Those pending choices expired. Please start the request again.' };
  }

  const candidates = Array.isArray(pending.candidates) ? pending.candidates : [];
  let choice;

  // 1. Ordinal — takes precedence even when a candidate is literally named "2".
  const ordinal = ordinalChoice(prompt);
  if (ordinal !== undefined) {
    choice = candidates.find((c) => c.index === ordinal);
    if (!choice) {
      const names = candidates.map((c) => `${c.index}. ${c.name}`).join('; ');
      return { status: 'needs_input', text: `I only have ${candidates.length} option${candidates.length === 1 ? '' : 's'}: ${names}. Which would you like?` };
    }
    return { status: 'matched', choice, pending };
  }

  // 2. Single-candidate yes/use-it affirmation.
  if (candidates.length === 1 && YES_PATTERN.test(String(prompt ?? '').trim())) {
    return { status: 'matched', choice: candidates[0], pending };
  }

  // 3 + 4. Name matching (exact and substring, unified pass).
  // Exact match is a special case of substring (both directions); we run a
  // single unified filter so "family" does NOT short-circuit to the one candidate
  // literally named "Family" when "Family 2026" also contains it — that would be
  // ambiguous and must surface as needs_input.
  if (prompt && String(prompt).trim().length > 0) {
    const normalizedPrompt = normalizeText(prompt)
      .replace(/^(?:use|choose|select|pick)\s+/, '');

    // Collect every candidate whose name contains the prompt (one direction only).
    // We do NOT check normalizedPrompt.includes(n) to avoid a longer prompt like
    // "Family 2026" spuriously matching the shorter candidate "Family" — the prompt
    // must be a substring of the candidate name, not the other way around.
    const nameMatches = candidates.filter((c) => {
      const n = normalizeText(c.name);
      return n.includes(normalizedPrompt);
    });

    if (nameMatches.length === 1) {
      return { status: 'matched', choice: nameMatches[0], pending };
    }
    if (nameMatches.length > 1) {
      // Check whether all matching candidates share the same name (duplicates).
      const firstNorm = normalizeText(nameMatches[0].name);
      const allSameName = nameMatches.every((c) => normalizeText(c.name) === firstNorm);
      if (allSameName) {
        const nums = nameMatches.map((c) => String(c.index)).join(' or ');
        return {
          status: 'needs_input',
          text: `Multiple candidates have that name. Please use the number (${nums}) to pick one.`,
        };
      }
      // Different names but all overlap — truly ambiguous substring.
      const opts = candidates.map((c) => `${c.index}. ${c.name}`).join('; ');
      return {
        status: 'needs_input',
        text: `That matches more than one option: ${opts}. Which did you mean?`,
      };
    }
  }

  // No match.
  const opts = candidates.map((c) => `${c.index}. ${c.name}`).join('; ');
  return { status: 'needs_input', text: `I didn't recognise that choice. Options: ${opts}. Which would you like?` };
};
