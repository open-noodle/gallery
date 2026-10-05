<script lang="ts">
  import SpaceActivityFeed from '$lib/components/spaces/space-activity-feed.svelte';
  import { handleError } from '$lib/utils/handle-error';
  import { appendUniqueById } from '$lib/utils/people-utils';
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
    try {
      const result = await getSpaceActivities({ id: space.id, limit: ACTIVITY_PAGE_SIZE, offset: activityOffset });
      // Merged by id: this feed grows at the head, so anything written in the space while it is
      // open pushes the OFFSET boundary down and re-sends a row this page already holds -- and the
      // items are rendered in a keyed block, which a repeated id kills outright. The offset still
      // advances by what the SERVER returned, duplicates included; counting the merged rows instead
      // would skip a row on the next page for every duplicate dropped.
      activities = appendUniqueById(activities, result);
      activityOffset += result.length;
      hasMoreActivities = result.length === ACTIVITY_PAGE_SIZE;
    } catch (error) {
      handleError(error, $t('errors.error_loading_activities'));
    }
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
