<script lang="ts">
  import { page } from '$app/state';
  import ImageThumbnail from '$lib/components/assets/thumbnail/ImageThumbnail.svelte';
  import { assetViewerManager } from '$lib/managers/asset-viewer-manager.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { Route } from '$lib/route';
  import { faceManager } from '$lib/stores/face.svelte';
  import { cropFacesFromAsset, locale } from '$lib/stores/preferences.store';
  import { getAssetUrls } from '$lib/utils';
  import {
    buildContextualFilterUrl,
    buildPersonFilterPatch,
    rememberContextualPersonName,
  } from '$lib/utils/filter-target';
  import { zoomImageToBase64 } from '$lib/utils/people-utils';
  import { getRepresentativeThumbnailUrl, resolvePersonAvatar } from '$lib/utils/person-avatar';
  import { type AssetResponseDto } from '@immich/sdk';
  import { IconButton, Text } from '@immich/ui';
  import { mdiAccountBoxOutline, mdiCropFree, mdiEye, mdiEyeOff, mdiOpenInNew, mdiPencil, mdiPlus } from '@mdi/js';
  import { DateTime } from 'luxon';
  import { t } from 'svelte-i18n';

  type Props = {
    asset: AssetResponseDto;
    isOwner: boolean;
    previousRoute: string;
    /**
     * R4/E2 — false on a shared link. (People are already shared-link-suppressed by the section gate
     * below; this is belt-and-braces, and keeps the row's gate identical to every other row's.)
     */
    canFilter?: boolean;
    spaceId?: string;
  };

  const { asset, isOwner, previousRoute, canFilter = false, spaceId }: Props = $props();

  // `familyRelationLabel` is not (yet) part of the generated `PersonResponseDto` — no data source
  // populates it today, so this line stays inert until something wires it in. When present, it is
  // ALREADY the fully-derived, viewer-specific string ("your niece") computed server-side; this
  // component only ever renders it, never derives it (see the family-relationships design's D4).
  type AssetPerson = NonNullable<AssetResponseDto['people']>[number] & { familyRelationLabel?: string | null };

  const isSpaceMember = $derived(!!spaceId);
  // Cast to `AssetPerson`: both sources (`asset.people`, `faceManager.people`) are typed as the
  // generated `PersonResponseDto`, which doesn't know about `familyRelationLabel` yet — see the
  // comment on `AssetPerson` above.
  const people = $derived(
    (isSpaceMember && !isOwner ? asset.people || [] : Array.from(faceManager.people)) as AssetPerson[],
  );

  // A non-owner has no access to the owner-scoped person page, so their name is rendered as plain
  // text rather than a link into a 404.
  const getPersonPageHref = (person: AssetPerson) => {
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
  const getPersonFilterHref = (person: AssetPerson) => {
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
  const rememberPersonName = (person: AssetPerson, href: string) => {
    const patch = buildPersonFilterPatch(page.url, person);
    const personId = patch?.personIds?.[0];
    if (personId) {
      rememberContextualPersonName(href, personId, person.name);
    }
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

  // Only offer the switch where it can actually do something. A viewer reaching this asset through
  // an album or partner share has no profile face to switch to, so for them the crop is the only
  // option and the button would be dead.
  const canChooseAvatarSource = $derived(
    visiblePeople.some((person) => getRepresentativeThumbnailUrl(person, { isOwner, spaceId }) !== undefined),
  );
</script>

<!--
  Who is in a photo is read-only metadata: anyone with read access to the asset sees the panel
  (#796) — `GET /faces` already authorizes on AssetRead (owner ∪ album ∪ partner ∪ space), so a
  non-owner reaching this panel is entitled to the data. Only the affordances below (hidden-people
  toggle, add-face, edit-faces) stay owner-gated. A non-owner with nobody to show gets no empty
  section; the owner keeps it so the add-face affordance stays reachable on a face-less asset.
-->
{#snippet avatar(url: string, person: AssetPerson, isHighlighted: boolean)}
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
{#if !authManager.isSharedLink && (isOwner || visiblePeople.length > 0)}
  <section class="px-4 pt-4 text-sm" data-testid="detail-panel-people">
    <div class="flex h-10 w-full items-center justify-between">
      <Text size="small" color="muted">{$t('people')}</Text>
      <div class="flex items-center gap-2">
        {#if canChooseAvatarSource}
          <IconButton
            aria-label={$cropFacesFromAsset ? $t('show_profile_faces') : $t('show_faces_from_photo')}
            icon={$cropFacesFromAsset ? mdiAccountBoxOutline : mdiCropFree}
            size="medium"
            shape="round"
            color="secondary"
            variant="ghost"
            onclick={() => cropFacesFromAsset.set(!$cropFacesFromAsset)}
          />
        {/if}
        {#if isOwner}
          {#if people.some((person) => person.isHidden)}
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

    <div class="mt-2 grid {visiblePeople.length <= 6 ? 'grid-cols-3 gap-3' : 'grid-cols-4 gap-2'}">
      {#each visiblePeople as person (person.id)}
        {@const personFaces = faceManager.facesByPersonId.get(person.id) ?? []}
        {@const isHighlighted = personFaces.some((f) => assetViewerManager.highlightedFaces.some((b) => b.id === f.id))}
        {@const avatarSource = resolvePersonAvatar({
          person,
          isOwner,
          spaceId,
          hasFaceInAsset: personFaces.length > 0,
          cropFacesFromAsset: $cropFacesFromAsset,
          assetThumbnailUrl: getAssetUrls(asset).thumbnail,
        })}
        {@const filterHref = getPersonFilterHref(person)}
        {@const personPageHref = getPersonPageHref(person)}
        <!--
        R6 — the chip IS the <a>, and it carries the four face-highlight handlers that drive the face
        overlay. The ↗ person-page link cannot nest inside it (a link inside a link), so it is a
        SIBLING overlay control on a relative wrapper. When there is no honest filter to offer
        (buildPersonFilterPatch → null, e.g. a Space person with no spacePersonId, or a shared link),
        the chip stays the person-page link it is today and no ↗ renders.
      -->
        <div class="relative">
          <a
            class="group block outline-none"
            href={filterHref ?? personPageHref}
            aria-label={filterHref ? `${$t('filter_by_person')}: ${person.name}` : undefined}
            onclick={filterHref ? () => rememberPersonName(person, filterHref) : undefined}
            onfocus={() => assetViewerManager.setHighlightedFaces(personFaces)}
            onblur={() => assetViewerManager.clearHighlightedFaces()}
            onpointerenter={() => assetViewerManager.setHighlightedFaces(personFaces)}
            onpointerleave={() => assetViewerManager.clearHighlightedFaces()}
          >
            {#if avatarSource.kind === 'assetFace'}
              {#await zoomImageToBase64(personFaces[0]!, asset.id, asset.type, assetViewerManager.imgRef)}
                {@render avatar(avatarSource.fallbackUrl, person, isHighlighted)}
              {:then faceThumbnailUrl}
                {@render avatar(faceThumbnailUrl ?? avatarSource.fallbackUrl, person, isHighlighted)}
              {/await}
            {:else}
              {@render avatar(avatarSource.url, person, isHighlighted)}
            {/if}
            <p class="mt-1 truncate font-medium" title={person.name}>{person.name}</p>
            {#if person.familyRelationLabel}
              <!--
                A3 — an ADDED line, not a replacement: the age line below stays regardless. Rows
                will differ in height depending on who has a birthdate and who has a known
                relation — CSS grid equalises within a row, so that reads as normal variation, not
                breakage. `truncate` (not a reserved second line) is what keeps a long relation
                from wrapping and blowing out row height at the crowded grid-cols-4 breakpoint.
              -->
              <p
                class="truncate font-light {visiblePeople.length > 6 ? 'text-xs' : ''}"
                title={person.familyRelationLabel}
                aria-label={$t('family_strip_relation_label', { values: { relation: person.familyRelationLabel } })}
                data-testid="detail-panel-person-relation"
              >
                {person.familyRelationLabel}
              </p>
            {/if}
            {#if person.birthDate && person.formattedAge}
              <p class="font-light {visiblePeople.length > 6 ? 'text-xs' : ''}" title={person.formattedBirthDate!}>
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
      {/each}
    </div>
  </section>
{/if}
