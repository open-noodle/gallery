// Shared plan-id success gate + secret redaction for strict/hybrid workflows.
//
// The original "claimed a plan that does not exist" bug class is prevented here:
// a workflow may only return a `planned` outcome once `proposeAlbumOperations`
// returns a persisted plan id. Without one, the workflow returns `failed` with
// safe (redacted) text instead of any success language. This mirrors the
// equivalent private helpers in strict-workflows.mjs so the trip workflow and the
// Slice 7 workflows share one gate definition.

import { failed, planned } from '../protocol.mjs';

// A plan id may surface as `planId` or `plan.id` depending on the tool shape.
export const extractPlanId = (toolResult) =>
  typeof toolResult?.planId === 'string'
    ? toolResult.planId
    : typeof toolResult?.plan?.id === 'string'
      ? toolResult.plan.id
      : undefined;

// Scrub credential-shaped substrings before any failure text reaches the user.
export const redactSensitiveText = (value) =>
  String(value)
    .replace(/\bAuthorization:\s*Bearer\s+\S+/gi, 'Authorization: Bearer [redacted]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\bapi[_-]?key\s*[=:]\s*\S+/gi, (match) => match.replace(/\S+$/u, '[redacted]'))
    .replace(/\bapi-key\s+\S+/gi, 'api-key [redacted]')
    .replace(/\bpassword\s*[=:]\s*\S+/gi, (match) => match.replace(/\S+$/u, '[redacted]'))
    .replace(/\bsecret\s*[=:]\s*\S+/gi, (match) => match.replace(/\S+$/u, '[redacted]'))
    .replace(/\bsecret\s+value\s+\S+/gi, 'secret value [redacted]')
    .replace(/\bsecret[-_][A-Za-z0-9_-]+\b/gi, '[redacted]')
    .replace(/\btoken\s+[A-Za-z0-9._-]+\b/gi, 'token [redacted]');

// User-facing failure copy. Deliberately avoids any success language
// ("created"/"proposed"/"ready") so the copy never implies a plan exists.
export const safeFailureText = (message) =>
  `I could not create a reviewable album plan. ${redactSensitiveText(
    message ?? 'Please try again with a more specific request.',
  ).trim()}`;

/**
 * Gate a plan-tool result into a `planned`/`failed` outcome.
 *
 * @param {object} args
 * @param {*} args.planResult - the raw `proposeAlbumOperations` result.
 * @param {string} args.successText - user-facing success copy (only used with a plan id).
 * @param {import('../protocol.mjs').SuccessSummary} args.successSummary
 * @param {string} args.planTool - tool name, for the failure reason.
 * @returns {import('../protocol.mjs').WorkflowOutcome}
 */
export const gatePlanResult = ({ planResult, successText, successSummary, planTool = 'proposeAlbumOperations' }) => {
  if (planResult?.status && planResult.status !== 'success') {
    return failed({ text: safeFailureText(`The planning tool returned status "${planResult.status}" for ${planTool}.`) });
  }

  const planId = extractPlanId(planResult);
  if (!planId) {
    return failed({ text: safeFailureText('The planning tool did not return a persisted plan id.') });
  }

  return planned({ text: successText, planId, successSummary });
};
