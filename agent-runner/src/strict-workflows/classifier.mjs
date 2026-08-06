// Intent classification (Slice 4).
//
// `createIntentClassifier` exposes a single `classify(prompt)` that runs in two
// stages, ordered to maximize recall while bounding LLM cost:
//
//   1. Regex fast-path (free, deterministic). For each registered workflow, try
//      `workflow.match(prompt)`. A hit short-circuits with `via: 'regex'` and
//      zero model cost — canonical phrasings behave exactly as before.
//   2. LLM structured classify (recall). If no fast-path hit, the prompt looks
//      plausibly actionable, and `mode !== 'regex'`, make one tool-free,
//      low-temperature structured-output call. The result is validated:
//      unknown kind, `confidence !== 'high'`, or any error → `{ kind: 'none' }`.
//
// Classification is advisory ONLY. It selects a workflow but never executes
// tools, and it must NEVER throw into the runtime: every error/timeout/unknown
// path returns `{ kind: 'none' }` so the turn falls through to open
// orchestration. `parseSlots` (run by the dispatcher) is the second gate — the
// classifier proposes, `parseSlots` disposes.
//
// The actual provider call is isolated behind an injectable `classifyIntent`
// adapter (see `defaultClassifyIntent`). Tests inject a fake so the SDK wiring
// stays out of the unit tests; the runtime injects the real adapter built on
// `@earendil-works/pi-ai`'s one-shot `complete()` API.

// Cheap heuristic that keeps pure-acknowledgement chatter (e.g. "thanks, that
// looks great") off the LLM while letting any plausibly-actionable request
// through. It leans PERMISSIVE on purpose: a false negative silently drops a
// real request (recall miss), while a false positive costs only one tool-free
// LLM call that safely returns `none`. So we admit on an action verb, a
// photo-domain noun, or a question — and reject only when none of those appear.
const actionableVerbPattern =
  /\b(?:create|make|build|put|add|set|rename|name|call|tag|label|archive|move|organi[sz]e|sort|group|gather|collect|compile|assemble|turn|combine|merge|fill|describe|update|change|remove|delete|invite|share|manage|throw|stick|drop|toss|dump|chuck|slap|pop|load|import|pull|save|stash|file)\b/i;
const domainNounPattern =
  /\b(?:album|albums|photo|photos|pic|pics|picture|pictures|image|images|shot|shots|snap|snaps|space|spaces|favou?rite|favou?rites|highlight|highlights)\b/i;
const questionPattern = /\?\s*$/;
const acknowledgementPattern =
  /^\s*(?:thanks?(?:\s+you)?|thank you|great|cool|nice|awesome|perfect|ok(?:ay)?|sounds good|got it|looks good|that(?:'s| is) (?:great|perfect|fine))\b/i;

export const looksActionable = (prompt) => {
  const text = String(prompt ?? '').trim();
  if (!text) {
    return false;
  }
  if (acknowledgementPattern.test(text)) {
    return false;
  }
  return actionableVerbPattern.test(text) || domainNounPattern.test(text) || questionPattern.test(text);
};

// Structured-output contract returned by the classifier. `slots` is free-form
// and validated downstream by each workflow's `parseSlots`.
export const CLASSIFY_SCHEMA = Object.freeze({
  workflow: 'string',
  slots: 'Record<string, string>',
  confidence: "'high' | 'low'",
});

export const buildClassifierPrompt = (manifest) => {
  const entries = (manifest ?? []).map((entry) => {
    const positives = (entry.positiveExamples ?? []).map((example) => `    + ${example}`).join('\n');
    const negatives = (entry.negativeExamples ?? []).map((example) => `    - ${example}`).join('\n');
    const slotKeys = Object.entries(entry.slots ?? {});
    const slots = slotKeys.length
      ? `  Slots — use these EXACT keys (omit any you cannot fill, never invent keys): ${slotKeys
          .map(([key, schema]) => `${key} (${schema?.description ?? 'string'})`)
          .join('; ')}`
      : undefined;
    return [
      `- ${entry.kind}: ${entry.classifierDescription ?? ''}`.trimEnd(),
      slots,
      positives ? `  Matches:\n${positives}` : undefined,
      negatives ? `  Does NOT match:\n${negatives}` : undefined,
    ]
      .filter(Boolean)
      .join('\n');
  });

  return [
    'You are an intent router for a personal photo assistant.',
    'Pick the single workflow that best matches the user message, or "none".',
    '',
    'Workflows:',
    ...entries,
    '',
    'Rules:',
    '- Return "none" unless the message clearly maps to one workflow.',
    '- If the message blends multiple intents, pick the single dominant one, or "none" if unclear.',
    '- Only set confidence "high" when you are sure; otherwise use "low".',
    '- For slots, use ONLY the exact slot keys listed under the chosen workflow; omit any you cannot fill and never invent new keys.',
    '- You have no tools and cannot take any action; you only label intent.',
  ].join('\n');
};

const isKnownKind = (manifest, workflow) =>
  typeof workflow === 'string' && (manifest ?? []).some((entry) => entry.kind === workflow);

const normalizeSlots = (slots) => {
  if (!slots || typeof slots !== 'object') {
    return {};
  }
  const normalized = {};
  for (const [key, value] of Object.entries(slots)) {
    if (typeof value === 'string') {
      normalized[key] = value;
    } else if (value != null && typeof value !== 'object') {
      normalized[key] = String(value);
    }
  }
  return normalized;
};

// Default provider adapter. Reads the model handle from `getModel()` and runs a
// single non-streaming structured-output call. Two real-world shapes are
// supported behind one boundary:
//
//   - A model handle exposing a one-shot `generateStructured({...})` (forward
//     compatible if the SDK adds it; also what unit-test fakes use).
//   - Otherwise the real `@earendil-works/pi-ai` path: `complete(model, context)`
//     with a single forced `classify` tool whose parameters are CLASSIFY_SCHEMA,
//     reading the forced tool-call arguments. The runtime injects a fully-wired
//     adapter (see pi-runtime `createClassifyIntent`); this default keeps the
//     classifier usable standalone.
const defaultClassifyIntent = async ({ getModel, system, prompt, schema, signal }) => {
  const model = typeof getModel === 'function' ? getModel() : undefined;
  if (!model) {
    throw new Error('No model handle available for classification');
  }
  if (typeof model.generateStructured === 'function') {
    return model.generateStructured({ system, input: prompt, schema, temperature: 0, signal });
  }
  throw new Error('Model handle does not support structured classification');
};

export const createIntentClassifier = ({
  getModel,
  classifyIntent = defaultClassifyIntent,
  manifest = [],
  workflows = [],
  mode = 'hybrid',
}) => {
  const system = buildClassifierPrompt(manifest);

  const regexMatch = (prompt) => {
    for (const workflow of workflows) {
      const matched = workflow.match(prompt);
      if (matched) {
        return { kind: workflow.kind, slots: matched.slots, via: 'regex', confidence: 'high' };
      }
    }
    return undefined;
  };

  const classify = async (prompt, { signal } = {}) => {
    // Stage 1: regex fast-path. Skipped entirely in `llm` mode so the classifier
    // can be exercised in isolation, but it always runs in `regex`/`hybrid`.
    if (mode !== 'llm') {
      const fastPath = regexMatch(prompt);
      if (fastPath) {
        return fastPath;
      }
    }

    if (mode === 'regex') {
      return { kind: 'none', via: 'regex' };
    }

    // Stage 2: LLM classify, gated by a cheap actionable heuristic.
    if (!looksActionable(prompt)) {
      return { kind: 'none', via: 'heuristic' };
    }

    let result;
    try {
      result = await classifyIntent({ getModel, system, prompt, schema: CLASSIFY_SCHEMA, signal });
    } catch {
      // Never throw into the runtime — any provider error falls through to open.
      return { kind: 'none', via: 'llm-error' };
    }

    if (!result || result.workflow === 'none' || !isKnownKind(manifest, result.workflow) || result.confidence !== 'high') {
      return { kind: 'none', via: 'llm' };
    }

    return { kind: result.workflow, slots: normalizeSlots(result.slots), via: 'llm', confidence: 'high' };
  };

  return { classify };
};
