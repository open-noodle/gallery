<script lang="ts">
  import { goto } from '$app/navigation';
  import PeopleVisibilityModal from '$lib/components/people/people-visibility-modal.svelte';
  import type { VisibilityChange, VisibilityPerson, VisibilitySaveResult } from '$lib/components/people/people-types';
  import { getPeopleThumbnailUrl } from '$lib/utils';
  import { handleError } from '$lib/utils/handle-error';
  import { getAllPeople, updatePeople, type PersonResponseDto } from '@immich/sdk';
  import { t } from 'svelte-i18n';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  const { data }: Props = $props();

  let people = $derived(data.people.people);
  const totalPeopleCount = $derived(data.people.total);
  let nextPage = $state(data.people.hasNextPage ? 2 : null);
  let loading = $state(false);

  const visibilityPeople: VisibilityPerson[] = $derived(
    people.map((person) => ({
      id: person.id,
      displayName: person.name,
      thumbnailUrl: getPeopleThumbnailUrl(person),
      isHidden: person.isHidden,
    })),
  );

  const saveVisibilityChanges = async (changes: VisibilityChange[]): Promise<VisibilitySaveResult> => {
    const results = await updatePeople({ peopleUpdateDto: { people: changes } });
    const successCount = results.filter(({ success }) => success).length;
    return { successCount, failCount: results.length - successCount };
  };

  const handleUpdate = (updatedVisibilityPeople: VisibilityPerson[]) => {
    const hiddenById = new Map(updatedVisibilityPeople.map((person) => [person.id, person.isHidden]));
    people = people.map((person: PersonResponseDto) => {
      const nextHidden = hiddenById.get(person.id);
      return nextHidden === undefined || nextHidden === person.isHidden ? person : { ...person, isHidden: nextHidden };
    });
  };

  const loadNextPage = async () => {
    if (loading || !nextPage) {
      return;
    }

    loading = true;
    try {
      const { people: newPeople, hasNextPage } = await getAllPeople({ withHidden: true, page: nextPage });
      people = people.concat(newPeople);
      nextPage = hasNextPage ? nextPage + 1 : null;
    } catch (error) {
      handleError(error, $t('errors.failed_to_load_people'));
    } finally {
      loading = false;
    }
  };
</script>

<PeopleVisibilityModal
  people={visibilityPeople}
  {totalPeopleCount}
  onClose={() => void goto('/people')}
  onUpdate={handleUpdate}
  hasMore={nextPage !== null}
  {loading}
  {loadNextPage}
  {saveVisibilityChanges}
/>
