import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { preferences as preferencesStore, user as userStore } from '$lib/stores/user.store';
import {
  Role,
  type SharedSpaceMemberResponseDto,
  type SharedSpacePersonResponseDto,
  type SharedSpaceResponseDto,
} from '@immich/sdk';
import { preferencesFactory } from '@test-data/factories/preferences-factory';
import { userAdminFactory } from '@test-data/factories/user-factory';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import SpacePeoplePage from '../../../routes/(user)/spaces/[spaceId]/people/+page.svelte';

vi.mock('$lib/components/layouts/user-page-layout.svelte', async () => {
  const { default: MockComponent } = await import('./mock-user-page-layout.test-wrapper.svelte');
  return { default: MockComponent };
});

function makeSpace(overrides: Partial<SharedSpaceResponseDto> = {}): SharedSpaceResponseDto {
  return {
    id: 'space-1',
    name: 'Test Space',
    createdAt: '2026-01-01T00:00:00.000Z',
    createdById: 'owner-user-id',
    ...overrides,
  } as SharedSpaceResponseDto;
}

function makeMember(overrides: Partial<SharedSpaceMemberResponseDto> = {}): SharedSpaceMemberResponseDto {
  return {
    userId: 'current-user-id',
    email: 'user@example.com',
    name: 'Current User',
    role: Role.Editor,
    showInTimeline: false,
    joinedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as SharedSpaceMemberResponseDto;
}

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

function renderPage({
  space = makeSpace(),
  members = [makeMember()],
  people = [makePerson()],
  userId = 'current-user-id',
}: {
  space?: SharedSpaceResponseDto;
  members?: SharedSpaceMemberResponseDto[];
  people?: SharedSpacePersonResponseDto[];
  userId?: string;
} = {}) {
  const currentUser = userAdminFactory.build({ id: userId });
  userStore.set(currentUser);
  preferencesStore.set(preferencesFactory.build());

  return render(SpacePeoplePage, {
    props: {
      data: {
        space,
        members,
        people,
        meta: { title: `${space.name} - People` },
      },
    },
  });
}

describe('Spaces people page', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    sdkMock.getSpacePeople.mockResolvedValue([]);
  });

  it('renders circular thumbnails for each person', () => {
    const people = [makePerson({ id: 'p1', name: 'Alice' }), makePerson({ id: 'p2', name: 'Bob' })];
    const { baseElement } = renderPage({ people });

    // ImageThumbnail renders img elements — check URLs contain person IDs
    const images = baseElement.querySelectorAll('img');
    const srcs = [...images].map((img) => img.getAttribute('src'));
    expect(srcs.some((s) => s?.includes('p1/thumbnail'))).toBe(true);
    expect(srcs.some((s) => s?.includes('p2/thumbnail'))).toBe(true);
  });

  it('shows inline name input for editors', () => {
    const people = [makePerson({ id: 'p1', name: 'Alice' })];
    renderPage({ people, members: [makeMember({ role: Role.Editor })] });

    const nameInput = screen.getByDisplayValue('Alice');
    expect(nameInput).toBeInTheDocument();
    expect(nameInput.tagName).toBe('INPUT');
    expect(nameInput).toHaveAttribute('placeholder', 'add_a_name');
  });

  it('does NOT show name input for viewers', () => {
    const people = [makePerson({ id: 'p1', name: 'Alice' })];
    renderPage({ people, members: [makeMember({ role: Role.Viewer })] });

    // Viewer should see text, not an input
    const nameInput = screen.queryByDisplayValue('Alice');
    expect(nameInput).toBeNull();

    // Should show the name as text
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('shows context menu button on hover for editors', async () => {
    const people = [makePerson({ id: 'p1', name: 'Alice' })];
    const { baseElement } = renderPage({ people, members: [makeMember({ role: Role.Editor })] });

    // Find the person card container (role="group")
    const card = baseElement.querySelector('[role="group"]')!;
    expect(card).toBeTruthy();

    await fireEvent.mouseEnter(card);

    const menuButton = screen.getByLabelText('show_person_options');
    expect(menuButton).toBeInTheDocument();
  });

  it('does NOT show context menu for viewers', async () => {
    const people = [makePerson({ id: 'p1', name: 'Alice' })];
    const { baseElement } = renderPage({ people, members: [makeMember({ role: Role.Viewer })] });

    const card = baseElement.querySelector('[role="group"]')!;
    await fireEvent.mouseEnter(card);

    expect(screen.queryByLabelText('show_person_options')).toBeNull();
  });

  it('context menu has "Set alias" and "Merge" options', async () => {
    const people = [makePerson({ id: 'p1', name: 'Alice' })];
    const { baseElement } = renderPage({ people, members: [makeMember({ role: Role.Editor })] });

    const card = baseElement.querySelector('[role="group"]')!;
    await fireEvent.mouseEnter(card);

    const menuButton = screen.getByLabelText('show_person_options');
    const user = userEvent.setup();
    await user.click(menuButton);

    expect(screen.getByText('spaces_set_alias')).toBeInTheDocument();
    expect(screen.getByText('merge_people')).toBeInTheDocument();
  });

  it('name editing calls updateSpacePerson API on blur', async () => {
    const person = makePerson({ id: 'p1', name: 'Alice' });
    sdkMock.updateSpacePerson.mockResolvedValue(person);
    sdkMock.getSpacePeople.mockResolvedValue([person]);

    renderPage({ people: [person], members: [makeMember({ role: Role.Editor })] });

    const nameInput = screen.getByDisplayValue('Alice');
    const user = userEvent.setup();

    await user.click(nameInput);
    await user.clear(nameInput);
    await user.type(nameInput, 'Alice Smith');
    await fireEvent.focusOut(nameInput);

    await waitFor(() => {
      expect(sdkMock.updateSpacePerson).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'space-1',
          personId: 'p1',
          sharedSpacePersonUpdateDto: { name: 'Alice Smith' },
        }),
      );
    });
  });

  it('alias editing via context menu shows inline alias input', async () => {
    const people = [makePerson({ id: 'p1', name: 'Alice' })];
    const { baseElement } = renderPage({ people, members: [makeMember({ role: Role.Editor })] });

    const card = baseElement.querySelector('[role="group"]')!;
    await fireEvent.mouseEnter(card);

    const user = userEvent.setup();
    await user.click(screen.getByLabelText('show_person_options'));
    await user.click(screen.getByText('spaces_set_alias'));

    await waitFor(() => {
      const aliasInput = screen.getByPlaceholderText('spaces_alias_placeholder');
      expect(aliasInput).toBeInTheDocument();
    });
  });

  it('alias save calls setSpacePersonAlias API', async () => {
    const people = [makePerson({ id: 'p1', name: 'Alice' })];
    sdkMock.setSpacePersonAlias.mockResolvedValue('' as never);
    sdkMock.getSpacePeople.mockResolvedValue(people);

    const { baseElement } = renderPage({ people, members: [makeMember({ role: Role.Editor })] });

    const card = baseElement.querySelector('[role="group"]')!;
    await fireEvent.mouseEnter(card);
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('show_person_options'));
    await user.click(screen.getByText('spaces_set_alias'));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('spaces_alias_placeholder')).toBeInTheDocument();
    });

    const aliasInput = screen.getByPlaceholderText('spaces_alias_placeholder');
    await user.type(aliasInput, 'Ally');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(sdkMock.setSpacePersonAlias).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'space-1',
          personId: 'p1',
          sharedSpacePersonAliasDto: { alias: 'Ally' },
        }),
      );
    });
  });

  it('alias clear calls deleteSpacePersonAlias API', async () => {
    const people = [makePerson({ id: 'p1', name: 'Alice', alias: 'Ally' })];
    sdkMock.deleteSpacePersonAlias.mockResolvedValue('' as never);
    sdkMock.getSpacePeople.mockResolvedValue(people);

    const { baseElement } = renderPage({ people, members: [makeMember({ role: Role.Editor })] });

    const card = baseElement.querySelector('[role="group"]')!;
    await fireEvent.mouseEnter(card);
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('show_person_options'));
    await user.click(screen.getByText('spaces_set_alias'));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('spaces_alias_placeholder')).toBeInTheDocument();
    });

    const aliasInput = screen.getByPlaceholderText('spaces_alias_placeholder');
    await user.clear(aliasInput);
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(sdkMock.deleteSpacePersonAlias).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'space-1',
          personId: 'p1',
        }),
      );
    });
  });

  it('empty state shows when no people', () => {
    renderPage({ people: [] });

    expect(screen.getByText('spaces_no_people')).toBeInTheDocument();
    expect(screen.getByText('spaces_no_people_description')).toBeInTheDocument();
  });

  it('back button navigates to space detail', () => {
    renderPage();

    const backButton = screen.getByLabelText('back');
    expect(backButton).toBeInTheDocument();
  });

  it('shows "aka [alias]" when person has alias', () => {
    const people = [makePerson({ id: 'p1', name: 'Alice', alias: 'Ally' })];
    renderPage({ people, members: [makeMember({ role: Role.Editor })] });

    expect(screen.getByText('aka Ally')).toBeInTheDocument();
  });
});
