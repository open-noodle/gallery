<script lang="ts">
  import type { ActiveItem } from '$lib/managers/global-search-manager.svelte';
  import PhotoPreview from './previews/photo-preview.svelte';
  import PersonPreview from './previews/person-preview.svelte';
  import PlacePreview from './previews/place-preview.svelte';
  import TagPreview from './previews/tag-preview.svelte';
  import { t } from 'svelte-i18n';

  interface Props {
    activeItem: ActiveItem | null;
  }
  let { activeItem }: Props = $props();
</script>

{#if activeItem === null}
  <div class="flex h-full items-center justify-center text-sm text-gray-500 opacity-40 dark:text-gray-400">
    {$t('cmdk_nothing_to_preview')}
  </div>
{:else if activeItem.kind === 'photo'}
  <PhotoPreview photo={activeItem.data as never} />
{:else if activeItem.kind === 'person'}
  <PersonPreview person={activeItem.data as never} />
{:else if activeItem.kind === 'place'}
  <PlacePreview place={activeItem.data as never} />
{:else if activeItem.kind === 'tag'}
  <TagPreview tag={activeItem.data as never} />
{/if}
