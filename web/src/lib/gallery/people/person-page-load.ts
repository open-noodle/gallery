import { Route } from '#lib/route.ts';
import { getPerson, isHttpError, type PersonResponseDto } from '@immich/sdk';
import { error } from '@sveltejs/kit';

/**
The server answers the same for a person who is hidden, unpublished or does not exist, so the page does too (#1317).
Any other failure stays a real error.
*/
export const getPersonOrUnavailable = async (id: string) => {
  try {
    return await getPerson({ id });
  } catch (error_) {
    if (isHttpError(error_) && (error_.status === 400 || error_.status === 404)) {
      error(404, 'Person unavailable');
    }
    throw error_;
  }
};

/**
Another account's person, opened by their own id, belongs on the space's page for them. It shows the space's photos
even for a member who keeps that space off their timeline (#1317).
*/
export const spacePersonRouteFor = (person: PersonResponseDto, url: URL, assetId?: string) => {
  const profile = person.primaryProfile;
  if (profile?.type !== 'space-person' || !profile.spaceId || profile.id === person.id) {
    return;
  }
  const photo = assetId ? `/photos/${assetId}` : '';
  return `${Route.viewSpacePerson(profile.spaceId, profile.id)}${photo}${url.search}`;
};
