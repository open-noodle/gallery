import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createWorkflowDispatcher } from './dispatcher.mjs';

const fakeRegistry = (workflow) => ({
  classify: (prompt) =>
    workflow.match(prompt)
      ? { kind: workflow.kind, via: 'regex', confidence: 'high', ...workflow.match(prompt) }
      : { kind: 'none', via: 'regex' },
  getWorkflow: (kind) => (kind === workflow.kind ? workflow : undefined),
});

const plannedWorkflow = {
  kind: 'create_recent_trip_album',
  flow: 'strict',
  match: (p) => (p.includes('recent trip') ? { slots: { albumName: 'USA Trip', placeHint: 'USA' } } : undefined),
  parseSlots: (s) => s,
  run: async () => ({ status: 'planned', text: 'Review the plan.', planId: 'plan-1', successSummary: {} }),
};

const capture = () => {
  const events = [];
  let pending;
  return {
    emit: (event) => events.push(event),
    appendTranscript: () => {},
    getPending: () => pending,
    setPending: (next) => {
      pending = next;
    },
    events,
    get pending() {
      return pending;
    },
  };
};

describe('workflow dispatcher', () => {
  it('routes a matched new turn to run and emits a completed event for planned', async () => {
    const workflow = {
      kind: 'create_recent_trip_album',
      flow: 'strict',
      match: (p) => (p.includes('recent trip') ? { slots: { albumName: 'USA Trip', placeHint: 'USA' } } : undefined),
      parseSlots: (s) => s,
      run: async () => ({ status: 'planned', text: 'Review the plan.', planId: 'plan-1', successSummary: {} }),
    };
    const sink = capture();
    const dispatcher = createWorkflowDispatcher({ registry: fakeRegistry(workflow), buildClient: () => ({}) });

    const result = await dispatcher.routeTurn({ prompt: 'Create an album for my recent trip to USA', ...sink });

    assert.equal(result.handled, true);
    assert.equal(sink.events.at(-1).type, 'assistant-message-completed');
    assert.match(sink.events.at(-1).content.blocks[0].text, /Review the plan/);
    assert.equal(sink.pending, undefined);
  });

  it('stores pendingWorkflow on needs_input continuation', async () => {
    const workflow = {
      kind: 'create_recent_trip_album',
      flow: 'strict',
      match: () => ({ slots: {} }),
      parseSlots: (s) => s,
      run: async () => ({ status: 'needs_input', text: 'Which trip?', continuation: { kind: 'sel', candidates: [] } }),
    };
    const sink = capture();
    const dispatcher = createWorkflowDispatcher({ registry: fakeRegistry(workflow), buildClient: () => ({}) });
    await dispatcher.routeTurn({ prompt: 'Make an album for my recent trip', ...sink });
    assert.equal(sink.pending.workflowKind, 'create_recent_trip_album');
    assert.equal(sink.pending.continuation.kind, 'sel');
  });

  it('emits tool-approval-needed and stores approval pending on approval_required', async () => {
    const workflow = {
      kind: 'create_recent_trip_album',
      flow: 'strict',
      match: () => ({ slots: {} }),
      parseSlots: (s) => s,
      run: async () => ({
        status: 'approval_required',
        toolCallId: 'tc-1',
        continuation: { candidate: {}, workflow: {} },
      }),
    };
    const sink = capture();
    const dispatcher = createWorkflowDispatcher({ registry: fakeRegistry(workflow), buildClient: () => ({}) });
    await dispatcher.routeTurn({ prompt: 'Create an album for my recent trip to USA', ...sink });
    assert.equal(sink.events.at(-1).type, 'tool-approval-needed');
    assert.equal(sink.events.at(-1).toolCallId, 'tc-1');
    assert.equal(sink.pending.toolCallId, 'tc-1');
  });

  it('reports unhandled for handoff_open and for no match (provider fallthrough)', async () => {
    const handoff = {
      kind: 'k',
      flow: 'hybrid',
      match: () => ({ slots: {} }),
      parseSlots: (s) => s,
      run: async () => ({ status: 'handoff_open', reason: 'subjective' }),
    };
    const sink = capture();
    const d1 = createWorkflowDispatcher({ registry: fakeRegistry(handoff), buildClient: () => ({}) });
    assert.equal((await d1.routeTurn({ prompt: 'do something fuzzy', ...sink })).handled, false);

    const noMatch = { kind: 'k', flow: 'strict', match: () => undefined, parseSlots: (s) => s, run: async () => ({}) };
    const d2 = createWorkflowDispatcher({ registry: fakeRegistry(noMatch), buildClient: () => ({}) });
    assert.equal((await d2.routeTurn({ prompt: 'unrelated', ...capture() })).handled, false);
  });

  it('routes a continuation follow-up by reusing run() with the resolved candidate', async () => {
    const runCalls = [];
    const workflow = {
      kind: 'create_recent_trip_album',
      flow: 'strict',
      match: () => undefined,
      parseSlots: (s) => s,
      resumeContinuation: () => ({
        status: 'matched',
        ctx: { slots: { albumName: 'X' }, candidate: { dedupeKey: 'x' } },
      }),
      run: async (ctx) => {
        runCalls.push(ctx);
        return { status: 'planned', text: 'ok', planId: 'p', successSummary: {} };
      },
    };
    const sink = capture();
    sink.setPending({ workflowKind: 'create_recent_trip_album', kind: 'selection', continuation: { candidates: [] } });
    const dispatcher = createWorkflowDispatcher({ registry: fakeRegistry(workflow), buildClient: () => ({}) });
    const result = await dispatcher.routeTurn({ prompt: 'the first one', ...sink });
    assert.equal(result.handled, true);
    assert.equal(runCalls[0].candidate.dedupeKey, 'x'); // run() reused with ctx.candidate, not a separate method
    assert.equal(sink.events.at(-1).type, 'assistant-message-completed');
    assert.equal(sink.pending, undefined);
  });

  it('emits text and clears pending when a continuation expires', async () => {
    const workflow = {
      kind: 'create_recent_trip_album',
      flow: 'strict',
      match: () => undefined,
      parseSlots: (s) => s,
      resumeContinuation: () => ({ status: 'expired', text: 'Those choices expired. Please rerun.' }),
      run: async () => ({ status: 'planned' }),
    };
    const sink = capture();
    sink.setPending({ workflowKind: 'create_recent_trip_album', kind: 'selection', continuation: {} });
    const dispatcher = createWorkflowDispatcher({ registry: fakeRegistry(workflow), buildClient: () => ({}) });
    await dispatcher.routeTurn({ prompt: 'first', ...sink });
    assert.match(sink.events.at(-1).content.blocks[0].text, /expired/i);
    assert.equal(sink.pending, undefined);
  });

  it('clears pending and emits text on a failed outcome', async () => {
    const workflow = {
      kind: 'create_recent_trip_album',
      flow: 'strict',
      match: () => ({ slots: {} }),
      parseSlots: (s) => s,
      run: async () => ({ status: 'failed', text: 'I could not create a reviewable album plan.' }),
    };
    const sink = capture();
    const dispatcher = createWorkflowDispatcher({ registry: fakeRegistry(workflow), buildClient: () => ({}) });
    const result = await dispatcher.routeTurn({ prompt: 'Create an album for my recent trip to USA', ...sink });
    assert.equal(result.handled, true);
    assert.equal(sink.pending, undefined);
    assert.match(sink.events.at(-1).content.blocks[0].text, /could not create/i);
  });

  it('reports unhandled when parseSlots rejects the classified slots', async () => {
    const workflow = {
      kind: 'k',
      flow: 'strict',
      match: () => ({ slots: {} }),
      parseSlots: () => null,
      run: async () => ({}),
    };
    const sink = capture();
    const dispatcher = createWorkflowDispatcher({ registry: fakeRegistry(workflow), buildClient: () => ({}) });
    assert.equal((await dispatcher.routeTurn({ prompt: 'something', ...sink })).handled, false);
  });

  it('resumes an approval by calling resumeApproval and clears pending', async () => {
    const workflow = {
      kind: 'create_recent_trip_album',
      flow: 'strict',
      resumeApproval: async ({ approvedPlanResult }) => ({
        status: 'planned',
        text: 'Review the plan.',
        planId: approvedPlanResult.planId,
        successSummary: {},
      }),
    };
    const sink = capture();
    sink.setPending({
      workflowKind: 'create_recent_trip_album',
      kind: 'approval',
      toolCallId: 'tc-1',
      slots: {},
      candidate: {},
    });
    const dispatcher = createWorkflowDispatcher({ registry: fakeRegistry(workflow), buildClient: () => ({}) });
    const result = await dispatcher.routeApproval({
      toolCallId: 'tc-1',
      approvalDecision: 'approved',
      toolResult: { planId: 'p-9' },
      ...sink,
    });
    assert.equal(result.handled, true);
    assert.equal(sink.events.at(-1).type, 'assistant-message-completed');
    assert.equal(sink.pending, undefined);
  });

  it('emits a router decision and outcome for a matched planned turn', async () => {
    const observed = [];
    const dispatcher = createWorkflowDispatcher({
      registry: fakeRegistry(plannedWorkflow),
      buildClient: () => ({}),
      observe: (e) => observed.push(e),
    });
    await dispatcher.routeTurn({ prompt: 'Create an album for my recent trip to USA', ...capture() });
    assert.deepEqual(
      observed.map((e) => e.kind),
      ['strict_router_decision', 'strict_workflow_outcome'],
    );
    assert.equal(observed[0].matched, true);
    assert.equal(observed[0].workflowKind, 'create_recent_trip_album');
    assert.equal(observed[0].via, 'regex');
    assert.equal(observed[0].confidence, 'high');
    assert.equal(observed[1].status, 'planned');
    assert.equal(observed[1].kind, 'strict_workflow_outcome');
    assert.equal(observed[1].planId, 'plan-1');
    assert.equal(observed[1].fellBackToOpen, false);
  });

  it('reports a no-match router decision and no outcome on provider fallthrough', async () => {
    const observed = [];
    const noMatch = { kind: 'k', flow: 'strict', match: () => undefined, parseSlots: (s) => s, run: async () => ({}) };
    const dispatcher = createWorkflowDispatcher({
      registry: fakeRegistry(noMatch),
      buildClient: () => ({}),
      observe: (e) => observed.push(e),
    });
    await dispatcher.routeTurn({ prompt: 'unrelated', ...capture() });
    assert.deepEqual(
      observed.map((e) => e.kind),
      ['strict_router_decision'],
    );
    assert.equal(observed[0].matched, false);
    assert.equal(observed[0].workflowKind, null);
    assert.equal(observed[0].fellBackToOpen, true);
  });

  it('computes router latencyMs from the injected now clock deterministically', async () => {
    const observed = [];
    let tick = 1000;
    const dispatcher = createWorkflowDispatcher({
      registry: fakeRegistry(plannedWorkflow),
      buildClient: () => ({}),
      now: () => {
        const value = tick;
        tick += 25;
        return value;
      },
      observe: (e) => observed.push(e),
    });
    await dispatcher.routeTurn({ prompt: 'Create an album for my recent trip to USA', ...capture() });
    const decision = observed.find((e) => e.kind === 'strict_router_decision');
    assert.equal(decision.latencyMs, 25);
  });

  it('emits a success-gate block when planId is missing', async () => {
    const observed = [];
    const wf = {
      ...plannedWorkflow,
      run: async () => ({ status: 'planned', planId: undefined, successSummary: {} }),
    };
    const dispatcher = createWorkflowDispatcher({
      registry: fakeRegistry(wf),
      buildClient: () => ({}),
      observe: (e) => observed.push(e),
    });
    const sink = capture();
    await dispatcher.routeTurn({ prompt: 'Create an album for my recent trip to USA', ...sink });
    assert.ok(observed.some((e) => e.kind === 'strict_success_gate_block'));
    // The gate also keeps success language out of the user-facing copy.
    assert.doesNotMatch(sink.events.at(-1).content.blocks[0].text, /created|ready|proposed/i);
  });

  it('emits a continuation event when a stored continuation expires', async () => {
    const observed = [];
    const workflow = {
      kind: 'create_recent_trip_album',
      flow: 'strict',
      match: () => undefined,
      parseSlots: (s) => s,
      resumeContinuation: () => ({ status: 'expired', text: 'Those choices expired. Please rerun.' }),
      run: async () => ({ status: 'planned' }),
    };
    const sink = capture();
    sink.setPending({ workflowKind: 'create_recent_trip_album', kind: 'selection', continuation: {} });
    const dispatcher = createWorkflowDispatcher({
      registry: fakeRegistry(workflow),
      buildClient: () => ({}),
      observe: (e) => observed.push(e),
    });
    await dispatcher.routeTurn({ prompt: 'first', ...sink });
    const continuation = observed.find((e) => e.kind === 'strict_continuation');
    assert.ok(continuation);
    assert.equal(continuation.resumed, false);
    assert.equal(continuation.expired, true);
    assert.equal(continuation.missing, false);
  });

  it('emits a resumed continuation outcome when a stored continuation matches', async () => {
    const observed = [];
    const workflow = {
      kind: 'create_recent_trip_album',
      flow: 'strict',
      match: () => undefined,
      parseSlots: (s) => s,
      resumeContinuation: () => ({ status: 'matched', ctx: { slots: { albumName: 'X' }, candidate: { dedupeKey: 'x' } } }),
      run: async () => ({ status: 'planned', text: 'ok', planId: 'p', successSummary: {} }),
    };
    const sink = capture();
    sink.setPending({ workflowKind: 'create_recent_trip_album', kind: 'selection', continuation: { candidates: [] } });
    const dispatcher = createWorkflowDispatcher({
      registry: fakeRegistry(workflow),
      buildClient: () => ({}),
      observe: (e) => observed.push(e),
    });
    await dispatcher.routeTurn({ prompt: 'the first one', ...sink });
    assert.deepEqual(
      observed.map((e) => e.kind),
      ['strict_continuation', 'strict_workflow_outcome'],
    );
    assert.equal(observed[0].resumed, true);
    assert.equal(observed[1].status, 'planned');
  });

  it('emits an outcome event for an approval resume turn', async () => {
    const observed = [];
    const workflow = {
      kind: 'create_recent_trip_album',
      flow: 'strict',
      resumeApproval: async ({ approvedPlanResult }) => ({
        status: 'planned',
        text: 'Review the plan.',
        planId: approvedPlanResult.planId,
        successSummary: {},
      }),
    };
    const sink = capture();
    sink.setPending({
      workflowKind: 'create_recent_trip_album',
      kind: 'approval',
      toolCallId: 'tc-1',
      slots: {},
      candidate: {},
    });
    const dispatcher = createWorkflowDispatcher({
      registry: fakeRegistry(workflow),
      buildClient: () => ({}),
      observe: (e) => observed.push(e),
    });
    await dispatcher.routeApproval({
      toolCallId: 'tc-1',
      approvalDecision: 'approved',
      toolResult: { planId: 'p-9' },
      ...sink,
    });
    const outcome = observed.find((e) => e.kind === 'strict_workflow_outcome');
    assert.ok(outcome);
    assert.equal(outcome.status, 'planned');
    assert.equal(outcome.planId, 'p-9');
  });

  it('emits generic denial copy without calling the workflow on a denied approval', async () => {
    let resumed = false;
    const workflow = {
      kind: 'create_recent_trip_album',
      flow: 'strict',
      resumeApproval: async () => {
        resumed = true;
        return { status: 'planned' };
      },
    };
    const sink = capture();
    sink.setPending({
      workflowKind: 'create_recent_trip_album',
      kind: 'approval',
      toolCallId: 'tc-1',
      slots: {},
      candidate: {},
    });
    const dispatcher = createWorkflowDispatcher({ registry: fakeRegistry(workflow), buildClient: () => ({}) });
    await dispatcher.routeApproval({ toolCallId: 'tc-1', approvalDecision: 'denied', ...sink });
    assert.equal(resumed, false);
    assert.match(sink.events.at(-1).content.blocks[0].text, /denied/i);
    assert.equal(sink.pending, undefined);
  });
});

// ---------------------------------------------------------------------------
// Chatter pre-filter (Slice 5)
// ---------------------------------------------------------------------------

const makeSpyRegistry = () => {
  let classifyCalls = 0;
  const registry = {
    classify: async () => {
      classifyCalls++;
      return { kind: 'none', via: 'regex' };
    },
    getWorkflow: () => undefined,
  };
  return { registry, getClassifyCalls: () => classifyCalls };
};

describe('chatter pre-filter', () => {
  const chatterCases = [
    'thanks',
    'thanks, that looks great!',
    'ok cool',
    "that's perfect, thank you",
    'awesome',
    'got it',
    'hello',
    'hey there',
    'good morning',
  ];

  for (const prompt of chatterCases) {
    it(`handles chatter "${prompt}" — no classify, completedEvent, decision via:chatter`, async () => {
      const { registry, getClassifyCalls } = makeSpyRegistry();
      const observed = [];
      const dispatcher = createWorkflowDispatcher({
        registry,
        buildClient: () => ({}),
        observe: (e) => observed.push(e),
      });
      const sink = capture();

      const result = await dispatcher.routeTurn({ prompt, ...sink });

      assert.equal(result.handled, true, 'routeTurn must return { handled: true }');
      assert.equal(getClassifyCalls(), 0, 'classify must NOT be called for chatter');

      const completed = sink.events.find((e) => e.type === 'assistant-message-completed');
      assert.ok(completed, 'completedEvent must be emitted');
      const replyText = completed.content.blocks[0].text;
      assert.ok(replyText && replyText.length > 0, 'reply text must be non-empty');

      const decision = observed.find((e) => e.kind === 'strict_router_decision');
      assert.ok(decision, 'strict_router_decision must be observed');
      assert.equal(decision.matched, false, 'decision.matched must be false');
      assert.equal(decision.via, 'chatter', 'decision.via must be "chatter"');
      assert.equal(decision.fellBackToOpen, false, 'decision.fellBackToOpen must be false');
    });
  }

  const nonChatterCases = [
    'how many photos do I have?',
    'find my Sony photos from May',
    'archive my newest 20',
    'trash my screenshots',
    'show me the good ones',
    'thanks for nothing, now delete everything',
    'can you make an album?',
    'thanks for the album, add 5 more',
  ];

  for (const prompt of nonChatterCases) {
    it(`passes non-chatter "${prompt}" through to classify`, async () => {
      const { registry, getClassifyCalls } = makeSpyRegistry();
      const dispatcher = createWorkflowDispatcher({
        registry,
        buildClient: () => ({}),
      });
      const sink = capture();

      await dispatcher.routeTurn({ prompt, ...sink });

      assert.ok(getClassifyCalls() > 0, 'classify MUST be called for non-chatter prompts');
    });
  }
});
