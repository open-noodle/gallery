import type { FaceBox } from '$lib/utils/people-utils';

/** One face as the photo modal and the tile overlay need it: the box, plus which face and when. */
export type FacePhotoFace = FaceBox & { assetFaceId: string; localDateTime: string };
