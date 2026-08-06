import { buildCandidateContinuation, resumeFromCandidates } from './candidate-disambiguation.mjs';

// Shared person-resolver helper — used by rename_person, set_person_birthdate,
// hide_person. Generalises the space candidate-disambiguation pattern for persons.
// The caller passes `includeHidden: true` for unhide flows so hidden people can
// be found via searchPeople.

/**
 * Resolve a person name to a { status, personId, name } result by calling searchPeople.
 *
 * Returns one of:
 *   { status: 'matched', personId, name }
 *   { status: 'needs_input', text }
 *   { status: 'candidates', continuation, text }   — ambiguous, caller should return needsInput
 *   { status: 'failed', text }                      — tool error
 *
 * @param {object} opts
 * @param {object}  opts.client        – workflow client
 * @param {string}  opts.name          – person name to search
 * @param {boolean} [opts.includeHidden] – include hidden people (for unhide)
 * @param {object}  [opts.signal]      – abort signal
 * @param {number}  opts.nowMs         – current timestamp (injectable for tests)
 * @param {string}  opts.kind          – continuation kind token (workflow-specific)
 * @param {object}  [opts.slots]       – original slots to carry into the continuation
 */
export const resolvePerson = async ({ client, name, includeHidden = false, signal, nowMs, kind, slots }) => {
  let result;
  try {
    const request = { name };
    if (includeHidden) {
      request.includeHidden = true;
    }
    result = await client.call('searchPeople', request, { signal });
  } catch (error) {
    return {
      status: 'failed',
      text: `The people search tool failed: ${error?.message ?? 'unknown error'}`,
    };
  }

  const people = result?.people;
  if (!people) {
    return {
      status: 'failed',
      text: 'The people search tool returned an unexpected response.',
    };
  }

  if (people.status === 'not_found') {
    return {
      status: 'needs_input',
      text: `I couldn't find a person named "${name}". Please check the name and try again.`,
    };
  }

  if (people.status === 'matched') {
    return { status: 'matched', personId: people.personId, name: people.name };
  }

  // Ambiguous — offer candidate list.
  const choices = Array.isArray(people.choices) ? people.choices : [];
  const candidates = choices.map((c) => ({ id: c.personId, name: c.name }));
  const continuation = buildCandidateContinuation({
    kind,
    candidates,
    nowMs: nowMs ?? Date.now(),
    slots,
  });
  const list = candidates.map((c, i) => `${i + 1}. ${c.name}`).join('\n');
  return {
    status: 'candidates',
    continuation,
    text: `Multiple people match "${name}". Which one do you mean?\n${list}`,
  };
};

/**
 * Resume a person candidate pick from a continuation follow-up.
 *
 * @param {object} opts
 * @param {object} opts.pending   – stored continuation from buildCandidateContinuation
 * @param {string} opts.prompt    – free-text reply from the user
 * @param {number} opts.nowMs     – current timestamp
 * @param {string} opts.kind      – expected pending.kind value
 *
 * @returns {{ status: 'matched', personId, personName, slots }
 *          |{ status: 'needs_input', text }
 *          |{ status: 'expired', text }}
 */
export const resumePersonFromCandidates = ({ pending, prompt, nowMs, kind }) => {
  const result = resumeFromCandidates({ pending, prompt, nowMs: nowMs ?? Date.now(), kind });
  if (result.status !== 'matched') {
    return result; // needs_input | expired | missing — pass through
  }

  return {
    status: 'matched',
    personId: result.choice.id,
    personName: result.choice.name,
    slots: pending.slots,
  };
};
