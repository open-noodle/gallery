<script lang="ts">
  import { page } from '$app/state';
  import ImageThumbnail from '$lib/components/assets/thumbnail/ImageThumbnail.svelte';
  import { assetViewerManager, type Faces } from '$lib/managers/asset-viewer-manager.svelte';
  import { Route } from '$lib/route';
  import { cropFacesFromAsset } from '$lib/gallery/stores/preferences.store';
  import { getAssetUrls } from '$lib/utils';
  import {
    buildContextualFilterUrl,
    buildPersonFilterPatch,
    rememberContextualPersonName,
  } from '$lib/utils/filter-target';
  import { zoomImageToBase64 } from '$lib/utils/people-utils';
  import { resolvePersonAvatar } from '$lib/utils/person-avatar';
  import { getPetBadgeLabel } from '$lib/utils/pet-species';
  import { type AssetResponseDto } from '@immich/sdk';
  import { Icon, IconButton } from '@immich/ui';
  import { mdiOpenInNew, mdiPaw } from '@mdi/js';
  import { t } from 'svelte-i18n';

  type AssetPerson = NonNullable<AssetResponseDto['people']>[number];

  /** One person in the detail panel's People row: a filter chip, or the person-page link when there is no filter to offer. */
  type Props = {
    asset: AssetResponseDto;
    person: AssetPerson & { formattedBirthDate?: string; formattedAge?: string };
    personFaces: Faces[];
    isHighlighted: boolean;
    isOwner: boolean;
    spaceId?: string;
    canFilter: boolean;
    previousRoute: string;
    /** Many people: the age line shrinks with the denser grid. */
    compact: boolean;
  };

  const { asset, person, personFaces, isHighlighted, isOwner, spaceId, canFilter, previousRoute, compact }: Props =
    $props();

  // A non-owner has no access to the owner-scoped person page, so their name is rendered as plain
  // text rather than a link into a 404.
  const getPersonPageHref = () => {
    if (spaceId && person.spacePersonId) {
      return Route.viewSpacePerson(spaceId, person.spacePersonId);
    }
    return isOwner ? Route.viewPerson(person, { previousRoute }) : undefined;
  };

  /**
   * R8 — the person patch is TARGET-DEPENDENT, and getting it wrong 400s the Space timeline. All of
   * that lives in buildPersonFilterPatch; null means "there is nothing honest to filter by here", so
   * the chip falls back to being the person-page link it is today.
   */
  const getPersonFilterHref = () => {
    if (!canFilter) {
      return undefined;
    }

    const patch = buildPersonFilterPatch(page.url, person);
    return patch ? buildContextualFilterUrl(page.url, patch) : undefined;
  };

  /**
   * The destination's chip and filter panel resolve a person id to a name through the
   * filter-suggestions response, which is a round-trip late and does not always carry THIS token
   * (see rememberContextualPersonName). Bank the name we already have on the way out, so the chip
   * never renders a raw id.
   */
  const rememberPersonName = (href: string) => {
    const patch = buildPersonFilterPatch(page.url, person);
    const personId = patch?.personIds?.[0];
    if (personId) {
      rememberContextualPersonName(href, personId, person.name);
    }
  };

  const avatarSource = $derived(
    resolvePersonAvatar({
      person,
      isOwner,
      spaceId,
      hasFaceInAsset: personFaces.length > 0,
      cropFacesFromAsset: $cropFacesFromAsset,
      assetThumbnailUrl: getAssetUrls(asset).thumbnail,
    }),
  );
  const filterHref = $derived(getPersonFilterHref());
  const personPageHref = $derived(getPersonPageHref());
</script>

{#snippet avatar(url: string)}
  <ImageThumbnail
    curve
    shadow
    {url}
    altText={person.name}
    title={person.name}
    widthStyle="100%"
    hidden={person.isHidden}
    highlighted={isHighlighted}
    class="outline-offset-2 outline-immich-primary group-focus-visible:outline-2 dark:outline-immich-dark-primary"
  />
{/snippet}

<!--
  R6 — the chip IS the <a>, and it carries the four face-highlight handlers that drive the face
  overlay. The ↗ person-page link cannot nest inside it (a link inside a link), so it is a
  SIBLING overlay control on a relative wrapper. When there is no honest filter to offer
  (buildPersonFilterPatch → null, e.g. a Space person with no spacePersonId, or a shared link),
  the chip stays the person-page link it is today and no ↗ renders.
-->
<div class="relative">
  <a
    class="group relative block outline-none"
    href={filterHref ?? personPageHref}
    aria-label={filterHref ? `${$t('filter_by_person')}: ${person.name}` : undefined}
    onclick={filterHref ? () => rememberPersonName(filterHref) : undefined}
    onfocus={() => assetViewerManager.setHighlightedFaces(personFaces)}
    onblur={() => assetViewerManager.clearHighlightedFaces()}
    onpointerenter={() => assetViewerManager.setHighlightedFaces(personFaces)}
    onpointerleave={() => assetViewerManager.clearHighlightedFaces()}
  >
    {#if avatarSource.kind === 'assetFace'}
      {#await zoomImageToBase64(personFaces[0]!, asset.id, asset.type, assetViewerManager.imgRef)}
        {@render avatar(avatarSource.fallbackUrl)}
      {:then faceThumbnailUrl}
        {@render avatar(faceThumbnailUrl ?? avatarSource.fallbackUrl)}
      {/await}
    {:else}
      {@render avatar(avatarSource.url)}
    {/if}
    {#if person.type === 'pet'}
      {@const petBadgeLabel = getPetBadgeLabel(person.species, $t)}
      <div
        class="absolute right-1 bottom-1 rounded-full bg-immich-primary p-1 text-white"
        data-testid="pet-badge"
        role="img"
        aria-label={petBadgeLabel}
        title={petBadgeLabel}
      >
        <Icon icon={mdiPaw} size="16" class="text-white" />
      </div>
    {/if}
    <p class="mt-1 truncate font-medium" title={person.name}>{person.name}</p>
    {#if person.birthDate && person.formattedAge}
      <p class="font-light {compact ? 'text-xs' : ''}" title={person.formattedBirthDate!}>
        {person.formattedAge}
      </p>
    {/if}
  </a>
  {#if filterHref && personPageHref}
    <div class="absolute top-1 right-1 rounded-full bg-light/80">
      <IconButton
        href={personPageHref}
        icon={mdiOpenInNew}
        aria-label="{$t('view_person')}: {person.name}"
        size="small"
        shape="round"
        color="secondary"
        variant="ghost"
      />
    </div>
  {/if}
</div>
