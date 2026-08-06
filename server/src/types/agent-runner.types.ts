import type { AgentApprovalMode, AgentPermissionPreset } from 'src/enum';
import type { AgentMessageContent } from 'src/types/agent-message.types';
import type { AgentCredentialSnapshot, AgentPermissionPlanSnapshot } from 'src/types/agent-session.types';

export type AgentRunnerCredentialMaterial = AgentCredentialSnapshot & {
  secret: string;
};

type AgentRunnerCreateSessionBase = {
  gallerySessionId: string;
  credential: AgentRunnerCredentialMaterial;
  model: string;
  permissionPreset: AgentPermissionPreset;
  permissionPlan: AgentPermissionPlanSnapshot;
  approvalMode: AgentApprovalMode;
  initialContext: Record<string, unknown>;
};

export type AgentRunnerMcpGateway = { url: string; token: string };

export type AgentRunnerCreateSessionRequest = AgentRunnerCreateSessionBase & {
  mcpGateway?: AgentRunnerMcpGateway | null;
};

export type AgentRunnerCreateSessionInput = AgentRunnerCreateSessionBase & {
  userId: string;
};

export type AgentRunnerCreateSessionResult = {
  runnerSessionId: string;
  capabilities: Record<string, unknown>;
};

export type AgentRunnerValidateSessionResult = {
  ok: true;
  capabilities: Record<string, unknown>;
};

export type AgentRunnerMessageRequest = {
  gallerySessionId: string;
  messageId: string;
  content: AgentMessageContent;
  workflowState?: object | null;
};

export type AgentRunnerResumeRequest = {
  gallerySessionId: string;
  toolCallId?: string;
  approvalDecision?: 'approved' | 'denied';
  toolResult?: unknown;
  workflowState?: object | null;
};

export type AgentRunnerActivityKind =
  | 'start-processing'
  | 'plan-composing'
  | 'apply-progress'
  | 'runner-recovery'
  // Strict/hybrid workflow observability (Slice 6): debug/audit-only events from
  // the runner's strict dispatcher. Not user chat; never enter the transcript.
  | 'strict_router_decision'
  | 'strict_workflow_outcome'
  | 'strict_success_gate_block'
  | 'strict_continuation'
  | 'unknown';

export type AgentRunnerActivityStatus = 'running' | 'completed' | 'failed' | 'skipped';

export type AgentRunnerActivityCounts = Partial<Record<'total' | 'applied' | 'skipped' | 'failed', number>>;

export type AgentRunnerActivityStreamEvent = {
  type: 'activity';
  sessionId: string;
  runnerSessionId: string;
  kind: AgentRunnerActivityKind;
  status: AgentRunnerActivityStatus;
  summary?: string;
  counts?: AgentRunnerActivityCounts;
};

export type AgentRunnerStreamEvent =
  | {
      type: 'assistant-message-delta';
      sessionId: string;
      runnerSessionId: string;
      delta: string;
      sequence: number;
    }
  | {
      type: 'assistant-message-completed';
      sessionId: string;
      runnerSessionId: string;
      providerMessageId: string | null;
      content: AgentMessageContent;
    }
  | {
      type: 'tool-approval-needed';
      sessionId: string;
      runnerSessionId: string;
      toolCallId: string;
    }
  | {
      type: 'runner-error';
      sessionId: string;
      runnerSessionId: string;
      message: string;
    }
  | {
      type: 'workflow-state-update';
      sessionId: string;
      runnerSessionId: string;
      workflowState: object | null;
    }
  | AgentRunnerActivityStreamEvent;
