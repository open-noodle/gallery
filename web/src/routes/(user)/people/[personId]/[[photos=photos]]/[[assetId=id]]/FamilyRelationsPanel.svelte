<script lang="ts">
  import ImageThumbnail from '$lib/components/assets/thumbnail/ImageThumbnail.svelte';
  import { getPeopleThumbnailUrl } from '$lib/utils';
  import { t } from 'svelte-i18n';
  import type { FamilyPanelAccess, FamilyRelationEntry } from './family-relations';

  // Gallery-fork: family relationships, slice 8. Renders the page person's own relations
  // beneath the existing header — see specs/2026-08-31-family-relationships-design-and-slices.md
  // D5.3 (A2, A5, A12) and the mockup's §4. Reuses the header's `ImageThumbnail circle shadow`
  // avatar treatment; adds no second header and no new avatar primitive.
  //
  // `A12`: effective access `none` — or the page person being a pet (`E55`) — renders NOTHING at
  // all, not an empty or locked section. An empty state would advertise a feature the viewer
  // cannot use and imply relationships exist.

  interface Props {
    isPet: boolean;
    access: FamilyPanelAccess;
    relations: FamilyRelationEntry[];
    onAddRelationship?: () => void;
  }

  let { isPet, access, relations, onAddRelationship = undefined }: Props = $props();

  let visible = $derived(!isPet && access !== 'none');
</script>

{#if visible}
  <section class="mt-4 flex flex-col gap-3 px-4 sm:px-6" data-testid="family-relations-panel">
    <p class="text-sm font-medium text-gray-700 dark:text-gray-100">{$t('family_person_section_title')}</p>

    {#each relations as relation, index (relation.kind === 'known' ? relation.person.id : `anon-${relation.slot}-${index}`)}
      {#if relation.kind === 'known'}
        <div class="flex items-center gap-3" data-testid="family-relation-row">
          <ImageThumbnail
            circle
            shadow
            url={getPeopleThumbnailUrl(relation.person)}
            altText={relation.person.name}
            widthStyle="2.25rem"
            heightStyle="2.25rem"
          />
          <div class="flex flex-col text-start">
            <p class="text-sm text-primary">{relation.person.name}</p>
            <p class="text-xs text-gray-500 dark:text-gray-400">{relation.label}</p>
          </div>
        </div>
      {:else}
        <div class="flex items-center gap-3" data-testid="family-anonymous-seat">
          <div
            class="flex items-center justify-center rounded-full bg-gray-200 text-gray-500 shadow-lg dark:bg-gray-700 dark:text-gray-400"
            style="width: 2.25rem; height: 2.25rem;"
          >
            ?
          </div>
          <div class="flex flex-col text-start">
            <p class="text-sm text-gray-500 italic dark:text-gray-400">{$t('family_person_anonymous_name')}</p>
            <p class="text-xs text-gray-500 dark:text-gray-400">{relation.label}</p>
          </div>
        </div>
      {/if}
    {/each}

    {#if access === 'contribute'}
      <button
        type="button"
        class="self-start text-sm text-primary hover:underline"
        data-testid="family-add-relationship"
        onclick={onAddRelationship}
      >
        {$t('family_person_add_relationship')}
      </button>
    {/if}
  </section>
{/if}
