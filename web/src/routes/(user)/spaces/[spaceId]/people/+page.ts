import { authenticate } from '$lib/utils/auth';
import { getConfig, getMembers, getSpace, getSpacePeople, PersonDatabaseMode } from '@immich/sdk';
import type { PageLoad } from './$types';

export const load = (async ({ url, params }) => {
  await authenticate(url);
  const [space, members, people] = await Promise.all([
    getSpace({ id: params.spaceId }),
    getMembers({ id: params.spaceId }),
    getSpacePeople({ id: params.spaceId, limit: 100 }),
  ]);

  // Fetch person database mode; falls back to Space if the user lacks admin access
  let personDatabaseMode: PersonDatabaseMode = PersonDatabaseMode.Space;
  try {
    const config = await getConfig();
    personDatabaseMode = config.person.databaseMode as PersonDatabaseMode;
  } catch {
    // non-admin user or config unavailable — default to Space mode
  }

  return {
    space,
    members,
    people,
    personDatabaseMode,
    meta: {
      title: `${space.name} - People`,
    },
  };
}) satisfies PageLoad;
