import { expect, Page, test } from '@playwright/test';
import { setupPeopleAvatarMockApiRoutes } from 'src/ui/mock-network/people-avatar-network';
import { assetViewerUtils } from '../timeline/utils';
import { ensureDetailPanelVisible, setupAssetViewerFixture } from './utils';

const PERSON_THUMBNAIL = /\/api\/people\/[^/]+\/thumbnail/;

const firstAvatar = (page: Page) => page.getByTestId('detail-panel-people').locator('img').first();

test.describe.configure({ mode: 'parallel' });
test.describe('info-panel people avatar source', () => {
  const fixture = setupAssetViewerFixture(913);

  test.beforeEach(async ({ context }) => {
    await setupPeopleAvatarMockApiRoutes(context);
  });

  const openPeoplePanel = async (page: Page) => {
    await assetViewerUtils.waitForViewerLoad(page, fixture.primaryAsset);
    // The panel's open/closed state survives a reload, so pressing `i` unconditionally would
    // CLOSE an already-open panel. ensureDetailPanelVisible checks first.
    await ensureDetailPanelVisible(page);
    await page.getByTestId('detail-panel-people').waitFor({ state: 'visible' });
  };

  test('the toggle switches avatars to profile faces and the choice survives a reload', async ({ page }) => {
    await page.goto(`/photos/${fixture.primaryAsset.id}`);
    await openPeoplePanel(page);

    // Default is the crop taken from the photo on screen, so the avatar must NOT be the
    // profile-face endpoint. Deliberately not asserted as a `data:` URL — whether the canvas crop
    // resolves depends on image decoding in the mocked environment, and this feature's contract is
    // about which SOURCE wins, not about the crop's encoding.
    await expect(firstAvatar(page)).toBeVisible();
    await expect(firstAvatar(page)).not.toHaveAttribute('src', PERSON_THUMBNAIL);

    await page.getByRole('button', { name: 'Show profile faces' }).click();

    await expect(firstAvatar(page)).toHaveAttribute('src', PERSON_THUMBNAIL);
    // The control relabels itself to describe the action it would now perform.
    await expect(page.getByRole('button', { name: 'Show faces from this photo' })).toBeVisible();

    await page.reload();
    await openPeoplePanel(page);

    await expect(firstAvatar(page)).toHaveAttribute('src', PERSON_THUMBNAIL);
  });
});
