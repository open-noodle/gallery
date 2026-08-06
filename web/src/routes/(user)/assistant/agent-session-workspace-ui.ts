import {
  AgentMessageRole,
  AgentMessageTextBlockType,
  AgentSessionStatus,
  type AgentMessageResponseDto,
  type AgentSessionResponseDto,
} from '@immich/sdk';
import type { Translations } from 'svelte-i18n';

export type AgentSessionTitleCache = Record<string, string | null | undefined>;
export type AgentSessionStatusBadgeTone = 'active' | 'attention' | 'danger' | 'muted' | 'success';

export type AgentSessionStatusBadge = {
  labelKey: Translations;
  tone: AgentSessionStatusBadgeTone;
};

export const ASSISTANT_SESSION_QUERY_PARAM = 'session';
const AGENT_SESSION_TITLE_MAX_LENGTH = 60;

const actionableStatuses = new Set<AgentSessionStatus>([
  AgentSessionStatus.WaitingForToolApproval,
  AgentSessionStatus.WaitingForPlanReview,
  AgentSessionStatus.Interrupted,
  AgentSessionStatus.Running,
  AgentSessionStatus.Applying,
]);

const statusBadgeTones: Partial<Record<AgentSessionStatus, AgentSessionStatusBadgeTone>> = {
  [AgentSessionStatus.WaitingForToolApproval]: 'attention',
  [AgentSessionStatus.WaitingForPlanReview]: 'attention',
  [AgentSessionStatus.Interrupted]: 'attention',
  [AgentSessionStatus.Running]: 'active',
  [AgentSessionStatus.Applying]: 'active',
  [AgentSessionStatus.Completed]: 'success',
  [AgentSessionStatus.Cancelled]: 'muted',
  [AgentSessionStatus.Failed]: 'danger',
};

const compareCreatedAtDescending = (left: AgentSessionResponseDto, right: AgentSessionResponseDto) =>
  Date.parse(right.createdAt) - Date.parse(left.createdAt);

const compareIdDescending = (left: AgentSessionResponseDto, right: AgentSessionResponseDto) =>
  right.id.localeCompare(left.id);

const compareSessionsByRecency = (left: AgentSessionResponseDto, right: AgentSessionResponseDto) =>
  compareCreatedAtDescending(left, right) || compareIdDescending(left, right);

const isActionableStatus = (status: AgentSessionStatus) => actionableStatuses.has(status);

export const getAgentSessionStatusLabelKey = (status: AgentSessionStatus) =>
  `assistant_session_status_${status}` as Translations;

export const getAgentSessionStatusBadge = (status: AgentSessionStatus): AgentSessionStatusBadge | null => {
  const tone = statusBadgeTones[status];

  if (!tone) {
    return null;
  }

  return {
    labelKey: getAgentSessionStatusLabelKey(status),
    tone,
  };
};

export const getAgentSessionTitle = (
  session: AgentSessionResponseDto,
  titleCache: AgentSessionTitleCache = {},
): string => {
  const savedTitle = session.title?.trim();
  if (savedTitle) {
    return savedTitle;
  }

  const title = titleCache[session.id]?.trim();
  return title || 'New chat';
};

export const deriveAgentSessionTitleFromMessages = (messages: AgentMessageResponseDto[]): string | null => {
  for (const message of messages) {
    if (message.role !== AgentMessageRole.User) {
      continue;
    }

    const title = message.content.blocks
      .filter((block) => block.type === AgentMessageTextBlockType.Text)
      .map((block) => block.text)
      .join(' ')
      .trim()
      .replaceAll(/\s+/g, ' ');

    if (!title) {
      continue;
    }

    if (title.length <= AGENT_SESSION_TITLE_MAX_LENGTH) {
      return title;
    }

    return `${title.slice(0, AGENT_SESSION_TITLE_MAX_LENGTH - 1)}…`;
  }

  return null;
};

export const sortAgentSessionsForSidebar = (sessions: AgentSessionResponseDto[]) =>
  [...sessions].sort(compareSessionsByRecency);

export const selectInitialAgentSessionId = (
  sessions: AgentSessionResponseDto[],
  requestedSessionId: string | null | undefined,
): string | null => {
  const normalizedRequestedSessionId = requestedSessionId?.trim();

  if (normalizedRequestedSessionId && sessions.some((session) => session.id === normalizedRequestedSessionId)) {
    return normalizedRequestedSessionId;
  }

  return null;
};

export const filterAgentSessionsForSidebar = (
  sessions: AgentSessionResponseDto[],
  query: string,
  titleCache: AgentSessionTitleCache = {},
  statusLabels: Partial<Record<AgentSessionStatus, string>> = {},
) => {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const sortedSessions = sortAgentSessionsForSidebar(sessions);

  if (!normalizedQuery) {
    return sortedSessions;
  }

  return sortedSessions.filter((session) => {
    const badge = getAgentSessionStatusBadge(session.status);
    const searchableParts = [
      getAgentSessionTitle(session, titleCache),
      session.credentialSnapshot.label,
      session.modelSnapshot.model,
      session.status,
      getAgentSessionStatusLabelKey(session.status),
      statusLabels[session.status],
      badge?.labelKey,
    ];

    return searchableParts.some((part) => part?.toLocaleLowerCase().includes(normalizedQuery));
  });
};

export const getNewestActionableAgentSessionId = (sessions: AgentSessionResponseDto[]) =>
  sortAgentSessionsForSidebar(sessions).find((session) => isActionableStatus(session.status))?.id ?? null;

export const getInitialSelectedSessionId = selectInitialAgentSessionId;
export const sortSessionsForSidebar = sortAgentSessionsForSidebar;
export const getSessionSidebarStatusLabelKey = getAgentSessionStatusLabelKey;
export const shouldShowSessionStatusBadge = (status: AgentSessionStatus) => getAgentSessionStatusBadge(status) !== null;
export const getSessionPreviewTitle = (sessionId: string, titleBySessionId: AgentSessionTitleCache = {}) =>
  titleBySessionId[sessionId]?.trim() || 'assistant_new_chat';
export const filterSidebarSessions = filterAgentSessionsForSidebar;
