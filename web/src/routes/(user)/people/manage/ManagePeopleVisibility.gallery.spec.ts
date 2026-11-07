import { sdkMock } from '#lib/gallery/__mocks__/sdk.mock.ts';
import { factory } from '#test/unit/factories.ts';
import { renderWithTooltips } from '#test/unit/helpers.ts';
import type { PersonResponseDto } from '@immich/sdk';
import type { ComponentProps } from 'svelte';
import { expect, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import ManagePeoplePage from './+page.svelte';

const { gotoMock } = vi.hoisted(() => ({
  gotoMock: vi.fn(),
}));

vi.mock('$app/navigation', async () => ({
  ...(await import('#test/unit/mocks/app-navigation.ts')),
  goto: gotoMock,
}));

vi.mock('@immich/ui', async (importOriginal) => {
  const original = await importOriginal<typeof import('@immich/ui')>();
  return {
    ...original,
    toastManager: { primary: vi.fn(), warning: vi.fn() },
  };
});

const getData = (
  people: PersonResponseDto[],
  hasNextPage = false,
): ComponentProps<typeof ManagePeoplePage>['data'] => ({
  error: undefined,
  meta: { title: 'Manage people visibility' },
  asset: undefined,
  people: {
    people,
    total: people.length,
    hidden: people.filter((person) => person.isHidden).length,
    hasNextPage,
  },
});

describe('People manage page', () => {
  beforeEach(() => {
    sdkMock.updatePeople.mockResolvedValue([]);
    gotoMock.mockResolvedValue(undefined);
  });

  it('saves global visibility through updatePeople and maps updated hidden state back to global people', async () => {
    const people = [
      factory.person({ id: 'a', name: 'Alice', isHidden: false }),
      factory.person({ id: 'b', name: 'Bob', isHidden: true }),
      factory.person({ id: 'c', name: 'Charlie', isHidden: false }),
    ];
    sdkMock.updatePeople.mockResolvedValueOnce([
      { id: 'a', success: true },
      { id: 'b', success: false },
    ]);
    await renderWithTooltips(ManagePeoplePage, { data: getData(people) });

    await userEvent.click(page.getByTestId('visibility-person-a'));
    await userEvent.click(page.getByTestId('visibility-person-b'));
    await userEvent.click(page.getByTestId('save-visibility'));

    await vi.waitFor(() => {
      expect(sdkMock.updatePeople).toHaveBeenCalledWith({
        peopleUpdateDto: {
          people: [
            { id: 'a', isHidden: true },
            { id: 'b', isHidden: false },
          ],
        },
      });
    });
    await expect.element(page.getByTestId('visibility-person-a')).toHaveAttribute('aria-pressed', 'true');
    await expect.element(page.getByTestId('visibility-person-b')).toHaveAttribute('aria-pressed', 'false');
    await expect.element(page.getByTestId('visibility-person-c')).toHaveAttribute('aria-pressed', 'false');
    expect(gotoMock).toHaveBeenCalledWith('/people');
  });
});
