import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { readable } from 'svelte/store';
import AgentTurnTimelineRowComponent from './agent-turn-timeline-row.svelte';
import type { AgentTurnTimelineRow } from './agent-turn-timeline-ui';

vi.mock('svelte-i18n', () => {
  const messages: Record<string, string> = {
    assistant_timeline_denied: 'denied',
    assistant_timeline_cancelled: 'cancelled',
    assistant_timeline_request: 'Request',
    assistant_timeline_response: 'Response',
    assistant_timeline_error: 'Error',
  };

  return {
    t: readable((key: string) => messages[key] ?? key),
  };
});

const makeRow = (overrides: Partial<AgentTurnTimelineRow> = {}): AgentTurnTimelineRow => ({
  id: 'row-1',
  toolName: 'searchAssets',
  state: 'completed',
  summaryText: 'Found 5 matching photos',
  durationMs: 2300,
  detail: {
    requestSummary: 'Search for beach photos',
    responseSummary: 'Found 5 matching photos',
    assetCount: 5,
    albumCount: 0,
    resultSize: null,
    error: null,
    startedAt: '2026-05-18T10:00:05.000Z',
    completedAt: '2026-05-18T10:00:07.300Z',
  },
  ...overrides,
});

describe('AgentTurnTimelineRow', () => {
  it('completed row: green dot, toolName, summaryText, duration, aria-expanded false', () => {
    render(AgentTurnTimelineRowComponent, { props: { row: makeRow() } });

    const btn = screen.getByRole('button', { name: 'searchAssets' });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(btn.innerHTML).toContain('bg-green-500');
    expect(screen.getByText('searchAssets')).toBeInTheDocument();
    expect(screen.getByText('Found 5 matching photos')).toBeInTheDocument();
    expect(screen.getByText('2.3s')).toBeInTheDocument();
  });

  it('failed row: red dot; expanding shows detail.error text and aria-expanded true', async () => {
    const user = userEvent.setup();

    render(AgentTurnTimelineRowComponent, {
      props: {
        row: makeRow({
          state: 'failed',
          detail: {
            requestSummary: 'Search for beach photos',
            responseSummary: null,
            assetCount: null,
            albumCount: null,
            resultSize: null,
            error: 'Network request failed',
            startedAt: '2026-05-18T10:00:05.000Z',
            completedAt: '2026-05-18T10:00:07.000Z',
          },
        }),
      },
    });

    const btn = screen.getByRole('button', { name: 'searchAssets' });
    expect(btn.innerHTML).toContain('bg-red-500');

    await user.click(btn);

    expect(btn).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Network request failed')).toBeInTheDocument();
  });

  it('denied row: amber dot + denied text; durationMs null → no duration rendered', () => {
    render(AgentTurnTimelineRowComponent, {
      props: {
        row: makeRow({
          state: 'denied',
          durationMs: null,
        }),
      },
    });

    const btn = screen.getByRole('button', { name: 'searchAssets' });
    expect(btn.innerHTML).toContain('bg-amber-500');
    expect(screen.getByText('denied')).toBeInTheDocument();
    expect(screen.queryByText(/\ds$/)).not.toBeInTheDocument();
  });

  it('in-flight row: animate-pulse class present', () => {
    render(AgentTurnTimelineRowComponent, {
      props: {
        row: makeRow({
          state: 'in-flight',
          durationMs: null,
        }),
      },
    });

    const btn = screen.getByRole('button', { name: 'searchAssets' });
    expect(btn.innerHTML).toContain('animate-pulse');
  });

  it('cancelled row: grey dot + cancelled text', () => {
    render(AgentTurnTimelineRowComponent, {
      props: {
        row: makeRow({
          state: 'cancelled',
          durationMs: null,
        }),
      },
    });

    const btn = screen.getByRole('button', { name: 'searchAssets' });
    expect(btn.innerHTML).toContain('bg-gray-400');
    expect(screen.getByText('cancelled')).toBeInTheDocument();
  });

  it('detail fields: expanded row shows full request and response summary text', async () => {
    const user = userEvent.setup();
    const longRequest = 'R'.repeat(300);
    const longResponse = 'S'.repeat(300);

    render(AgentTurnTimelineRowComponent, {
      props: {
        row: makeRow({
          detail: {
            requestSummary: longRequest,
            responseSummary: longResponse,
            assetCount: 3,
            albumCount: 2,
            resultSize: {
              returnedItems: 10,
              hasMore: false,
              nextPage: null,
              estimatedBytes: 1024,
              truncated: true,
              omittedFields: [],
            },
            error: null,
            startedAt: '2026-05-18T10:00:05.000Z',
            completedAt: '2026-05-18T10:00:07.000Z',
          },
        }),
      },
    });

    await user.click(screen.getByRole('button', { name: 'searchAssets' }));

    expect(screen.getByText(longRequest)).toBeInTheDocument();
    expect(screen.getByText(longResponse)).toBeInTheDocument();
  });
});
