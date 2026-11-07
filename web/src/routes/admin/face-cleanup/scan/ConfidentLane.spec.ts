import { Route } from '#lib/route.ts';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import ConfidentLane from './ConfidentLane.svelte';
import { createScanTriageModel, type FaceCleanupPerson } from './scan-triage.svelte';

vi.mock('@immich/ui', async (orig) => {
  const mod = await orig<typeof import('@immich/ui')>();
  const noop = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { ...mod, Icon: noop.default };
});
vi.mock('#lib/utils/people-utils.js', () => ({ getAdminFaceThumbnailUrl: (id: string) => `/thumb/${id}` }));

const conf = (id: string): FaceCleanupPerson => ({
  personId: id,
  ownerId: 'o',
  personName: null,
  faceCount: 10,
  thumbnailFaceId: `t-${id}`,
  eligible: 10,
  flagged: 2,
  flaggedFraction: 0.2,
  suspectedOwners: [
    { ownerPersonId: 'd', ownerName: 'Dest', thumbnailFaceId: 'f', count: 2, ownerFaceCount: 2, ownerMissing: false },
  ],
  recommendation: 'confident',
  reviewReasons: [],
});

describe('ConfidentLane', () => {
  it('renders nothing when there are no confident clusters', async () => {
    const model = createScanTriageModel([{ ...conf('r'), recommendation: 'review-first' }]);
    await render(ConfidentLane, { props: { model, applying: false, onApprove: vi.fn() } });
    expect(page.getByTestId('confident-lane').query()).not.toBeInTheDocument();
  });

  it('offers to approve every confident cluster by default', async () => {
    const model = createScanTriageModel([conf('c1'), conf('c2'), conf('c3')]);
    await render(ConfidentLane, { props: { model, applying: false, onApprove: vi.fn() } });
    expect(page.getByTestId('confident-approve').element()).toMatchTextContent('3');
  });

  it('approve button invokes onApprove', async () => {
    const model = createScanTriageModel([conf('c1')]);
    const onApprove = vi.fn();
    await render(ConfidentLane, { props: { model, applying: false, onApprove } });
    await userEvent.click(page.getByTestId('confident-approve').element());
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it('approve button is disabled while applying', async () => {
    const model = createScanTriageModel([conf('c1')]);
    await render(ConfidentLane, { props: { model, applying: true, onApprove: vi.fn() } });
    expect(page.getByTestId('confident-approve').element()).toBeDisabled();
  });

  it('expanding reveals a spot-check card per confident cluster', async () => {
    const model = createScanTriageModel([conf('c1'), conf('c2')]);
    await render(ConfidentLane, { props: { model, applying: false, onApprove: vi.fn() } });
    expect(page.getByTestId('confident-spotcheck').query()).not.toBeInTheDocument();
    await userEvent.click(page.getByTestId('confident-toggle').element());
    const grid = page.getByTestId('confident-spotcheck').element();
    expect(page.elementLocator(grid).getByTestId('confident-exclude-c1').element()).toBeInTheDocument();
    expect(page.elementLocator(grid).getByTestId('confident-exclude-c2').element()).toBeInTheDocument();
  });

  it('excluding a cluster drops the approve count and re-including restores it', async () => {
    const model = createScanTriageModel([conf('c1'), conf('c2')]);
    await render(ConfidentLane, { props: { model, applying: false, onApprove: vi.fn() } });
    await userEvent.click(page.getByTestId('confident-toggle').element());
    await userEvent.click(page.getByTestId('confident-exclude-c1').element());
    expect(model.approvedIds).toEqual(['c2']);
    expect(page.getByTestId('confident-approve').element()).toMatchTextContent('1');
    await userEvent.click(page.getByTestId('confident-exclude-c1').element());
    expect(model.approvedIds).toEqual(['c1', 'c2']);
    expect(page.getByTestId('confident-approve').element()).toMatchTextContent('2');
  });

  it('disables approve when every cluster is excluded', async () => {
    const model = createScanTriageModel([conf('c1')]);
    await render(ConfidentLane, { props: { model, applying: false, onApprove: vi.fn() } });
    await userEvent.click(page.getByTestId('confident-toggle').element());
    await userEvent.click(page.getByTestId('confident-exclude-c1').element());
    expect(page.getByTestId('confident-approve').element()).toBeDisabled();
  });

  it('each spot-check card is a link to the per-cluster review page', async () => {
    const model = createScanTriageModel([conf('c1')]);
    await render(ConfidentLane, { props: { model, applying: false, onApprove: vi.fn() } });
    await userEvent.click(page.getByTestId('confident-toggle').element());
    expect(page.getByTestId('confident-open-c1').element()).toHaveAttribute(
      'href',
      Route.viewFaceCleanupPerson({ id: 'c1' }),
    );
  });

  it('excluding a cluster keeps its card clickable', async () => {
    const model = createScanTriageModel([conf('c1')]);
    await render(ConfidentLane, { props: { model, applying: false, onApprove: vi.fn() } });
    await userEvent.click(page.getByTestId('confident-toggle').element());
    await userEvent.click(page.getByTestId('confident-exclude-c1').element());
    expect(model.isExcluded('c1')).toBe(true);
    expect(page.getByTestId('confident-open-c1').element()).toHaveAttribute(
      'href',
      Route.viewFaceCleanupPerson({ id: 'c1' }),
    );
  });
});
