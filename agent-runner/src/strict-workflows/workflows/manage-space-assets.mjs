import { buildCandidateContinuation, resumeFromCandidates } from '../candidate-disambiguation.mjs';
import { SUBJECTIVE_PATTERN, resolveAssetSource } from '../asset-source-resolver.mjs';
import { failed, handoffOpen, needsInput } from '../protocol.mjs';
import { gatePlanResult, safeFailureText } from './plan-gate.mjs';

const KIND = 'manage_space_assets';

const clean = (value) => (typeof value === 'string' ? value.trim() : '');
const cleanSource = (value) => clean(value).replace(/[.?!]+$/u, '').trim();

const normalizeSpaceRef = (value) =>
  clean(value)
    .replace(/^(?:the|my|this|that|our)\s+/i, '')
    .replace(/^shared\s+space\s+/i, '')
    .replace(/\s+(?:shared\s+)?space$/i, '')
    .trim();

const mentionsSpace = (ref) => /\bspaces?\b/i.test(clean(ref));

// REQUIRE a photo-ish source (the inverse of manage_space_members' decline) so a bare
// member name ("Alex", "Alex and Sam") never matches.
const PHOTO_SOURCE_RE =
  /\b(?:photos?|pics?|pictures?|images?|videos?|clips?|screenshots?|snaps?|shots?|newest|latest|most\s+recent)\b/i;
const looksLikePhotoSource = (text) => PHOTO_SOURCE_RE.test(clean(text));

const tripSourcePattern = /\brecent\s+trip\b/i;
const declinesSource = (source) => SUBJECTIVE_PATTERN.test(source) || tripSourcePattern.test(source);

// Infer add/remove from the prompt verb when the LLM omits the action slot.
const inferAction = (prompt) => {
  const text = clean(prompt).toLowerCase();
  if (/\b(?:remove|take\s+out|drop|delete|pull)\b/.test(text)) {
    return 'remove';
  }
  if (/\b(?:add|put|move|include|stick)\b/.test(text)) {
    return 'add';
  }
  return undefined;
};

const ADD_PATTERN = /\b(?:add|put|move|stick)\s+(?<source>.+)\s+(?:to|into)\s+(?<space>.+?space)\b/i;
const REMOVE_PATTERN = /\b(?:remove|take|pull)\s+(?<source>.+)\s+(?:from|out\s+of)\s+(?<space>.+?space)\b/i;

const VALID_ACTIONS = new Set(['add', 'remove']);

const resolveSpace = async ({ client, spaceRef, signal }) => {
  const ref = normalizeSpaceRef(spaceRef);
  const result = await client.call('listSpaces', {}, { signal });
  const spaces = Array.isArray(result?.spaces) ? result.spaces : [];
  const matches = spaces.filter((space) => clean(space?.name).toLowerCase() === ref.toLowerCase());
  return { ref, spaces, matches };
};

const tryMatch = (prompt) => {
  let action;
  let match = ADD_PATTERN.exec(prompt);
  if (match?.groups) {
    action = 'add';
  } else {
    match = REMOVE_PATTERN.exec(prompt);
    if (match?.groups) {
      action = 'remove';
    }
  }
  if (!match?.groups) {
    return undefined;
  }
  const sourceDescription = cleanSource(match.groups.source);
  const spaceText = clean(match.groups.space);
  if (!sourceDescription || !mentionsSpace(spaceText)) {
    return undefined;
  }
  if (!looksLikePhotoSource(sourceDescription) || declinesSource(sourceDescription)) {
    return undefined; // member add / subjective / recent-trip → not ours
  }
  const spaceRef = normalizeSpaceRef(spaceText);
  return spaceRef ? { action, spaceRef, sourceDescription } : undefined;
};

export const manageSpaceAssetsWorkflow = () => ({
  kind: KIND,
  flow: 'hybrid',

  match(prompt) {
    const text = clean(prompt);
    if (!text) {
      return undefined;
    }
    const matched = tryMatch(text);
    return matched ? { slots: matched } : undefined;
  },

  parseSlots(rawSlots, prompt) {
    let action = clean(rawSlots?.action).toLowerCase();
    if (!VALID_ACTIONS.has(action)) {
      action = inferAction(prompt) ?? '';
    }
    if (!VALID_ACTIONS.has(action)) {
      return null;
    }
    const spaceRef = normalizeSpaceRef(rawSlots?.spaceRef);
    const sourceDescription = cleanSource(rawSlots?.sourceDescription);
    if (!spaceRef || !sourceDescription) {
      return null;
    }
    return { action, spaceRef, sourceDescription };
  },

  async run({ client, slots, resolvedSpaceId, signal, nowMs }) {
    const action = clean(slots?.action).toLowerCase();
    const sourceDescription = cleanSource(slots?.sourceDescription);

    // 1. Resolve the space (skip when already resolved via continuation).
    let space;
    let spaceName;

    if (resolvedSpaceId) {
      // Continuation path: we know the id; retrieve the space name from listSpaces
      // so the success text is correct (an extra round-trip is cheap here).
      let listed;
      try {
        listed = await client.call('listSpaces', {}, { signal });
      } catch (error) {
        return failed({ text: safeFailureText(error?.message ?? 'The space lookup failed.') });
      }
      const spaces = Array.isArray(listed?.spaces) ? listed.spaces : [];
      const found = spaces.find((s) => s.id === resolvedSpaceId);
      space = found ?? { id: resolvedSpaceId, name: resolvedSpaceId };
      spaceName = clean(space.name) || resolvedSpaceId;
    } else {
      let ref, matches;
      try {
        ({ ref, matches } = await resolveSpace({ client, spaceRef: slots?.spaceRef, signal }));
      } catch (error) {
        return failed({ text: safeFailureText(error?.message ?? 'The space lookup failed.') });
      }
      if (matches.length === 0) {
        return needsInput({ text: `I could not find a space called "${ref}". Which space do you mean?` });
      }
      if (matches.length > 1) {
        // Ambiguous space — offer durable candidate list.
        const candidates = matches.map((s) => ({ id: s.id, name: s.name }));
        const continuation = buildCandidateContinuation({
          kind: 'manage_space_assets_space',
          candidates,
          nowMs: nowMs ?? Date.now(),
          slots,
        });
        return needsInput({
          text: `Multiple spaces are called "${ref}". Which one do you mean?\n${candidates.map((c, i) => `${i + 1}. ${c.name}`).join('\n')}`,
          continuation,
        });
      }
      space = matches[0];
      spaceName = clean(space.name) || ref;
    }

    // 2. Resolve the source into a selection handle.
    let resolution;
    try {
      resolution = await resolveAssetSource({ client, sourceDescription, signal });
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
        text: `I could not find any photos matching "${sourceDescription}" to ${action === 'remove' ? 'remove from' : 'add to'} the "${spaceName}" space. Can you describe them differently?`,
      });
    }
    const { selectionHandleId, assetCount } = resolution;

    // 3. Propose ADD (proposeAddAssetsToSpaceFromSearch, spaceId only) or REMOVE
    //    (proposeAlbumOperations space.removeAssets). No raw asset ids reach the model.
    let planResult;
    let planTool;
    try {
      if (action === 'remove') {
        planTool = 'proposeAlbumOperations';
        planResult = await client.call(
          'proposeAlbumOperations',
          {
            summary: `Remove matching photos from the "${spaceName}" space.`,
            operations: [
              {
                type: 'space.removeAssets',
                summary: 'Remove matching photos.',
                targetKind: 'existing_space',
                targetId: space.id,
                assetSource: { kind: 'selectionHandle', selectionHandleId },
                payload: {},
              },
            ],
          },
          { signal },
        );
      } else {
        planTool = 'proposeAddAssetsToSpaceFromSearch';
        planResult = await client.call(
          'proposeAddAssetsToSpaceFromSearch',
          {
            summary: `Add matching photos to the "${spaceName}" space.`,
            spaceId: space.id,
            assetSource: { kind: 'selectionHandle', selectionHandleId },
          },
          { signal },
        );
      }
    } catch (error) {
      return failed({ text: safeFailureText(error?.message ?? 'The planning tool failed.') });
    }

    const verb = action === 'remove' ? 'remove' : 'add';
    const preposition = action === 'remove' ? 'from' : 'to';
    return gatePlanResult({
      planResult,
      planTool,
      successText: `I prepared a plan to ${verb} ${assetCount} matching ${assetCount === 1 ? 'photo' : 'photos'} ${preposition} the "${spaceName}" space. Review the plan before applying it.`,
      successSummary: { workflowKind: KIND, spaceName, assetCount, action },
    });
  },

  // Resolve a candidate pick from a continuation follow-up.
  // Returns { status:'matched', ctx } | { status:'needs_input'|'expired', text }.
  resumeContinuation({ pending, prompt, nowMs }) {
    const kind = pending?.kind;
    if (kind !== 'manage_space_assets_space') {
      return { status: 'needs_input', text: 'I no longer have pending candidates for this request. Please start over.' };
    }

    const result = resumeFromCandidates({ pending, prompt, nowMs: nowMs ?? Date.now(), kind });
    if (result.status !== 'matched') {
      return result; // needs_input | expired | missing — pass through
    }

    return {
      status: 'matched',
      ctx: {
        slots: pending.slots,
        resolvedSpaceId: result.choice.id,
      },
    };
  },
});
