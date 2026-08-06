import { getAgentProviderCredentials, getAgentRunnerStatus, getAgentSessions } from '@immich/sdk';
import { authenticate } from '$lib/utils/auth';
import { getFormatter } from '$lib/utils/i18n';
import type { PageLoad } from './$types';

export const load = (async ({ url }) => {
  await authenticate(url);
  const $t = await getFormatter();
  const [runnerStatus, credentials, sessions] = await Promise.all([
    getAgentRunnerStatus(),
    getAgentProviderCredentials(),
    getAgentSessions(),
  ]);
  const requestedSessionId = url.searchParams.get('session');

  return {
    meta: {
      title: $t('assistant'),
    },
    runnerStatus,
    credentials,
    sessions,
    requestedSessionId,
  };
}) satisfies PageLoad;
