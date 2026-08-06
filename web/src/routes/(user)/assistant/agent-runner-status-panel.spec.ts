import { render, screen } from '@testing-library/svelte';
import AgentRunnerStatusPanel from './agent-runner-status-panel.svelte';

vi.mock('svelte-i18n', async () => {
  const { readable } = await import('svelte/store');
  const messages: Record<string, string> = {
    assistant: 'Assistant',
    assistant_runner_not_configured: 'Runner not configured',
    assistant_runner_unavailable: 'Runner unavailable',
    assistant_runner_healthy: 'Runner healthy',
    assistant_start_session: 'Start session',
    assistant_protocol: 'Protocol {protocol}',
    unknown: 'Unknown',
  };

  return {
    t: readable((key: string, options?: { values?: Record<string, string> }) =>
      (messages[key] ?? key).replace('{protocol}', options?.values?.protocol ?? ''),
    ),
  };
});

describe(AgentRunnerStatusPanel.name, () => {
  it('shows disabled state when the runner is not configured', () => {
    render(AgentRunnerStatusPanel, {
      props: {
        status: {
          configured: false,
          healthy: false,
          reason: 'not-configured',
          version: null,
          capabilities: null,
          checkedAt: '2026-05-14T00:00:00.000Z',
        },
      },
    });

    expect(screen.getByTestId('assistant-status-reason')).toHaveTextContent('Runner not configured');
    expect(screen.queryByRole('button', { name: 'Start session' })).not.toBeInTheDocument();
  });

  it('shows disabled state when the configured runner is unhealthy', () => {
    render(AgentRunnerStatusPanel, {
      props: {
        status: {
          configured: true,
          healthy: false,
          reason: 'timeout',
          version: null,
          capabilities: null,
          checkedAt: '2026-05-14T00:00:00.000Z',
        },
      },
    });

    expect(screen.getByTestId('assistant-status-reason')).toHaveTextContent('Runner unavailable');
    expect(screen.queryByRole('button', { name: 'Start session' })).not.toBeInTheDocument();
  });

  it('shows healthy runner capabilities without rendering a session start action', () => {
    render(AgentRunnerStatusPanel, {
      props: {
        status: {
          configured: true,
          healthy: true,
          reason: 'healthy',
          version: '0.1.0',
          capabilities: {
            protocolVersion: '2026-05-14',
            streaming: true,
            tools: ['echo'],
            models: [],
          },
          checkedAt: '2026-05-14T00:00:00.000Z',
        },
      },
    });

    expect(screen.getByTestId('assistant-status-reason')).toHaveTextContent('Runner healthy');
    expect(screen.getByText('Protocol 2026-05-14')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start session' })).not.toBeInTheDocument();
  });

  it('uses a translated fallback when healthy capabilities omit protocol version', () => {
    render(AgentRunnerStatusPanel, {
      props: {
        status: {
          configured: true,
          healthy: true,
          reason: 'healthy',
          version: '0.1.0',
          capabilities: {
            protocolVersion: null,
            streaming: false,
            tools: [],
            models: [],
          },
          checkedAt: '2026-05-14T00:00:00.000Z',
        },
      },
    });

    expect(screen.getByText('Protocol Unknown')).toBeInTheDocument();
  });
});
