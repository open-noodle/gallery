import { BrowserContext } from '@playwright/test';
import { randomThumbnail } from 'src/ui/generators/timeline/images';

export type MockAvatarPerson = {
  id: string;
  name: string;
};

export const AVATAR_PEOPLE: MockAvatarPerson[] = [
  { id: 'avatar-person-1', name: 'Alice Johnson' },
  { id: 'avatar-person-2', name: 'Bob Smith' },
];

/**
 * Mocks for the asset-viewer Info panel's People grid.
 *
 * `GET /api/faces?id=<assetId>` is what `faceManager.getAssetFaces` calls, and nothing else under
 * `src/ui/mock-network/` intercepts it — `face-editor-network.ts` only handles the **POST** to the
 * same path and falls back on every other method. Without this route the People section renders
 * empty and any assertion about avatars is vacuous.
 */
export const setupPeopleAvatarMockApiRoutes = async (context: BrowserContext) => {
  await context.route('**/api/faces?*', async (route, request) => {
    if (request.method() !== 'GET') {
      return route.fallback();
    }

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      json: AVATAR_PEOPLE.map((person, index) => ({
        id: `avatar-face-${index + 1}`,
        // A NON-ZERO box is essential. `zoomImageToBase64` returns null on a degenerate crop
        // (faceWidth <= 0), so the all-zero box that `utils.createFace` writes in the DB-backed
        // suite could never exercise crop mode at all.
        boundingBoxX1: 100 + index * 200,
        boundingBoxY1: 100,
        boundingBoxX2: 260 + index * 200,
        boundingBoxY2: 260,
        imageWidth: 1000,
        imageHeight: 800,
        sourceType: 'machine-learning',
        person: {
          id: person.id,
          name: person.name,
          birthDate: null,
          thumbnailPath: `/upload/thumbs/${person.id}.jpeg`,
          isHidden: false,
          isFavorite: false,
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      })),
    });
  });

  await context.route('**/api/people/*/thumbnail*', async (route) => {
    return route.fulfill({
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
      body: await randomThumbnail('person-thumb', 1),
    });
  });
};
