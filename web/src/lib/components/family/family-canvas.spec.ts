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
  /** The viewer's OWN root — distinct from the layout anchor, and left unset by default so a
   * test only opts in to the "you are here" treatment when it is what's under test. */
  viewerRootId?: string | null;
  canContribute?: boolean;
}) {
  return render(FamilyCanvas, {
    unions: props.unions,
    identities: props.identities,
    rootId: props.rootId,
    viewerRootId: props.viewerRootId ?? null,
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

function cardById(identityId: string): HTMLElement {
  const card = document.querySelector<HTMLElement>(
    `[data-testid="family-node"][data-identity-id="${CSS.escape(identityId)}"]`,
  );
  if (!card) {
    throw new Error(`No family-node card for identity "${identityId}"`);
  }
  return card;
}

/** Drags the card named `sourceName` and drops it on `targetId`'s `position` zone — the same
 * `dragstart` → `dragover` → `drop` sequence a real drag performs, just with a synthetic
 * `DataTransfer`. The `dragover` is what reveals the zones: only the card under the pointer offers
 * its gestures, so that every card on the canvas isn't tiled with overlapping boxes. */
async function dragOnto(sourceName: string, targetId: string, position: 'above' | 'beside' | 'below') {
  const dataTransfer = fakeDataTransfer();
  await fireEvent.dragStart(cardFor(sourceName), { dataTransfer });
  await fireEvent.dragOver(cardById(targetId), { dataTransfer });
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

  // The card's title is the NAME and the derived label is the sub-line beneath it. Rendering the
  // label INSTEAD of the name is a real regression this feature shipped with: every card on a
  // rooted canvas read "your parent" / "your partner" and no name appeared anywhere, which is
  // unreadable the moment two people share a relation.
  it('titles a card with the name and puts the derived relation beneath it', () => {
    const unions: FamilyUnionDto[] = [union({ id: 'u1', partners: [known('root'), known('mia')], children: [] })];
    const identities = {
      root: identity('Alex', "that's you"),
      mia: identity('Mia', 'your partner'),
    };

    renderCanvas({ unions, identities, rootId: 'root' });

    expect(screen.getByText('Mia')).toBeInTheDocument();
    const relation = screen.getByText('your partner');
    expect(relation).toHaveAttribute('data-testid', 'family-node-relation');
    // Name and relation are two separate lines of the same card, not one standing in for the other.
    expect(relation.closest('[data-testid="family-node"]')).toContainElement(screen.getByText('Mia'));
  });

  // Two people can share a relation ("your parent" twice over); the name is what tells them apart.
  it('keeps both cards distinguishable when two people share one relation', () => {
    const unions: FamilyUnionDto[] = [
      union({ id: 'u1', partners: [known('ruth'), known('anton')], children: [known('root')] }),
    ];
    const identities = {
      ruth: identity('Ruth', 'your parent'),
      anton: identity('Anton', 'your parent'),
      root: identity('Alex', "that's you"),
    };

    renderCanvas({ unions, identities, rootId: 'root' });

    expect(screen.getByText('Ruth')).toBeInTheDocument();
    expect(screen.getByText('Anton')).toBeInTheDocument();
    expect(screen.getAllByText('your parent')).toHaveLength(2);
  });

  it('marks the viewer own card and leaves every other card unmarked', () => {
    const unions: FamilyUnionDto[] = [union({ id: 'u1', partners: [known('root'), known('mia')], children: [] })];
    const identities = { root: identity('Alex', "that's you"), mia: identity('Mia', 'your partner') };

    renderCanvas({ unions, identities, rootId: 'root', viewerRootId: 'root' });

    expect(screen.getAllByText('family_canvas_you_are_here')).toHaveLength(1);
  });

  it('marks nobody when the viewer is not part of this cluster', () => {
    // The negative control: a cluster laid out around its own `rootCandidateId` still has an
    // anchor, but nobody in it is the viewer.
    const unions: FamilyUnionDto[] = [union({ id: 'u1', partners: [known('casper'), known('nell')], children: [] })];
    const identities = { casper: identity('Casper'), nell: identity('Nell') };

    renderCanvas({ unions, identities, rootId: 'casper', viewerRootId: null });

    expect(screen.queryByText('family_canvas_you_are_here')).not.toBeInTheDocument();
  });

  // Mockup §1: the tray is the drag SOURCE for anyone not already on the canvas. Without it a
  // contributor is stuck with whoever was in the first union forever, because the drag gestures
  // can only rearrange people the canvas already draws.
  it('offers a contributor a tray to bring new people in from', () => {
    const unions: FamilyUnionDto[] = [union({ id: 'u1', partners: [known('root'), known('mia')], children: [] })];
    const identities = { root: identity('Alex'), mia: identity('Mia') };

    renderCanvas({ unions, identities, rootId: 'root', canContribute: true });

    expect(screen.getByTestId('family-tray')).toBeInTheDocument();
  });

  // `invalidateAll()` swaps the `unions` prop but does NOT recreate this component, so a canvas
  // that only read the prop once kept showing the old graph — a face dragged in from the tray
  // appeared solely after a manual page reload.
  it('picks up a graph the page reloads underneath it', async () => {
    const identities = { root: identity('Alex'), mia: identity('Mia'), iris: identity('Iris') };
    const before: FamilyUnionDto[] = [union({ id: 'u1', partners: [known('root'), known('mia')], children: [] })];
    const after: FamilyUnionDto[] = [
      union({ id: 'u1', partners: [known('root'), known('mia')], children: [known('iris')] }),
    ];

    const { rerender } = renderCanvas({ unions: before, identities, rootId: 'root' });
    expect(screen.queryByText('Iris')).not.toBeInTheDocument();

    await rerender({ unions: after, identities, rootId: 'root', viewerRootId: null, canContribute: false });

    expect(screen.getByText('Iris')).toBeInTheDocument();
  });

  it('offers no tray to a view-only viewer', () => {
    const unions: FamilyUnionDto[] = [union({ id: 'u1', partners: [known('root'), known('mia')], children: [] })];
    const identities = { root: identity('Alex'), mia: identity('Mia') };

    renderCanvas({ unions, identities, rootId: 'root', canContribute: false });

    expect(screen.queryByTestId('family-tray')).not.toBeInTheDocument();
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
    const dataTransfer = fakeDataTransfer();

    renderCanvas({ unions, identities, rootId: 'root', canContribute: false });
    await fireEvent.dragStart(cardFor('Other'), { dataTransfer });
    await fireEvent.dragOver(cardById('root'), { dataTransfer });

    expect(screen.queryAllByTestId('family-drop-zone')).toHaveLength(0);
  });

  // Paired control for A6: the identical fixture, but a contributor sees the zones appear.
  it('offers them to a contributor', async () => {
    const unions: FamilyUnionDto[] = [union({ id: 'u1', partners: [known('root'), known('other')] })];
    const identities = { root: identity('Root'), other: identity('Other') };
    const dataTransfer = fakeDataTransfer();

    renderCanvas({ unions, identities, rootId: 'root', canContribute: true });
    await fireEvent.dragStart(cardFor('Other'), { dataTransfer });
    await fireEvent.dragOver(cardById('root'), { dataTransfer });

    expect(screen.getAllByTestId('family-drop-zone').length).toBeGreaterThan(0);
  });

  // Every card showing its own three zones tiled the canvas with boxes that overlapped each other
  // and the neighbouring cards. Only the card actually being aimed at offers its gestures.
  it('offers gestures on the card under the pointer and no other', async () => {
    const unions: FamilyUnionDto[] = [
      union({ id: 'u1', partners: [known('root'), known('other')], children: [known('kid')] }),
    ];
    const identities = { root: identity('Root'), other: identity('Other'), kid: identity('Kid') };
    const dataTransfer = fakeDataTransfer();

    renderCanvas({ unions, identities, rootId: 'root', canContribute: true });
    await fireEvent.dragStart(cardFor('Other'), { dataTransfer });

    // Nothing is offered until a card is actually hovered.
    expect(screen.queryAllByTestId('family-drop-zone')).toHaveLength(0);

    await fireEvent.dragOver(cardById('root'), { dataTransfer });
    const zones = screen.getAllByTestId('family-drop-zone');
    expect(zones.length).toBeGreaterThan(0);
    expect(zones.every((zone) => zone.dataset.targetId === 'root')).toBe(true);

    // Moving to another card hands the gestures over rather than adding a second set.
    await fireEvent.dragOver(cardById('kid'), { dataTransfer });
    const moved = screen.getAllByTestId('family-drop-zone');
    expect(moved.every((zone) => zone.dataset.targetId === 'kid')).toBe(true);
  });
});

// Slice 11, Task 2: the union editor opens from the connector pill — the only place status and
// dates can be set (A7) — and only for a contributor (A6).
describe('FamilyCanvas union editor', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('does not open the editor for a view-only viewer', async () => {
    const unions: FamilyUnionDto[] = [
      union({ id: 'u1', status: FamilyUnionStatus.Married, partners: [known('root'), known('spouse')] }),
    ];
    const identities = { root: identity('Root'), spouse: identity('Spouse') };

    renderCanvas({ unions, identities, rootId: 'root', canContribute: false });
    // A view-only bar is a plain `<span>`, not a button — clicking it must do nothing.
    await fireEvent.click(screen.getByTestId('family-union-bar'));

    expect(screen.queryByTestId('family-union-editor')).not.toBeInTheDocument();
  });

  // Paired control for A6: the identical fixture, but a contributor can open the editor.
  it('opens the editor for a contributor', async () => {
    const unions: FamilyUnionDto[] = [
      union({ id: 'u1', status: FamilyUnionStatus.Married, partners: [known('root'), known('spouse')] }),
    ];
    const identities = { root: identity('Root'), spouse: identity('Spouse') };

    renderCanvas({ unions, identities, rootId: 'root', canContribute: true });
    await fireEvent.click(screen.getByTestId('family-union-bar'));

    expect(screen.getByTestId('family-union-editor')).toBeInTheDocument();
  });

  it('draws an ended union differently from a current one', async () => {
    // Exercises the FULL edit → save → re-render path (slice 10 already covers the static-props
    // case of this in its own like-named test) — changing status to divorced through the editor
    // must flip the SAME bar's ended styling, not just a freshly-mounted one.
    const unions: FamilyUnionDto[] = [
      union({
        id: 'u1',
        status: FamilyUnionStatus.Married,
        startDate: '1985-01-01',
        partners: [known('root'), known('spouse')],
      }),
    ];
    const identities = { root: identity('Root'), spouse: identity('Spouse') };
    sdkMock.updateUnion.mockResolvedValue(undefined as never);

    renderCanvas({ unions, identities, rootId: 'root', canContribute: true });

    const barBefore = screen.getByTestId('family-union-bar');
    expect(barBefore).toHaveAttribute('data-ended', 'false');
    const currentClassName = barBefore.className;

    await fireEvent.click(barBefore);
    const divorcedOption = screen
      .getAllByTestId('family-union-status-option')
      .find((element) => element.dataset.value === FamilyUnionStatus.Divorced)!;
    await fireEvent.click(divorcedOption);
    await fireEvent.click(screen.getByTestId('family-union-editor-save'));

    const barAfter = await screen.findByTestId('family-union-bar');
    expect(barAfter).toHaveAttribute('data-ended', 'true');
    expect(barAfter.className).not.toBe(currentClassName);
    expect(sdkMock.updateUnion).toHaveBeenCalledWith({
      id: 'u1',
      familyUnionUpdateDto: { status: FamilyUnionStatus.Divorced, startDate: '1985-01-01', endDate: null },
    });
  });
});

// A card is the only surface that can say who someone IS, rather than how they are related.
describe('FamilyCanvas person actions', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  const partnered = (): { unions: FamilyUnionDto[]; identities: Record<string, FamilyIdentityDto> } => ({
    unions: [union({ id: 'u1', partners: [known('root'), known('mia')], children: [known('iris')] })],
    identities: { root: identity('Alex'), mia: identity('Mia'), iris: identity('Iris') },
  });

  it('opens a menu on a card for a contributor', async () => {
    const { unions, identities } = partnered();
    renderCanvas({ unions, identities, rootId: 'root', canContribute: true });

    await fireEvent.click(cardFor('Mia'));

    expect(screen.getByTestId('family-person-menu')).toBeInTheDocument();
  });

  it('opens no menu for a view-only viewer', async () => {
    const { unions, identities } = partnered();
    renderCanvas({ unions, identities, rootId: 'root', canContribute: false });

    await fireEvent.click(cardFor('Mia'));

    expect(screen.queryByTestId('family-person-menu')).not.toBeInTheDocument();
  });

  // §6: gender is what turns "your parent" into "your mother". It is an attribute of the PERSON,
  // so it is set from their card, never from a union.
  it('records a gender against the identity', async () => {
    const { unions, identities } = partnered();
    sdkMock.updateGender.mockResolvedValue(undefined as never);

    renderCanvas({ unions, identities, rootId: 'root', canContribute: true });
    await fireEvent.click(cardFor('Mia'));
    const female = screen
      .getAllByTestId('family-person-gender-option')
      .find((option) => option.textContent?.includes('family_canvas_gender_female'))!;
    await fireEvent.click(female);

    expect(sdkMock.updateGender).toHaveBeenCalledWith({
      id: 'mia',
      familyGenderUpdateDto: { gender: 'female' },
    });
  });

  // Half-removing someone — out of one union but still in another — is not a state worth being
  // able to reach by accident, so removal takes them out of every union they appear in.
  it('removes a person from every union they appear in', async () => {
    const unions: FamilyUnionDto[] = [
      union({ id: 'u1', partners: [known('root'), known('mia')], children: [] }),
      union({ id: 'u2', partners: [known('mia'), known('other')], children: [known('kid')] }),
    ];
    const identities = {
      root: identity('Alex'),
      mia: identity('Mia'),
      other: identity('Other'),
      kid: identity('Kid'),
    };
    sdkMock.removeParticipant.mockResolvedValue(undefined as never);

    renderCanvas({ unions, identities, rootId: 'root', canContribute: true });
    await fireEvent.click(cardFor('Mia'));
    await fireEvent.click(screen.getByTestId('family-person-remove'));

    expect(sdkMock.removeParticipant).toHaveBeenCalledWith({ id: 'u1', identityId: 'mia' });
    expect(sdkMock.removeParticipant).toHaveBeenCalledWith({ id: 'u2', identityId: 'mia' });
  });
});

// Deleting a union was reachable from the API since the write path shipped, but from nowhere in
// the UI — mockup §2 puts the danger action in the union editor.
describe('FamilyCanvas union deletion', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  const twoUnions = () => ({
    unions: [
      union({ id: 'u-keep', partners: [known('root'), known('mia')], children: [known('kid')] }),
      union({ id: 'u-drop', partners: [known('mia'), known('other')], children: [] }),
    ],
    identities: {
      root: identity('Root'),
      mia: identity('Mia'),
      other: identity('Other'),
      kid: identity('Kid'),
    },
  });

  it('deletes the union whose editor is open', async () => {
    const { unions, identities } = twoUnions();
    sdkMock.deleteUnion.mockResolvedValue(undefined as never);

    renderCanvas({ unions, identities, rootId: 'root', canContribute: true });
    const bars = screen.getAllByTestId('family-union-bar');
    await fireEvent.click(bars[0]!);
    await fireEvent.click(screen.getByTestId('family-union-delete'));

    expect(sdkMock.deleteUnion).toHaveBeenCalledTimes(1);
    expect(sdkMock.deleteUnion).toHaveBeenCalledWith({ id: expect.any(String) });
  });

  // A6: a view-only viewer never gets the editor at all, so there is nothing to delete from.
  it('offers no deletion to a view-only viewer', async () => {
    const { unions, identities } = twoUnions();

    renderCanvas({ unions, identities, rootId: 'root', canContribute: false });
    await fireEvent.click(screen.getAllByTestId('family-union-bar')[0]!);

    expect(screen.queryByTestId('family-union-delete')).not.toBeInTheDocument();
  });

  // The relationship goes; the people stay. A deletion that also swept the cards away would be
  // indistinguishable on screen from having removed the people themselves.
  it('keeps every person on the canvas after their union is deleted', async () => {
    const { unions, identities } = twoUnions();
    sdkMock.deleteUnion.mockResolvedValue(undefined as never);

    renderCanvas({ unions, identities, rootId: 'root', canContribute: true });
    await fireEvent.click(screen.getAllByTestId('family-union-bar')[0]!);
    await fireEvent.click(screen.getByTestId('family-union-delete'));

    expect(screen.getByText('Root')).toBeInTheDocument();
    expect(screen.getByText('Mia')).toBeInTheDocument();
  });
});

// A6's dashed "+ Add a parent" card looked like a button from the day it shipped and did nothing
// when clicked. It fills the free partner seat of the union it belongs to.
describe('FamilyCanvas empty seats', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  const withFreeSeat = () => ({
    unions: [union({ id: 'u-solo', partners: [known('mom')], children: [known('root')] })],
    identities: { mom: identity('Mom'), root: identity('Root') },
  });

  it('turns the tray into a parent picker when the dashed seat is clicked', async () => {
    const { unions, identities } = withFreeSeat();
    sdkMock.getAllPeople.mockResolvedValue({ people: [], hasNextPage: false, total: 0 } as never);

    renderCanvas({ unions, identities, rootId: 'root', canContribute: true });
    await fireEvent.click(screen.getByTestId('family-empty-seat'));

    expect(screen.getByTestId('family-empty-seat')).toHaveAttribute('data-active', 'true');
    expect(screen.getByText('family_canvas_tray_pick_parent')).toBeInTheDocument();
  });

  it('adds the chosen person to that union as a partner', async () => {
    const { unions, identities } = withFreeSeat();
    sdkMock.getAllPeople.mockResolvedValue({
      people: [{ id: 'person-9', name: 'Dad', thumbnailPath: '', isHidden: false, birthDate: null }],
      hasNextPage: false,
      total: 1,
    } as never);
    sdkMock.addParticipant.mockResolvedValue(undefined as never);

    renderCanvas({ unions, identities, rootId: 'root', canContribute: true });
    await fireEvent.click(screen.getByTestId('family-empty-seat'));
    await vi.waitFor(() => expect(screen.getAllByTestId('family-tray-person').length).toBeGreaterThan(0));
    await fireEvent.click(screen.getAllByTestId('family-tray-person')[0]!);

    expect(sdkMock.addParticipant).toHaveBeenCalledWith({
      id: 'u-solo',
      familyParticipantAddDto: { personId: 'person-9', role: FamilyParticipantRole.Partner },
    });
  });
});

// E52 for partners, the mirror of the `above` rule: a union holds at most two partners, and the
// canvas draws a dashed "+ Add a parent" in a free seat. Dropping someone into that seat must FILL
// it, not open a second union alongside — otherwise partnering two people who already share a
// child leaves the child's union half-empty and the couple drawn twice.
describe('FamilyCanvas partner drops', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('fills the free partner seat of the union the target is already in', async () => {
    const unions: FamilyUnionDto[] = [union({ id: 'u-solo', partners: [known('stan')], children: [known('claire')] })];
    const identities = { stan: identity('Stanley'), claire: identity('Claire'), gudrin: identity('Gudrin') };
    // Gudrin is on the canvas as a partner in her own union, so she can be dragged from a card.
    unions.push(union({ id: 'u-gudrin', partners: [known('gudrin'), known('claire')], children: [] }));
    sdkMock.addParticipant.mockResolvedValue(undefined as never);

    renderCanvas({ unions, identities, rootId: 'claire', canContribute: true });
    await dragOnto('Gudrin', 'stan', 'beside');

    expect(sdkMock.addParticipant).toHaveBeenCalledWith({
      id: 'u-solo',
      familyParticipantAddDto: { identityId: 'gudrin', role: FamilyParticipantRole.Partner },
    });
    expect(sdkMock.createUnion).not.toHaveBeenCalled();
  });

  // The negative control: with both seats taken there is nothing to fill, so a drop beside starts
  // a genuinely separate relationship.
  it('starts a new union when the target already has two partners', async () => {
    const unions: FamilyUnionDto[] = [
      union({ id: 'u-full', partners: [known('stan'), known('nell')], children: [known('claire')] }),
    ];
    const identities = { stan: identity('Stanley'), nell: identity('Nell'), claire: identity('Claire') };
    sdkMock.createUnion.mockResolvedValue({ id: 'new-union' });

    renderCanvas({ unions, identities, rootId: 'claire', canContribute: true });
    await dragOnto('Claire', 'stan', 'beside');

    expect(sdkMock.createUnion).toHaveBeenCalled();
    expect(sdkMock.addParticipant).not.toHaveBeenCalled();
  });
});
