/**
 * @typedef {Object} SuccessSummary
 * @property {string} workflowKind
 * @property {string} [albumName]
 * @property {string} [label]      // human place/source label, e.g. "New York, USA"
 * @property {string} [dateRange]
 * @property {number} [assetCount]
 * @property {string} [exclusions]
 * @property {string} [target]
 */

/**
 * @typedef {Object} WorkflowContext
 * @property {object} client                 // strict MCP client (signal-aware)
 * @property {Record<string,string>} slots
 * @property {AbortSignal} [signal]
 * @property {*} [candidate]                  // present on a continuation-resolved run; run() skips discovery
 * @property {*} [approvedPlanResult]         // present on approval resume; reused instead of re-planning
 * @property {number} [nowMs]                 // injected clock for building continuation TTLs
 */

/**
 * @typedef {Object} PlannedOutcome
 * @property {'planned'} status
 * @property {string} text
 * @property {string} planId
 * @property {SuccessSummary} successSummary
 *
 * @typedef {Object} NeedsInputOutcome
 * @property {'needs_input'} status
 * @property {string} text
 * @property {*} [continuation]
 *
 * @typedef {Object} ApprovalRequiredOutcome
 * @property {'approval_required'} status
 * @property {string} toolCallId
 * @property {*} continuation
 *
 * @typedef {Object} FailedOutcome
 * @property {'failed'} status
 * @property {string} text
 *
 * @typedef {Object} HandoffOpenOutcome
 * @property {'handoff_open'} status
 * @property {string} reason
 *
 * @typedef {PlannedOutcome|NeedsInputOutcome|ApprovalRequiredOutcome|FailedOutcome|HandoffOpenOutcome} WorkflowOutcome
 */

export const planned = ({ text, planId, successSummary, extra = {} }) => ({
  status: 'planned',
  text,
  planId,
  successSummary,
  ...extra,
});

export const needsInput = ({ text, continuation }) => ({
  status: 'needs_input',
  text,
  ...(continuation ? { continuation } : {}),
});

export const approvalRequired = ({ toolCallId, continuation }) => ({
  status: 'approval_required',
  toolCallId,
  continuation,
});

export const failed = ({ text }) => ({ status: 'failed', text });

export const handoffOpen = ({ reason }) => ({ status: 'handoff_open', reason });

/**
 * @typedef {Object} StrictWorkflow
 * @property {string} kind
 * @property {'strict'|'hybrid'} flow
 * @property {(prompt: string) => ({ slots: Record<string,string> } | undefined)} match
 * @property {(rawSlots: Record<string,string>, prompt: string) => (Record<string,string> | null)} parseSlots
 * @property {(ctx: WorkflowContext) => Promise<WorkflowOutcome>} run
 * @property {Function} [buildContinuation]
 * @property {Function} [resumeContinuation]
 * @property {Function} [resumeApproval]
 */
