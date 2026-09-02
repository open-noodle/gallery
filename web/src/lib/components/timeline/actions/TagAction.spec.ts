import { modalManager } from '@immich/ui';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
import type { TimelineAsset } from '$lib/managers/timeline-manager/types';
import TagAction from './TagAction.svelte';

const makeAsset = (id: string, ownerId: string): TimelineAsset => ({ id, ownerId }) as unknown as TimelineAsset;

const clickTag = async () => {
  const user = userEvent.setup();
  await user.click(screen.getByRole('menuitem', { name: 'tag' }));
};

describe('TagAction (#734)', () => {
  beforeEach(() => {
    assetMultiSelectManager.clear();
    vi.restoreAllMocks();
  });

  it('never opens the tag modal — let alone with an empty id list — when a mixed selection resolves to nothing editable', async () => {
    assetMultiSelectManager.selectAssets([makeAsset('theirs-1', 'other'), makeAsset('theirs-2', 'other')]);
    const show = vi.spyOn(modalManager, 'show').mockResolvedValue(true as never);

    render(TagAction, { menuItem: true, editableSelectedAssetIds: [] });
    await clickTag();

    expect(show).not.toHaveBeenCalled();
  });

  it('sends only the editable subset when the selection is mixed', async () => {
    assetMultiSelectManager.selectAssets([makeAsset('mine', 'me'), makeAsset('theirs', 'other')]);
    const show = vi.spyOn(modalManager, 'show').mockResolvedValue(true as never);

    render(TagAction, { menuItem: true, editableSelectedAssetIds: ['mine'] });
    await clickTag();

    expect(show).toHaveBeenCalledWith(expect.anything(), { assetIds: ['mine'] });
  });
});
