import { flushSync } from 'svelte';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { ManagedPerson } from './people-types';
import PersonTileWrapper from './person-tile.test-wrapper.svelte';

const basePerson = (overrides: Partial<ManagedPerson> = {}): ManagedPerson => ({
  id: 'person-1',
  displayName: 'Ada Lovelace',
  thumbnailUrl: '/api/people/person-1/thumbnail',
  href: '/people/person-1',
  isHidden: false,
  ...overrides,
});

const actions = () => page.getByRole('button', { name: 'Actions' });

// mouseenter / mouseleave do not bubble and are what the tile listens for, so they are dispatched on
// the tile itself rather than synthesised through pointer moves.
const mouse = (type: 'mouseenter' | 'mouseleave') => {
  page.getByRole('group').element().dispatchEvent(new MouseEvent(type));
  flushSync();
};

describe('PersonTile', () => {
  it('renders link, thumbnail title, favorite badge, pet badge, and footer slot', async () => {
    await render(PersonTileWrapper, {
      person: basePerson({
        displayName: 'Mochi',
        isFavorite: true,
        type: 'pet',
        species: 'cat',
      }),
      showFooter: true,
    });

    await expect.element(page.getByRole('link', { name: 'Mochi' })).toHaveAttribute('href', '/people/person-1');
    await expect.element(page.getByTitle('Mochi')).toHaveAttribute('src', '/api/people/person-1/thumbnail');
    await expect.element(page.getByLabelText('favorite')).toBeInTheDocument();
    // R8.2 (review-fixes F13): the badge gets role="img" + aria-label, and the tooltip goes
    // through pet-species.ts's i18n map. svelte-i18n's `dev` fallback locale (test setup) renders
    // an unmatched key literally, so the resolved key ('species_cat') proves the species went
    // through the map rather than being used raw.
    const petBadge = page.getByTitle('species_cat');
    await expect.element(petBadge).toHaveAttribute('role', 'img');
    await expect.element(petBadge).toHaveAttribute('aria-label', 'species_cat');
    await expect.element(page.getByText('Footer content')).toBeInTheDocument();
  });

  // A space People grid maps SharedSpacePersonResponseDto, which carries `type` but no `species`, so
  // the badge would otherwise be a `role="img"` with no accessible name (WCAG 1.1.1).
  it('names the pet badge generically when the person carries no species', async () => {
    await render(PersonTileWrapper, { person: basePerson({ displayName: 'Rex', type: 'pet' }) });

    const petBadge = page.getByTitle('pet', { exact: true });
    await expect.element(petBadge).toHaveAttribute('role', 'img');
    await expect.element(petBadge).toHaveAttribute('aria-label', 'pet');
  });

  it('renders action menu slot only on hover when provided', async () => {
    await render(PersonTileWrapper, { person: basePerson(), showActionMenu: true });

    expect(actions().query()).toBeNull();

    mouse('mouseenter');
    await expect.element(actions()).toBeInTheDocument();

    mouse('mouseleave');
    expect(actions().query()).toBeNull();
  });

  it('keeps actions visible on mouse leave while focus remains inside and hides them after focus leaves', async () => {
    const screen = await render(PersonTileWrapper, { person: basePerson(), showActionMenu: true });

    page.getByRole('link', { name: 'Ada Lovelace' }).element().focus();
    flushSync();
    await expect.element(actions()).toBeInTheDocument();

    // Moving focus to the action button fires a focusout on the link whose relatedTarget is inside the tile.
    (actions().element() as HTMLElement).focus();
    flushSync();

    mouse('mouseleave');
    await expect.element(actions()).toBeInTheDocument();

    // Focus leaves the tile: focusout with no relatedTarget.
    (actions().element() as HTMLElement).blur();
    flushSync();

    expect(actions().query()).toBeNull();
    expect(screen.container.textContent).not.toContain('Actions');
  });

  it('does not render action menu slot when actions are disabled', async () => {
    await render(PersonTileWrapper, { person: basePerson(), showActionMenu: false });

    mouse('mouseenter');

    expect(actions().query()).toBeNull();
  });

  it('does not render favorite or pet badges when person does not qualify', async () => {
    await render(PersonTileWrapper, { person: basePerson(), showFooter: true });

    await expect.element(page.getByText('Footer content')).toBeInTheDocument();
    expect(page.getByLabelText('favorite').query()).toBeNull();
    expect(page.getByTitle('species_cat').query()).toBeNull();
  });
});
