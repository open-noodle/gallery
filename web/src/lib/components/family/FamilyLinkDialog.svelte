<script lang="ts">
  import {
    createUnion,
    getAllPeople,
    getMyRoot,
    searchPerson,
    setMyRoot,
    type FamilyUnionCreateDto,
    type PersonResponseDto,
  } from '@immich/sdk';
  import { getPeopleThumbnailUrl } from '$lib/utils';
  import { t } from 'svelte-i18n';

  // Gallery-fork: family relationships — the ONLY way to put the first union into an empty graph.
  // The canvas can only ever edit a graph that already exists: its drag gestures need a rendered
  // card as a drop target, and cards come from unions. With zero unions there is nothing to drag,
  // so without this dialog the whole feature is unreachable from a cold start.
  //
  // Everything here speaks in `person.id`, never `identityId` — `PersonResponseDto` deliberately
  // withholds the identity id (it would let the same real person be correlated across users), so
  // the server resolves person ids on the write endpoints instead.

  interface Props {
    onClose: (created: boolean) => void;
  }

  let { onClose }: Props = $props();

  type Relation = 'partner' | 'parent' | 'child';
  // `self` only appears when there is no root yet: a graph built without one renders bare names
  // instead of "your aunt", and no other surface in the app nominates you.
  type Step = 'self' | 'first' | 'second' | 'relation';

  // Resolved here rather than passed in: the page knows the root only as an IDENTITY id, this
  // dialog speaks exclusively in person ids, and the person page does not know it at all. Asking
  // the server keeps one source of truth and spares every call site a value it cannot supply
  // honestly. Starts on 'self' and moves on if a root already exists — erring towards asking.
  let step = $state<Step>('self');
  let query = $state('');
  let people = $state<PersonResponseDto[]>([]);
  let loading = $state(true);
  let first = $state<PersonResponseDto | undefined>();
  let second = $state<PersonResponseDto | undefined>();
  let relation = $state<Relation>('partner');
  let saving = $state(false);
  let failed = $state(false);

  const stepTitle = $derived(
    {
      self: $t('family_link_step_self'),
      first: $t('family_link_step_first'),
      second: $t('family_link_step_second'),
      relation: $t('family_link_relation_prompt', {
        values: { first: first?.name ?? '', second: second?.name ?? '' },
      }),
    }[step],
  );

  // Guards against a stale response landing after a newer keystroke.
  let requestToken = 0;

  const load = async (rawQuery: string) => {
    const token = ++requestToken;
    loading = true;
    try {
      let result: PersonResponseDto[];
      if (rawQuery) {
        result = await searchPerson({ name: rawQuery, withHidden: false, withSharedSpaces: true });
      } else {
        const all = await getAllPeople({ size: 50, withSharedSpaces: true });
        result = all.people;
      }
      if (token === requestToken) {
        people = result;
      }
    } catch {
      if (token === requestToken) {
        people = [];
      }
    } finally {
      if (token === requestToken) {
        loading = false;
      }
    }
  };

  void load('');

  void (async () => {
    try {
      const { rootIdentityId } = await getMyRoot();
      if (rootIdentityId !== null) {
        step = 'first';
      }
    } catch {
      // Leave the identity step in place: asking again is harmless (it just re-records the same
      // nomination), whereas skipping it on a failed probe would silently strip every label.
    }
  })();

  const onQueryInput = () => void load(query.trim());

  const choose = async (person: PersonResponseDto) => {
    if (step === 'self') {
      // Recorded immediately rather than batched with the union: nominating yourself is useful on
      // its own, and it is the step that makes every later label read relative to you.
      try {
        await setMyRoot({ familyMyRootUpdateDto: { personId: person.id } });
      } catch {
        failed = true;
        return;
      }
      first = person;
      step = 'second';
      return;
    }
    if (step === 'first') {
      first = person;
      step = 'second';
      return;
    }
    second = person;
    step = 'relation';
  };

  // A union needs TWO resolvable participants or `computeVisibleUnions` drops it entirely, so
  // every branch here contributes exactly two people — there is no single-person starting move.
  const buildDto = (a: string, b: string): FamilyUnionCreateDto => {
    switch (relation) {
      case 'partner': {
        return { partnerPersonIds: [a, b] };
      }
      case 'child': {
        return { partnerPersonIds: [a], childPersonIds: [b] };
      }
      case 'parent': {
        return { partnerPersonIds: [b], childPersonIds: [a] };
      }
    }
  };

  const create = async () => {
    if (!first || !second || saving) {
      return;
    }
    saving = true;
    failed = false;
    try {
      await createUnion({ familyUnionCreateDto: buildDto(first.id, second.id) });
      onClose(true);
    } catch {
      // Stay open showing the error rather than closing as though it had worked — a silent close
      // would look identical to success and leave the canvas empty with no explanation.
      failed = true;
    } finally {
      saving = false;
    }
  };

  const relations: Relation[] = ['partner', 'parent', 'child'];
</script>

<div data-testid="family-link-dialog" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
  <div class="flex max-h-[80vh] w-full max-w-md flex-col gap-4 rounded-2xl bg-light p-5 shadow-lg">
    <h2 class="text-lg font-medium" data-testid={`family-link-step-${step}`}>{stepTitle}</h2>

    {#if step === 'relation'}
      <div class="flex flex-col gap-2">
        {#each relations as option (option)}
          <button
            type="button"
            data-testid={`family-link-relation-${option}`}
            data-selected={relation === option}
            class="rounded-lg border px-3 py-2 text-start"
            class:border-primary={relation === option}
            class:border-gray-300={relation !== option}
            onclick={() => (relation = option)}
          >
            {$t(`family_link_relation_${option}`)}
          </button>
        {/each}
      </div>
    {:else}
      <input
        class="rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600"
        placeholder={$t('family_link_search_placeholder')}
        aria-label={$t('family_link_search_placeholder')}
        bind:value={query}
        oninput={onQueryInput}
      />
      <div class="flex flex-col gap-1 overflow-y-auto">
        {#each people as candidate (candidate.id)}
          <button
            type="button"
            data-testid="family-link-person-option"
            class="flex items-center gap-3 rounded-lg p-2 text-start hover:bg-gray-100 dark:hover:bg-gray-800"
            onclick={() => void choose(candidate)}
          >
            <img class="size-9 rounded-full object-cover" src={getPeopleThumbnailUrl(candidate)} alt="" />
            <span class="truncate">{candidate.name || $t('family_person_anonymous_name')}</span>
          </button>
        {/each}
        {#if !loading && people.length === 0}
          <p class="px-2 py-4 text-sm text-gray-500" data-testid="family-link-no-matches">
            {$t('family_link_no_matches')}
          </p>
        {/if}
      </div>
    {/if}

    {#if failed}
      <p class="text-sm text-red-500" data-testid="family-link-error">{$t('family_link_error')}</p>
    {/if}

    <div class="flex justify-end gap-2">
      <button type="button" class="px-3 py-2 text-sm" onclick={() => onClose(false)}>
        {$t('family_link_cancel')}
      </button>
      {#if step === 'relation'}
        <button
          type="button"
          data-testid="family-link-create"
          class="rounded-lg bg-primary px-3 py-2 text-sm text-white dark:text-black"
          disabled={saving}
          onclick={() => void create()}
        >
          {$t('family_link_create')}
        </button>
      {/if}
    </div>
  </div>
</div>
