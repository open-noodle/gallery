<script lang="ts">
  import type { RecentEntry } from '$lib/stores/cmdk-recent';
  import PhotoRow from './photo-row.svelte';
  import PersonRow from './person-row.svelte';
  import PlaceRow from './place-row.svelte';
  import TagRow from './tag-row.svelte';

  interface Props {
    entry: RecentEntry;
  }
  let { entry }: Props = $props();
</script>

{#if entry.kind === 'query'}
  <div
    class="flex h-[52px] items-center gap-3 rounded-lg px-3 py-2 transition-colors duration-[80ms] ease-out data-[selected=true]:bg-primary/10"
  >
    <span class="text-sm text-gray-500 dark:text-gray-400" aria-hidden="true">🔍</span>
    <div class="truncate text-sm">{entry.text}</div>
  </div>
{:else if entry.kind === 'photo'}
  <PhotoRow item={{ id: entry.assetId, originalFileName: entry.label } as never} />
{:else if entry.kind === 'person'}
  <PersonRow item={{ id: entry.personId, name: entry.label, faceAssetId: entry.thumbnailAssetId } as never} />
{:else if entry.kind === 'place'}
  <PlaceRow
    item={{ name: entry.label, latitude: entry.latitude, longitude: entry.longitude } as never}
  />
{:else if entry.kind === 'tag'}
  <TagRow item={{ id: entry.tagId, name: entry.label, color: null } as never} />
{/if}
