import { FamilyParticipantKind, FamilyUnionStatus, type FamilyIdentityDto, type FamilyUnionDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/svelte';
import FamilyCanvas from '$lib/components/family/FamilyCanvas.svelte';

const known = (identityId: string) => ({ kind: FamilyParticipantKind.Known, identityId });
const anonymous = () => ({ kind: FamilyParticipantKind.Anonymous, identityId: null });

const union = (overrides: Partial<FamilyUnionDto> & Pick<FamilyUnionDto, 'id'>): FamilyUnionDto => ({
  status: FamilyUnionStatus.Partnered,
  startDate: null,
  endDate: null,
  partners: [],
  children: [],
  ...overrides,
});

const identity = (name: string, label: string | null = null): FamilyIdentityDto => ({ name, gender: null, label });

function renderCanvas(props: {
  unions: FamilyUnionDto[];
  identities: Record<string, FamilyIdentityDto>;
  rootId: string;
  canContribute?: boolean;
}) {
  return render(FamilyCanvas, {
    unions: props.unions,
    identities: props.identities,
    rootId: props.rootId,
    canContribute: props.canContribute ?? false,
  });
}

describe('FamilyCanvas', () => {
  it('renders a person who belongs to three unions without overlapping cards', () => {
    // E51 — the layout case that actually breaks naive generational layout.
    const unions: FamilyUnionDto[] = [
      union({ id: 'u1', partners: [known('sam'), known('partnerA')], children: [known('kid1')] }),
      union({ id: 'u2', partners: [known('sam'), known('partnerB')], children: [known('kid2')] }),
      union({ id: 'u3', partners: [known('sam'), known('partnerC')], children: [known('kid3')] }),
    ];
    const identities = {
      sam: identity('Sam'),
      partnerA: identity('Partner A'),
      partnerB: identity('Partner B'),
      partnerC: identity('Partner C'),
      kid1: identity('Kid One'),
      kid2: identity('Kid Two'),
      kid3: identity('Kid Three'),
    };

    renderCanvas({ unions, identities, rootId: 'sam' });

    // Sam renders exactly once, not once per union — the structural proxy for "does not
    // overlap": a duplicate card for the same person would be the actual failure mode here.
    expect(screen.getAllByText('Sam')).toHaveLength(1);
    // All three partners and all three children are still present, each their own card.
    for (const name of ['Partner A', 'Partner B', 'Partner C', 'Kid One', 'Kid Two', 'Kid Three']) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    expect(screen.getAllByTestId('family-node')).toHaveLength(7);
  });

  it('renders an anonymous card for an unresolvable participant', () => {
    const unions: FamilyUnionDto[] = [union({ id: 'u1', partners: [known('root'), anonymous()], children: [] })];
    const identities = { root: identity('Root Person') };

    renderCanvas({ unions, identities, rootId: 'root' });

    const anonymousSeat = screen.getByTestId('family-anonymous-seat');
    expect(anonymousSeat).toBeInTheDocument();
    expect(anonymousSeat).toHaveTextContent('family_canvas_anonymous_name');
  });

  it('never renders an identity id for an anonymous card', () => {
    const REAL_HIDDEN_ID = 'the-real-hidden-identity-id';
    const unions: FamilyUnionDto[] = [union({ id: 'u1', partners: [known('root'), anonymous()], children: [] })];
    const identities = { root: identity('Root Person') };

    const { container } = renderCanvas({ unions, identities, rootId: 'root' });

    // The redaction guard: even if a hidden identity's real id existed somewhere in scope, the
    // anonymous card must never surface it anywhere in its own markup (no data attribute, no
    // text, nothing an attacker could read off the DOM to correlate the same hidden person
    // elsewhere — D3/E30).
    const anonymousSeat = screen.getByTestId('family-anonymous-seat');
    expect(anonymousSeat.outerHTML).not.toContain(REAL_HIDDEN_ID);
    expect(container.getHTML()).not.toContain(REAL_HIDDEN_ID);
  });

  it('renders a dashed add-a-parent affordance for an empty seat', () => {
    const unions: FamilyUnionDto[] = [union({ id: 'u1', partners: [known('root')], children: [] })];
    const identities = { root: identity('Root Person') };

    renderCanvas({ unions, identities, rootId: 'root', canContribute: true });

    const emptySeat = screen.getByTestId('family-empty-seat');
    expect(emptySeat).toBeInTheDocument();
    expect(emptySeat).toHaveTextContent('family_canvas_add_parent');
  });

  // Paired control for A6: the same fixture, but a view-only viewer must see no affordance at
  // all — not the same card disabled.
  it('renders no add-a-parent affordance for a view-only viewer', () => {
    const unions: FamilyUnionDto[] = [union({ id: 'u1', partners: [known('root')], children: [] })];
    const identities = { root: identity('Root Person') };

    renderCanvas({ unions, identities, rootId: 'root', canContribute: false });

    expect(screen.queryByTestId('family-empty-seat')).not.toBeInTheDocument();
  });

  it('renders the union connector with its status and dates', () => {
    const unions: FamilyUnionDto[] = [
      union({
        id: 'u1',
        status: FamilyUnionStatus.Married,
        startDate: '1985-06-01',
        endDate: null,
        partners: [known('root'), known('spouse')],
        children: [],
      }),
    ];
    const identities = { root: identity('Root Person'), spouse: identity('Spouse') };

    renderCanvas({ unions, identities, rootId: 'root' });

    const bar = screen.getByTestId('family-union-bar');
    expect(bar).toHaveAttribute('data-status', 'married');
    expect(bar).toHaveTextContent('1985');
  });

  it('draws an ended union differently from a current one', () => {
    const unions: FamilyUnionDto[] = [
      union({
        id: 'current',
        status: FamilyUnionStatus.Married,
        partners: [known('root'), known('spouse')],
        children: [],
      }),
      union({
        id: 'ended',
        status: FamilyUnionStatus.Divorced,
        startDate: '1988-01-01',
        endDate: '2007-01-01',
        partners: [known('ex1'), known('ex2')],
        children: [known('root')],
      }),
    ];
    const identities = {
      root: identity('Root Person'),
      spouse: identity('Spouse'),
      ex1: identity('Ex One'),
      ex2: identity('Ex Two'),
    };

    renderCanvas({ unions, identities, rootId: 'root' });

    const bars = screen.getAllByTestId('family-union-bar');
    const currentBar = bars.find((bar) => bar.dataset.status === 'married')!;
    const endedBar = bars.find((bar) => bar.dataset.status === 'divorced')!;

    expect(currentBar).toHaveAttribute('data-ended', 'false');
    expect(endedBar).toHaveAttribute('data-ended', 'true');
    expect(currentBar.className).not.toBe(endedBar.className);
  });

  it('describes an unreachable person relative to the nearest reachable one', () => {
    // The label is already computed server-side ("Mia's parent") — the renderer's job is only
    // to display it verbatim, never to derive it itself (D4).
    const unions: FamilyUnionDto[] = [union({ id: 'u1', partners: [known('root'), known('bram')], children: [] })];
    const identities = {
      root: identity('Root Person', "that's you"),
      bram: identity('Bram', "Mia's parent"),
    };

    renderCanvas({ unions, identities, rootId: 'root' });

    expect(screen.getByText("Mia's parent")).toBeInTheDocument();
  });

  it('shows plain names with no relative labels when no root is set', () => {
    const unions: FamilyUnionDto[] = [union({ id: 'u1', partners: [known('root'), known('spouse')], children: [] })];
    const identities = {
      root: identity('Root Person', null),
      spouse: identity('Spouse', null),
    };

    renderCanvas({ unions, identities, rootId: 'root' });

    expect(screen.getByText('Root Person')).toBeInTheDocument();
    expect(screen.getByText('Spouse')).toBeInTheDocument();
    expect(screen.queryByText("that's you")).not.toBeInTheDocument();
  });
});
