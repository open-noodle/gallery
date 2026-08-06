import {
  AgentSessionActivityEventCreateDto,
  AgentSessionActivityEventResponseDto,
} from 'src/dtos/agent-session-activity-event.dto';
import {
  AgentSessionActivityEventKind,
  AgentSessionActivityEventSource,
  AgentSessionActivityEventStatus,
} from 'src/enum';
import { factory } from 'test/small.factory';

describe('AgentSessionActivityEventCreateDto', () => {
  const input = {
    kind: AgentSessionActivityEventKind.ApplyProgress,
    status: AgentSessionActivityEventStatus.Running,
    source: AgentSessionActivityEventSource.Runner,
    summary: 'Applied 2 of 5 changes',
    counts: {
      total: 5,
      applied: 2,
      skipped: 1,
      failed: 0,
    },
  };

  it('accepts compact safe activity events', () => {
    expect(AgentSessionActivityEventCreateDto.schema.safeParse(input)).toMatchObject({ success: true });
  });

  it('rejects unknown top-level and count keys', () => {
    expect(
      AgentSessionActivityEventCreateDto.schema.safeParse({ ...input, raw: { assetIds: [factory.uuid()] } }),
    ).toMatchObject({
      success: false,
    });

    expect(
      AgentSessionActivityEventCreateDto.schema.safeParse({
        ...input,
        counts: { ...input.counts, assetIds: 1 },
      }),
    ).toMatchObject({ success: false });
  });

  it.each([{ total: -1 }, { total: 1.5 }, { total: 10_001 }])('rejects invalid counts %o', (counts) => {
    expect(AgentSessionActivityEventCreateDto.schema.safeParse({ ...input, counts })).toMatchObject({ success: false });
  });

  it('normalizes unknown runner kinds to unknown', () => {
    const result = AgentSessionActivityEventCreateDto.schema.parse({
      ...input,
      kind: 'future-kind',
      summary: 'Runner is doing something new',
    });

    expect(result.kind).toBe(AgentSessionActivityEventKind.Unknown);
    expect(result.summary).toBe('Runner is doing something new');
  });
});

describe('AgentSessionActivityEventResponseDto', () => {
  it('serializes persisted events without unsafe payloads', () => {
    const createdAt = new Date('2026-05-18T10:30:00.000Z');

    expect(
      AgentSessionActivityEventResponseDto.schema.parse({
        id: factory.uuid(),
        sessionId: factory.uuid(),
        kind: AgentSessionActivityEventKind.StartProcessing,
        status: AgentSessionActivityEventStatus.Running,
        source: AgentSessionActivityEventSource.Server,
        summary: null,
        counts: null,
        createdAt: createdAt.toISOString(),
      }),
    ).toMatchObject({ createdAt });
  });
});
