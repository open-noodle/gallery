import { AgentSessionStatus } from '@immich/sdk';
import {
  getAgentSessionComposerState,
  isAgentSessionCancellable,
  isAgentSessionTerminal,
} from './agent-session-lifecycle-ui';

describe('agent session lifecycle UI helpers', () => {
  it.each([
    AgentSessionStatus.Created,
    AgentSessionStatus.Running,
    AgentSessionStatus.WaitingForToolApproval,
    AgentSessionStatus.WaitingForPlanReview,
    AgentSessionStatus.Interrupted,
  ])('marks %s sessions as cancellable', (status) => {
    expect(isAgentSessionCancellable(status)).toBe(true);
  });

  it.each([
    AgentSessionStatus.Applying,
    AgentSessionStatus.Completed,
    AgentSessionStatus.Cancelled,
    AgentSessionStatus.Failed,
  ])('does not mark %s sessions as cancellable', (status) => {
    expect(isAgentSessionCancellable(status)).toBe(false);
  });

  it.each([AgentSessionStatus.Completed, AgentSessionStatus.Cancelled, AgentSessionStatus.Failed])(
    'marks %s sessions as terminal',
    (status) => {
      expect(isAgentSessionTerminal(status)).toBe(true);
    },
  );

  it('returns enabled send state for created and running sessions', () => {
    expect(getAgentSessionComposerState(AgentSessionStatus.Created, { pendingApprovalCount: 0 })).toMatchObject({
      disabled: false,
      placeholderKey: 'assistant_message_placeholder',
      submitLabelKey: 'assistant_send',
      terminalActionLabelKey: null,
    });
    expect(getAgentSessionComposerState(AgentSessionStatus.Running, { pendingApprovalCount: 0 })).toMatchObject({
      disabled: false,
      placeholderKey: 'assistant_message_placeholder',
      submitLabelKey: 'assistant_send',
      terminalActionLabelKey: null,
    });
  });

  it('blocks waiting-for-tool-approval sessions only while approvals are pending', () => {
    expect(
      getAgentSessionComposerState(AgentSessionStatus.WaitingForToolApproval, { pendingApprovalCount: 1 }),
    ).toMatchObject({
      disabled: true,
      disabledReasonKey: 'assistant_approval_review_pending',
      terminalActionLabelKey: null,
    });

    expect(
      getAgentSessionComposerState(AgentSessionStatus.WaitingForToolApproval, { pendingApprovalCount: 0 }),
    ).toMatchObject({
      disabled: false,
      disabledReasonKey: null,
      submitLabelKey: 'assistant_send',
    });
  });

  it('keeps waiting-for-plan-review sessions enabled for revision feedback', () => {
    expect(getAgentSessionComposerState(AgentSessionStatus.WaitingForPlanReview, { pendingApprovalCount: 0 })).toEqual({
      disabled: false,
      disabledReasonKey: null,
      placeholderKey: 'assistant_message_plan_review_placeholder',
      submitLabelKey: 'assistant_send',
      terminalActionLabelKey: null,
    });
  });

  it('uses resume copy for interrupted sessions', () => {
    expect(getAgentSessionComposerState(AgentSessionStatus.Interrupted, { pendingApprovalCount: 0 })).toMatchObject({
      disabled: false,
      placeholderKey: 'assistant_message_resume_placeholder',
      submitLabelKey: 'assistant_resume',
    });
  });

  it('disables applying sessions without terminal action metadata', () => {
    expect(getAgentSessionComposerState(AgentSessionStatus.Applying, { pendingApprovalCount: 0 })).toEqual({
      disabled: true,
      disabledReasonKey: 'assistant_message_disabled_applying',
      placeholderKey: 'assistant_message_disabled_placeholder',
      submitLabelKey: 'assistant_send',
      terminalActionLabelKey: null,
    });
  });

  it.each([AgentSessionStatus.Completed, AgentSessionStatus.Cancelled, AgentSessionStatus.Failed])(
    'returns start-new-chat metadata for terminal %s sessions',
    (status) => {
      expect(getAgentSessionComposerState(status, { pendingApprovalCount: 0 })).toEqual({
        disabled: true,
        disabledReasonKey: 'assistant_message_disabled_terminal',
        placeholderKey: 'assistant_message_disabled_placeholder',
        submitLabelKey: 'assistant_send',
        terminalActionLabelKey: 'assistant_start_new_chat',
      });
    },
  );

  it('falls back to safe disabled copy for unknown future statuses', () => {
    expect(getAgentSessionComposerState('paused' as AgentSessionStatus, { pendingApprovalCount: 0 })).toEqual({
      disabled: true,
      disabledReasonKey: 'assistant_message_disabled_unavailable',
      placeholderKey: 'assistant_message_disabled_placeholder',
      submitLabelKey: 'assistant_send',
      terminalActionLabelKey: null,
    });
    expect(isAgentSessionCancellable('paused' as AgentSessionStatus)).toBe(false);
    expect(isAgentSessionTerminal('paused' as AgentSessionStatus)).toBe(false);
  });
});
