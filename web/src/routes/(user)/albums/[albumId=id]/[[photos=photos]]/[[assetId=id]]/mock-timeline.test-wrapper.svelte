<script lang="ts">
  interface Props {
    timelineManager?: any;
    options?: Record<string, unknown>;
    album?: { assetCount?: number };
  }

  let { timelineManager = $bindable(), options = {}, album }: Props = $props();

  $effect(() => {
    const tagIds = Array.isArray(options.tagIds) ? options.tagIds : [];
    const empty = tagIds.includes('tag-no-match') || album?.assetCount === 0;

    timelineManager = {
      months: empty ? [] : [{ yearMonth: { year: 2024, month: 4 }, assetsCount: 2 }],
      assetCount: empty ? 0 : 2,
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
<slot />
