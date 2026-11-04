import { Route } from '#lib/route.ts';
import { expect, test } from '#test/medium/fixtures.ts';
import { factory } from '#test/medium/mock/factories.ts';
import { SourceType, type AssetFaceResponseDto } from '@immich/sdk';
import type { Page } from '@playwright/test';

// The info panel's people avatars: a crop from the photo on screen by default, the profile face on request,
// and the choice survives a reload.
const PERSON_THUMBNAIL = /\/api\/people\/[^/]+\/thumbnail/;
const firstAvatar = (page: Page) => page.getByTestId('detail-panel-people').locator('img').first();

test('the toggle switches avatars to profile faces and the choice survives a reload', async ({
  page,
  data,
  api,
  app,
}) => {
  const asset = factory.asset({ width: 1000, height: 800 });
  const people = [factory.person({ name: 'Alice Johnson' }), factory.person({ name: 'Bob Smith' })];
  data.addAsset(asset).addPeople(...people);
  const faces: AssetFaceResponseDto[] = people.map((person, index) => ({
    id: `avatar-face-${index + 1}`,
    // A non-zero box: a degenerate crop yields no avatar, so crop mode would go untested.
    boundingBoxX1: 100 + index * 200,
    boundingBoxY1: 100,
    boundingBoxX2: 260 + index * 200,
    boundingBoxY2: 260,
    imageWidth: 1000,
    imageHeight: 800,
    sourceType: SourceType.MachineLearning,
    person,
  }));
  api.on({ getFaces: () => ({ json: faces }) });

  const openPeoplePanel = async () => {
    await app.viewer.waitForAsset(asset);
    await app.viewer.openDetailPanel();
    await expect(page.getByTestId('detail-panel-people')).toBeVisible();
  };

  await page.goto(Route.viewAsset({ id: asset.id }));
  await openPeoplePanel();
  await expect(firstAvatar(page)).toBeVisible();
  await expect(firstAvatar(page)).not.toHaveAttribute('src', PERSON_THUMBNAIL);

  await page.getByRole('button', { name: 'show_profile_faces' }).click();
  await expect(firstAvatar(page)).toHaveAttribute('src', PERSON_THUMBNAIL);
  // The control relabels itself to describe the action it would now perform.
  await expect(page.getByRole('button', { name: 'show_faces_from_photo' })).toBeVisible();

  await page.reload();
  await openPeoplePanel();
  await expect(firstAvatar(page)).toHaveAttribute('src', PERSON_THUMBNAIL);
});
