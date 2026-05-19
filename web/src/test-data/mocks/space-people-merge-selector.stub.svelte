<script lang="ts">
  // Like people-merge-selector.stub.svelte, but mirrors the real selector by
  // handing the surviving person to onMerge after a merge. Used by the spaces
  // person detail spec to exercise handleMergeComplete. Kept separate so the
  // global people spec keeps the original no-onMerge stub behavior.
  type Candidate = { id: string; [key: string]: unknown };

  interface Props {
    person: { id: string };
    mergePeople?: (person: { id: string }, selectedPeople: Candidate[]) => Promise<Candidate | void> | Candidate | void;
    onMerge?: (person: Candidate) => void;
    onSwapPerson?: (person: Candidate) => void;
    searchPeople?: (name: string) => void;
  }

  let {
    person,
    mergePeople = () => {},
    onMerge = () => {},
    onSwapPerson = () => {},
    searchPeople = () => {},
  }: Props = $props();

  const personalCandidate = {
    id: 'person-candidate',
    name: 'Personal Candidate',
    primaryProfile: { type: 'user-person', id: 'person-candidate' },
  };

  const spaceCandidate = {
    id: 'space-person-candidate',
    name: 'Space Candidate',
    primaryProfile: { type: 'space-person', id: 'space-person-candidate', spaceId: 'space-2' },
  };

  const runMerge = async (target: Candidate, sources: Candidate[]) => {
    const merged = await mergePeople(target, sources);
    onMerge(merged ?? target);
  };
</script>

<div data-testid="people-merge-selector" data-person-id={person.id}>
  choose_matching_people_to_merge
  <button
    type="button"
    data-testid="merge-personal-candidate"
    onclick={() => void runMerge(person, [personalCandidate])}
  >
    merge personal candidate
  </button>
  <button type="button" data-testid="merge-space-candidate" onclick={() => void runMerge(person, [spaceCandidate])}>
    merge space candidate
  </button>
  <button
    type="button"
    data-testid="merge-swapped-space-candidate"
    onclick={() => void runMerge(spaceCandidate, [person])}
  >
    merge swapped space candidate
  </button>
  <button type="button" data-testid="swap-space-candidate" onclick={() => onSwapPerson(spaceCandidate)}>
    swap space candidate
  </button>
  <button type="button" data-testid="search-merge-candidates" onclick={() => searchPeople('Alice')}>search</button>
</div>
