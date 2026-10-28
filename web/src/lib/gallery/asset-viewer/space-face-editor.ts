import { createSpaceAssetFace, getSpacePeople, type PersonResponseDto } from '@immich/sdk';
import { modalManager } from '@immich/ui';
import { t } from 'svelte-i18n';
import { get } from 'svelte/store';
import CreateSpaceFaceModal from '$lib/modals/CreateSpaceFaceModal.svelte';
import type { FaceCoordinates } from '$lib/utils/face-box-drag';
import { getSpacePersonThumbnailUrl } from '$lib/utils/global-person-route';
import { handleError } from '$lib/utils/handle-error';
import { refreshAssetPeople } from '$lib/utils/refresh-asset-people';

/**
 * What upstream's `FaceEditor` does differently for a space Owner/Editor tagging a member's asset
 * (spec §6.5): the candidates are the space's people, their thumbnails come from the space, and a
 * drawn box is attached to a space person with `createSpaceAssetFace` instead of the owner's
 * `createFace`. `SpaceAssetFaceCreateDto.spacePersonId` is required, so a box cannot be drawn
 * unassigned: "create person" is `CreateSpaceFaceModal`'s create-then-draw.
 *
 * Both writes re-read the asset before the editor closes, so the People row and the face boxes over
 * the photo show the new face without a reload.
 */
export type FaceEditorSpace = {
  loadPeople: () => Promise<PersonResponseDto[]>;
  thumbnailUrl: (person: PersonResponseDto) => string;
  tag: (person: PersonResponseDto, face: FaceCoordinates) => Promise<void>;
  create: (face: FaceCoordinates) => Promise<boolean>;
};

export const getFaceEditorSpace = (spaceId: string, assetId: string): FaceEditorSpace => ({
  // FaceEditor reads only `id`, `name` and `updatedAt` off a candidate, which both DTOs carry, and
  // hands the same object back to `thumbnailUrl` and `tag`.
  // FaceEditor awaits this unguarded on mount, so a failed load must toast here and resolve empty.
  loadPeople: async () => {
    try {
      return (await getSpacePeople({ id: spaceId, withHidden: false })) as unknown as PersonResponseDto[];
    } catch (error) {
      handleError(error, get(t)('errors.cant_get_faces'));
      return [];
    }
  },
  thumbnailUrl: (person) => getSpacePersonThumbnailUrl({ spaceId, id: person.id }, person.updatedAt),
  tag: async (person, face) => {
    await createSpaceAssetFace({
      id: spaceId,
      assetId,
      spaceAssetFaceCreateDto: { spacePersonId: person.id, ...face },
    });
    await refreshAssetPeople(assetId, spaceId);
  },
  create: async (face) => {
    const created = await modalManager.show(CreateSpaceFaceModal, { spaceId, assetId, ...face });
    if (created) {
      await refreshAssetPeople(assetId, spaceId);
    }
    return !!created;
  },
});
