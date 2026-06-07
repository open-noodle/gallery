<script lang="ts">
  import Thumbhash from '$lib/components/Thumbhash.svelte';
  import { getAssetMediaUrl } from '$lib/utils';
  import type { ActivatableTimelineBucket } from '$lib/utils/timeline-zoom-navigation';
  import { AssetMediaSize } from '@immich/sdk';

  type TimelineBucketCardBucket = ActivatableTimelineBucket & {
    timeBucket: string;
    count: number;
    representativeAssetId?: string | null;
    representativeThumbhash?: string | null;
  };

  interface Props {
    bucket: TimelineBucketCardBucket;
    locale?: string;
    loading?: boolean;
    disabled?: boolean;
    onActivate: (bucket: ActivatableTimelineBucket) => void;
  }

  let { bucket, locale = 'en-US', loading = false, disabled = false, onActivate }: Props = $props();

  let loadedImageKey: string | undefined = $state();
  let failedImageKey: string | undefined = $state();

  let imageKey = $derived(`${bucket.representativeAssetId ?? ''}:${bucket.representativeThumbhash ?? ''}`);
  let imageLoaded: boolean = $derived(loadedImageKey === imageKey);
  let imageFailed: boolean = $derived(failedImageKey === imageKey);

  let title = $derived.by(() => {
    if (bucket.grouping === 'month') {
      return new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
        new Date(bucket.timeBucket),
      );
    }

    return String(bucket.date.year);
  });

  let countLabel = $derived.by(() => {
    const count = new Intl.NumberFormat(locale).format(bucket.count);
    return `${count} ${bucket.count === 1 ? 'photo' : 'photos'}`;
  });

  let actionLabel = $derived.by(() => {
    if (bucket.grouping === 'year') {
      return 'show months';
    }

    if (bucket.grouping === 'month') {
      return 'show all photos from this point';
    }
  });

  let accessibleLabel = $derived(`${title}, ${countLabel}${actionLabel ? `, ${actionLabel}` : ''}`);

  let hasImage: boolean = $derived(Boolean(bucket.representativeAssetId) && !loading && !imageFailed);
  let imageUrl = $derived.by(() => {
    if (!hasImage || !bucket.representativeAssetId) {
      return undefined;
    }

    return getAssetMediaUrl({
      id: bucket.representativeAssetId,
      size: AssetMediaSize.Thumbnail,
      cacheKey: bucket.representativeThumbhash ?? undefined,
    });
  });
  let renderState: 'loading' | 'image' | 'fallback' = $derived(loading ? 'loading' : hasImage ? 'image' : 'fallback');

  const activate = () => {
    if (disabled) {
      return;
    }

    onActivate({ grouping: bucket.grouping, date: bucket.date });
  };

  const getEventImageKey = (event: Event) => (event.currentTarget as HTMLImageElement).dataset.imageKey;

  const handleImageLoad = (event: Event) => {
    const eventImageKey = getEventImageKey(event);
    if (eventImageKey === imageKey) {
      loadedImageKey = eventImageKey;
    }
  };

  const handleImageError = (event: Event) => {
    const eventImageKey = getEventImageKey(event);
    if (eventImageKey === imageKey) {
      failedImageKey = eventImageKey;
    }
  };
</script>

<button
  type="button"
  class="group relative block h-full min-h-56 w-full overflow-hidden rounded-lg border border-gray-200 bg-gray-200 text-left text-white shadow-sm transition hover:border-gray-300 hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-immich-primary disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700"
  aria-label={accessibleLabel}
  {disabled}
  data-state={renderState}
  data-testid="timeline-bucket-card"
  onclick={activate}
>
  <div class="absolute inset-0 overflow-hidden bg-gray-200 dark:bg-gray-800" data-testid="timeline-bucket-card-media">
    {#if hasImage && imageUrl}
      {#if bucket.representativeThumbhash && !imageLoaded}
        <Thumbhash
          base64ThumbHash={bucket.representativeThumbhash}
          class="absolute inset-0 h-full w-full object-cover"
          fadeOut
        />
      {/if}

      {#key imageKey}
        <img
          src={imageUrl}
          alt=""
          draggable="false"
          class="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
          data-testid="timeline-bucket-card-image"
          data-image-key={imageKey}
          onload={handleImageLoad}
          onerror={handleImageError}
        />
      {/key}
    {:else}
      <div
        class="flex h-full w-full items-center justify-center bg-gray-200 px-3 text-center text-4xl font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-300"
        data-testid="timeline-bucket-card-fallback"
      >
        {title}
      </div>
    {/if}
  </div>

  <div
    class="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/80 via-black/45 to-transparent p-4 text-white"
    data-testid="timeline-bucket-card-overlay"
  >
    <div
      class="truncate text-2xl font-semibold leading-none tracking-normal sm:text-3xl"
      data-testid="timeline-bucket-card-title"
    >
      {title}
    </div>
    <div
      class="mt-2 inline-flex max-w-full rounded-full bg-white/90 px-2.5 py-1 text-xs font-medium text-gray-900 shadow-sm"
      data-testid="timeline-bucket-card-count"
    >
      {countLabel}
    </div>
  </div>
</button>
