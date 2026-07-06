<script lang="ts">
  import SpaceActivityFeed from '$lib/components/spaces/space-activity-feed.svelte';
  import { getSpaceActivities } from '@immich/sdk';
  import { t } from 'svelte-i18n';
  import type { PageData } from './$types';

  const ACTIVITY_PAGE_SIZE = 20;

  let { data }: { data: PageData } = $props();
  const space = $derived(data.space);

  let activities = $state(data.activities);
  let hasMoreActivities = $state(data.hasMoreActivities);
  let activityOffset = $state(data.activities.length);

  async function loadMoreActivities() {
    const result = await getSpaceActivities({ id: space.id, limit: ACTIVITY_PAGE_SIZE, offset: activityOffset });
    activities = [...activities, ...result];
    activityOffset += result.length;
    hasMoreActivities = result.length === ACTIVITY_PAGE_SIZE;
  }
</script>

<div class="mx-auto w-full max-w-3xl p-4">
  <h2 class="mb-3 text-base font-semibold">{$t('spaces_recent_activity')}</h2>
  <div data-testid="space-activity">
    <SpaceActivityFeed
      {activities}
      spaceColor={space.color ?? 'primary'}
      onLoadMore={loadMoreActivities}
      hasMore={hasMoreActivities}
    />
  </div>
</div>
