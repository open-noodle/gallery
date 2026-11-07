import TestWrapper from '#lib/components/TestWrapper.svelte';
import { clearPeopleFaceStatisticsInfoCache } from '#lib/components/people/people-face-statistics-info-cache.ts';
import { locale } from '#lib/stores/preferences.store.ts';
import type { PeopleFaceStatisticsResponseDto } from '@immich/sdk';
import type { Component } from 'svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import PeopleFaceStatisticsInfo from './people-face-statistics-info.svelte';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

const statistics = (overrides: Partial<PeopleFaceStatisticsResponseDto> = {}): PeopleFaceStatisticsResponseDto => ({
  assignedHiddenFaceCount: 3456,
  assignedVisibleFaceCount: 2345,
  detectedFaceCount: 1234,
  namedVisiblePersonCount: 154,
  unassignedFaceCount: 4567,
  ...overrides,
});

const renderInfo = async (
  props: Partial<{
    cacheKey: string;
    loadStatistics: () => Promise<PeopleFaceStatisticsResponseDto>;
  }> = {},
) => {
  const loadStatistics = props.loadStatistics ?? vi.fn().mockResolvedValue(statistics());
  const componentProps = {
    cacheKey: props.cacheKey ?? 'people',
    loadStatistics,
  };
  return {
    loadStatistics,
    ...(await render(
      TestWrapper as Component<{
        component: typeof PeopleFaceStatisticsInfo;
        componentProps: typeof componentProps;
      }>,
      {
        props: {
          component: PeopleFaceStatisticsInfo,
          componentProps,
        },
      },
    )),
  };
};

describe('PeopleFaceStatisticsInfo', () => {
  beforeAll(async () => {
    register('en-US', () => import('#i18n/en.json'));
    await init({ fallbackLocale: 'en-US', initialLocale: 'en-US' });
    await waitLocale('en-US');
  });

  beforeEach(() => {
    clearPeopleFaceStatisticsInfoCache();
    locale.set('en-US');
  });

  it('renders an accessible icon button trigger without loading statistics on initial render', async () => {
    const loadStatistics = vi.fn().mockResolvedValue(statistics());

    await renderInfo({ loadStatistics });

    await expect.element(page.getByRole('button', { name: 'View face statistics details' })).toBeInTheDocument();
    expect(loadStatistics).not.toHaveBeenCalled();
  });

  it('shows loading text while the first request is pending', async () => {
    const request = deferred<PeopleFaceStatisticsResponseDto>();
    const loadStatistics = vi.fn(() => request.promise);

    await renderInfo({ loadStatistics });
    await page.getByRole('button', { name: 'View face statistics details' }).click();

    expect(loadStatistics).toHaveBeenCalledTimes(1);
    await expect.element(page.getByRole('status')).toMatchTextContent('Loading face statistics');
  });

  it('exposes expanded state, controls, and keyboard activation through the button', async () => {
    const request = deferred<PeopleFaceStatisticsResponseDto>();
    const loadStatistics = vi.fn(() => request.promise);

    await renderInfo({ loadStatistics });

    const trigger = page.getByRole('button', { name: 'View face statistics details' });
    await expect.element(trigger).toHaveAttribute('aria-expanded', 'false');
    const detailsId = trigger.element().getAttribute('aria-controls');
    expect(detailsId).toBeTruthy();

    (trigger.element() as HTMLElement).focus();
    await userEvent.keyboard('{Enter}');

    await expect.element(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect
      .element(page.getByRole('dialog', { name: 'View face statistics details' }))
      .toHaveAttribute('id', detailsId!);
  });

  it('uses unique control ids for multiple instances', async () => {
    await renderInfo({ cacheKey: 'people-a' });
    await renderInfo({ cacheKey: 'people-b' });

    const controls = page
      .getByRole('button', { name: 'View face statistics details' })
      .elements()
      .map((trigger) => trigger.getAttribute('aria-controls'));

    expect(controls).toHaveLength(2);
    expect(new Set(controls).size).toBe(2);
  });

  it('renders the details surface as a compact dialog for narrow viewports', async () => {
    await renderInfo();
    await page.getByRole('button', { name: 'View face statistics details' }).click();

    const dialog = page.getByRole('dialog', { name: 'View face statistics details' });
    await expect.element(dialog).toHaveClass('fixed');
    await expect.element(dialog).not.toHaveClass('absolute');
    await expect.element(dialog).toHaveClass('w-72');
    await expect.element(dialog).toHaveClass('max-w-[calc(100vw-1rem)]');
  });

  it('closes the details surface on Escape and outside click', async () => {
    await renderInfo();

    const trigger = page.getByRole('button', { name: 'View face statistics details' });
    await trigger.click();
    await expect.element(page.getByRole('dialog', { name: 'View face statistics details' })).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    await expect.element(page.getByRole('dialog', { name: 'View face statistics details' })).not.toBeInTheDocument();

    await trigger.click();
    await expect.element(page.getByRole('dialog', { name: 'View face statistics details' })).toBeInTheDocument();

    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await expect.element(page.getByRole('dialog', { name: 'View face statistics details' })).not.toBeInTheDocument();
  });

  it('renders the diagnostic rows with locale-formatted values after a successful load', async () => {
    await renderInfo({ loadStatistics: vi.fn().mockResolvedValue(statistics()) });

    await page.getByRole('button', { name: 'View face statistics details' }).click();

    await expect.element(page.getByText('Detected faces')).toBeInTheDocument();
    await expect.element(page.getByText('1,234')).toBeInTheDocument();
    await expect.element(page.getByText('Assigned to visible people')).toBeInTheDocument();
    await expect.element(page.getByText('2,345')).toBeInTheDocument();
    await expect.element(page.getByText('Named visible people')).toBeInTheDocument();
    await expect.element(page.getByText('154')).toBeInTheDocument();
    await expect.element(page.getByText('Assigned to hidden people')).toBeInTheDocument();
    await expect.element(page.getByText('3,456')).toBeInTheDocument();
    await expect.element(page.getByText('Unassigned')).toBeInTheDocument();
    await expect.element(page.getByText('4,567')).toBeInTheDocument();
  });

  it('uses cached statistics when reopening with the same cache key', async () => {
    const loadStatistics = vi.fn().mockResolvedValue(statistics());
    await renderInfo({ cacheKey: 'people', loadStatistics });

    const trigger = page.getByRole('button', { name: 'View face statistics details' });
    await trigger.click();
    await expect.element(page.getByText('1,234')).toBeInTheDocument();
    await trigger.click();
    await trigger.click();

    expect(loadStatistics).toHaveBeenCalledTimes(1);
    await expect.element(page.getByText('1,234')).toBeInTheDocument();
  });

  it('loads fresh statistics for a new cache key and does not show stale rows', async () => {
    const loadStatistics = vi
      .fn<() => Promise<PeopleFaceStatisticsResponseDto>>()
      .mockResolvedValueOnce(statistics({ detectedFaceCount: 1111 }))
      .mockResolvedValueOnce(statistics({ detectedFaceCount: 2222 }));
    const view = await renderInfo({ cacheKey: 'people-a', loadStatistics });

    await page.getByRole('button', { name: 'View face statistics details' }).click();
    await expect.element(page.getByText('1,111')).toBeInTheDocument();

    await view.rerender({
      component: PeopleFaceStatisticsInfo,
      componentProps: { cacheKey: 'people-b', loadStatistics },
    });

    expect(page.getByText('1,111').query()).toBeNull();
    expect(loadStatistics).toHaveBeenCalledTimes(2);
    await expect.element(page.getByText('2,222')).toBeInTheDocument();
  });

  it('caches a slow old response under its original key without displaying it for the new key', async () => {
    const firstRequest = deferred<PeopleFaceStatisticsResponseDto>();
    const secondRequest = deferred<PeopleFaceStatisticsResponseDto>();
    const loadStatistics = vi
      .fn<() => Promise<PeopleFaceStatisticsResponseDto>>()
      .mockReturnValueOnce(firstRequest.promise)
      .mockReturnValueOnce(secondRequest.promise);
    const view = await renderInfo({ cacheKey: 'old-key', loadStatistics });

    await page.getByRole('button', { name: 'View face statistics details' }).click();
    await view.rerender({
      component: PeopleFaceStatisticsInfo,
      componentProps: { cacheKey: 'new-key', loadStatistics },
    });

    firstRequest.resolve(statistics({ detectedFaceCount: 1111 }));
    await Promise.resolve();

    expect(page.getByText('1,111').query()).toBeNull();
    expect(loadStatistics).toHaveBeenCalledTimes(2);

    secondRequest.resolve(statistics({ detectedFaceCount: 2222 }));
    await expect.element(page.getByText('2,222')).toBeInTheDocument();

    await view.rerender({
      component: PeopleFaceStatisticsInfo,
      componentProps: { cacheKey: 'old-key', loadStatistics },
    });
    await expect.element(page.getByText('1,111')).toBeInTheDocument();
    expect(loadStatistics).toHaveBeenCalledTimes(2);
  });

  it('renders an alert after a rejected load and leaves the trigger usable', async () => {
    const loadStatistics = vi
      .fn<() => Promise<PeopleFaceStatisticsResponseDto>>()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(statistics({ detectedFaceCount: 1234 }));

    await renderInfo({ loadStatistics });

    const trigger = page.getByRole('button', { name: 'View face statistics details' });
    await trigger.click();

    await expect.element(page.getByRole('alert')).toMatchTextContent('Unable to load face statistics');
    await expect.element(trigger).toHaveAttribute('aria-expanded', 'true');

    await trigger.click();
    await trigger.click();

    await expect.element(page.getByText('1,234')).toBeInTheDocument();
    expect(loadStatistics).toHaveBeenCalledTimes(2);
  });
});
