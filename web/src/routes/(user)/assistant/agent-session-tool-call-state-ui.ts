import { AgentToolCallStatus, type AgentToolCallResponseDto } from '@immich/sdk';

const statusProgressRank: Record<AgentToolCallStatus, number> = {
  [AgentToolCallStatus.PendingApproval]: 0,
  [AgentToolCallStatus.Approved]: 1,
  [AgentToolCallStatus.Executing]: 2,
  [AgentToolCallStatus.Completed]: 3,
  [AgentToolCallStatus.Failed]: 3,
  [AgentToolCallStatus.Denied]: 3,
};

const getToolCallStateKey = (toolCall: AgentToolCallResponseDto) =>
  [
    toolCall.id,
    toolCall.sessionId,
    toolCall.toolName,
    toolCall.status,
    toolCall.startedAt,
    toolCall.completedAt ?? '',
    toolCall.requestSummary ?? '',
    toolCall.responseSummary ?? '',
    toolCall.error ?? '',
    toolCall.approvalDecision ?? '',
    toolCall.assetCount,
    toolCall.albumCount,
    toolCall.resultSize?.returnedItems ?? '',
    toolCall.resultSize?.hasMore ?? '',
    toolCall.resultSize?.nextPage ?? '',
    toolCall.resultSize?.estimatedBytes ?? '',
    toolCall.resultSize?.truncated ?? '',
    toolCall.resultSize?.omittedFields.join(',') ?? '',
  ].join('|');

const getToolCallActivityTime = (toolCall: AgentToolCallResponseDto) => toolCall.completedAt ?? toolCall.startedAt;

const compareToolCalls = (first: AgentToolCallResponseDto, second: AgentToolCallResponseDto) =>
  first.startedAt.localeCompare(second.startedAt) || first.id.localeCompare(second.id);

const getToolCallDetailScore = (toolCall: AgentToolCallResponseDto) =>
  [
    toolCall.requestSummary,
    toolCall.responseSummary,
    toolCall.error,
    toolCall.approvalDecision,
    toolCall.assetCount > 0 ? toolCall.assetCount : null,
    toolCall.albumCount > 0 ? toolCall.albumCount : null,
    toolCall.resultSize,
  ].filter(Boolean).length;

const chooseNewestToolCallState = (
  existing: AgentToolCallResponseDto,
  incoming: AgentToolCallResponseDto,
): AgentToolCallResponseDto => {
  const existingRank = statusProgressRank[existing.status] ?? 0;
  const incomingRank = statusProgressRank[incoming.status] ?? 0;

  if (incomingRank > existingRank) {
    return incoming;
  }

  if (incomingRank < existingRank) {
    return existing;
  }

  const incomingTime = getToolCallActivityTime(incoming);
  const existingTime = getToolCallActivityTime(existing);

  if (incomingTime > existingTime) {
    return incoming;
  }

  if (incomingTime < existingTime) {
    return existing;
  }

  return getToolCallDetailScore(incoming) > getToolCallDetailScore(existing) ? incoming : existing;
};

export const mergeAgentTimelineToolCalls = (
  previousToolCalls: AgentToolCallResponseDto[],
  incomingToolCalls: AgentToolCallResponseDto[],
  sessionId: string,
) => {
  const toolCallsById = new Map<string, AgentToolCallResponseDto>();

  for (const toolCall of previousToolCalls) {
    if (toolCall.sessionId === sessionId) {
      toolCallsById.set(toolCall.id, toolCall);
    }
  }

  for (const toolCall of incomingToolCalls) {
    if (toolCall.sessionId !== sessionId) {
      continue;
    }

    const existing = toolCallsById.get(toolCall.id);
    toolCallsById.set(toolCall.id, existing ? chooseNewestToolCallState(existing, toolCall) : toolCall);
  }

  return [...toolCallsById.values()].sort(compareToolCalls);
};

export const areAgentTimelineToolCallListsEquivalent = (
  firstToolCalls: AgentToolCallResponseDto[],
  secondToolCalls: AgentToolCallResponseDto[],
) =>
  firstToolCalls.length === secondToolCalls.length &&
  firstToolCalls.every(
    (toolCall, index) => getToolCallStateKey(toolCall) === getToolCallStateKey(secondToolCalls[index]),
  );
