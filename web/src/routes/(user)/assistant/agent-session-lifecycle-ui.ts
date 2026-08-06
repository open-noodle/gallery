import { AgentSessionStatus } from '@immich/sdk';
import type { Translations } from 'svelte-i18n';

export type AgentSessionComposerState = {
  disabled: boolean;
  disabledReasonKey: Translations | null;
  placeholderKey: Translations;
  submitLabelKey: Translations;
  terminalActionLabelKey: Translations | null;
};

type AgentSessionComposerStateOptions = {
  pendingApprovalCount: number;
};

const cancellableStatuses = new Set<AgentSessionStatus>([
  AgentSessionStatus.Created,
  AgentSessionStatus.Running,
  AgentSessionStatus.WaitingForToolApproval,
  AgentSessionStatus.WaitingForPlanReview,
  AgentSessionStatus.Interrupted,
]);

const terminalStatuses = new Set<AgentSessionStatus>([
  AgentSessionStatus.Completed,
  AgentSessionStatus.Cancelled,
  AgentSessionStatus.Failed,
]);

const enabledSendState: AgentSessionComposerState = {
  disabled: false,
  disabledReasonKey: null,
  placeholderKey: 'assistant_message_placeholder',
  submitLabelKey: 'assistant_send',
  terminalActionLabelKey: null,
};

export const isAgentSessionCancellable = (status: AgentSessionStatus) => cancellableStatuses.has(status);

export const isAgentSessionTerminal = (status: AgentSessionStatus) => terminalStatuses.has(status);

export const getAgentSessionComposerState = (
  status: AgentSessionStatus,
  { pendingApprovalCount }: AgentSessionComposerStateOptions,
): AgentSessionComposerState => {
  switch (status) {
    case AgentSessionStatus.Created:
    case AgentSessionStatus.Running: {
      return enabledSendState;
    }

    case AgentSessionStatus.WaitingForToolApproval: {
      if (pendingApprovalCount > 0) {
        return {
          ...enabledSendState,
          disabled: true,
          disabledReasonKey: 'assistant_approval_review_pending',
        };
      }

      return enabledSendState;
    }

    case AgentSessionStatus.WaitingForPlanReview: {
      return {
        ...enabledSendState,
        placeholderKey: 'assistant_message_plan_review_placeholder',
      };
    }

    case AgentSessionStatus.Interrupted: {
      return {
        ...enabledSendState,
        placeholderKey: 'assistant_message_resume_placeholder',
        submitLabelKey: 'assistant_resume',
      };
    }

    case AgentSessionStatus.Applying: {
      return {
        disabled: true,
        disabledReasonKey: 'assistant_message_disabled_applying',
        placeholderKey: 'assistant_message_disabled_placeholder',
        submitLabelKey: 'assistant_send',
        terminalActionLabelKey: null,
      };
    }

    case AgentSessionStatus.Completed:
    case AgentSessionStatus.Cancelled:
    case AgentSessionStatus.Failed: {
      return {
        disabled: true,
        disabledReasonKey: 'assistant_message_disabled_terminal',
        placeholderKey: 'assistant_message_disabled_placeholder',
        submitLabelKey: 'assistant_send',
        terminalActionLabelKey: 'assistant_start_new_chat',
      };
    }

    default: {
      return {
        disabled: true,
        disabledReasonKey: 'assistant_message_disabled_unavailable',
        placeholderKey: 'assistant_message_disabled_placeholder',
        submitLabelKey: 'assistant_send',
        terminalActionLabelKey: null,
      };
    }
  }
};
