import {
  AgentMessageRole,
  type AgentMessageResponseDto,
  type AgentSessionActivityEventResponseDto,
  type AgentToolCallResponseDto,
} from '@immich/sdk';

export type AgentActivityEvent = AgentSessionActivityEventResponseDto;

export type UserTurnAnchor = {
  message: AgentMessageResponseDto;
  startAt: string;
  nextUserAt: string | null;
  terminalAssistantAt: string | null;
  isLatest: boolean;
};

const isValidActivityDate = (value: string | null | undefined): value is string =>
  typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value));

const compareByDateThenId = <T extends { id: string }>(
  getDate: (value: T) => string,
  getPriority?: (value: T) => number,
) => {
  return (first: T, second: T) =>
    getDate(first).localeCompare(getDate(second)) ||
    (getPriority?.(first) ?? 0) - (getPriority?.(second) ?? 0) ||
    first.id.localeCompare(second.id);
};

const sortedBy = <T>(values: T[], compare: (first: T, second: T) => number) => [...values].sort(compare);

const getToolCallActivityAt = (toolCall: AgentToolCallResponseDto) => {
  if (isValidActivityDate(toolCall.startedAt)) {
    return toolCall.startedAt;
  }

  return isValidActivityDate(toolCall.completedAt) ? toolCall.completedAt : null;
};

const getEventActivityAt = (event: AgentActivityEvent) =>
  isValidActivityDate(event.createdAt) ? event.createdAt : null;

const isAtOrAfter = (value: string, boundary: string) => value >= boundary;

const isBefore = (value: string, boundary: string | null) => boundary === null || value < boundary;

export const buildStableTurnAnchors = (messages: AgentMessageResponseDto[]) => {
  const validUserMessages = sortedBy(
    messages.filter((message) => message.role === AgentMessageRole.User && isValidActivityDate(message.createdAt)),
    compareByDateThenId((message) => message.createdAt),
  );
  const validAssistantMessages = sortedBy(
    messages.filter((message) => message.role === AgentMessageRole.Assistant && isValidActivityDate(message.createdAt)),
    compareByDateThenId((message) => message.createdAt),
  );

  return validUserMessages.map((message, index): UserTurnAnchor => {
    const nextUser = validUserMessages[index + 1] ?? null;
    const terminalAssistant =
      validAssistantMessages.find(
        (assistantMessage) =>
          isAtOrAfter(assistantMessage.createdAt, message.createdAt) &&
          isBefore(assistantMessage.createdAt, nextUser?.createdAt ?? null),
      ) ?? null;

    return {
      message,
      startAt: message.createdAt,
      nextUserAt: nextUser?.createdAt ?? null,
      terminalAssistantAt: terminalAssistant?.createdAt ?? null,
      isLatest: index === validUserMessages.length - 1,
    };
  });
};

export const toolCallBelongsToTurn = (
  toolCall: AgentToolCallResponseDto,
  turn: UserTurnAnchor,
  userTurnCount: number,
) => {
  const activityAt = getToolCallActivityAt(toolCall);

  if (!activityAt) {
    return userTurnCount === 1;
  }

  const turnEnd = turn.terminalAssistantAt ?? turn.nextUserAt;

  return isAtOrAfter(activityAt, turn.startAt) && isBefore(activityAt, turnEnd);
};

export const activityEventBelongsToTurn = (event: AgentActivityEvent, turn: UserTurnAnchor) => {
  const activityAt = getEventActivityAt(event);

  if (!activityAt) {
    return false;
  }

  const turnEnd = turn.terminalAssistantAt ?? turn.nextUserAt;

  return isAtOrAfter(activityAt, turn.startAt) && isBefore(activityAt, turnEnd);
};
