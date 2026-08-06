import { SUBJECTIVE_PATTERN, resolveAssetSource } from '../asset-source-resolver.mjs';
import { failed, handoffOpen, needsInput } from '../protocol.mjs';
import { gatePlanResult, safeFailureText } from './plan-gate.mjs';

const KIND = 'create_space_from_source';
const DEFAULT_NAME = 'New Space';

const clean = (value) => (typeof value === 'string' ? value.trim() : '');
const cleanSource = (value) => clean(value).replace(/[.?!]+$/u, '').trim();
const stripQuotes = (value) =>
  clean(value)
    .replace(/^["'""'']+/, '')
    .replace(/["'""'']+$/, '')
    .trim();

const declinesSource = (source) => SUBJECTIVE_PATTERN.test(source);

// An inline "name" that is really a filler adjective is NOT a name.
const FILLER_NAMES = new Set(['shared', 'new', 'a', 'an', 'the', 'my', 'this', 'that', 'our']);

const FORM_TRAILING_NAME =
  /\b(?:make|create|build)\s+(?:an?\s+)?(?:shared\s+)?space\s+(?:of|from|with|out\s+of)\s+(?<source>.+?)\s+(?:called|named|titled)\s+(?<name>.+)$/i;
const FORM_INLINE_NAME =
  /\b(?:make|create|build)\s+(?:an?\s+)?(?:shared\s+)?(?<name>.+?)\s+space\s+(?:of|from|with|out\s+of)\s+(?<source>.+)$/i;
const FORM_NO_NAME =
  /\b(?:make|create|build)\s+(?:an?\s+)?(?:shared\s+)?space\s+(?:of|from|with|out\s+of)\s+(?<source>.+)$/i;

const tryMatch = (prompt) => {
  let match = FORM_TRAILING_NAME.exec(prompt);
  let spaceName;
  if (match?.groups) {
    spaceName = match.groups.name;
  } else {
    match = FORM_INLINE_NAME.exec(prompt);
    if (match?.groups) {
      const candidate = clean(match.groups.name);
      spaceName = FILLER_NAMES.has(candidate.toLowerCase()) ? undefined : candidate;
    } else {
      match = FORM_NO_NAME.exec(prompt);
    }
  }
  if (!match?.groups) {
    return undefined;
  }
  const sourceDescription = cleanSource(match.groups.source);
  if (!sourceDescription || declinesSource(sourceDescription)) {
    return undefined;
  }
  const name = spaceName ? stripQuotes(spaceName) : '';
  return name ? { sourceDescription, spaceName: name } : { sourceDescription };
};

export const createSpaceFromSourceWorkflow = () => ({
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

  parseSlots(rawSlots) {
    const sourceDescription = cleanSource(rawSlots?.sourceDescription);
    if (!sourceDescription) {
      return null;
    }
    const name = stripQuotes(rawSlots?.spaceName);
    return { sourceDescription, spaceName: name || DEFAULT_NAME };
  },

  async run({ client, slots, signal }) {
    const sourceDescription = cleanSource(slots?.sourceDescription);
    const spaceName = clean(slots?.spaceName) || DEFAULT_NAME;

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
        text: `I could not find any photos matching "${sourceDescription}" for the new space. Can you describe them differently?`,
      });
    }
    const { selectionHandleId, assetCount } = resolution;

    // The handle is WRAPPED as a selectionHandle assetSource — there is no
    // proposeSpaceFromSelection tool. No raw asset ids reach the model.
    let planResult;
    try {
      planResult = await client.call(
        'proposeSpaceFromSearch',
        {
          summary: `Create the "${spaceName}" space.`,
          spaceName,
          assetSource: { kind: 'selectionHandle', selectionHandleId },
        },
        { signal },
      );
    } catch (error) {
      return failed({ text: safeFailureText(error?.message ?? 'The planning tool failed.') });
    }

    return gatePlanResult({
      planResult,
      planTool: 'proposeSpaceFromSearch',
      successText: `I prepared a plan to create the "${spaceName}" space from ${assetCount} matching ${assetCount === 1 ? 'photo' : 'photos'}. Review the plan before applying it.`,
      successSummary: { workflowKind: KIND, spaceName, assetCount },
    });
  },
});
