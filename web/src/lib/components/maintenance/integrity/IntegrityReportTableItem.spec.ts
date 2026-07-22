import { IntegrityReport } from '@immich/sdk';
import { screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithTooltips } from '$tests/helpers';
import IntegrityReportTableItem from './IntegrityReportTableItem.svelte';

vi.mock('$lib/services/integrity.service', () => ({
  getIntegrityReportItemActions: () => ({
    Download: { type: 'command', title: 'Download', onAction: vi.fn() },
    Delete: { type: 'command', title: 'Delete', onAction: vi.fn() },
  }),
}));

const mockAuthManager = vi.hoisted(() => ({ isReadOnlyDemo: false }));

vi.mock('$lib/managers/auth-manager.svelte', () => ({
  authManager: {
    get isReadOnlyDemo() {
      return mockAuthManager.isReadOnlyDemo;
    },
  },
}));

const itemProps = {
  id: 'report-item-id',
  path: 'upload/library/admin/2026/untracked.jpg',
  reportType: IntegrityReport.UntrackedFile,
};

describe('IntegrityReportTableItem', () => {
  afterEach(() => {
    mockAuthManager.isReadOnlyDemo = false;
  });

  it('renders the download/delete menu for real admins', () => {
    renderWithTooltips(IntegrityReportTableItem, itemProps);

    expect(screen.getByRole('button', { name: 'open' })).toBeInTheDocument();
  });

  // Download hits /admin/integrity/report/:id/file and delete is a DELETE — neither is reachable
  // for the demo user, so the row menu would only ever 403.
  it('hides the download/delete menu for demo preview users', () => {
    mockAuthManager.isReadOnlyDemo = true;

    renderWithTooltips(IntegrityReportTableItem, itemProps);

    expect(screen.queryByRole('button', { name: 'open' })).not.toBeInTheDocument();
  });

  it('still renders the flagged path for demo preview users', () => {
    mockAuthManager.isReadOnlyDemo = true;

    renderWithTooltips(IntegrityReportTableItem, itemProps);

    expect(screen.getByText(itemProps.path)).toBeInTheDocument();
  });
});
