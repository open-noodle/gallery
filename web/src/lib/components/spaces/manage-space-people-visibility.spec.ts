import { sdkMock } from '#lib/gallery/__mocks__/sdk.mock.ts';
import type { SharedSpacePersonResponseDto } from '@immich/sdk';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import ManageSpacePeopleVisibilityWrapper from './manage-space-people-visibility.test-wrapper.svelte';

vi.mock('@immich/ui', async (importOriginal) => {
  const original = await importOriginal<typeof import('@immich/ui')>();
  return {
    ...original,
    toastManager: { primary: vi.fn(), warning: vi.fn() },
  };
});

function makePerson(overrides: Partial<SharedSpacePersonResponseDto> = {}): SharedSpacePersonResponseDto {
  return {
    id: 'person-1',
    name: 'John Doe',
    alias: null,
    assetCount: 5,
    faceCount: 10,
    isHidden: false,
    thumbnailPath: '/thumb.jpg',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    spaceId: 'space-1',
    ...overrides,
  } as SharedSpacePersonResponseDto;
}

describe('ManageSpacePeopleVisibility', () => {
  const onClose = vi.fn();
  const onUpdate = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    sdkMock.updateSpacePerson.mockResolvedValue({} as SharedSpacePersonResponseDto);
  });

  async function renderComponent(people: SharedSpacePersonResponseDto[] = [makePerson()]) {
    return render(ManageSpacePeopleVisibilityWrapper, {
      props: {
        people,
        spaceId: 'space-1',
        onClose,
        onUpdate,
      },
    });
  }

  it('should render all people including hidden ones', async () => {
    const people = [
      makePerson({ id: 'p1', name: 'Alice', isHidden: false }),
      makePerson({ id: 'p2', name: 'Bob', isHidden: true }),
    ];
    await renderComponent(people);

    expect(page.getByTestId('visibility-person-p1').element()).toBeInTheDocument();
    expect(page.getByTestId('visibility-person-p2').element()).toBeInTheDocument();
  });

  it('should show canonical name when alias is present', async () => {
    const people = [makePerson({ id: 'p1', name: 'Alice Johnson', alias: 'Mom' })];
    await renderComponent(people);

    expect(page.getByText('Alice Johnson', { exact: true }).element()).toBeInTheDocument();
    expect(page.getByText('Mom', { exact: true }).query()).not.toBeInTheDocument();
  });

  it('should show hidden people with aria-pressed true', async () => {
    const people = [
      makePerson({ id: 'p1', name: 'Alice', isHidden: false }),
      makePerson({ id: 'p2', name: 'Bob', isHidden: true }),
    ];
    await renderComponent(people);

    expect(page.getByTestId('visibility-person-p1').element()).toHaveAttribute('aria-pressed', 'false');
    expect(page.getByTestId('visibility-person-p2').element()).toHaveAttribute('aria-pressed', 'true');
  });

  it('should toggle hidden state on click', async () => {
    const people = [makePerson({ id: 'p1', name: 'Alice', isHidden: false })];
    await renderComponent(people);

    const button = page.getByTestId('visibility-person-p1').element();
    expect(button).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(button);

    expect(button).toHaveAttribute('aria-pressed', 'true');
  });

  it('should call updateSpacePerson for each changed person on save', async () => {
    const people = [
      makePerson({ id: 'p1', name: 'Alice', isHidden: false }),
      makePerson({ id: 'p2', name: 'Bob', isHidden: false }),
    ];
    await renderComponent(people);

    // Toggle p1 to hidden
    await userEvent.click(page.getByTestId('visibility-person-p1'));

    // Click save
    await userEvent.click(page.getByTestId('save-visibility'));

    await vi.waitFor(() => {
      expect(sdkMock.updateSpacePerson).toHaveBeenCalledTimes(1);
      expect(sdkMock.updateSpacePerson).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'space-1',
          personId: 'p1',
          sharedSpacePersonUpdateDto: { isHidden: true },
        }),
      );
    });
  });

  it('should call onClose when close button is clicked', async () => {
    await renderComponent();

    await userEvent.click(page.getByTestId('close-visibility'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // --- Pet badge tests ---

  it('should render the pet badge for a pet person', async () => {
    const people = [makePerson({ id: 'p1', name: 'Rex', type: 'pet' })];
    await renderComponent(people);

    expect(page.getByTestId('pet-badge').element()).toBeInTheDocument();
  });

  it('should not render the pet badge for a human person', async () => {
    const people = [makePerson({ id: 'p1', name: 'Alice', type: 'person' })];
    await renderComponent(people);

    expect(page.getByTestId('pet-badge').query()).not.toBeInTheDocument();
  });

  it('should give the pet badge a non-empty accessible name', async () => {
    const people = [makePerson({ id: 'p1', name: 'Rex', type: 'pet' })];
    await renderComponent(people);

    expect(page.getByTestId('pet-badge').element()).toHaveAccessibleName();
  });

  it('should badge a pet with no species with a generic label', async () => {
    // SharedSpacePersonResponseDto has no `species` field at all, so a space pet always falls
    // through to getPetBadgeLabel's generic fallback ($t('pet')) — this is the designed
    // behaviour, not a data gap to fill in.
    const people = [makePerson({ id: 'p1', name: 'Rex', type: 'pet' })];
    await renderComponent(people);

    const badge = page.getByTestId('pet-badge').element();
    expect(badge.getAttribute('aria-label')).toBe('pet');
  });

  // --- Pagination tests ---

  it('should render loading text when hasMore and loading are true', async () => {
    const people = [makePerson({ id: 'p1' })];
    await render(ManageSpacePeopleVisibilityWrapper, {
      props: {
        people,
        spaceId: 'space-1',
        onClose,
        onUpdate,
        hasMore: true,
        loading: true,
        onLoadMore: vi.fn(),
      },
    });

    expect(page.getByText('loading', { exact: true }).element()).toBeInTheDocument();
  });

  it('should not render loading text when hasMore is false', async () => {
    const people = [makePerson({ id: 'p1' })];
    await render(ManageSpacePeopleVisibilityWrapper, {
      props: {
        people,
        spaceId: 'space-1',
        onClose,
        onUpdate,
        hasMore: false,
        onLoadMore: vi.fn(),
      },
    });

    expect(page.getByText('loading', { exact: true }).query()).not.toBeInTheDocument();
  });

  it('should preserve toggle overrides when people list grows via pagination', async () => {
    const people = [
      makePerson({ id: 'p1', name: 'Alice', isHidden: false }),
      makePerson({ id: 'p2', name: 'Bob', isHidden: false }),
    ];

    const { rerender } = await render(ManageSpacePeopleVisibilityWrapper, {
      props: {
        people,
        spaceId: 'space-1',
        onClose,
        onUpdate,
        hasMore: true,
        onLoadMore: vi.fn(),
      },
    });

    // Toggle p1 to hidden
    await userEvent.click(page.getByTestId('visibility-person-p1'));
    expect(page.getByTestId('visibility-person-p1').element()).toHaveAttribute('aria-pressed', 'true');

    // Simulate loading more people (rerender with expanded list)
    const morePeople = [...people, makePerson({ id: 'p3', name: 'Charlie', isHidden: false })];
    await rerender({
      people: morePeople,
      spaceId: 'space-1',
      onClose,
      onUpdate,
      hasMore: false,
      onLoadMore: vi.fn(),
    });

    // p1 override should be preserved
    expect(page.getByTestId('visibility-person-p1').element()).toHaveAttribute('aria-pressed', 'true');
    // p3 should be visible (not toggled)
    expect(page.getByTestId('visibility-person-p3').element()).toHaveAttribute('aria-pressed', 'false');
  });

  it('should save only overrides for loaded people', async () => {
    const people = [makePerson({ id: 'p1', name: 'Alice', isHidden: false })];

    await render(ManageSpacePeopleVisibilityWrapper, {
      props: {
        people,
        spaceId: 'space-1',
        onClose,
        onUpdate,
        hasMore: true,
        onLoadMore: vi.fn(),
      },
    });

    // Toggle p1
    await userEvent.click(page.getByTestId('visibility-person-p1'));

    // Save
    await userEvent.click(page.getByTestId('save-visibility'));

    await vi.waitFor(() => {
      expect(sdkMock.updateSpacePerson).toHaveBeenCalledTimes(1);
      expect(sdkMock.updateSpacePerson).toHaveBeenCalledWith(expect.objectContaining({ personId: 'p1' }));
    });
  });
});
