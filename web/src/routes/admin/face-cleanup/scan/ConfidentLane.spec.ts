import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { Route } from '$lib/route';
import ConfidentLane from './ConfidentLane.svelte';
import { createScanTriageModel, type FaceCleanupPerson } from './scan-triage.svelte';

vi.mock('@immich/ui', async (orig) => {
  const mod = await orig<typeof import('@immich/ui')>();
  const noop = await import('@test-data/mocks/noop-component.svelte');
  return { ...mod, Icon: noop.default };
});
vi.mock('svelte-i18n', async (orig) => {
  const actual = await orig<typeof import('svelte-i18n')>();
  return {
    ...actual,
    t: {
      subscribe: (run: (fn: (k: string, o?: unknown) => string) => void) => {
        run((k) => k);
        return () => {};
      },
    },
  };
});
vi.mock('$lib/utils/people-utils', () => ({ getAdminFaceThumbnailUrl: (id: string) => `/thumb/${id}` }));

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
  it('renders nothing when there are no confident clusters', () => {
    const model = createScanTriageModel([{ ...conf('r'), recommendation: 'review-first' }]);
    render(ConfidentLane, { props: { model, applying: false, onApprove: vi.fn() } });
    expect(screen.queryByTestId('confident-lane')).not.toBeInTheDocument();
  });

  it('offers to approve every confident cluster by default', () => {
    const model = createScanTriageModel([conf('c1'), conf('c2'), conf('c3')]);
    render(ConfidentLane, { props: { model, applying: false, onApprove: vi.fn() } });
    expect(screen.getByTestId('confident-approve')).toHaveTextContent('3');
  });

  it('approve button invokes onApprove', async () => {
    const model = createScanTriageModel([conf('c1')]);
    const onApprove = vi.fn();
    render(ConfidentLane, { props: { model, applying: false, onApprove } });
    await fireEvent.click(screen.getByTestId('confident-approve'));
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it('approve button is disabled while applying', () => {
    const model = createScanTriageModel([conf('c1')]);
    render(ConfidentLane, { props: { model, applying: true, onApprove: vi.fn() } });
    expect(screen.getByTestId('confident-approve')).toBeDisabled();
  });

  it('expanding reveals a spot-check card per confident cluster', async () => {
    const model = createScanTriageModel([conf('c1'), conf('c2')]);
    render(ConfidentLane, { props: { model, applying: false, onApprove: vi.fn() } });
    expect(screen.queryByTestId('confident-spotcheck')).not.toBeInTheDocument();
    await fireEvent.click(screen.getByTestId('confident-toggle'));
    const grid = screen.getByTestId('confident-spotcheck');
    expect(within(grid).getByTestId('confident-exclude-c1')).toBeInTheDocument();
    expect(within(grid).getByTestId('confident-exclude-c2')).toBeInTheDocument();
  });

  it('excluding a cluster drops the approve count and re-including restores it', async () => {
    const model = createScanTriageModel([conf('c1'), conf('c2')]);
    render(ConfidentLane, { props: { model, applying: false, onApprove: vi.fn() } });
    await fireEvent.click(screen.getByTestId('confident-toggle'));
    await fireEvent.click(screen.getByTestId('confident-exclude-c1'));
    expect(model.approvedIds).toEqual(['c2']);
    expect(screen.getByTestId('confident-approve')).toHaveTextContent('1');
    await fireEvent.click(screen.getByTestId('confident-exclude-c1'));
    expect(model.approvedIds).toEqual(['c1', 'c2']);
    expect(screen.getByTestId('confident-approve')).toHaveTextContent('2');
  });

  it('disables approve when every cluster is excluded', async () => {
    const model = createScanTriageModel([conf('c1')]);
    render(ConfidentLane, { props: { model, applying: false, onApprove: vi.fn() } });
    await fireEvent.click(screen.getByTestId('confident-toggle'));
    await fireEvent.click(screen.getByTestId('confident-exclude-c1'));
    expect(screen.getByTestId('confident-approve')).toBeDisabled();
  });

  it('each spot-check card is a link to the per-cluster review page', async () => {
    const model = createScanTriageModel([conf('c1')]);
    render(ConfidentLane, { props: { model, applying: false, onApprove: vi.fn() } });
    await fireEvent.click(screen.getByTestId('confident-toggle'));
    expect(screen.getByTestId('confident-open-c1')).toHaveAttribute('href', Route.viewFaceCleanupPerson({ id: 'c1' }));
  });

  it('excluding a cluster keeps its card clickable', async () => {
    const model = createScanTriageModel([conf('c1')]);
    render(ConfidentLane, { props: { model, applying: false, onApprove: vi.fn() } });
    await fireEvent.click(screen.getByTestId('confident-toggle'));
    await fireEvent.click(screen.getByTestId('confident-exclude-c1'));
    expect(model.isExcluded('c1')).toBe(true);
    expect(screen.getByTestId('confident-open-c1')).toHaveAttribute('href', Route.viewFaceCleanupPerson({ id: 'c1' }));
  });
});
