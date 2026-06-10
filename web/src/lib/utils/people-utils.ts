import type { Faces } from '$lib/stores/people.store';
import { PeopleSortBy } from '$lib/stores/preferences.store';
import { createUrl, getAssetMediaUrl } from '$lib/utils';
import { mapNormalizedRectToContent, type Rect, type Size } from '$lib/utils/container-utils';
import { AssetTypeEnum } from '@immich/sdk';

export type BoundingBox = Rect & { id: string };
export type SortablePerson = {
  id: string;
  name?: string | null;
  isFavorite?: boolean;
  isHidden?: boolean;
  numberOfAssets?: number | null;
  assetCount?: number | null;
};

const getSortablePersonName = (person: SortablePerson) => person.name?.trim() ?? '';
const getSortablePersonCount = (person: SortablePerson) => person.numberOfAssets ?? person.assetCount ?? 0;

export function comparePeople(a: SortablePerson, b: SortablePerson, sortBy: PeopleSortBy): number {
  if (!!a.isHidden !== !!b.isHidden) {
    return a.isHidden ? 1 : -1;
  }

  if (!!a.isFavorite !== !!b.isFavorite) {
    return a.isFavorite ? -1 : 1;
  }

  const aName = getSortablePersonName(a);
  const bName = getSortablePersonName(b);
  const aHasName = aName.length > 0;
  const bHasName = bName.length > 0;
  if (aHasName !== bHasName) {
    return aHasName ? -1 : 1;
  }

  const nameCompare = aHasName ? aName.localeCompare(bName, undefined, { sensitivity: 'base' }) : 0;
  const countCompare = getSortablePersonCount(b) - getSortablePersonCount(a);

  // Unknown persisted values fall into the count branch, so a corrupt
  // localStorage entry degrades to the default (Most photos) ordering.
  if (aHasName && sortBy === PeopleSortBy.Name) {
    if (nameCompare !== 0) {
      return nameCompare;
    }
    // Identical names fall back to count, matching the mobile ORDER BY.
    if (countCompare !== 0) {
      return countCompare;
    }
  } else {
    if (countCompare !== 0) {
      return countCompare;
    }
    if (nameCompare !== 0) {
      return nameCompare;
    }
  }

  return a.id.localeCompare(b.id);
}

export function sortPeople<T extends SortablePerson>(people: T[], sortBy: PeopleSortBy): T[] {
  return [...people].sort((a, b) => comparePeople(a, b, sortBy));
}

export function comparePeopleForManagement(a: SortablePerson, b: SortablePerson): number {
  return comparePeople(a, b, PeopleSortBy.Name);
}

export function sortPeopleForManagement<T extends SortablePerson>(people: T[]): T[] {
  return sortPeople(people, PeopleSortBy.Name);
}

export const comparePeopleByFavoriteAndName = comparePeopleForManagement;
export const sortPeopleByFavoriteAndName = sortPeopleForManagement;

export const getPersonFaceThumbnailUrl = (personId: string, faceId: string, updatedAt?: string) =>
  createUrl(`/people/${personId}/faces/${faceId}/thumbnail`, { updatedAt });

export const getSpacePersonFaceThumbnailUrl = (spaceId: string, personId: string, faceId: string, updatedAt?: string) =>
  createUrl(`/shared-spaces/${spaceId}/people/${personId}/faces/${faceId}/thumbnail`, { updatedAt });

export const getBoundingBox = (faces: Faces[], imageSize: Size): BoundingBox[] => {
  const boxes: BoundingBox[] = [];

  for (const face of faces) {
    const rect = mapNormalizedRectToContent(
      { x: face.boundingBoxX1 / face.imageWidth, y: face.boundingBoxY1 / face.imageHeight },
      { x: face.boundingBoxX2 / face.imageWidth, y: face.boundingBoxY2 / face.imageHeight },
      imageSize,
    );

    boxes.push({ id: face.id, ...rect });
  }

  return boxes;
};

export const zoomImageToBase64 = async (
  face: Faces,
  assetId: string,
  assetType: AssetTypeEnum,
  photoViewer: HTMLImageElement | undefined,
): Promise<string | null> => {
  let image: HTMLImageElement | undefined;
  if (assetType === AssetTypeEnum.Image) {
    image = photoViewer;
  } else if (assetType === AssetTypeEnum.Video) {
    const data = getAssetMediaUrl({ id: assetId });
    const img: HTMLImageElement = new Image();
    img.crossOrigin = 'anonymous';
    img.src = data;

    await new Promise<void>((resolve) => {
      img.addEventListener('load', () => resolve());
      img.addEventListener('error', () => resolve());
    });

    image = img;
  }
  if (!image) {
    return null;
  }

  const faceImage = new Image();
  faceImage.crossOrigin = 'anonymous';
  faceImage.src = image.src;

  const loaded = await new Promise<boolean>((resolve) => {
    faceImage.addEventListener('load', () => resolve(true));
    faceImage.addEventListener('error', () => resolve(false));
  });

  // The displayed <img> is frequently still decoding when the detail panel
  // renders (its naturalWidth/Height are then 0). Derive the crop from the
  // freshly loaded clone instead, and bail out — so callers fall back to the
  // person thumbnail — rather than emit a broken 0×0 "data:," image.
  if (!loaded || faceImage.naturalWidth === 0 || faceImage.naturalHeight === 0) {
    return null;
  }

  const { boundingBoxX1: x1, boundingBoxX2: x2, boundingBoxY1: y1, boundingBoxY2: y2, imageWidth, imageHeight } = face;
  const widthScale = faceImage.naturalWidth / imageWidth;
  const heightScale = faceImage.naturalHeight / imageHeight;
  const coordinates = {
    x1: widthScale * x1,
    x2: widthScale * x2,
    y1: heightScale * y1,
    y2: heightScale * y2,
  };

  const faceWidth = coordinates.x2 - coordinates.x1;
  const faceHeight = coordinates.y2 - coordinates.y1;
  if (faceWidth <= 0 || faceHeight <= 0) {
    return null;
  }

  const canvas = document.createElement('canvas');
  canvas.width = faceWidth;
  canvas.height = faceHeight;

  const context = canvas.getContext('2d');
  if (!context) {
    return null;
  }
  context.drawImage(faceImage, coordinates.x1, coordinates.y1, faceWidth, faceHeight, 0, 0, faceWidth, faceHeight);
  return canvas.toDataURL();
};
