// Generic, runtime-agnostic workflow dispatcher.
//
// Both pi-runtime and e2e-runtime route every strict/hybrid turn through this
// dispatcher. The dispatcher owns classify-or-resume routing, calls
// `workflow.run`/`resumeContinuation`/`resumeApproval`, and maps each
// `WorkflowOutcome` arm to runner events, transcript appends, and the
// `pendingWorkflow` set/clear transitions.
//
// Each runtime keeps its OWN event payload shapes by injecting `completedEvent`
// and `approvalEvent` builders per call. The dispatcher never hard-codes a
// workflow `kind` — adding a workflow is a registry entry, not a dispatcher edit.

import { renderCopy } from './copy.mjs';

// Conservative chatter short-circuit: pure acknowledgements / greetings get a
// no-tool reply, skipping BOTH the classifier and the 30k-catalog open agent.
// High precision (anchored whole-string allowlist) so a real request/question
// is never swallowed.
const _ACK_CORE =
  'thanks?|thank\\s*you|ty|cheers|much\\s+appreciated|appreciate\\s+it' +
  '|ok(?:ay)?|cool|great|perfect|awesome|amazing|nice|sweet|excellent|wonderful|fantastic' +
  '|got\\s+it|sounds\\s+good|will\\s+do|that\\s+works' +
  '|that(?:\'s|\\s+is|\\s+was)?\\s+(?:great|perfect|helpful|awesome|nice|amazing|wonderful|fantastic|cool)' +
  '|looks?\\s+good|that\\s+looks?\\s+great|nice\\s+work|good\\s+job|well\\s+done';

const _GREET_CORE = 'hi|hello|hey|yo|gm|good\\s+morning|good\\s+afternoon|good\\s+evening';

const _CONT_EXTRA = 'so\\s+much|a\\s+lot|there|everyone|team|mate';

// Anchored whole-string pattern: one main ack/greeting, then zero or more
// additional ack/greeting/suffix phrases separated by punctuation/whitespace.
const CHATTER_PATTERN = new RegExp(
  '^(?:' + _ACK_CORE + '|' + _GREET_CORE + ')' +
  '(?:[\\s,!.]+(?:' + _ACK_CORE + '|' + _GREET_CORE + '|' + _CONT_EXTRA + '))*' +
  '[\\s!.]*$',
  'i',
);

const isChatter = (text) => {
  const t = String(text ?? '').trim();
  if (!t || t.length > 60) return false;
  // questions are never chatter — strip only trailing whitespace/!/. before checking
  if (/\?/.test(t.replace(/[\s!.]*$/u, ''))) return false;
  return CHATTER_PATTERN.test(t);
};

const chatterReply = (prompt) => {
  if (/^(?:hi|hello|hey|yo|gm|good\s)/i.test(String(prompt ?? '').trim())) {
    return 'Hi! How can I help with your photos?';
  }
  return "You're welcome! Let me know if there's anything else you'd like to do with your photos.";
};

const genericApprovalDeniedText =
  'The approval was denied, so no plan was created. Rerun the request to try again.';

const defaultCompletedEvent = ({ text }) => ({
  type: 'assistant-message-completed',
  content: { blocks: [{ type: 'text', text }] },
});

const defaultApprovalEvent = ({ toolCallId }) => ({
  type: 'tool-approval-needed',
  toolCallId,
});

const defaultWorkflowStateEvent = ({ workflowState }) => ({
  type: 'workflow-state-update',
  workflowState,
});

const noop = () => {};

// Durability (Slice 5): every pendingWorkflow set/clear is mirrored to a
// `workflow-state-update` stream event so the server can persist the scrubbed
// blob and rehydrate it on the next turn/approval. The in-memory Map stays a
// write-through cache for the active turn; the server is the source of truth.
//
// A no-op clear (clearing when nothing was pending) emits nothing so the common
// "planned" success path stays a single completed event with no redundant null
// persistence churn.
const withDurableSetPending = (getPending, setPending, emit, workflowStateEvent) => (next) => {
  const hadPending = getPending() != null;
  setPending(next);
  if (next == null && !hadPending) {
    return;
  }
  emit(workflowStateEvent({ workflowState: next ?? null }));
};

// Observability (Slice 6): the dispatcher emits structured events through an
// injected `observe(event)` hook so router recall and the success gate are
// measurable. `observe` defaults to a no-op, leaving earlier-slice tests and the
// e2e runtime unaffected. Every event carries a `kind` discriminator and only
// scrubbed, non-sensitive fields (no prompts, ids, or summaries).
export const createWorkflowDispatcher = ({
  registry,
  buildClient,
  now = Date.now,
  observe = noop,
  // Copy delegation (Slice 6). Default `template` reproduces today's strings
  // exactly; `llm-polish` rephrases ONLY the scrubbed success summary. The
  // success/failure decision is made deterministically before copy is rendered.
  copyMode = 'template',
  polish,
} = {}) => {
  // Render planned-arm copy and emit the success-gate observability event when a
  // planned outcome lacks a planId (the original "claimed a plan that does not
  // exist" bug class). Non-planned arms reuse the workflow's template text.
  const renderOutcomeText = async (outcome) =>
    renderCopy({
      outcome,
      mode: copyMode,
      polish,
      onGateBlock: () => observe({ kind: 'strict_success_gate_block', workflowKind: outcome?.successSummary?.workflowKind ?? null }),
    });

  const observeOutcome = ({ outcome, wf, fellBackToOpen }) => {
    observe({
      kind: 'strict_workflow_outcome',
      workflowKind: wf?.kind ?? null,
      status: outcome?.status ?? null,
      planId: typeof outcome?.planId === 'string' ? outcome.planId : null,
      toolCalls: typeof outcome?.toolCalls === 'number' ? outcome.toolCalls : null,
      fellBackToOpen: Boolean(fellBackToOpen),
    });
  };

  const handleOutcome = async ({
    outcome,
    wf,
    emit,
    appendTranscript,
    setPending,
    prompt,
    completedEvent,
    approvalEvent,
  }) => {
    switch (outcome?.status) {
      case 'planned': {
        const text = await renderOutcomeText(outcome);
        observeOutcome({ outcome, wf });
        appendTranscript(prompt, text);
        setPending(undefined);
        emit(completedEvent({ text }));
        return { handled: true };
      }
      case 'needs_input': {
        observeOutcome({ outcome, wf });
        if (outcome.continuation) {
          setPending({ workflowKind: wf.kind, kind: 'selection', continuation: outcome.continuation });
        } else {
          setPending(undefined);
        }
        appendTranscript(prompt, outcome.text);
        emit(completedEvent({ text: outcome.text }));
        return { handled: true };
      }
      case 'approval_required': {
        observeOutcome({ outcome, wf });
        setPending({
          workflowKind: wf.kind,
          kind: 'approval',
          toolCallId: outcome.toolCallId,
          ...outcome.continuation,
        });
        emit(approvalEvent({ toolCallId: outcome.toolCallId }));
        return { handled: true };
      }
      case 'failed': {
        observeOutcome({ outcome, wf });
        setPending(undefined);
        appendTranscript(prompt, outcome.text);
        emit(completedEvent({ text: outcome.text }));
        return { handled: true };
      }
      case 'handoff_open':
      default: {
        observeOutcome({ outcome, wf, fellBackToOpen: true });
        setPending(undefined);
        return { handled: false };
      }
    }
  };

  const routeTurn = async ({
    prompt,
    emit,
    appendTranscript,
    getPending,
    setPending: rawSetPending,
    signal,
    completedEvent = defaultCompletedEvent,
    approvalEvent = defaultApprovalEvent,
    workflowStateEvent = defaultWorkflowStateEvent,
  }) => {
    const setPending = withDurableSetPending(getPending, rawSetPending, emit, workflowStateEvent);
    const nowMs = now();
    const pending = getPending();

    // Continuation follow-up (approval resume is handled by routeApproval).
    if (pending && pending.kind !== 'approval') {
      const wf = registry.getWorkflow(pending.workflowKind);
      const resolved = wf.resumeContinuation({ pending: pending.continuation, prompt, nowMs });
      if (resolved.status === 'matched') {
        observe({ kind: 'strict_continuation', resumed: true, expired: false, missing: false });
        // Spec: the continuation-resolved path reuses run() with ctx.candidate
        // set — there is no separate run_continuation_candidate.
        const outcome = await wf.run({ client: buildClient(), ...resolved.ctx, signal, nowMs });
        return handleOutcome({ outcome, wf, emit, appendTranscript, setPending, prompt, completedEvent, approvalEvent });
      }

      setPending(resolved.status === 'needs_input' ? pending : undefined);
      observe({
        kind: 'strict_continuation',
        resumed: false,
        expired: resolved.status === 'expired',
        missing: resolved.status === 'missing',
      });
      emit(completedEvent({ text: resolved.text }));
      return { handled: true };
    }

    // Chatter short-circuit: pure acknowledgements/greetings skip BOTH the
    // classifier and the 30k-catalog open agent. Emits matched:false so L3
    // still reads kind=none (fellBackToOpen:false signals no open-agent spin-up).
    if (isChatter(prompt)) {
      observe({
        kind: 'strict_router_decision',
        matched: false,
        workflowKind: null,
        via: 'chatter',
        confidence: null,
        latencyMs: Math.max(0, now() - nowMs),
        fellBackToOpen: false,
      });
      const reply = chatterReply(prompt);
      appendTranscript?.(prompt, reply);
      emit(completedEvent({ text: reply }));
      return { handled: true };
    }

    const decision = await registry.classify(prompt, { signal });
    const matched = decision.kind !== 'none';
    observe({
      kind: 'strict_router_decision',
      matched,
      workflowKind: matched ? decision.kind : null,
      via: decision.via ?? null,
      confidence: decision.confidence ?? null,
      latencyMs: Math.max(0, now() - nowMs),
      fellBackToOpen: !matched,
    });
    if (decision.kind === 'none') {
      return { handled: false };
    }

    const wf = registry.getWorkflow(decision.kind);
    const slots = wf.parseSlots(decision.slots, prompt);
    if (slots == null) {
      return { handled: false }; // falls through to open orchestration
    }

    const outcome = await wf.run({ client: buildClient(), slots, signal, nowMs });
    return handleOutcome({ outcome, wf, emit, appendTranscript, setPending, prompt, completedEvent, approvalEvent });
  };

  const routeApproval = async ({
    toolCallId,
    approvalDecision,
    toolResult,
    emit,
    appendTranscript,
    getPending,
    setPending: rawSetPending,
    signal,
    completedEvent = defaultCompletedEvent,
    approvalEvent = defaultApprovalEvent,
    workflowStateEvent = defaultWorkflowStateEvent,
  }) => {
    const setPending = withDurableSetPending(getPending, rawSetPending, emit, workflowStateEvent);
    const pending = getPending();
    if (!pending || pending.kind !== 'approval' || pending.toolCallId !== toolCallId) {
      return { handled: false }; // fall through to provider continue path
    }

    setPending(undefined);
    if (approvalDecision !== 'approved') {
      // Generic, workflow-agnostic denial. No workflow re-implements denial copy.
      appendTranscript('', genericApprovalDeniedText);
      emit(completedEvent({ text: genericApprovalDeniedText }));
      return { handled: true };
    }

    const wf = registry.getWorkflow(pending.workflowKind);
    const outcome = await wf.resumeApproval({
      client: buildClient(),
      pending,
      approvedPlanResult: toolResult,
      signal,
    });
    return handleOutcome({
      outcome,
      wf,
      emit,
      appendTranscript,
      setPending,
      prompt: '',
      completedEvent,
      approvalEvent,
    });
  };

  return { routeTurn, routeApproval };
};
