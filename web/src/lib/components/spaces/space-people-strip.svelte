<script lang="ts">
  import { getPeopleThumbnailUrl } from '$lib/utils';
  import { Route } from '$lib/route';
  import type { SharedSpacePersonResponseDto } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiChevronRight } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    people: SharedSpacePersonResponseDto[];
    spaceId: string;
    selectedPersonId?: string | null;
    spaceColor?: string;
    onPersonClick?: (personId: string) => void;
  }

  let { people, spaceId, selectedPersonId = null, spaceColor = 'primary', onPersonClick }: Props = $props();

  const SEE_ALL_THRESHOLD = 6;

  const getDisplayName = (person: SharedSpacePersonResponseDto): string => {
    if (person.alias) {
      return person.alias;
    }
    if (person.name) {
      return person.name;
    }
    return 'Unknown';
  };

  const getThumbUrl = (person: SharedSpacePersonResponseDto): string => {
    return getPeopleThumbnailUrl({ id: person.id, name: person.name, updatedAt: person.updatedAt } as any);
  };
</script>

{#if people.length > 0}
  <div class="flex items-center gap-3 overflow-x-auto py-2" data-testid="people-strip">
    {#each people as person (person.id)}
      <button
        type="button"
        class="flex shrink-0 flex-col items-center gap-1"
        onclick={() => onPersonClick?.(person.id)}
        data-testid="person-thumb-{person.id}"
      >
        <div
          class="size-12 overflow-hidden rounded-full {selectedPersonId === person.id
            ? 'ring-2 ring-offset-2 ring-immich-primary'
            : ''}"
          data-testid="person-ring-{person.id}"
        >
          <img src={getThumbUrl(person)} alt={getDisplayName(person)} class="size-full object-cover" loading="lazy" />
        </div>
        <span
          class="max-w-[56px] truncate text-xs {selectedPersonId === person.id
            ? 'font-semibold text-immich-primary'
            : 'text-gray-600 dark:text-gray-400'}"
          data-testid="person-label-{person.id}"
        >
          {getDisplayName(person)}
        </span>
      </button>
    {/each}

    {#if people.length > SEE_ALL_THRESHOLD}
      <a
        href="/spaces/{spaceId}/people"
        class="flex shrink-0 items-center gap-0.5 whitespace-nowrap text-xs font-medium text-immich-primary hover:underline"
        data-testid="see-all-people"
      >
        {$t('spaces_see_all_people', { values: { count: people.length } })}
        <Icon icon={mdiChevronRight} size="14" />
      </a>
    {/if}
  </div>
{/if}
