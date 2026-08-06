import { SUBJECTIVE_PATTERN, resolveAssetSource } from '../asset-source-resolver.mjs';
import { failed, handoffOpen, needsInput } from '../protocol.mjs';
import { gatePlanResult, safeFailureText } from './plan-gate.mjs';

// lock_assets (hybrid): "lock <source>" / "move/put/add <source> in/to the locked
// folder" / "hide <source> in the locked folder" → a batch asset.setVisibility
// (visibility: 'locked') over a resolved selection handle. One-directional: lock only;
// the server provides no unlock operation via the agent.
//
// Already-locked / non-owned pre-checks are server-enforced:
//   - The plan service's getAgentLockedIds / owned-scope writable filter ensures only
//     owned assets that are not already locked are included.
//   - updateAll respects the DB-level ownership + locked-state guard.
// No runner-side filter is needed or appropriate here.
//
// The `lockAssets` write-scope must be granted by the preset (off in default/Careful;
// consult the preset definition for VisualOrganizer / LocalPowerUser grants).

const KIND = 'lock_assets';

const clean = (value) => (typeof value === 'string' ? value.trim() : '');
const cleanSource = (value) => clean(value).replace(/[.?!]+$/u, '').trim();

// Decline subjective and recent-trip sources at the fast-path so they flow to the
// LLM classifier / open orchestration rather than being coerced into a metadata
// lock here (the resolver would hand them off anyway).
const tripSourcePattern = /\brecent\s+trip\b/i;
const declinesSourceFastPath = (source) => SUBJECTIVE_PATTERN.test(source) || tripSourcePattern.test(source);

// Three match patterns — each requires an explicit lock / locked-folder / private-folder cue.
//
// LOCK_PATTERN: "lock <source>" — "lock my passport scans"
const LOCK_PATTERN = /\block\s+(?<source>.+)$/i;

// MOVE_TO_LOCKED: "move/put/add <source> in/into/to (the/my) locked|private folder"
// — "move my passport scans to the locked folder", "put these in my private folder"
const MOVE_TO_LOCKED =
  /\b(?:move|put|add)\s+(?<source>.+?)\s+(?:in|into|to)\s+(?:the\s+|my\s+)?(?:locked|private)\s+folder\b/i;

// HIDE_IN_LOCKED: "hide <source> in/into (the/my) locked|private folder"
// — "hide these in my locked folder" (requires the folder cue; "hide Alex" has no cue)
const HIDE_IN_LOCKED =
  /\bhide\s+(?<source>.+?)\s+(?:in|into)\s+(?:the\s+|my\s+)?(?:locked|private)\s+folder\b/i;

const PATTERNS = [MOVE_TO_LOCKED, HIDE_IN_LOCKED, LOCK_PATTERN];

export const lockAssetsWorkflow = () => ({
  kind: KIND,
  flow: 'hybrid',

  match(prompt) {
    const text = clean(prompt);
    if (!text) {
      return undefined;
    }
    for (const pattern of PATTERNS) {
      const m = pattern.exec(text);
      if (m?.groups?.source) {
        const sourceDescription = cleanSource(m.groups.source);
        if (!sourceDescription || declinesSourceFastPath(sourceDescription)) {
          return undefined;
        }
        return { slots: { sourceDescription } };
      }
    }
    return undefined;
  },

  parseSlots(rawSlots) {
    const sourceDescription = cleanSource(rawSlots?.sourceDescription);
    if (!sourceDescription) {
      return null;
    }
    return { sourceDescription };
  },

  async run({ client, slots, signal, now }) {
    const sourceDescription = clean(slots?.sourceDescription);

    // 1. Resolve the source into a selection handle (shared resolver): subjective
    //    and non-deterministic sources hand off; recency/date/type become a
    //    bounded metadata-search handle. A tool error surfaces as `failed`.
    let resolution;
    try {
      resolution = await resolveAssetSource({ client, sourceDescription, signal, ...(now ? { now } : {}) });
    } catch (error) {
      return failed({ text: safeFailureText(error?.message ?? 'The search tool failed.') });
    }
    if (resolution.status === 'handoff') {
      return handoffOpen({ reason: resolution.reason });
    }
    if (resolution.status === 'needs_input') {
      return needsInput({ text: resolution.text });
    }
    if (resolution.status === 'empty') {
      return needsInput({
        text: `I could not find any photos matching "${sourceDescription}". Can you describe them differently?`,
      });
    }
    const { selectionHandleId, assetCount } = resolution;

    // 2. Propose a batch setVisibility:locked over the selection handle. No raw
    //    asset ids ever reach the model — the handle is the only asset reference.
    let planResult;
    try {
      planResult = await client.call(
        'proposeAssetBatchFromSelection',
        {
          summary: 'Move matching photos to the Locked folder.',
          action: { type: 'asset.setVisibility', visibility: 'locked' },
          selectionHandleId,
        },
        { signal },
      );
    } catch (error) {
      return failed({ text: safeFailureText(error?.message ?? 'The planning tool failed.') });
    }

    // 3. Gate on a persisted plan id before any success copy.
    return gatePlanResult({
      planResult,
      planTool: 'proposeAssetBatchFromSelection',
      successText: `I prepared a plan to move ${assetCount} matching ${assetCount === 1 ? 'photo' : 'photos'} to the Locked folder. Review the plan before applying it.`,
      successSummary: { workflowKind: KIND, assetCount, target: 'lock' },
    });
  },
});
