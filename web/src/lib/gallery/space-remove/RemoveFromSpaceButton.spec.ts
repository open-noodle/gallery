import { spacesQueryKey } from '#lib/gallery/spaces/space.query.ts';
import { assetMultiSelectManager } from '#lib/managers/asset-multi-select-manager.svelte.ts';
import SpacePickerModal from '#lib/modals/SpacePickerModal.svelte';
import { queryClient } from '#lib/queries/client.ts';
import { factory } from '#test/unit/factories.ts';
import { renderWithTooltips } from '#test/unit/helpers.ts';
import { SharedSpaceRole } from '@immich/sdk';
import { modalManager } from '@immich/ui';
import { flushSync } from 'svelte';
import { page, userEvent } from 'vitest/browser';
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
vi.mock('#lib/managers/auth-manager.svelte.ts', () => ({
  authManager: { authenticated: true, user: { id: 'me' } },
}));

const editor = [{ userId: 'me', role: SharedSpaceRole.Editor }] as never;
const family = factory.sharedSpace({ id: 'family', name: 'Family', createdById: 'other', members: editor });
const trips = factory.sharedSpace({ id: 'trips', name: 'Trips', createdById: 'other', members: editor });
const mine = factory.timelineAsset({ id: 'a1', ownerId: 'me' });
const theirs = factory.timelineAsset({ id: 'a2', ownerId: 'other' });

const answer = (spaces: Record<string, string[]>) =>
  vi
    .mocked(fetchSelectionSpaces)
    .mockResolvedValue(Object.entries(spaces).map(([assetId, spaceIds]) => ({ assetId, spaceIds })));

// The selection is read 250 ms after it settles.
const settle = async () => {
  await vi.advanceTimersByTimeAsync(300);
  flushSync();
};

const button = () => page.getByRole('button').query();

describe('RemoveFromSpaceButton', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    // mockReset also drops what a test queued with mockResolvedValueOnce and did not use.
    vi.mocked(removeFromSpace).mockReset().mockResolvedValue([]);
    queryClient.setQueryData(spacesQueryKey, [family, trips]);
    assetMultiSelectManager.clear();
    assetMultiSelectManager.selectAssets([mine, theirs]);
  });

  afterEach(() => {
    assetMultiSelectManager.clear();
    vi.useRealTimers();
  });

  it('shows nothing while the selection is in no space the user can remove from', async () => {
    answer({ a1: [], a2: ['viewed-elsewhere'] });
    await renderWithTooltips(RemoveFromSpaceButton, {});
    await settle();

    expect(button()).toBeNull();
  });

  it('names the one space and removes the selected photos it holds', async () => {
    answer({ a1: ['family'], a2: ['family'] });
    await renderWithTooltips(RemoveFromSpaceButton, {});
    await settle();

    // The test locale shows keys.
    expect(button()?.getAttribute('aria-label')).toBe('remove_from_named_space');
    await userEvent.click(page.getByRole('button'));

    expect(modalManager.show).not.toHaveBeenCalled();
    expect(removeFromSpace).toHaveBeenCalledWith('family', ['a1', 'a2'], 'Family');
  });

  it('asks which space when there are several, then removes from that one', async () => {
    answer({ a1: ['family', 'trips'], a2: ['family'] });
    vi.mocked(modalManager.show).mockResolvedValue(trips as never);
    await renderWithTooltips(RemoveFromSpaceButton, {});
    await settle();

    expect(button()?.getAttribute('aria-label')).toBe('remove_from_a_space');
    await userEvent.click(page.getByRole('button'));
    await vi.waitFor(() => expect(removeFromSpace).toHaveBeenCalled());

    expect(modalManager.show).toHaveBeenCalledWith(SpacePickerModal, {
      spaces: [family, trips],
      counts: { family: 2, trips: 1 },
      title: 'remove_from_space',
    });
    expect(removeFromSpace).toHaveBeenCalledWith('trips', ['a1'], 'Trips');
  });

  it('removes nothing when the choice is dismissed', async () => {
    answer({ a1: ['family', 'trips'] });
    vi.mocked(modalManager.show).mockResolvedValue(undefined as never);
    await renderWithTooltips(RemoveFromSpaceButton, {});
    await settle();

    await userEvent.click(page.getByRole('button'));
    await vi.advanceTimersByTimeAsync(10);

    expect(removeFromSpace).not.toHaveBeenCalled();
  });

  it('ignores a late answer for a selection that changed meanwhile', async () => {
    let late: (value: { assetId: string; spaceIds: string[] }[]) => void = () => {};
    vi.mocked(fetchSelectionSpaces)
      .mockImplementationOnce(() => new Promise((resolve) => (late = resolve)))
      .mockResolvedValueOnce([]);
    await renderWithTooltips(RemoveFromSpaceButton, {});
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
    const both = factory.timelineAsset({ id: 'a3', ownerId: 'other' });
    assetMultiSelectManager.selectAsset(both);
    const onLeaveTimeline = vi.fn();
    answer({ a1: ['family'], a2: ['family'], a3: ['family', 'trips'] });
    await renderWithTooltips(RemoveFromSpaceButton, { onLeaveTimeline });
    await settle();
    // Two spaces: the picker asks, and Family is chosen.
    vi.mocked(modalManager.show).mockResolvedValue(family as never);

    vi.mocked(removeFromSpace).mockResolvedValueOnce(['a1', 'a2', 'a3', 'stack-sibling']);
    // Asked again after the removal: a2 is in none of the user's spaces now, a3 still in Trips.
    vi.mocked(fetchSelectionSpaces).mockResolvedValueOnce([{ assetId: 'a3', spaceIds: ['trips'] }]);
    await userEvent.click(page.getByRole('button'));
    await vi.advanceTimersByTimeAsync(10);

    // a1 is the user's own, a3 still shows through Trips; a sibling the server expanded is not on the grid.
    expect(fetchSelectionSpaces).toHaveBeenLastCalledWith(['a2', 'a3']);
    expect(onLeaveTimeline).toHaveBeenCalledExactlyOnceWith(['a2']);
  });

  it("keeps another member's photo that is still in the space through a linked album", async () => {
    const onLeaveTimeline = vi.fn();
    answer({ a2: ['family'] });
    await renderWithTooltips(RemoveFromSpaceButton, { onLeaveTimeline });
    await settle();

    // The server removed the photo it held directly; a linked album still brings it into Family.
    vi.mocked(removeFromSpace).mockResolvedValueOnce(['a2']);
    vi.mocked(fetchSelectionSpaces).mockResolvedValueOnce([{ assetId: 'a2', spaceIds: ['family'] }]);
    await userEvent.click(page.getByRole('button'));
    await vi.advanceTimersByTimeAsync(10);

    expect(onLeaveTimeline).not.toHaveBeenCalled();
  });

  it('leaves the timeline alone when asking again fails', async () => {
    const onLeaveTimeline = vi.fn();
    answer({ a2: ['family'] });
    await renderWithTooltips(RemoveFromSpaceButton, { onLeaveTimeline });
    await settle();

    vi.mocked(removeFromSpace).mockResolvedValueOnce(['a2']);
    vi.mocked(fetchSelectionSpaces).mockRejectedValueOnce(new Error('offline'));
    await userEvent.click(page.getByRole('button'));
    await vi.advanceTimersByTimeAsync(10);

    expect(onLeaveTimeline).not.toHaveBeenCalled();
  });

  it('leaves the timeline alone when only the user own photos went', async () => {
    const onLeaveTimeline = vi.fn();
    answer({ a1: ['family'], a2: ['family'] });
    await renderWithTooltips(RemoveFromSpaceButton, { onLeaveTimeline });
    await settle();

    vi.mocked(removeFromSpace).mockResolvedValueOnce(['a1']);
    await userEvent.click(page.getByRole('button'));
    await vi.advanceTimersByTimeAsync(10);

    expect(onLeaveTimeline).not.toHaveBeenCalled();
  });
});
