import { render, screen } from '@testing-library/svelte';
import { readable } from 'svelte/store';
import type { OperationReviewImpactSummary } from './agent-operation-plan-ui';
import AgentPlanApplyBar from './agent-plan-apply-bar.svelte';

vi.mock('svelte-i18n', () => {
  const messages: Record<string, string> = {
    assistant_operation_apply_applying: 'Applying operations',
    assistant_operation_apply_selected: 'Apply {count} selected',
    assistant_operation_apply_summary: '{changes} changes · {assets} assets selected',
    assistant_operation_apply_bar_label: 'Review selected plan actions',
  };

  return {
    t: readable((key: string, options?: { values?: Record<string, string | number> }) =>
      (messages[key] ?? key)
        .replace('{assets}', String(options?.values?.assets ?? ''))
        .replace('{changes}', String(options?.values?.changes ?? ''))
        .replace('{count}', String(options?.values?.count ?? '')),
    ),
  };
});

const impact: OperationReviewImpactSummary = {
  destinationCount: 1,
  totalOperationCount: 2,
  selectedOperationCount: 2,
  blockedOperationCount: 0,
  totalAssetCount: 4,
  selectedAssetCount: 4,
};

describe('AgentPlanApplyBar', () => {
  it('exposes the sticky apply bar as a named region described by its summary', () => {
    render(AgentPlanApplyBar, {
      props: {
        impact,
        selectedOperationIds: ['operation-1', 'operation-2'],
        canApply: true,
        applying: false,
        onApply: vi.fn(),
      },
    });

    const applyRegion = screen.getByRole('region', { name: 'Review selected plan actions' });
    const summary = screen.getByText('2 changes · 4 assets selected');
    expect(applyRegion).toContainElement(summary);
    expect(applyRegion).toHaveAttribute('aria-describedby', summary.id);
    expect(applyRegion.className).toContain('rounded-3xl');
    expect(applyRegion.className).not.toContain('border-t');
  });

  it('uses a native disabled apply button without fake disabled focus behavior', () => {
    render(AgentPlanApplyBar, {
      props: {
        impact: { ...impact, selectedOperationCount: 0, selectedAssetCount: 0 },
        selectedOperationIds: [],
        canApply: false,
        applying: false,
        onApply: vi.fn(),
      },
    });

    const button = screen.getByRole('button', { name: 'Apply 0 selected' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('disabled');
  });
});
