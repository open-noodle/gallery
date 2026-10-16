<script lang="ts">
  import AvatarSourceToggle from '$lib/gallery/asset-viewer/AvatarSourceToggle.svelte';
  import PersonTile from '$lib/gallery/asset-viewer/PersonTile.svelte';
  import { assetViewerManager } from '$lib/managers/asset-viewer-manager.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { faceManager } from '$lib/stores/face.svelte';
  import { locale } from '$lib/stores/preferences.store';
  import { type AssetResponseDto } from '@immich/sdk';
  import { IconButton, Text } from '@immich/ui';
  import { mdiEye, mdiEyeOff, mdiPencil, mdiPlus } from '@mdi/js';
  import { DateTime } from 'luxon';
  import { t } from 'svelte-i18n';

  type Props = {
    asset: AssetResponseDto;
    isOwner: boolean;
    /** Space Owner/Editor who does not own the asset: the space face affordances (see `canEditSpacePeople`). */
    canEditSpacePeople?: boolean;
    previousRoute: string;
    canFilter?: boolean;
    spaceId?: string;
  };

  const { asset, isOwner, canEditSpacePeople = false, previousRoute, canFilter = false, spaceId }: Props = $props();

  const isSpaceMember = $derived(!!spaceId);
  const people = $derived(isSpaceMember && !isOwner ? asset.people || [] : Array.from(faceManager.people));
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

<!-- Anyone who can read the asset sees who is in it (#796); only the affordances stay owner or editor gated. -->
{#if !authManager.isSharedLink && (isOwner || canEditSpacePeople || visiblePeople.length > 0)}
  <section class="px-4 pt-4 text-sm" data-testid="detail-panel-people">
    <!-- Repeats the section guard on purpose: it keeps the header at upstream's nesting. -->
    {#if isOwner || canEditSpacePeople || visiblePeople.length > 0}
      <div class="flex h-10 w-full items-center justify-between">
        <Text size="small" color="muted">{$t('people')}</Text>
        <div class="flex items-center gap-2">
          <AvatarSourceToggle people={visiblePeople} {isOwner} {spaceId} />
          {#if isOwner || canEditSpacePeople}
            {#if isOwner && people.some((person) => person.isHidden)}
              <IconButton
                aria-label={$t('show_hidden_people')}
                icon={assetViewerManager.isShowingHiddenPeople ? mdiEyeOff : mdiEye}
                size="medium"
                shape="round"
                color="secondary"
                variant="ghost"
                onclick={() => assetViewerManager.toggleHiddenPeople()}
              />
            {/if}
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
        <PersonTile
          {asset}
          {person}
          {personFaces}
          {isHighlighted}
          {isOwner}
          {spaceId}
          {canFilter}
          {previousRoute}
          compact={visiblePeople.length > 6}
        />
      {/each}
    </div>
  </section>
{/if}
