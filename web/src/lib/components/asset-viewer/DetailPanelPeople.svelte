<script lang="ts">
  import ImageThumbnail from '$lib/components/assets/thumbnail/ImageThumbnail.svelte';
  import { assetViewerManager } from '$lib/managers/asset-viewer-manager.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { Route } from '$lib/route';
  import { faceManager } from '$lib/stores/face.svelte';
  import { locale } from '$lib/stores/preferences.store';
  import { createUrl, getAssetUrls, getPeopleThumbnailUrl } from '$lib/utils';
  import { zoomImageToBase64 } from '$lib/utils/people-utils';
  import { type AssetResponseDto } from '@immich/sdk';
  import { IconButton, Text } from '@immich/ui';
  import { mdiEye, mdiEyeOff, mdiPencil, mdiPlus } from '@mdi/js';
  import { DateTime } from 'luxon';
  import { t } from 'svelte-i18n';

  type Props = {
    asset: AssetResponseDto;
    isOwner: boolean;
    previousRoute: string;
    spaceId?: string;
  };

  const { asset, isOwner, previousRoute, spaceId }: Props = $props();

  type AssetPerson = NonNullable<AssetResponseDto['people']>[number];

  const isSpaceMember = $derived(!!spaceId);
  const people = $derived(isSpaceMember && !isOwner ? asset.people || [] : Array.from(faceManager.people));
  // `/people/{id}/thumbnail` is owner-gated AND is cropped from the person's feature photo — a
  // DIFFERENT asset the viewer may have no right to see. Never request it for a non-owner (#796):
  // their avatar is cropped client-side from the asset already on screen, and this asset's own
  // thumbnail (which they can definitely see) stands in while that crop resolves.
  const getPersonFallbackThumbnailUrl = (person: AssetPerson) => {
    if (spaceId && person.spacePersonId) {
      return createUrl(`/shared-spaces/${spaceId}/people/${person.spacePersonId}/thumbnail`, {
        updatedAt: person.updatedAt,
      });
    }
    return isOwner ? getPeopleThumbnailUrl(person) : getAssetUrls(asset).thumbnail;
  };

  // A non-owner has no access to the owner-scoped person page, so their name is rendered as plain
  // text rather than a link into a 404.
  const getPersonHref = (person: AssetPerson) => {
    if (spaceId && person.spacePersonId) {
      return Route.viewSpacePerson(spaceId, person.spacePersonId);
    }
    return isOwner ? Route.viewPerson(person, { previousRoute }) : undefined;
  };
  const visiblePeople = $derived(
    people
      .filter((p) => assetViewerManager.isShowingHiddenPeople || !p.isHidden)
      .map((person) => {
        if (!person.birthDate) {
          return { formattedBirthDate: undefined, formattedAge: undefined, ...person };
        }
        const personBirthDate = DateTime.fromISO(person.birthDate);
        const ageInYears = Math.floor(DateTime.fromISO(asset.localDateTime).diff(personBirthDate, 'years').years);
        const ageInMonths = Math.floor(DateTime.fromISO(asset.localDateTime).diff(personBirthDate, 'months').months);

        let formattedAge;
        if (ageInYears < 0) {
          return { formattedBirthDate: undefined, formattedAge: undefined, ...person };
        }
        if (ageInMonths < 12) {
          formattedAge = $t('age_months', { values: { months: ageInMonths } });
        } else if (ageInMonths > 12 && ageInMonths < 24) {
          formattedAge = $t('age_year_months', { values: { months: ageInMonths - 12 } });
        } else {
          formattedAge = $t('age_years', { values: { years: ageInYears } });
        }

        const formattedBirthDate = personBirthDate.toLocaleString(
          {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          },
          { locale: $locale },
        );
        return { formattedBirthDate, formattedAge, ...person };
      }),
  );
</script>

<!--
  Who is in a photo is read-only metadata: anyone with read access to the asset sees the panel
  (#796) — `GET /faces` already authorizes on AssetRead (owner ∪ album ∪ partner ∪ space), so a
  non-owner reaching this panel is entitled to the data. Only the affordances below (hidden-people
  toggle, add-face, edit-faces) stay owner-gated. A non-owner with nobody to show gets no empty
  section; the owner keeps it so the add-face affordance stays reachable on a face-less asset.
-->
{#if !authManager.isSharedLink && (isOwner || visiblePeople.length > 0)}
  <section class="px-4 pt-4 text-sm" data-testid="detail-panel-people">
    <div class="flex h-10 w-full items-center justify-between">
      <Text size="small" color="muted">{$t('people')}</Text>
      <div class="flex items-center gap-2">
        {#if isOwner}
          {#if people.some((person) => person.isHidden)}
            <IconButton
              aria-label={$t('tag_people')}
              icon={mdiPlus}
              size="medium"
              shape="round"
              color="secondary"
              variant="ghost"
              onclick={() => assetViewerManager.toggleFaceEditMode()}
            />

            {#if faceManager.data.length > 0}
              <IconButton
                aria-label={$t('edit_people')}
                icon={mdiPencil}
                size="medium"
                shape="round"
                color="secondary"
                variant="ghost"
                onclick={() => assetViewerManager.openEditFacesPanel()}
              />
            {/if}
          {/if}
        </div>
      </div>
    {/if}

    <div class="mt-2 grid {visiblePeople.length <= 6 ? 'grid-cols-3 gap-3' : 'grid-cols-4 gap-2'}">
      {#each visiblePeople as person (person.id)}
        {@const personFaces = faceManager.facesByPersonId.get(person.id) ?? []}
        {@const isHighlighted = personFaces.some((f) => assetViewerManager.highlightedFaces.some((b) => b.id === f.id))}
        {@const fallbackThumbnailUrl = getPersonFallbackThumbnailUrl(person)}
        <a
          class="group outline-none"
          href={getPersonHref(person)}
          onfocus={() => assetViewerManager.setHighlightedFaces(personFaces)}
          onblur={() => assetViewerManager.clearHighlightedFaces()}
          onpointerenter={() => assetViewerManager.setHighlightedFaces(personFaces)}
          onpointerleave={() => assetViewerManager.clearHighlightedFaces()}
        >
          {#if personFaces[0]}
            {#await zoomImageToBase64(personFaces[0], asset.id, asset.type, assetViewerManager.imgRef)}
              <ImageThumbnail
                curve
                shadow
                url={fallbackThumbnailUrl}
                altText={person.name}
                title={person.name}
                widthStyle="100%"
                hidden={person.isHidden}
                highlighted={isHighlighted}
                class="outline-offset-2 outline-immich-primary group-focus-visible:outline-2 dark:outline-immich-dark-primary"
              />
            {:then faceThumbnailUrl}
              <ImageThumbnail
                curve
                shadow
                url={faceThumbnailUrl ?? fallbackThumbnailUrl}
                altText={person.name}
                title={person.name}
                widthStyle="100%"
                hidden={person.isHidden}
                highlighted={isHighlighted}
                class="outline-offset-2 outline-immich-primary group-focus-visible:outline-2 dark:outline-immich-dark-primary"
              />
            {/await}
          {:else}
            <ImageThumbnail
              curve
              shadow
              url={fallbackThumbnailUrl}
              altText={person.name}
              title={person.name}
              widthStyle="100%"
              hidden={person.isHidden}
              highlighted={isHighlighted}
              class="outline-offset-2 outline-immich-primary group-focus-visible:outline-2 dark:outline-immich-dark-primary"
            />
          {/if}
          <p class="mt-1 truncate font-medium" title={person.name}>{person.name}</p>
          {#if person.birthDate && person.formattedAge}
            <p class="font-light {visiblePeople.length > 6 ? 'text-xs' : ''}" title={person.formattedBirthDate!}>
              {person.formattedAge}
            </p>
          {/if}
        </a>
      {/each}
    </div>
  </section>
{/if}
