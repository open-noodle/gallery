import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { VisibilityPerson } from './people-types';
import PeopleVisibilityModalWrapper from './people-visibility-modal.test-wrapper.svelte';

// The show/hide screen lists pets alongside humans — deliberately, since hiding a misdetected
// species bucket ("sheep" that is really a rock) is the only way to get rid of it. But
// VisibilityPerson used to drop type/species, so those tiles rendered indistinguishably from
// people. Same `role="img"` accessible-name gap the People-page tiles had.
const person = (overrides: Partial<VisibilityPerson> = {}): VisibilityPerson => ({
  id: 'person-1',
  displayName: 'Ada',
  thumbnailUrl: '/api/people/person-1/thumbnail',
  isHidden: false,
  ...overrides,
});

describe('PeopleVisibilityModal pet badge', () => {
  it('badges a pet with its translated species', async () => {
    await render(PeopleVisibilityModalWrapper, {
      props: {
        people: [person({ id: 'pet-1', displayName: 'Mochi', type: 'pet', species: 'cat' })],
        onClose: () => {},
        onUpdate: () => {},
        saveVisibilityChanges: () => Promise.resolve({ successCount: 0, failCount: 0 }),
      },
    });

    const badge = page.getByTestId('pet-badge');
    await expect.element(badge).toHaveAttribute('role', 'img');
    await expect.element(badge).toHaveAttribute('aria-label', 'species_cat');
  });

  it('falls back to the generic pet label when no species is recorded', async () => {
    await render(PeopleVisibilityModalWrapper, {
      props: {
        people: [person({ id: 'pet-2', displayName: 'Rex', type: 'pet' })],
        onClose: () => {},
        onUpdate: () => {},
        saveVisibilityChanges: () => Promise.resolve({ successCount: 0, failCount: 0 }),
      },
    });

    await expect.element(page.getByTestId('pet-badge')).toHaveAttribute('aria-label', 'pet');
  });

  it('renders no badge for a human', async () => {
    await render(PeopleVisibilityModalWrapper, {
      props: {
        people: [person({ type: 'person' })],
        onClose: () => {},
        onUpdate: () => {},
        saveVisibilityChanges: () => Promise.resolve({ successCount: 0, failCount: 0 }),
      },
    });

    await expect.element(page.getByText('Ada')).toBeInTheDocument();
    expect(page.getByTestId('pet-badge').query()).toBeNull();
  });
});
