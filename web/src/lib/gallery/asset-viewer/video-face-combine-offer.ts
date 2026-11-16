import { videoPersonSightings } from '#lib/gallery/asset-viewer/video-person-sightings.svelte.ts';
import { handleError } from '#lib/utils/handle-error.ts';
import { refreshAssetPeople } from '#lib/utils/refresh-asset-people.ts';
import { AssetTypeEnum, getFaces, mergeVideoFaces, type AssetFaceResponseDto } from '@immich/sdk';
import { toastManager } from '@immich/ui';
import { t } from 'svelte-i18n';
import { get } from 'svelte/store';

/**
After faces of a video are given to people who already had a face in it, offers to combine each such person's faces
into one (specs/2026-10-31-video-face-frames-design.md, Phase 2, "Combine into one face"). Naming a second face of
someone in the same video is when combining helps, and the button otherwise sits behind the film button on their
People tile, where nobody looks for it.

Only people the edit gave a face to are offered, so an earlier split the owner chose to keep is not raised again.
The toast stays a while and does nothing unless clicked: combining deletes the emptied faces, so it is never done
without asking.
*/
export const OFFER_TIMEOUT = 10_000;

/** The faces of each given person in the video, for those with more than one. */
export const facesToCombine = (faces: AssetFaceResponseDto[], personIds: Iterable<string>) => {
  const wanted = new Set(personIds);
  const byPerson = new Map<string, { name: string; faceIds: string[] }>();
  for (const face of faces) {
    const person = face.person;
    if (!person || !wanted.has(person.id)) {
      continue;
    }
    const entry = byPerson.get(person.id);
    if (entry) {
      entry.faceIds.push(face.id);
    } else {
      byPerson.set(person.id, { name: person.name, faceIds: [face.id] });
    }
  }
  return [...byPerson].filter(([, { faceIds }]) => faceIds.length > 1);
};

const combine = async (assetId: string, personId: string, faceIds: string[]) => {
  const $t = get(t);
  try {
    const { faceId } = await mergeVideoFaces({ videoFaceMergeDto: { faceIds } });
    toastManager.primary($t('video_person_faces_combined'));
    // The person's moments, when open, now come from the one face that kept them all.
    if (videoPersonSightings.isShowing(assetId, personId) && videoPersonSightings.current) {
      videoPersonSightings.current = { ...videoPersonSightings.current, faceIds: [faceId] };
    }
  } catch (error) {
    handleError(error, $t('video_person_faces_combine_failed'));
  }
  await refreshAssetPeople(assetId);
};

export const offerVideoFaceCombine = async ({
  assetId,
  assetType,
  personIds,
}: {
  assetId: string;
  assetType: AssetTypeEnum;
  personIds: string[];
}) => {
  if (assetType !== AssetTypeEnum.Video || personIds.length === 0) {
    return;
  }
  let faces: AssetFaceResponseDto[];
  try {
    faces = await getFaces({ id: assetId });
  } catch {
    // Only an offer: the edit itself already succeeded.
    return;
  }
  const $t = get(t);
  for (const [personId, { name, faceIds }] of facesToCombine(faces, personIds)) {
    toastManager.primary(
      {
        description: name
          ? $t('video_person_faces_combine_offer', { values: { name, count: faceIds.length } })
          : $t('video_person_faces_combine_offer_unnamed', { values: { count: faceIds.length } }),
        // The toast closes on click: its faces are gone once combined, so a second click could only fail.
        button: (close) => ({
          label: $t('video_person_faces_combine'),
          color: 'secondary',
          onclick: () => {
            close();
            return combine(assetId, personId, faceIds);
          },
        }),
      },
      { timeout: OFFER_TIMEOUT },
    );
  }
};
