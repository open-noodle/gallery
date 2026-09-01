import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { Component } from 'svelte';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import FamilyPage from './+page.svelte';

const { gotoMock } = vi.hoisted(() => ({ gotoMock: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));

vi.mock('$lib/components/layouts/UserPageLayout.svelte', async () => {
  const { default: MockComponent } = await import('$lib/components/spaces/mock-user-page-layout.test-wrapper.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/family/FamilyLinkDialog.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/family/FamilyCanvas.svelte', async () => {
  const { default: MockComponent } = await import('$lib/components/family/mock-family-canvas.test-wrapper.svelte');
  return { default: MockComponent };
});

function renderPage(data: {
  granted: boolean;
  canContribute: boolean;
  clusters: Array<{ label: string; size: number; rootCandidateId: string }>;
  rootId: string | null;
  unions: unknown[];
  identities: Record<string, unknown>;
}) {
  const props = { data: { ...data, meta: { title: 'Family' } } };

  return render(TestWrapper as Component<{ component: typeof FamilyPage; componentProps: typeof props }>, {
    component: FamilyPage,
    componentProps: props,
  });
}

describe('Family page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gotoMock.mockResolvedValue(undefined);
  });

  it('redirects away when the viewer has no family access (A12)', () => {
    renderPage({ granted: false, canContribute: false, clusters: [], rootId: null, unions: [], identities: {} });

    expect(gotoMock).toHaveBeenCalledWith('/photos');
  });

  it('lists each disconnected family as a separate cluster chip (A8)', () => {
    renderPage({
      granted: true,
      canContribute: false,
      clusters: [
        { label: 'Alex', size: 4, rootCandidateId: 'alex' },
        { label: 'Casper', size: 2, rootCandidateId: 'casper' },
      ],
      rootId: null,
      unions: [],
      identities: {},
    });

    expect(screen.getAllByTestId('family-cluster-chip')).toHaveLength(2);
    expect(gotoMock).not.toHaveBeenCalled();
  });

  it('opens on the cluster containing the viewer root', () => {
    const unions = [
      {
        id: 'u1',
        status: 'partnered',
        startDate: null,
        endDate: null,
        partners: [{ kind: 'known', identityId: 'alex' }],
        children: [],
      },
    ];

    renderPage({
      granted: true,
      canContribute: false,
      clusters: [
        { label: 'Casper', size: 2, rootCandidateId: 'casper' },
        { label: 'Alex', size: 1, rootCandidateId: 'alex' },
      ],
      rootId: 'alex',
      unions,
      identities: { alex: { name: 'Alex', gender: null, label: "that's you" } },
    });

    const chips = screen.getAllByTestId('family-cluster-chip');
    // The chip containing the viewer's root (the second cluster, "Alex") is the active one —
    // rendered with the accent treatment, not the first cluster in server order.
    expect(chips[1]).toHaveAttribute('data-active', 'true');
    expect(chips[0]).toHaveAttribute('data-active', 'false');
  });

  it('shows an empty state when the viewer has no relationships yet', () => {
    renderPage({ granted: true, canContribute: false, clusters: [], rootId: null, unions: [], identities: {} });

    expect(screen.getByText('family_canvas_empty_title')).toBeInTheDocument();
    expect(screen.queryByTestId('family-cluster-chip')).not.toBeInTheDocument();
  });

  // A6: the canvas's editing affordances (drop zones, the union editor) are gated on this one
  // prop. Both directions matter: asserting only the `false` case would pass just as well
  // against a page that never renders the canvas at all.
  it('lets a contributor edit the canvas (A6)', () => {
    renderPage({
      granted: true,
      canContribute: true,
      clusters: [{ label: 'Alex', size: 1, rootCandidateId: 'alex' }],
      rootId: 'alex',
      unions: [],
      identities: {},
    });

    expect(screen.getByTestId('family-canvas')).toHaveAttribute('data-can-contribute', 'true');
  });

  it('keeps the canvas read-only for a view-only viewer (A6)', () => {
    renderPage({
      granted: true,
      canContribute: false,
      clusters: [{ label: 'Alex', size: 1, rootCandidateId: 'alex' }],
      rootId: 'alex',
      unions: [],
      identities: {},
    });

    expect(screen.getByTestId('family-canvas')).toHaveAttribute('data-can-contribute', 'false');
  });

  // The defect this fixes: with zero unions the page rendered a dead-end placeholder. Clusters
  // are derived purely from unions, so a cold start has no cards to drag and therefore no way to
  // create the first union — the whole feature was unreachable.
  it('offers a way to start when the graph is empty and the viewer may contribute', async () => {
    renderPage({ granted: true, canContribute: true, clusters: [], rootId: null, unions: [], identities: {} });

    await userEvent.click(screen.getByTestId('family-first-run-action'));

    expect(screen.getByTestId('noop-component')).toBeInTheDocument();
  });

  it('offers no way to start for a view-only viewer', () => {
    renderPage({ granted: true, canContribute: false, clusters: [], rootId: null, unions: [], identities: {} });

    expect(screen.getByText('family_canvas_empty_title')).toBeInTheDocument();
    expect(screen.queryByTestId('family-first-run-action')).not.toBeInTheDocument();
  });

  // Once the graph has people, introducing a NEW one is the canvas tray's job (mockup §1) — you
  // drag a face onto the canvas — so the page hands the canvas the contribute flag and owns no
  // add-someone action of its own. The tray itself is covered in `family-canvas.spec.ts`.
  it('lets the canvas offer authoring once the graph has people', () => {
    renderPage({
      granted: true,
      canContribute: true,
      clusters: [{ label: 'Alex', size: 1, rootCandidateId: 'alex' }],
      rootId: 'alex',
      unions: [],
      identities: {},
    });

    expect(screen.getByTestId('family-canvas')).toHaveAttribute('data-can-contribute', 'true');
  });

  // A second, disconnected family needs its own entry point. The canvas tray only drops someone
  // onto a card that is already drawn, so everything it can do JOINS the tree on screen — leaving
  // no way at all to record a family that has no connection to it. The dialog creates a union from
  // two people at once, which is what starts a fresh cluster.
  it('lets a contributor start a family disconnected from the one on screen', async () => {
    renderPage({
      granted: true,
      canContribute: true,
      clusters: [{ label: 'Alex', size: 3, rootCandidateId: 'alex' }],
      rootId: 'alex',
      unions: [],
      identities: {},
    });

    await userEvent.click(screen.getByTestId('family-new-cluster'));

    expect(screen.getByTestId('noop-component')).toBeInTheDocument();
  });

  it('offers a view-only viewer no way to start one', () => {
    renderPage({
      granted: true,
      canContribute: false,
      clusters: [{ label: 'Alex', size: 3, rootCandidateId: 'alex' }],
      rootId: 'alex',
      unions: [],
      identities: {},
    });

    expect(screen.queryByTestId('family-new-cluster')).not.toBeInTheDocument();
  });

  // The negative control for the test above. Asserted on the flag the canvas actually receives,
  // not on the absence of a testid — an assertion against a testid nothing renders any more would
  // pass whatever the page did.
  it('tells the canvas a view-only viewer may not author', () => {
    renderPage({
      granted: true,
      canContribute: false,
      clusters: [{ label: 'Alex', size: 1, rootCandidateId: 'alex' }],
      rootId: 'alex',
      unions: [],
      identities: {},
    });

    expect(screen.getByTestId('family-canvas')).toHaveAttribute('data-can-contribute', 'false');
  });

  // D6: the layout anchor and the viewer's own root are different values — on a cluster the
  // viewer isn't part of, the canvas still needs an anchor but has nobody to mark as "you".
  it('passes the viewer own root to the canvas alongside the layout anchor', () => {
    renderPage({
      granted: true,
      canContribute: true,
      clusters: [{ label: 'Casper', size: 2, rootCandidateId: 'casper' }],
      rootId: null,
      unions: [],
      identities: {},
    });

    const canvas = screen.getByTestId('family-canvas');
    expect(canvas).toHaveAttribute('data-root-id', 'casper');
    expect(canvas).toHaveAttribute('data-viewer-root-id', '');
  });
});
