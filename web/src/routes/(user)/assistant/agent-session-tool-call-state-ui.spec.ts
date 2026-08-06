import { AgentToolCallStatus, AgentToolDataClass, AgentToolName, type AgentToolCallResponseDto } from '@immich/sdk';
import {
  areAgentTimelineToolCallListsEquivalent,
  mergeAgentTimelineToolCalls,
} from './agent-session-tool-call-state-ui';

const makeToolCall = (overrides: Partial<AgentToolCallResponseDto> = {}): AgentToolCallResponseDto => ({
  id: overrides.id ?? 'tool-call-1',
  sessionId: overrides.sessionId ?? 'session-1',
  toolName: overrides.toolName ?? AgentToolName.SearchAssets,
  status: overrides.status ?? AgentToolCallStatus.Executing,
  approvalDecision: overrides.approvalDecision ?? null,
  requestSummary: overrides.requestSummary ?? 'Search photos',
  responseSummary: Object.hasOwn(overrides, 'responseSummary') ? overrides.responseSummary! : null,
  dataClass: overrides.dataClass ?? AgentToolDataClass.Metadata,
  assetCount: overrides.assetCount ?? 0,
  albumCount: overrides.albumCount ?? 0,
  startedAt: overrides.startedAt ?? '2026-05-16T10:00:05.000Z',
  completedAt: Object.hasOwn(overrides, 'completedAt') ? overrides.completedAt! : null,
  error: Object.hasOwn(overrides, 'error') ? overrides.error! : null,
  resultSize: overrides.resultSize,
});

describe('agent session tool-call timeline state', () => {
  it('keeps previous session tool calls out of the next session', () => {
    const previous = [
      makeToolCall({ id: 'old-session-tool', sessionId: 'session-1', status: AgentToolCallStatus.Completed }),
    ];
    const incoming = [makeToolCall({ id: 'new-session-tool', sessionId: 'session-2' })];

    expect(mergeAgentTimelineToolCalls(previous, incoming, 'session-2').map((toolCall) => toolCall.id)).toEqual([
      'new-session-tool',
    ]);
  });

  it('preserves terminal state when an older running refresh arrives later', () => {
    const completed = makeToolCall({
      status: AgentToolCallStatus.Completed,
      responseSummary: 'Returned 4 photos',
      completedAt: '2026-05-16T10:01:00.000Z',
    });
    const staleExecuting = makeToolCall({
      status: AgentToolCallStatus.Executing,
      responseSummary: null,
      completedAt: null,
    });

    expect(mergeAgentTimelineToolCalls([completed], [staleExecuting], 'session-1')).toEqual([completed]);
  });

  it('updates an existing row when status advances', () => {
    const executing = makeToolCall({ status: AgentToolCallStatus.Executing, completedAt: null });
    const completed = makeToolCall({
      status: AgentToolCallStatus.Completed,
      responseSummary: 'Returned 4 photos',
      completedAt: '2026-05-16T10:01:00.000Z',
    });

    expect(mergeAgentTimelineToolCalls([executing], [completed], 'session-1')).toEqual([completed]);
  });

  it('preserves richer terminal data when a same-time terminal refresh is missing details', () => {
    const completed = makeToolCall({
      status: AgentToolCallStatus.Completed,
      responseSummary: 'Returned 4 photos',
      assetCount: 4,
      albumCount: 1,
      completedAt: '2026-05-16T10:01:00.000Z',
      resultSize: {
        returnedItems: 4,
        hasMore: false,
        nextPage: null,
        estimatedBytes: 4096,
        truncated: false,
        omittedFields: [],
      },
    });
    const staleCompleted = makeToolCall({
      status: AgentToolCallStatus.Completed,
      responseSummary: null,
      assetCount: 0,
      albumCount: 0,
      completedAt: '2026-05-16T10:01:00.000Z',
      resultSize: undefined,
    });

    expect(mergeAgentTimelineToolCalls([completed], [staleCompleted], 'session-1')).toEqual([completed]);
  });

  it('keeps known calls when a refresh temporarily omits them', () => {
    const known = [
      makeToolCall({ id: 'tool-a', status: AgentToolCallStatus.Completed, completedAt: '2026-05-16T10:00:10.000Z' }),
      makeToolCall({ id: 'tool-b', status: AgentToolCallStatus.Executing, startedAt: '2026-05-16T10:00:20.000Z' }),
    ];

    expect(mergeAgentTimelineToolCalls(known, [], 'session-1').map((toolCall) => toolCall.id)).toEqual([
      'tool-a',
      'tool-b',
    ]);
  });

  it('sorts merged calls deterministically by started time then id', () => {
    const merged = mergeAgentTimelineToolCalls(
      [makeToolCall({ id: 'tool-b', startedAt: '2026-05-16T10:00:00.000Z' })],
      [makeToolCall({ id: 'tool-a', startedAt: '2026-05-16T10:00:00.000Z' })],
      'session-1',
    );

    expect(merged.map((toolCall) => toolCall.id)).toEqual(['tool-a', 'tool-b']);
  });

  it('detects equivalent tool-call state lists', () => {
    const calls = [makeToolCall({ status: AgentToolCallStatus.Completed, completedAt: '2026-05-16T10:01:00.000Z' })];

    expect(areAgentTimelineToolCallListsEquivalent(calls, [...calls])).toBe(true);
    expect(
      areAgentTimelineToolCallListsEquivalent(calls, [
        makeToolCall({ status: AgentToolCallStatus.Executing, completedAt: null }),
      ]),
    ).toBe(false);
  });
});
