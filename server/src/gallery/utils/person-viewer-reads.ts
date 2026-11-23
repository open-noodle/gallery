import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AuthDto } from 'src/dtos/auth.dto.js';
import type { AssetFaceResponseDto, PersonResponseDto } from 'src/dtos/person.dto.js';
import { Permission } from 'src/enum.js';
import type { GalleryPersonRepository } from 'src/gallery/repositories/gallery-person.repository.js';
import type { BackendMediaServer } from 'src/gallery/utils/backend-media-server.js';
import type { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import type { ImmichMediaResponse } from 'src/utils/file.js';

/*
What a member reads about a person another account owns (#1317). `person` is the owner's private row: a member gets the
name and birthday their space publishes, and never the owner's favorite, color or file path. Shared albums and partner
sharing have no space to publish a name, so `GET /faces` keeps #796's behaviour for them.
*/
const forOtherMember = (
  response: PersonResponseDto,
  metadata?: { name: string; birthDate: string | null },
): PersonResponseDto => ({
  ...response,
  name: metadata?.name ?? '',
  birthDate: metadata?.birthDate ?? null,
  isFavorite: false,
  color: undefined,
  thumbnailPath: '',
});

const denied = () => new BadRequestException('Not found or no person.read access');

export const projectPersonForViewer = async (
  galleryPerson: GalleryPersonRepository,
  auth: AuthDto,
  person: { personGroupId: string; isHidden: boolean },
  response: PersonResponseDto,
): Promise<PersonResponseDto> => {
  if (person.isHidden) {
    throw denied();
  }
  const metadata = await galleryPerson.getSpaceMetadataForViewer({
    viewerId: auth.user.id,
    personIds: [person.personGroupId],
  });
  return forOtherMember(response, metadata.get(person.personGroupId));
};

export const projectFacesForViewer = async (
  deps: { galleryPerson: GalleryPersonRepository; sharedSpace: SharedSpaceRepository },
  auth: AuthDto,
  assetId: string,
  ownerByPersonId: Map<string, string>,
  faces: AssetFaceResponseDto[],
): Promise<void> => {
  const others = faces.filter((face) => face.person && ownerByPersonId.get(face.person.id) !== auth.user.id);
  if (others.length === 0) {
    return;
  }
  const space = await deps.sharedSpace.findSpaceForAssetAndUser(assetId, auth.user.id);
  if (!space) {
    return;
  }
  const metadata = await deps.galleryPerson.getSpaceMetadataForViewer({
    viewerId: auth.user.id,
    spaceId: space.spaceId,
    personIds: others.map((face) => face.person!.id),
  });
  for (const face of others) {
    face.person = forOtherMember(face.person!, metadata.get(face.person!.id));
  }
};

/**
A person's stored thumbnail is one crop for every reader. When another member cannot open the photo it was cut from,
this returns a crop of a face they can open. Undefined means the stored thumbnail is fine to serve.
*/
export const cropForOtherMember = async (
  deps: {
    galleryPerson: GalleryPersonRepository;
    media: BackendMediaServer;
    canReadAsset: (assetId: string) => Promise<boolean>;
  },
  auth: AuthDto,
  person: { personGroupId: string; ownerId: string; isHidden: boolean; faceAssetId: string | null },
): Promise<ImmichMediaResponse | undefined> => {
  if (person.ownerId === auth.user.id) {
    return;
  }
  if (person.isHidden) {
    throw denied();
  }
  if (!person.faceAssetId) {
    return;
  }

  const viewerId = auth.user.id;
  const personId = person.personGroupId;
  const cover = await deps.galleryPerson.getRepresentativeFaceForUpdate({
    personId,
    assetFaceId: person.faceAssetId,
    viewerId,
  });
  if (cover && (await deps.canReadAsset(cover.assetId))) {
    return;
  }

  const [visible] = await deps.galleryPerson.getRepresentativeFaces({
    personId,
    take: 1,
    skip: 0,
    scope: { memberUserId: viewerId },
    hasElevatedPermission: false,
    viewerId,
  });
  const face = visible
    ? await deps.galleryPerson.getRepresentativeFaceForUpdate({ personId, assetFaceId: visible.id, viewerId })
    : undefined;
  const sourcePath = face ? await deps.media.getFaceThumbnailSource(face) : undefined;
  if (!face || !sourcePath) {
    throw new NotFoundException();
  }
  return deps.media.generateFaceThumbnailResponse(face, sourcePath);
};

export const assetReadCheck =
  (
    checkAccess: (dto: { auth: AuthDto; permission: Permission; ids: string[] }) => Promise<Set<string>>,
    auth: AuthDto,
  ) =>
  async (assetId: string) => {
    const allowed = await checkAccess({ auth, permission: Permission.AssetRead, ids: [assetId] });
    return allowed.has(assetId);
  };
