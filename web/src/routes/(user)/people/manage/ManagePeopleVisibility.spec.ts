import { getIntersectionObserverMock } from '$lib/__mocks__/intersection-observer.mock';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { personFactory } from '@test-data/factories/person-factory';
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'svelte';
import { vi } from 'vitest';
import ManagePeoplePage from './+page.svelte';
import ManagePeoplePageTestWrapper from './ManagePeopleVisibility.test-wrapper.svelte';

const { gotoMock } = vi.hoisted(() => ({
  gotoMock: vi.fn(),
}));

vi.mock('$app/navigation', () => ({ goto: gotoMock }));

vi.mock(import('$lib/managers/feature-flags-manager.svelte'), function () {
  return {
    featureFlagsManager: { init: vi.fn(), loadFeatureFlags: vi.fn(), value: {} } as never,
  };
});

vi.mock('@immich/ui', async (importOriginal) => {
  const original = await importOriginal<typeof import('@immich/ui')>();
  return {
    ...original,
    toastManager: { primary: vi.fn(), warning: vi.fn() },
  };
});

const getData = (
  people: ReturnType<typeof personFactory.build>[],
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
    vi.stubGlobal('IntersectionObserver', getIntersectionObserverMock());
    vi.clearAllMocks();
    sdkMock.updatePeople.mockResolvedValue([]);
    gotoMock.mockResolvedValue(undefined);
  });

  it('keeps toggled hidden state when loading more people', async () => {
    const [personA, personB, personC] = [
      personFactory.build({ id: 'a', isHidden: false }),
      personFactory.build({ id: 'b', isHidden: false }),
      personFactory.build({ id: 'c', isHidden: true }),
    ];

    const { rerender } = render(ManagePeoplePageTestWrapper, { data: getData([personA, personB], true) });
    const user = userEvent.setup();

    expect(screen.getByTestId('visibility-person-a')).toHaveAttribute('aria-pressed', 'false');

    await user.click(screen.getByTestId('visibility-person-a'));
    expect(screen.getByTestId('visibility-person-a')).toHaveAttribute('aria-pressed', 'true');

    await rerender({ data: getData([personA, personB, personC], false) });

    expect(screen.getByTestId('visibility-person-a')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('visibility-person-c')).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows newly loaded hidden people as hidden', async () => {
    const [personA, personB, personC] = [
      personFactory.build({ id: 'a', isHidden: false }),
      personFactory.build({ id: 'b', isHidden: false }),
      personFactory.build({ id: 'c', isHidden: true }),
    ];

    const { rerender } = render(ManagePeoplePageTestWrapper, { data: getData([personA, personB], true) });

    await rerender({ data: getData([personA, personB, personC], false) });

    expect(screen.getByTestId('visibility-person-a')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('visibility-person-c')).toHaveAttribute('aria-pressed', 'true');
  });

  it('saves global visibility through updatePeople and maps updated hidden state back to global people', async () => {
    const people = [
      personFactory.build({ id: 'a', name: 'Alice', isHidden: false }),
      personFactory.build({ id: 'b', name: 'Bob', isHidden: true }),
      personFactory.build({ id: 'c', name: 'Charlie', isHidden: false }),
    ];
    sdkMock.updatePeople.mockResolvedValueOnce([
      { id: 'a', success: true },
      { id: 'b', success: false },
    ]);
    render(ManagePeoplePageTestWrapper, { data: getData(people) });
    const user = userEvent.setup();

    await user.click(screen.getByTestId('visibility-person-a'));
    await user.click(screen.getByTestId('visibility-person-b'));
    await user.click(screen.getByTestId('save-visibility'));

    await waitFor(() => {
      expect(sdkMock.updatePeople).toHaveBeenCalledWith({
        peopleUpdateDto: {
          people: [
            { id: 'a', isHidden: true },
            { id: 'b', isHidden: false },
          ],
        },
      });
    });
    expect(screen.getByTestId('visibility-person-a')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('visibility-person-b')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('visibility-person-c')).toHaveAttribute('aria-pressed', 'false');
    expect(gotoMock).toHaveBeenCalledWith('/people');
  });
});
