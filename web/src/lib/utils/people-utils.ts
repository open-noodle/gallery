import type { Faces } from '$lib/stores/people.store';
import { createUrl, getAssetMediaUrl } from '$lib/utils';
import { mapNormalizedRectToContent, type ContentMetrics, type Rect, type Size } from '$lib/utils/container-utils';
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

export function comparePeopleForManagement(a: SortablePerson, b: SortablePerson): number {
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

  if (aHasName && bHasName) {
    const nameCompare = aName.localeCompare(bName, undefined, { sensitivity: 'base' });
    if (nameCompare !== 0) {
      return nameCompare;
    }
  }

  if (!aHasName && !bHasName) {
    const countCompare = getSortablePersonCount(b) - getSortablePersonCount(a);
    if (countCompare !== 0) {
      return countCompare;
    }
  }

  return a.id.localeCompare(b.id);
}

export function sortPeopleForManagement<T extends SortablePerson>(people: T[]): T[] {
  return [...people].sort(comparePeopleForManagement);
}

export const comparePeopleByFavoriteAndName = comparePeopleForManagement;
export const sortPeopleByFavoriteAndName = sortPeopleForManagement;

export const getPersonFaceThumbnailUrl = (personId: string, faceId: string, updatedAt?: string) =>
  createUrl(`/people/${personId}/faces/${faceId}/thumbnail`, { updatedAt });

export const getSpacePersonFaceThumbnailUrl = (spaceId: string, personId: string, faceId: string, updatedAt?: string) =>
  createUrl(`/shared-spaces/${spaceId}/people/${personId}/faces/${faceId}/thumbnail`, { updatedAt });

export const getBoundingBox = (faces: Faces[], imageSize: Size | ContentMetrics): BoundingBox[] => {
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

export type FaceBox = {
  imageWidth: number;
  imageHeight: number;
  boundingBoxX1: number;
  boundingBoxX2: number;
  boundingBoxY1: number;
  boundingBoxY2: number;
};

export type FaceCropTransform = { backgroundSize: string; backgroundPosition: string };

/**
 * CSS background size/position that reveals exactly the face sub-rectangle of an image
 * inside a square container. Non-uniform scale is intentional for compact preview crops;
 * the review modal shows the undistorted full photo separately.
 */
export const getFaceCropTransform = (face: FaceBox): FaceCropTransform => {
  const bw = (face.boundingBoxX2 - face.boundingBoxX1) / face.imageWidth;
  const bh = (face.boundingBoxY2 - face.boundingBoxY1) / face.imageHeight;

  if (!(bw > 0) || !(bh > 0) || bw >= 1 || bh >= 1) {
    return { backgroundSize: 'cover', backgroundPosition: 'center' };
  }

  const nx1 = face.boundingBoxX1 / face.imageWidth;
  const ny1 = face.boundingBoxY1 / face.imageHeight;
  const posX = (nx1 / (1 - bw)) * 100;
  const posY = (ny1 / (1 - bh)) * 100;

  return {
    backgroundSize: `${100 / bw}% ${100 / bh}%`,
    backgroundPosition: `${posX}% ${posY}%`,
  };
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
  const { boundingBoxX1: x1, boundingBoxX2: x2, boundingBoxY1: y1, boundingBoxY2: y2, imageWidth, imageHeight } = face;

  const coordinates = {
    x1: (image.naturalWidth / imageWidth) * x1,
    x2: (image.naturalWidth / imageWidth) * x2,
    y1: (image.naturalHeight / imageHeight) * y1,
    y2: (image.naturalHeight / imageHeight) * y2,
  };

  const faceWidth = coordinates.x2 - coordinates.x1;
  const faceHeight = coordinates.y2 - coordinates.y1;

  const faceImage = new Image();
  faceImage.crossOrigin = 'anonymous';
  faceImage.src = image.src;

  await new Promise((resolve) => {
    faceImage.addEventListener('load', resolve);
    faceImage.addEventListener('error', () => resolve(null));
  });

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
