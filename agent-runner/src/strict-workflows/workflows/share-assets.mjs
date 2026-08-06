import { SUBJECTIVE_PATTERN, resolveAssetSource } from '../asset-source-resolver.mjs';
import { failed, handoffOpen, needsInput } from '../protocol.mjs';
import { gatePlanResult, safeFailureText } from './plan-gate.mjs';

// share_assets (hybrid): "share <source> as a link" / "create a share link for
// <source>" / "make a shareable link for <source>" → resolves a bounded asset
// source and proposes a shareLink.create op. Optional payload: "expires in N
// days" → expiresAt, "with password X" → password, "hide metadata" →
// showMetadata false.
//
// OUTWARD-FACING SAFETY: shareLink.create creates a public link visible to
// unauthenticated users. It is gated behind the `createSharedLinks` write-scope
// which defaults FALSE in every preset. The L3 eval preset never grants
// createSharedLinks, so this workflow is propose-only in all eval runs — no
// link is ever created during tests or evaluations.
//
// Subjective sources ("the best ones") decline at match-time. Album/space-level
// share ("share the album") is out of scope (asset share only).

const KIND = 'share_assets';

const clean = (v) => (typeof v === 'string' ? v.trim() : '');
const cleanSource = (v) => clean(v).replace(/[.?!]+$/u, '').trim();

const SUBJECTIVE_SOURCE_PATTERN = SUBJECTIVE_PATTERN;
const containerPattern = /\b(?:album|space)$/i;
const declinesSource = (s) => SUBJECTIVE_SOURCE_PATTERN.test(s) || containerPattern.test(s);

// "expires in N days" — captured anywhere in the prompt.
const EXPIRY_DAYS_PATTERN = /\bexpir(?:es?|ing)\s+in\s+(\d+)\s+days?\b/i;
// "with password <word>" — captured anywhere in the prompt.
const PASSWORD_PATTERN = /\bwith\s+password\s+(\S+)/i;
// "hide metadata" — captured anywhere in the prompt.
const HIDE_METADATA_PATTERN = /\bhide\s+metadata\b/i;

// Strip optional modifiers from the source description captured by the pattern.
const stripModifiers = (s) =>
  s
    .replace(EXPIRY_DAYS_PATTERN, '')
    .replace(PASSWORD_PATTERN, '')
    .replace(HIDE_METADATA_PATTERN, '')
    .replace(/,\s*$/u, '')
    .trim();

// share <source> as a (share|shareable) link
const SHARE_AS_LINK_PATTERN = /\bshare\s+(?<source>.+?)\s+as\s+a\s+(?:share(?:able)?\s+)?link\b/i;
// create/make/generate a (share|shareable) link for <source>
const CREATE_SHARE_LINK_PATTERN =
  /\b(?:create|make|generate|build)\s+a\s+share(?:able)?\s+link\s+for\s+(?<source>.+)$/i;
// share <source> expiring in N days (shorthand)
const SHARE_EXPIRING_PATTERN = /\bshare\s+(?<source>.+?)\s+(?:as\s+a\s+link\s+)?expiring\s+in\s+\d+\s+days?\b/i;
// share <source> with password X
const SHARE_WITH_PASSWORD_PATTERN = /\bshare\s+(?<source>.+?)\s+with\s+password\s+\S+/i;

const PATTERNS = [
  SHARE_AS_LINK_PATTERN,
  CREATE_SHARE_LINK_PATTERN,
  SHARE_EXPIRING_PATTERN,
  SHARE_WITH_PASSWORD_PATTERN,
];

const parseModifiers = (fullText) => {
  const modifiers = {};
  const expiryMatch = EXPIRY_DAYS_PATTERN.exec(fullText);
  if (expiryMatch) {
    modifiers.expiryDays = Number(expiryMatch[1]);
  }
  const passwordMatch = PASSWORD_PATTERN.exec(fullText);
  if (passwordMatch) {
    modifiers.password = passwordMatch[1];
  }
  if (HIDE_METADATA_PATTERN.test(fullText)) {
    modifiers.showMetadata = false;
  }
  return modifiers;
};

export const shareAssetsWorkflow = () => ({
  kind: KIND,
  flow: 'hybrid',

  match(prompt) {
    const text = clean(prompt);
    if (!text) return undefined;
    for (const pattern of PATTERNS) {
      const m = pattern.exec(text);
      if (m?.groups?.source) {
        const rawSource = m.groups.source;
        const sourceDescription = cleanSource(stripModifiers(rawSource));
        if (!sourceDescription || declinesSource(sourceDescription)) {
          return undefined;
        }
        const modifiers = parseModifiers(text);
        return { slots: { sourceDescription, ...modifiers } };
      }
    }
    return undefined;
  },

  parseSlots(rawSlots) {
    const sourceDescription = cleanSource(rawSlots?.sourceDescription);
    if (!sourceDescription) return null;
    const slots = { sourceDescription };
    if (typeof rawSlots?.expiryDays === 'number') slots.expiryDays = rawSlots.expiryDays;
    if (typeof rawSlots?.password === 'string' && rawSlots.password) slots.password = rawSlots.password;
    if (rawSlots?.showMetadata === false) slots.showMetadata = false;
    return slots;
  },

  async run({ client, slots, signal, nowMs }) {
    const sourceDescription = cleanSource(slots?.sourceDescription);
    if (!sourceDescription) {
      return needsInput({ text: 'Which photos should I create a share link for? Please describe them.' });
    }

    let resolution;
    try {
      resolution = await resolveAssetSource({ client, sourceDescription, signal });
    } catch (error) {
      return failed({ text: safeFailureText(error?.message ?? 'The search tool failed.') });
    }
    if (resolution.status === 'handoff') return handoffOpen({ reason: resolution.reason });
    if (resolution.status === 'needs_input') return needsInput({ text: resolution.text });
    if (resolution.status === 'empty') {
      return needsInput({
        text: `I could not find any photos matching "${sourceDescription}". Can you describe them differently?`,
      });
    }
    const { selectionHandleId, assetCount } = resolution;

    // Build optional payload from slots.
    const payload = {};
    if (typeof slots?.expiryDays === 'number' && slots.expiryDays > 0) {
      const baseMs = typeof nowMs === 'number' ? nowMs : Date.now();
      const expiresAt = new Date(baseMs + slots.expiryDays * 24 * 60 * 60 * 1000).toISOString();
      payload.expiresAt = expiresAt;
    }
    if (typeof slots?.password === 'string' && slots.password) {
      payload.password = slots.password;
    }
    if (slots?.showMetadata === false) {
      payload.showMetadata = false;
    }

    let planResult;
    try {
      planResult = await client.call(
        'proposeAlbumOperations',
        {
          summary: `Create a share link for matching photos.`,
          operations: [
            {
              type: 'shareLink.create',
              summary: 'Create an outward-facing share link (High risk; requires createSharedLinks scope).',
              targetKind: 'asset_batch',
              assetSource: { kind: 'selectionHandle', selectionHandleId },
              riskLevel: 'high',
              ...(Object.keys(payload).length > 0 ? { payload } : {}),
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
      planTool: 'proposeAlbumOperations',
      successText: `I prepared a plan to create a share link for ${assetCount} matching ${assetCount === 1 ? 'photo' : 'photos'}. This creates an outward-facing link; review the plan before applying it.`,
      successSummary: { workflowKind: KIND, assetCount },
    });
  },
});
