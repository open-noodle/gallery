import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { readable } from 'svelte/store';
import type { AgentTurnTimeline, AgentTurnTimelineRow } from './agent-turn-timeline-ui';
import AgentTurnTimelineComponent from './agent-turn-timeline.svelte';

vi.mock('svelte-i18n', () => {
  const messages: Record<string, string> = {
    assistant_timeline_understanding: 'Understanding request…',
    assistant_timeline_thinking: 'Thinking…',
    assistant_timeline_verb_searching: 'Searching photos…',
    assistant_timeline_verb_filtering: 'Interpreting filters…',
    assistant_timeline_steps_one: '1 step',
    assistant_timeline_steps: '{steps} steps',
    assistant_timeline_failed_count: '{count} failed',
    assistant_timeline_cancelled: 'cancelled',
    assistant_timeline_denied: 'denied',
    assistant_timeline_router_matched: 'Matched workflow {workflow} via {via}',
    assistant_timeline_router_none: 'No workflow matched (via {via})',
  };

  return {
    t: readable((key: string, options?: { values?: Record<string, string | number> }) => {
      let message = messages[key] ?? key;

      for (const [name, value] of Object.entries(options?.values ?? {})) {
        message = message.replaceAll(`{${name}}`, String(value));
      }

      return message;
    }),
  };
});

const makeRow = (overrides: Partial<AgentTurnTimelineRow> = {}): AgentTurnTimelineRow => ({
  id: overrides.id ?? 'row-1',
  toolName: overrides.toolName ?? 'searchAssets',
  state: overrides.state ?? 'completed',
  summaryText: overrides.summaryText ?? 'Found photos',
  durationMs: overrides.durationMs ?? 2300,
  detail: {
    requestSummary: 'Search for photos',
    responseSummary: 'Found photos',
    assetCount: 5,
    albumCount: 0,
    resultSize: null,
    error: null,
    startedAt: '2026-05-18T10:00:05.000Z',
    completedAt: '2026-05-18T10:00:07.300Z',
    ...overrides.detail,
  },
});

const makeTimeline = (overrides: Partial<AgentTurnTimeline> = {}): AgentTurnTimeline => ({
  anchorMessageId: 'user-1',
  state: 'running',
  oneLiner: { kind: 'key', key: 'assistant_timeline_verb_searching' },
  summary: null,
  routerAnnotation: null,
  rows: [],
  ...overrides,
});

describe('AgentTurnTimeline', () => {
  it('running + key one-liner: shows translated key text, collapsed (no rows)', () => {
    render(AgentTurnTimelineComponent, {
      props: {
        timeline: makeTimeline({
          state: 'running',
          oneLiner: { kind: 'key', key: 'assistant_timeline_verb_searching' },
          rows: [],
        }),
      },
    });

    expect(screen.getByText('Searching photos…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'searchAssets' })).not.toBeInTheDocument();
  });

  it('running + raw one-liner: shows raw tool name', () => {
    render(AgentTurnTimelineComponent, {
      props: {
        timeline: makeTimeline({
          state: 'running',
          oneLiner: { kind: 'raw', toolName: 'someNewTool' },
          rows: [],
        }),
      },
    });

    expect(screen.getByText('someNewTool')).toBeInTheDocument();
  });

  it('click one-liner → rows render, aria-expanded becomes true', async () => {
    const user = userEvent.setup();

    render(AgentTurnTimelineComponent, {
      props: {
        timeline: makeTimeline({
          state: 'running',
          oneLiner: { kind: 'key', key: 'assistant_timeline_verb_searching' },
          rows: [makeRow({ id: 'row-a', toolName: 'searchAssets' }), makeRow({ id: 'row-b', toolName: 'listAlbums' })],
        }),
      },
    });

    const oneLinerBtn = screen.getByRole('button', { name: /Searching photos/i });
    expect(oneLinerBtn).toHaveAttribute('aria-expanded', 'false');

    await user.click(oneLinerBtn);

    expect(oneLinerBtn).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'searchAssets' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'listAlbums' })).toBeInTheDocument();
  });

  it('settled summary: step count, duration, failed count red class when failedCount=1, absent when 0', () => {
    render(AgentTurnTimelineComponent, {
      props: {
        timeline: makeTimeline({
          state: 'settled',
          oneLiner: null,
          summary: { steps: 3, durationMs: 2300, failedCount: 1, cancelled: false },
          rows: [makeRow()],
        }),
      },
    });

    expect(screen.getByText(/3 steps/)).toBeInTheDocument();
    expect(screen.getByText(/2\.3s/)).toBeInTheDocument();
    const failedEl = screen.getByText(/1 failed/);
    expect(failedEl.className).toMatch(/red/);
  });

  it('settled summary: failedCount=0 has no failed count element', () => {
    render(AgentTurnTimelineComponent, {
      props: {
        timeline: makeTimeline({
          state: 'settled',
          oneLiner: null,
          summary: { steps: 2, durationMs: 2300, failedCount: 0, cancelled: false },
          rows: [makeRow()],
        }),
      },
    });

    expect(screen.queryByText(/failed/)).not.toBeInTheDocument();
  });

  it('cancelled summary shows "cancelled" text', () => {
    render(AgentTurnTimelineComponent, {
      props: {
        timeline: makeTimeline({
          state: 'settled',
          oneLiner: null,
          summary: { steps: 1, durationMs: null, failedCount: 0, cancelled: true },
          rows: [makeRow({ state: 'cancelled', durationMs: null })],
        }),
      },
    });

    expect(screen.getByText(/cancelled/)).toBeInTheDocument();
  });

  it('zero-row settled timeline renders nothing (E1)', () => {
    render(AgentTurnTimelineComponent, {
      props: {
        timeline: makeTimeline({
          state: 'settled',
          oneLiner: null,
          summary: null,
          rows: [],
        }),
      },
    });

    expect(screen.queryByTestId('agent-turn-timeline')).not.toBeInTheDocument();
  });

  it('router annotation: expanded shows matched route annotation; absent when routerAnnotation null (E11)', async () => {
    const user = userEvent.setup();

    render(AgentTurnTimelineComponent, {
      props: {
        timeline: makeTimeline({
          state: 'settled',
          oneLiner: null,
          summary: { steps: 1, durationMs: 1000, failedCount: 0, cancelled: false },
          routerAnnotation: { matched: true, workflow: 'create_album', via: 'regex' },
          rows: [makeRow()],
        }),
      },
    });

    const summaryBtn = screen.getByRole('button');
    await user.click(summaryBtn);

    expect(screen.getByText('Matched workflow create_album via regex')).toBeInTheDocument();
  });

  it('router annotation: absent when routerAnnotation is null', async () => {
    const user = userEvent.setup();

    render(AgentTurnTimelineComponent, {
      props: {
        timeline: makeTimeline({
          state: 'settled',
          oneLiner: null,
          summary: { steps: 1, durationMs: 1000, failedCount: 0, cancelled: false },
          routerAnnotation: null,
          rows: [makeRow()],
        }),
      },
    });

    await user.click(screen.getByRole('button'));

    expect(screen.queryByText(/Matched workflow/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No workflow matched/)).not.toBeInTheDocument();
  });
});
