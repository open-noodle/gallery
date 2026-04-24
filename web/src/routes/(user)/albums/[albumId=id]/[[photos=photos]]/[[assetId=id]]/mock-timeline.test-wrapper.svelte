<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    timelineManager?: any;
    options?: Record<string, unknown>;
    album?: { assetCount?: number };
    children?: Snippet;
  }

  let { timelineManager = $bindable(), options = {}, album, children }: Props = $props();

  $effect(() => {
    const tagIds = Array.isArray(options.tagIds) ? options.tagIds : [];
    const empty = tagIds.includes('tag-no-match') || album?.assetCount === 0;
    const monthsOnly = album?.id === 'timeline-months-only';

    timelineManager = {
      months: empty ? [] : [{ yearMonth: { year: 2024, month: 4 }, assetsCount: 2 }],
      assetCount: empty || monthsOnly ? 0 : 2,
      isInitialized: true,
      showAssetOwners: false,
      albumAssets: new Set(['asset-in-album']),
      suspendTransitions: false,
      removeAssets: () => {},
      upsertAssets: () => {},
      update: () => {},
      toggleShowAssetOwners: () => {},
      getRandomAsset: async () => undefined,
    };
  });
</script>

<div data-testid="timeline-options">{JSON.stringify(options)}</div>
<div data-testid="mock-disabled-asset" data-asset="asset-in-album" data-disabled="true"></div>
{@render children?.()}
