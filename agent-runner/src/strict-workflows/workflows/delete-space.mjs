import { buildCandidateContinuation, resumeFromCandidates } from '../candidate-disambiguation.mjs';
import { failed, needsInput } from '../protocol.mjs';
import { gatePlanResult, safeFailureText } from './plan-gate.mjs';

// delete_space (strict): "delete/remove/get rid of the <name> space" →
// resolves the shared space by name via listSpaces (durable disambiguation
// when multiple spaces share the name) and proposes space.delete (container
// and membership removed; photos preserved in members' libraries).
//
// Boundary decision: delete_album already declines "space" targets, and this
// workflow declines "album" targets — the two are mutually exclusive. This
// workflow NEVER steals a photo-deletion intent: `delete_space.match()`
// DECLINES when the captured reference contains a photo-source word
// (photos/pics/images/videos/screenshots/clips) or an "in the" / "from the"
// frame ("delete the photos in the Family space" stays with trash_assets'
// existing handling).
//
// Permission note: the server enforces owner-level permission
// (Permission.SharedSpaceDelete via sharedSpaceService.remove, wired in
// slice 3.2). A non-owner's apply is rejected server-side. The workflow
// proposes regardless (propose-only; server is the backstop), matching how
// other workflows propose and let the server enforce scope/role.

const KIND = 'delete_space';

const clean = (value) => (typeof value === 'string' ? value.trim() : '');

// Strip leading article, a leading "shared space " wrapper, and a trailing
// "(shared) space" noun from a user reference.
// "the Family space" → "Family", "shared space Family" → "Family".
// If the remaining text is itself just a stop-word (article or bare "space"),
// return "" so callers can reject it.
const normalizeSpaceRef = (value) => {
  const stripped = clean(value)
    .replace(/^(?:the|my|this|that|our)\s+/i, '')
    .replace(/^shared\s+space\s+/i, '')
    .replace(/(?:\s+)?(?:shared\s+)?space$/i, '')
    .trim();
  // Reject bare articles and bare "shared" / "space" residuals.
  return /^(?:the|my|this|that|our|shared|space)$/i.test(stripped) ? '' : stripped;
};

// Require the trailing "space" noun. Capture everything before it as the ref.
const DELETE_SPACE =
  /\b(?:delete|remove|get\s+rid\s+of)\s+(?<ref>.+?\s+space)\s*[.?!]*$/i;

// Photo-source words that indicate the user means "delete the photos inside
// the space" (a trash intent), not the space container itself.
const PHOTO_SOURCE_PATTERN =
  /\b(?:photos?|pics?|pictures?|images?|videos?|screenshots?|clips?)\b/i;

// "in (the)" or "from (the)" frame — "delete the photos in the Family space"
// or "remove my newest 20 from the Family space" → those are photo-ops,
// not space-delete.
const IN_OR_FROM_FRAME_PATTERN = /\b(?:in|from)\s+(?:the\s+)?/i;

export const deleteSpaceWorkflow = () => ({
  kind: KIND,
  flow: 'strict',

  match(prompt) {
    const text = clean(prompt);
    if (!text) {
      return undefined;
    }

    const m = DELETE_SPACE.exec(text);
    if (!m?.groups?.ref) {
      return undefined;
    }

    const rawRef = m.groups.ref;

    // Decline photo-source words in the captured ref ("delete the videos space"
    // is unlikely but "delete the Family space videos" must not match).
    if (PHOTO_SOURCE_PATTERN.test(rawRef)) {
      return undefined;
    }

    // Decline "in (the)" or "from (the)" frame — prevents stealing
    // "delete the photos in the Family space" (photo-op) and
    // "remove my newest 20 from the Italy space" (manage_space_assets).
    if (IN_OR_FROM_FRAME_PATTERN.test(rawRef)) {
      return undefined;
    }

    const spaceRef = normalizeSpaceRef(rawRef);

    // Empty ref after normalization — e.g. "delete the space" → decline so the
    // agent can ask which space the user means via open orchestration.
    if (!spaceRef) {
      return undefined;
    }

    // Decline album targets — those belong to delete_album (slice 3.3).
    if (/\balbum\b/i.test(spaceRef)) {
      return undefined;
    }

    return { slots: { spaceRef } };
  },

  parseSlots(rawSlots) {
    const spaceRef = normalizeSpaceRef(rawSlots?.spaceRef);
    if (!spaceRef) {
      return null;
    }
    return { spaceRef };
  },

  async run({ client, slots, resolvedSpaceId, signal, nowMs }) {
    // Continuation path: resolvedSpaceId is already known, skip listSpaces.
    if (resolvedSpaceId) {
      const spaceRef = clean(slots?.spaceRef);
      return this._proposeDelete({ client, spaceId: resolvedSpaceId, spaceName: spaceRef, signal });
    }

    const ref = normalizeSpaceRef(slots?.spaceRef);

    let listed;
    try {
      listed = await client.call('listSpaces', {}, { signal });
    } catch (error) {
      return failed({ text: safeFailureText(error?.message ?? 'The space lookup tool failed.') });
    }

    const spaces = Array.isArray(listed?.spaces) ? listed.spaces : [];
    const matches = spaces.filter(
      (space) => clean(space?.name).toLowerCase() === ref.toLowerCase(),
    );

    if (matches.length === 0) {
      return needsInput({
        text: `I could not find a space called "${ref}". Which space do you mean?`,
      });
    }

    if (matches.length > 1) {
      const candidates = matches.map((s) => ({ id: s.id, name: s.name }));
      const continuation = buildCandidateContinuation({
        kind: 'delete_space_space',
        candidates,
        nowMs: nowMs ?? Date.now(),
        slots,
      });
      return needsInput({
        text: `Multiple spaces are called "${ref}". Which one do you mean?\n${candidates.map((c, i) => `${i + 1}. ${c.name}`).join('\n')}`,
        continuation,
      });
    }

    const space = matches[0];
    return this._proposeDelete({ client, spaceId: space.id, spaceName: clean(space.name) || ref, signal });
  },

  // Internal: propose the space.delete operation and gate on a persisted plan id.
  async _proposeDelete({ client, spaceId, spaceName, signal }) {
    let planResult;
    try {
      planResult = await client.call(
        'proposeAlbumOperations',
        {
          summary: `Delete the "${spaceName}" space.`,
          operations: [
            {
              type: 'space.delete',
              targetKind: 'existing_space',
              targetId: spaceId,
              summary: `Delete the "${spaceName}" space.`,
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
      successText: `I prepared a plan to delete the "${spaceName}" space. The shared space and its membership are removed; photos stay in members' libraries. Review the plan before applying it.`,
      successSummary: { workflowKind: KIND, spaceName },
    });
  },

  resumeContinuation({ pending, prompt, nowMs }) {
    if (pending?.kind !== 'delete_space_space') {
      return {
        status: 'needs_input',
        text: 'I no longer have pending candidates for this request. Please start over.',
      };
    }

    const result = resumeFromCandidates({
      pending,
      prompt,
      nowMs: nowMs ?? Date.now(),
      kind: 'delete_space_space',
    });

    if (result.status !== 'matched') {
      return result;
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
