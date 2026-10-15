import { getFaceDissolves, restoreFaceDissolve } from '@immich/sdk';
import { modalManager } from '@immich/ui';
import { init, register, waitLocale } from 'svelte-i18n';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent, type Locator } from 'vitest/browser';
import Page from './+page.svelte';

const findOne = async (locator: Locator) => {
  await expect.element(locator).toBeInTheDocument();
  return locator.element() as HTMLElement;
};

vi.mock('@immich/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@immich/sdk')>();
  return { ...actual, getFaceDissolves: vi.fn(), restoreFaceDissolve: vi.fn() };
});

vi.mock('@immich/ui', async (original) => {
  const mod = await original<typeof import('@immich/ui')>();
  const noop = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return {
    ...mod,
    Icon: noop.default,
    toastManager: { primary: vi.fn(), success: vi.fn(), danger: vi.fn() },
    modalManager: { show: vi.fn(), showDialog: vi.fn() },
  };
});

vi.mock('$app/navigation', () => ({
  goto: vi.fn(),
  afterNavigate: vi.fn(),
  beforeNavigate: vi.fn(),
  onNavigate: vi.fn(),
}));

vi.mock('#lib/components/layouts/AdminPageLayout.svelte', async () => {
  const { default: stub } = await import('#lib/gallery/__mocks__/admin-page-layout.stub.svelte');
  return { default: stub };
});

beforeAll(async () => {
  register('en', () => import('#i18n/en.json'));
  await init({ fallbackLocale: 'en', initialLocale: 'en' });
  await waitLocale('en');
});

const record = (over: Record<string, unknown> = {}) => ({
  id: '0199a8f0-0000-7000-8000-000000000001',
  ownerId: 'owner-1',
  ownerName: 'Hagen',
  personName: 'Cluster A',
  scope: 'all',
  hiddenCount: 1244,
  deletedCount: 0,
  unassignedCount: 1,
  restorableCount: 1240,
  createdAt: '2026-10-28T10:00:00.000Z',
  restoredAt: null,
  ...over,
});

const rows = () => page.getByTestId('dissolve-row').elements();

describe('Dissolved page', () => {
  beforeEach(() => {
    vi.mocked(getFaceDissolves).mockResolvedValue({
      items: [record(), record({ id: 'second', personName: 'Older', createdAt: '2026-10-01T10:00:00.000Z' })],
      hasMore: false,
    } as never);
    vi.mocked(restoreFaceDissolve).mockResolvedValue({ restored: 1240, skipped: 0 });
    vi.mocked(modalManager.showDialog).mockResolvedValue(true as never);
  });

  it('lists dissolves in the order the server returns, newest first, with their counts', async () => {
    await render(Page);
    await vi.waitFor(() => expect(rows()).toHaveLength(2));
    expect(rows()[0].textContent).toContain('Cluster A');
    expect(rows()[0].textContent).toContain('Hagen');
    expect(rows()[0].textContent).toMatch(/1,?240 restorable/);
    expect(rows()[1].textContent).toContain('Older');
  });

  it('restores after confirmation and marks the row restored', async () => {
    await render(Page);
    await vi.waitFor(() => expect(rows()).toHaveLength(2));
    vi.mocked(getFaceDissolves).mockResolvedValue({
      items: [record({ restoredAt: '2026-10-28T11:00:00.000Z', restorableCount: 0 })],
      hasMore: false,
    } as never);

    await userEvent.click(page.elementLocator(rows()[0]).getByRole('button', { name: 'Restore' }).element());

    expect(restoreFaceDissolve).toHaveBeenCalledWith({ id: '0199a8f0-0000-7000-8000-000000000001' });
    await vi.waitFor(() => expect(rows()[0].textContent).toMatch(/Restored/));
  });

  it('warns in the confirmation that the faces will likely group again', async () => {
    await render(Page);
    await vi.waitFor(() => expect(rows()).toHaveLength(2));
    await userEvent.click(page.elementLocator(rows()[0]).getByRole('button', { name: 'Restore' }).element());
    const [[options]] = vi.mocked(modalManager.showDialog).mock.calls;
    expect(options.prompt).toMatch(/1,?240/);
    expect(options.prompt).toMatch(/group with similar faces again/);
  });

  it('does nothing when the confirmation is cancelled', async () => {
    vi.mocked(modalManager.showDialog).mockResolvedValue(false as never);
    await render(Page);
    await vi.waitFor(() => expect(rows()).toHaveLength(2));
    await userEvent.click(page.elementLocator(rows()[0]).getByRole('button', { name: 'Restore' }).element());
    expect(restoreFaceDissolve).not.toHaveBeenCalled();
  });

  it('disables Restore when nothing is restorable or the dissolve was restored', async () => {
    vi.mocked(getFaceDissolves).mockResolvedValue({
      items: [record({ restorableCount: 0 }), record({ id: 'r2', restoredAt: '2026-10-28T11:00:00.000Z' })],
      hasMore: false,
    } as never);
    await render(Page);
    await vi.waitFor(() => expect(rows()).toHaveLength(2));
    for (const row of rows()) {
      expect(page.elementLocator(row).getByRole('button', { name: 'Restore' }).element()).toBeDisabled();
    }
  });

  it('says so when nothing was dissolved yet', async () => {
    vi.mocked(getFaceDissolves).mockResolvedValue({ items: [], hasMore: false } as never);
    await render(Page);
    expect(await findOne(page.getByText('No dissolved people yet.'))).toBeVisible();
  });
});
