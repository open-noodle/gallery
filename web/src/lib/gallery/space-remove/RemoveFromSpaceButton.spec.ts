import { SharedSpaceRole } from '@immich/sdk';
import { modalManager } from '@immich/ui';
import { fireEvent, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
import SpacePickerModal from '$lib/modals/SpacePickerModal.svelte';
import { userInteraction } from '$lib/stores/user.svelte';
import { renderWithTooltips } from '$tests/helpers';
import { timelineAssetFactory } from '@test-data/factories/asset-factory';
import { sharedSpaceFactory } from '@test-data/factories/shared-space-factory';
import RemoveFromSpaceButton from './RemoveFromSpaceButton.svelte';
import { fetchSelectionSpaces, removeFromSpace } from './space-removal';

vi.mock('./space-removal', async (orig) => ({
  ...(await orig<typeof import('./space-removal')>()),
  fetchSelectionSpaces: vi.fn(),
  removeFromSpace: vi.fn(),
}));
vi.mock('@immich/ui', async (orig) => ({
  ...(await orig<typeof import('@immich/ui')>()),
  modalManager: { show: vi.fn() },
}));
vi.mock('$lib/managers/auth-manager.svelte', () => ({
  authManager: { authenticated: true, user: { id: 'me' } },
}));

const editor = [{ userId: 'me', role: SharedSpaceRole.Editor }] as never;
const family = sharedSpaceFactory.build({ id: 'family', name: 'Family', createdById: 'other', members: editor });
const trips = sharedSpaceFactory.build({ id: 'trips', name: 'Trips', createdById: 'other', members: editor });
const mine = timelineAssetFactory.build({ id: 'a1', ownerId: 'me' });
const theirs = timelineAssetFactory.build({ id: 'a2', ownerId: 'other' });

const answer = (spaces: Record<string, string[]>) =>
  vi
    .mocked(fetchSelectionSpaces)
    .mockResolvedValue(Object.entries(spaces).map(([assetId, spaceIds]) => ({ assetId, spaceIds })));

// The selection is read 250 ms after it settles.
const settle = async () => {
  await vi.advanceTimersByTimeAsync(300);
  flushSync();
};

const button = () => screen.queryByRole('button');

describe('RemoveFromSpaceButton', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    // mockReset also drops what a test queued with mockResolvedValueOnce and did not use.
    vi.mocked(removeFromSpace).mockReset().mockResolvedValue([]);
    userInteraction.recentSpaces = [family, trips];
    assetMultiSelectManager.clear();
    assetMultiSelectManager.selectAssets([mine, theirs]);
  });

  afterEach(() => {
    assetMultiSelectManager.clear();
    vi.useRealTimers();
  });

  it('shows nothing while the selection is in no space the user can remove from', async () => {
    answer({ a1: [], a2: ['viewed-elsewhere'] });
    renderWithTooltips(RemoveFromSpaceButton, {});
    await settle();

    expect(button()).toBeNull();
  });

  it('names the one space and removes the selected photos it holds', async () => {
    answer({ a1: ['family'], a2: ['family'] });
    renderWithTooltips(RemoveFromSpaceButton, {});
    await settle();

    // The test locale shows keys.
    expect(button()?.getAttribute('aria-label')).toBe('remove_from_named_space');
    await fireEvent.click(button()!);

    expect(modalManager.show).not.toHaveBeenCalled();
    expect(removeFromSpace).toHaveBeenCalledWith('family', ['a1', 'a2']);
  });

  it('asks which space when there are several, then removes from that one', async () => {
    answer({ a1: ['family', 'trips'], a2: ['family'] });
    vi.mocked(modalManager.show).mockResolvedValue(trips as never);
    renderWithTooltips(RemoveFromSpaceButton, {});
    await settle();

    expect(button()?.getAttribute('aria-label')).toBe('remove_from_a_space');
    await fireEvent.click(button()!);
    await vi.waitFor(() => expect(removeFromSpace).toHaveBeenCalled());

    expect(modalManager.show).toHaveBeenCalledWith(SpacePickerModal, {
      spaces: [family, trips],
      counts: { family: 2, trips: 1 },
      title: 'remove_from_space',
    });
    expect(removeFromSpace).toHaveBeenCalledWith('trips', ['a1']);
  });

  it('removes nothing when the choice is dismissed', async () => {
    answer({ a1: ['family', 'trips'] });
    vi.mocked(modalManager.show).mockResolvedValue(undefined as never);
    renderWithTooltips(RemoveFromSpaceButton, {});
    await settle();

    await fireEvent.click(button()!);
    await vi.advanceTimersByTimeAsync(10);

    expect(removeFromSpace).not.toHaveBeenCalled();
  });

  it('ignores a late answer for a selection that changed meanwhile', async () => {
    let late: (value: { assetId: string; spaceIds: string[] }[]) => void = () => {};
    vi.mocked(fetchSelectionSpaces)
      .mockImplementationOnce(() => new Promise((resolve) => (late = resolve)))
      .mockResolvedValueOnce([]);
    renderWithTooltips(RemoveFromSpaceButton, {});
    await settle();
    const [, firstSignal] = vi.mocked(fetchSelectionSpaces).mock.calls[0];

    assetMultiSelectManager.clear();
    assetMultiSelectManager.selectAssets([theirs]);
    await settle();
    late([{ assetId: 'a1', spaceIds: ['family'] }]);
    await settle();

    expect(firstSignal?.aborted).toBe(true);
    expect(button()).toBeNull();
  });

  it("takes another member's photo off the timeline when that space was its only one, and nothing else", async () => {
    const both = timelineAssetFactory.build({ id: 'a3', ownerId: 'other' });
    assetMultiSelectManager.selectAsset(both);
    const onLeaveTimeline = vi.fn();
    answer({ a1: ['family'], a2: ['family'], a3: ['family', 'trips'] });
    renderWithTooltips(RemoveFromSpaceButton, { onLeaveTimeline });
    await settle();
    // Two spaces: the picker asks, and Family is chosen.
    vi.mocked(modalManager.show).mockResolvedValue(family as never);

    vi.mocked(removeFromSpace).mockResolvedValueOnce(['a1', 'a2', 'a3', 'stack-sibling']);
    await fireEvent.click(button()!);
    await vi.advanceTimersByTimeAsync(10);

    // a1 is the user's own, a3 still shows through Trips; a sibling the server expanded is not on the grid.
    expect(onLeaveTimeline).toHaveBeenCalledExactlyOnceWith(['a2']);
  });

  it('leaves the timeline alone when only the user own photos went', async () => {
    const onLeaveTimeline = vi.fn();
    answer({ a1: ['family'], a2: ['family'] });
    renderWithTooltips(RemoveFromSpaceButton, { onLeaveTimeline });
    await settle();

    vi.mocked(removeFromSpace).mockResolvedValueOnce(['a1']);
    await fireEvent.click(button()!);
    await vi.advanceTimersByTimeAsync(10);

    expect(onLeaveTimeline).not.toHaveBeenCalled();
  });
});
