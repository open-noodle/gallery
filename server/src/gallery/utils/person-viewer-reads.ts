import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AuthDto } from 'src/dtos/auth.dto.js';
import type { AssetFaceResponseDto, PersonResponseDto } from 'src/dtos/person.dto.js';
import { Permission } from 'src/enum.js';
import type { GalleryPersonRepository } from 'src/gallery/repositories/gallery-person.repository.js';
import type { BackendMediaServer } from 'src/gallery/utils/backend-media-server.js';
import type { AccessRepository } from 'src/repositories/access.repository.js';
import type { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { checkAccess } from 'src/utils/access.js';
import type { ImmichMediaResponse } from 'src/utils/file.js';

/*
What a member reads about a person another account owns (#1317). `person` is the owner's private row. A member reads
the person only through a profile one of their spaces shows: a visible space person for it, which the owner has not
hidden. They then get the name and birthday that profile shows, and never the
owner's favorite, color or file path. Shared albums and partner sharing have no space to show a name, so `GET /faces`
keeps #796's behaviour for them, and the person itself stays closed to them.
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

type ViewedPerson = { personGroupId: string; ownerId: string; isHidden: boolean };
type FaceRow = { person?: { personGroupId: string; ownerId: string } | null };
/** Built once per service by `GalleryBaseService.initGallery`, as `this.personViewerReads`. */
export class PersonViewerReads {
  private access: AccessRepository;
  private galleryPerson: GalleryPersonRepository;
  private media: BackendMediaServer;
  private sharedSpace: SharedSpaceRepository;

  constructor(deps: {
    accessRepository: AccessRepository;
    galleryPersonRepository: GalleryPersonRepository;
    backendMedia: BackendMediaServer;
    sharedSpaceRepository: SharedSpaceRepository;
  }) {
    this.access = deps.accessRepository;
    this.galleryPerson = deps.galleryPersonRepository;
    this.media = deps.backendMedia;
    this.sharedSpace = deps.sharedSpaceRepository;
  }

  /**
  The profile a space shows another member for `person`, or undefined for its owner. Refuses a member when the owner
  hid the person or none of their spaces shows it, the same way for every person read.
  */
  async requireShown(auth: AuthDto, person: ViewedPerson) {
    if (person.ownerId === auth.user.id) {
      return;
    }
    if (person.isHidden) {
      throw denied();
    }
    const metadata = await this.galleryPerson.getSpaceMetadataForViewer({
      viewerId: auth.user.id,
      personIds: [person.personGroupId],
    });
    const shown = metadata.get(person.personGroupId);
    if (!shown) {
      throw denied();
    }
    return shown;
  }

  /** `GET /people/:id` for a reader who does not own the person. */
  async person(auth: AuthDto, person: ViewedPerson, response: PersonResponseDto): Promise<PersonResponseDto> {
    const shown = await this.requireShown(auth, person);
    if (!shown) {
      return response;
    }
    return {
      ...forOtherMember(response, shown),
      // Clients open the person through this profile, which is what scopes their photos, thumbnail and edits.
      primaryProfile: { type: 'space-person', id: shown.spacePersonId, spaceId: shown.spaceId },
      filterId: `space-person:${shown.spacePersonId}`,
    };
  }

  /**
  `GET /faces`: replaces another member's person on each face with what the asset's space shows them, and leaves a
  face whose person the space does not show without a person.
  */
  async faces(auth: AuthDto, assetId: string, rows: FaceRow[], faces: AssetFaceResponseDto[]): Promise<void> {
    const ownerByPersonId = new Map(
      rows.flatMap(({ person }) => (person ? [[person.personGroupId, person.ownerId]] : [])),
    );
    const others = faces.filter((face) => face.person && ownerByPersonId.get(face.person.id) !== auth.user.id);
    if (others.length === 0) {
      return;
    }
    const space = await this.sharedSpace.findSpaceForAssetAndUser(assetId, auth.user.id);
    if (!space) {
      return;
    }
    const metadata = await this.galleryPerson.getSpaceMetadataForViewer({
      viewerId: auth.user.id,
      spaceId: space.spaceId,
      personIds: others.map((face) => face.person!.id),
    });
    for (const face of others) {
      const shown = metadata.get(face.person!.id);
      // A person the space does not show stays off the face: its id leads only to reads that refuse the member.
      face.person = shown ? forOtherMember(face.person!, shown) : null;
    }
  }

  /**
  `GET /people/:id/thumbnail`. A person's stored thumbnail is one crop for every reader. When another member cannot
  open the photo it was cut from, this returns a crop of a face they can open. Undefined means the stored thumbnail is
  fine to serve.
  */
  async thumbnail(
    auth: AuthDto,
    person: ViewedPerson & { faceAssetId: string | null },
  ): Promise<ImmichMediaResponse | undefined> {
    if (!(await this.requireShown(auth, person)) || !person.faceAssetId) {
      return;
    }

    const viewerId = auth.user.id;
    const personId = person.personGroupId;
    const cover = await this.galleryPerson.getRepresentativeFaceForUpdate({
      personId,
      assetFaceId: person.faceAssetId,
      viewerId,
    });
    if (cover && (await this.canReadAsset(auth, cover.assetId))) {
      return;
    }

    const [visible] = await this.galleryPerson.getRepresentativeFaces({
      personId,
      take: 1,
      skip: 0,
      scope: { memberUserId: viewerId },
      hasElevatedPermission: false,
      viewerId,
    });
    const face = visible
      ? await this.galleryPerson.getRepresentativeFaceForUpdate({ personId, assetFaceId: visible.id, viewerId })
      : undefined;
    const sourcePath = face ? await this.media.getFaceThumbnailSource(face) : undefined;
    if (!face || !sourcePath) {
      throw new NotFoundException();
    }
    return this.media.generateFaceThumbnailResponse(face, sourcePath);
  }

  private async canReadAsset(auth: AuthDto, assetId: string) {
    const allowed = await checkAccess(this.access, { auth, permission: Permission.AssetRead, ids: [assetId] });
    return allowed.has(assetId);
  }
}
