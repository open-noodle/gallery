import type { PersonResponseDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import FamilyRelationsPanel from './FamilyRelationsPanel.svelte';
import type { FamilyRelationEntry } from './family-relations';

function makePerson(overrides: Partial<PersonResponseDto> = {}): PersonResponseDto {
  return {
    id: 'person-1',
    name: 'Anton',
    birthDate: null,
    thumbnailPath: '/thumb.jpg',
    isHidden: false,
    isFavorite: false,
    color: undefined,
    updatedAt: '2026-01-02T00:00:00.000Z',
    type: 'person',
    species: null,
    ...overrides,
  };
}

// A representative set of the page person's own relations, matching the mockup's §4 "Lena"
// panel: two parents, a partner and a child, all resolvable.
const knownRelations: FamilyRelationEntry[] = [
  { kind: 'known', person: makePerson({ id: 'anton', name: 'Anton' }), label: 'parent' },
  { kind: 'known', person: makePerson({ id: 'ruth', name: 'Ruth' }), label: 'parent' },
  { kind: 'known', person: makePerson({ id: 'oskar', name: 'Oskar' }), label: 'partner · since 2018' },
  { kind: 'known', person: makePerson({ id: 'juno', name: 'Juno' }), label: 'child' },
];

describe('FamilyRelationsPanel', () => {
  it('lists each relation with its derived label', () => {
    render(FamilyRelationsPanel, {
      props: { isPet: false, access: 'view', relations: knownRelations },
    });

    expect(screen.getAllByTestId('family-relation-row')).toHaveLength(4);
    expect(screen.getByText('Anton')).toBeInTheDocument();
    expect(screen.getByText('Ruth')).toBeInTheDocument();
    expect(screen.getByText('Oskar')).toBeInTheDocument();
    expect(screen.getByText('Juno')).toBeInTheDocument();
    expect(screen.getAllByText('parent')).toHaveLength(2);
    expect(screen.getByText('partner · since 2018')).toBeInTheDocument();
    expect(screen.getByText('child')).toBeInTheDocument();
  });

  // A5: a participant the viewer cannot resolve is a solid, muted "Someone" row — never dropped
  // from the list and never drawn like the dashed "empty seat" affordance (that belongs to the
  // canvas slice, not here).
  it('shows an anonymous entry for a participant the viewer cannot resolve', () => {
    render(FamilyRelationsPanel, {
      props: {
        isPet: false,
        access: 'view',
        relations: [
          { kind: 'known', person: makePerson({ id: 'anton', name: 'Anton' }), label: 'parent' },
          { kind: 'anonymous', slot: 2, label: 'parent' },
        ],
      },
    });

    const anonymousSeat = screen.getByTestId('family-anonymous-seat');
    expect(anonymousSeat).toBeInTheDocument();
    expect(anonymousSeat).toHaveTextContent('parent');
    // Distinct rendering from a resolvable row: no real name, an italicised placeholder instead.
    expect(screen.getByText('Anton')).toBeInTheDocument();
    expect(screen.getAllByTestId('family-relation-row')).toHaveLength(1);
  });

  // The redaction guard: even when a resolvable sibling row carries a real identity id, that id
  // must never surface anywhere inside the anonymous row's own markup.
  it('never renders an identity id for an anonymous entry', () => {
    const sensitiveIdentityId = 'identity-must-not-leak-0000';
    render(FamilyRelationsPanel, {
      props: {
        isPet: false,
        access: 'view',
        relations: [
          { kind: 'known', person: makePerson({ id: sensitiveIdentityId, name: 'Anton' }), label: 'parent' },
          { kind: 'anonymous', slot: 5, label: 'parent' },
        ],
      },
    });

    // The sensitive id legitimately appears elsewhere in the panel (it is Anton's own,
    // resolvable avatar URL) — the guard is that it never reaches the ANONYMOUS row specifically.
    expect(screen.getByTestId('family-relations-panel').getHTML()).toContain(sensitiveIdentityId);
    const anonymousSeat = screen.getByTestId('family-anonymous-seat');
    expect(anonymousSeat.getHTML()).not.toContain(sensitiveIdentityId);
  });

  // E55, paired with the positive control below on the exact same `knownRelations` fixture —
  // without it, this would pass equally well against a component that never renders anything.
  it('renders no relations section for a pet', async () => {
    const { rerender } = render(FamilyRelationsPanel, {
      props: { isPet: true, access: 'view', relations: knownRelations },
    });

    expect(screen.queryByTestId('family-relations-panel')).not.toBeInTheDocument();

    await rerender({ isPet: false, access: 'view', relations: knownRelations });
    expect(screen.getByTestId('family-relations-panel')).toBeInTheDocument();
  });

  // A12, paired with the positive control below on the exact same `knownRelations` fixture.
  it('renders no relations section when the viewer has no family access', async () => {
    const { rerender } = render(FamilyRelationsPanel, {
      props: { isPet: false, access: 'none', relations: knownRelations },
    });

    expect(screen.queryByTestId('family-relations-panel')).not.toBeInTheDocument();
    expect(screen.queryByText('Anton')).not.toBeInTheDocument();

    await rerender({ isPet: false, access: 'view', relations: knownRelations });
    expect(screen.getByTestId('family-relations-panel')).toBeInTheDocument();
    expect(screen.getByText('Anton')).toBeInTheDocument();
  });

  // The dedicated positive control named in the plan: without this, the two negatives above
  // would pass just as well against a component that renders nothing, ever.
  it('renders the relations section for a person when the viewer has view access', () => {
    render(FamilyRelationsPanel, {
      props: { isPet: false, access: 'view', relations: knownRelations },
    });

    expect(screen.getByTestId('family-relations-panel')).toBeInTheDocument();
    expect(screen.getAllByTestId('family-relation-row')).toHaveLength(4);
  });

  it('offers no add-relationship affordance to a view-only viewer', () => {
    render(FamilyRelationsPanel, {
      props: { isPet: false, access: 'view', relations: knownRelations },
    });

    expect(screen.getByTestId('family-relations-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('family-add-relationship')).not.toBeInTheDocument();
  });

  it('offers it to a contributor', () => {
    render(FamilyRelationsPanel, {
      props: { isPet: false, access: 'contribute', relations: knownRelations },
    });

    expect(screen.getByTestId('family-add-relationship')).toBeInTheDocument();
  });

  // This button shipped inert: `onAddRelationship` is an optional prop and the person page never
  // passed one, so `onclick={undefined}` rendered a control that did nothing. Asserting the
  // button EXISTS (as the two tests above do) cannot catch that — only invoking it can.
  it('invokes its handler when clicked', async () => {
    const onAddRelationship = vi.fn();
    render(FamilyRelationsPanel, {
      props: { isPet: false, access: 'contribute', relations: knownRelations, onAddRelationship },
    });

    await userEvent.click(screen.getByTestId('family-add-relationship'));

    expect(onAddRelationship).toHaveBeenCalledTimes(1);
  });
});
