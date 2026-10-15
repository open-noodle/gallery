import type { PersonResponseDto } from '@immich/sdk';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
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
    otherPeople: [],
    sharedBy: [],
    sharedWith: [],
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
  it('lists each relation with its derived label', async () => {
    await render(FamilyRelationsPanel, {
      props: { isPet: false, access: 'view', relations: knownRelations },
    });

    expect(page.getByTestId('family-relation-row').elements()).toHaveLength(4);
    expect(page.getByText('Anton').element()).toBeInTheDocument();
    expect(page.getByText('Ruth').element()).toBeInTheDocument();
    expect(page.getByText('Oskar').element()).toBeInTheDocument();
    expect(page.getByText('Juno').element()).toBeInTheDocument();
    expect(page.getByText('parent').elements()).toHaveLength(2);
    expect(page.getByText('partner · since 2018').element()).toBeInTheDocument();
    expect(page.getByText('child').element()).toBeInTheDocument();
  });

  // A5: a participant the viewer cannot resolve is a solid, muted "Someone" row — never dropped
  // from the list and never drawn like the dashed "empty seat" affordance (that belongs to the
  // canvas slice, not here).
  it('shows an anonymous entry for a participant the viewer cannot resolve', async () => {
    await render(FamilyRelationsPanel, {
      props: {
        isPet: false,
        access: 'view',
        relations: [
          { kind: 'known', person: makePerson({ id: 'anton', name: 'Anton' }), label: 'parent' },
          { kind: 'anonymous', slot: 2, label: 'parent' },
        ],
      },
    });

    const anonymousSeat = page.getByTestId('family-anonymous-seat').element();
    expect(anonymousSeat).toBeInTheDocument();
    expect(anonymousSeat.textContent).toContain('parent');
    // Distinct rendering from a resolvable row: no real name, an italicised placeholder instead.
    expect(page.getByText('Anton').element()).toBeInTheDocument();
    expect(page.getByTestId('family-relation-row').elements()).toHaveLength(1);
  });

  // The redaction guard: even when a resolvable sibling row carries a real identity id, that id
  // must never surface anywhere inside the anonymous row's own markup.
  it('never renders an identity id for an anonymous entry', async () => {
    const sensitiveIdentityId = 'identity-must-not-leak-0000';
    await render(FamilyRelationsPanel, {
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
    expect(page.getByTestId('family-relations-panel').element().getHTML()).toContain(sensitiveIdentityId);
    const anonymousSeat = page.getByTestId('family-anonymous-seat').element();
    expect(anonymousSeat.getHTML()).not.toContain(sensitiveIdentityId);
  });

  // E55, paired with the positive control below on the exact same `knownRelations` fixture —
  // without it, this would pass equally well against a component that never renders anything.
  it('renders no relations section for a pet', async () => {
    const { rerender } = await render(FamilyRelationsPanel, {
      props: { isPet: true, access: 'view', relations: knownRelations },
    });

    expect(page.getByTestId('family-relations-panel').query()).not.toBeInTheDocument();

    await rerender({ isPet: false, access: 'view', relations: knownRelations });
    expect(page.getByTestId('family-relations-panel').element()).toBeInTheDocument();
  });

  // A12, paired with the positive control below on the exact same `knownRelations` fixture.
  it('renders no relations section when the viewer has no family access', async () => {
    const { rerender } = await render(FamilyRelationsPanel, {
      props: { isPet: false, access: 'none', relations: knownRelations },
    });

    expect(page.getByTestId('family-relations-panel').query()).not.toBeInTheDocument();
    expect(page.getByText('Anton').query()).not.toBeInTheDocument();

    await rerender({ isPet: false, access: 'view', relations: knownRelations });
    expect(page.getByTestId('family-relations-panel').element()).toBeInTheDocument();
    expect(page.getByText('Anton').element()).toBeInTheDocument();
  });

  // The dedicated positive control named in the plan: without this, the two negatives above
  // would pass just as well against a component that renders nothing, ever.
  it('renders the relations section for a person when the viewer has view access', async () => {
    await render(FamilyRelationsPanel, {
      props: { isPet: false, access: 'view', relations: knownRelations },
    });

    expect(page.getByTestId('family-relations-panel').element()).toBeInTheDocument();
    expect(page.getByTestId('family-relation-row').elements()).toHaveLength(4);
  });

  it('offers no add-relationship affordance to a view-only viewer', async () => {
    await render(FamilyRelationsPanel, {
      props: { isPet: false, access: 'view', relations: knownRelations },
    });

    expect(page.getByTestId('family-relations-panel').element()).toBeInTheDocument();
    expect(page.getByTestId('family-add-relationship').query()).not.toBeInTheDocument();
  });

  it('offers it to a contributor', async () => {
    await render(FamilyRelationsPanel, {
      props: { isPet: false, access: 'contribute', relations: knownRelations },
    });

    expect(page.getByTestId('family-add-relationship').element()).toBeInTheDocument();
  });

  // This button shipped inert: `onAddRelationship` is an optional prop and the person page never
  // passed one, so `onclick={undefined}` rendered a control that did nothing. Asserting the
  // button EXISTS (as the two tests above do) cannot catch that — only invoking it can.
  it('invokes its handler when clicked', async () => {
    const onAddRelationship = vi.fn();
    await render(FamilyRelationsPanel, {
      props: { isPet: false, access: 'contribute', relations: knownRelations, onAddRelationship },
    });

    await userEvent.click(page.getByTestId('family-add-relationship').element());

    expect(onAddRelationship).toHaveBeenCalledTimes(1);
  });
});
