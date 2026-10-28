<script lang="ts">
  import FormatMessage from '$lib/elements/FormatMessage.svelte';
  import ShortcutKeycap from '$lib/gallery/components/shortcut-keycap.svelte';
  import { getAssetMediaUrl } from '$lib/utils';
  import { monthDayLabel } from '$lib/utils/cleanup';
  import { AssetMediaSize, type CleanupAssetDto } from '@immich/sdk';
  import { Icon, IconButton } from '@immich/ui';
  import { mdiCheck, mdiClose, mdiHeart } from '@mdi/js';
  import { locale, t } from 'svelte-i18n';

  type Props = {
    monthDay: number;
    /** A few photos of the date, for the stack beside the text. */
    assets: CleanupAssetDto[];
    onClose: () => void;
  };

  let { monthDay, assets, onClose }: Props = $props();

  const date = $derived(monthDayLabel(monthDay, $locale ?? 'en'));
  const stack = $derived(assets.slice(0, 3).reverse());
  const marks = [
    { label: 'cleanup_shortcut_keep', key: 'K', icon: mdiCheck, class: 'bg-success' },
    { label: 'favorite', key: 'F', icon: mdiHeart, class: 'bg-pink-500' },
    { label: 'cleanup_mark_for_trash', key: 'Delete', icon: mdiClose, class: 'bg-danger' },
  ] as const;
</script>

<section
  class="relative grid gap-4 rounded-2xl border bg-linear-to-br from-primary/15 via-primary/5 to-transparent p-4 sm:grid-cols-[auto_minmax(0,1fr)] md:p-5"
  data-testid="cleanup-rewind-explainer"
>
  {#if stack.length > 0}
    <div class="relative hidden h-16 w-20 shrink-0 sm:block" aria-hidden="true">
      {#each stack as asset, index (asset.id)}
        <img
          src={getAssetMediaUrl({ id: asset.id, size: AssetMediaSize.Thumbnail, cacheKey: asset.thumbhash })}
          alt=""
          draggable="false"
          class="absolute size-14 rounded-xl border-2 border-light object-cover shadow-md"
          style:left="{index * 10}px"
          style:top="{(stack.length - 1 - index) * 3}px"
          style:rotate="{(index - stack.length + 1) * 6}deg"
        />
      {/each}
    </div>
  {/if}

  <div class="min-w-0 pe-8">
    <h3 class="text-base font-semibold">{$t('cleanup_explainer_title', { values: { date } })}</h3>
    <p class="mt-1 max-w-2xl text-sm text-muted">{$t('cleanup_explainer_body')}</p>
    <div class="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
      {#each marks as mark (mark.label)}
        <span class="inline-flex items-center gap-1.5">
          <span class="grid size-5 place-items-center rounded-full text-white {mark.class}">
            <Icon icon={mark.icon} size="12" />
          </span>
          {$t(mark.label)}
          <ShortcutKeycap key={mark.key} />
        </span>
      {/each}
      <span class="text-muted">
        <FormatMessage key="cleanup_explainer_nothing_deleted">
          {#snippet children({ tag, message })}
            {#if tag === 'b'}<b class="text-dark">{message}</b>{:else}{message}{/if}
          {/snippet}
        </FormatMessage>
      </span>
    </div>
  </div>

  <IconButton
    icon={mdiClose}
    shape="round"
    variant="ghost"
    color="secondary"
    size="small"
    class="absolute inset-e-2 top-2"
    aria-label={$t('close')}
    data-testid="cleanup-rewind-explainer-close"
    onclick={onClose}
  />
</section>
