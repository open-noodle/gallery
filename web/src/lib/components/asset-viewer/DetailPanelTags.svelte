<script lang="ts">
  import { page } from '$app/state';
  import HeaderActionButton from '$lib/components/HeaderActionButton.svelte';
  import OnEvents from '$lib/components/OnEvents.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { Route } from '$lib/route';
  import { getAssetActions } from '$lib/services/asset.service';
  import { removeTag } from '$lib/utils/asset-utils';
  import { buildContextualFilterUrl } from '$lib/utils/filter-target';
  import { getAssetInfo, type AssetResponseDto } from '@immich/sdk';
  import { Badge, IconButton, Link, Text } from '@immich/ui';
  import { mdiOpenInNew } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    asset: AssetResponseDto;
    isOwner: boolean;
    /**
     * R4/E2 — false on a shared link, where there is no timeline to filter. Threaded from
     * DetailPanel exactly like `isOwner`. (Tags are already shared-link-suppressed by the section
     * gate below; this is belt-and-braces.)
     */
    canFilter?: boolean;
    spaceId?: string;
  }

  let { asset = $bindable(), isOwner, canFilter = false, spaceId }: Props = $props();
  let effectiveSpaceId = $derived(spaceId || asset.resolvedSpaceId);

  let tags = $derived(asset.tags || []);

  const handleRemove = async (tagId: string) => {
    const ids = await removeTag({ tagIds: [tagId], assetIds: [asset.id], showNotification: false });
    if (ids) {
      asset = await getAssetInfo({ id: asset.id, spaceId: effectiveSpaceId });
    }
  };

  const onAssetsTag = async (ids: string[]) => {
    if (ids.includes(asset.id)) {
      asset = await getAssetInfo({ id: asset.id, spaceId: effectiveSpaceId });
    }
  };

  const { Tag } = $derived(getAssetActions($t, asset));
</script>

<OnEvents {onAssetsTag} />

<!--
  Tags are read-only metadata: anyone with read access to the asset sees them (#796). Only the
  edit affordances below (per-tag remove, "add tag") stay owner-gated. Non-owners with no tags to
  show get no empty section; the owner keeps it so the "add tag" affordance is always reachable.
-->
{#if !authManager.isSharedLink && (isOwner || tags.length > 0)}
  <section class="mt-4 px-4">
    <div class="flex h-10 w-full items-center justify-between text-sm">
      <Text color="muted">{$t('tags')}</Text>
    </div>
    <section class="flex flex-wrap gap-1 pt-2" data-testid="detail-panel-tags">
      {#each tags as tag (tag.id)}
        <Badge
          onClose={isOwner ? () => handleRemove(tag.id) : undefined}
          size="small"
          shape="round"
          translations={{ close: $t('remove_tag') }}
        >
          <!--
            R10 — the tag VALUE stays a link, and stays the FIRST link in this row: the stack
            Playwright spec locates it as `getByTestId('detail-panel-tags').getByRole('link').first()`
            and asserts its text. Only its href changes (E25: the contextual-filter URL, whose tagIds
            REPLACE any active tag filter rather than appending to it). Keeping it an <a> also buys
            middle-click / open-in-new-tab for free. The old /tags navigation moves to the ↗ AFTER it.
          -->
          {#if canFilter}
            <Link
              href={buildContextualFilterUrl(page.url, { tagIds: [tag.id] })}
              aria-label="{$t('filter_by_tag')}: {tag.value}"
              underline={false}
              class="px-2 font-light"
            >
              {tag.value}
            </Link>
            <IconButton
              href={Route.tags({ path: tag.value })}
              icon={mdiOpenInNew}
              aria-label="{$t('view_tag')}: {tag.value}"
              size="small"
              shape="round"
              color="secondary"
              variant="ghost"
            />
          {:else}
            <Link href={Route.tags({ path: tag.value })} underline={false} class="px-2 font-light">
              {tag.value}
            </Link>
          {/if}
        </Badge>
      {/each}
      {#if isOwner}
        <HeaderActionButton action={Tag} />
      {/if}
    </section>
  </section>
{/if}
