import type { PersonResponseDto } from '@immich/sdk';
import { createUrl, getPeopleThumbnailUrl } from '$lib/utils';

/** Which of the three renderings the Info-panel People grid should use for one person. */
export type PersonAvatar =
  | { kind: 'representative'; url: string }
  | { kind: 'assetFace'; fallbackUrl: string }
  | { kind: 'fallback'; url: string };

/**
 * The URL of the person's representative (feature-photo) face, or `undefined` when this viewer
 * has no representative thumbnail they can reach.
 *
 * The space arm is checked first: inside a space, a person's profile may carry its own name and
 * face that differ from the underlying `person` row, so the space thumbnail wins whenever there
 * is one.
 *
 * The `undefined` arm is NOT "non-owner". `/people/{id}/thumbnail` is guarded by
 * Permission.PersonRead, which server/src/utils/access.ts resolves as owner ∪ shared-space member
 * — a space member may legitimately read it. It returns undefined only for a viewer who is
 * neither, i.e. someone reaching the asset through an album or partner share. Such a viewer has
 * no profile face to show, which is why the crop-vs-profile setting cannot apply to them.
 */
export const getRepresentativeThumbnailUrl = (
  person: PersonResponseDto,
  { isOwner, spaceId }: { isOwner: boolean; spaceId?: string },
): string | undefined => {
  if (spaceId && person.spacePersonId) {
    return createUrl(`/shared-spaces/${spaceId}/people/${person.spacePersonId}/thumbnail`, {
      updatedAt: person.updatedAt,
    });
  }

  return isOwner ? getPeopleThumbnailUrl(person) : undefined;
};

export const resolvePersonAvatar = ({
  person,
  isOwner,
  spaceId,
  hasFaceInAsset,
  cropFacesFromAsset,
  assetThumbnailUrl,
}: {
  person: PersonResponseDto;
  isOwner: boolean;
  spaceId?: string;
  hasFaceInAsset: boolean;
  cropFacesFromAsset: boolean;
  assetThumbnailUrl: string;
}): PersonAvatar => {
  const representativeUrl = getRepresentativeThumbnailUrl(person, { isOwner, spaceId });

  if (!cropFacesFromAsset && representativeUrl) {
    return { kind: 'representative', url: representativeUrl };
  }

  if (hasFaceInAsset) {
    return { kind: 'assetFace', fallbackUrl: representativeUrl ?? assetThumbnailUrl };
  }

  return { kind: 'fallback', url: representativeUrl ?? assetThumbnailUrl };
};
