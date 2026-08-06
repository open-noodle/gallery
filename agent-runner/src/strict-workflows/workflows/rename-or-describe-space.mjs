import { buildCandidateContinuation, resumeFromCandidates } from '../candidate-disambiguation.mjs';
import { failed, needsInput } from '../protocol.mjs';
import { gatePlanResult, safeFailureText } from './plan-gate.mjs';

// rename_or_describe_space (strict): mirror of rename_or_describe_album for shared
// spaces. The router is GATED on the `space` keyword so it never steals album or
// generic "rename X to Y" phrasings (the album-vs-space disambiguation). Registering
// this BEFORE rename_or_describe_album (Slice 19) lets the strict gate win the regex
// fast-path.

const KIND = 'rename_or_describe_space';

const clean = (value) => (typeof value === 'string' ? value.trim() : '');

// Strip a leading article, a leading "shared space " wrapper, and a trailing
// " [shared] space" noun so "the Family space" / "shared space Family" → "Family".
const normalizeSpaceRef = (value) =>
  clean(value)
    .replace(/^(?:the|my|this|that|our)\s+/i, '')
    .replace(/^shared\s+space\s+/i, '')
    .replace(/\s+(?:shared\s+)?space$/i, '')
    .trim();

// Regex gate: only treat a reference as a space when it actually says "space".
const mentionsSpace = (ref) => /\bspace\b/i.test(clean(ref));

const RENAME_PATTERN =
  /\b(?:rename|re-?name)\s+(?<spaceRef>.+?)\s+to\s+(?<newName>.+?)(?:\s+and\s+(?:add|set|give\s+it)\s+(?:a\s+)?description.*)?$/i;
const DESCRIBE_PATTERN =
  /\b(?:change|set|update|add|edit)\s+(?:the\s+|a\s+|its\s+)?description\s+(?:on|of|for)\s+(?<spaceRef>.+?)(?:\s+to\s+(?<description>.+))?$/i;

const stripTrailingPunct = (value) => clean(value).replace(/[.?!]+$/u, '').trim();

export const renameOrDescribeSpaceWorkflow = () => ({
  kind: KIND,
  flow: 'strict',

  match(prompt) {
    const text = clean(prompt);
    if (!text) {
      return undefined;
    }

    const rename = RENAME_PATTERN.exec(text);
    if (rename?.groups && mentionsSpace(rename.groups.spaceRef)) {
      const spaceRef = normalizeSpaceRef(rename.groups.spaceRef);
      const newName = stripTrailingPunct(rename.groups.newName);
      if (spaceRef && newName) {
        return { slots: { spaceRef, newName } };
      }
    }

    const describe = DESCRIBE_PATTERN.exec(text);
    if (describe?.groups && mentionsSpace(describe.groups.spaceRef)) {
      const spaceRef = normalizeSpaceRef(describe.groups.spaceRef);
      const description = stripTrailingPunct(describe.groups.description);
      if (spaceRef) {
        return { slots: description ? { spaceRef, description } : { spaceRef } };
      }
    }

    return undefined;
  },

  // The classifier has already chosen this workflow, so parseSlots does NOT
  // re-apply the `space`-keyword gate — it only normalizes and validates.
  parseSlots(rawSlots) {
    const spaceRef = normalizeSpaceRef(rawSlots?.spaceRef);
    const newName = clean(rawSlots?.newName);
    const description = clean(rawSlots?.description);
    if (!spaceRef) {
      return null;
    }
    if (!newName && !description) {
      return null;
    }
    const slots = { spaceRef };
    if (newName) {
      slots.newName = newName;
    }
    if (description) {
      slots.description = description;
    }
    return slots;
  },

  async run({ client, slots, resolvedSpaceId, signal, nowMs }) {
    const newName = clean(slots?.newName);
    const description = clean(slots?.description);
    if (!newName && !description) {
      // Defensive: parseSlots should have rejected this, but never plan a no-op.
      return needsInput({ text: 'Tell me the new space name or the description you would like to set.' });
    }

    // 1. Resolve the space (skip when already resolved via continuation).
    let space;
    let ref;

    if (resolvedSpaceId) {
      // Continuation path: we know the id — synthesize a minimal space record
      // using the spaceRef for the display name (a readSpace round-trip is
      // unnecessary since we only need the id for the plan payload).
      ref = normalizeSpaceRef(slots?.spaceRef);
      space = { id: resolvedSpaceId, name: ref };
    } else {
      ref = normalizeSpaceRef(slots?.spaceRef);
      let listed;
      try {
        listed = await client.call('listSpaces', {}, { signal });
      } catch (error) {
        return failed({ text: safeFailureText(error?.message ?? 'The space lookup tool failed.') });
      }
      const spaces = Array.isArray(listed?.spaces) ? listed.spaces : [];
      const matches = spaces.filter((s) => clean(s?.name).toLowerCase() === ref.toLowerCase());
      if (matches.length === 0) {
        return needsInput({ text: `I could not find a space called "${ref}". Which space do you mean?` });
      }
      if (matches.length > 1) {
        // Ambiguous space — offer durable candidate list.
        const candidates = matches.map((s) => ({ id: s.id, name: s.name }));
        const continuation = buildCandidateContinuation({
          kind: 'rename_or_describe_space_space',
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
    }

    // Include ONLY the fields the user set so unspecified ones are preserved.
    const payload = {};
    if (newName) {
      payload.spaceName = newName;
    }
    if (description) {
      payload.description = description;
    }

    const changeParts = [];
    if (newName) {
      changeParts.push(`rename it to "${newName}"`);
    }
    if (description) {
      changeParts.push('update its description');
    }

    let planResult;
    try {
      planResult = await client.call(
        'proposeAlbumOperations',
        {
          summary: 'Update space details.',
          operations: [
            {
              type: 'space.updateDetails',
              summary: 'Update space details.',
              targetKind: 'existing_space',
              targetId: space.id,
              payload,
            },
          ],
        },
        { signal },
      );
    } catch (error) {
      return failed({ text: safeFailureText(error?.message ?? 'The planning tool failed.') });
    }

    return gatePlanResult({
      planResult,
      successText: `I prepared a plan to ${changeParts.join(' and ')} for the "${clean(space.name) || ref}" space. Review the plan before applying it.`,
      successSummary: { workflowKind: KIND, target: clean(space.name) || ref },
    });
  },

  // Resolve a candidate pick from a continuation follow-up.
  // Returns { status:'matched', ctx } | { status:'needs_input'|'expired', text }.
  resumeContinuation({ pending, prompt, nowMs }) {
    const kind = pending?.kind;
    if (kind !== 'rename_or_describe_space_space') {
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
