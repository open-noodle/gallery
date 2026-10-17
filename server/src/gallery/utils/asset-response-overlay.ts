import { ForbiddenException } from '@nestjs/common';
import type { ShallowDehydrateObject } from 'kysely';
import type { AssetFace } from 'src/database.js';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import type { LinkedSpacePerson, SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { AssetResponseDto } from 'src/dtos/asset-response.dto.js';
import { checkAssetEditAccess } from 'src/gallery/utils/access-grants.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository.js';
import { asDateTimeString } from 'src/utils/date.js';
import { applyResolvedIdentityMetadata } from 'src/utils/person-identity.js';

type AssetResponseOverlayDependencies = {
  access: AccessRepository;
  faceIdentity: FaceIdentityRepository;
  sharedSpace: SharedSpaceRepository;
};

/**
 * Fork overlay on GET /assets/:id (AssetService.get), applied after upstream maps the asset: space-scoped people
 * (named in `spaceId`, or the space the server finds for the viewer), the owner's identity-resolved names and
 * birthdays, hidden-people filtering for album and partner viewers, and `canEdit`. Shared-link sessions are left as
 * upstream returns them.
 */
export const applyAssetResponseOverlay = async (
  deps: AssetResponseOverlayDependencies,
  {
    auth,
    id,
    spaceId,
    data,
    faces,
  }: {
    auth: AuthDto;
    id: string;
    spaceId?: string;
    data: AssetResponseDto;
    faces: ShallowDehydrateObject<AssetFace>[];
  },
): Promise<void> => {
  if (auth.sharedLink) {
    return;
  }

  if (spaceId) {
    const member = await deps.sharedSpace.getMember(spaceId, auth.user.id);
    if (!member) {
      throw new ForbiddenException('Not a member of this space');
    }

    const hasSpaceAccess = await deps.access.spaceAsset.checkSpaceAccessForSpace(auth.user.id, spaceId, new Set([id]));
    // The response must carry the space it was resolved in whether the caller named the space or
    // the server inferred it (the `else` branch below sets the same field). Without this, a client
    // that re-reads WITH `spaceId` gets an asset whose `resolvedSpaceId` is suddenly absent, and
    // any affordance gated on an effective space id -- `canEditSpacePeople`, which falls back to
    // `resolvedSpaceId` when the route carries no space -- silently switches itself off. That is
    // exactly what made the People-row edit controls vanish after a face edit on /photos/:id.
    data.resolvedSpaceId = spaceId;

    if (hasSpaceAccess.size === 0 || !data.people) {
      data.people = [];
    } else {
      const globalPersonIds = data.people.map((p) => p.id);
      const spacePersonMap = await deps.sharedSpace.findSpacePersonsByLinkedPersonIds(spaceId, globalPersonIds);
      applySpacePeople(data, spacePersonMap);
      data.people = data.people.filter((p) => p.spacePersonId && !spacePersonMap.get(p.id)?.isHidden);
    }
  } else if (data.ownerId === auth.user.id) {
    // The owner is viewing their own asset with no space context. A name or birthday set in a
    // shared space is resolved at read time against the face identity and is never written back
    // to `person` (see PersonService.getById). Without overlaying that resolution here, the raw
    // person row carries a null birthDate and the asset detail view shows no age.
    await applyResolvedPersonMetadata(deps, auth, data, faces);
  } else {
    // No spaceId — try to find a space containing this asset for this user
    const spaceForAsset = await deps.sharedSpace.findSpaceForAssetAndUser(id, auth.user.id);
    if (spaceForAsset) {
      const globalPersonIds = (data.people || []).map((p) => p.id);
      const spacePersonMap = await deps.sharedSpace.findSpacePersonsByLinkedPersonIds(
        spaceForAsset.spaceId,
        globalPersonIds,
      );
      applySpacePeople(data, spacePersonMap);
      data.people = (data.people || []).filter((p) => p.spacePersonId && !spacePersonMap.get(p.id)?.isHidden);
      data.resolvedSpaceId = spaceForAsset.spaceId;
    } else {
      // #796: no space contains this asset for the viewer, so they reach it through an album
      // share or partner sharing. Read access to the asset carries read access to who is in it —
      // minus anyone the owner marked hidden, which must not leak off-box.
      data.people = (data.people || []).filter((person) => !person.isHidden);
    }
  }

  // #734: resolve editability once, here, where the space context already is. Never in
  // mapAsset — it has no AuthDto and feeds list endpoints, where this would be N+1.
  const editable = await checkAssetEditAccess(deps.access, { auth, ids: [id] });
  data.canEdit = editable.has(id);
};

const applyResolvedPersonMetadata = async (
  deps: AssetResponseOverlayDependencies,
  auth: AuthDto,
  data: AssetResponseDto,
  faces: ShallowDehydrateObject<AssetFace>[],
) => {
  const people = data.people;
  if (!people?.length) {
    return;
  }

  const identityByPersonId = new Map<string, string>();
  for (const face of faces) {
    if (face.person?.personGroupId && face.person.identityId) {
      identityByPersonId.set(face.person.personGroupId, face.person.identityId);
    }
  }

  // Shared with PersonService.getFacesById, the sibling read path the Info panel uses for the
  // owner — the two have to resolve identically or the age appears on one surface only (#808).
  await applyResolvedIdentityMetadata({
    people,
    identityByPersonId,
    resolve: (identityId) => deps.faceIdentity.getResolvedPersonByIdentityId(auth.user.id, identityId),
  });
};

const applySpacePeople = (data: AssetResponseDto, spacePersonMap: Map<string, LinkedSpacePerson>) => {
  for (const person of data.people || []) {
    const spacePerson = spacePersonMap.get(person.id);
    if (!spacePerson) {
      continue;
    }

    person.spacePersonId = spacePerson.id;
    person.isHidden = spacePerson.isHidden;

    const name = spacePerson.name;
    if (name !== undefined) {
      person.name = name ?? '';
    }

    person.thumbnailPath = '';

    if (spacePerson.birthDate !== undefined) {
      person.birthDate = spacePerson.birthDate ?? null;
    }

    if (spacePerson.updatedAt !== undefined) {
      person.updatedAt = asDateTimeString(spacePerson.updatedAt);
    }

    if (spacePerson.type) {
      person.type = spacePerson.type;
    }
  }
};
