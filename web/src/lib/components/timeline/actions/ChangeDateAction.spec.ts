import { modalManager } from '@immich/ui';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { fromTimelinePlainDateTime } from '$lib/utils/timeline-util';
import { timelineAssetFactory } from '@test-data/factories/asset-factory';
import { preferencesFactory } from '@test-data/factories/preferences-factory';
import { userAdminFactory } from '@test-data/factories/user-factory';
import ChangeDateAction from './ChangeDateAction.svelte';

const clickChangeDate = async () => {
  const user = userEvent.setup();
  await user.click(screen.getByRole('menuitem', { name: 'change_date' }));
};

describe('ChangeDateAction — #734 absent-prop fallback stays behaviour-identical', () => {
  const me = userAdminFactory.build();

  beforeEach(() => {
    assetMultiSelectManager.clear();
    vi.restoreAllMocks();
    authManager.setUser(me);
    authManager.setPreferences(preferencesFactory.build());
  });

  it("prefills the OWNED asset's date on a mixed 1-owned+1-not-owned selection, and passes only that asset to the modal, exactly as before #734", async () => {
    const mineDate = { year: 2020, month: 3, day: 4, hour: 5, minute: 6, second: 7, millisecond: 0 };
    const mine = timelineAssetFactory.build({ id: 'mine', ownerId: me.id, localDateTime: mineDate });
    const theirs = timelineAssetFactory.build({ id: 'theirs', ownerId: 'someone-else' });
    assetMultiSelectManager.selectAssets([mine, theirs]);
    const show = vi.spyOn(modalManager, 'show').mockResolvedValue(true as never);

    render(ChangeDateAction, { menuItem: true });
    await clickChangeDate();

    expect(show).toHaveBeenCalledTimes(1);
    const props = show.mock.calls[0][1] as unknown as {
      initialDate: { toISO: () => string | null };
      assets: { id: string }[];
    };
    expect(props.initialDate.toISO()).toBe(fromTimelinePlainDateTime(mineDate).toISO());
    expect(props.assets.map((a) => a.id)).toEqual(['mine']);
  });

  it('prefills now() for a single NOT-owned asset (the owned subset is empty), matching pre-#734 behaviour', async () => {
    const theirs = timelineAssetFactory.build({ id: 'theirs', ownerId: 'someone-else' });
    assetMultiSelectManager.selectAssets([theirs]);
    const show = vi.spyOn(modalManager, 'show').mockResolvedValue(true as never);

    render(ChangeDateAction, { menuItem: true });
    await clickChangeDate();

    const props = show.mock.calls[0][1] as unknown as {
      initialDate: { toISO: () => string | null };
      assets: { id: string }[];
    };
    // Not the non-owned asset's date — the owned subset (empty) drives the prefill, so it's "now".
    expect(props.initialDate.toISO()).not.toBe(fromTimelinePlainDateTime(theirs.localDateTime).toISO());
    expect(props.assets).toEqual([]);
  });
});
