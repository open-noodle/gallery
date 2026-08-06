// Gate-safe user-facing copy rendering for strict/hybrid workflows (Slice 6).
//
// The success/failure DECISION is made by deterministic code BEFORE any copy is
// rendered: a `planned` outcome is only allowed to use success language when it
// actually carries a `planId`. Copy rendering never decides success; it only
// rewords a scrubbed structured summary.
//
//   - `mode: 'template'` (default) reconstructs today's deterministic success
//     string byte-for-byte from `successSummary` (and prefers a pre-built
//     `outcome.text` when the workflow already produced it, so the dispatcher's
//     emitted text stays identical to today's behavior).
//   - `mode: 'llm-polish'` calls an injected, tool-free `polish(scrub(summary))`
//     that may only REPHRASE the success copy. Any error — or an empty/non-string
//     result — falls back to the template. The polish input is scrubbed so no
//     ids/handles/sourceRefs ever leak to the model.
//
// `needs_input`, `failed`, and `approval_required` always use the workflow's
// own template text regardless of mode — the LLM never touches those arms.

// Keys that must never reach the polish model. The structured summary built by
// the workflow already excludes them; we enforce it defensively here so a future
// summary change cannot silently leak an identifier into the prompt.
const FORBIDDEN_SUMMARY_KEYS = new Set(['id', 'planId', 'handle', 'selectionHandle', 'selectionHandleId', 'sourceRef']);

const scrub = (summary) => {
  if (!summary || typeof summary !== 'object') {
    return {};
  }

  const cleaned = {};
  for (const [key, value] of Object.entries(summary)) {
    if (FORBIDDEN_SUMMARY_KEYS.has(key)) {
      throw new Error(`strict copy summary leaked a forbidden key: ${key}`);
    }
    cleaned[key] = value;
  }
  return cleaned;
};

// Today's deterministic success string, reconstructed from the scrubbed summary.
// MUST stay byte-for-byte identical to `plannedResult` in strict-workflows.mjs.
export const templateCopy = (successSummary = {}) => {
  const { label, dateRange, albumName, assetCount, exclusions } = successSummary;
  return (
    `I found a likely ${label} trip from ${dateRange} and proposed ${albumName} with ${assetCount} assets.` +
    `${exclusions ? ` I skipped ${exclusions}.` : ''} Review the plan before applying it.`
  );
};

// Deterministic, non-success copy used when code is about to claim a plan but no
// `planId` exists. This is the user-visible half of the success gate; the
// dispatcher emits a `strict_success_gate_block` observability event via the
// `onGateBlock` hook. The text deliberately avoids any success language
// ("created"/"ready"/"proposed").
const gateBlockedCopy =
  'I was unable to produce a reviewable album plan. Please rerun the request to try again.';

export const renderCopy = async ({ outcome, mode = 'template', polish, onGateBlock } = {}) => {
  // Non-planned arms are always template-only: the workflow already built `text`.
  if (outcome?.status !== 'planned') {
    return outcome?.text ?? '';
  }

  // Hard success gate: a planned outcome MUST carry a planId before any success
  // language is rendered. Without it, never call polish and never claim success.
  if (!outcome.planId) {
    onGateBlock?.();
    return gateBlockedCopy;
  }

  const summary = outcome.successSummary ?? {};

  // Template mode reuses the workflow's pre-built text when present so the
  // dispatcher's emitted string is identical to today's; otherwise it
  // reconstructs verbatim from the structured summary.
  if (mode !== 'llm-polish') {
    return outcome.text ?? templateCopy(summary);
  }

  // llm-polish: rephrase the scrubbed summary; fall back to the template on any
  // error or an empty/non-string result.
  try {
    const polished = await polish?.(scrub(summary));
    if (typeof polished === 'string' && polished.trim().length > 0) {
      return polished;
    }
  } catch {
    // fall through to the template below
  }

  return templateCopy(summary);
};
