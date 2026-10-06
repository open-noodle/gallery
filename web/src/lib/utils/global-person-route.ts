import { getPeopleThumbnailPath, Type, type PersonResponseDto } from '@immich/sdk';
import { Route } from '$lib/route';
import { createUrl } from '$lib/utils';

// Personal person vs space person, decided here once for the web app. A space person is a
// (spaceId, id) pair, read from:
// - `spacePersonId`, when the caller views through a known space (asset detail people), else
// - a space-person `primaryProfile` (people lists, search, filter suggestions).
// A shared-space person row (SharedSpacePersonResponseDto) already is that pair.
// Anything else is personal and addressed by its primary profile id.
// Space person ids do not exist in the person table, so writes for them must go to the shared
// space endpoints instead of person.update. A space-person profile without an id is treated as
// personal rather than producing a `/people/undefined` URL.
type ScopedPerson = {
  id: string;
  primaryProfile?: { type?: string; id?: string; spaceId?: string };
  spacePersonId?: string;
  updatedAt?: string;
};
export type SpacePersonRef = { spaceId: string; id: string };

export const getSpaceProfile = (person: ScopedPerson, spaceId?: string): SpacePersonRef | undefined => {
  if (spaceId && person.spacePersonId) {
    return { spaceId, id: person.spacePersonId };
  }
  const profile = person.primaryProfile;
  if (profile?.type === Type.SpacePerson && profile.spaceId && profile.id) {
    return { spaceId: profile.spaceId, id: profile.id };
  }
};

const getPrimaryProfileId = (person: ScopedPerson) => person.primaryProfile?.id ?? person.id;

export const getGlobalPersonHref = (person: Pick<PersonResponseDto, 'id' | 'primaryProfile'>, previousRoute?: string) =>
  Route.viewPerson({ id: getPrimaryProfileId(person) }, previousRoute ? { previousRoute } : undefined);

export const getSpacePersonThumbnailUrl = (
  person: SpacePersonRef & { updatedAt?: string },
  updatedAt: string | undefined = person.updatedAt,
) => createUrl(`/shared-spaces/${person.spaceId}/people/${person.id}/thumbnail`, { updatedAt });

export const getGlobalPersonThumbnailUrl = (
  person: ScopedPerson,
  { spaceId, updatedAt = person.updatedAt }: { spaceId?: string; updatedAt?: string } = {},
) => {
  const space = getSpaceProfile(person, spaceId);
  return space
    ? getSpacePersonThumbnailUrl(space, updatedAt)
    : createUrl(getPeopleThumbnailPath(getPrimaryProfileId(person)), { updatedAt });
};
