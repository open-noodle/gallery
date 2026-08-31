import {
  FamilyParticipantKind,
  FamilyParticipantRole,
  FamilyUnionStatus,
  type FamilyIdentityDto,
  type FamilyUnionDto,
} from '@immich/sdk';
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/svelte';
// Must be imported BEFORE `FamilyCanvas.svelte` below: importing `sdk.mock` is what calls
// `vi.mock('@immich/sdk', ...)`, and that has to register before the component's own static
// import of `createUnion`/`addParticipant`/`updateUnion` resolves — otherwise the component binds
// to the real (network-calling) implementations instead of the mocks.
import { sdkMock } from '$lib/__mocks__/sdk.mock';
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

// Slice 11 (Task 1): a minimal fake DataTransfer — happy-dom doesn't implement the real one, and
// the component only ever calls `setData`/`getData` on it, so a tiny Map-backed stand-in is
// enough to carry the dragged identityId from `dragstart` to `drop` exactly as a browser would.
function fakeDataTransfer() {
  const store = new Map<string, string>();
  return {
    setData: (format: string, value: string) => store.set(format, value),
    getData: (format: string) => store.get(format) ?? '',
    effectAllowed: 'move',
    dropEffect: 'move',
  } as unknown as DataTransfer;
}

function cardFor(name: string): HTMLElement {
  const node = screen.getByText(name).closest('[data-testid="family-node"]');
  if (!node) {
    throw new Error(`No family-node card for "${name}"`);
  }
  return node as HTMLElement;
}

function dropZone(targetId: string, position: 'above' | 'beside' | 'below'): HTMLElement {
  const zone = screen
    .getAllByTestId('family-drop-zone')
    .find((element) => element.dataset.targetId === targetId && element.dataset.position === position);
  if (!zone) {
    throw new Error(`No "${position}" drop zone for target "${targetId}"`);
  }
  return zone;
}

/** Drags the card named `sourceName` and drops it on `targetId`'s `position` zone — the same
 * `dragstart` → `drop` sequence a real drag performs, just with a synthetic `DataTransfer`. */
async function dragOnto(sourceName: string, targetId: string, position: 'above' | 'beside' | 'below') {
  const dataTransfer = fakeDataTransfer();
  await fireEvent.dragStart(cardFor(sourceName), { dataTransfer });
  await fireEvent.drop(dropZone(targetId, position), { dataTransfer });
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

// Slice 11, Task 1: drag a face onto a card and the relationship is implied by where it's
// dropped, with no dialog. `E52` is the load-bearing case — see its own test below.
describe('FamilyCanvas drag-and-drop editing', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('creates a parent relationship when a person is dropped above a card', async () => {
    // `root` has a union it is a PARTNER in (with `spouse`), but no union it is a CHILD of —
    // dropping `spouse` above `root` must therefore create a brand new union rather than
    // attaching to the existing one (that one is not the "child-of" union at all).
    const unions: FamilyUnionDto[] = [union({ id: 'u-root-spouse', partners: [known('root'), known('spouse')] })];
    const identities = { root: identity('Root'), spouse: identity('Spouse') };
    sdkMock.createUnion.mockResolvedValue({ id: 'new-union' });

    renderCanvas({ unions, identities, rootId: 'root', canContribute: true });
    await dragOnto('Spouse', 'root', 'above');

    expect(sdkMock.createUnion).toHaveBeenCalledWith({
      familyUnionCreateDto: { partnerIds: ['spouse'], childIds: ['root'] },
    });
    expect(sdkMock.addParticipant).not.toHaveBeenCalled();
    const bars = await screen.findAllByTestId('family-union-bar');
    expect(bars).toHaveLength(2);
  });

  it('creates a partnership when a person is dropped beside a card', async () => {
    const unions: FamilyUnionDto[] = [
      union({ id: 'u-parent', partners: [known('mom')], children: [known('root'), known('sibling')] }),
    ];
    const identities = { mom: identity('Mom'), root: identity('Root'), sibling: identity('Sibling') };
    sdkMock.createUnion.mockResolvedValue({ id: 'new-union' });

    renderCanvas({ unions, identities, rootId: 'root', canContribute: true });
    await dragOnto('Sibling', 'root', 'beside');

    expect(sdkMock.createUnion).toHaveBeenCalledWith({
      familyUnionCreateDto: { partnerIds: ['sibling', 'root'] },
    });
    expect(sdkMock.addParticipant).not.toHaveBeenCalled();
  });

  it('creates a child relationship when a person is dropped below a card', async () => {
    // `kid` (the root) has no union it is a PARTNER in — dropping `other` below it must create a
    // one-partner union rather than joining anything.
    const unions: FamilyUnionDto[] = [
      union({ id: 'u-parent', partners: [known('mom')], children: [known('kid'), known('other')] }),
    ];
    const identities = { mom: identity('Mom'), kid: identity('Kid'), other: identity('Other') };
    sdkMock.createUnion.mockResolvedValue({ id: 'new-union' });

    renderCanvas({ unions, identities, rootId: 'kid', canContribute: true });
    await dragOnto('Other', 'kid', 'below');

    expect(sdkMock.createUnion).toHaveBeenCalledWith({
      familyUnionCreateDto: { partnerIds: ['kid'], childIds: ['other'] },
    });
    expect(sdkMock.addParticipant).not.toHaveBeenCalled();
  });

  it('joins the existing union when a second parent is dropped above a card (E52)', async () => {
    // `root` is already a child of `u-existing` (one partner, `mom`). Dropping a second parent
    // above `root` must JOIN that union — not start a rival one. This is the behaviour that
    // stops two parents silently describing two separate families for the same child.
    const unions: FamilyUnionDto[] = [
      union({ id: 'u-existing', partners: [known('mom')], children: [known('root'), known('sib')] }),
      union({ id: 'u-sib', partners: [known('sib'), known('newParent')] }),
    ];
    const identities = {
      mom: identity('Mom'),
      root: identity('Root'),
      sib: identity('Sib'),
      newParent: identity('New Parent'),
    };
    sdkMock.addParticipant.mockResolvedValue(undefined as never);

    renderCanvas({ unions, identities, rootId: 'root', canContribute: true });
    await dragOnto('New Parent', 'root', 'above');

    expect(sdkMock.addParticipant).toHaveBeenCalledWith({
      id: 'u-existing',
      familyParticipantAddDto: { identityId: 'newParent', role: FamilyParticipantRole.Partner },
    });
    expect(sdkMock.createUnion).not.toHaveBeenCalled();
    // The load-bearing assertion: still exactly the two unions this fixture started with — one
    // union with two partners, never a second, rival union with one partner each.
    const bars = await screen.findAllByTestId('family-union-bar');
    expect(bars).toHaveLength(2);
  });

  it('makes a sibling when a person is dropped below the parent', async () => {
    // Proves the design claim that there is no fourth gesture: a sibling is produced by the same
    // "drop below the parent" gesture that creates a first child, joining the parent's existing
    // union instead of creating a new one.
    const unions: FamilyUnionDto[] = [
      union({ id: 'u-grandparent', partners: [known('granny')], children: [known('mom'), known('auntie')] }),
      union({ id: 'u-family', partners: [known('mom')], children: [known('kid1')] }),
    ];
    const identities = {
      granny: identity('Granny'),
      mom: identity('Mom'),
      auntie: identity('Auntie'),
      kid1: identity('Kid One'),
    };
    sdkMock.addParticipant.mockResolvedValue(undefined as never);

    renderCanvas({ unions, identities, rootId: 'kid1', canContribute: true });
    await dragOnto('Auntie', 'mom', 'below');

    expect(sdkMock.addParticipant).toHaveBeenCalledWith({
      id: 'u-family',
      familyParticipantAddDto: { identityId: 'auntie', role: FamilyParticipantRole.Child },
    });
    expect(sdkMock.createUnion).not.toHaveBeenCalled();
    const bars = await screen.findAllByTestId('family-union-bar');
    expect(bars).toHaveLength(2);
  });

  it('moves a person already on the canvas instead of duplicating them (E53)', async () => {
    // `sam` already participates in `u-existing` as root's partner. Dropping `sam` as a child of
    // `granny` elsewhere on the canvas must reuse that SAME identity — never spawn a second card
    // or a second identity for the same person, and never remove the first relationship.
    const unions: FamilyUnionDto[] = [
      union({ id: 'u-existing', partners: [known('root'), known('sam')] }),
      union({ id: 'u-grandparent', partners: [known('granny')], children: [known('root')] }),
    ];
    const identities = { root: identity('Root'), sam: identity('Sam'), granny: identity('Granny') };
    sdkMock.addParticipant.mockResolvedValue(undefined as never);

    renderCanvas({ unions, identities, rootId: 'root', canContribute: true });
    await dragOnto('Sam', 'granny', 'below');

    expect(sdkMock.addParticipant).toHaveBeenCalledWith({
      id: 'u-grandparent',
      familyParticipantAddDto: { identityId: 'sam', role: FamilyParticipantRole.Child },
    });
    expect(sdkMock.createUnion).not.toHaveBeenCalled();
    // Reused, not duplicated: still exactly one card for Sam...
    const samCards = await screen.findAllByText('Sam');
    expect(samCards).toHaveLength(1);
    // ...and the original partnership with Root is still there, not replaced by the new one.
    expect(screen.getByText('Root')).toBeInTheDocument();
    const bars = await screen.findAllByTestId('family-union-bar');
    expect(bars).toHaveLength(2);
  });

  it('offers no drop targets to a view-only viewer', async () => {
    const unions: FamilyUnionDto[] = [union({ id: 'u1', partners: [known('root'), known('other')] })];
    const identities = { root: identity('Root'), other: identity('Other') };

    renderCanvas({ unions, identities, rootId: 'root', canContribute: false });
    await fireEvent.dragStart(cardFor('Other'), { dataTransfer: fakeDataTransfer() });

    expect(screen.queryAllByTestId('family-drop-zone')).toHaveLength(0);
  });

  // Paired control for A6: the identical fixture, but a contributor sees the zones appear.
  it('offers them to a contributor', async () => {
    const unions: FamilyUnionDto[] = [union({ id: 'u1', partners: [known('root'), known('other')] })];
    const identities = { root: identity('Root'), other: identity('Other') };

    renderCanvas({ unions, identities, rootId: 'root', canContribute: true });
    await fireEvent.dragStart(cardFor('Other'), { dataTransfer: fakeDataTransfer() });

    expect(screen.getAllByTestId('family-drop-zone').length).toBeGreaterThan(0);
  });
});
